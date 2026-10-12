import { supabase }                              from '../db/supabase';
import { paginateGet, rawGet }                   from '../http/fitbase';
import { shortName }                             from '../core/names';
import { getLeadFunnel }                         from '../core/funnel';
import { env, TRIAL_TRAINING_ID, WATCH_RULES, lookupVisitsOverride } from '../config';

export const JOB_NAME = 'watch';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALMATY_MS         = 5 * 3600 * 1000;
const SEVEN_DAYS_SEC    = 7 * 86400;
const CARD_FREE_SEC     = 24 * 3600;
const PURCHASE_MIN      = 40_000;
const NEW_LEAD_GRACE_MS = 2 * 3600_000;   // 2 h window for new-lead alert
const NEW_LEAD_TASK_MIN = 5 * 60_000;
const PURCHASE_TTL_MS   = 12 * 3600_000;
const CANCELLED_TTL_MS  = 24 * 3600_000;
const SYSTEM_GAP_MS     = 30 * 60_000;
const CONTRACT_TTL_MS   = 30 * 60_000;    // re-check contracts every 30 min

const EXCLUDED_MANAGER_STEPS = new Set(['Ангелина', 'Вера', 'Назерке']);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  status:       string;
  available_to: number;
  lead_id?:     number;
  client_id?:   number;
}

interface DbAlert {
  id:         number;
  alert_key:  string;
  rule:       string;
  created_at: string;
  acked_at:   string | null;
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

// ── In-memory caches ──────────────────────────────────────────────────────────

const commentCache  = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
const watchRegCache = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
let contractBulkCache: { items: Record<string, unknown>[]; ts: number } | null = null;

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

async function loadAllContracts(): Promise<Record<string, unknown>[]> {
  if (contractBulkCache && Date.now() - contractBulkCache.ts < CONTRACT_TTL_MS) {
    return contractBulkCache.items;
  }
  const items = await paginateGet('/client-contract', { page_size: 100 });
  contractBulkCache = { items, ts: Date.now() };
  return items;
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

function getStepName(lead: Record<string, unknown>): string {
  const step = lead.funnel_step as Record<string, unknown> | undefined;
  return String(step?.name || step?.title || '');
}

function getSource(lead: Record<string, unknown>): string {
  const s = lead.source || lead.channel || lead.referral_source;
  return String(s || '');
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
  if (String(lead.title || '').startsWith('ТЕСТ')) return false;
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
    });
  }
  return map;
}

// ── Task analysis for a lead ──────────────────────────────────────────────────

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
  return String(reg.client_name || reg.lead_title || '').trim() || `Запись #${reg.id}`;
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

