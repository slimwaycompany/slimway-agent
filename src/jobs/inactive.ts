import { supabase }              from '../db/supabase';
import { paginateGet, rawGet, createStandaloneTask } from '../http/fitbase';
import { logEvent }              from '../core/events';
import { shortName }             from '../core/names';
import { env, isDry, getResponsibleIds, WATCH_EXCLUDE_CLIENT_IDS_SET, lookupVisitsOverride } from '../config';

export const JOB_NAME = 'inactive';

const ALMATY_OFFSET_MS = 5 * 3600 * 1000;
const TRIAL_RE = /пробн/i;

// ── Date helpers ──────────────────────────────────────────────────────────────

function almatyDateStr(ms = Date.now()): string {
  return new Date(ms + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}

function parseMs(val: unknown): number {
  if (!val) return 0;
  const s = String(val);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const n = Number(s);
  return isNaN(n) ? 0 : (n > 1e10 ? n : n * 1000);
}

function daysAgo(dateStr: string): number {
  const ms = parseMs(dateStr);
  if (!ms) return 0;
  const todayMs = parseMs(almatyDateStr()) + 0; // midnight Almaty
  // compare calendar dates only
  const today = new Date(almatyDateStr()).getTime();
  const then  = new Date(dateStr).getTime();
  return Math.floor((today - then) / 86400000);
}

function fmtShortDate(dateStr: string): string {
  if (!dateStr) return '??';
  const [, m, d] = dateStr.split('-');
  return `${d}.${m}`;
}

function todayDeadlineUnix(): number {
  const t = almatyDateStr();
  return Math.floor(new Date(`${t}T${String(env.INACTIVE_DEADLINE_HOUR).padStart(2, '0')}:00:00+05:00`).getTime() / 1000);
}

// ── Supabase episode type ─────────────────────────────────────────────────────

interface Episode {
  id:                number;
  client_id:         number;
  episode_start:     string;
  stage7_at:         string | null;
  stage7_task_id:    number | null;
  stage7_manager_id: number | null;
  stage10_at:        string | null;
  stage10_task_id:   number | null;
  stage14_at:        string | null;
  closed_at:         string | null;
  close_reason:      string | null;
  meta:              Record<string, unknown> | null;
}

// ── Contract helpers ──────────────────────────────────────────────────────────

interface ActiveContract {
  id:          number;
  visitsLeft:  number;
  visitsTotal: number;
  endDate:     string;
  activation:  string;
  beginDate:   string;
}

function findActiveContract(contracts: Record<string, unknown>[]): ActiveContract | null {
  for (const c of contracts) {
    if (String(c.deleted_at ?? '').trim()) continue;
    if (Boolean(c.closed)) continue;

    const ticket    = c.ticket as Record<string, unknown> | null;
    const itemName  = String((ticket?.contract_item as Record<string, unknown> | null)?.name ?? '');
    if (TRIAL_RE.test(itemName)) continue;

    const priceFull = Number(c.price_full ?? 0);
    if (priceFull <= 0) continue;

    const rawVisits = ticket?.visits;
    let visitsLeft  = 0;
    let visitsTotal = 0;

    if (rawVisits !== null && rawVisits !== undefined && Number(rawVisits) > 0) {
      visitsLeft  = Number(c.visits_left ?? 0);
      visitsTotal = Number(rawVisits);
      if (visitsLeft <= 0) continue;
    } else if (rawVisits === null) {
      const override = lookupVisitsOverride(itemName);
      if (override === null) continue; // truly unlimited, skip
      visitsLeft  = override; // approximate; actual used count requires regs
      visitsTotal = override;
    } else {
      continue;
    }

    return {
      id:         Number(c.id),
      visitsLeft,
      visitsTotal,
      endDate:    String(c.end_date ?? ''),
      activation: String(c.activation_date ?? ''),
      beginDate:  String(c.begin_date ?? c.payment_date ?? c.created_at ?? ''),
    };
  }
  return null;
}

// ── Client data ───────────────────────────────────────────────────────────────

interface ClientData {
  clientId:    number;
  sname:       string;
  phone:       string;
  contract:    ActiveContract;
  lastVisit:   string; // YYYY-MM-DD or ''
  episodeStart: string; // YYYY-MM-DD
  daysAbsent:  number;
  cashierUserId: number | null;
}

async function loadFrozenIds(): Promise<Set<number>> {
  const items = await paginateGet('/client', { 'status[]': 4, page_size: 100 } as Record<string, string | number>);
  return new Set(items.map(c => Number(c.id)).filter(Boolean));
}

async function loadCashierMap(): Promise<Map<number, number>> {
  // Map contractId → cashier user id from till-order-steps (contract purchases)
  const steps = await paginateGet('/till-order-steps', {
    item_type:      'contract',
    operation_type: 'purchase',
    page_size:      100,
  });
  const map = new Map<number, number>();
  for (const s of steps) {
    // Try several possible field names; probe-tasks will clarify the correct one
    const user = (s.user as Record<string, unknown> | null | undefined);
    const uid  = Number(user?.id ?? s.user_id ?? s.manager_id ?? s.cashier_id ?? s.created_by ?? 0);
    const cid  = Number(s.client_contract_id ?? s.contract_id ?? 0);
    if (uid && cid && !map.has(cid)) map.set(cid, uid);
  }
  return map;
}

async function getClientDetail(clientId: number): Promise<{ sname: string; phone: string; isTest: boolean }> {
  try {
    const resp = await rawGet(`/client/${clientId}`);
    const c    = ((resp.item ?? resp) as Record<string, unknown>);
    const name    = String(c.name    ?? '').trim();
    const surname = String(c.surname ?? '').trim();
    const phone   = String(c.phone   ?? c.mobile ?? '').trim();
    const full    = name + (surname ? ' ' + surname : '');
    const sname   = full.trim() ? shortName({ name: full }) : `Клиент #${clientId}`;
    const isTest  = /тест|test/i.test(name) || /тест|test/i.test(surname);
    return { sname, phone, isTest };
  } catch {
    return { sname: `Клиент #${clientId}`, phone: '', isTest: false };
  }
}

function findLastVisit(regs: Record<string, unknown>[]): string {
  let bestDate = '';
  for (const r of regs) {
    if (String(r.status) !== '3') continue;
    const ev   = r.event as Record<string, unknown> | undefined;
    const date = String(ev?.date ?? '');
    if (date && (!bestDate || date > bestDate)) bestDate = date;
  }
  return bestDate;
}

function hasFutureBooking(regs: Record<string, unknown>[], today: string): boolean {
  return regs.some(r => {
    const status = String(r.status ?? '');
    if (status !== '0' && status !== '1') return false;
    const ev   = r.event as Record<string, unknown> | undefined;
    const date = String(ev?.date ?? '');
    return date > today;
  });
}

// ── Task description builder ──────────────────────────────────────────────────

function buildDescription(stage: 7 | 10, clients: ClientData[]): string {
  const intro = stage === 7
    ? '[АГЕНТ] Клиенты с активным абонементом, которые не посещали занятия более 7 дней. Свяжитесь, возьмите обратную связь и запишите на занятие. Результат отпишите в комментарии клиента.'
    : '[АГЕНТ] Клиенты не посещают занятия более 10 дней, задача кассиру не помогла или клиент давно пропал. Подключитесь все.';
  const lines = clients.map((cl, i) => {
    const phoneStr = cl.phone ? ` — ${cl.phone}` : '';
    const daysStr  = cl.daysAbsent === 1 ? '1 дн.' : `${cl.daysAbsent} дн.`;
    const leftStr  = cl.contract.visitsLeft > 0
      ? `осталось ${cl.contract.visitsLeft} из ${cl.contract.visitsTotal}`
      : 'осталось ?';
    const endStr   = cl.contract.endDate ? `, абонемент до ${fmtShortDate(cl.contract.endDate)}` : '';
    return `${i + 1}. ${cl.sname}${phoneStr} — не был(а) ${daysStr}, ${leftStr}${endStr}`;
  });
  return `${intro}\n${lines.join('\n')}`;
}

// ── Stage logic ───────────────────────────────────────────────────────────────

function stage7Done(ep: Episode, dry: boolean): boolean {
  return ep.stage7_at != null && (dry || !ep.meta?.stage7_dry);
}

function stage10Done(ep: Episode, dry: boolean): boolean {
  return ep.stage10_at != null && (dry || !ep.meta?.stage10_dry);
}

function stage14Done(ep: Episode, dry: boolean): boolean {
  return ep.stage14_at != null && (dry || !ep.meta?.stage14_dry);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runInactive(): Promise<Record<string, unknown>> {
  const dry    = isDry('inactive');
  const today  = almatyDateStr();
  const nowIso = new Date().toISOString();
  const d1     = env.INACTIVE_DAYS_1;
  const d2     = env.INACTIVE_DAYS_2;
  const dOwner = env.INACTIVE_DAYS_OWNER;
  const respIds = getResponsibleIds();

  // Load supporting data in parallel
  const [allContracts, openEpisodes, frozenIds, cashierMap] = await Promise.all([
    paginateGet('/client-contract', { page_size: 100 }),
    supabase.from('inactive_episodes').select('*').is('closed_at', null)
      .then(({ data, error }) => {
        if (error) throw new Error(`[inactive] load episodes: ${error.message}`);
        return (data ?? []) as Episode[];
      }),
    loadFrozenIds(),
    loadCashierMap(),
  ]);

  // Group contracts by client_id
  const byClient = new Map<number, Record<string, unknown>[]>();
  for (const c of allContracts) {
    if (String(c.deleted_at ?? '').trim()) continue;
    const cid = Number((c.client as Record<string, unknown> | null | undefined)?.id ?? c.client_id ?? 0);
    if (!cid) continue;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid)!.push(c);
  }

  const episodeByClient = new Map(openEpisodes.map(ep => [ep.client_id, ep]));

  // ── 1. Check qualifying clients and find their reg data ───────────────────

  const qualified: ClientData[] = [];

  for (const [clientId, contracts] of byClient) {
    if (WATCH_EXCLUDE_CLIENT_IDS_SET.has(clientId)) continue;
    if (frozenIds.has(clientId)) continue;

    const contract = findActiveContract(contracts);
    if (!contract) continue;

    // Load regs (needed for visits + booking check)
    let regs: Record<string, unknown>[];
    try {
      const resp = await rawGet(`/schedule-registration?client_id=${clientId}`);
      regs = (resp.items ?? []) as Record<string, unknown>[];
    } catch {
      regs = [];
    }

    // Check close conditions for open episodes
    const ep = episodeByClient.get(clientId);
    if (ep) {
      const lastVisit  = findLastVisit(regs);
      const hasVisited = lastVisit > ep.episode_start; // visited after episode started
      const hasBooked  = hasFutureBooking(regs, today);
      const noContract = !contract; // already checked above but keep for clarity

      let closeReason: string | null = null;
      if (hasVisited)   closeReason = 'Пришёл на занятие';
      else if (hasBooked) closeReason = 'Записался';

      if (closeReason) {
        await supabase.from('inactive_episodes').update({ closed_at: nowIso, close_reason: closeReason }).eq('id', ep.id);
        episodeByClient.delete(clientId);
        continue; // episode closed; new cycle starts next day
      }
    }

    const lastVisit = findLastVisit(regs);
    // episode_start = last visit date, or activation_date, or begin_date
    const episodeStart = lastVisit || contract.activation || contract.beginDate || today;
    const absence = daysAgo(episodeStart);

    if (absence < d1) continue; // not inactive enough yet

    const { sname, phone, isTest } = await getClientDetail(clientId);
    if (isTest) continue;

    qualified.push({
      clientId,
      sname,
      phone,
      contract,
      lastVisit,
      episodeStart,
      daysAbsent: absence,
      cashierUserId: cashierMap.get(contract.id) ?? null,
    });
  }

  // Close episodes for clients with ended contracts (no longer in qualified set)
  for (const ep of openEpisodes) {
    if (!byClient.has(ep.client_id)) continue; // no contracts at all
    const contract = findActiveContract(byClient.get(ep.client_id)!);
    if (!contract && episodeByClient.has(ep.client_id)) {
      await supabase.from('inactive_episodes')
        .update({ closed_at: nowIso, close_reason: 'Абонемент закончился' })
        .eq('id', ep.id);
      episodeByClient.delete(ep.client_id);
    }
  }

  // ── 2. Assign/open episodes, collect by stage ────────────────────────────

  // Collect clients needing stage actions
  const stage7New  = new Map<string, ClientData[]>(); // key = cashierKey
  const stage10New: ClientData[] = [];
  const stage14New: ClientData[] = [];

  for (const cl of qualified) {
    let ep = episodeByClient.get(cl.clientId);

    // Open new episode if none exists
    if (!ep) {
      const metaVal = dry ? { stage7_dry: true } : null;
      const { data, error } = await supabase.from('inactive_episodes')
        .insert({ client_id: cl.clientId, episode_start: cl.episodeStart, meta: metaVal })
        .select('*')
        .single();
      if (error) {
        console.error(`[inactive] insert episode client=${cl.clientId}: ${error.message}`);
        continue;
      }
      ep = data as Episode;
      episodeByClient.set(cl.clientId, ep);
    }

    const abs = cl.daysAbsent;

    // Stage 14 first (highest priority)
    if (abs >= dOwner && !stage14Done(ep, dry)) {
      stage14New.push(cl);
      // Mark skipped earlier stages if never done
      const meta14 = { ...(ep.meta ?? {}), stage14_dry: dry };
      if (!ep.stage7_at)  Object.assign(meta14, { stage7_dry: true,  stage7_skipped: true  });
      if (!ep.stage10_at) Object.assign(meta14, { stage10_dry: true, stage10_skipped: true });
      await supabase.from('inactive_episodes').update({
        stage7_at:  ep.stage7_at  ?? nowIso,
        stage10_at: ep.stage10_at ?? nowIso,
        stage14_at: nowIso,
        meta: meta14,
      }).eq('id', ep.id);
      continue;
    }

    if (abs >= d2 && !stage10Done(ep, dry)) {
      stage10New.push(cl);
      // Also mark stage7 as skipped if never sent
      const meta10 = { ...(ep.meta ?? {}), stage10_dry: dry };
      if (!ep.stage7_at) Object.assign(meta10, { stage7_dry: true, stage7_skipped: true });
      await supabase.from('inactive_episodes').update({
        stage7_at:  ep.stage7_at ?? nowIso,
        stage10_at: nowIso,
        meta: meta10,
      }).eq('id', ep.id);
      continue;
    }

    if (abs >= d1 && !stage7Done(ep, dry)) {
      const cashierKey = (() => {
        const uid = cl.cashierUserId != null ? String(cl.cashierUserId) : '';
        return uid && respIds.includes(uid) ? uid : 'all';
      })();
      if (!stage7New.has(cashierKey)) stage7New.set(cashierKey, []);
      stage7New.get(cashierKey)!.push(cl);
    }
  }

  // ── 3. Create tasks (or DRY log) ──────────────────────────────────────────

  const deadline = todayDeadlineUnix();
  const stats = { stage7_tasks: 0, stage10_tasks: 0, stage14_events: 0 };

  // Stage 7 — one task per cashier group
  for (const [cashierKey, clients] of stage7New) {
    const recipients = cashierKey === 'all' ? respIds : [cashierKey];
    const desc       = buildDescription(7, clients);
    const meta7      = { stage: 7, clients: clients.map(c => ({ id: c.clientId, name: c.sname, days: c.daysAbsent })) };

    if (dry) {
      await logEvent({ job: JOB_NAME, type: 'task_created', text: `[DRY] Поставил бы задачу ${cashierKey === 'all' ? 'всем' : `менеджеру ${cashierKey}`}: ${clients.length} клиентов`, meta: { ...meta7, dry: true }, dry: true });
    } else {
      try {
        const taskId = await createStandaloneTask({ description: desc, available_to: deadline, responsible_ids: recipients, is_important: 1 });
        for (const cl of clients) {
          const ep = episodeByClient.get(cl.clientId)!;
          await supabase.from('inactive_episodes').update({
            stage7_at:         nowIso,
            stage7_task_id:    taskId,
            stage7_manager_id: cashierKey === 'all' ? null : Number(cashierKey),
            meta:              { ...(ep.meta ?? {}), stage7_dry: false },
          }).eq('id', ep.id);
        }
        await logEvent({ job: JOB_NAME, type: 'task_created', text: `Поставил задачу ${cashierKey === 'all' ? 'всем' : `менеджеру ${cashierKey}`}: ${clients.length} клиентов не ходят ${d1}+ дней`, meta: meta7, dry: false });
        stats.stage7_tasks++;
      } catch (e) {
        console.error(`[inactive] stage7 task error cashierKey=${cashierKey}: ${(e as Error).message}`);
      }
    }
    if (dry) stats.stage7_tasks++;
  }

  // Stage 10 — one task to all managers
  if (stage10New.length > 0) {
    const desc    = buildDescription(10, stage10New);
    const meta10  = { stage: 10, clients: stage10New.map(c => ({ id: c.clientId, name: c.sname, days: c.daysAbsent })) };

    if (dry) {
      await logEvent({ job: JOB_NAME, type: 'task_created', text: `[DRY] Поставил бы задачу всем: ${stage10New.length} клиентов (ступень 10)`, meta: { ...meta10, dry: true }, dry: true });
    } else {
      try {
        const taskId = await createStandaloneTask({ description: desc, available_to: deadline, responsible_ids: respIds, is_important: 1 });
        for (const cl of stage10New) {
          const ep = episodeByClient.get(cl.clientId)!;
          await supabase.from('inactive_episodes').update({
            stage10_task_id: taskId,
            meta:            { ...(ep.meta ?? {}), stage10_dry: false },
          }).eq('id', ep.id);
        }
        await logEvent({ job: JOB_NAME, type: 'task_created', text: `Поставил задачу всем: ${stage10New.length} клиентов не ходят ${d2}+ дней`, meta: meta10, dry: false });
        stats.stage10_tasks++;
      } catch (e) {
        console.error(`[inactive] stage10 task error: ${(e as Error).message}`);
      }
    }
    if (dry) stats.stage10_tasks++;
  }

  // Stage 14 — event only (email is handled in daily-summary)
  for (const cl of stage14New) {
    await logEvent({
      job: JOB_NAME,
      type: 'task_created',
      text: `${dry ? '[DRY] ' : ''}Не ходит ${cl.daysAbsent} дн. эскалация 14: ${cl.sname}`,
      short_name: cl.sname,
      meta: {
        stage: 14,
        client_id: cl.clientId,
        days: cl.daysAbsent,
        cashier_id: cl.cashierUserId,
        dry,
      },
      dry,
    });
    stats.stage14_events++;
  }

  console.log(`[inactive] dry=${dry} qualified=${qualified.length} stage7_tasks=${stats.stage7_tasks} stage10_tasks=${stats.stage10_tasks} stage14_events=${stats.stage14_events}`);
  return { dry, qualified: qualified.length, ...stats };
}
