import { supabase }            from '../db/supabase';
import { retrySheetSync }     from '../http/shifts';
import { paginateGet, rawGet }  from '../http/fitbase';
import { getOverdueMissed }     from '../http/manager';
import { shortName }            from '../core/names';
import { getLeadFunnel }        from '../core/funnel';
import { alertError }           from '../core/mail';
import { getTitle, pickBody, pickAgentTaskBody } from '../core/alertTexts';
import {
  env,
  TRIAL_TRAINING_ID,
  TASK_CATEGORY_CALL_ID,
  WATCH_RULES,
  WATCH_NO_SHOW_EXCLUDE,
  WATCH_EXCLUDE_CLIENT_IDS_SET,
} from '../config';
import { countClientVisits } from '../core/contracts';

export const JOB_NAME = 'watch';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALMATY_MS             = 5 * 3600 * 1000;
const SEVEN_DAYS_SEC        = 7 * 86400;
const CARD_FREE_SEC         = 24 * 3600;
const PURCHASE_MIN          = 40_000;
const NEW_LEAD_GRACE_MS     = 2 * 3600_000;
const NEW_LEAD_TASK_MIN     = 5 * 60_000;
const PURCHASE_TTL_MS       = 12 * 3600_000;
const CANCELLED_TTL_MS      = 24 * 3600_000;
const SYSTEM_GAP_MS         = 30 * 60_000;
const CONTRACT_TTL_MS       = 30 * 60_000;
const CIRCUIT_BREAKER_PAUSE = 30 * 60_000;
const SCHEDULE_CACHE_TTL    = 15 * 60_000;

const EXCLUDED_MANAGER_STEPS = new Set(['Ангелина', 'Вера', 'Назерке']);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  status:       string;
  available_to: number;
  lead_id?:     number;
  client_id?:   number;
  description?: string;
  category_id?: number;
}

interface DbAlert {
  id:              number;
  alert_key:       string;
  rule:            string;
  level:           string;
  lead_id:         number | null;
  client_id:       number | null;
  registration_id: number | null;
  created_at:      string;
  acked_at:        string | null;
  body:            string;
  meta:            Record<string, unknown> | null;
}

interface AlertRow {
  alert_key:       string;
  rule:            string;
  level:           'urgent' | 'important' | 'info';
  lead_id:         number | null;
  client_id:       number | null;
  registration_id: number | null;
  manager_name:    string | null;
  short_name:      string | null;
  title:           string;
  body:            string;
  action_hint:     string | null;
  link:            string | null;
  meta:            Record<string, unknown> | null;
}

// ── Rule gate ─────────────────────────────────────────────────────────────────

function isEnabled(rule: string): boolean {
  return rule === 'SYSTEM' || WATCH_RULES.has(rule);
}

// ── In-memory caches (process-lifetime; resets on deploy) ─────────────────────

const commentCache    = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
const watchRegCache   = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
const clientInfoCache = new Map<number, { sname: string; isTest: boolean; phone: string; ts: number }>();
let contractBulkCache: { items: Record<string, unknown>[]; ts: number } | null = null;
let scheduleCache:     { items: Record<string, unknown>[]; ts: number } | null = null;

async function getClientComments(clientId: number): Promise<Record<string, unknown>[]> {
  const cached = commentCache.get(clientId);
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.items;
  const resp  = await rawGet(`/note?client_id=${clientId}`);
  const items = ((resp.items || []) as Record<string, unknown>[]);
  commentCache.set(clientId, { items, ts: Date.now() });
  return items;
}

async function getClientRegs(clientId: number): Promise<Record<string, unknown>[]> {
  const cached = watchRegCache.get(clientId);
  if (cached && Date.now() - cached.ts < CONTRACT_TTL_MS) return cached.items;
  const resp  = await rawGet(`/schedule-registration?client_id=${clientId}`);
  const items = ((resp.items || []) as Record<string, unknown>[]);
  watchRegCache.set(clientId, { items, ts: Date.now() });
  return items;
}

async function fetchClientInfo(clientId: number): Promise<{ sname: string; isTest: boolean; phone: string }> {
  const cached = clientInfoCache.get(clientId);
  if (cached && Date.now() - cached.ts < CONTRACT_TTL_MS) return cached;
  try {
    const resp    = await rawGet(`/client/${clientId}`);
    const c       = ((resp.item ?? resp) as Record<string, unknown>);
    const name    = String(c.name    ?? '').trim();
    const surname = String(c.surname ?? '').trim();
    const phone   = String(c.phone   ?? c.mobile ?? '').trim();
    const isTest  = /тест|test/i.test(name) || /тест|test/i.test(surname);
    const full    = name + (surname ? ' ' + surname : '');
    const sname   = full.trim() ? shortName({ name: full }) : `Клиент #${clientId}`;
    const entry   = { sname, isTest, phone, ts: Date.now() };
    clientInfoCache.set(clientId, entry);
    return entry;
  } catch {
    const entry = { sname: `Клиент #${clientId}`, isTest: false, phone: '', ts: Date.now() };
    clientInfoCache.set(clientId, entry);
    return entry;
  }
}

async function loadAllContracts(): Promise<Record<string, unknown>[]> {
  if (contractBulkCache && Date.now() - contractBulkCache.ts < CONTRACT_TTL_MS) {
    return contractBulkCache.items;
  }
  const items = await paginateGet('/client-contract', { page_size: 100 });
  contractBulkCache = { items, ts: Date.now() };
  return items;
}

// ── Schedule loading (cached, single batch) ───────────────────────────────────

