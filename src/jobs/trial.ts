import { supabase }                           from '../db/supabase';
import { rawGet, unwrapItem, moveLead, createTask, addClientNote, FitbaseAuthError } from '../http/fitbase';
import { logEvent, computeFingerprint }       from '../core/events';
import { shortName }                          from '../core/names';
import { alertError, alertAuthError }         from '../core/mail';
import {
  env,
  AGENT_TASK_DUE_HOURS,
  STAGE_BOOKED, STAGE_CONFIRMED, STAGE_DECISION, STAGE_NOSHOW,
  TRIAL_TRAINING_ID, TRIAL_CHECK_HOURS,
  REG_STATUS_BOOKED, REG_STATUS_CONFIRMED, REG_STATUS_VISITED,
  REG_STATUS_CANCELLED, REG_STATUS_NOSHOW,
} from '../config';

export const JOB_NAME = 'trial';

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentState {
  lead_id:   number;
  stage_id:  number;
  first_seen_at:           string | null;
  last_logged_fingerprint: string;
  open_task_types:         string[];
}

export interface RunStats {
  leads: number; moved: number; tasks: number;
  skipped: number; errors: number;
}

type Lead = Record<string, unknown>;
type Reg  = Record<string, unknown>;

// ── Date helpers (Asia/Almaty = UTC+5, no DST) ───────────────────────────────

function toAlmaty(d: Date): Date {
  return new Date(d.getTime() + 5 * 3600 * 1000);
}

