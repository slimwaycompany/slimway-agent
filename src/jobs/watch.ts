import { supabase }            from '../db/supabase';
import { paginateGet, rawGet }  from '../http/fitbase';
import { shortName }            from '../core/names';
import { getLeadFunnel }        from '../core/funnel';
import { alertError }           from '../core/mail';
import { getTitle, pickBody, appendAgentTask, hasAgentTaskNote } from '../core/alertTexts';
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

const ALMATY_MS         = 5 * 3600 * 1000;
const SEVEN_DAYS_SEC    = 7 * 86400;
const CARD_FREE_SEC     = 24 * 3600;
const PURCHASE_MIN      = 40_000;
const NEW_LEAD_GRACE_MS = 2 * 3600_000;
const NEW_LEAD_TASK_MIN = 5 * 60_000;
const PURCHASE_TTL_MS   = 12 * 3600_000;
const CANCELLED_TTL_MS  = 24 * 3600_000;
const SYSTEM_GAP_MS     = 30 * 60_000;
const CONTRACT_TTL_MS   = 30 * 60_000;

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
  lead_id:         number | null;
  client_id:       number | null;
  registration_id: number | null;
  created_at:      string;
  acked_at:        string | null;
  body:            string;
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

const commentCache  = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
const watchRegCache = new Map<number, { items: Record<string, unknown>[]; ts: number }>();
const clientInfoCache = new Map<number, { sname: string; isTest: boolean; ts: number }>();
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