// ── Plural helper ─────────────────────────────────────────────────────────────

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
    .select('id, alert_key, rule, created_at, acked_at')
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

  // ── NEW_LEAD: 2 h window; close when lead gets any open task ─────────────
  if (isEnabled('NEW_LEAD') && created > 0) {
    const ageMs = nowMs - created;
    if (ageMs < NEW_LEAD_GRACE_MS && ta.openTasks.length === 0) {
      const source = getSource(lead);
      const key    = `NEW_LEAD:lead:${leadId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NEW_LEAD', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: 'Новая заявка',
        body: source ? `${sname}, источник: ${source}` : sname,
        action_hint: 'Возьми в работу',
        link: null, meta: null,
      });
    }
  }

  // ── NEW_LEAD_NO_TASK (disabled by default) ────────────────────────────────
  if (isEnabled('NEW_LEAD_NO_TASK') && created > 0 && nowMs - created > NEW_LEAD_TASK_MIN && ta.futureWithin7d.length === 0) {
    const key = `NEW_LEAD_NO_TASK:lead:${leadId}`;
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'NEW_LEAD_NO_TASK', level: 'urgent',
      lead_id: leadId, client_id: clientId, registration_id: null,
      manager_name: manager, short_name: sname,
      title: 'Новый лид без задачи',
      body: sname,
      action_hint: 'Возьми лид в работу и поставь задачу',
      link: null, meta: null,
    });
  }

  // ── Task rules (disabled by default): priority system ────────────────────
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
          title: 'Просроченная задача',
          body: sname,
          action_hint: 'Закрой или перенеси задачу с комментарием',
          link: null, meta: null,
        });
      }
    } else if (ta.futureWithin7d.length > 0) {
      // OK — has a valid task
    } else if (ta.futureAll.length > 0) {
      if (isEnabled('TASK_TOO_FAR')) {
        const key = `TASK_TOO_FAR:lead:${leadId}`;
        activeKeys.add(key);
        toUpsert.push({
          alert_key: key, rule: 'TASK_TOO_FAR', level: 'important',
          lead_id: leadId, client_id: clientId, registration_id: null,
          manager_name: manager, short_name: sname,
          title: 'Задача слишком далеко',
          body: sname,
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
          title: 'Нет задачи',
          body: sname,
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

  const leadId  = Number(lead.id);
  const clientId = Number(lead.client_id ?? 0);
  if (!clientId) return;

  const tasks       = tasksByLead.get(leadId) ?? [];
  const ta          = analyzeLeadTasks(tasks, nowSec);
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

function processRegRules(
  reg:        Record<string, unknown>,
  nowMs:      number,
  nowSec:     number,
  today:      string,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
): void {
  const regId    = Number(reg.id);
  const status   = String(reg.status ?? '');
  const startMs  = getRegStartMs(reg);
  const sname    = getRegShortName(reg);
  const training = getTrainingName(reg);
  const leadId   = Number(reg.lead_id ?? 0) || null;
  const clientId = Number(reg.client_id ?? 0) || null;

  if (startMs === 0) return;

  const ev      = reg.event as Record<string, unknown> | undefined;
  const evDate  = String(ev?.date || '');
  const isToday = evDate === today;

  // UNCONFIRMED_3H (disabled by default)
  if (isEnabled('UNCONFIRMED_3H') && status === '0' && startMs > nowMs && startMs - nowMs < 3 * 3600_000) {
    const key = `UNCONFIRMED_3H:reg:${regId}`;
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'UNCONFIRMED_3H', level: 'important',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: sname,
      title: 'Не подтверждено',
      body: `${fmtTime(startMs)} — ${sname}, ${training || 'занятие'}`,
      action_hint: 'Позвони и подтверди запись',
      link: null, meta: null,
    });
  }

  // NO_SHOW: 30+ min after start with status 0/1, or already status 4; requires client_id
  if (isEnabled('NO_SHOW') && clientId) {
    const isNoShow01 = (status === '0' || status === '1') && startMs < nowMs && nowMs - startMs > 30 * 60_000;
    const isNoShow4  = status === '4' && startMs < nowMs;
    if (isNoShow01 || isNoShow4) {
      const key = `NO_SHOW:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NO_SHOW', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: sname,
        title: 'Не пришёл на занятие',
        body: `${sname} не пришёл(ла) на ${training || 'занятие'} в ${fmtTime(startMs)}`,
        action_hint: 'Позвони, узнай причину, отметь в расписании',
        link: null, meta: null,
      });
    }
  }

  // CANCELLED (disabled by default)
  if (isEnabled('CANCELLED') && status === '2' && isToday) {
    const key = `CANCELLED:reg:${regId}`;
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'CANCELLED', level: 'important',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: sname,
      title: 'Запись отменена',
      body: `${sname}, ${training || 'занятие'} в ${fmtTime(startMs)}`,
      action_hint: 'Свяжись и перезапиши',
      link: null, meta: null,
    });
  }

  // TRIAL_SOON (disabled by default)
  if (isEnabled('TRIAL_SOON') && getTrainingId(reg) === TRIAL_TRAINING_ID) {
    const minsToStart = (startMs - nowMs) / 60_000;
    if (minsToStart > 0 && minsToStart <= 60) {
      const confirmed = ['1', '3'].includes(status);
      const key       = `TRIAL_SOON:reg:${regId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'TRIAL_SOON', level: 'info',
        lead_id: leadId, client_id: clientId, registration_id: regId,
        manager_name: null, short_name: sname,
        title: 'Пробное скоро',
        body: `В ${fmtTime(startMs)} пробное: ${sname}, запись ${confirmed ? 'подтверждена' : 'не подтверждена'}`,
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

  const orderId  = Number(purchase.id ?? purchase.order_id ?? 0);
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
  }
}

// CONTRACT_ENDING / CONTRACT_ENDED
// shortcut: one alert per client lifetime (key reuse blocked after resolve); add episode suffix when needed
async function processContractRules(
  nowMs:            number,
  activeKeys:       Set<string>,
  toUpsert:         AlertRow[],
  nameByClientId:   Map<number, string>,
  managerByClient:  Map<number, string>,
): Promise<void> {
  if (!isEnabled('CONTRACT_ENDING') && !isEnabled('CONTRACT_ENDED')) return;

  let allContracts: Record<string, unknown>[];
  try {
    allContracts = await loadAllContracts();
  } catch (e) {
    console.error('[watch] loadAllContracts error:', (e as Error).message);
    return;
  }

  // Group by client_id — only qualifying contracts (price >= 40k, not deleted)
  const byClient = new Map<number, Record<string, unknown>[]>();
  for (const c of allContracts) {
    if (Number(c.price_full ?? 0) < PURCHASE_MIN) continue;
    if (String(c.deleted_at ?? '').trim()) continue;
    const clientId = Number(c.client_id ?? (c.client as Record<string, unknown>)?.id ?? 0);
    if (!clientId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId)!.push(c);
  }

  for (const [clientId, clientContracts] of byClient) {
    const sname   = nameByClientId.get(clientId) || `Клиент #${clientId}`;
    const manager = managerByClient.get(clientId) || null;

    // Compute visitsLeft per contract
    interface Entry { closed: boolean; visitsLeft: number; }
    const entries: Entry[] = [];

    for (const c of clientContracts) {
      const ticket    = c.ticket as Record<string, unknown> | null;
      const rawVisits = ticket?.visits;
      const itemName  = String((ticket?.contract_item as Record<string, unknown> | null)?.name ?? '');
      const isClosed  = Boolean(c.closed);

      if (rawVisits !== null && rawVisits !== undefined && Number(rawVisits) > 0) {
        entries.push({ closed: isClosed, visitsLeft: Number(c.visits_left ?? 0) });
      } else if (rawVisits === null) {
        const override = lookupVisitsOverride(itemName);
        if (override !== null) {
          // Per-client reg fetch only for override contracts
          const regs       = await getClientRegs(clientId);
          const contractId = Number(c.id);
          const used = regs.filter(r => {
            if (String(r.status) !== '3') return false;
            const cref = r.contract as Record<string, unknown> | null | undefined;
            return Number(cref?.id ?? r.contract_id ?? -1) === contractId;
          }).length;
          entries.push({ closed: isClosed, visitsLeft: Math.max(0, override - used) });
        }
        // unlimited with no override: skip
      }
    }

    const active          = entries.filter(e => !e.closed && e.visitsLeft > 0);
    const totalVisitsLeft = active.reduce((s, e) => s + e.visitsLeft, 0);

    if (isEnabled('CONTRACT_ENDING') && active.length > 0 && totalVisitsLeft <= 2) {
      const key = `CONTRACT_ENDING:client:${clientId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'CONTRACT_ENDING', level: 'important',
        lead_id: null, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: 'Заканчивается абонемент',
        body: `У ${sname} осталось ${totalVisitsLeft} ${pluralVisits(totalVisitsLeft)}`,
        action_hint: 'Предложи продление',
        link: null, meta: null,
      });
    } else if (isEnabled('CONTRACT_ENDED') && entries.length > 0 && active.length === 0) {
      const key = `CONTRACT_ENDED:client:${clientId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'CONTRACT_ENDED', level: 'urgent',
        lead_id: null, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: 'Абонемент закончился',
        body: `У ${sname} закончился абонемент`,
        action_hint: 'Свяжись, предложи продление',
        link: null, meta: null,
      });
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runWatch(): Promise<Record<string, unknown>> {
  const nowMs  = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();
  const today  = almatyDate(nowMs);

  // 1. Load funnel 1 steps → build excluded ID set
  const stepItems       = await paginateGet('/purchase-funnel-step', { funnel_id: 1, page_size: 100 });
  const excludedStepIds = buildExcludedStepIds(stepItems);

  // 2. Load all leads
  const rawLeads = await paginateGet('/lead', { page_size: 100 });
  const leads    = rawLeads.filter(l => isActiveFunnel1Lead(l, excludedStepIds));

  // Build name/manager maps from ALL leads for contract rule enrichment
  const nameByClientId    = new Map<number, string>();
  const managerByClientId = new Map<number, string>();
  for (const lead of rawLeads) {
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

  // 3. Load all open tasks grouped by lead
  const rawTasks    = await paginateGet('/task', { status: 'O', page_size: 100 });
  const tasksByLead = groupTasksByLead(rawTasks);

  // 4. Load schedule for today and tomorrow
  const tomorrow     = almatyDate(nowMs + 86400_000);
  const todayRegs    = await paginateGet('/schedule-registration', { date: today,    page_size: 100 });
  const tomorrowRegs = await paginateGet('/schedule-registration', { date: tomorrow, page_size: 100 });
  const allRegs      = [...todayRegs, ...tomorrowRegs];

  // 5. Last successful run
  const lastRunAt = await getLastWatchRunAt();

  // 6. New purchases since last run (for PURCHASE rule)
  const purchases = await loadNewPurchases(lastRunAt);

  // 7. Load existing open alerts from DB
  const openAlerts = await loadOpenAlerts();
  const openByKey  = new Map(openAlerts.map(a => [a.alert_key, a]));

  // 8. Compute active conditions
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
    processRegRules(reg, nowMs, nowSec, today, activeKeys, toUpsert);
  }

  for (const p of purchases) {
    processPurchaseRule(p, nowMs, activeKeys, toUpsert, openByKey);
  }

  await processSystemRules(nowMs, activeKeys, toUpsert);
  await processContractRules(nowMs, activeKeys, toUpsert, nameByClientId, managerByClientId);

  // 9. Upsert new alerts
  let upsertCount = 0;
  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .upsert(toUpsert, { onConflict: 'alert_key', ignoreDuplicates: true });
    if (error) console.error('[watch] upsert error:', error.message);
    else upsertCount = toUpsert.length;
  }

  // 10. Resolve stale alerts
  const toResolve: string[] = [];
  for (const [key, alert] of openByKey) {
    const ageMs = nowMs - new Date(alert.created_at).getTime();
    const rule  = alert.rule as string;

    // Disabled rules: close their existing alerts
    if (rule !== 'SYSTEM' && !WATCH_RULES.has(rule)) { toResolve.push(key); continue; }

    // Time-based expiry
    if (rule === 'PURCHASE'  && ageMs > PURCHASE_TTL_MS)  { toResolve.push(key); continue; }
    if (rule === 'CANCELLED' && ageMs > CANCELLED_TTL_MS) { toResolve.push(key); continue; }

    // BRIEF closes at 23:00 Almaty
    if (rule === 'BRIEF') {
      const h = new Date(nowMs + ALMATY_MS).getUTCHours();
      if (h >= 23) { toResolve.push(key); continue; }
    }

    // NO_SHOW: auto-close 24 h after «Принято»
    if (rule === 'NO_SHOW' && alert.acked_at) {
      if (nowMs - new Date(alert.acked_at).getTime() > 24 * 3600_000) { toResolve.push(key); continue; }
    }

    // Condition no longer met
    if (!activeKeys.has(key)) toResolve.push(key);
  }

  const uniqueToResolve = [...new Set(toResolve)];
  if (uniqueToResolve.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .update({ resolved_at: nowIso })
      .in('alert_key', uniqueToResolve)
      .is('resolved_at', null);
    if (error) console.error('[watch] resolve error:', error.message);
  }

  console.log(`[watch] leads=${leads.length} upsert=${upsertCount} resolved=${uniqueToResolve.length}`);
  return {
    leads:    leads.length,
    upserted: upsertCount,
    resolved: uniqueToResolve.length,
    active:   activeKeys.size,
  };
}