async function loadScheduleRegistrations(
  today:    string,
  tomorrow: string,
): Promise<{ todayRegs: Record<string, unknown>[]; tomorrowRegs: Record<string, unknown>[] }> {
  if (!scheduleCache || Date.now() - scheduleCache.ts > SCHEDULE_CACHE_TTL) {
    const t0    = Date.now();
    // Try date-range params; Fitbase may or may not honour them
    const items = await paginateGet('/schedule-registration', {
      date_from: today,
      date_to:   tomorrow,
      page_size: 100,
    });
    scheduleCache = { items, ts: Date.now() };
    console.log(`[watch] schedule loaded ${items.length} records in ${Date.now() - t0}ms`);
  }
  // Always filter client-side — guard against API ignoring the date params
  const todayRegs    = scheduleCache.items.filter(r => String((r.event as Record<string, unknown> | undefined)?.date ?? '') === today);
  const tomorrowRegs = scheduleCache.items.filter(r => String((r.event as Record<string, unknown> | undefined)?.date ?? '') === tomorrow);
  console.log(`[watch] schedule from cache: today=${todayRegs.length} tomorrow=${tomorrowRegs.length} total=${scheduleCache.items.length}`);
  return { todayRegs, tomorrowRegs };
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

async function getCircuitBreakerPauseUntil(): Promise<number> {
  const { data } = await supabase
    .from('alert_throttle')
    .select('last_sent_at')
    .eq('alert_type', 'fitbase_circuit_breaker')
    .maybeSingle();
  if (!data?.last_sent_at) return 0;
  return new Date(data.last_sent_at as string).getTime();
}

async function setCircuitBreakerPause(nowMs: number): Promise<void> {
  const pauseUntil = new Date(nowMs + CIRCUIT_BREAKER_PAUSE).toISOString();
  await supabase.from('alert_throttle').upsert(
    { alert_type: 'fitbase_circuit_breaker', last_sent_at: pauseUntil },
    { onConflict: 'alert_type' },
  );
  const pauseStr = new Date(nowMs + CIRCUIT_BREAKER_PAUSE).toLocaleTimeString('ru', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
  await alertError('fitbase_circuit_breaker', `Fitbase не отвечает — агент на паузе до ${pauseStr}. Проверьте статус API.`);
}

async function clearCircuitBreaker(): Promise<void> {
  const { data } = await supabase
    .from('alert_throttle')
    .select('last_sent_at')
    .eq('alert_type', 'fitbase_circuit_breaker')
    .maybeSingle();
  if (!data) return; // was not active
  await supabase.from('alert_throttle').delete().eq('alert_type', 'fitbase_circuit_breaker');
  await alertError('fitbase_circuit_breaker_ok', 'Fitbase снова отвечает — агент возобновил работу.');
}

// ── Business hours (Almaty) ───────────────────────────────────────────────────

function isBusinessHours(nowMs: number): boolean {
  const d   = new Date(nowMs + ALMATY_MS);
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  const t   = d.getUTCHours() * 60 + d.getUTCMinutes();
  const isWeekend = dow === 0 || dow === 6;
  const close     = isWeekend ? 21 * 60 : 22 * 60 + 30;
  return t >= 8 * 60 && t < close;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function almatyDate(ms: number): string {
  return new Date(ms + ALMATY_MS).toISOString().slice(0, 10);
}

function parseToMs(val: unknown): number {
  if (!val) return 0;
  const s = String(val);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const n = Number(s);
  return isNaN(n) ? 0 : (n > 1e10 ? n : n * 1000);
}

// ── Lead helpers ──────────────────────────────────────────────────────────────

function getManager(lead: Record<string, unknown>): string | null {
  const r = lead.responsible as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const n = String(r.name || r.full_name || '').trim();
  return n || null;
}

function buildExcludedStepIds(steps: Record<string, unknown>[]): Set<number> {
  const ids = new Set<number>();
  for (const s of steps) {
    const name = String(s.name || '');
    const id   = Number(s.id);
    if (!id) continue;
    if (EXCLUDED_MANAGER_STEPS.has(name)) ids.add(id);
    if (s.archived || s.is_archived)       ids.add(id);
    if (name.startsWith('Архив:'))          ids.add(id);
  }
  return ids;
}

function isActiveFunnel1Lead(lead: Record<string, unknown>, excludedStepIds: Set<number>): boolean {
  if (/^тест/i.test(String(lead.title || ''))) return false;
  if (getLeadFunnel(lead) !== 1) return false;
  const step   = lead.funnel_step as Record<string, unknown> | undefined;
  const stepId = Number(step?.id ?? 0);
  if (stepId === -1 || stepId === -2) return false;
  if (stepId > 0 && excludedStepIds.has(stepId)) return false;
  return true;
}

function groupTasksByLead(tasks: Record<string, unknown>[]): Map<number, Task[]> {
  const map = new Map<number, Task[]>();
  for (const t of tasks) {
    const lid = Number(t.lead_id ?? 0);
    if (!lid) continue;
    if (!map.has(lid)) map.set(lid, []);
    map.get(lid)!.push({
      status:       String(t.status || ''),
      available_to: Number(t.available_to ?? 0),
      lead_id:      lid,
      client_id:    Number(t.client_id ?? 0) || undefined,
      description:  String(t.description || ''),
      category_id:  Number(t.category_id  ?? 0) || undefined,
    });
  }
  return map;
}

// ── Task analysis ─────────────────────────────────────────────────────────────

interface TaskAnalysis {
  openTasks:          Task[];
  overdueOpen:        Task[];
  futureAll:          Task[];
  futureWithin7d:     Task[];
  earliestOverdueSec: number;
}

function analyzeLeadTasks(tasks: Task[], nowSec: number): TaskAnalysis {
  const openTasks      = tasks.filter(t => t.status === 'O');
  const withDeadline   = openTasks.filter(t => t.available_to > 0);
  const overdueOpen    = withDeadline.filter(t => t.available_to < nowSec);
  const futureAll      = withDeadline.filter(t => t.available_to >= nowSec);
  const futureWithin7d = futureAll.filter(t => t.available_to <= nowSec + SEVEN_DAYS_SEC);

  const earliestOverdueSec = overdueOpen.length > 0
    ? Math.min(...overdueOpen.map(t => t.available_to))
    : 0;

  return { openTasks, overdueOpen, futureAll, futureWithin7d, earliestOverdueSec };
}

// ── Registration helpers ──────────────────────────────────────────────────────

function getRegStartMs(reg: Record<string, unknown>): number {
  const ev = reg.event as Record<string, unknown> | undefined;
  if (!ev) return 0;
  const ds = String(ev.date || '');
  const ts = String(ev.time_start || '00:00');
  if (!ds || ds.length < 8) return 0;
  const [y, mo, d] = ds.split('-').map(Number);
  const [h, mi]    = ts.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi, 0)).getTime();
}

function getRegShortName(reg: Record<string, unknown>): string {
  const client = reg.client as Record<string, unknown> | undefined;
  const lead   = reg.lead   as Record<string, unknown> | undefined;
  const cn = String(client?.name || '').trim();
  const cs = String(client?.surname || '').trim();
  if (cn) return shortName({ name: cn + (cs ? ' ' + cs : '') });
  if (lead) return shortName(lead, client);
  return String(reg.client_name || reg.lead_title || '').trim();
}

function getTrainingName(reg: Record<string, unknown>): string {
  const ev       = reg.event as Record<string, unknown> | undefined;
  const training = ev?.training as Record<string, unknown> | undefined;
  return String(training?.name || '');
}

function getTrainingId(reg: Record<string, unknown>): number {
  const ev       = reg.event as Record<string, unknown> | undefined;
  const training = ev?.training as Record<string, unknown> | undefined;
  return Number(training?.id ?? 0);
}

function fmtTime(ms: number): string {
  const d = new Date(ms + ALMATY_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function pluralVisits(n: number): string {
  const m = n % 10, c = n % 100;
  if (c >= 11 && c <= 19) return 'посещений';
  if (m === 1) return 'посещение';
  if (m >= 2 && m <= 4) return 'посещения';
  return 'посещений';
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function loadOpenAlerts(): Promise<DbAlert[]> {
  const { data, error } = await supabase
    .from('watch_alerts')
    .select('id, alert_key, rule, level, lead_id, client_id, registration_id, created_at, acked_at, body, meta')
    .is('resolved_at', null);
  if (error) console.error('[watch] loadOpenAlerts:', error.message);
  return (data ?? []) as DbAlert[];
}

async function getLastWatchRunAt(): Promise<number> {
  const { data } = await supabase
    .from('job_runs')
    .select('finished_at')
    .eq('job', JOB_NAME)
    .eq('status', 'ok')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.finished_at) return 0;
  return new Date(data.finished_at as string).getTime();
}

async function getLastRunStatuses(count: number): Promise<string[]> {
  const { data } = await supabase
    .from('job_runs')
    .select('status')
    .eq('job', JOB_NAME)
    .in('status', ['ok', 'error'])
    .order('started_at', { ascending: false })
    .limit(count);
  return (data ?? []).map(r => r.status as string);
}

// ── Purchases ─────────────────────────────────────────────────────────────────

async function loadNewPurchases(lastRunAt: number): Promise<Record<string, unknown>[]> {
  const since = lastRunAt > 0
    ? new Date(lastRunAt).toISOString().slice(0, 10)
    : almatyDate(Date.now() - 7 * 86400_000);

  try {
    const items = await paginateGet('/till-order-steps', {
      item_type:      'contract',
      operation_type: 'purchase',
      date_from:      since,
      page_size:      100,
    });
    return items.filter(p => Number(p.price_full ?? p.price ?? 0) >= PURCHASE_MIN);
  } catch (e) {
    console.error('[watch] loadNewPurchases error:', (e as Error).message);
    return [];
  }
}

// ── Agent task helpers ────────────────────────────────────────────────────────

function parseAgentTaskReason(desc: string): string {
  if (/более 7 дней|не посещали.*7/i.test(desc)) return 'INACTIVE_7';
  if (/более 10 дней|не посещают.*10/i.test(desc)) return 'INACTIVE_10';
  if (/более 14 дней/i.test(desc)) return 'INACTIVE_14';
  if (/нет записи на пробное/i.test(desc)) return 'NO_REGISTRATION';
  if (/неявка|не пришёл|не пришла/i.test(desc)) return 'NO_SHOW';
  if (/отмен/i.test(desc)) return 'CANCELLED';
  return 'OTHER';
}

function parseResponsibleNames(task: Record<string, unknown>): string {
  const resp = task.responsible;
  if (!resp) return '';
  const arr = Array.isArray(resp) ? resp : [resp];
  return arr.map(r => {
    if (typeof r !== 'object' || !r) return '';
    const obj = r as Record<string, unknown>;
    return String(obj.name || obj.full_name || '').trim();
  }).filter(Boolean).join(', ');
}

function parseInactiveClients(desc: string): string[] {
  return desc.split('\n')
    .filter(line => /^\d+\./.test(line.trim()))
    .map(line => {
      const m = line.trim().match(/^\d+\.\s+([^—\n]+)/);
      return m ? m[1].trim() : '';
    })
    .filter(Boolean);
}

// ── Rule processors ───────────────────────────────────────────────────────────

function processLeadRules(
  lead:        Record<string, unknown>,
  tasksByLead: Map<number, Task[]>,
  nowMs:       number,
  nowSec:      number,
  activeKeys:  Set<string>,
  toUpsert:    AlertRow[],
): void {
  const leadId   = Number(lead.id);
  const clientId = Number(lead.client_id ?? 0) || null;
  const manager  = getManager(lead);
  const sname    = shortName(lead);
  const created  = parseToMs(lead.created_at);
  const tasks    = tasksByLead.get(leadId) ?? [];
  const ta       = analyzeLeadTasks(tasks, nowSec);

  if (isEnabled('NEW_LEAD') && created > 0) {
    const ageMs = nowMs - created;
    if (ageMs < NEW_LEAD_GRACE_MS && ta.openTasks.length === 0) {
      activeKeys.add(`NEW_LEAD:lead:${leadId}`);
    }
  }

  if (isEnabled('NEW_LEAD_NO_TASK') && created > 0) {
    const ageMs = nowMs - created;
    const todayAlmaty    = new Date(nowMs + ALMATY_MS).toISOString().slice(0, 10);
    const workStartToday = new Date(todayAlmaty + 'T03:00:00Z').getTime();
    if (ageMs > NEW_LEAD_TASK_MIN && ageMs < NEW_LEAD_GRACE_MS && created >= workStartToday && ta.openTasks.length === 0) {
      activeKeys.add(`NEW_LEAD_NO_TASK:lead:${leadId}`);
    }
  }

  const anyTaskRule = isEnabled('TASK_OVERDUE') || isEnabled('TASK_TOO_FAR') || isEnabled('NO_TASK');
  if (anyTaskRule) {
    if (ta.overdueOpen.length > 0) {
      if (isEnabled('TASK_OVERDUE')) {
        const key = `TASK_OVERDUE:lead:${leadId}`;
        activeKeys.add(key);
        toUpsert.push({
          alert_key: key, rule: 'TASK_OVERDUE', level: 'important',
          lead_id: leadId, client_id: clientId, registration_id: null,
          manager_name: manager, short_name: sname,
          title: 'Просроченная задача', body: sname,
          action_hint: 'Закрой или перенеси задачу с комментарием',
          link: null, meta: null,
        });
      }
    } else if (ta.futureWithin7d.length > 0) {
      // OK
    } else if (ta.futureAll.length > 0) {
      if (isEnabled('TASK_TOO_FAR')) {
        const key = `TASK_TOO_FAR:lead:${leadId}`;
        activeKeys.add(key);
        toUpsert.push({
          alert_key: key, rule: 'TASK_TOO_FAR', level: 'important',
          lead_id: leadId, client_id: clientId, registration_id: null,
          manager_name: manager, short_name: sname,
          title: 'Задача слишком далеко', body: sname,
          action_hint: 'Перенеси задачу — максимум 7 дней вперёд',
          link: null, meta: null,
        });
      }
    } else {
      if (isEnabled('NO_TASK')) {
        const key = `NO_TASK:lead:${leadId}`;
        activeKeys.add(key);
        toUpsert.push({
          alert_key: key, rule: 'NO_TASK', level: 'important',
          lead_id: leadId, client_id: clientId, registration_id: null,
          manager_name: manager, short_name: sname,
          title: 'Нет задачи', body: sname,
          action_hint: 'Поставь задачу (максимум на 7 дней вперёд)',
          link: null, meta: null,
        });
      }
    }
  }
}

async function processCardFreeRule(
  lead:        Record<string, unknown>,
  tasksByLead: Map<number, Task[]>,
  nowSec:      number,
  activeKeys:  Set<string>,
  toUpsert:    AlertRow[],
): Promise<void> {
  if (!isEnabled('CARD_FREE')) return;

  const leadId   = Number(lead.id);
  const clientId = Number(lead.client_id ?? 0);
  if (!clientId) return;

  const tasks = tasksByLead.get(leadId) ?? [];
  const ta    = analyzeLeadTasks(tasks, nowSec);
  if (ta.overdueOpen.length === 0) return;
  if (nowSec - ta.earliestOverdueSec < CARD_FREE_SEC) return;

  const comments = await getClientComments(clientId);
  const hasRecentComment = comments.some(c => {
    const ts = parseToMs(c.created_at || c.created_at_unix);
    return ts > ta.earliestOverdueSec * 1000;
  });
  if (hasRecentComment) return;

  const key = `CARD_FREE:lead:${leadId}`;
  activeKeys.add(key);
  toUpsert.push({
    alert_key: key, rule: 'CARD_FREE', level: 'urgent',
    lead_id: leadId, client_id: clientId, registration_id: null,
    manager_name: getManager(lead), short_name: shortName(lead),
    title: 'Карточка свободна',
    body: `${shortName(lead)} — может взять любой менеджер`,
    action_hint: 'Напиши причину, поставь себя менеджером и следующий шаг',
    link: null, meta: null,
  });
}

async function processRegRules(
  reg:        Record<string, unknown>,
  nowMs:      number,
  nowSec:     number,
  today:      string,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
): Promise<void> {
  const regId    = Number(reg.id);
  const status   = String(reg.status ?? '');
  const startMs  = getRegStartMs(reg);
  const training = getTrainingName(reg);
  const leadId   = Number(reg.lead_id ?? 0) || null;
  const clientId = Number(reg.client_id ?? 0) || null;

  if (startMs === 0) return;

  const ev      = reg.event as Record<string, unknown> | undefined;
  const evDate  = String(ev?.date || '');
  const isToday = evDate === today;

  const sname = getRegShortName(reg);

  // Extract phone from client object if available
  const client = reg.client as Record<string, unknown> | undefined;
  const regPhone = String(client?.phone ?? client?.mobile ?? '').trim();

  if (isEnabled('UNCONFIRMED_3H') && getTrainingId(reg) === TRIAL_TRAINING_ID
      && status === '0' && startMs > nowMs && startMs - nowMs < 3 * 3600_000) {
    const key   = `UNCONFIRMED_3H:reg:${regId}`;
    const uname = sname || (clientId ? (await fetchClientInfo(clientId)).sname : `Запись #${regId}`);
    const phone = regPhone || (clientId ? (await fetchClientInfo(clientId)).phone : '');
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'UNCONFIRMED_3H', level: 'important',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: uname || null,
      title: getTitle('UNCONFIRMED_3H'),
      body: pickBody('UNCONFIRMED_3H', key, { name: uname || `Запись #${regId}`, time: fmtTime(startMs) }),
      action_hint: null,
      link: null, meta: phone ? { phone } : null,
    });
  }

  if (clientId && isToday && !WATCH_NO_SHOW_EXCLUDE.has(training.toLowerCase())) {
    const pastStart = startMs < nowMs;
    const past30min = pastStart && nowMs - startMs > 30 * 60_000;
    const needsName = (isEnabled('NO_SHOW_UNCONFIRMED') && status === '0' && past30min)
                   || (isEnabled('NO_SHOW_NO_MARK')     && status === '1' && past30min)
                   || (isEnabled('NO_SHOW_MARKED')       && status === '4' && pastStart);
    const ns = needsName ? (sname || (await fetchClientInfo(clientId)).sname) : '';
    const phone = regPhone || (needsName && clientId ? (await fetchClientInfo(clientId)).phone : '');

    if (isEnabled('NO_SHOW_UNCONFIRMED') && status === '0' && past30min) {
      const key = `NO_SHOW_UNCONFIRMED:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NO_SHOW_UNCONFIRMED', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: ns,
        title: getTitle('NO_SHOW_UNCONFIRMED'),
        body: pickBody('NO_SHOW_UNCONFIRMED', key, { name: ns, time: fmtTime(startMs) }),
        action_hint: null,
        link: null, meta: phone ? { phone } : null,
      });
    }

    if (isEnabled('NO_SHOW_NO_MARK') && status === '1' && past30min) {
      const key = `NO_SHOW_NO_MARK:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NO_SHOW_NO_MARK', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: ns,
        title: getTitle('NO_SHOW_NO_MARK'),
        body: pickBody('NO_SHOW_NO_MARK', key, { name: ns, time: fmtTime(startMs) }),
        action_hint: null,
        link: null, meta: phone ? { phone } : null,
      });
    }

    if (isEnabled('NO_SHOW_MARKED') && status === '4' && pastStart) {
      const key = `NO_SHOW_MARKED:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NO_SHOW_MARKED', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: ns,
        title: getTitle('NO_SHOW_MARKED'),
        body: pickBody('NO_SHOW_MARKED', key, { name: ns, time: fmtTime(startMs) }),
        action_hint: null,
        link: null, meta: phone ? { phone } : null,
      });
    }
  }

  if (isEnabled('CANCELLED') && status === '2' && isToday) {
    const key = `CANCELLED:reg:${regId}`;
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'CANCELLED', level: 'important',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: sname || null,
      title: 'Запись отменена',
      body: `${sname || `Запись #${regId}`}, ${training || 'занятие'} в ${fmtTime(startMs)}`,
      action_hint: 'Свяжись и перезапиши',
      link: null, meta: regPhone ? { phone: regPhone } : null,
    });
  }

  if (isEnabled('TRIAL_SOON') && getTrainingId(reg) === TRIAL_TRAINING_ID) {
    const minsToStart = (startMs - nowMs) / 60_000;
    if (minsToStart > 0 && minsToStart <= 60) {
      const confirmed = ['1', '3'].includes(status);
      const key       = `TRIAL_SOON:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'TRIAL_SOON', level: 'info',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: sname || null,
        title: 'Пробное скоро',
        body: `В ${fmtTime(startMs)} пробное: ${sname || `Запись #${regId}`}, запись ${confirmed ? 'подтверждена' : 'не подтверждена'}`,
        action_hint: confirmed ? null : 'Позвони и подтверди',
        link: null, meta: null,
      });
    }
  }
}

