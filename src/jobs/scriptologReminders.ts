import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID, isTrialServiceName } from '../config';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
import {
  getEasyChatToken, listDialogues, scheduleMessage, deleteDelayed, addComment,
  DRY, EasyDialogue,
} from '../core/easychat';

export const JOB_NAME = 'scriptolog-reminders';

// next: add script_settings toggle for TRIAL_1H_ENABLED
const TRIAL_1H_ENABLED = false;

const YEK = 5 * 3600; // UTC+5 offset in seconds

function yekHour(ts: number): number {
  return Math.floor((ts + YEK) / 3600) % 24;
}

function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function yekDate(ts: number): string {
  const d = new Date((ts + YEK) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Format visit time as YYYYMMDDHHmm (YEK) for dedupe_key
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

// All text templates. {Имя} and {Время} are substituted in fillText().
const T = {
  trial_24h: {
    ru:  'Здравствуйте, {Имя}! 🌸 Напоминаем, завтра в {Время} ждём Вас на пробное посещение в SlimWay 💚 🎁 И не забудьте: замер InBody — Вам в подарок!',
    kk:  'Сәлеметсіз бе, {Имя}! 🌸 Еске саламыз, ертең {Время} SlimWay-де сынақ сабағына күтеміз 💚 🎁 Ұмытпаңыз: InBody өлшеуі — Сізге сыйлық!',
    ru0: 'Здравствуйте! 🌸 Напоминаем, завтра в {Время} ждём Вас на пробное посещение в SlimWay 💚 🎁 И не забудьте: замер InBody — Вам в подарок!',
    kk0: 'Сәлеметсіз бе! 🌸 Еске саламыз, ертең {Время} SlimWay-де сынақ сабағына күтеміз 💚 🎁 Ұмытпаңыз: InBody өлшеуі — Сізге сыйлық!',
  },
  trial_3h: {
    ru:  'Здравствуйте! Через 3 часа начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸',
    kk:  'Сәлеметсіз бе! 3 сағаттан кейін сынақ сабағыңыз басталады. Растау үшін бізге «+» жіберіңізші 👇🏻🌸',
  },
  trial_3h_eve: {
    ru:  'Здравствуйте! Завтра в {Время} начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸',
    kk:  'Сәлеметсіз бе! Ертең {Время} сынақ сабағыңыз басталады. Растау үшін бізге «+» жіберіңізші 👇🏻🌸',
  },
};

// KZ alphabet markers
const KZ_RE = /[әғқңөұүһі]/i;

function fillText(tmpl: string, vars: { Имя?: string; Время: string }): string {
  return tmpl.replace(/\{Имя\}/g, vars.Имя ?? '').replace(/\{Время\}/g, vars.Время);
}

// Detect KZ language from dialogue name + last incoming message
function detectLang(dialogue: EasyDialogue): Lang {
  const haystack = [
    dialogue.name ?? '',
    dialogue.last_message?.operator_id === null ? (dialogue.last_message?.message ?? '') : '',
  ].join(' ');
  return KZ_RE.test(haystack) ? 'kk' : 'ru';
}

// Compute trial_3h send_at with evening-shift for night window (22:00–07:00 YEK)
// Returns { sendAt, isEvening } where isEvening=true means we use trial_3h_eve text
function compute3hSendAt(visitAt: number, nowTs: number): { sendAt: number; isEvening: boolean } | null {
  const raw = visitAt - 10800; // visitAt − 3h
  const h = yekHour(raw);
  if (h >= 7 && h < 22) {
    // Normal window
    if (raw <= nowTs) return null; // already past
    return { sendAt: raw, isEvening: false };
  }
  // Falls in night — shift to 21:00 previous evening (YEK)
  // Find start of the YEK day that contains raw
  const rawYekDay = raw + YEK;
  const rawYekMidnight = rawYekDay - (rawYekDay % 86400); // midnight UTC that is day-start in YEK
  // 21:00 YEK = 16:00 UTC of that same day
  let eve2100 = rawYekMidnight + (21 - 5) * 3600; // 21:00 YEK as UTC
  if (eve2100 >= raw) {
    // raw is before 21:00 → use previous day's 21:00
    eve2100 -= 86400;
  }
  if (eve2100 <= nowTs) {
    // 21:00 already passed → send ASAP if more than 1h before visit
    if (visitAt - nowTs > 3600) return { sendAt: nowTs + 60, isEvening: true };
    return null;
  }
  return { sendAt: eve2100, isEvening: true };
}

// Consent keywords for auto-confirm (unchanged from original)
const CONSENT_RE = /^\s*(\+|да|ок|окей|приду|буду|хорошо|помню|иду|yes|иә|ия|келемін|барамын|жарайды)\s*$/i;
const REFUSAL_RE = /\bнет\b|не приду|отменить|отмена|жоқ|кела алмаймын/i;

export async function runScriptologReminders(): Promise<Record<string, unknown>> {
  const nowTs = Math.floor(Date.now() / 1000);

  // Work only within 07:00–22:00 YEK
  const h = yekHour(nowTs);
  if (h < 7 || h >= 22) return { status: 'skipped', reason: 'outside 07-22 YEK' };

  const dry = DRY();

  // ── Get EasyChat token ──────────────────────────────────────────────────────
  const token = await getEasyChatToken();
  if (!token) return { status: 'skipped', reason: 'no easychat_token in script_settings' };

  // ── One-time cleanup: pending rows created in DRY (no real easychat_delayed_id) ──
  await supabase.from('script_reminders')
    .delete()
    .eq('status', 'pending')
    .is('easychat_delayed_id', null);

  // ── Load all EasyChat dialogues ─────────────────────────────────────────────
  const dialogueMap = new Map<number, EasyDialogue>();
  try {
    for (let page = 1; page <= 10; page++) {
      const rows = await listDialogues(token, page, 50);
      if (!rows.length) break;
      for (const d of rows) {
        if (d.crm_client_id != null) dialogueMap.set(d.crm_client_id, d);
      }
      if (rows.length < 50) break;
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

  // ── Fetch upcoming trial visits from Fitbase /schedule-registration ─────────
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
  // Debug: log first record shape to verify field names
  if (fitbaseVisits.length > 0) {
    const s = fitbaseVisits[0] as Record<string, unknown>;
    const ev = s.event as Record<string, unknown> | null;
    console.log(`[${JOB_NAME}] sample: id=${s.id} status=${s.status} client_id=${s.client_id} date=${ev?.date} time=${ev?.time_start} training.id=${(ev?.training as Record<string,unknown>|null)?.id}`);
  }

  const trialVisits = fitbaseVisits.filter(v => {
    const event    = v.event    as Record<string, unknown> | null;
    const training = event?.training as Record<string, unknown> | null;
    const csRaw    = v.client_service  as Record<string, unknown> | string | null;
    const ccRaw    = v.client_contract as Record<string, unknown> | string | null;
    const nameOf   = (raw: typeof csRaw) => typeof raw === 'string' ? raw : raw != null ? (raw as Record<string, unknown>).name as string : null;
    const abonement = nameOf(csRaw) ?? nameOf(ccRaw) ?? null;
    return training?.id === TRIAL_TRAINING_ID || isTrialServiceName(training?.name as string | null) || isTrialServiceName(abonement);
  });

  // ── Load script_clients (name + lang from vars) ─────────────────────────────
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

  // ── Load fitbase_clients_cache for name fallback ────────────────────────────
  const fbClientIds = trialVisits
    .map(v => (v as Record<string, unknown>).client_id)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  const cacheMap = new Map<number, string>();
  if (fbClientIds.length) {
    const { data: cc } = await supabase
      .from('fitbase_clients_cache')
      .select('fitbase_client_id,name')
      .in('fitbase_client_id', fbClientIds);
    for (const c of (cc ?? [])) {
      if (c.name) cacheMap.set(Number(c.fitbase_client_id), String(c.name));
    }
  }

  // ── Load existing scheduled reminders (future send_at) for dedup + orphan check ──
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
  const planned: { name: string; kind: string; send_at: string; lang: string; has_dialogue: boolean }[] = [];

  // Build expected dedupe keys for all current visits (to detect orphans)
  const expectedKeys = new Set<string>();

  for (const visit of trialVisits) {
    const v = visit as Record<string, unknown>;
    const visitId = String(v.id ?? '');
    if (!visitId) continue;

    const fbStatus = Number(v.status ?? -1);
    const event    = v.event as Record<string, unknown> | null;
    const dateStr  = event?.date as string | null;
    const timeRaw  = event?.time_start as string | null;
    const timeStr  = timeRaw ? String(timeRaw).slice(0, 5) : '';
    const clientFbId = v.client_id != null ? Number(v.client_id) : null;

    if (!dateStr || !clientFbId) continue;

    let visitAt: number;
    try {
      const dtStr = timeStr ? `${dateStr}T${timeStr}:00+05:00` : `${dateStr}T09:00:00+05:00`;
      visitAt = Math.floor(new Date(dtStr).getTime() / 1000);
    } catch { continue; }

    const dialogue = dialogueMap.get(clientFbId) ?? null;

    // Build expected keys for this visit (regardless of status, to detect orphans)
    for (const { kind } of KINDS) {
      expectedKeys.add(`${kind}:${visitId}:${visitTimeKey(visitAt)}`);
    }

    // ── Cancel all scheduled reminders for confirmed/refused/completed visits ──
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
      continue; // no new reminders for this visit
    }

    // ── Auto-confirm / auto-refusal check ──────────────────────────────────
    if (dialogue?.last_message?.operator_id === null && dialogue.last_message.message) {
      const msgText = dialogue.last_message.message.trim();
      const clientName = resolveClientName(clientFbId, clientByFbId, cacheMap, dialogue);
      const CONFIRM_DRY = (process.env.SCRIPTOLOG_CONFIRM_DRY_RUN ?? 'true') === 'true';

      if (CONSENT_RE.test(msgText)) {
        if (CONFIRM_DRY) {
          console.log(`[${JOB_NAME}] CONFIRM DRY: ${clientName} visit=${visitId} replied "${msgText}"`);
        } else {
          await supabase.from('watch_alerts').upsert({
            alert_key: `SCRIPT_CONFIRM:${visitId}`,
            rule: 'SCRIPT_CONFIRM', level: 'info',
            short_name: clientName,
            title: 'Подтвердила пробное',
            body: `${clientName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
            meta: { fitbase_visit_id: visitId },
          }, { onConflict: 'alert_key', ignoreDuplicates: true });
        }
        await addComment(token, dialogue.dialogue_id, `[СКРИПТОЛОГ] ✅ Подтвердила пробное на ${dateStr} ${timeStr}`)
          .catch(e => console.error(`[${JOB_NAME}] addComment: ${e}`));
      } else if (REFUSAL_RE.test(msgText) && !CONFIRM_DRY) {
        await supabase.from('watch_alerts').upsert({
          alert_key: `SCRIPT_CANCEL:${visitId}`,
          rule: 'SCRIPT_CANCEL', level: 'warn',
          short_name: clientName,
          title: 'Отменила пробное',
          body: `${clientName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
          meta: { fitbase_visit_id: visitId },
        }, { onConflict: 'alert_key', ignoreDuplicates: true });
      }
    }

    // ── Schedule reminders ──────────────────────────────────────────────────
    if (!dialogue) {
      // Create failed reminder and alert if not already done
      const hasFailedRow = (scheduledByVisit.get(visitId) ?? []).length === 0;
      const { data: existFailed } = await supabase
        .from('script_reminders')
        .select('id')
        .eq('fitbase_visit_id', visitId)
        .eq('status', 'failed')
        .maybeSingle();
      if (!existFailed) {
        const clientName = resolveClientName(clientFbId, clientByFbId, cacheMap, null);
        const dedupeKey = `trial_24h:${visitId}:no_dial`;
        await supabase.from('script_reminders').insert({
          client_key: `fitbase:${clientFbId}`,
          kind: 'trial_24h',
          status: 'failed',
          error: 'нет диалога',
          dedupe_key: dedupeKey,
          fitbase_visit_id: visitId,
          due_at: new Date(visitAt * 1000).toISOString(),
          send_at: new Date(visitAt * 1000).toISOString(),
          message_text: '',
        });
        await supabase.from('watch_alerts').upsert({
          alert_key: `SCRIPT_NO_DIAL:${visitId}`,
          rule: 'SCRIPT_NO_DIAL', level: 'important',
          short_name: clientName,
          title: 'Нет чата для напоминания',
          body: `Не нашёл чат ${clientName} — напомните о пробном ${dateStr} ${timeStr} вручную`,
          meta: { fitbase_visit_id: visitId },
        }, { onConflict: 'alert_key', ignoreDuplicates: true });
        stats.failed++;
      }
      void hasFailedRow;
      continue;
    }

    const sc = clientByFbId.get(clientFbId);
    const vars = sc?.vars ?? {};
    const lang = (vars['lang'] as Lang | undefined) ?? detectLang(dialogue);
    const clientName = resolveClientName(clientFbId, clientByFbId, cacheMap, dialogue);

    for (const { kind, offsetSec } of KINDS) {
      const dedupeKey = `${kind}:${visitId}:${visitTimeKey(visitAt)}`;

      // Dedup: skip if already scheduled or sent
      if (scheduledMap.has(dedupeKey)) { stats.skipped++; continue; }

      // Compute send_at
      let sendAt: number;
      let isEvening = false;
      let msgText: string;

      if (kind === 'trial_24h') {
        sendAt = visitAt - offsetSec;
        if (sendAt <= nowTs) { stats.skipped++; continue; } // 24h window already passed
        const tmpl = clientName ? T.trial_24h[lang] : T.trial_24h[`${lang}0` as keyof typeof T.trial_24h];
        msgText = fillText(tmpl, { Имя: clientName ?? undefined, Время: timeStr });
      } else {
        // trial_3h
        const r3h = compute3hSendAt(visitAt, nowTs);
        if (!r3h) { stats.skipped++; continue; }
        sendAt = r3h.sendAt;
        isEvening = r3h.isEvening;
        msgText = fillText(
          isEvening ? T.trial_3h_eve[lang] : T.trial_3h[lang],
          { Время: timeStr },
        );
      }

      // Never send after visit time
      if (sendAt >= visitAt) { stats.skipped++; continue; }

      planned.push({ name: clientName ?? '(нет имени)', kind, send_at: new Date(sendAt * 1000).toISOString(), lang, has_dialogue: true });

      if (dry) continue; // DRY: collect plan, don't write

      let delayedId = 0;
      try {
        delayedId = await scheduleMessage(token, dialogue.dialogue_id, msgText, sendAt);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('auth error 401') || msg.includes('auth error 403')) {
          await upsertTokenAlert(nowTs);
          return { status: 'error', reason: 'EasyChat token invalid', ...stats, planned, dry };
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
        due_at:  new Date(sendAt * 1000).toISOString(),
        send_at: new Date(sendAt * 1000).toISOString(),
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
  }

  // ── Cancel orphan scheduled rows (visit gone or time changed) ───────────────
  for (const [dedupeKey, row] of scheduledMap) {
    if (expectedKeys.has(dedupeKey)) continue;
    // This scheduled reminder no longer matches any current trial visit
    if (row.easychat_delayed_id) {
      const dial = row.easychat_dialogue_id != null ? { dialogue_id: row.easychat_dialogue_id } : null;
      if (dial) {
        try { await deleteDelayed(token, row.easychat_delayed_id); } catch { /* noop */ }
      }
    }
    await supabase.from('script_reminders').update({ status: 'cancelled' }).eq('id', row.id);
    stats.cancelled++;
  }

  return {
    trialVisits: trialVisits.length,
    planned,
    scheduled: stats.scheduled,
    cancelled: stats.cancelled,
    failed: stats.failed,
    skipped: stats.skipped,
    dry,
    dialogues: dialogueMap.size,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveClientName(
  clientFbId: number,
  clientByFbId: Map<number, { vars: Record<string, string> }>,
  cacheMap: Map<number, string>,
  dialogue: EasyDialogue | null,
): string | null {
  // 1. vars.Имя from scriptolog profile
  const varsName = clientByFbId.get(clientFbId)?.vars?.['Имя'];
  if (varsName && varsName.trim()) return varsName.trim();
  // 2. fitbase_clients_cache name
  const cacheName = cacheMap.get(clientFbId);
  if (cacheName) {
    const name = pickFirstName(cacheName, dialogue?.name);
    if (name) return name;
  }
  return null;
}

function pickFirstName(fio: string, dialogueName?: string): string | null {
  const words = fio.split(/\s+/).filter(w => w && !/^\d/.test(w) && !/^[+7]/.test(w));
  if (!words.length) return null;
  if (words.length === 1) return words[0];
  if (dialogueName) {
    const dLow = dialogueName.toLowerCase();
    const hit = words.find(w => dLow.includes(w.toLowerCase()));
    if (hit) return hit;
  }
  // Fitbase usually sends "Surname Name" — take second word
  return words[1];
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
