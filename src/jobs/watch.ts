import { supabase }                        from '../db/supabase';
import { paginateGet, rawGet }             from '../http/fitbase';
import { shortName }                       from '../core/names';
import { getLeadFunnel }                   from '../core/funnel';
import { env, TRIAL_TRAINING_ID }          from '../config';

export const JOB_NAME = 'watch';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALMATY_MS         = 5 * 3600 * 1000;
const SEVEN_DAYS_SEC    = 7 * 86400;
const CARD_FREE_SEC     = 24 * 3600;
const PURCHASE_MIN      = 40_000;
const NEW_LEAD_GRACE_MS = 30 * 60_000;
const NEW_LEAD_TASK_MIN = 5 * 60_000;
const PURCHASE_TTL_MS   = 12 * 3600_000;
const CANCELLED_TTL_MS  = 24 * 3600_000;
const SYSTEM_GAP_MS     = 30 * 60_000;

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

// ── In-memory comment cache (30 min) ─────────────────────────────────────────

const commentCache = new Map<number, { items: Record<string, unknown>[]; ts: number }>();

async function getClientComments(clientId: number): Promise<Record<string, unknown>[]> {
  const cached = commentCache.get(clientId);
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.items;
  const resp  = await rawGet(`/note?client_id=${clientId}`);
  const items = ((resp.items || []) as Record<string, unknown>[]);
  commentCache.set(clientId, { items, ts: Date.now() });
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
  overdueOpen:        Task[];   // past deadline
  futureAll:          Task[];   // future deadline (any distance)
  futureWithin7d:     Task[];   // future deadline ≤ 7 days
  earliestOverdueSec: number;   // 0 if none
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
  // Fitbase stores Almaty time (UTC+5) → convert to UTC
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
  lastRunAt:   number,
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

  // ── NEW_LEAD (first 30 min after creation, created after last run) ────────
  if (created > lastRunAt && created > 0) {
    const ageMs = nowMs - created;
    if (ageMs < NEW_LEAD_GRACE_MS) {
      const stepName = getStepName(lead);
      const source   = getSource(lead);
      const key      = `NEW_LEAD:lead:${leadId}`;
      activeKeys.add(key);
      const bodyParts = [sname];
      if (source)   bodyParts.push(source);
      if (stepName) bodyParts.push(`этап: ${stepName}`);
      toUpsert.push({
        alert_key: key, rule: 'NEW_LEAD', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: 'Новый лид',
        body: bodyParts.join(', '),
        action_hint: 'Возьми лид в работу',
        link: null, meta: null,
      });
    }
  }

  // ── NEW_LEAD_NO_TASK (> 5 min, no task со сроком within 7 days) ──────────
  if (created > 0 && nowMs - created > NEW_LEAD_TASK_MIN && ta.futureWithin7d.length === 0) {
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

  // ── Task rules: priority system to avoid noise ─────────────────────────────
  if (ta.overdueOpen.length > 0) {
    // TASK_OVERDUE
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
  } else if (ta.futureWithin7d.length > 0) {
    // OK — has a valid task
  } else if (ta.futureAll.length > 0) {
    // TASK_TOO_FAR — has future tasks but all > 7 days
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
  } else {
    // NO_TASK — no open task with any future deadline
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

async function processCardFreeRule(
  lead:        Record<string, unknown>,
  tasksByLead: Map<number, Task[]>,
  nowSec:      number,
  activeKeys:  Set<string>,
  toUpsert:    AlertRow[],
): Promise<void> {
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
  const regId       = Number(reg.id);
  const status      = String(reg.status ?? '');
  const startMs     = getRegStartMs(reg);
  const sname       = getRegShortName(reg);
  const training    = getTrainingName(reg);
  const leadId      = Number(reg.lead_id ?? 0) || null;
  const clientId    = Number(reg.client_id ?? 0) || null;

  if (startMs === 0) return;

  const ev      = reg.event as Record<string, unknown> | undefined;
  const evDate  = String(ev?.date || '');
  const isToday = evDate === today;

  // UNCONFIRMED_3H: < 3h to start, status 0, hasn't started yet
  if (status === '0' && startMs > nowMs && startMs - nowMs < 3 * 3600_000) {
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

  // NO_CHECKIN_30M: 30+ min after start, status 0 or 1
  if ((status === '0' || status === '1') && nowMs - startMs > 30 * 60_000 && startMs < nowMs) {
    const key = `NO_CHECKIN_30M:reg:${regId}`;
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'NO_CHECKIN_30M', level: 'urgent',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: sname,
      title: 'Нет отметки о визите',
      body: `${sname}, ${training || 'занятие'} в ${fmtTime(startMs)}`,
      action_hint: 'Отметь визит в расписании',
      link: null, meta: null,
    });
  }

  // CANCELLED: status 2 (today or tomorrow) — time-based expiry in resolution step
  if (status === '2' && isToday) {
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

  // TRIAL_SOON (info): 60 min before trial, close after start
  if (getTrainingId(reg) === TRIAL_TRAINING_ID) {
    const minsToStart = (startMs - nowMs) / 60_000;
    if (minsToStart > 0 && minsToStart <= 60) {
      const confirmed   = ['1', '3'].includes(status);
      const key         = `TRIAL_SOON:reg:${regId}`;
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
    // TRIAL_SOON active only until start; when startMs < nowMs → not in activeKeys → resolved
  }
}

function processPurchaseRule(
  purchase:   Record<string, unknown>,
  nowMs:      number,
  activeKeys: Set<string>,
  toUpsert:   AlertRow[],
  openByKey:  Map<string, DbAlert>,
): void {
  const orderId  = Number(purchase.id ?? purchase.order_id ?? 0);
  if (!orderId) return;
  const key = `PURCHASE:order:${orderId}`;

  // Check existing alert age — if > 12h already in DB, skip adding to activeKeys
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
  // Check last successful run gap
  const lastOkMs     = await getLastWatchRunAt();
  const noRunKey     = 'SYSTEM:watch:no_run';
  const errorKey     = 'SYSTEM:watch:fitbase_error';

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
  } else if (lastOkMs === 0) {
    // Never ran — no alert
  }

  // 3+ consecutive errors
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

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runWatch(): Promise<Record<string, unknown>> {
  const nowMs  = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();
  const today  = almatyDate(nowMs);

  // 1. Load funnel 1 steps → build excluded ID set
  const stepItems = await paginateGet('/purchase-funnel-step', { funnel_id: 1, page_size: 100 });
  const excludedStepIds = buildExcludedStepIds(stepItems);

  // 2. Load all leads, filter to funnel 1 active
  const rawLeads = await paginateGet('/lead', { page_size: 100 });
  const leads    = rawLeads.filter(l => isActiveFunnel1Lead(l, excludedStepIds));

  // 3. Load all open tasks grouped by lead
  const rawTasks   = await paginateGet('/task', { status: 'O', page_size: 100 });
  const tasksByLead = groupTasksByLead(rawTasks);

  // 4. Load schedule for today and tomorrow
  const tomorrow     = almatyDate(nowMs + 86400_000);
  const todayRegs    = await paginateGet('/schedule-registration', { date: today,    page_size: 100 });
  const tomorrowRegs = await paginateGet('/schedule-registration', { date: tomorrow, page_size: 100 });
  const allRegs      = [...todayRegs, ...tomorrowRegs];

  // 5. Last successful run (for NEW_LEAD detection and purchase since-date)
  const lastRunAt = await getLastWatchRunAt();

  // 6. New purchases since last run
  const purchases = await loadNewPurchases(lastRunAt);

  // 7. Load existing open alerts from DB
  const openAlerts = await loadOpenAlerts();
  const openByKey  = new Map(openAlerts.map(a => [a.alert_key, a]));

  // 8. Compute active conditions
  const activeKeys: Set<string>  = new Set();
  const toUpsert:   AlertRow[]   = [];

  // Lead-level rules
  for (const lead of leads) {
    processLeadRules(lead, tasksByLead, nowMs, nowSec, lastRunAt, activeKeys, toUpsert);
  }

  // CARD_FREE (requires comment fetch — only for overdue > 24h leads)
  for (const lead of leads) {
    await processCardFreeRule(lead, tasksByLead, nowSec, activeKeys, toUpsert);
  }

  // Registration rules
  const scope = env.WATCH_REG_SCOPE;
  for (const reg of allRegs) {
    if (scope === 'trial' && getTrainingId(reg) !== TRIAL_TRAINING_ID) continue;
    processRegRules(reg, nowMs, nowSec, today, activeKeys, toUpsert);
  }

  // Purchase rule
  for (const p of purchases) {
    processPurchaseRule(p, nowMs, activeKeys, toUpsert, openByKey);
  }

  // System health rule
  await processSystemRules(nowMs, activeKeys, toUpsert);

  // 9. Upsert new alerts (ignoreDuplicates: same key never overwrites existing)
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

    // Time-based expiry (takes priority over activeKeys)
    if (rule === 'PURCHASE'  && ageMs > PURCHASE_TTL_MS)  { toResolve.push(key); continue; }
    if (rule === 'CANCELLED' && ageMs > CANCELLED_TTL_MS) { toResolve.push(key); continue; }

    // BRIEF closes at 23:00 Almaty
    if (rule === 'BRIEF') {
      const h = new Date(nowMs + ALMATY_MS).getUTCHours();
      if (h >= 23) { toResolve.push(key); continue; }
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