// Fetch client name + test flag; cached per run. Never returns "Запись #N".
async function fetchClientInfo(clientId: number): Promise<{ sname: string; isTest: boolean }> {
  const cached = clientInfoCache.get(clientId);
  if (cached && Date.now() - cached.ts < CONTRACT_TTL_MS) return cached;
  try {
    const resp    = await rawGet(`/client/${clientId}`);
    const c       = ((resp.item ?? resp) as Record<string, unknown>);
    const name    = String(c.name    ?? '').trim();
    const surname = String(c.surname ?? '').trim();
    const isTest  = /тест|test/i.test(name) || /тест|test/i.test(surname);
    const full    = name + (surname ? ' ' + surname : '');
    const sname   = full.trim() ? shortName({ name: full }) : `Клиент #${clientId}`;
    const entry   = { sname, isTest, ts: Date.now() };
    clientInfoCache.set(clientId, entry);
    return entry;
  } catch {
    const entry = { sname: `Клиент #${clientId}`, isTest: false, ts: Date.now() };
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
    .select('id, alert_key, rule, lead_id, client_id, registration_id, created_at, acked_at, body')
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

  // NEW_LEAD / NEW_LEAD_NO_TASK: creation is handled by /run/new-leads (runs every minute).
  // Watch still tracks activeKeys so the resolve pass closes stale alerts correctly.
  if (isEnabled('NEW_LEAD') && created > 0) {
    const ageMs = nowMs - created;
    if (ageMs < NEW_LEAD_GRACE_MS && ta.openTasks.length === 0) {
      activeKeys.add(`NEW_LEAD:lead:${leadId}`);
    }
  }

  if (isEnabled('NEW_LEAD_NO_TASK') && created > 0) {
    const ageMs = nowMs - created;
    const todayAlmaty    = new Date(nowMs + ALMATY_MS).toISOString().slice(0, 10);
    const workStartToday = new Date(todayAlmaty + 'T03:00:00Z').getTime(); // 08:00 Almaty
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

// NO_SHOW: only today's regs with client_id; excludes certain training types.
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

  // Shared fallback name (may be empty for NO_SHOW — we'll fetch below)
  const sname = getRegShortName(reg);

  // UNCONFIRMED_3H: only for trial training (id=16), status 0, start within 3h
  if (isEnabled('UNCONFIRMED_3H') && getTrainingId(reg) === TRIAL_TRAINING_ID
      && status === '0' && startMs > nowMs && startMs - nowMs < 3 * 3600_000) {
    const key   = `UNCONFIRMED_3H:reg:${regId}`;
    const uname = sname || (clientId ? (await fetchClientInfo(clientId)).sname : `Запись #${regId}`);
    activeKeys.add(key);
    toUpsert.push({
      alert_key: key, rule: 'UNCONFIRMED_3H', level: 'important',
      lead_id: leadId, client_id: clientId, registration_id: regId,
      manager_name: null, short_name: uname || null,
      title: getTitle('UNCONFIRMED_3H'),
      body: pickBody('UNCONFIRMED_3H', key, { name: uname || `Запись #${regId}`, time: fmtTime(startMs) }),
      action_hint: null,
      link: null, meta: null,
    });
  }

  // NO_SHOW_* rules: today only, client_id required, excluded training types skipped
  if (clientId && isToday && !WATCH_NO_SHOW_EXCLUDE.has(training.toLowerCase())) {
    const pastStart = startMs < nowMs;
    const past30min = pastStart && nowMs - startMs > 30 * 60_000;
    const needsName = (isEnabled('NO_SHOW_UNCONFIRMED') && status === '0' && past30min)
                   || (isEnabled('NO_SHOW_NO_MARK')     && status === '1' && past30min)
                   || (isEnabled('NO_SHOW_MARKED')       && status === '4' && pastStart);
    const ns = needsName ? (sname || (await fetchClientInfo(clientId)).sname) : '';

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
        link: null, meta: null,
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
        link: null, meta: null,
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
      manager_name: null, short_name: sname || null,
      title: 'Запись отменена',
      body: `${sname || `Запись #${regId}`}, ${training || 'занятие'} в ${fmtTime(startMs)}`,
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

// CONTRACT_ENDING / CONTRACT_ENDED.
// CONTRACT_ENDED only fires if most-recent contract end_date is within CONTRACT_ENDED_DAYS.
// shortcut: one alert per client lifetime (key blocked after first resolve); add episode suffix when needed
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

  // Group by client_id — all non-deleted contracts (trial/unlimited filtered in helper)
  const byClient = new Map<number, Record<string, unknown>[]>();
  for (const c of allContracts) {
    if (String(c.deleted_at ?? '').trim()) continue;
    const clientId = Number(c.client_id ?? (c.client as Record<string, unknown>)?.id ?? 0);
    if (!clientId) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId)!.push(c);
  }

  for (const [clientId, clientContracts] of byClient) {
    // Skip explicitly excluded IDs
    if (WATCH_EXCLUDE_CLIENT_IDS_SET.has(clientId)) continue;

    // Resolve name + test flag
    let sname  = nameByClientId.get(clientId) || '';
    let isTest = sname ? /тест|test/i.test(sname) : false;
    if (!sname) {
      const info = await fetchClientInfo(clientId);
      sname  = info.sname;
      isTest = info.isTest;
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
        link: null, meta: null,
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
        link: null, meta: null,
      });
    }
  }
}

// ── Resolve reason inference ──────────────────────────────────────────────────
// Called only for the !activeKeys.has(key) case (condition cleared).