function processPurchaseRule(
  purchase:   Record<string, unknown>,
  nowMs:      number,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
  openByKey:  Map<string, DbAlert>,
): void {
  if (!isEnabled('PURCHASE')) return;

  const orderId = Number(purchase.id ?? purchase.order_id ?? 0);
  if (!orderId) return;
  const key = `PURCHASE:order:${orderId}`;

  const existing = openByKey.get(key);
  if (existing && nowMs - new Date(existing.created_at).getTime() > PURCHASE_TTL_MS) return;

  const price    = Number(purchase.price_full ?? purchase.price ?? 0);
  if (price < PURCHASE_MIN) return;

  const clientObj  = purchase.client as Record<string, unknown> | undefined;
  const clientName = String(purchase.client_name || clientObj?.name || '');
  const itemName   = String(purchase.item_name || purchase.contract_item_name || purchase.title || 'абонемент');
  const sname      = clientName ? shortName({ name: clientName }) : `Клиент #${purchase.client_id}`;

  activeKeys.add(key);
  toUpsert.push({
    alert_key: key, rule: 'PURCHASE', level: 'info',
    lead_id: null, client_id: Number(purchase.client_id ?? 0) || null, registration_id: null,
    manager_name: null, short_name: sname,
    title: 'Хорошие новости',
    body: `${sname} купил(а) ${itemName} за ${price.toLocaleString('ru')} ₸`,
    action_hint: null,
    link: null,
    meta: { order_id: orderId, price },
  });
}

