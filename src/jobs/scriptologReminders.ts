import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID, TRIAL_SERVICE_NAMES, isTrialServiceName } from '../config';
import {
  getEasyChatToken, listDialogues, scheduleMessage, listDelayed, deleteDelayed, addComment,
  DRY, EasyDialogue,
} from '../core/easychat';

export const JOB_NAME = 'scriptolog-reminders';

const YEK_OFFSET = 5 * 3600; // UTC+5 in seconds

function yekHour(ts: number): number {
  return Math.floor((ts + YEK_OFFSET) / 3600) % 24;
}

// If sendAt falls in night window (22:00-07:00 YEK), push to 09:00 next day
function adjustNight(sendAt: number): number {
  const h = yekHour(sendAt);
  if (h >= 22 || h < 7) {
    // Start of the UTC day that maps to 09:00 YEK
    const dayStart = sendAt - ((sendAt + YEK_OFFSET) % 86400);
    const nineAm = dayStart + (9 - 5) * 3600; // 09:00 YEK = 04:00 UTC
    return sendAt >= nineAm ? nineAm + 86400 : nineAm;
  }
  return sendAt;
}

function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function todayYek(): string {
  const d = new Date(Date.now() + YEK_OFFSET * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function afterTomorrowYek(): string {
  const d = new Date(Date.now() + YEK_OFFSET * 1000 + 2 * 86400 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Consent keywords for auto-confirm
const CONSENT_RE = /^\s*(\+|да|ок|окей|приду|буду|хорошо|помню|иду|yes|иә|ия|келемін|барамын|жарайды)\s*$/i;
// Refusal keywords
const REFUSAL_RE = /\bнет\b|не приду|отменить|отмена|жоқ|кела алмаймын/i;

const TEXTS: Record<string, Record<string, string>> = {
  trial_24h: {
    ru: 'Здравствуйте, {Имя}! 🌸 Напоминаем, завтра {Время} ждём Вас на пробное посещение в SlimWay 💚 🎁 И не забудьте: замер InBody — Вам в подарок!',
    kk: 'Сәлеметсіз бе, {Имя}! 🌸 Ертең {Время} сізді SlimWay-дегі сынақ сабағына күтеміз 💚 🎁 Ұмытпаңыз: InBody өлшеуі — сізге сыйлық!',
  },
  trial_3h: {
    ru: 'Здравствуйте! Через 3 часа начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸',
    kk: 'Сәлеметсіз бе! 3 сағаттан кейін сынақ сабағыңыз басталады. Растау үшін «+» жіберіңіз 👇🏻🌸',
  },
  trial_1h: {
    ru: '{Имя}, ждём Вас через час 🌸 Подтвердите, пожалуйста, что всё в силе: отправьте «+» 👇🏻',
    kk: '{Имя}, бір сағат кейін күтеміз 🌸 Барлығы жоспарда екенін «+» жіберіп растаңыз 👇🏻',
  },
};

type ReminderKind = 'trial_24h' | 'trial_3h' | 'trial_1h';
const KINDS: { kind: ReminderKind; offsetSec: number }[] = [
  { kind: 'trial_24h', offsetSec: 86400 },
  { kind: 'trial_3h',  offsetSec: 10800 },
  { kind: 'trial_1h',  offsetSec: 3600  },
];

function fillTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? '');
}

export async function runScriptologReminders(): Promise<Record<string, unknown>> {
  const nowTs = Math.floor(Date.now() / 1000);

  // Work only within 07:00–22:00 YEK
  const h = yekHour(nowTs);
  if (h < 7 || h >= 22) return { status: 'skipped', reason: 'outside 07-22 YEK' };

  // ── Get EasyChat token ─────────────────────────────────────────────────────
  const token = await getEasyChatToken();
  if (!token) return { status: 'skipped', reason: 'no easychat_token in script_settings' };

  const dry = DRY();

  // ── Load all EasyChat dialogues: build map crm_client_id → dialogue ────────
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
    console.error(`[${JOB_NAME}] listDialogues failed: ${e}`);
    return { status: 'error', reason: String(e) };
  }

  // ── Fetch upcoming trial visits from Fitbase ───────────────────────────────
  let fitbaseVisits: Record<string, unknown>[] = [];
  try {
    const dateFrom = todayYek();
    const dateTo   = afterTomorrowYek();
    fitbaseVisits = await paginateGet('/visit', { date_from: dateFrom, date_to: dateTo, page_size: 100 }, JOB_NAME);
  } catch (e) {
    console.error(`[${JOB_NAME}] Fitbase /visit fetch failed: ${e}`);
    return { status: 'error', reason: String(e) };
  }

  // Filter only trial visits
  const trialVisits = fitbaseVisits.filter(v => {
    const event    = v.event    as Record<string, unknown> | null;
    const training = event?.training as Record<string, unknown> | null;
    const csRaw    = v.client_service   as Record<string, unknown> | string | null;
    const ccRaw    = v.client_contract  as Record<string, unknown> | string | null;
    const nameOf   = (raw: typeof csRaw) => typeof raw === 'string' ? raw : raw != null ? (raw as Record<string, unknown>).name as string : null;
    const abonement = nameOf(csRaw) ?? nameOf(ccRaw) ?? null;
    return training?.id === TRIAL_TRAINING_ID || isTrialServiceName(training?.name as string | null) || isTrialServiceName(abonement);
  });

  const stats = { scheduled: 0, skipped: 0, cancelled: 0, confirmed: 0, errors: 0 };

  // Load existing reminders for dedup
  const { data: existingReminders } = await supabase
    .from('script_reminders')
    .select('id, dedupe_key, status, easychat_delayed_id, easychat_dialogue_id, fitbase_visit_id')
    .in('status', ['pending', 'sent']);

  const existingMap = new Map<string, { id: string; status: string; easychat_delayed_id: number | null; easychat_dialogue_id: number | null }>();
  for (const r of (existingReminders ?? [])) {
    existingMap.set(String(r.dedupe_key), { id: String(r.id), status: String(r.status), easychat_delayed_id: r.easychat_delayed_id as number | null, easychat_dialogue_id: r.easychat_dialogue_id as number | null });
  }

  // Load script_clients for client_key lookup by fitbase_client_id
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

  for (const visit of trialVisits) {
    const v = visit as Record<string, unknown>;
    const visitId = String(v.id ?? '');
    if (!visitId) continue;

    const status = Number(v.status ?? -1);
    const event = v.event as Record<string, unknown> | null;
    const dateStr = event?.date as string | null;
    const timeRaw = event?.time_start as string | null;
    const timeStr = timeRaw ? (timeRaw as string).slice(0, 5) : '';
    const clientFbId = v.client_id != null ? Number(v.client_id) : null;

    if (!dateStr || !clientFbId) continue;

    // Parse visit time to unix (UTC+5)
    let visitAt: number;
    try {
      const dtStr = timeStr ? `${dateStr}T${timeStr}:00+05:00` : `${dateStr}T09:00:00+05:00`;
      visitAt = Math.floor(new Date(dtStr).getTime() / 1000);
    } catch { continue; }

    const dialogue = dialogueMap.get(clientFbId) ?? null;

    // Handle cancelled / completed visits: cancel pending reminders
    if (status === 2 || status === 4) {
      for (const { kind } of KINDS) {
        const key = `${kind}:${visitId}`;
        const existing = existingMap.get(key);
        if (!existing || existing.status !== 'pending') continue;
        // Delete delayed message
        if (existing.easychat_delayed_id && dialogue) {
          try { await deleteDelayed(token, existing.easychat_delayed_id); } catch { /* noop */ }
        }
        await supabase.from('script_reminders').update({ status: 'cancelled' }).eq('id', existing.id);
        stats.cancelled++;
      }
      continue;
    }

    // For confirmed (status=1): cancel 1h and 3h reminders
    if (status === 1) {
      for (const kind of ['trial_1h', 'trial_3h'] as ReminderKind[]) {
        const key = `${kind}:${visitId}`;
        const existing = existingMap.get(key);
        if (!existing || existing.status !== 'pending') continue;
        if (existing.easychat_delayed_id && dialogue) {
          try { await deleteDelayed(token, existing.easychat_delayed_id); } catch { /* noop */ }
        }
        await supabase.from('script_reminders').update({ status: 'cancelled' }).eq('id', existing.id);
        stats.cancelled++;
      }
      // Auto-confirm check below (last_message)
    }

    // ── Auto-confirm: check last_message ──────────────────────────────────
    if (dialogue?.last_message?.operator_id === null && dialogue.last_message.message) {
      const msgText = dialogue.last_message.message.trim();
      const msgTs = isoToUnix(dialogue.last_message.created_at);

      if (CONSENT_RE.test(msgText)) {
        // Find the trial_3h reminder send_at to verify reply came after
        const rem3h = existingMap.get(`trial_3h:${visitId}`);
        const afterReminder = !rem3h || msgTs > (rem3h ? nowTs - 86400 : 0); // loose check
        if (afterReminder) {
          const CONFIRM_DRY = (process.env.SCRIPTOLOG_CONFIRM_DRY_RUN ?? 'true') === 'true';
          const clientName = (clientByFbId.get(clientFbId)?.vars ?? {})['Имя'] ?? '?';
          if (CONFIRM_DRY) {
            console.log(`[${JOB_NAME}] CONFIRM DRY: ${clientName} visit=${visitId} replied "${msgText}"`);
          } else {
            // shortcut: Fitbase PATCH /visit/{id} status=1 not yet verified — see docs/reports/fitbase-registration-confirm-probe.md
            console.log(`[${JOB_NAME}] CONFIRM: ${clientName} visit=${visitId} replied "${msgText}" — Fitbase update skipped (not verified)`);
          }
          // Create watch_alert
          if (!CONFIRM_DRY) {
            const { error: waErr } = await supabase.from('watch_alerts').insert({
              rule: 'SCRIPT_CONFIRM', level: 'info',
              short_name: clientName,
              title: 'Подтвердила пробное',
              body: `${clientName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
              meta: { fitbase_visit_id: visitId },
            });
            if (waErr) console.error(`[${JOB_NAME}] watch_alert insert: ${waErr.message}`);
          }
          // EasyChat comment
          await addComment(token, dialogue.dialogue_id, `[СКРИПТОЛОГ] ✅ Подтвердила пробное на ${dateStr} ${timeStr}`)
            .catch(e => console.error(`[${JOB_NAME}] addComment: ${e}`));
          stats.confirmed++;
          continue;
        }
      }

      if (REFUSAL_RE.test(msgText)) {
        const clientName = (clientByFbId.get(clientFbId)?.vars ?? {})['Имя'] ?? '?';
        const CONFIRM_DRY = (process.env.SCRIPTOLOG_CONFIRM_DRY_RUN ?? 'true') === 'true';
        if (!CONFIRM_DRY) {
          const { error: waErr2 } = await supabase.from('watch_alerts').insert({
            rule: 'SCRIPT_CANCEL', level: 'warn',
            short_name: clientName,
            title: 'Отменила пробное',
            body: `${clientName} ответила «${msgText}» → пробное ${dateStr} ${timeStr}`,
            meta: { fitbase_visit_id: visitId },
          });
          if (waErr2) console.error(`[${JOB_NAME}] watch_alert insert: ${waErr2.message}`);
        }
      }
    }

    // ── Schedule reminders ────────────────────────────────────────────────
    if (!dialogue) {
      console.warn(`[${JOB_NAME}] no EasyChat dialogue for Fitbase client ${clientFbId} (visit ${visitId})`);
      stats.skipped++;
      continue;
    }

    const sc = clientByFbId.get(clientFbId);
    const vars = sc?.vars ?? {};
    const lang = (vars['lang'] ?? 'ru') as 'ru' | 'kk';

    for (const { kind, offsetSec } of KINDS) {
      const dedupeKey = `${kind}:${visitId}`;
      if (existingMap.has(dedupeKey)) { stats.skipped++; continue; }

      let sendAt = visitAt - offsetSec;
      if (sendAt <= nowTs) { stats.skipped++; continue; } // past
      sendAt = adjustNight(sendAt);

      const tmpl = TEXTS[kind]?.[lang] ?? TEXTS[kind]['ru'];
      const msgText = fillTemplate(tmpl, { ...vars, Время: timeStr });

      let delayedId = 0;
      try {
        delayedId = await scheduleMessage(token, dialogue.dialogue_id, msgText, sendAt);
      } catch (e) {
        console.error(`[${JOB_NAME}] scheduleMessage ${kind} visit=${visitId}: ${e}`);
        stats.errors++;
        continue;
      }

      const row: Record<string, unknown> = {
        client_key: sc?.client_key ?? `fitbase:${clientFbId}`,
        kind,
        status: 'pending',
        lang,
        dedupe_key: dedupeKey,
        due_at: new Date(sendAt * 1000).toISOString(),
        send_at: new Date(sendAt * 1000).toISOString(),
        message_text: msgText,
        fitbase_visit_id: visitId,
        easychat_delayed_id: delayedId || null,
        easychat_dialogue_id: dialogue.dialogue_id,
      };

      const { error } = await supabase.from('script_reminders').insert(row);
      if (error) {
        console.error(`[${JOB_NAME}] insert reminder ${kind} visit=${visitId}: ${error.message}`);
        stats.errors++;
      } else {
        stats.scheduled++;
      }
    }
  }

  return { ...stats, dry, dialogues: dialogueMap.size, trialVisits: trialVisits.length };
}