function inferResolveReason(
  alert:       DbAlert,
  nowMs:       number,
  regByRegId:  Map<number, Record<string, unknown>>,
  leadById:    Map<number, Record<string, unknown>>,
  tasksByLead: Map<number, Task[]>,
  nowSec:      number,
): string {
  const { rule, registration_id, lead_id } = alert;

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

  // 1. Funnel 1 steps
  const stepItems       = await paginateGet('/purchase-funnel-step', { funnel_id: 1, page_size: 100 });
  const excludedStepIds = buildExcludedStepIds(stepItems);

  // 2. Leads
  const rawLeads = await paginateGet('/lead', { page_size: 100 });
  const leads    = rawLeads.filter(l => isActiveFunnel1Lead(l, excludedStepIds));

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

  // 3. Open tasks
  const rawTasks    = await paginateGet('/task', { status: 'O', page_size: 100 });
  const tasksByLead = groupTasksByLead(rawTasks);

  // Agent task maps — open tasks created by the agent ([АГЕНТ] prefix), loaded once
  const agentTaskByLead   = new Map<number, { category: string }>();
  const agentTaskByClient = new Map<number, { category: string }>();
  for (const t of rawTasks) {
    const desc = String(t.description ?? '');
    if (!desc.startsWith('[АГЕНТ]')) continue;
    const catId    = Number(t.category_id ?? 0);
    const category = catId === TASK_CATEGORY_CALL_ID ? 'Звонок' : 'Задание';
    const lid = Number(t.lead_id   ?? 0);
    const cid = Number(t.client_id ?? 0);
    if (lid && !agentTaskByLead.has(lid))     agentTaskByLead.set(lid, { category });
    if (cid && !agentTaskByClient.has(cid))   agentTaskByClient.set(cid, { category });
  }

  // 4. Schedule registrations — load with date param, ALSO filter client-side
  const tomorrow = almatyDate(nowMs + 86400_000);

  const todayRegsRaw    = await paginateGet('/schedule-registration', { date: today,    page_size: 100 });
  const tomorrowRegsRaw = await paginateGet('/schedule-registration', { date: tomorrow, page_size: 100 });

  // Client-side filter guards against API ignoring the date param
  const todayRegs = todayRegsRaw.filter(r => {
    const ev = r.event as Record<string, unknown> | undefined;
    return String(ev?.date || '') === today;
  });
  const tomorrowRegs = tomorrowRegsRaw.filter(r => {
    const ev = r.event as Record<string, unknown> | undefined;
    return String(ev?.date || '') === tomorrow;
  });

  console.log(`[watch] schedule raw today=${todayRegsRaw.length} filtered=${todayRegs.length} tomorrow_raw=${tomorrowRegsRaw.length} filtered=${tomorrowRegs.length}`);

  const allRegs = [...todayRegs, ...tomorrowRegs];

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

  // 8a. Apply agent task notes to NEW alerts (post-processing; existing alerts keep their DB body)
  for (const row of toUpsert) {
    if (row.rule === 'SYSTEM') continue;
    if (openByKey.has(row.alert_key)) continue;
    const agentTask =
      (row.lead_id   ? agentTaskByLead.get(row.lead_id)    : undefined) ||
      (row.client_id ? agentTaskByClient.get(row.client_id) : undefined);
    if (agentTask) row.body = appendAgentTask(row.body, agentTask.category);
  }

  // 8. Flood guard: block rules that want to create too many NEW alerts
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
    return openByKey.has(row.alert_key); // keep existing (already in DB) even if rule is flooded
  });

  // 9. Upsert — throw on error so job_run is marked as 'error'
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

  // 10. Resolve stale alerts
  const regByRegId = new Map(allRegs.map(r => [Number(r.id), r]));
  const leadById   = new Map(rawLeads.map(l => [Number(l.id), l]));
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
    // Alerts already acked keep their meta (reason = 'Принято вручную'); others get reason set.
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

  // 10a. Update body of existing alerts where an agent task appeared after alert was created
  const resolveSet    = new Set(uniqueToResolve.map(r => r.key));
  const toUpdateBody: { id: number; body: string }[] = [];
  for (const [key, alert] of openByKey) {
    if (resolveSet.has(key)) continue;
    if (hasAgentTaskNote(alert.body)) continue;
    const agentTask =
      (alert.lead_id   ? agentTaskByLead.get(alert.lead_id)    : undefined) ||
      (alert.client_id ? agentTaskByClient.get(alert.client_id) : undefined);
    if (!agentTask) continue;
    toUpdateBody.push({ id: alert.id, body: appendAgentTask(alert.body, agentTask.category) });
  }
  for (const upd of toUpdateBody) {
    const { error } = await supabase
      .from('watch_alerts')
      .update({ body: upd.body })
      .eq('id', upd.id);
    if (error) console.error('[watch] body-update error id=' + upd.id + ':', error.message);
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

  console.log(`[watch] leads=${leads.length} upsert=${upsertCount} resolved=${uniqueToResolve.length} rules=${JSON.stringify(ruleStats)}`);
  return {
    leads:      leads.length,
    upserted:   upsertCount,
    resolved:   uniqueToResolve.length,
    active:     activeKeys.size,
    rule_stats: ruleStats,
  };
}