async function processSystemRules(
  nowMs:      number,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
): Promise<void> {
  const lastOkMs = await getLastWatchRunAt();
  const noRunKey = 'SYSTEM:watch:no_run';
  const errorKey = 'SYSTEM:watch:fitbase_error';

  if (lastOkMs > 0 && nowMs - lastOkMs > SYSTEM_GAP_MS) {
    activeKeys.add(noRunKey);
    toUpsert.push({
      alert_key: noRunKey, rule: 'SYSTEM', level: 'urgent',
      lead_id: null, client_id: null, registration_id: null,
      manager_name: null, short_name: null,
      title: 'Агент не работает',
      body: `Последний успешный запуск: ${new Date(lastOkMs).toLocaleString('ru')}`,
      action_hint: 'Проверь cron-job.org и логи сервера',
      link: null, meta: { last_ok_at: new Date(lastOkMs).toISOString() },
    });
    // Send watchdog email during business hours
    if (isBusinessHours(nowMs)) {
      const t = new Date(lastOkMs).toLocaleTimeString('ru', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
      await alertError('watch_no_run', `Агент не работает с ${t}. Последний успешный запуск: ${new Date(lastOkMs).toLocaleString('ru')}.`);
    }
  }

  const statuses = await getLastRunStatuses(3);
  if (statuses.length >= 3 && statuses.every(s => s === 'error')) {
    activeKeys.add(errorKey);
    toUpsert.push({
      alert_key: errorKey, rule: 'SYSTEM', level: 'urgent',
      lead_id: null, client_id: null, registration_id: null,
      manager_name: null, short_name: null,
      title: 'Fitbase не отвечает',
      body: '3 запуска подряд завершились ошибкой',
      action_hint: 'Проверь статус Fitbase API',
      link: null, meta: null,
    });
    // Activate circuit breaker
    await setCircuitBreakerPause(nowMs);
  }
}

async function processContractRules(
  nowMs:           number,
  activeKeys:      Set<string>,
  toUpsert:        AlertRow[],
  nameByClientId:  Map<number, string>,
  managerByClient: Map<number, string>,
): Promise<void> {
  if (!isEnabled('CONTRACT_ENDING') && !isEnabled('CONTRACT_ENDED')) return;

  let allContracts: Record<string, unknown>[];
  try {
    allContracts = await loadAllContracts();
  } catch (e) {
    console.error('[watch] loadAllContracts error:', (e as Error).message);
    return;
  }

  const byClient = new Map<number, Record<string, unknown>[]>();
  for (const c of allContracts) {
    if (String(c.deleted_at ?? '').trim()) continue;
    const clientId = Number(c.client_id ?? (c.client as Record<string, unknown>)?.id ?? 0);
    if (!clientId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId)!.push(c);
  }

  for (const [clientId, clientContracts] of byClient) {
    if (WATCH_EXCLUDE_CLIENT_IDS_SET.has(clientId)) continue;

    let sname  = nameByClientId.get(clientId) || '';
    let isTest = sname ? /тест|test/i.test(sname) : false;
    let phone  = '';
    if (!sname) {
      const info = await fetchClientInfo(clientId);
      sname  = info.sname;
      isTest = info.isTest;
      phone  = info.phone;
    }
    if (isTest) continue;

    const manager = managerByClient.get(clientId) || null;

    const vr = await countClientVisits(clientContracts, () => getClientRegs(clientId));

    if (isEnabled('CONTRACT_ENDING') && vr.activeCount > 0 && vr.totalLeft <= 2) {
      const ruleKey = vr.freeOnly ? 'CONTRACT_ENDING_FREE' : 'CONTRACT_ENDING';
      const key = `CONTRACT_ENDING:client:${clientId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'CONTRACT_ENDING', level: 'important',
        lead_id: null, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: getTitle('CONTRACT_ENDING'),
        body: pickBody(ruleKey, key, { name: sname, left: vr.totalLeft, visits: pluralVisits(vr.totalLeft) }),
        action_hint: null,
        link: null, meta: phone ? { phone } : null,
      });
    } else if (isEnabled('CONTRACT_ENDED') && vr.anyCountable && vr.activeCount === 0) {
      const daysAgo = vr.maxEndDateMs > 0 ? (nowMs - vr.maxEndDateMs) / 86_400_000 : Infinity;
      if (daysAgo > env.CONTRACT_ENDED_DAYS) continue;

      const ruleKey = vr.allFree ? 'CONTRACT_ENDED_FREE' : 'CONTRACT_ENDED';
      const key = `CONTRACT_ENDED:client:${clientId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'CONTRACT_ENDED', level: 'urgent',
        lead_id: null, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: getTitle('CONTRACT_ENDED'),
        body: pickBody(ruleKey, key, { name: sname }),
        action_hint: null,
        link: null, meta: phone ? { phone } : null,
      });
    }
  }
}

