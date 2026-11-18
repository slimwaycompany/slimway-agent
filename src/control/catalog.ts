/**
 * Каталог типов автопроверок Control 2.0.
 * В коде — только логика поиска факта. Параметры, пункты, деньги — в настройках.
 */
import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const TZ_MS = 5 * 3600_000;

function yekNow() { return new Date(Date.now() + TZ_MS); }
function yekDate(d?: Date): string { return (d ?? yekNow()).toISOString().slice(0, 10); }

function yekDateMinus(days: number, from?: string): string {
  const base = from ? new Date(from + 'T12:00:00Z').getTime() : (Date.now() + TZ_MS);
  return new Date(base - days * 86400_000).toISOString().slice(0, 10);
}

function minutesBetween(isoA: string, isoB: string): number {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / 60_000;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ParamType = 'number' | 'time' | 'boolean' | 'select';

export interface ParamSchema {
  key: string;
  label: string;
  type: ParamType;
  default: unknown;
  min?: number;
  max?: number;
  options?: string[];
}

export type ViolationSpec = {
  dedup_key: string;
  details: string;
  how_to_fix: string;
  evidence: Record<string, unknown>;
};

export type ManualReviewTarget = 'shift' | 'session' | 'trial' | 'sale' | 'checkin_photo';

export type ManualReviewItem = {
  target_type: ManualReviewTarget;
  target_id: string;
  target_label: string;
};

export type CheckResult =
  | { outcome: 'ok' }
  | { outcome: 'violation'; violations: ViolationSpec[] }
  | { outcome: 'pending'; items: ManualReviewItem[] }
  | { outcome: 'no_data'; reason: string }
  | { outcome: 'error'; error: string };

export interface CheckCtx {
  date: string;             // YYYY-MM-DD
  userName: string;
  branchId: string;
  role: 'call_center' | 'consultant';
  params: Record<string, unknown>;
  // Pre-loaded data
  shifts?: Array<Record<string, unknown>>;         // staff_shifts for this user+day
  schedule?: Record<string, unknown> | null;        // control_shift_schedule row
  visits?: Array<Record<string, unknown>>;          // fitbase_visits for date
  contracts?: Array<Record<string, unknown>>;       // fitbase_contracts for user's clients
  measurements?: Array<Record<string, unknown>>;    // body_measurements
  ibTests?: Array<Record<string, unknown>>;         // inbody_tests
}

export interface CheckType {
  key: string;
  title: string;
  description: string;
  roles: Array<'call_center' | 'consultant'>;
  params: ParamSchema[];
  status: 'ready' | 'soon';
  evaluate(ctx: CheckCtx): Promise<CheckResult>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function p(ctx: CheckCtx, key: string): unknown {
  return ctx.params[key] ?? catalog.find(c => c.key === ctx.role)?.params.find(p => p.key === key)?.default;
}

function pn(ctx: CheckCtx, key: string, def = 0): number {
  const v = Number(ctx.params[key]);
  return isNaN(v) ? def : v;
}

// Get all inbody_tests for a client identified by phone_digits
async function getIbTestsForClient(phoneDigits: string, beforeDate: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('inbody_tests')
    .select('id,test_date,phone_digits')
    .eq('phone_digits', phoneDigits)
    .lt('test_date', beforeDate)
    .order('test_date', { ascending: false });
  return data ?? [];
}

// Get all body_measurements for a client
async function getMeasurementsForClient(clientId: string, beforeDate: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('body_measurements')
    .select('id,measure_date,client_id')
    .eq('client_id', clientId)
    .lt('measure_date', beforeDate)
    .order('measure_date', { ascending: false });
  return data ?? [];
}

// Get remaining visits for a contract (uses fitbase_contracts.raw.visits_left if available)
function getVisitsLeft(contract: Record<string, unknown>): number | null {
  const raw = contract.raw as Record<string, unknown> | null;
  if (raw && typeof raw.visits_left === 'number') return raw.visits_left;
  if (raw && typeof raw.remaining_visits === 'number') return raw.remaining_visits;
  return null;
}

// ── Check implementations ─────────────────────────────────────────────────────

const checkLatenessArrival: CheckType = {
  key: 'lateness_arrival',
  title: 'Приход вовремя',
  description: 'Прийти не позже чем за N минут до начала смены по факту графика.',
  roles: ['call_center', 'consultant'],
  params: [
    { key: 'arrive_before_minutes', label: 'Прийти за, мин', type: 'number', default: 15, min: 0, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const schedule = ctx.schedule;
    if (!schedule) return { outcome: 'no_data', reason: 'Нет записи в графике' };
    const start = (schedule.fact_start ?? schedule.plan_start) as string | null;
    if (!start) return { outcome: 'no_data', reason: 'Нет времени начала смены' };

    const shift = (ctx.shifts ?? []).find(s => s.status === 'open' || s.status === 'closed');
    if (!shift) {
      return {
        outcome: 'violation',
        violations: [{
          dedup_key: `lateness_arrival:${ctx.date}:${ctx.userName}:no_arrival`,
          details: `Нет отметки прихода, смена в графике с ${start}`,
          how_to_fix: 'Нарушение опоздания не исправляется',
          evidence: { schedule_start: start, date: ctx.date },
        }],
      };
    }

    const arriveBeforeMin = pn(ctx, 'arrive_before_minutes', 15);
    const scheduledStart = new Date(`${ctx.date}T${start}:00+05:00`).getTime();
    const dueAt = scheduledStart - arriveBeforeMin * 60_000;
    const arrivedAt = new Date(shift.started_at as string).getTime();

    if (arrivedAt > dueAt) {
      const lateMin = Math.round((arrivedAt - dueAt) / 60_000);
      return {
        outcome: 'violation',
        violations: [{
          dedup_key: `lateness_arrival:${ctx.date}:${ctx.userName}:late`,
          details: `Пришла на ${lateMin} мин позже нормы (нужно в ${new Date(dueAt).toISOString().slice(11, 16)} UTC, пришла в ${new Date(arrivedAt).toISOString().slice(11, 16)} UTC)`,
          how_to_fix: 'Нарушение опоздания не исправляется',
          evidence: { late_minutes: lateMin, due_at: new Date(dueAt).toISOString(), arrived_at: shift.started_at },
        }],
      };
    }
    return { outcome: 'ok' };
  },
};

const checkLatenessLeave: CheckType = {
  key: 'lateness_leave',
  title: 'Уход вовремя',
  description: 'Уйти не раньше конца смены по графику.',
  roles: ['call_center', 'consultant'],
  params: [],
  status: 'ready',
  async evaluate(ctx) {
    const schedule = ctx.schedule;
    if (!schedule) return { outcome: 'no_data', reason: 'Нет записи в графике' };
    const end = (schedule.fact_end ?? schedule.plan_end) as string | null;
    if (!end) return { outcome: 'no_data', reason: 'Нет времени конца смены' };

    const shift = (ctx.shifts ?? []).find(s => s.status === 'closed');
    if (!shift?.ended_at) {
      // Shift not closed yet — check if scheduled end has already passed
      const scheduledEnd = new Date(`${ctx.date}T${end}:00+05:00`).getTime();
      const now = Date.now();
      if (now > scheduledEnd + 30 * 60_000) {
        return {
          outcome: 'violation',
          violations: [{
            dedup_key: `lateness_leave:${ctx.date}:${ctx.userName}:no_leave`,
            details: `Смена не закрыта, хотя она должна была закончиться в ${end}`,
            how_to_fix: 'Нарушение ухода не исправляется',
            evidence: { schedule_end: end, date: ctx.date },
          }],
        };
      }
      return { outcome: 'no_data', reason: 'Смена ещё не закрыта' };
    }

    const scheduledEnd = new Date(`${ctx.date}T${end}:00+05:00`).getTime();
    const leftAt = new Date(shift.ended_at as string).getTime();
    if (leftAt < scheduledEnd - 5 * 60_000) {
      const earlyMin = Math.round((scheduledEnd - leftAt) / 60_000);
      return {
        outcome: 'violation',
        violations: [{
          dedup_key: `lateness_leave:${ctx.date}:${ctx.userName}:early`,
          details: `Ушла на ${earlyMin} мин раньше конца смены (конец в ${end})`,
          how_to_fix: 'Нарушение ухода не исправляется',
          evidence: { early_minutes: earlyMin, schedule_end: end, left_at: shift.ended_at },
        }],
      };
    }
    return { outcome: 'ok' };
  },
};

const checkMeasureInbodyTrial: CheckType = {
  key: 'measure_inbody_trial',
  title: 'InBody на пробном',
  description: 'На пробном занятии обязателен InBody в течение N мин после окончания сеанса.',
  roles: ['consultant'],
  params: [
    { key: 'deadline_minutes', label: 'Срок после сеанса, мин', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const visits = (ctx.visits ?? []).filter(v =>
      v.is_trial && Number(v.status) === 3
    );
    if (!visits.length) return { outcome: 'ok' };

    const deadlineMin = pn(ctx, 'deadline_minutes', 30);
    const violations: ViolationSpec[] = [];

    for (const visit of visits) {
      const clientFitbaseId = String(visit.client_fitbase_id ?? '');
      const visitAt = visit.visit_at as string | undefined;
      if (!clientFitbaseId) continue;

      // Find client phone_digits via fitbase_clients_cache
      const { data: clientRow } = await supabase
        .from('fitbase_clients_cache')
        .select('phone_digits')
        .eq('fitbase_id', clientFitbaseId)
        .maybeSingle();
      if (!clientRow?.phone_digits) continue; // no_data for this visit — skip, don't penalise

      const deadline = visitAt
        ? new Date(new Date(visitAt).getTime() + deadlineMin * 60_000).toISOString()
        : null;

      // Check if InBody taken today for this client
      const today = ctx.date;
      const { data: ib } = await supabase
        .from('inbody_tests')
        .select('id,test_date')
        .eq('phone_digits', String(clientRow.phone_digits))
        .eq('test_date', today)
        .limit(1)
        .maybeSingle();

      if (!ib) {
        violations.push({
          dedup_key: `measure_inbody_trial:${ctx.date}:${ctx.userName}:${clientFitbaseId}`,
          details: `Пробное занятие (клиент ${clientFitbaseId}): нет InBody сегодня`,
          how_to_fix: `Загрузить InBody через QR в течение ${deadlineMin} мин после окончания сеанса`,
          evidence: { visit_id: visit.fitbase_id, client_fitbase_id: clientFitbaseId, deadline, date: ctx.date },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkMeasureFirstVisit: CheckType = {
  key: 'measure_first_visit',
  title: 'InBody + замер на 1-м занятии',
  description: 'На первом занятии по абонементу — InBody и замер тела (все 11 обхватов).',
  roles: ['consultant'],
  params: [
    { key: 'deadline_minutes', label: 'Срок после сеанса, мин', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const visits = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
    const violations: ViolationSpec[] = [];
    const deadlineMin = pn(ctx, 'deadline_minutes', 30);

    for (const visit of visits) {
      const clientFitbaseId = String(visit.client_fitbase_id ?? '');
      if (!clientFitbaseId) continue;

      // Check if this is the first visit on the contract
      // by counting prior visits for the same client/contract
      const { data: priorVisits } = await supabase
        .from('fitbase_visits')
        .select('fitbase_id')
        .eq('client_fitbase_id', clientFitbaseId)
        .neq('fitbase_id', String(visit.fitbase_id))
        .lt('visit_at', String(visit.visit_at ?? ctx.date + 'T23:59:59Z'))
        .eq('status', 3)
        .limit(1);

      if ((priorVisits ?? []).length > 0) continue; // not first

      // This looks like first visit — check InBody + measure
      const { data: clientRow } = await supabase
        .from('fitbase_clients_cache')
        .select('phone_digits,id')
        .eq('fitbase_id', clientFitbaseId)
        .maybeSingle();

      let missingParts: string[] = [];

      // Check InBody today
      if (clientRow?.phone_digits) {
        const { data: ib } = await supabase
          .from('inbody_tests').select('id').eq('phone_digits', String(clientRow.phone_digits))
          .eq('test_date', ctx.date).limit(1).maybeSingle();
        if (!ib) missingParts.push('InBody');
      }

      // Check body measurement today (need a body_client match)
      if (clientRow?.id) {
        const { data: meas } = await supabase
          .from('body_measurements').select('id,measure_date')
          .eq('client_id', String(clientRow.id))
          .eq('measure_date', ctx.date).limit(1).maybeSingle();
        if (!meas) missingParts.push('замер тела');
      } else {
        missingParts.push('замер тела (клиент не найден в замерах)');
      }

      if (missingParts.length) {
        violations.push({
          dedup_key: `measure_first_visit:${ctx.date}:${ctx.userName}:${clientFitbaseId}`,
          details: `Первое занятие клиента ${clientFitbaseId}: нет ${missingParts.join(' и ')}`,
          how_to_fix: `Провести ${missingParts.join(' и ')} в течение ${deadlineMin} мин после сеанса`,
          evidence: { visit_id: visit.fitbase_id, client_fitbase_id: clientFitbaseId, missing: missingParts },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkMeasureLastVisit: CheckType = {
  key: 'measure_last_visit',
  title: 'InBody + замер на последнем занятии',
  description: 'На последнем занятии абонемента (остаток=0) — InBody и замер тела.',
  roles: ['consultant'],
  params: [
    { key: 'deadline_minutes', label: 'Срок после сеанса, мин', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const visits = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
    const violations: ViolationSpec[] = [];
    const deadlineMin = pn(ctx, 'deadline_minutes', 30);

    for (const visit of visits) {
      const clientFitbaseId = String(visit.client_fitbase_id ?? '');
      if (!clientFitbaseId) continue;

      // Find contract for this client — check visits_left
      const contract = (ctx.contracts ?? []).find(c => String(c.client_fitbase_id) === clientFitbaseId);
      if (!contract) continue;

      const visitsLeft = getVisitsLeft(contract);
      if (visitsLeft === null) continue; // no data
      if (visitsLeft > 0) continue; // not last

      const { data: clientRow } = await supabase
        .from('fitbase_clients_cache')
        .select('phone_digits,id')
        .eq('fitbase_id', clientFitbaseId)
        .maybeSingle();

      const missingParts: string[] = [];

      if (clientRow?.phone_digits) {
        const { data: ib } = await supabase
          .from('inbody_tests').select('id').eq('phone_digits', String(clientRow.phone_digits))
          .eq('test_date', ctx.date).limit(1).maybeSingle();
        if (!ib) missingParts.push('InBody');
      }

      if (clientRow?.id) {
        const { data: meas } = await supabase
          .from('body_measurements').select('id')
          .eq('client_id', String(clientRow.id)).eq('measure_date', ctx.date).limit(1).maybeSingle();
        if (!meas) missingParts.push('замер тела');
      } else {
        missingParts.push('замер тела');
      }

      if (missingParts.length) {
        violations.push({
          dedup_key: `measure_last_visit:${ctx.date}:${ctx.userName}:${clientFitbaseId}`,
          details: `Последнее занятие клиента ${clientFitbaseId} (осталось 0): нет ${missingParts.join(' и ')}`,
          how_to_fix: `Провести ${missingParts.join(' и ')} в течение ${deadlineMin} мин после сеанса`,
          evidence: { visit_id: visit.fitbase_id, client_fitbase_id: clientFitbaseId, missing: missingParts, visits_left: visitsLeft },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkMeasureInbodyWeekly: CheckType = {
  key: 'measure_inbody_weekly',
  title: 'InBody раз в неделю',
  description: 'На каждом занятии, если прошло ≥ N дней с предыдущего InBody.',
  roles: ['consultant'],
  params: [
    { key: 'days', label: 'Дней между InBody', type: 'number', default: 7, min: 1, max: 30 },
    { key: 'deadline_minutes', label: 'Срок после сеанса, мин', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const visits = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
    if (!visits.length) return { outcome: 'ok' };

    const days = pn(ctx, 'days', 7);
    const deadlineMin = pn(ctx, 'deadline_minutes', 30);
    const violations: ViolationSpec[] = [];

    for (const visit of visits) {
      const clientFitbaseId = String(visit.client_fitbase_id ?? '');
      if (!clientFitbaseId) continue;

      const { data: clientRow } = await supabase
        .from('fitbase_clients_cache').select('phone_digits').eq('fitbase_id', clientFitbaseId).maybeSingle();
      if (!clientRow?.phone_digits) continue;

      // Last InBody before today
      const { data: lastIb } = await supabase
        .from('inbody_tests').select('test_date').eq('phone_digits', String(clientRow.phone_digits))
        .lt('test_date', ctx.date).order('test_date', { ascending: false }).limit(1).maybeSingle();

      let needsIb = false;
      if (!lastIb) {
        needsIb = true; // No prior InBody at all
      } else {
        const daysSinceLast = Math.floor((new Date(ctx.date).getTime() - new Date(String(lastIb.test_date)).getTime()) / 86400_000);
        needsIb = daysSinceLast >= days;
      }

      if (!needsIb) continue;

      // Check if InBody done today
      const { data: todayIb } = await supabase
        .from('inbody_tests').select('id').eq('phone_digits', String(clientRow.phone_digits))
        .eq('test_date', ctx.date).limit(1).maybeSingle();

      if (!todayIb) {
        violations.push({
          dedup_key: `measure_inbody_weekly:${ctx.date}:${ctx.userName}:${clientFitbaseId}`,
          details: `Клиент ${clientFitbaseId}: прошло ≥${days} дней с прошлого InBody, нет InBody сегодня`,
          how_to_fix: `Провести InBody в течение ${deadlineMin} мин после сеанса`,
          evidence: { client_fitbase_id: clientFitbaseId, last_ib: lastIb?.test_date ?? null, days_threshold: days },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkMeasureBodyMonthly: CheckType = {
  key: 'measure_body_monthly',
  title: 'Замер тела раз в месяц',
  description: 'Раз в N дней при абонементе длиннее M дней — замер тела.',
  roles: ['consultant'],
  params: [
    { key: 'days', label: 'Дней между замерами', type: 'number', default: 30, min: 7, max: 90 },
    { key: 'min_abon_days', label: 'Мин. длина абонемента, дней', type: 'number', default: 31, min: 1, max: 365 },
    { key: 'deadline_minutes', label: 'Срок после сеанса, мин', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const visits = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
    if (!visits.length) return { outcome: 'ok' };

    const days = pn(ctx, 'days', 30);
    const minAbonDays = pn(ctx, 'min_abon_days', 31);
    const deadlineMin = pn(ctx, 'deadline_minutes', 30);
    const violations: ViolationSpec[] = [];

    for (const visit of visits) {
      const clientFitbaseId = String(visit.client_fitbase_id ?? '');
      if (!clientFitbaseId) continue;

      // Check contract length
      const contract = (ctx.contracts ?? []).find(c => String(c.client_fitbase_id) === clientFitbaseId);
      if (!contract) continue;
      const raw = contract.raw as Record<string, unknown> | null;
      const startDate = String(contract.start_date ?? raw?.start_date ?? '');
      const endDate = String(contract.end_date ?? raw?.end_date ?? '');
      if (!startDate || !endDate) continue;
      const abonDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400_000);
      if (abonDays < minAbonDays) continue;

      // Find body_client
      const { data: clientRow } = await supabase
        .from('fitbase_clients_cache').select('id').eq('fitbase_id', clientFitbaseId).maybeSingle();
      if (!clientRow?.id) continue;

      const { data: bodyClient } = await supabase
        .from('body_clients').select('id').eq('fitbase_id', clientFitbaseId).limit(1).maybeSingle();
      const bodyClientId = String(bodyClient?.id ?? clientRow.id ?? '');

      // Last body measurement before today
      const { data: lastMeas } = await supabase
        .from('body_measurements').select('measure_date')
        .eq('client_id', bodyClientId)
        .lt('measure_date', ctx.date)
        .order('measure_date', { ascending: false }).limit(1).maybeSingle();

      let needsMeasure = false;
      if (!lastMeas) {
        needsMeasure = true;
      } else {
        const daysSinceLast = Math.floor((new Date(ctx.date).getTime() - new Date(String(lastMeas.measure_date)).getTime()) / 86400_000);
        needsMeasure = daysSinceLast >= days;
      }

      if (!needsMeasure) continue;

      const { data: todayMeas } = await supabase
        .from('body_measurements').select('id')
        .eq('client_id', bodyClientId).eq('measure_date', ctx.date).limit(1).maybeSingle();

      if (!todayMeas) {
        violations.push({
          dedup_key: `measure_body_monthly:${ctx.date}:${ctx.userName}:${clientFitbaseId}`,
          details: `Клиент ${clientFitbaseId}: прошло ≥${days} дней с прошлого замера тела (абонемент ${abonDays} дней)`,
          how_to_fix: `Провести замер тела в течение ${deadlineMin} мин после сеанса`,
          evidence: { client_fitbase_id: clientFitbaseId, last_meas: lastMeas?.measure_date ?? null, days_threshold: days },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

// Schedule checks (ported from old s5_* logic)

const checkScheduleUnmarked: CheckType = {
  key: 'schedule_unmarked',
  title: 'Статусы записей не висят',
  description: 'Через N мин после начала сеанса у записи должен быть статус.',
  roles: ['consultant'],
  params: [
    { key: 'mark_minutes', label: 'Минут на отметку', type: 'number', default: 30, min: 5, max: 120 },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const markMin = pn(ctx, 'mark_minutes', 30);
    // Find visits today that remain in "unmarked" status (status=0 or 1) past deadline
    const { data: rawVisits, error } = await supabase
      .from('fitbase_visits')
      .select('fitbase_id,client_fitbase_id,visit_at,status,service_name')
      .gte('visit_at', ctx.date + 'T00:00:00Z')
      .lt('visit_at', ctx.date + 'T23:59:59Z')
      .in('status', [0, 1]);
    if (error) return { outcome: 'error', error: error.message };

    const now = Date.now();
    const violations: ViolationSpec[] = [];
    for (const v of rawVisits ?? []) {
      const visitMs = new Date(v.visit_at as string).getTime();
      const dueMs = visitMs + markMin * 60_000;
      if (now < dueMs) continue; // deadline not yet passed
      violations.push({
        dedup_key: `schedule_unmarked:${ctx.date}:${v.fitbase_id}`,
        details: `Запись ${v.fitbase_id} (${v.service_name ?? ''}) зависла без статуса >  ${markMin} мин`,
        how_to_fix: 'Поставить статус «Пришёл» или «Не пришёл» в расписании',
        evidence: { visit_id: v.fitbase_id, client_fitbase_id: v.client_fitbase_id, visit_at: v.visit_at, status: v.status },
      });
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkScheduleWrongAbonement: CheckType = {
  key: 'schedule_wrong_abonement',
  title: 'Правильный абонемент',
  description: 'Визит «Пришёл» должен быть списан с активного подходящего абонемента.',
  roles: ['consultant'],
  params: [],
  status: 'ready',
  async evaluate(ctx) {
    // Visits with status=3 (arrived) but no linked active contract
    const visits = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
    const violations: ViolationSpec[] = [];
    for (const v of visits) {
      const clientFitbaseId = String(v.client_fitbase_id ?? '');
      if (!clientFitbaseId) continue;
      const contract = (ctx.contracts ?? []).find(c =>
        String(c.client_fitbase_id) === clientFitbaseId && c.status !== 'closed'
      );
      if (!contract) {
        violations.push({
          dedup_key: `schedule_wrong_abonement:${ctx.date}:${v.fitbase_id}`,
          details: `Клиент ${clientFitbaseId} отмечен «Пришёл», но нет активного абонемента`,
          how_to_fix: 'Проверить абонемент клиента, при необходимости исправить или оформить',
          evidence: { visit_id: v.fitbase_id, client_fitbase_id: clientFitbaseId },
        });
      }
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkScheduleDeleted: CheckType = {
  key: 'schedule_deleted',
  title: 'Отмены статусом, не удалением',
  description: 'Отменять запись нужно статусом, а не удалением.',
  roles: ['consultant'],
  params: [],
  status: 'ready',
  async evaluate(_ctx) {
    // We can't detect deleted records from Fitbase API — always no_data
    return { outcome: 'no_data', reason: 'Нет доступа к истории удалений Fitbase' };
  },
};

const checkScheduleDoubleBooking: CheckType = {
  key: 'schedule_double_booking',
  title: 'Нет двойных записей',
  description: 'Один аппарат — одна запись в одно время.',
  roles: ['consultant'],
  params: [],
  status: 'ready',
  async evaluate(ctx) {
    // Look for overlapping visits on same resource/apparatus today
    const { data: rawVisits, error } = await supabase
      .from('fitbase_visits')
      .select('fitbase_id,visit_at,resource_name,client_fitbase_id')
      .gte('visit_at', ctx.date + 'T00:00:00Z')
      .lt('visit_at', ctx.date + 'T23:59:59Z')
      .not('resource_name', 'is', null)
      .not('resource_name', 'eq', '');
    if (error) return { outcome: 'error', error: error.message };

    // Group by resource + visit_at
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const v of rawVisits ?? []) {
      const key = `${v.resource_name}|${v.visit_at}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }

    const violations: ViolationSpec[] = [];
    for (const [key, entries] of map) {
      if (entries.length < 2) continue;
      violations.push({
        dedup_key: `schedule_double_booking:${ctx.date}:${key}`,
        details: `Двойная запись на ${key.split('|')[0]}: ${entries.length} клиента в одно время`,
        how_to_fix: 'Удалить лишнюю запись, переставить клиента',
        evidence: { resource: key.split('|')[0], visit_at: key.split('|')[1], count: entries.length },
      });
    }
    return violations.length ? { outcome: 'violation', violations } : { outcome: 'ok' };
  },
};

const checkManual: CheckType = {
  key: 'manual',
  title: 'Ручная проверка',
  description: 'Проверяющий ставит «есть / нет» по каждому объекту смены.',
  roles: ['call_center', 'consultant'],
  params: [
    {
      key: 'target_type',
      label: 'Объект проверки',
      type: 'select',
      default: 'shift',
      options: ['shift', 'session', 'trial', 'sale', 'checkin_photo'],
    },
    { key: 'label', label: 'Вопрос для проверяющего', type: 'select', default: 'Есть?' },
  ],
  status: 'ready',
  async evaluate(ctx) {
    const targetType = String(ctx.params.target_type ?? 'shift') as ManualReviewTarget;
    const label = String(ctx.params.label ?? 'Есть?');

    // Build list of objects to review
    const items: ManualReviewItem[] = [];

    if (targetType === 'shift') {
      items.push({
        target_type: 'shift',
        target_id: `${ctx.date}:${ctx.userName}`,
        target_label: `Смена ${ctx.userName} ${ctx.date}`,
      });
    } else if (targetType === 'session') {
      const sessions = (ctx.visits ?? []).filter(v => Number(v.status) === 3 && !v.is_trial);
      for (const v of sessions) {
        items.push({
          target_type: 'session',
          target_id: String(v.fitbase_id),
          target_label: `Сеанс ${v.service_name ?? v.fitbase_id} клиент ${v.client_fitbase_id}`,
        });
      }
    } else if (targetType === 'trial') {
      const trials = (ctx.visits ?? []).filter(v => v.is_trial && Number(v.status) === 3);
      for (const v of trials) {
        items.push({
          target_type: 'trial',
          target_id: String(v.fitbase_id),
          target_label: `Пробное ${v.client_fitbase_id}`,
        });
      }
    } else if (targetType === 'sale') {
      // Load operations (sales) for this day
      const { data: ops } = await supabase
        .from('fitbase_operations')
        .select('id,client_fitbase_id,amount,op_date')
        .eq('branch_id', ctx.branchId)
        .gte('op_date', ctx.date + 'T00:00:00Z')
        .lt('op_date', ctx.date + 'T23:59:59Z')
        .gt('amount', 0);
      for (const op of ops ?? []) {
        items.push({
          target_type: 'sale',
          target_id: String(op.id),
          target_label: `Продажа ${op.amount}₸ клиент ${op.client_fitbase_id}`,
        });
      }
    } else if (targetType === 'checkin_photo') {
      const shifts = ctx.shifts ?? [];
      for (const shift of shifts) {
        if (shift.photo_in_path) {
          items.push({
            target_type: 'checkin_photo',
            target_id: String(shift.id),
            target_label: `Фото отметки ${ctx.userName} ${ctx.date}`,
          });
        }
      }
    }

    if (!items.length) return { outcome: 'ok' };

    // Upsert review rows and check status
    const pointKey = String(ctx.params._point_key ?? 'manual');
    const checkKey = String(ctx.params._check_key ?? 'manual');
    const reviewBranchId = ctx.branchId;

    const failResults: string[] = [];
    const pendingItems: ManualReviewItem[] = [];

    for (const item of items) {
      const { data: existing } = await supabase
        .from('control_manual_reviews')
        .select('id,result')
        .eq('branch_id', reviewBranchId)
        .eq('shift_date', ctx.date)
        .eq('user_name', ctx.userName)
        .eq('target_type', item.target_type)
        .eq('target_id', item.target_id)
        .eq('check_key', checkKey)
        .maybeSingle();

      if (!existing) {
        // Create review item
        await supabase.from('control_manual_reviews').insert({
          branch_id: reviewBranchId,
          shift_date: ctx.date,
          user_name: ctx.userName,
          target_type: item.target_type,
          target_id: item.target_id,
          target_label: item.target_label,
          check_key: checkKey,
          point_key: pointKey,
          question: label,
          result: null,
        });
        pendingItems.push(item);
      } else if (existing.result === 'fail') {
        failResults.push(item.target_label);
      } else if (existing.result === null) {
        pendingItems.push(item);
      }
      // 'ok' — passes
    }

    if (failResults.length) {
      return {
        outcome: 'violation',
        violations: failResults.map(label => ({
          dedup_key: `manual:${ctx.date}:${ctx.userName}:${checkKey}:${label}`,
          details: `Ручная проверка «${label}» — результат: нет`,
          how_to_fix: `Исправить и попросить проверяющего переотметить`,
          evidence: { check_key: checkKey, label },
        })),
      };
    }
    if (pendingItems.length) {
      return { outcome: 'pending', items: pendingItems };
    }
    return { outcome: 'ok' };
  },
};

// ── Soon checks (no evaluate logic, return no_data) ───────────────────────────

function soonCheck(key: string, title: string, description: string, roles: Array<'call_center' | 'consultant'>, params: ParamSchema[] = []): CheckType {
  return {
    key, title, description, roles, params, status: 'soon',
    async evaluate() { return { outcome: 'no_data', reason: 'Проверка ещё не реализована (этап 3)' }; },
  };
}

const soonChecks: CheckType[] = [
  soonCheck('cc_speed_queue', 'Скорость ответа (очередь)', 'Ответ на заявку в отведённое время с учётом очереди АТС.', ['call_center'], [
    { key: 'queue_minutes', label: 'Время ответа, мин', type: 'number', default: 5, min: 1, max: 30 },
    { key: 'fixation_seconds', label: 'Время на внесение, сек', type: 'number', default: 30, min: 10, max: 300 },
  ]),
  soonCheck('cc_bant_required', 'B.A.N.T. заполнен', 'N и T обязательны к концу первого разговора > 60 сек.', ['call_center'], [
    { key: 'min_call_seconds', label: 'Мин. длина звонка, сек', type: 'number', default: 60, min: 10, max: 300 },
    { key: 'fixation_seconds', label: 'Время на внесение, сек', type: 'number', default: 30, min: 10, max: 300 },
  ]),
  soonCheck('cc_booking_window', 'Запись сегодня-завтра', 'Запись на пробное только на сегодня или завтра.', ['call_center']),
  soonCheck('cc_funnel_outcome', 'Исход после разговора', 'После первого звонка заявка переходит в нужный этап.', ['call_center']),
  soonCheck('cc_funnel_tasks', 'Задачи в срок', 'Задачи по заявкам закрываются с контактом до дедлайна.', ['call_center']),
  soonCheck('cc_followup_materials', 'Follow-up: материалы', 'Материалы отправлены в течение часа после записи.', ['call_center'], [
    { key: 'deadline_minutes', label: 'Срок отправки, мин', type: 'number', default: 60, min: 10, max: 480 },
  ]),
  soonCheck('cc_followup_circle', 'Follow-up: кружок', 'Видео-кружок в WhatsApp вечером накануне пробного.', ['call_center']),
  soonCheck('cc_followup_live_message', 'Follow-up: живое сообщение', 'Исходящее не по шаблону — личное сообщение клиентке.', ['call_center']),
];

// ── Catalog export ─────────────────────────────────────────────────────────────

export const catalog: CheckType[] = [
  checkLatenessArrival,
  checkLatenessLeave,
  checkMeasureInbodyTrial,
  checkMeasureFirstVisit,
  checkMeasureLastVisit,
  checkMeasureInbodyWeekly,
  checkMeasureBodyMonthly,
  checkScheduleUnmarked,
  checkScheduleWrongAbonement,
  checkScheduleDeleted,
  checkScheduleDoubleBooking,
  checkManual,
  ...soonChecks,
];

export function findCheck(key: string): CheckType | undefined {
  return catalog.find(c => c.key === key);
}
