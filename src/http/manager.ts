import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getSession, requireAdmin, getSessionWithPerms, requirePerm } from './auth';
import { fetchAll, buildClientLeadMap, clMgr, opCid } from './metrics';
import { computePayroll } from './payroll';
import { TRIAL_SERVICE_NAMES, VISIT_CANCELLED_STATUSES, isTrialServiceName } from '../config';

const YEK_MS = 5 * 3600_000;

function yekNow() { return new Date(Date.now() + YEK_MS); }
function yekToday() { return yekNow().toISOString().slice(0, 10); }
function isWeekend() { const d = yekNow().getUTCDay(); return d === 0 || d === 6; }
function isoDowNow() { const d = yekNow().getUTCDay(); return d === 0 ? 7 : d; }
function slotMin(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function nowMin() { const d = yekNow(); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function hhmmOf(slot: string) { return slot.slice(0, 5); }

function taskStatus(sm: number, now: number, done: boolean): 'done' | 'current' | 'overdue' | 'pending' {
  if (done) return 'done';
  if (now < sm) return 'pending';
  if (now < sm + 30) return 'current';
  return 'overdue';
}

function weekdayOk(weekdays: unknown, dow: number): boolean {
  if (!weekdays) return true;
  return (weekdays as number[]).includes(dow);
}

// Exported for watch.ts: returns today's overdue undone template IDs + titles
export async function getOverdueMissed(nowMs: number): Promise<{ templateId: string; title: string; slotHHMM: string }[]> {
  const YEK_MS_L = 5 * 3600_000;
  const today = new Date(nowMs + YEK_MS_L).toISOString().slice(0, 10);
  const d     = new Date(nowMs + YEK_MS_L);
  const now   = d.getUTCHours() * 60 + d.getUTCMinutes();
  const isWknd = (() => { const dd = d.getUTCDay(); return dd === 0 || dd === 6; })();
  const isoDow = (() => { const dd = d.getUTCDay(); return dd === 0 ? 7 : dd; })();

  const [tplRes, doneRes] = await Promise.all([
    supabase.from('manager_task_templates').select('id, title, slot_time, weekend_time, weekdays, scope').eq('is_active', true),
    supabase.from('manager_task_done').select('template_id').eq('task_date', today),
  ]);
  const doneIds = new Set((doneRes.data || []).map((d: Record<string, unknown>) => String(d.template_id)));
  return ((tplRes.data || []) as Record<string, unknown>[])
    .filter(t => (t.scope ?? 'shared') === 'shared') // personal tasks don't have a single overdue state
    .filter(t => weekdayOk(t.weekdays, isoDow))
    .filter(t => !doneIds.has(String(t.id)))
    .map(t => {
      const raw = isWknd && t.weekend_time ? String(t.weekend_time) : String(t.slot_time);
      const hhmm = raw.slice(0, 5);
      const sm = slotMin(hhmm);
      return { templateId: String(t.id), title: String(t.title), slotHHMM: hhmm, sm };
    })
    .filter(t => now >= t.sm + 30) // overdue = 30 min past slot
    .map(({ sm: _, ...rest }) => rest);
}

// ── My Month ─────────────────────────────────────────────────────────────────

const MM_CACHE = new Map<string, { data: unknown; ts: number }>();
const MM_TTL = 5 * 60_000;
const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function prevMonthStr(m: string): string {
  const [yr, mo] = m.split('-').map(Number);
  return mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPayroll(month: string): Promise<{ data: any; closed: boolean }> {
  const { data: cl } = await supabase.from('payroll_month_close')
    .select('snapshot').eq('branch_id', BRANCH_ID).eq('month', `${month}-01`).maybeSingle();
  if (cl?.snapshot) return { data: cl.snapshot, closed: true };
  return { data: await computePayroll(month), closed: false };
}

async function buildMyMonth(fitbaseName: string, appUserId: string, month: string) {
  const [yr, mo] = month.split('-').map(Number);
  const dim = new Date(yr, mo, 0).getDate();
  const mFrom = `${month}-01`;
  const mTo   = `${month}-${String(dim).padStart(2, '0')}`;
  const today = new Date(Date.now() + YEK_MS).toISOString().slice(0, 10);
  const isCurrent = month === today.slice(0, 7);
  const prevMon  = prevMonthStr(month);
  const nsFrom   = new Date(Date.now() + YEK_MS - 14 * 86400_000).toISOString().slice(0, 10);
  const twoYearsAgo = `${yr - 2}-${String(mo).padStart(2, '0')}-01`;
  const twoWeeksLater = new Date(Date.now() + YEK_MS + 14 * 86400_000).toISOString().slice(0, 10);

  // Phase 1: payroll for current + prev month in parallel
  const [{ data: payroll, closed }, { data: prevPayroll }] = await Promise.all([
    getPayroll(month),
    getPayroll(prevMon),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myRow  = (payroll.rows  as any[])?.find((r: any) => r.employee === fitbaseName) ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevRow = (prevPayroll.rows as any[])?.find((r: any) => r.employee === fitbaseName) ?? null;

  // Phase 2: all other data in parallel
  const [
    dimRes, shiftRes, tplRes, tdoneRes, ltaskRes,
    leadsRes, visitsRes, noShowRes, contractsAll,
    clm, trialSalesRes, histOps,
  ] = await Promise.all([
    // 1. metrics_day_input: planned shifts for this employee
    supabase.from('metrics_day_input').select('day,is_day_off')
      .eq('branch_id', BRANCH_ID).gte('day', mFrom).lte('day', mTo)
      .contains('on_shift', [fitbaseName]),

    // 2. staff_shifts: actual worked shifts
    supabase.from('staff_shifts').select('shift_date,status,started_at,ended_at')
      .eq('user_id', appUserId).gte('shift_date', mFrom).lte('shift_date', mTo),

    // 3. manager_task_templates
    supabase.from('manager_task_templates').select('id,weekdays,scope').eq('is_active', true),

    // 4. manager_task_done this month
    supabase.from('manager_task_done').select('template_id,task_date,done_by')
      .gte('task_date', mFrom).lte('task_date', mTo),

    // 5. crm_lead_tasks for this user
    supabase.from('crm_lead_tasks')
      .select('id,description,status,due_at,lead_id,crm_leads(id,title,name,surname)')
      .eq('branch_id', BRANCH_ID).eq('responsible_user_id', appUserId).limit(500),

    // 6. fitbase_leads in month (conversion)
    supabase.from('fitbase_leads').select('client_fitbase_id,manager')
      .gte('created_date', mFrom).lte('created_date', mTo),

    // 7. trial visits in month (conversion)
    supabase.from('fitbase_visits').select('client_fitbase_id,status')
      .eq('is_trial', true).gte('visit_date', mFrom).lte('visit_date', mTo),

    // 8. no-show visits last 14 days
    supabase.from('fitbase_visits').select('fitbase_id,client_fitbase_id,client_name,visit_date')
      .eq('is_trial', true).eq('status', 4).gte('visit_date', nsFrom).lte('visit_date', today),

    // 9. all non-deleted contracts (for active_count + to_call)
    fetchAll((off, lim) =>
      supabase.from('fitbase_contracts')
        .select('client_fitbase_id,name,status,end_date,price')
        .neq('status', 'deleted').range(off, off + lim - 1)
    ),

    // 10. clientLeadMap (conversion + no_show)
    buildClientLeadMap(),

    // 11. trial sold ops in month (conversion)
    supabase.from('fitbase_operations').select('fitbase_id,raw')
      .gte('op_date', mFrom).lte('op_date', mTo)
      .in('item', TRIAL_SERVICE_NAMES as string[]),

    // 12. all sale ops last 2 years (client ownership)
    fetchAll((off, lim) =>
      supabase.from('fitbase_operations').select('cashier,raw,op_date')
        .eq('op_type', 'sale').gte('op_date', twoYearsAgo).range(off, off + lim - 1)
    ),
  ]);

  // ── Derived: shifts ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dimDays = (dimRes.data ?? []) as Array<{ day: string; is_day_off: boolean }>;
  const plannedDates = new Set(dimDays.map(d => d.day));
  const plannedCount = dimDays.length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shiftRows = (shiftRes.data ?? []) as Array<{ shift_date: string; status: string; started_at: string; ended_at: string | null }>;
  const workedShifts = shiftRows.filter(s => s.status !== 'open');
  const workedDates  = new Set(workedShifts.map(s => s.shift_date));
  const workedCount  = workedShifts.length;

  const shiftCalendar = Array.from({ length: dim }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, '0')}`;
    return {
      date:       d,
      planned:    plannedDates.has(d),
      worked:     workedDates.has(d),
      is_today:   d === today,
      is_day_off: dimDays.find(x => x.day === d)?.is_day_off ?? false,
    };
  });

  // ── Plan / Pace ───────────────────────────────────────────────────────────────
  const planAmount  = myRow?.plan_amount  ?? null;
  const factSales   = myRow?.fact_sales   ?? 0;
  const planPct     = myRow?.plan_pct     ?? null;

  let pace = null;
  if (isCurrent && planAmount) {
    const shiftsLeft = dimDays.filter(d => d.day > today).length;
    const remaining  = planAmount - factSales;
    const perShift   = shiftsLeft > 0 && remaining > 0
      ? Math.ceil(remaining / shiftsLeft / 1000) * 1000 : 0;
    pace = { shifts_left: shiftsLeft, per_shift_needed: perShift, done: factSales >= planAmount };
  }

  // ── Forecast ─────────────────────────────────────────────────────────────────
  let forecast = null;
  if (isCurrent && workedCount > 0 && planAmount && plannedCount > 0) {
    const avg = factSales / workedCount;
    const fSales = Math.round(avg * plannedCount);
    const s = myRow.settings;
    const fcs  = factSales > 0 ? fSales / factSales : 0;
    const fNew = Math.round((myRow.new_sales ?? 0) * fcs);
    const fRen = Math.round((myRow.renewals  ?? 0) * fcs);
    const fGds = Math.round((myRow.goods     ?? 0) * fcs);
    const fShifts = s.shifts_count ?? plannedCount;
    const fBonus  = s.plan_bonus_on && payroll.overall_plan_achieved ? s.plan_bonus : 0;
    const fEarned = Math.round(fShifts * s.shift_rate + Math.max(0,fNew)*s.new_sales_pct/100 + Math.max(0,fRen)*s.renewal_pct/100 + Math.max(0,fGds)*s.goods_pct/100 + fBonus + s.premium - s.deduction);
    const pcs  = factSales > 0 ? planAmount / factSales : 1;
    const pNew = Math.round((myRow.new_sales ?? 0) * pcs);
    const pRen = Math.round((myRow.renewals  ?? 0) * pcs);
    const pGds = Math.round((myRow.goods     ?? 0) * pcs);
    const pBonus = s.plan_bonus_on ? s.plan_bonus : 0;
    const pEarned = Math.round(fShifts * s.shift_rate + Math.max(0,pNew)*s.new_sales_pct/100 + Math.max(0,pRen)*s.renewal_pct/100 + Math.max(0,pGds)*s.goods_pct/100 + pBonus + s.premium - s.deduction);
    forecast = { forecast_sales: fSales, forecast_earned: fEarned, if_plan_earned: pEarned };
  }

  // ── Sales ────────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems: Array<{ amount: number; is_refund: boolean }> = [
    ...(myRow?.new_items      ?? []),
    ...(myRow?.renewal_items  ?? []),
    ...(myRow?.goods_items    ?? []),
  ];
  const refItems = allItems.filter((i: any) => i.is_refund);
  const newSaleCount = (myRow?.new_items     ?? []).filter((i: any) => !i.is_refund).length;
  const renSaleCount = (myRow?.renewal_items ?? []).filter((i: any) => !i.is_refund).length;
  const gdsSaleCount = (myRow?.goods_items   ?? []).filter((i: any) => !i.is_refund).length;
  const orderCount   = newSaleCount + renSaleCount + gdsSaleCount;
  const sales = {
    new_count:     newSaleCount,
    new_amount:    myRow?.new_sales ?? 0,
    renewal_count: renSaleCount,
    renewal_amount: myRow?.renewals ?? 0,
    goods_amount:  myRow?.goods ?? 0,
    order_count:   orderCount,
    avg_check:     orderCount > 0 ? Math.round(((myRow?.new_sales??0)+(myRow?.renewals??0)+(myRow?.goods??0)) / orderCount) : 0,
    refund_count:  refItems.length,
    refund_amount: refItems.reduce((s: number, i: any) => s + Math.abs(i.amount), 0),
  };

  // ── Earnings ─────────────────────────────────────────────────────────────────
  const earnings = {
    shifts_amt:      myRow?.shifts_amt       ?? 0,
    new_pct_amt:     myRow?.new_pct_amt      ?? 0,
    renewal_pct_amt: myRow?.renewal_pct_amt  ?? 0,
    goods_pct_amt:   myRow?.goods_pct_amt    ?? 0,
    plan_bonus_amt:  myRow?.plan_bonus_amt   ?? 0,
    premium:         myRow?.settings?.premium   ?? 0,
    deduction:       myRow?.settings?.deduction ?? 0,
    total_earned:    myRow?.total_earned     ?? 0,
    advance:         myRow?.settings?.advance   ?? 0,
    to_pay:          myRow?.to_pay           ?? 0,
    is_draft:        myRow?.is_draft         ?? true,
  };

  // ── Tasks ────────────────────────────────────────────────────────────────────
  const templates = (tplRes.data ?? []) as Array<{ id: string; weekdays: number[] | null; scope: string }>;
  const doneRows  = (tdoneRes.data ?? []) as Array<{ template_id: string; task_date: string; done_by: string }>;
  const myDone    = doneRows.filter(d => d.done_by === appUserId);
  const sharedIds = new Set(templates.filter(t => t.scope === 'shared').map(t => t.id));
  const shared_done = myDone.filter(d => sharedIds.has(d.template_id)).length;

  let checklist_planned = 0;
  for (const tpl of templates.filter(t => t.scope === 'personal')) {
    for (const d of dimDays) {
      const dow = new Date(d.day + 'T00:00:00Z').getUTCDay();
      const dow1 = dow === 0 ? 7 : dow;
      if (!tpl.weekdays || tpl.weekdays.includes(dow1)) checklist_planned++;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadTasks = (ltaskRes.data ?? []) as Array<any>;
  const monthLeadsDone  = leadTasks.filter(t => t.status === 'done' && t.due_at && t.due_at.slice(0,7) === month).length;
  const monthLeadsTotal = leadTasks.filter(t => t.due_at && t.due_at.slice(0,7) === month).length;
  const overdueOpen     = leadTasks.filter(t => t.status === 'open' && t.due_at && t.due_at.slice(0,10) < today);

  const tasks = {
    checklist_planned,
    checklist_done: myDone.length,
    shared_done,
    lead_total: monthLeadsTotal,
    lead_done:  monthLeadsDone,
    overdue: overdueOpen.map((t: any) => ({
      id: t.id, description: t.description, due_at: t.due_at, lead_id: t.lead_id,
      lead_name: t.crm_leads
        ? (t.crm_leads.title || [t.crm_leads.name, t.crm_leads.surname].filter(Boolean).join(' ') || '')
        : '',
    })),
  };

  // ── Clients: last cashier = fitbaseName ──────────────────────────────────────
  const lastCashierMap = new Map<number, { cashier: string; date: string }>();
  for (const op of histOps) {
    const cid = opCid(op);
    if (cid == null) continue;
    const cashier = (op.cashier as string) || '';
    const date    = (op.op_date as string) || '';
    const ex = lastCashierMap.get(cid);
    if (!ex || date > ex.date) lastCashierMap.set(cid, { cashier, date });
  }
  const myClientIds = new Set<number>(
    [...lastCashierMap.entries()].filter(([, v]) => v.cashier === fitbaseName).map(([cid]) => cid)
  );

  const allContracts = contractsAll as Array<{ client_fitbase_id: number; name: string | null; status: string; end_date: string | null; price: number }>;
  const myContracts  = allContracts.filter(c => myClientIds.has(Number(c.client_fitbase_id)));

  const activeCount = new Set(
    myContracts.filter(c => c.end_date && c.end_date >= today && !isTrialServiceName(c.name)).map(c => c.client_fitbase_id)
  ).size;

  // to_call: ending in ±14 days, no longer-running active contract
  const toCallContracts = myContracts.filter(c =>
    !isTrialServiceName(c.name) && c.end_date && c.end_date >= nsFrom && c.end_date <= twoWeeksLater
  );
  const toCallIds = new Set(toCallContracts.map(c => Number(c.client_fitbase_id)));
  const hasLongContract = new Set(
    myContracts.filter(c => toCallIds.has(Number(c.client_fitbase_id)) && !isTrialServiceName(c.name) && c.end_date && c.end_date > twoWeeksLater).map(c => Number(c.client_fitbase_id))
  );
  const toCallFiltered = toCallContracts.filter(c => !hasLongContract.has(Number(c.client_fitbase_id)));
  const toCallClientIds = [...new Set(toCallFiltered.map(c => Number(c.client_fitbase_id)))];

  const { data: cachedClients } = toCallClientIds.length > 0
    ? await supabase.from('fitbase_clients_cache').select('fitbase_client_id,phone,name,surname').in('fitbase_client_id', toCallClientIds)
    : { data: [] as Array<Record<string, unknown>> };
  const phoneMap = new Map(
    (cachedClients ?? []).map((c: Record<string, unknown>) => [
      Number(c.fitbase_client_id),
      { phone: (c.phone as string | null) ?? null, name: ((c.name && c.surname) ? `${c.name} ${c.surname}` : (c.name || c.surname || '')) as string },
    ])
  );

  // Build to_call list (one entry per client, nearest end_date first)
  const toCallMap = new Map<number, { name: string; end_date: string; phone: string | null }>();
  for (const c of toCallFiltered.sort((a, b) => (a.end_date ?? '') < (b.end_date ?? '') ? -1 : 1)) {
    const cid = Number(c.client_fitbase_id);
    if (!toCallMap.has(cid)) {
      const info = phoneMap.get(cid);
      toCallMap.set(cid, { name: info?.name || `Клиент ${cid}`, end_date: c.end_date!, phone: info?.phone ?? null });
    }
  }

  const clients = { active_count: activeCount, to_call: [...toCallMap.values()] };

  // ── Conversion ───────────────────────────────────────────────────────────────
  const monthLeads_ = (leadsRes.data ?? []) as Array<{ client_fitbase_id: number | null; manager: string | null }>;
  const monthVisits_ = (visitsRes.data ?? []) as Array<{ client_fitbase_id: number | null; status: number }>;
  const trialSales_ = (trialSalesRes.data ?? []) as Array<Record<string, unknown>>;

  const myLeads   = monthLeads_.filter(l => l.manager === fitbaseName);
  const myBooked  = monthVisits_.filter(v => !VISIT_CANCELLED_STATUSES.has(v.status) && clMgr(v.client_fitbase_id, clm) === fitbaseName);
  const myVisited = monthVisits_.filter(v => v.status === 3 && clMgr(v.client_fitbase_id, clm) === fitbaseName);
  const mySold    = trialSales_.filter(op => clMgr(opCid(op), clm) === fitbaseName);

  const conversion = {
    leads:       myLeads.length,
    booked:      myBooked.length,
    visited:     myVisited.length,
    sold:        mySold.length,
    booked_pct:  myLeads.length  > 0 ? Math.round(100 * myBooked.length  / myLeads.length)  : null,
    visited_pct: myBooked.length > 0 ? Math.round(100 * myVisited.length / myBooked.length) : null,
    sold_pct:    myVisited.length > 0 ? Math.round(100 * mySold.length    / myVisited.length) : null,
  };

  // ── No-show ──────────────────────────────────────────────────────────────────
  const noShowRows_ = (noShowRes.data ?? []) as Array<{ fitbase_id: number; client_fitbase_id: number | null; client_name: string | null; visit_date: string }>;
  const myNS = noShowRows_.filter(v => clMgr(v.client_fitbase_id, clm) === fitbaseName);

  // Exclude if they attended (status=3) after their no-show
  const nsIds = [...new Set(myNS.map(v => Number(v.client_fitbase_id)).filter(Boolean))];
  const { data: laterVis } = nsIds.length > 0
    ? await supabase.from('fitbase_visits').select('client_fitbase_id').in('client_fitbase_id', nsIds).eq('status', 3).gte('visit_date', nsFrom)
    : { data: [] as Array<Record<string, unknown>> };
  const visitedAfterNs = new Set((laterVis ?? []).map((v: Record<string, unknown>) => Number(v.client_fitbase_id)));
  const cleanNS = myNS.filter(v => !visitedAfterNs.has(Number(v.client_fitbase_id)));

  const no_show = {
    count: cleanNS.length,
    items: cleanNS.map(v => ({ visit_date: v.visit_date, client_name: v.client_name, client_fitbase_id: v.client_fitbase_id })),
  };

  // ── Prev month ───────────────────────────────────────────────────────────────
  const pFact = prevRow?.fact_sales ?? 0;
  const pEarn = prevRow?.total_earned ?? 0;
  const prev_month = {
    fact_sales:    pFact,
    total_earned:  pEarn,
    diff_sales_pct:  pFact > 0 ? Math.round(100 * (factSales - pFact) / pFact) : null,
    diff_earned_pct: pEarn > 0 ? Math.round(100 * ((myRow?.total_earned ?? 0) - pEarn) / pEarn) : null,
  };

  return {
    closed,
    header:        { display_name: myRow?.display_name ?? fitbaseName, month, closed },
    plan:          { plan_amount: planAmount, fact_sales: factSales, plan_pct: planPct },
    pace,
    studio_bonus:  {
      overall_plan_fact:   payroll.overall_plan_fact   ?? 0,
      overall_plan_amount: payroll.overall_plan_amount ?? null,
      pct: payroll.overall_plan_amount ? Math.round(100 * (payroll.overall_plan_fact ?? 0) / payroll.overall_plan_amount) : null,
      plan_bonus_on: myRow?.settings?.plan_bonus_on ?? false,
      plan_bonus:    myRow?.settings?.plan_bonus    ?? 30000,
      achieved:      payroll.overall_plan_achieved  ?? false,
    },
    sales,
    earnings,
    forecast,
    shifts:        { planned: plannedCount, worked: workedCount, schedule: shiftCalendar },
    tasks,
    clients,
    conversion,
    no_show,
    prev_month,
  };
}

export function buildManagerRouter(): Router {
  const r = Router();

  r.use('/kviz/api/manager', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  r.use('/kviz/api/reports', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // GET /today — full day data
  r.get('/kviz/api/manager/today', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today   = yekToday();
      const weekend = isWeekend();
      const now     = nowMin();
      const isoDow  = isoDowNow();

      const [tplRes, doneRes] = await Promise.all([
        supabase.from('manager_task_templates').select('*').eq('is_active', true).order('sort'),
        supabase.from('manager_task_done').select('*').eq('task_date', today),
      ]);
      const templates = ((tplRes.data || []) as Record<string, unknown>[])
        .filter(t => weekdayOk(t.weekdays, isoDow));
      const done      = (doneRes.data || []) as Record<string, unknown>[];
      // shared: first match by template_id; personal: match by template_id + current user
      const doneShared   = new Map(done.map(d => [String(d.template_id), d]));
      const donePersonal = new Map(
        done.filter(d => String(d.done_by) === session.id).map(d => [String(d.template_id), d]),
      );
      const doneMap = { shared: doneShared, personal: donePersonal };

      const storySlots = [...new Set(templates.filter(t => t.stories_slot).map(t => String(t.stories_slot)))];
      const ideasBySlot: Record<string, Record<string, unknown>[]> = {};
      if (storySlots.length > 0) {
        const { data: ideas } = await supabase.from('stories_ideas').select('*')
          .eq('is_active', true).in('slot', storySlots).order('sort');
        for (const idea of (ideas || []) as Record<string, unknown>[]) {
          const s = String(idea.slot);
          (ideasBySlot[s] ??= []).push(idea);
        }
      }

      // Day-of-year for round-robin stories (no same-day repeat)
      const d0      = yekNow();
      const dayOfYear = Math.floor((d0.getTime() - new Date(Date.UTC(d0.getUTCFullYear(), 0, 1)).getTime()) / 86400_000);

      const tasks = templates.map(t => {
        const rawSlot  = weekend && t.weekend_time ? String(t.weekend_time) : String(t.slot_time);
        const hhmm     = hhmmOf(rawSlot);
        const sm       = slotMin(hhmm);
        const scope    = (t.scope as string) ?? 'shared';
        const doneRec  = scope === 'personal' ? doneMap.personal.get(String(t.id)) : doneMap.shared.get(String(t.id));
        const status   = taskStatus(sm, now, !!doneRec);
        const task: Record<string, unknown> = {
          id: t.id, title: t.title, hint: t.hint, category: t.category,
          slot_time: hhmm, slot_min: sm, status, scope,
          done: doneRec ? { done_id: doneRec.id, done_by: doneRec.done_by, done_by_name: doneRec.done_by_name, done_at: doneRec.done_at } : null,
        };
        if (t.stories_slot) {
          const ideas = ideasBySlot[String(t.stories_slot)] || [];
          const offset = ideas.length > 0 ? dayOfYear % ideas.length : 0;
          task.stories_today = [ideas[offset % ideas.length], ideas[(offset + 1) % ideas.length]].filter(Boolean);
          task.stories_all   = ideas;
        }
        return task;
      });

      const DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
      res.json({
        date: today,
        day_of_week: DAYS[yekNow().getUTCDay()],
        is_weekend: weekend,
        user: { id: session.id, display_name: session.display_name, role: session.role },
        tasks,
        stats: {
          total: tasks.length,
          done: tasks.filter(t => t.status === 'done').length,
          overdue: tasks.filter(t => t.status === 'overdue').length,
        },
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /week-reels — this week's reel tasks with completion status
  r.get('/kviz/api/manager/week-reels', async (_req, res) => {
    try {
      const now     = yekNow();
      const today   = yekToday();
      const isoDow  = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
      // Monday of current week
      const mon = new Date(now);
      mon.setUTCDate(now.getUTCDate() - (isoDow - 1));
      const monday = mon.toISOString().slice(0, 10);
      const sunday = new Date(mon.getTime() + 6 * 86400_000).toISOString().slice(0, 10);

      const [tplRes, doneRes] = await Promise.all([
        supabase.from('manager_task_templates')
          .select('id, title, weekdays, stories_slot')
          .eq('is_active', true)
          .not('stories_slot', 'is', null),
        supabase.from('manager_task_done')
          .select('template_id, task_date')
          .gte('task_date', monday)
          .lte('task_date', sunday),
      ]);

      const doneSet = new Set(
        ((doneRes.data || []) as Record<string, unknown>[]).map(d => `${d.template_id}:${d.task_date}`),
      );
      const DAYS_RU = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

      const result = ((tplRes.data || []) as Record<string, unknown>[])
        .flatMap(t => {
          const days = (t.weekdays as number[] | null) ?? [];
          if (days.length === 0) return [];
          return days.map(dow => {
            const offset = dow - isoDow;
            const dObj = new Date(now);
            dObj.setUTCDate(now.getUTCDate() + offset);
            const date = dObj.toISOString().slice(0, 10);
            const isDone = doneSet.has(`${t.id}:${date}`);
            const isPast = date < today;
            return {
              id: t.id, title: t.title,
              day_iso: dow, day_name: DAYS_RU[dow] ?? String(dow),
              date,
              status: isDone ? 'done' : isPast ? 'overdue' : 'pending',
            };
          });
        })
        .sort((a, b) => a.day_iso - b.day_iso);

      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST /tasks/:id/done
  r.post('/kviz/api/manager/tasks/:id/done', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today = yekToday();
      const tid   = req.params.id;
      const { data: tpl } = await supabase.from('manager_task_templates').select('scope').eq('id', tid).maybeSingle();
      const scope = (tpl?.scope as string) ?? 'shared';
      // Use limit(1) — after constraint change multiple rows per template/date are possible for different users
      const baseQ = supabase.from('manager_task_done')
        .select('id, done_by_name, done_at').eq('template_id', tid).eq('task_date', today);
      const { data: exArr } = await (scope === 'personal' ? baseQ.eq('done_by', session.id) : baseQ).limit(1);
      const ex = (exArr as Record<string, unknown>[] | null)?.[0] ?? null;
      if (ex) {
        const message = scope === 'shared' && ex.done_by_name
          ? `уже сделал(а) ${ex.done_by_name} в ${new Date(String(ex.done_at)).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}`
          : null;
        res.json({ ok: true, already: true, message }); return;
      }
      const { data, error } = await supabase.from('manager_task_done')
        .insert({ template_id: tid, task_date: today, done_by: session.id, done_by_name: session.display_name, done_at: new Date().toISOString() })
        .select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, done: data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // DELETE /tasks/:id/done
  r.delete('/kviz/api/manager/tasks/:id/done', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today = yekToday();
      const tid   = req.params.id;
      const { data: tpl } = await supabase.from('manager_task_templates').select('scope').eq('id', tid).maybeSingle();
      const scope = (tpl?.scope as string) ?? 'shared';
      // Non-admin can only delete their own record; admin can delete any (first found)
      const delQ = supabase.from('manager_task_done')
        .select('id, done_by').eq('template_id', tid).eq('task_date', today);
      const { data: exArr } = await (session.role === 'admin' && scope === 'shared'
        ? delQ : delQ.eq('done_by', session.id)).limit(1);
      const ex = (exArr as Record<string, unknown>[] | null)?.[0] ?? null;
      if (!ex) { res.json({ ok: true, not_found: true }); return; }
      await supabase.from('manager_task_done').delete().eq('id', String(ex.id));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /history
  r.get('/kviz/api/manager/history', async (req, res) => {
    try {
      let q = supabase.from('manager_task_done')
        .select('*, manager_task_templates!inner(title, slot_time, category)')
        .order('task_date', { ascending: false }).order('done_at', { ascending: true }).limit(300);
      if (req.query.from) q = q.gte('task_date', String(req.query.from));
      if (req.query.to)   q = q.lte('task_date', String(req.query.to));
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Admin: templates ─────────────────────────────────────────────────────────

  r.get('/kviz/api/manager/templates', async (_req, res) => {
    const { data, error } = await supabase.from('manager_task_templates').select('*').order('sort');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/manager/templates', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await supabase.from('manager_task_templates')
      .insert({ title: b.title, hint: b.hint || null, category: b.category || 'other',
                slot_time: b.slot_time, weekend_time: b.weekend_time || null,
                stories_slot: b.stories_slot || null, sort: b.sort ?? 99, is_active: b.is_active !== false,
                weekdays: b.weekdays ?? null })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.patch('/kviz/api/manager/templates/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase.from('manager_task_templates')
      .update(req.body as Record<string, unknown>).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  // ── Admin: ideas ─────────────────────────────────────────────────────────────

  r.get('/kviz/api/manager/ideas', async (req, res) => {
    let q = supabase.from('stories_ideas').select('*').order('slot').order('sort');
    if (req.query.slot) q = (q as any).eq('slot', String(req.query.slot));
    const { data, error } = await q;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/manager/ideas', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await supabase.from('stories_ideas')
      .insert({ slot: b.slot, idea: b.idea, caption: b.caption || null, sort: b.sort ?? 99, is_active: b.is_active !== false })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.patch('/kviz/api/manager/ideas/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase.from('stories_ideas')
      .update(req.body as Record<string, unknown>).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  // ── Reports (admin only) ──────────────────────────────────────────────────────

  r.get('/kviz/api/reports/tasks', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const session = getSession(req);
      let q = supabase.from('manager_task_done')
        .select('*, manager_task_templates!inner(title, slot_time, category, weekdays)')
        .order('task_date', { ascending: false }).order('done_at', { ascending: true }).limit(500);
      if (req.query.from) q = q.gte('task_date', String(req.query.from));
      if (req.query.to)   q = q.lte('task_date', String(req.query.to));
      // manager sees only own tasks; admin can filter by user or see all
      if (session?.role !== 'admin') {
        q = q.eq('done_by', session?.login ?? '');
      } else if (req.query.user) {
        q = q.eq('done_by_name', String(req.query.user));
      } else if (req.query.mine === '1') {
        q = q.eq('done_by', session?.login ?? '');
      }
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/reports/studio', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('studio_results')
        .select('*, body_clients!inner(name, phone)')
        .order('sent_at', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // InBody report: clients with tests, aggregated (groups by phone_digits)
  r.get('/kviz/api/reports/inbody', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'reports.inbody', 'view', session)) return;
    try {
      type IbTest = { id: string; inbody_id: string; tested_at: string; phone: string | null; phone_digits: string | null; weight: number | null; bfm: number | null; smm: number | null; pbf: number | null; inbody_score: number | null };
      const allTests = (await fetchAll((off, lim) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = supabase.from('inbody_tests')
          .select('id,inbody_id,tested_at,phone,phone_digits,weight,bfm,smm,pbf,inbody_score')
          .order('tested_at', { ascending: true })
          .range(off, off + lim - 1);
        if (req.query.from) q = q.gte('tested_at', String(req.query.from));
        if (req.query.to)   q = q.lte('tested_at', String(req.query.to) + 'T23:59:59');
        return q;
      })) as IbTest[];

      // Group by phone_digits
      const byDigits = new Map<string, IbTest[]>();
      for (const t of allTests) {
        const d = t.phone_digits ?? (t.phone ?? '').replace(/\D/g,'').slice(-10);
        if (!d) continue;
        if (!byDigits.has(d)) byDigits.set(d, []);
        byDigits.get(d)!.push(t);
      }

      // Lookup names: body_clients first, then fitbase_clients_cache fallback
      const digits = [...byDigits.keys()];
      const [{ data: clients }, { data: fbClients }] = digits.length
        ? await Promise.all([
            supabase.from('body_clients').select('id,name,phone,phone_digits').in('phone_digits', digits),
            supabase.from('fitbase_clients_cache').select('name,phone,phone_digits').in('phone_digits', digits),
          ])
        : [{ data: [] }, { data: [] }];
      type ClientRow = { id: string; name: string; phone: string | null; phone_digits: string };
      type FbRow = { name: string; phone: string | null; phone_digits: string };
      const clientByDigits = new Map((clients ?? [] as ClientRow[]).map((c: ClientRow) => [c.phone_digits, c]));
      const fbByDigits = new Map((fbClients ?? [] as FbRow[]).map((c: FbRow) => [c.phone_digits, c]));

      const rows = [...byDigits.entries()].map(([d, ts]) => {
        const sorted = ts.sort((a, b) => a.tested_at.localeCompare(b.tested_at));
        const first = sorted[0], last = sorted[sorted.length - 1];
        const client = clientByDigits.get(d);
        const fb = fbByDigits.get(d);
        return {
          phone_digits: d,
          client_id: client?.id ?? null,
          name: client?.name ?? fb?.name ?? first.inbody_id,
          phone: client?.phone ?? fb?.phone ?? first.phone,
          count: sorted.length,
          first_date: first.tested_at?.slice(0,10),
          last_date:  last.tested_at?.slice(0,10),
          weight_delta: first.weight != null && last.weight != null ? Number(last.weight) - Number(first.weight) : null,
          bfm_delta:    first.bfm != null    && last.bfm != null    ? Number(last.bfm)   - Number(first.bfm)   : null,
          smm_delta:    first.smm != null    && last.smm != null    ? Number(last.smm)   - Number(first.smm)   : null,
          pbf_delta:    first.pbf != null    && last.pbf != null    ? Number(last.pbf)   - Number(first.pbf)   : null,
          score_first:  first.inbody_score,
          score_last:   last.inbody_score,
        };
      }).sort((a, b) => b.count - a.count);

      const totals = {
        tests: allTests.length,
        clients: rows.length,
        bfm_lost: rows.reduce((s, r) => s + (r.bfm_delta != null && r.bfm_delta < 0 ? -r.bfm_delta : 0), 0),
        smm_gained: rows.reduce((s, r) => s + (r.smm_delta != null && r.smm_delta > 0 ? r.smm_delta : 0), 0),
      };

      res.json({ rows, totals, from: req.query.from ?? null, to: req.query.to ?? null });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Trials today ───────────────────────────────────────────────────────────

  r.get('/kviz/api/manager/trials-today', async (req, res) => {
    const sess = getSession(req);
    if (!sess) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const today = yekToday();
      const { data: visits, error: vErr } = await supabase
        .from('fitbase_visits')
        .select('fitbase_id, client_name, visit_at, status')
        .eq('is_trial', true)
        .eq('visit_date', today)
        .not('status', 'in', '(2,4)')
        .order('visit_at', { ascending: true });
      if (vErr) { res.status(500).json({ error: vErr.message }); return; }

      const visitIds = (visits ?? []).map(v => String(v.fitbase_id));
      let reminderMap = new Map<string, string>(); // fitbase_visit_id → status
      if (visitIds.length) {
        const { data: rems } = await supabase
          .from('script_reminders')
          .select('fitbase_visit_id, status')
          .in('fitbase_visit_id', visitIds)
          .like('kind', 'trial_%')
          .order('due_at', { ascending: false });
        for (const rm of (rems ?? [])) {
          if (!reminderMap.has(String(rm.fitbase_visit_id))) {
            reminderMap.set(String(rm.fitbase_visit_id), String(rm.status));
          }
        }
      }

      const result = (visits ?? []).map(v => ({
        fitbase_visit_id: String(v.fitbase_id),
        client_name: v.client_name as string | null,
        visit_time: v.visit_at ? new Date(v.visit_at).toISOString().slice(11, 16) : '',
        status: Number(v.status ?? 0),
        reminder_status: (reminderMap.get(String(v.fitbase_id)) ?? 'none') as 'none' | 'pending' | 'sent' | 'cancelled',
        confirmed: Number(v.status) === 1,
      }));

      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /kviz/api/manager/mapped-staff — admin: list of employees with mapping
  r.get('/kviz/api/manager/mapped-staff', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: mappings, error } = await supabase.from('crm_fitbase_user_map')
        .select('user_id,fitbase_full_name').not('user_id', 'is', null);
      if (error) { console.error('[mapped-staff]:', error.message); res.status(500).json({ error: 'Ошибка загрузки' }); return; }
      const uids = (mappings ?? []).map((m: Record<string, unknown>) => m.user_id as string).filter(Boolean);
      const { data: users } = uids.length > 0
        ? await supabase.from('app_users').select('id,display_name').in('id', uids)
        : { data: [] as Array<Record<string, unknown>> };
      const userMap = new Map((users ?? []).map((u: Record<string, unknown>) => [u.id as string, u.display_name as string]));
      res.json((mappings ?? []).map((m: Record<string, unknown>) => ({
        user_id:           m.user_id,
        fitbase_full_name: m.fitbase_full_name,
        display_name:      userMap.get(m.user_id as string) ?? m.fitbase_full_name,
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /kviz/api/manager/my-month
  r.get('/kviz/api/manager/my-month', async (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const yekNow2 = new Date(Date.now() + YEK_MS).toISOString().slice(0, 7);
    const monthRaw = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : yekNow2;

    let targetUserId = session.id;
    if (req.query.user_id) {
      if (session.role !== 'admin') { res.status(403).json({ error: 'Недостаточно прав' }); return; }
      targetUserId = String(req.query.user_id);
    }

    // Look up fitbase mapping for the target user
    const { data: mapping } = await supabase.from('crm_fitbase_user_map')
      .select('fitbase_full_name').eq('user_id', targetUserId).maybeSingle();
    if (!mapping?.fitbase_full_name) { res.json({ no_mapping: true }); return; }
    const fitbaseName = mapping.fitbase_full_name as string;

    const cacheKey = `${monthRaw}:${fitbaseName}`;
    if (req.query.fresh !== '1') {
      const hit = MM_CACHE.get(cacheKey);
      if (hit && Date.now() - hit.ts < MM_TTL) { res.json(hit.data); return; }
    }

    try {
      const data = await buildMyMonth(fitbaseName, targetUserId, monthRaw);
      MM_CACHE.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (e) {
      console.error('[my-month]:', e);
      res.status(500).json({ error: 'Не удалось загрузить данные, попробуйте ещё раз' });
    }
  });

  return r;
}