// ── AGENT_TASK rule processor ─────────────────────────────────────────────────

async function processAgentTaskRules(
  rawTasks:       Record<string, unknown>[],
  nowMs:          number,
  nowSec:         number,
  activeKeys:     Set<string>,
  toUpsert:       AlertRow[],
  nameByClientId: Map<number, string>,
  leadById:       Map<number, Record<string, unknown>>,
): Promise<void> {
  if (!isEnabled('AGENT_TASK')) return;

  const agentTasks = rawTasks.filter(t => String(t.description ?? '').startsWith('[АГЕНТ]'));

  for (const t of agentTasks) {
    const taskId      = Number(t.id);
    if (!taskId) continue;

    const desc        = String(t.description ?? '');
    const leadId      = Number(t.lead_id   ?? 0) || null;
    const clientId    = Number(t.client_id ?? 0) || null;
    const deadlineSec = Number(t.available_to ?? 0);
    const isOverdue   = deadlineSec > 0 && deadlineSec < nowSec;
    const level       = isOverdue ? ('urgent' as const) : ('important' as const);

    const reason   = parseAgentTaskReason(desc);
    const assignee = parseResponsibleNames(t);
    const key      = `AGENT_TASK:task:${taskId}`;

    activeKeys.add(key);

    const isInactive  = reason === 'INACTIVE_7' || reason === 'INACTIVE_10' || reason === 'INACTIVE_14';
    const clientNames = isInactive ? parseInactiveClients(desc) : [];

    let sname = '';
    if (leadId) {
      const lead = leadById.get(leadId);
      if (lead) sname = shortName(lead);
    }
    if (!sname && clientId) {
      sname = nameByClientId.get(clientId) || '';
      if (!sname) {
        const info = await fetchClientInfo(clientId);
        sname = info.sname;
      }
    }
    if (!sname && clientNames.length > 0) sname = `${clientNames.length} клиентов`;

    const deadlineStr = deadlineSec > 0 ? fmtTime(deadlineSec * 1000) : '';
    const ph = {
      name:     sname || `Задача #${taskId}`,
      deadline: deadlineStr,
      assignee: assignee || undefined,
      count:    clientNames.length > 0 ? clientNames.length : undefined,
    };

    toUpsert.push({
      alert_key:       key,
      rule:            'AGENT_TASK',
      level,
      lead_id:         leadId,
      client_id:       clientId,
      registration_id: null,
      manager_name:    assignee || null,
      short_name:      sname || null,
      title:           'Задача от агента',
      body:            pickAgentTaskBody(reason, ph),
      action_hint:     null,
      link:            null,
      meta: {
        task_id:      taskId,
        category:     Number(t.category_id) === TASK_CATEGORY_CALL_ID ? 'Звонок' : 'Задание',
        deadline_sec: deadlineSec || null,
        reason,
        assignee:     assignee || null,
        ...(clientNames.length > 0 ? { client_names: clientNames } : {}),
      },
    });
  }
}

