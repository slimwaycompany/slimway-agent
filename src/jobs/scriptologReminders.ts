import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID, isTrialServiceName } from '../config';
import {
  getEasyChatToken, listDialogues, scheduleMessage, deleteDelayed, addComment,
  DRY, EasyDialogue,
} from '../core/easychat';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const JOB_NAME = 'scriptolog-reminders';

// next: add script_settings toggle for TRIAL_1H_ENABLED
const TRIAL_1H_ENABLED = false; void TRIAL_1H_ENABLED;

const YEK = 5 * 3600;

function yekHour(ts: number): number { return Math.floor((ts + YEK) / 3600) % 24; }

function yekDate(ts: number): string {
  const d = new Date((ts + YEK) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function visitTimeKey(visitAt: number): string {
  const d = new Date((visitAt + YEK) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const pp = (n: number) => String(n).padStart(4, '0');
  return `${pp(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

type Lang = 'ru' | 'kk';
type ReminderKind = 'trial_24h' | 'trial_3h';

const KINDS: { kind: ReminderKind; offsetSec: number }[] = [
  { kind: 'trial_24h', offsetSec: 86400 },
  { kind: 'trial_3h',  offsetSec: 10800 },
];

// Part 3: no-name templates only
const T = {
  trial_24h: {
    ru: 'Здравствуйте! 🌸 Напоминаем, завтра в {Время} ждём Вас на пробное посещение в SlimWay 💚 🎁 И не забудьте: замер InBody — Вам в подарок!',
    kk: 'Сәлеметсіз бе! 🌸 Еске саламыз, ертең {Время} SlimWay-де сынақ сабағына күтеміз 💚 🎁 Ұмытпаңыз: InBody өлшеуі — Сізге сыйлық!',
  },
  trial_3h: {
    ru: 'Здравствуйте! Через 3 часа начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸',
    kk: 'Сәлеметсіз бе! 3 сағаттан кейін сынақ сабағыңыз басталады. Растау үшін бізге «+» жіберіңізші 👇🏻🌸',
  },
  trial_3h_eve: {
    ru: 'Здравствуйте! Завтра в {Время} начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸',
    kk: 'Сәлеметсіз бе! Ертең {Время} сынақ сабағыңыз басталады. Растау үшін бізге «+» жіберіңізші 👇🏻🌸',
  },
};

const KZ_RE = /[әғқңөұүһі]/i;

function fillText(tmpl: string, vars: { Время: string }): string {
  return tmpl.replace(/\{Время\}/g, vars.Время);
}

function detectLang(dialogue: EasyDialogue): Lang {
  const haystack = [
    dialogue.name ?? '',
    dialogue.last_message?.operator_id === null ? (dialogue.last_message?.message ?? '') : '',
  ].join(' ');
  return KZ_RE.test(haystack) ? 'kk' : 'ru';
}

function compute3hSendAt(visitAt: number, nowTs: number): { sendAt: number; isEvening: boolean } | null {
  const raw = visitAt - 10800;
  const h = yekHour(raw);
  if (h >= 7 && h < 22) {
    if (raw <= nowTs) return null;
    return { sendAt: raw, isEvening: false };
  }
  const rawYekDay = raw + YEK;
  const rawYekMidnight = rawYekDay - (rawYekDay % 86400);
  let eve2100 = rawYekMidnight + (21 - 5) * 3600;
  if (eve2100 >= raw) eve2100 -= 86400;
  if (eve2100 <= nowTs) {
    if (visitAt - nowTs > 3600) return { sendAt: nowTs + 60, isEvening: true };
    return null;
  }
  return { sendAt: eve2100, isEvening: true };
}

const CONSENT_RE = /^\s*(\+|да|ок|окей|приду|буду|хорошо|помню|иду|yes|иә|ия|келемін|барамын|жарайды)\s*$/i;
// Part 4: specific refusal phrases only — loose "нет" excluded
const REFUSAL_RE = /не приду|не смогу|отмен|перенес|заболел|не получится|келе алмаймын/i;

interface Decision {
  id: string;
  date_time: string;
  status: number;
  is_trial: boolean;
  client_id: number | null;
  has_dialogue: boolean;
  decision: string;
  reason: string;
}

function checkTrial(v: Record<string, unknown>): boolean {
  const event    = v.event    as Record<string, unknown> | null;
  const training = event?.training as Record<string, unknown> | null;
  const csRaw    = v.client_service  as Record<string, unknown> | string | null;
  const ccRaw    = v.client_contract as Record<string, unknown> | string | null;
  const nameOf   = (raw: typeof csRaw) => typeof raw === 'string' ? raw : raw != null ? (raw as Record<string, unknown>).name as string : null;
  const abonement = nameOf(csRaw) ?? nameOf(ccRaw) ?? null;
  return training?.id === TRIAL_TRAINING_ID || isTrialServiceName(training?.name as string | null) || isTrialServiceName(abonement);
}

export async function runScriptologReminders(): Promise<Record<string, unknown>> {
  const nowTs = Math.floor(Date.now() / 1000);
  const h = yekHour(nowTs);
  if (h < 7 || h >= 22) return { status: 'skipped', reason: 'outside 07-22 YEK' };

  const dry = DRY();

  const token = await getEasyChatToken();
  if (!token) return { status: 'skipped', reason: 'no easychat_token in script_settings' };

  // Cleanup dangling pending rows (created in DRY, no real delayed_id)
  await supabase.from('script_reminders')
    .delete()
    .eq('status', 'pending')
    .is('easychat_delayed_id', null);

  // ── Load dialogues: up to 40 pages, stop if last_message older than 90 days ──
  const dialogueMap = new Map<number, EasyDialogue>();
  const cutoff90 = nowTs - 90 * 86400;
  try {
    for (let page = 1; page <= 40; page++) {
      const rows = await listDialogues(token, page, 50);
      if (!rows.length) break;
      for (const d of rows) {
        if (d.crm_client_id != null) dialogueMap.set(d.crm_client_id, d);
      }
      if (rows.length < 50) break;
      const lastMsgAt = rows[rows.length - 1]?.last_message?.created_at;
      if (lastMsgAt && new Date(lastMsgAt).getTime() / 1000 < cutoff90) break;
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('auth error 401') || msg.includes('auth error 403')) {
      await upsertTokenAlert(nowTs);
      return { status: 'error', reason: 'EasyChat token invalid' };
    }
    console.error(`[${JOB_NAME}] listDialogues failed: ${msg}`);
    return { status: 'error', reason: msg };
  }

  // ── Fetch Fitbase visits ──────────────────────────────────────────────────
  const dateFrom = yekDate(nowTs);
  const dateTo   = yekDate(nowTs + 2 * 86400);
  let fitbaseVisits: Record<string, unknown>[] = [];
  try {
    fitbaseVisits = await paginateGet(
      '/schedule-registration',
      { date_from: dateFrom, date_to: dateTo, page_size: 100 },
      JOB_NAME,
    );
  } catch (e) {
    if (!/→ 400 /.test((e as Error).message)) {
      console.error(`[${JOB_NAME}] Fitbase /schedule-registration failed: ${e}`);
      return { status: 'error', reason: String(e) };
    }
    // 400: split into daily windows (mirrors syncVisits fallback)
    const seen = new Set<string>();
    let cur = nowTs;
    const end = nowTs + 2 * 86400;
    while (cur < end) {
      const wFrom = yekDate(cur);
      const wTo   = yekDate(Math.min(cur + 86400, end));
      try {
        const chunk = await paginateGet('/schedule-registration', { date_from: wFrom, date_to: wTo, page_size: 100 }, JOB_NAME);
        for (const item of chunk) {
          const id = String((item as Record<string, unknown>).id);
          if (!seen.has(id)) { seen.add(id); fitbaseVisits.push(item); }
        }
      } catch (e2) { console.error(`[${JOB_NAME}] window ${wFrom}→${wTo}: ${e2}`); }
      cur += 86400;
      await sleep(400);
    }
  }

  if (fitbaseVisits.length > 0) {
    const s = fitbaseVisits[0] as Record<string, unknown>;
    const ev = s.event as Record<string, unknown> | null;
    console.log(`[${JOB_NAME}] sample: id=${s.id} status=${s.status} client_id=${s.client_id} date=${ev?.date} time=${ev?.time_start} training.id=${(ev?.training as Record<string,unknown>|null)?.id}`);
  }

  // ── Load script_clients ───────────────────────────────────────────────────
  const { data: scriptClients } = await supabase
    .from('script_clients')
    .select('id, client_key, vars, fitbase_client_id')
    .not('fitbase_client_id', 'is', null);
  const clientByFbId = new Map<number, { id: string; client_key: string; vars: Record<string, string> }>();
  for (const sc of (scriptClients ?? [])) {
    if (sc.fitbase_client_id != null) {
      clientByFbId.set(Number(sc.fitbase_client_id), {
        id: String(sc.id),
        client_key: String(sc.client_key),
        vars: (sc.vars as Record<string, string>) ?? {},
      });
    }
  }

  // ── Load fitbase_clients_cache for names in alerts ────────────────────────
  const fbClientIds = fitbaseVisits
    .map(v => (v as Record<string, unknown>).client_id)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const cacheMap = new Map<number, string>();
  if (fbClientIds.length) {
    const { data: cc } = await supabase
      .from('fitbase_clients_cache')
      .select('fitbase_client_id, name')
      .in('fitbase_client_id', fbClientIds);
    for (const c of (cc ?? [])) {
      if (c.name) cacheMap.set(Number(c.fitbase_client_id), String(c.name));
    }
  }

  // ── Load existing scheduled reminders ────────────────────────────────────
  const { data: existingRows } = await supabase
    .from('script_reminders')
    .select('id, dedupe_key, status, easychat_delayed_id, easychat_dialogue_id, fitbase_visit_id')
    .in('status', ['scheduled', 'sent'])
    .gt('send_at', new Date(nowTs * 1000).toISOString());

  const scheduledMap = new Map<string, { id: string; easychat_delayed_id: number | null; easychat_dialogue_id: number | null }>();
  const scheduledByVisit = new Map<string, { id: string; dedupeKey: string; easychat_delayed_id: number | null; easychat_dialogue_id: number | null }[]>();
  for (const r of (existingRows ?? [])) {
    const key = String(r.dedupe_key);
    scheduledMap.set(key, {
      id: String(r.id),
      easychat_delayed_id: r.easychat_delayed_id as number | null,
      easychat_dialogue_id: r.easychat_dialogue_id as number | null,
    });
    const vid = String(r.fitbase_visit_id ?? '');
    if (vid) {
      if (!scheduledByVisit.has(vid)) scheduledByVisit.set(vid, []);
      scheduledByVisit.get(vid)!.push({
        id: String(r.id),
        dedupeKey: key,
        easychat_delayed_id: r.easychat_delayed_id as number | null,
        easychat_dialogue_id: r.easychat_dialogue_id as number | null,
      });
    }
  }

  const stats = { scheduled: 0, cancelled: 0, failed: 0, skipped: 0 };
  const planned: { kind: string; send_at: string; lang: string }[] = [];
  const decisions: Decision[] = [];
  const expectedKeys = new Set<string>();
  let trialCount = 0;

  for (const visit of fitbaseVisits) {
    const v = visit as Record<string, unknown>;
    const visitId = String(v.id ?? '');
    const fbStatus = Number(v.status ?? -1);
    const event    = v.event as Record<string, unknown> | null;
    const dateStr  = event?.date as string | null;
    const timeRaw  = event?.time_start as string | null;
    const timeStr  = timeRaw ? String(timeRaw).slice(0, 5) : '';
    const clientFbId = v.client_id != null ? Number(v.client_id) : null;
    const dateTime = `${dateStr ?? '?'} ${timeStr}`.trim();

    // Part 1: decisions for ALL records (before trial filter)
    if (!checkTrial(v)) {
      decisions.push({ id: visitId, date_time: dateTime, status: fbStatus, is_trial: false, client_id: clientFbId, has_dialogue: false, decision: 'skip', reason: 'не пробная' });
      continue;
    }
    trialCount++;

    if (!visitId) {
      decisions.push({ id: '?', date_time: dateTime, status: fbStatus, is_trial: true, client_id: clientFbId, has_dialogue: false, decision: 'skip', reason: 'нет id' });
      continue;
    }
    if (!dateStr || !clientFbId) {
      decisions.push({ id: visitId, date_time: dateTime, status: fbStatus, is_trial: true, client_id: clientFbId, has_dialogue: false, decision: 'skip', reason: !dateStr ? 'нет даты' : 'нет client_id' });
      continue;
    }

    let visitAt: number;
    try {
      const dtStr = timeStr ? `${dateStr}T${timeStr}:00+05:00` : `${dateStr}T09:00:00+05:00`;
      visitAt = Math.floor(new Date(dtStr).getTime() / 1000);
    } catch {
      decisions.push({ id: visitId, date_time: dateTime, status: fbStatus, is_trial: true, client_id: clientFbId, has_dialogue: false, decision: 'skip', reason: 'ошибка даты' });
      continue;
    }

    const dialogue = dialogueMap.get(clientFbId) ?? null;

    for (const { kind } of KINDS) {
      expectedKeys.add(`${kind}:${visitId}:${visitTimeKey(visitAt)}`);
    }

    const terminal = fbStatus === 1 || fbStatus === 2 || fbStatus === 3 || fbStatus === 4;
    if (terminal) {
      const rows = scheduledByVisit.get(visitId) ?? [];
      for (const row of rows) {
        if (row.easychat_delayed_id && dialogue) {
          try { await deleteDelayed(token, row.easychat_delayed_id); } catch { /* noop */ }
        }
        await supabase.from('script_reminders').update({ status: 'cancelled' }).eq('id', row.id);
        stats.cancelled++;
      }
      decisions.push({ id: visitId, date_time: dateTime, status: fbStatus, is_trial: true, client_id: clientFbId, has_dialogue: dialogue !== null, decision: 'cancel', reason: `статус ${fbStatus}` });
      continue;
    }

    // ── Auto-confirm / auto-refusal check ────────────────────────────────
    if (dialogue?.last_message?.operator_id === null && dialogue.last_message.message) {
      const msgText = dialogue.last_message.message.trim();
      const msgAt   = dialogue.last_message.created_at;
      const visitCreatedAt = v.created_at as string | null;
      // Part 4: consent/refusal only if message came AFTER the registration was created
      const msgIsNew = !visitCreatedAt || !msgAt || new Date(msgAt) > new Date(visitCreatedAt);
      const CONFIRM_DRY = (process.env.SCRIPTOLOG_CONFIRM_DRY_RUN ?? 'true') === 'true';
      const alertName = cacheMap.get(clientFbId) ?? `клиент #${clientFbId}`;

      if (msgIsNew && CONSENT_RE.test(msgText)) {
        // Part 4: write confirm alert + comment only once per record
        const { data: existConfirm } = await supabase
          .from('watch_alerts').select('id')
          .eq('alert_key', `SCRIPT_CONFIRM:${visitId}`)
          .maybeSingle();
        if (!existConfirm) {
          if (CONFIRM_DRY) {
            console.log(`[${JOB_NAME}] CONFIRM DRY: ${alertName} visit=${visitId} replied "${msgText}"`);
          } else {
            await supabase.from('watch_alerts').upsert({
              alert_key: `SCRIPT_CONFIRM:${visitId}`,
              rule: 'SCRIPT_CONFIRM', level: 'info',
              short_name: alertName,
              title: 'Подтвердила пробное',
              body: `${alertName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
              meta: { fitbase_visit_id: visitId },
            }, { onConflict: 'alert_key', ignoreDuplicates: true });
            await addComment(token, dialogue.dialogue_id, `[СКРИПТОЛОГ] ✅ Подтвердила пробное на ${dateStr} ${timeStr}`)
              .catch(e => console.error(`[${JOB_NAME}] addComment: ${e}`));
          }
        }
      } else if (msgIsNew && REFUSAL_RE.test(msgText) && !CONFIRM_DRY) {
        await supabase.from('watch_alerts').upsert({
          alert_key: `SCRIPT_CANCEL:${visitId}`,
          rule: 'SCRIPT_CANCEL', level: 'warn',
          short_name: alertName,
          title: 'Отменила пробное',
          body: `${alertName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
          meta: { fitbase_visit_id: visitId },
        }, { onConflict: 'alert_key', ignoreDuplicates: true });
      }
    }

    // ── No dialogue: failed row + alert ──────────────────────────────────
    if (!dialogue) {
      const { data: existFailed } = await supabase
        .from('script_reminders').select('id')
        .eq('fitbase_visit_id', visitId)
        .eq('status', 'failed')
        .maybeSingle();
      if (!existFailed) {
        const alertName = cacheMap.get(clientFbId) ?? `клиент #${clientFbId}`;
        await supabase.from('script_reminders').insert({
          client_key: `fitbase:${clientFbId}`,
          kind: 'trial_24h',
          status: 'failed',
          error: 'нет диалога',
          dedupe_key: `trial_24h:${visitId}:no_dial`,
          fitbase_visit_id: visitId,
          due_at:  new Date(visitAt * 1000).toISOString(),
          send_at: new Date(visitAt * 1000).toISOString(),
          message_text: '',
        });
        await supabase.from('watch_alerts').upsert({
          alert_key: `SCRIPT_NO_DIAL:${visitId}`,
          rule: 'SCRIPT_NO_DIAL', level: 'important',
          short_name: alertName,
          title: 'Нет чата для напоминания',
          body: `Не нашёл чат ${alertName} — напомните о пробном ${dateStr} ${timeStr} вручную`,
          meta: { fitbase_visit_id: visitId },
        }, { onConflict: 'alert_key', ignoreDuplicates: true });
        stats.failed++;
      }
      decisions.push({ id: visitId, date_time: dateTime, status: fbStatus, is_trial: true, client_id: clientFbId, has_dialogue: false, decision: 'failed', reason: 'нет чата' });
      continue;
    }

    const sc = clientByFbId.get(clientFbId);
    const vars = sc?.vars ?? {};
    const lang = (vars['lang'] as Lang | undefined) ?? detectLang(dialogue);

    // ── Schedule reminders ────────────────────────────────────────────────
    const kindReasons: string[] = [];

    for (const { kind, offsetSec } of KINDS) {
      const dedupeKey = `${kind}:${visitId}:${visitTimeKey(visitAt)}`;

      if (scheduledMap.has(dedupeKey)) {
        kindReasons.push(`${kind}: уже стоит`);
        stats.skipped++;
        continue;
      }

      let sendAt: number;
      let isEvening = false;
      let msgText: string;

      if (kind === 'trial_24h') {
        sendAt = visitAt - offsetSec;
        if (sendAt <= nowTs) {
          kindReasons.push(`${kind}: 24ч прошло`);
          stats.skipped++;
          continue;
        }
        msgText = fillText(T.trial_24h[lang], { Время: timeStr });
      } else {
        const r3h = compute3hSendAt(visitAt, nowTs);
        if (!r3h) {
          kindReasons.push(`${kind}: 3ч не помещается`);
          stats.skipped++;
          continue;
        }
        sendAt = r3h.sendAt;
        isEvening = r3h.isEvening;
        msgText = fillText(
          isEvening ? T.trial_3h_eve[lang] : T.trial_3h[lang],
          { Время: timeStr },
        );
      }

      if (sendAt >= visitAt) {
        kindReasons.push(`${kind}: sendAt >= visitAt`);
        stats.skipped++;
        continue;
      }

      const sendAtIso = new Date(sendAt * 1000).toISOString();
      kindReasons.push(`${kind}: запланировано на ${sendAtIso}`);
      planned.push({ kind, send_at: sendAtIso, lang });

      if (dry) continue;

      let delayedId = 0;
      try {
        delayedId = await scheduleMessage(token, dialogue.dialogue_id, msgText, sendAt);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('auth error 401') || msg.includes('auth error 403')) {
          await upsertTokenAlert(nowTs);
          return { status: 'error', reason: 'EasyChat token invalid', ...stats, planned, dry, decisions };
        }
        console.error(`[${JOB_NAME}] scheduleMessage ${kind} visit=${visitId}: ${msg}`);
        stats.skipped++;
        continue;
      }

      const row: Record<string, unknown> = {
        client_key: sc?.client_key ?? `fitbase:${clientFbId}`,
        kind,
        status: 'scheduled',
        lang,
        dedupe_key: dedupeKey,
        due_at:  sendAtIso,
        send_at: sendAtIso,
        message_text: msgText,
        fitbase_visit_id: visitId,
        easychat_delayed_id: delayedId || null,
        easychat_dialogue_id: dialogue.dialogue_id,
      };

      const { error } = await supabase.from('script_reminders').insert(row);
      if (error) {
        console.error(`[${JOB_NAME}] insert ${kind} visit=${visitId}: ${error.message}`);
        stats.skipped++;
      } else {
        stats.scheduled++;
      }
    }

    decisions.push({
      id: visitId, date_time: dateTime, status: fbStatus, is_trial: true,
      client_id: clientFbId, has_dialogue: true,
      decision: kindReasons.some(r => r.includes('запланировано')) ? 'schedule' : 'skip',
      reason: kindReasons.join('; '),
    });
  }

  // ── Cancel orphan scheduled rows (visit gone or time changed) ─────────────
  for (const [dedupeKey, row] of scheduledMap) {
    if (expectedKeys.has(dedupeKey)) continue;
    if (row.easychat_delayed_id && row.easychat_dialogue_id != null) {
      try { await deleteDelayed(token, row.easychat_delayed_id); } catch { /* noop */ }
    }
    await supabase.from('script_reminders').update({ status: 'cancelled' }).eq('id', row.id);
    stats.cancelled++;
  }

  return {
    trialVisits: trialCount,
    planned,
    decisions,
    scheduled: stats.scheduled,
    cancelled: stats.cancelled,
    failed: stats.failed,
    skipped: stats.skipped,
    dry,
    dialogues: dialogueMap.size,
  };
}

async function upsertTokenAlert(nowTs: number): Promise<void> {
  const today = yekDate(nowTs);
  await supabase.from('watch_alerts').upsert({
    alert_key: `SCRIPT_TOKEN_ERR:${today}`,
    rule: 'SCRIPT_TOKEN', level: 'urgent',
    title: 'Токен EasyChat устарел',
    body: 'Токен EasyChat устарел. Откройте ФитБейс Чат в браузере с расширением Скриптолог',
    meta: { date: today },
  }, { onConflict: 'alert_key', ignoreDuplicates: true });
}