function fmtFull(d: Date): string {
  const a   = toAlmaty(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(a.getUTCDate())}.${pad(a.getUTCMonth() + 1)}.${a.getUTCFullYear()} ${pad(a.getUTCHours())}:${pad(a.getUTCMinutes())}`;
}

// Shift due-timestamp to 08:00 Almaty if it falls in quiet hours (23:00-07:00)
function adjustForQuietHours(unixSec: number): number {
  const a = toAlmaty(new Date(unixSec * 1000));
  const h = a.getUTCHours();
  if (h >= 7 && h < 23) return unixSec;
  let y = a.getUTCFullYear(), mo = a.getUTCMonth(), day = a.getUTCDate();
  if (h >= 23) day++;
  return Math.floor(new Date(Date.UTC(y, mo, day, 3, 0, 0)).getTime() / 1000); // 08:00 Almaty = 03:00 UTC
}

function parseEventStart(reg: Reg): Date | null {
  const ev = (reg.event || {}) as Record<string, unknown>;
  const ds = String(ev.date       || '');
  const ts = String(ev.time_start || '00:00');
  if (!ds || ds.length < 8) return null;
  const [y, mo, d] = ds.split('-').map(Number);
  const [h, mi]    = ts.split(':').map(Number);
  // Fitbase stores event time in Almaty (UTC+5) — convert to UTC
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi, 0));
}

function mostRecentReg(regs: Reg[]): Reg | null {
  return regs.slice().sort((a, b) => {
    const ta = parseEventStart(a), tb = parseEventStart(b);
    if (!ta) return 1; if (!tb) return -1;
    return tb.getTime() - ta.getTime();
  })[0] || null;
}

function rStatus(reg: Reg): string { return String(reg.status !== undefined ? reg.status : ''); }
function isCancelled(reg: Reg): boolean { return REG_STATUS_CANCELLED.includes(rStatus(reg)); }
function isConfirmed(reg: Reg): boolean { return REG_STATUS_CONFIRMED.includes(rStatus(reg)); }
function isVisited(reg: Reg):   boolean { return REG_STATUS_VISITED.includes(rStatus(reg)); }
function isNoshow(reg: Reg):    boolean { return REG_STATUS_NOSHOW.includes(rStatus(reg)); }

function stageName(id: number): string {
  const map: Record<number, string> = {
    3: 'Записался на пробную', 52: 'Визит подтвержден',
    50: 'Принимает решение (Дожим)', 55: 'Не пришел на пробную',
  };
  return map[id] ?? `Этап ${id}`;
}

// ── Supabase state helpers ───────────────────────────────────────────────────

async function loadState(leadId: number, currentStageId: number): Promise<AgentState> {
  const { data } = await supabase
    .from('agent_state').select('*').eq('lead_id', leadId).maybeSingle();

  const now = new Date().toISOString();

  if (!data) {
    return { lead_id: leadId, stage_id: currentStageId, first_seen_at: now,
      last_logged_fingerprint: '', open_task_types: [] };
  }

  // Stage changed — reset everything (mirrors Apps Script getOrInitState reset block)
  if (data.stage_id !== currentStageId) {
    await supabase.from('agent_acted').delete().eq('lead_id', leadId);
    return { lead_id: leadId, stage_id: currentStageId, first_seen_at: now,
      last_logged_fingerprint: '', open_task_types: [] };
  }

  return {
    lead_id:                 leadId,
    stage_id:                data.stage_id,
    first_seen_at:           data.first_seen_at,
    last_logged_fingerprint: data.last_logged_fingerprint || '',
    open_task_types:         Array.isArray(data.open_task_types) ? data.open_task_types : [],
  };
}

async function saveState(s: AgentState): Promise<void> {
  await supabase.from('agent_state').upsert(
    { ...s, updated_at: new Date().toISOString() },
    { onConflict: 'lead_id' },
  );
}

async function alreadyActed(leadId: number, regId: number, eventStart: Date | null): Promise<boolean> {
  const key = `${regId}|${eventStart ? String(eventStart.getTime()) : ''}`;
  const { data } = await supabase
    .from('agent_acted').select('lead_id')
    .eq('lead_id', leadId).eq('action_key', key).maybeSingle();
  return !!data;
}

async function markActed(leadId: number, regId: number, eventStart: Date | null, action: string): Promise<void> {
  const key = `${regId}|${eventStart ? String(eventStart.getTime()) : ''}`;
  await supabase.from('agent_acted').upsert(
    { lead_id: leadId, action_key: key, action, acted_at: new Date().toISOString() },
    { onConflict: 'lead_id,action_key' },
  );
}

// logIfChanged: skips event if fingerprint unchanged (mirrors Apps Script logIfChanged)
// ERROR-type events are always written regardless of fingerprint.
async function logIfChanged(
  state: AgentState,
  fp: { action: string; stage_from?: number; registration_id?: number; event_start?: string; reg_status?: string },
  callback: () => Promise<void>,
): Promise<void> {
  const fingerprint = computeFingerprint(fp);
  if (fp.action !== 'ERROR' && fingerprint === state.last_logged_fingerprint) return;
  if (fp.action !== 'ERROR') {
    state.last_logged_fingerprint = fingerprint;
    await saveState(state);
  }
  await callback();
}

// ── processOne ───────────────────────────────────────────────────────────────

async function processOne(lead: Lead, dryRun: boolean, stats: RunStats): Promise<void> {
  const leadId = lead.id as number;
  const stepId = (lead.funnel_step as Record<string, unknown> | undefined)?.id as number | undefined;

  if (!leadId || !stepId) {
    await logEvent({ job: JOB_NAME, type: 'error',
      text: 'Ошибка: нет id или funnel_step у лида', meta: { lead_id: leadId }, dry: dryRun });
    stats.errors++;
    return;
  }

  const now   = new Date();
  const state = await loadState(leadId, stepId);

  // ── No client ───────────────────────────────────────────────────────────────
  if (!lead.client_id) {
    await logIfChanged(state, { action: 'SKIP_NO_CLIENT', stage_from: stepId }, async () => {
      const name = shortName(lead);
      await logEvent({ job: JOB_NAME, type: 'skipped_no_client', lead_id: leadId,
        short_name: name, text: `Пропустил ${name || 'лид'}: нет клиента в карточке`,
        meta: { stage: stepId }, dry: dryRun });
      stats.skipped++;
    });
    return;
  }

  const clientId = lead.client_id as number;

  // ── Fetch registrations ──────────────────────────────────────────────────────
  const regsResp = await rawGet(`/schedule-registration?client_id=${clientId}`);
  const allRegs  = ((regsResp.items || []) as Reg[]).filter(r => {
    const ev = r.event as Record<string, unknown> | undefined;
    return (ev?.training as Record<string, unknown> | undefined)?.id === TRIAL_TRAINING_ID;
  });

  // Resolve display name from client if lead has none
  let clientData: Record<string, unknown> | null = null;
  if (!lead.name && !lead.title) {
    try { clientData = unwrapItem(await rawGet(`/client/${clientId}`)); } catch { /* silent */ }
  }
  const name = shortName(lead, clientData ?? undefined);

  const reg = mostRecentReg(allRegs);

  // ── No registration ──────────────────────────────────────────────────────────
  if (!reg) {
    const taskKey = 'NO_REGISTRATION';
    if (!state.open_task_types.includes(taskKey)) {
      const desc = `[АГЕНТ] Карточка на этапе «${stageName(stepId)}», но актуальной записи на пробное в расписании нет. Проверить запись клиента.`;
      if (!dryRun) {
        try { await createTask({ lead_id: leadId, description: desc, client_id: clientId,
          available_to: adjustForQuietHours(Math.floor(Date.now() / 1000) + AGENT_TASK_DUE_HOURS * 3600),
        }, 'NO_REGISTRATION'); } catch { /* silent */ }
        state.open_task_types.push(taskKey);
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'TASK_CREATED', stage_from: stepId }, async () => {
        const text = dryRun
          ? `[DRY] Поставил бы задачу (Задание): ${name} — нет записи на пробное`
          : `Поставил задачу (Задание): ${name} — нет записи на пробное`;
        await logEvent({ job: JOB_NAME, type: 'task_created', lead_id: leadId, short_name: name,
          text, meta: { task_type: taskKey, stage: stepId }, dry: dryRun });
        stats.tasks++;
      });
    }
    return;
  }

  const eventStart = parseEventStart(reg);
  const regId      = reg.id as number;
  const regSt      = rStatus(reg);

  // ── Old history guard ────────────────────────────────────────────────────────
  if (eventStart && state.first_seen_at) {
    if (eventStart < new Date(new Date(state.first_seen_at).getTime() - 24 * 3600 * 1000)) {
      const taskKey = 'NO_REGISTRATION';
      if (!state.open_task_types.includes(taskKey)) {
        const desc = `[АГЕНТ] Карточка на этапе «${stageName(stepId)}», но актуальной записи на пробное в расписании нет. Проверить запись клиента.`;
        if (!dryRun) {
          try { await createTask({ lead_id: leadId, description: desc, client_id: clientId }, 'NO_REGISTRATION'); } catch { /* silent */ }
          state.open_task_types.push(taskKey);
          await saveState(state);
        }
        await logIfChanged(state, { action: dryRun ? 'DRY' : 'TASK_CREATED', stage_from: stepId, registration_id: regId }, async () => {
          const text = dryRun
            ? `[DRY] Поставил бы задачу (Задание): ${name} — старая история`
            : `Поставил задачу (Задание): ${name} — старая история`;
          await logEvent({ job: JOB_NAME, type: 'task_created', lead_id: leadId, short_name: name,
            text, meta: { task_type: taskKey, stage: stepId, detail: 'старая история' }, dry: dryRun });
          stats.tasks++;
        });
      } else {
        await logIfChanged(state, { action: 'SKIP_OLD_HISTORY', stage_from: stepId, registration_id: regId }, async () => {});
      }
      return;
    }
  }

  // ── Already acted on this reg+time ───────────────────────────────────────────
  if (await alreadyActed(leadId, regId, eventStart)) return;

  const evStr  = eventStart ? fmtFull(eventStart) : '?';
  const evPlace = ((reg.event as Record<string, unknown>)?.place as Record<string, unknown>)?.name as string || '';

  // ── Cancelled ────────────────────────────────────────────────────────────────
  if (isCancelled(reg)) {
    const taskKey = `CANCELLED_${regId}`;
    if (!state.open_task_types.includes(taskKey)) {
      const desc = `[АГЕНТ] Клиент отменил запись на пробное (${evStr}). Связаться и перезаписать.`;
      if (!dryRun) {
        try { await createTask({ lead_id: leadId, description: desc, client_id: clientId,
          available_to: adjustForQuietHours(Math.floor(Date.now() / 1000) + AGENT_TASK_DUE_HOURS * 3600),
        }, 'CANCELLED'); } catch { /* silent */ }
        state.open_task_types.push(taskKey);
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'TASK_CREATED', stage_from: stepId, registration_id: regId, reg_status: regSt }, async () => {
        const text = dryRun
          ? `[DRY] Поставил бы задачу (Звонок): ${name} отменил(а) запись на пробное`
          : `Поставил задачу (Звонок): ${name} отменил(а) запись на пробное`;
        await logEvent({ job: JOB_NAME, type: 'task_created', lead_id: leadId, short_name: name,
          text, meta: { task_type: 'CANCELLED', stage: stepId, reg_id: regId }, dry: dryRun });
        stats.tasks++;
      });
    }
    return;
  }

  if (!eventStart) {
    await logIfChanged(state, { action: 'SKIP_NO_EVENT_DATE', stage_from: stepId, registration_id: regId }, async () => {});
    return;
  }

  // ── Unknown status ───────────────────────────────────────────────────────────
  const known = [...REG_STATUS_BOOKED, ...REG_STATUS_CONFIRMED, ...REG_STATUS_VISITED,
    ...REG_STATUS_CANCELLED, ...REG_STATUS_NOSHOW];
  if (known.length > 0 && !known.includes(regSt)) {
    await logIfChanged(state, { action: 'SKIP_UNKNOWN_STATUS', stage_from: stepId, registration_id: regId, reg_status: regSt }, async () => {});
    return;
  }

  const checkTime    = new Date(eventStart.getTime() + TRIAL_CHECK_HOURS * 3600 * 1000);
  const checkReached = now >= checkTime;

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 3 — BOOKED
  // ═══════════════════════════════════════════════════════════════════════
  if (stepId === STAGE_BOOKED) {

    // Visited → Дожим
    if (isVisited(reg)) {
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_BOOKED)} → ${stageName(STAGE_DECISION)}. Визит отмечен (занятие ${evStr}).`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_BOOKED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_DECISION);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun ? `[DRY] Перевёл бы ${name} в «Дожим» — визит отмечен` : `Перевёл ${name} в «Дожим» — визит отмечен`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_BOOKED, to: STAGE_DECISION, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Noshow (admin marked) → Не пришел + задача Звонок
    if (isNoshow(reg)) {
      const reason  = `Администратор отметил неявку (занятие ${evStr})`;
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_BOOKED)} → ${stageName(STAGE_NOSHOW)}. ${reason}.`;
      const taskDesc = `[АГЕНТ] Клиент не пришёл на пробное (${evStr}${evPlace ? ', ' + evPlace : ''}). ${reason}. Узнать причину неявки и перезаписать. Итог отписать в результат задачи.`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_BOOKED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_NOSHOW);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        try { await createTask({ lead_id: leadId, description: taskDesc, client_id: clientId }, 'NO_SHOW'); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED_NOSHOW');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun ? `[DRY] Перевёл бы ${name} в «Не пришел» — неявка отмечена` : `Перевёл ${name} в «Не пришел» — неявка отмечена`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_BOOKED, to: STAGE_NOSHOW, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Confirmed (not yet check-time) → Визит подтвержден
    if (isConfirmed(reg) && !checkReached) {
      const confirmedAt = reg.updated_at ? new Date(String(reg.updated_at)) : now;
      const comment = `[АГЕНТ ${fmtFull(confirmedAt)}] ${stageName(STAGE_BOOKED)} → ${stageName(STAGE_CONFIRMED)}. Запись подтверждена ${evStr}.`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_BOOKED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_CONFIRMED);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED_CONFIRMED');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun ? `[DRY] Перевёл бы ${name} в «Визит подтвержден»` : `Перевёл ${name} в «Визит подтвержден»`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_BOOKED, to: STAGE_CONFIRMED, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Check-time reached, visit not marked → Не пришел + задача Звонок
    if (checkReached) {
      const reason  = `Визит не отмечен через ${TRIAL_CHECK_HOURS} ч от начала занятия (${evStr}). Если клиент приходил — отметь визит в расписании и переведи карточку в Дожим`;
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_BOOKED)} → ${stageName(STAGE_NOSHOW)}. ${reason}.`;
      const taskDesc = `[АГЕНТ] Клиент не пришёл на пробное (${evStr}${evPlace ? ', ' + evPlace : ''}). ${reason}. Узнать причину неявки и перезаписать. Итог отписать в результат задачи.`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_BOOKED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_NOSHOW);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        try { await createTask({ lead_id: leadId, description: taskDesc, client_id: clientId }, 'NO_SHOW'); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED_NOSHOW');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun
          ? `[DRY] Перевёл бы ${name} в «Не пришел» — визит не отмечен через ${TRIAL_CHECK_HOURS} ч`
          : `Перевёл ${name} в «Не пришел» — визит не отмечен через ${TRIAL_CHECK_HOURS} ч`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_BOOKED, to: STAGE_NOSHOW, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Waiting for event / confirmation
    await logIfChanged(state, { action: 'SKIP_WAITING', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {});
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 52 — CONFIRMED
  // ═══════════════════════════════════════════════════════════════════════
  if (stepId === STAGE_CONFIRMED) {

    // Visited → Дожим
    if (isVisited(reg)) {
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_CONFIRMED)} → ${stageName(STAGE_DECISION)}. Визит отмечен (занятие ${evStr}).`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_CONFIRMED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_DECISION);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun ? `[DRY] Перевёл бы ${name} в «Дожим» — визит отмечен` : `Перевёл ${name} в «Дожим» — визит отмечен`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_CONFIRMED, to: STAGE_DECISION, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Noshow (admin marked) → Не пришел + задача Звонок
    if (isNoshow(reg)) {
      const reason  = `Администратор отметил неявку (занятие ${evStr})`;
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_CONFIRMED)} → ${stageName(STAGE_NOSHOW)}. ${reason}.`;
      const taskDesc = `[АГЕНТ] Клиент не пришёл на пробное (${evStr}${evPlace ? ', ' + evPlace : ''}). ${reason}. Узнать причину неявки и перезаписать. Итог отписать в результат задачи.`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_CONFIRMED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_NOSHOW);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        try { await createTask({ lead_id: leadId, description: taskDesc, client_id: clientId }, 'NO_SHOW'); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED_NOSHOW');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun ? `[DRY] Перевёл бы ${name} в «Не пришел» — неявка отмечена` : `Перевёл ${name} в «Не пришел» — неявка отмечена`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_CONFIRMED, to: STAGE_NOSHOW, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    // Check-time reached, visit not marked → Не пришел + задача Звонок
    if (checkReached) {
      const reason  = `Визит не отмечен через ${TRIAL_CHECK_HOURS} ч от начала занятия (${evStr}). Если клиент приходил — отметь визит в расписании и переведи карточку в Дожим`;
      const comment = `[АГЕНТ ${fmtFull(now)}] ${stageName(STAGE_CONFIRMED)} → ${stageName(STAGE_NOSHOW)}. ${reason}.`;
      const taskDesc = `[АГЕНТ] Клиент не пришёл на пробное (${evStr}${evPlace ? ', ' + evPlace : ''}). ${reason}. Узнать причину неявки и перезаписать. Итог отписать в результат задачи.`;
      if (!dryRun) {
        const fresh = unwrapItem(await rawGet(`/lead/${leadId}`));
        if ((fresh.funnel_step as Record<string, unknown>)?.id !== STAGE_CONFIRMED) {
          await logIfChanged(state, { action: 'SKIP_STAGE_CHANGED', stage_from: stepId }, async () => {}); return;
        }
        await moveLead(leadId, STAGE_NOSHOW);
        try { await addClientNote(clientId, comment); } catch { /* silent */ }
        try { await createTask({ lead_id: leadId, description: taskDesc, client_id: clientId }, 'NO_SHOW'); } catch { /* silent */ }
        await markActed(leadId, regId, eventStart, 'MOVED_NOSHOW');
        await saveState(state);
      }
      await logIfChanged(state, { action: dryRun ? 'DRY' : 'MOVED', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {
        const text = dryRun
          ? `[DRY] Перевёл бы ${name} в «Не пришел» — визит не отмечен через ${TRIAL_CHECK_HOURS} ч`
          : `Перевёл ${name} в «Не пришел» — визит не отмечен через ${TRIAL_CHECK_HOURS} ч`;
        await logEvent({ job: JOB_NAME, type: 'lead_moved', lead_id: leadId, short_name: name,
          text, meta: { from: STAGE_CONFIRMED, to: STAGE_NOSHOW, reg_id: regId }, dry: dryRun });
        stats.moved++;
      });
      return;
    }

    await logIfChanged(state, { action: 'SKIP_WAITING', stage_from: stepId, registration_id: regId, event_start: evStr, reg_status: regSt }, async () => {});
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runTrial(): Promise<RunStats> {
  const dryRun = env.TRIAL_AGENT_DRY_RUN;
  const stats: RunStats = { leads: 0, moved: 0, tasks: 0, skipped: 0, errors: 0 };

  await logEvent({ job: JOB_NAME, type: 'run_started',
    text: `Запуск trial (dry=${dryRun})`, dry: dryRun });

  const [bookedResp, confirmedResp] = await Promise.all([
    rawGet(`/lead?funnel_step_id=${STAGE_BOOKED}&page_size=100`),
    rawGet(`/lead?funnel_step_id=${STAGE_CONFIRMED}&page_size=100`),
  ]);

  const leads = [
    ...((bookedResp.items   || []) as Lead[]),
    ...((confirmedResp.items || []) as Lead[]),
  ].filter(l => !String(l.title || '').startsWith('ТЕСТ'));

  stats.leads = leads.length;
  console.log(`[trial] ${leads.length} leads, dry=${dryRun}`);

  const deadline = Date.now() + 270_000; // 4.5 min max (matches Apps Script 270s guard)
  for (const lead of leads) {
    if (Date.now() > deadline) { console.warn('[trial] time limit'); break; }
    try {
      await processOne(lead, dryRun, stats);
    } catch (e) {
      const err = e as Error;
      stats.errors++;
      console.error(`[trial] lead=${lead.id}: ${err.message}`);
      if (e instanceof FitbaseAuthError) {
        await alertAuthError();
      } else {
        await logEvent({ job: JOB_NAME, type: 'error', lead_id: lead.id as number,
          text: `Ошибка: ${err.message.substring(0, 200)}`, meta: { lead_id: lead.id }, dry: dryRun });
        try { await alertError(`trial_lead_${lead.id}`, err.message); } catch { /* silent */ }
      }
    }
  }

  await logEvent({ job: JOB_NAME, type: 'run_finished',
    text: `Завершил: перевели ${stats.moved}, задач ${stats.tasks}, ошибок ${stats.errors}`,
    meta: stats as unknown as Record<string, unknown>, dry: dryRun });

  return stats;
}