// ── Manager task missed rule ──────────────────────────────────────────────────

async function processManagerTaskMissed(
  nowMs:     number,
  today:     string,
  activeKeys: Set<string>,
  toUpsert:  AlertRow[],
): Promise<void> {
  if (!isEnabled('MANAGER_TASK_MISSED')) return;
  try {
    const missed = await getOverdueMissed(nowMs);
    for (const m of missed) {
      const key = `MANAGER_TASK_MISSED:${today}:${m.templateId}`;
      activeKeys.add(key);
      if (toUpsert.some(r => r.alert_key === key)) continue;
      toUpsert.push({
        alert_key: key, rule: 'MANAGER_TASK_MISSED', level: 'important',
        lead_id: null, client_id: null, registration_id: null,
        manager_name: null, short_name: m.title,
        title: getTitle('MANAGER_TASK_MISSED'),
        body: pickBody('MANAGER_TASK_MISSED', key, { name: m.title, time: m.slotHHMM }),
        action_hint: 'Отметьте задачу в разделе «Менеджер»',
        link: null, meta: { template_id: m.templateId, slot: m.slotHHMM },
      });
    }
  } catch (e) {
    console.error('[watch] processManagerTaskMissed:', (e as Error).message);
  }
}

// ── Shift rules ───────────────────────────────────────────────────────────────

async function processShiftRules(
  nowMs:      number,
  today:      string,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
): Promise<void> {
  const yesterday = almatyDate(nowMs - 86_400_000);

  if (isEnabled('SHIFT_LATE')) {
    try {
      const dow = new Date(nowMs + ALMATY_MS).getUTCDay();
      if (dow >= 1 && dow <= 5) {
        const cutoff = new Date(today + 'T03:15:00Z').toISOString(); // 08:15 YEK
        const { data: lateShifts } = await supabase
          .from('staff_shifts').select('user_id, user_name, started_at')
          .eq('date', today).gt('started_at', cutoff);
        for (const s of (lateShifts ?? []) as Record<string, unknown>[]) {
          const key = `SHIFT_LATE:${today}:${String(s.user_id)}`;
          activeKeys.add(key);
          if (toUpsert.some(r => r.alert_key === key)) continue;
          const time = fmtTime(new Date(String(s.started_at)).getTime());
          toUpsert.push({
            alert_key: key, rule: 'SHIFT_LATE', level: 'important',
            lead_id: null, client_id: null, registration_id: null,
            manager_name: String(s.user_name), short_name: String(s.user_name),
            title: getTitle('SHIFT_LATE'),
            body: pickBody('SHIFT_LATE', key, { name: String(s.user_name), time }),
            action_hint: null, link: null, meta: { user_id: s.user_id, started_at: s.started_at },
          });
        }
      }
    } catch (e) {
      console.error('[watch] processShiftRules SHIFT_LATE:', (e as Error).message);
    }
  }

  if (isEnabled('SHIFT_NOT_CLOSED')) {
    try {
      const { data: autoClosed } = await supabase
        .from('staff_shifts').select('user_id, user_name, started_at')
        .eq('status', 'auto_closed').eq('date', yesterday);
      for (const s of (autoClosed ?? []) as Record<string, unknown>[]) {
        const key = `SHIFT_NOT_CLOSED:${yesterday}:${String(s.user_id)}`;
        activeKeys.add(key);
        if (toUpsert.some(r => r.alert_key === key)) continue;
        toUpsert.push({
          alert_key: key, rule: 'SHIFT_NOT_CLOSED', level: 'important',
          lead_id: null, client_id: null, registration_id: null,
          manager_name: String(s.user_name), short_name: String(s.user_name),
          title: getTitle('SHIFT_NOT_CLOSED'),
          body: pickBody('SHIFT_NOT_CLOSED', key, { name: String(s.user_name) }),
          action_hint: null, link: null, meta: { user_id: s.user_id, date: yesterday },
        });
      }
    } catch (e) {
      console.error('[watch] processShiftRules SHIFT_NOT_CLOSED:', (e as Error).message);
    }
  }
}

// ── Resolve reason inference ──────────────────────────────────────────────────

function inferResolveReason(
  alert:       DbAlert,
  nowMs:       number,
  regByRegId:  Map<number, Record<string, unknown>>,
  leadById:    Map<number, Record<string, unknown>>,
  tasksByLead: Map<number, Task[]>,
  nowSec:      number,
): string {
  const { rule, registration_id, lead_id } = alert;

  if (rule === 'AGENT_TASK') return 'Задача выполнена';
  if (rule === 'MANAGER_TASK_MISSED') return 'Задача выполнена';

  if (registration_id) {
    const reg    = regByRegId.get(registration_id);
    const status = String(reg?.status ?? '');
    if (rule === 'UNCONFIRMED_3H') {
      if (!reg || getRegStartMs(reg) <= nowMs) return 'Занятие началось';
      return ['1', '3'].includes(status) ? 'Запись подтверждена' : 'Неактуально';
    }
    if (rule === 'NO_SHOW_UNCONFIRMED' || rule === 'NO_SHOW_NO_MARK') {
      if (status === '3') return 'Визит отмечен';
      if (status === '4') return 'Отмечена неявка';
      if (status === '1') return 'Запись подтверждена';
    }
    if (rule === 'NO_SHOW_MARKED' && status === '3') return 'Визит отмечен';
    return 'Неактуально';
  }

  if (rule === 'CONTRACT_ENDING' || rule === 'CONTRACT_ENDED') return 'Куплен абонемент';

  if (lead_id) {
    if (rule === 'NEW_LEAD' || rule === 'NEW_LEAD_NO_TASK' || rule === 'NO_TASK') {
      if (analyzeLeadTasks(tasksByLead.get(lead_id) ?? [], nowSec).openTasks.length > 0)
        return 'Задача поставлена';
    }
    if (rule === 'TASK_OVERDUE' || rule === 'TASK_TOO_FAR' || rule === 'CARD_FREE')
      return 'Задача поставлена';
    const lead     = leadById.get(lead_id);
    if (!lead) return 'Карточка закрыта';
    const step     = lead.funnel_step as Record<string, unknown> | undefined;
    const stepName = String(step?.name || '');
    if (stepName) return `Карточка переведена в «${stepName}»`;
    return 'Карточка закрыта';
  }

  return 'Неактуально';
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runWatch(): Promise<Record<string, unknown>> {
  const nowMs  = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();
  const today  = almatyDate(nowMs);
  const t0     = nowMs;

  // Circuit breaker check (Supabase call, always safe before touching Fitbase)
  const pauseUntil = await getCircuitBreakerPauseUntil();
  if (pauseUntil > nowMs) {
    const pauseStr = new Date(pauseUntil).toLocaleTimeString('ru', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' });
    console.log(`[watch] skipped — circuit breaker active until ${pauseStr}`);
    return { status: 'skipped', reason: 'circuit_breaker', pause_until: new Date(pauseUntil).toISOString() };
  }

  // On success after circuit-breaker was active: clear it + send recovery email
  await clearCircuitBreaker();

  const t1 = Date.now();

  // 1. Funnel 1 steps
  const stepItems       = await paginateGet('/purchase-funnel-step', { funnel_id: 1, page_size: 100 });
  const excludedStepIds = buildExcludedStepIds(stepItems);

  // 2. Leads
  const rawLeads = await paginateGet('/lead', { page_size: 100 });
  const leads    = rawLeads.filter(l => isActiveFunnel1Lead(l, excludedStepIds));

  const nameByClientId    = new Map<number, string>();
  const managerByClientId = new Map<number, string>();
  const leadById          = new Map<number, Record<string, unknown>>();
  for (const lead of rawLeads) {
    const lid = Number(lead.id);
    if (lid) leadById.set(lid, lead);
    const cid = Number(lead.client_id ?? 0);
    if (!cid) continue;
    if (!nameByClientId.has(cid)) {
      const sn = shortName(lead);
      if (sn) nameByClientId.set(cid, sn);
    }
    if (!managerByClientId.has(cid)) {
      const mgr = getManager(lead);
      if (mgr) managerByClientId.set(cid, mgr);
    }
  }

  // 3. Open tasks
  const rawTasks    = await paginateGet('/task', { status: 'O', page_size: 100 });
  const tasksByLead = groupTasksByLead(rawTasks);

  const t2 = Date.now();

  // 4. Schedule registrations — single cached load
  const tomorrow = almatyDate(nowMs + 86400_000);
  const { todayRegs, tomorrowRegs } = await loadScheduleRegistrations(today, tomorrow);
  const allRegs = [...todayRegs, ...tomorrowRegs];

  const t3 = Date.now();

  // 5. Last run + purchases
  const lastRunAt = await getLastWatchRunAt();
  const purchases = await loadNewPurchases(lastRunAt);

  // 6. Existing open alerts
  const openAlerts = await loadOpenAlerts();
  const openByKey  = new Map(openAlerts.map(a => [a.alert_key, a]));

  // 7. Compute active conditions
  const activeKeys: Set<string> = new Set();
  const toUpsert:   AlertRow[]  = [];

  for (const lead of leads) {
    processLeadRules(lead, tasksByLead, nowMs, nowSec, activeKeys, toUpsert);
  }
  for (const lead of leads) {
    await processCardFreeRule(lead, tasksByLead, nowSec, activeKeys, toUpsert);
  }

  const scope = env.WATCH_REG_SCOPE;
  for (const reg of allRegs) {
    if (scope === 'trial' && getTrainingId(reg) !== TRIAL_TRAINING_ID) continue;
    await processRegRules(reg, nowMs, nowSec, today, activeKeys, toUpsert);
  }

  for (const p of purchases) {
    processPurchaseRule(p, nowMs, activeKeys, toUpsert, openByKey);
  }

  await processSystemRules(nowMs, activeKeys, toUpsert);
  await processContractRules(nowMs, activeKeys, toUpsert, nameByClientId, managerByClientId);
  await processAgentTaskRules(rawTasks, nowMs, nowSec, activeKeys, toUpsert, nameByClientId, leadById);
  await processManagerTaskMissed(nowMs, today, activeKeys, toUpsert);
  await processShiftRules(nowMs, today, activeKeys, toUpsert);
  try { await retrySheetSync(); } catch (e) { console.error('[watch] retrySheetSync:', (e as Error).message); }

  // 8. Flood guard
  const maxNewPerRule = env.WATCH_MAX_NEW_PER_RULE;
  const newCountByRule = new Map<string, number>();
  for (const row of toUpsert) {
    if (row.rule === 'SYSTEM') continue;
    if (!openByKey.has(row.alert_key)) {
      newCountByRule.set(row.rule, (newCountByRule.get(row.rule) ?? 0) + 1);
    }
  }

  const floodedRules = new Set<string>();
  for (const [rule, count] of newCountByRule) {
    if (count > maxNewPerRule) {
      floodedRules.add(rule);
      console.error(`[watch] flood guard: rule=${rule} count=${count} max=${maxNewPerRule}`);
      const floodKey = `SYSTEM:flood:${rule.toLowerCase()}`;
      activeKeys.add(floodKey);
      toUpsert.push({
        alert_key: floodKey, rule: 'SYSTEM', level: 'urgent',
        lead_id: null, client_id: null, registration_id: null,
        manager_name: null, short_name: null,
        title: 'Лавина тревог',
        body: `Правило ${rule} хочет создать ${count} тревог — проверь настройки`,
        action_hint: null, link: null, meta: { rule, count },
      });
      await alertError(`watch_flood_${rule.toLowerCase()}`, `Rule ${rule} wants ${count} new alerts (max ${maxNewPerRule})`);
    }
  }

  const toUpsertFinal = toUpsert.filter(row => {
    if (row.rule === 'SYSTEM') return true;
    if (!floodedRules.has(row.rule)) return true;
    return openByKey.has(row.alert_key);
  });

  // 9. Upsert
  let upsertCount = 0;
  if (toUpsertFinal.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .upsert(toUpsertFinal, { onConflict: 'alert_key', ignoreDuplicates: true });
    if (error) {
      await alertError('watch_upsert_error', error.message);
      throw new Error(`[watch] upsert error: ${error.message}`);
    }
    upsertCount = toUpsertFinal.length;
  }

  // 9a. AGENT_TASK level upgrade: important → urgent when deadline passes (unack so user sees it)
  const overdueUpgradeKeys = toUpsertFinal
    .filter(r => r.rule === 'AGENT_TASK' && r.level === 'urgent')
    .map(r => r.alert_key)
    .filter(k => {
      const ex = openByKey.get(k);
      return ex && ex.level === 'important';
    });
  if (overdueUpgradeKeys.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .update({ level: 'urgent', acked_at: null })
      .in('alert_key', overdueUpgradeKeys)
      .eq('level', 'important');
    if (error) console.error('[watch] AGENT_TASK upgrade error:', error.message);
    else console.log(`[watch] AGENT_TASK upgraded to urgent: ${overdueUpgradeKeys.length}`);
  }

  // 10. Resolve stale alerts
  const regByRegId = new Map(allRegs.map(r => [Number(r.id), r]));
  const toResolve: Array<{ key: string; reason: string }> = [];

  for (const [key, alert] of openByKey) {
    const ageMs = nowMs - new Date(alert.created_at).getTime();
    const rule  = alert.rule as string;

    if (rule !== 'SYSTEM' && !WATCH_RULES.has(rule)) { toResolve.push({ key, reason: 'Неактуально' }); continue; }
    if (rule === 'PURCHASE'  && ageMs > PURCHASE_TTL_MS)  { toResolve.push({ key, reason: 'Неактуально' }); continue; }
    if (rule === 'CANCELLED' && ageMs > CANCELLED_TTL_MS) { toResolve.push({ key, reason: 'Неактуально' }); continue; }
    if (rule === 'BRIEF') {
      const h = new Date(nowMs + ALMATY_MS).getUTCHours();
      if (h >= 23) { toResolve.push({ key, reason: 'Неактуально' }); continue; }
    }
    if (rule === 'NO_SHOW_MARKED' && alert.acked_at) {
      if (nowMs - new Date(alert.acked_at).getTime() > 24 * 3600_000) { toResolve.push({ key, reason: 'Неактуально' }); continue; }
    }
    if (!activeKeys.has(key)) {
      toResolve.push({ key, reason: inferResolveReason(alert, nowMs, regByRegId, leadById, tasksByLead, nowSec) });
    }
  }

  const seen = new Set<string>();
  const uniqueToResolve = toResolve.filter(({ key }) => !seen.has(key) && !!seen.add(key));

  if (uniqueToResolve.length > 0) {
    const ackedKeys: string[] = [];
    const byReason = new Map<string, string[]>();
    for (const { key, reason } of uniqueToResolve) {
      if (openByKey.get(key)?.acked_at) {
        ackedKeys.push(key);
      } else {
        if (!byReason.has(reason)) byReason.set(reason, []);
        byReason.get(reason)!.push(key);
      }
    }
    if (ackedKeys.length > 0) {
      const { error } = await supabase
        .from('watch_alerts')
        .update({ resolved_at: nowIso })
        .in('alert_key', ackedKeys)
        .is('resolved_at', null);
      if (error) console.error('[watch] resolve error (acked):', error.message);
    }
    for (const [reason, keys] of byReason) {
      const { error } = await supabase
        .from('watch_alerts')
        .update({ resolved_at: nowIso, meta: { resolve_reason: reason } })
        .in('alert_key', keys)
        .is('resolved_at', null);
      if (error) console.error('[watch] resolve error:', error.message);
    }
  }

  // 11. Per-rule stats
  const ruleStats: Record<string, { found: number; created: number; closed: number }> = {};
  for (const row of toUpsertFinal) {
    if (row.rule === 'SYSTEM') continue;
    if (!ruleStats[row.rule]) ruleStats[row.rule] = { found: 0, created: 0, closed: 0 };
    ruleStats[row.rule].found++;
    if (!openByKey.has(row.alert_key)) ruleStats[row.rule].created++;
  }
  for (const { key } of uniqueToResolve) {
    const a = openByKey.get(key);
    if (a && a.rule !== 'SYSTEM') {
      if (!ruleStats[a.rule]) ruleStats[a.rule] = { found: 0, created: 0, closed: 0 };
      ruleStats[a.rule].closed++;
    }
  }

  const tTotal = Date.now() - t0;
  console.log(`[watch] leads=${leads.length} upsert=${upsertCount} resolved=${uniqueToResolve.length} rules=${JSON.stringify(ruleStats)}`);
  console.log(`[watch] timing: setup=${t1-t0}ms leads+tasks=${t2-t1}ms schedule=${t3-t2}ms total=${tTotal}ms`);
  return {
    leads:      leads.length,
    upserted:   upsertCount,
    resolved:   uniqueToResolve.length,
    active:     activeKeys.size,
    rule_stats: ruleStats,
    timing_ms:  tTotal,
  };
}
