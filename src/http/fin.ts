import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { fetchAll } from './metrics';

const BRANCH = '00000000-0000-0000-0000-000000000001';
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function isAdmin(req: Request, res: Response): boolean {
  if (getSession(req)?.role === 'admin') return true;
  res.status(403).json({ error: 'Только для администратора' }); return false;
}

// ── Staff map (cached 60 s) ────────────────────────────────────────────────────

let _staffCache: { data: Map<string, { display_name: string; hidden: boolean }>; ts: number } | null = null;

export async function getStaffMap(): Promise<Map<string, { display_name: string; hidden: boolean }>> {
  if (_staffCache && Date.now() - _staffCache.ts < 60_000) return _staffCache.data;
  const { data } = await supabase.from('fin_staff')
    .select('fitbase_name,display_name,hidden_in_reports')
    .eq('branch_id', BRANCH).eq('is_active', true);
  const map = new Map<string, { display_name: string; hidden: boolean }>();
  for (const s of (data ?? [])) {
    if (s.fitbase_name) map.set(s.fitbase_name as string, {
      display_name: s.display_name as string,
      hidden: Boolean(s.hidden_in_reports),
    });
  }
  _staffCache = { data: map, ts: Date.now() };
  return map;
}

function invalidateStaffCache() { _staffCache = null; }

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDaysStr(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function getDaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  let d = from;
  while (d <= to) { days.push(d); d = addDaysStr(d, 1); }
  return days;
}

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Week starts on Thursday
function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 3) % 7; // 0 if Thu
  return addDaysStr(dateStr, -diff);
}

function groupDaysByWeek(days: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of days) {
    const ws = weekStartOf(d);
    if (!m.has(ws)) m.set(ws, []);
    m.get(ws)!.push(d);
  }
  return m;
}

function generatePeriods(mode: 'week' | 'month', yekNow: Date) {
  if (mode === 'week') {
    const today = yekNow.toISOString().slice(0, 10);
    const currWs = weekStartOf(today);
    const periods = [];
    for (let i = 7; i >= 0; i--) {
      const ws = addDaysStr(currWs, -i * 7);
      const we = addDaysStr(ws, 6);
      const dFrom = new Date(ws + 'T00:00:00Z');
      const dTo   = new Date(we + 'T00:00:00Z');
      const f = dFrom.getUTCDate(), ft = dFrom.toLocaleString('ru', { month: 'short', timeZone: 'UTC' });
      const t = dTo.getUTCDate(), tt = dTo.toLocaleString('ru', { month: 'short', timeZone: 'UTC' });
      const label = ft === tt ? `${f}–${t} ${ft}` : `${f} ${ft} – ${t} ${tt}`;
      periods.push({ from: ws, to: we, week_start: ws, label });
    }
    return periods;
  } else {
    const periods = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(yekNow.getUTCFullYear(), yekNow.getUTCMonth() - i, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      const from = `${ym}-01`;
      const to = `${ym}-${String(daysInMonth(ym)).padStart(2,'0')}`;
      const label = `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      periods.push({ from, to, label });
    }
    return periods;
  }
}

// ── Revenue from operations ───────────────────────────────────────────────────

async function loadRevByDate(from: string, to: string): Promise<Map<string, { contracts: number; goods: number }>> {
  const ops = await fetchAll((off, lim) =>
    supabase.from('fitbase_operations')
      .select('op_date,amount,op_type,raw')
      .gte('op_date', from).lte('op_date', to)
      .in('op_type', ['sale', 'refund']).gt('amount', 0)
      .range(off, off + lim - 1)
  );
  const m = new Map<string, { contracts: number; goods: number }>();
  for (const op of ops) {
    const date = op.op_date as string;
    const raw = op.raw as Record<string, unknown> | null;
    const isGoods = raw?.item_type !== 'contract';
    const sign = op.op_type === 'refund' ? -1 : 1;
    const amount = Number(op.amount) * sign;
    if (!m.has(date)) m.set(date, { contracts: 0, goods: 0 });
    const r = m.get(date)!;
    if (isGoods) r.goods += amount; else r.contracts += amount;
  }
  return m;
}

// ── TBU cascade ───────────────────────────────────────────────────────────────

interface GroupRow { id: string; name: string; level: string; system_key: string|null; is_active: boolean; sort: number }
interface ItemRow  { id: string; group_id: string; name: string; kind: string; amount_month: number; pct: number|null; pct_base: string|null; is_active: boolean }

function itemValueForDays(
  item: ItemRow,
  days: string[],
  monthStr: string,
  base: number,                       // revenue or margin for the period
  weekInputs: Map<string, Map<string, number>>,
): number {
  const dim = daysInMonth(monthStr);
  const weekGroups = groupDaysByWeek(days);
  let total = 0;
  for (const [ws, wdays] of weekGroups) {
    const manual = weekInputs.get(ws)?.get(item.id);
    if (manual !== undefined) {
      total += manual * wdays.length / 7;
    } else if (item.kind === 'fixed') {
      total += (item.amount_month / dim) * wdays.length;
    } else if (item.kind === 'pct' && item.pct != null) {
      const periodBase = base * wdays.length / days.length;
      total += periodBase * item.pct / 100;
    }
    // kind='manual': 0 without week input
  }
  return total;
}

function computeCascade(
  days: string[],
  monthStr: string,
  revenue: number,
  revContracts: number,
  revGoods: number,
  groups: GroupRow[],
  items: ItemRow[],
  weekInputs: Map<string, Map<string, number>>,
  periodSalary: number,
) {
  const active = items.filter(i => i.is_active);
  const byGroup = new Map<string, ItemRow[]>();
  for (const it of active) {
    if (!byGroup.has(it.group_id)) byGroup.set(it.group_id, []);
    byGroup.get(it.group_id)!.push(it);
  }

  interface GroupResult { group_id: string; name: string; level: string; system_key: string|null; total: number; items: { id: string; name: string; value: number; kind: string; is_editable: boolean }[]; salary_line?: number }

  function calcGroup(g: GroupRow, base: number): GroupResult {
    const gItems = byGroup.get(g.id) ?? [];
    const itResults = gItems.map(it => {
      let b = base;
      if (it.pct_base === 'revenue_all')       b = revenue;
      else if (it.pct_base === 'revenue_contracts') b = revContracts;
      else if (it.pct_base === 'revenue_goods') b = revGoods;
      const value = itemValueForDays(it, days, monthStr, b, weekInputs);
      return { id: it.id, name: it.name, value, kind: it.kind, is_editable: it.kind === 'manual' || it.kind === 'pct' };
    });
    let total = itResults.reduce((s, i) => s + i.value, 0);
    let salaryLine: number | undefined;
    if (g.system_key === 'salary') {
      salaryLine = periodSalary;
      total += periodSalary;
    }
    return { group_id: g.id, name: g.name, level: g.level, system_key: g.system_key, total, items: itResults, ...(salaryLine !== undefined ? { salary_line: salaryLine } : {}) };
  }

  const revGroups  = groups.filter(g => g.is_active && g.level === 'revenue').sort((a,b) => a.sort - b.sort).map(g => calcGroup(g, revenue));
  const totalRevFunds = revGroups.reduce((s, g) => s + g.total, 0);
  const marginalIncome = revenue - totalRevFunds;

  const marginGroups = groups.filter(g => g.is_active && g.level === 'margin').sort((a,b) => a.sort - b.sort).map(g => calcGroup(g, marginalIncome));
  const totalMarginFunds = marginGroups.reduce((s, g) => s + g.total, 0);
  const skd = marginalIncome - totalMarginFunds;

  const skdGroups = groups.filter(g => g.is_active && g.level === 'skd').sort((a,b) => a.sort - b.sort).map(g => calcGroup(g, skd));
  const totalSkdFunds = skdGroups.reduce((s, g) => s + g.total, 0);
  const result = skd - totalSkdFunds;

  return { revenue_funds: revGroups, total_rev_funds: totalRevFunds, marginal_income: marginalIncome, margin_funds: marginGroups, total_margin_funds: totalMarginFunds, skd, skd_funds: skdGroups, total_skd_funds: totalSkdFunds, result };
}

function computeTbuFormula(
  staffSalary: number,
  daysCount: number,
  monthDays: number,
  groups: GroupRow[],
  items: ItemRow[],
): number {
  const active = items.filter(i => i.is_active);
  const byGroup = new Map<string, ItemRow[]>();
  for (const it of active) {
    if (!byGroup.has(it.group_id)) byGroup.set(it.group_id, []);
    byGroup.get(it.group_id)!.push(it);
  }

  // Fixed costs: salary + all fixed items
  let fixed = staffSalary * daysCount / monthDays;
  for (const it of active.filter(i => i.kind === 'fixed')) {
    fixed += (it.amount_month / monthDays) * daysCount;
  }

  // Revenue pct (skip revenue_goods for TBU estimate)
  const revGroupIds = new Set(groups.filter(g => g.level === 'revenue').map(g => g.id));
  const pctRevAll = active.filter(i => i.kind === 'pct' && (i.pct_base === 'revenue_all' || i.pct_base === 'revenue_contracts')).reduce((s, i) => s + Number(i.pct ?? 0), 0);
  const pctRevTotal = active.filter(i => i.kind === 'pct' && revGroupIds.has(i.group_id)).reduce((s, i) => s + Number(i.pct ?? 0), 0);
  const pctMargin = active.filter(i => i.kind === 'pct' && i.pct_base === 'margin').reduce((s, i) => s + Number(i.pct ?? 0), 0);
  const pctShare = pctRevAll / 100 + (pctMargin / 100) * (1 - pctRevTotal / 100);
  return pctShare < 1 ? Math.round(fixed / (1 - pctShare)) : 0;
}

// ── TBU periods ───────────────────────────────────────────────────────────────

async function computeTbuPeriods(mode: 'week' | 'month', salaryMode: 'max' | 'current') {
  const yekNow = new Date(Date.now() + 5 * 3600_000);
  const periods = generatePeriods(mode, yekNow);
  const allFrom = periods[0].from;
  const allTo   = periods[periods.length - 1].to;

  // Load config + operations
  const [{ data: staffRaw }, { data: groupsRaw }, { data: itemsRaw }, { data: wiRaw }, revByDate] = await Promise.all([
    supabase.from('fin_staff').select('id,display_name,monthly_salary,in_payroll').eq('branch_id', BRANCH).eq('is_active', true),
    supabase.from('fin_expense_groups').select('*').eq('branch_id', BRANCH).order('sort'),
    supabase.from('fin_expense_items').select('*').eq('branch_id', BRANCH).order('sort'),
    supabase.from('fin_week_input').select('week_start,item_id,amount').eq('branch_id', BRANCH).gte('week_start', allFrom).lte('week_start', allTo),
    loadRevByDate(allFrom, allTo),
  ]);

  const staff   = (staffRaw  ?? []) as unknown as GroupRow[];   // reuse type slot
  const groups  = (groupsRaw ?? []) as GroupRow[];
  const items   = (itemsRaw  ?? []) as ItemRow[];
  const totalStaffSalary = (staffRaw ?? []).reduce((s, r) => s + Number((r as Record<string,unknown>).monthly_salary ?? 0), 0);

  const weekInputs = new Map<string, Map<string, number>>();
  for (const wi of (wiRaw ?? [])) {
    const ws = wi.week_start as string;
    if (!weekInputs.has(ws)) weekInputs.set(ws, new Map());
    weekInputs.get(ws)!.set(wi.item_id as string, Number(wi.amount));
  }

  // For salary=current, load payroll snapshots (prorate per period)
  const payrollByMonth = new Map<string, number>();
  if (salaryMode === 'current') {
    const monthsNeeded = [...new Set(periods.map(p => p.from.slice(0, 7)))];
    for (const ym of monthsNeeded) {
      const { data: snap } = await supabase.from('payroll_month_close')
        .select('snapshot').eq('branch_id', BRANCH).eq('month', `${ym}-01`).maybeSingle();
      if (snap?.snapshot) {
        const s = snap.snapshot as Record<string, unknown>;
        const totals = s.totals as Record<string, unknown> | null;
        if (totals?.total_earned != null) payrollByMonth.set(ym, Number(totals.total_earned));
      } else {
        // Estimate from settings (shifts_amt + pct earnings - no plan bonus for forecast)
        const { data: empRows } = await supabase.from('payroll_month_employee')
          .select('shift_rate,shifts_count,new_sales_pct,renewal_pct,goods_pct,premium,deduction')
          .eq('branch_id', BRANCH).eq('month', `${ym}-01`);
        const roughSalary = (empRows ?? []).reduce((s: number, r: Record<string,unknown>) => {
          const shifts = Number(r.shifts_count ?? 0);
          return s + shifts * Number(r.shift_rate ?? 0) + Number(r.premium ?? 0) - Number(r.deduction ?? 0);
        }, 0);
        payrollByMonth.set(ym, roughSalary || totalStaffSalary);
      }
    }
  }

  let cumulative = 0;
  const results = periods.map(period => {
    const days     = getDaysInRange(period.from, period.to);
    const monthStr = period.from.slice(0, 7);
    const dim      = daysInMonth(monthStr);

    let revContracts = 0, revGoods = 0;
    for (const d of days) {
      const r = revByDate.get(d);
      if (r) { revContracts += r.contracts; revGoods += r.goods; }
    }
    const revenue = revContracts + revGoods;

    const periodSalary = salaryMode === 'current'
      ? (payrollByMonth.get(monthStr) ?? totalStaffSalary) * days.length / dim
      : totalStaffSalary * days.length / dim;

    const cascade = computeCascade(days, monthStr, revenue, revContracts, revGoods, groups, items, weekInputs, periodSalary);
    const tbu     = computeTbuFormula(salaryMode === 'current' ? periodSalary / (days.length / dim) * dim : totalStaffSalary, days.length, dim, groups, items);
    const tbu_pct = tbu > 0 ? Math.round(revenue * 100 / tbu) : null;
    cumulative += Math.round(cascade.result);

    // Waterfall steps for the chart (groups only, for brevity)
    const waterfall: { name: string; value: number; running: number; is_milestone: boolean }[] = [];
    let running = 0;
    waterfall.push({ name: 'Выручка', value: revenue, running: revenue, is_milestone: true }); running = revenue;
    for (const g of cascade.revenue_funds) { const v = -Math.round(g.total); waterfall.push({ name: g.name, value: v, running: running + v, is_milestone: false }); running += v; }
    waterfall.push({ name: 'Маржа', value: Math.round(cascade.marginal_income), running: Math.round(cascade.marginal_income), is_milestone: true }); running = Math.round(cascade.marginal_income);
    for (const g of cascade.margin_funds) { const v = -Math.round(g.total); waterfall.push({ name: g.name, value: v, running: running + v, is_milestone: false }); running += v; }
    waterfall.push({ name: 'СКД', value: Math.round(cascade.skd), running: Math.round(cascade.skd), is_milestone: true }); running = Math.round(cascade.skd);
    for (const g of cascade.skd_funds) { const v = -Math.round(g.total); waterfall.push({ name: g.name, value: v, running: running + v, is_milestone: false }); running += v; }
    waterfall.push({ name: 'Итог', value: Math.round(cascade.result), running: Math.round(cascade.result), is_milestone: true });

    return {
      ...period,
      revenue, rev_contracts: Math.round(revContracts), rev_goods: Math.round(revGoods),
      marginal_income: Math.round(cascade.marginal_income),
      skd: Math.round(cascade.skd),
      result: Math.round(cascade.result),
      tbu, tbu_pct,
      cumulative,
      revenue_funds: cascade.revenue_funds, margin_funds: cascade.margin_funds, skd_funds: cascade.skd_funds,
      waterfall,
    };
  });

  // Build table rows
  const tableGroups = [...groups].filter(g => g.is_active).sort((a, b) => a.sort - b.sort);
  const tableRows: { id: string; name: string; indent: number; is_milestone: boolean; values: (number|null)[]; kind?: string; item_id?: string }[] = [];

  tableRows.push({ id: 'revenue',   name: 'Выручка',        indent: 0, is_milestone: true, values: results.map(r => r.revenue) });
  tableRows.push({ id: 'rev_c',     name: 'Абонементы',     indent: 1, is_milestone: false, values: results.map(r => r.rev_contracts) });
  tableRows.push({ id: 'rev_g',     name: 'Мерч',           indent: 1, is_milestone: false, values: results.map(r => r.rev_goods) });
  for (const g of tableGroups.filter(g => g.level === 'revenue')) {
    tableRows.push({ id: `g_${g.id}`, name: `− ${g.name}`, indent: 0, is_milestone: false, values: results.map(r => -Math.round(r.revenue_funds.find(f => f.group_id === g.id)?.total ?? 0)) });
    for (const it of (items.filter(i => i.is_active && i.group_id === g.id))) {
      tableRows.push({ id: `i_${it.id}`, name: it.name, indent: 1, is_milestone: false, kind: it.kind, item_id: it.id, values: results.map(r => { const gf = r.revenue_funds.find(f => f.group_id === g.id); return gf ? -Math.round(gf.items.find(i => i.id === it.id)?.value ?? 0) : null; }) });
    }
  }
  tableRows.push({ id: 'margin', name: 'Маржинальный доход', indent: 0, is_milestone: true, values: results.map(r => r.marginal_income) });
  for (const g of tableGroups.filter(g => g.level === 'margin')) {
    tableRows.push({ id: `g_${g.id}`, name: `− ${g.name}`, indent: 0, is_milestone: false, values: results.map(r => -Math.round(r.margin_funds.find(f => f.group_id === g.id)?.total ?? 0)) });
    if (g.system_key === 'salary') {
      tableRows.push({ id: `g_${g.id}_salary`, name: 'Оклады', indent: 1, is_milestone: false, values: results.map(r => { const mf = r.margin_funds.find(f => f.group_id === g.id); return mf ? -Math.round((mf as unknown as Record<string,unknown>).salary_line as number ?? 0) : null; }) });
    }
    for (const it of (items.filter(i => i.is_active && i.group_id === g.id))) {
      tableRows.push({ id: `i_${it.id}`, name: it.name, indent: 1, is_milestone: false, kind: it.kind, item_id: it.id, values: results.map(r => { const gf = r.margin_funds.find(f => f.group_id === g.id); return gf ? -Math.round(gf.items.find(i => i.id === it.id)?.value ?? 0) : null; }) });
    }
  }
  tableRows.push({ id: 'skd', name: 'СКД', indent: 0, is_milestone: true, values: results.map(r => r.skd) });
  for (const g of tableGroups.filter(g => g.level === 'skd')) {
    tableRows.push({ id: `g_${g.id}`, name: `− ${g.name}`, indent: 0, is_milestone: false, values: results.map(r => -Math.round(r.skd_funds.find(f => f.group_id === g.id)?.total ?? 0)) });
    for (const it of (items.filter(i => i.is_active && i.group_id === g.id))) {
      tableRows.push({ id: `i_${it.id}`, name: it.name, indent: 1, is_milestone: false, kind: it.kind, item_id: it.id, values: results.map(r => { const gf = r.skd_funds.find(f => f.group_id === g.id); return gf ? -Math.round(gf.items.find(i => i.id === it.id)?.value ?? 0) : null; }) });
    }
  }
  tableRows.push({ id: 'result', name: 'Итог', indent: 0, is_milestone: true, values: results.map(r => r.result) });
  tableRows.push({ id: 'ctrl_tbu_pct', name: 'Выполнение ТБУ %', indent: 0, is_milestone: false, values: results.map(r => r.tbu_pct) });
  tableRows.push({ id: 'ctrl_vs_tbu',  name: 'Выручка − ТБУ',     indent: 0, is_milestone: false, values: results.map(r => r.revenue - (r.tbu ?? 0)) });
  tableRows.push({ id: 'ctrl_cumul',   name: 'Нарастающий итог',   indent: 0, is_milestone: false, values: results.map(r => r.cumulative) });

  return { mode, salary: salaryMode, periods: results, table_rows: tableRows };
}

// ── TBU summary for Settings panel ───────────────────────────────────────────

async function computeTbuSummary() {
  const yekNow = new Date(Date.now() + 5 * 3600_000);
  const mo = yekNow.getUTCMonth() + 1;
  const yr = yekNow.getUTCFullYear();
  const dim = new Date(yr, mo, 0).getDate();

  const [{ data: staffRaw }, { data: groups }, { data: items }] = await Promise.all([
    supabase.from('fin_staff').select('monthly_salary').eq('branch_id', BRANCH).eq('is_active', true),
    supabase.from('fin_expense_groups').select('id,level,system_key').eq('branch_id', BRANCH).eq('is_active', true),
    supabase.from('fin_expense_items').select('id,group_id,kind,amount_month,pct,pct_base').eq('branch_id', BRANCH).eq('is_active', true),
  ]);

  const staffSalary = (staffRaw ?? []).reduce((s, r) => s + Number((r as Record<string,unknown>).monthly_salary ?? 0), 0);
  const allItems = (items ?? []) as ItemRow[];
  const allGroups = (groups ?? []) as GroupRow[];

  const fixedItems = allItems.filter(i => i.kind === 'fixed');
  const fixedCosts = staffSalary + fixedItems.reduce((s, i) => s + i.amount_month, 0);

  const revGroupIds = new Set(allGroups.filter(g => g.level === 'revenue').map(g => g.id));
  const pctRevAll   = allItems.filter(i => i.kind === 'pct' && (i.pct_base === 'revenue_all' || i.pct_base === 'revenue_contracts')).reduce((s, i) => s + Number(i.pct ?? 0), 0);
  const pctRevTotal = allItems.filter(i => i.kind === 'pct' && revGroupIds.has(i.group_id)).reduce((s, i) => s + Number(i.pct ?? 0), 0);
  const pctMargin   = allItems.filter(i => i.kind === 'pct' && i.pct_base === 'margin').reduce((s, i) => s + Number(i.pct ?? 0), 0);

  const pctShare = pctRevAll / 100 + (pctMargin / 100) * (1 - pctRevTotal / 100);
  const tbuMonth = pctShare < 1 ? Math.round(fixedCosts / (1 - pctShare)) : null;

  return {
    staff_salary: staffSalary,
    fixed_costs: fixedCosts,
    pct_revenue: pctRevAll,
    pct_margin: pctMargin,
    pct_share_pct: Math.round(pctShare * 10000) / 100,
    tbu_month: tbuMonth,
    tbu_week:  tbuMonth ? Math.round(tbuMonth * 7 / dim) : null,
    tbu_day:   tbuMonth ? Math.round(tbuMonth / dim) : null,
    surplus_per_100k: Math.round((1 - pctShare) * 100000),
    days_in_month: dim,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function buildFinRouter(): Router {
  const router = Router();

  // ── Staff ──────────────────────────────────────────────────────────────────

  router.get('/kviz/api/fin/staff', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const { data, error } = await supabase.from('fin_staff').select('*').eq('branch_id', BRANCH).order('sort').order('display_name');
      if (error) { console.error('[fin/staff]', error.message); res.status(500).json({ error: 'Ошибка загрузки' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/fin/staff', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { display_name, fitbase_name, monthly_salary, hidden_in_reports, in_payroll, is_active, note } = req.body as Record<string, unknown>;
      if (!display_name || !String(display_name).trim()) { res.status(400).json({ error: 'Укажите имя в отчётах' }); return; }
      const name = String(display_name).trim();
      const { data: dup } = await supabase.from('fin_staff').select('id').eq('branch_id', BRANCH).eq('display_name', name).eq('is_active', true).maybeSingle();
      if (dup) { res.status(400).json({ error: 'Сотрудник с таким именем уже существует' }); return; }
      const { data: ms } = await supabase.from('fin_staff').select('sort').eq('branch_id', BRANCH).order('sort', { ascending: false }).limit(1).maybeSingle();
      const sort = ((ms?.sort as number) ?? 0) + 1;
      const { data, error } = await supabase.from('fin_staff').insert({
        branch_id: BRANCH, display_name: name,
        fitbase_name: fitbase_name ? String(fitbase_name).trim() || null : null,
        monthly_salary: Number(monthly_salary ?? 0),
        hidden_in_reports: Boolean(hidden_in_reports),
        in_payroll: in_payroll !== false,
        is_active: is_active !== false,
        sort, note: note ? String(note).trim() || null : null,
        updated_by: sess.display_name, updated_at: new Date().toISOString(),
      }).select().single();
      if (error) { console.error('[fin/staff post]', error.message); res.status(500).json({ error: 'Ошибка создания' }); return; }
      await supabase.from('crm_audit_log').insert({ table_name: 'fin_staff', record_id: data.id, action: 'create', changed_by: sess.display_name, changed_at: new Date().toISOString(), new_values: data });
      invalidateStaffCache();
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/fin/staff/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const b = req.body as Record<string, unknown>;
      const payload: Record<string, unknown> = { updated_by: sess.display_name, updated_at: new Date().toISOString() };
      if (b.display_name  !== undefined) payload.display_name  = String(b.display_name).trim();
      if (b.fitbase_name  !== undefined) payload.fitbase_name  = b.fitbase_name ? String(b.fitbase_name).trim() || null : null;
      if (b.monthly_salary !== undefined) payload.monthly_salary = Number(b.monthly_salary);
      if (b.hidden_in_reports !== undefined) payload.hidden_in_reports = Boolean(b.hidden_in_reports);
      if (b.in_payroll !== undefined) payload.in_payroll = Boolean(b.in_payroll);
      if (b.is_active  !== undefined) payload.is_active  = Boolean(b.is_active);
      if (b.sort       !== undefined) payload.sort       = Number(b.sort);
      if (b.note       !== undefined) payload.note       = b.note ? String(b.note).trim() || null : null;
      const { data, error } = await supabase.from('fin_staff').update(payload).eq('id', req.params.id).eq('branch_id', BRANCH).select().single();
      if (error) { console.error('[fin/staff put]', error.message); res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      await supabase.from('crm_audit_log').insert({ table_name: 'fin_staff', record_id: req.params.id, action: 'update', changed_by: sess.display_name, changed_at: new Date().toISOString(), new_values: payload });
      invalidateStaffCache();
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.delete('/kviz/api/fin/staff/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { data: staff } = await supabase.from('fin_staff').select('display_name,fitbase_name').eq('id', req.params.id).maybeSingle();
      if (!staff) { res.status(404).json({ error: 'Не найдено' }); return; }
      const name = staff.display_name as string;
      if (req.query.force === '1') {
        const { error } = await supabase.from('fin_staff').delete().eq('id', req.params.id);
        if (error) { res.status(500).json({ error: 'Ошибка удаления' }); return; }
        await supabase.from('crm_audit_log').insert({ table_name: 'fin_staff', record_id: req.params.id, action: 'delete', changed_by: sess.display_name, changed_at: new Date().toISOString() });
        invalidateStaffCache();
        res.json({ ok: true });
      } else {
        const [{ data: payrollUsage }, { data: planUsage }] = await Promise.all([
          supabase.from('payroll_month_employee').select('month').eq('branch_id', BRANCH).eq('employee', name).limit(1),
          supabase.from('metrics_seller_plan').select('month').eq('branch_id', BRANCH).eq('seller', name).limit(1),
        ]);
        if ((payrollUsage?.length ?? 0) > 0 || (planUsage?.length ?? 0) > 0) {
          res.status(409).json({ error: 'Сотрудник есть в данных ЗП или плана продаж. Переведите в архив.', can_archive: true }); return;
        }
        // Archive
        await supabase.from('fin_staff').update({ is_active: false, updated_by: sess.display_name, updated_at: new Date().toISOString() }).eq('id', req.params.id);
        invalidateStaffCache();
        res.json({ ok: true, archived: true });
      }
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/kviz/api/fin/fitbase-names', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const since = addDaysStr(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10), -90);
      const [{ data: ops }, { data: leads }, { data: linked }] = await Promise.all([
        supabase.from('fitbase_operations').select('cashier,manager').gte('op_date', since).limit(10000),
        supabase.from('fitbase_leads').select('manager').gte('created_date', since).limit(10000),
        supabase.from('fin_staff').select('fitbase_name').eq('branch_id', BRANCH).eq('is_active', true),
      ]);
      const names = new Set<string>();
      for (const op of (ops ?? [])) { if (op.cashier) names.add(op.cashier as string); if (op.manager) names.add(op.manager as string); }
      for (const l  of (leads ?? [])) { if (l.manager) names.add(l.manager as string); }
      const taken = new Set((linked ?? []).map((s: Record<string,unknown>) => s.fitbase_name as string).filter(Boolean));
      const all = [...names].filter(Boolean).sort();
      res.json({ all, unlinked: all.filter(n => !taken.has(n)) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Expense groups ─────────────────────────────────────────────────────────

  router.get('/kviz/api/fin/expense-groups', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const [{ data: groups, error: ge }, { data: items, error: ie }, salaryRes] = await Promise.all([
        supabase.from('fin_expense_groups').select('*').eq('branch_id', BRANCH).order('sort').order('name'),
        supabase.from('fin_expense_items').select('*').eq('branch_id', BRANCH).order('sort').order('name'),
        supabase.from('fin_staff').select('monthly_salary').eq('branch_id', BRANCH).eq('is_active', true),
      ]);
      if (ge || ie) { res.status(500).json({ error: 'Ошибка загрузки' }); return; }
      const salaryTotal = (salaryRes.data ?? []).reduce((s, r) => s + Number((r as Record<string,unknown>).monthly_salary ?? 0), 0);
      const byGroup = new Map<string, unknown[]>();
      for (const it of (items ?? [])) {
        const gid = (it as Record<string,unknown>).group_id as string;
        if (!byGroup.has(gid)) byGroup.set(gid, []);
        byGroup.get(gid)!.push(it);
      }
      const result = (groups ?? []).map(g => ({ ...g, items: byGroup.get((g as Record<string,unknown>).id as string) ?? [], salary_total: (g as Record<string,unknown>).system_key === 'salary' ? salaryTotal : undefined }));
      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/fin/expense-groups', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { name, level } = req.body as Record<string, unknown>;
      const VALID_LEVELS = new Set(['revenue', 'margin', 'skd']);
      if (!name || !level || !VALID_LEVELS.has(String(level))) { res.status(400).json({ error: 'Укажите название и уровень' }); return; }
      const { data: ms } = await supabase.from('fin_expense_groups').select('sort').eq('branch_id', BRANCH).order('sort', { ascending: false }).limit(1).maybeSingle();
      const sort = ((ms?.sort as number) ?? 0) + 1;
      const { data, error } = await supabase.from('fin_expense_groups').insert({
        branch_id: BRANCH, name: String(name).trim(), level: String(level), is_active: true, sort,
        updated_by: sess.display_name, updated_at: new Date().toISOString(),
      }).select().single();
      if (error) { res.status(500).json({ error: 'Ошибка создания' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/fin/expense-groups/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const b = req.body as Record<string, unknown>;
      const VALID_LEVELS = new Set(['revenue', 'margin', 'skd']);
      const payload: Record<string, unknown> = { updated_by: sess.display_name, updated_at: new Date().toISOString() };
      if (b.name !== undefined) payload.name = String(b.name).trim();
      if (b.level !== undefined && VALID_LEVELS.has(String(b.level))) payload.level = b.level;
      if (b.is_active !== undefined) payload.is_active = Boolean(b.is_active);
      if (b.sort !== undefined) payload.sort = Number(b.sort);
      const { data, error } = await supabase.from('fin_expense_groups').update(payload).eq('id', req.params.id).eq('branch_id', BRANCH).select().single();
      if (error) { res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.delete('/kviz/api/fin/expense-groups/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { data: grp } = await supabase.from('fin_expense_groups').select('system_key').eq('id', req.params.id).maybeSingle();
      if (!grp) { res.status(404).json({ error: 'Не найдено' }); return; }
      if ((grp as Record<string,unknown>).system_key) { res.status(400).json({ error: 'Системную группу нельзя удалить. Можно перевести в архив.' }); return; }
      const { data: has } = await supabase.from('fin_expense_items').select('id').eq('group_id', req.params.id).eq('is_active', true).limit(1);
      if (has?.length) { res.status(409).json({ error: 'В группе есть активные статьи. Переведите их в архив, затем архивируйте группу.', can_archive: true }); return; }
      if (req.query.force === '1') {
        await supabase.from('fin_expense_groups').delete().eq('id', req.params.id);
      } else {
        await supabase.from('fin_expense_groups').update({ is_active: false, updated_by: sess.display_name, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Expense items ──────────────────────────────────────────────────────────

  router.post('/kviz/api/fin/expense-items', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const b = req.body as Record<string, unknown>;
      const VALID_KINDS = new Set(['fixed', 'pct', 'manual']);
      const VALID_BASES = new Set(['revenue_all', 'revenue_contracts', 'revenue_goods', 'margin']);
      if (!b.group_id || !b.name || !b.kind || !VALID_KINDS.has(String(b.kind))) { res.status(400).json({ error: 'Укажите группу, название и тип' }); return; }
      if (b.kind === 'pct' && (!b.pct || !b.pct_base || !VALID_BASES.has(String(b.pct_base)))) { res.status(400).json({ error: 'Для типа «Процент» укажите % и базу' }); return; }
      if (b.kind === 'pct' && (Number(b.pct) < 0 || Number(b.pct) > 100)) { res.status(400).json({ error: 'Процент от 0 до 100' }); return; }
      const { data: ms } = await supabase.from('fin_expense_items').select('sort').eq('group_id', b.group_id).order('sort', { ascending: false }).limit(1).maybeSingle();
      const sort = ((ms?.sort as number) ?? 0) + 1;
      const { data, error } = await supabase.from('fin_expense_items').insert({
        branch_id: BRANCH, group_id: b.group_id, name: String(b.name).trim(), kind: b.kind,
        amount_month: b.kind === 'fixed' ? Number(b.amount_month ?? 0) : 0,
        pct: b.kind === 'pct' ? Number(b.pct) : null,
        pct_base: b.kind === 'pct' ? b.pct_base : null,
        is_active: true, sort,
        note: b.note ? String(b.note).trim() || null : null,
        updated_by: sess.display_name, updated_at: new Date().toISOString(),
      }).select().single();
      if (error) { res.status(500).json({ error: 'Ошибка создания' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/fin/expense-items/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const b = req.body as Record<string, unknown>;
      const VALID_KINDS = new Set(['fixed', 'pct', 'manual']);
      const VALID_BASES = new Set(['revenue_all', 'revenue_contracts', 'revenue_goods', 'margin']);
      const payload: Record<string, unknown> = { updated_by: sess.display_name, updated_at: new Date().toISOString() };
      if (b.name !== undefined) payload.name = String(b.name).trim();
      if (b.kind !== undefined && VALID_KINDS.has(String(b.kind))) payload.kind = b.kind;
      if (b.amount_month !== undefined) payload.amount_month = Number(b.amount_month);
      if (b.pct !== undefined) { if (Number(b.pct) < 0 || Number(b.pct) > 100) { res.status(400).json({ error: 'Процент от 0 до 100' }); return; } payload.pct = Number(b.pct); }
      if (b.pct_base !== undefined && VALID_BASES.has(String(b.pct_base))) payload.pct_base = b.pct_base;
      if (b.is_active !== undefined) payload.is_active = Boolean(b.is_active);
      if (b.sort !== undefined) payload.sort = Number(b.sort);
      if (b.note !== undefined) payload.note = b.note ? String(b.note).trim() || null : null;
      const { data, error } = await supabase.from('fin_expense_items').update(payload).eq('id', req.params.id).eq('branch_id', BRANCH).select().single();
      if (error) { res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.delete('/kviz/api/fin/expense-items/:id', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { data: wi } = await supabase.from('fin_week_input').select('week_start').eq('item_id', req.params.id).limit(1);
      if (wi?.length) { res.status(409).json({ error: 'Статья имеет ручные значения. Переведите в архив.', can_archive: true }); return; }
      if (req.query.force === '1') {
        await supabase.from('fin_expense_items').delete().eq('id', req.params.id);
      } else {
        await supabase.from('fin_expense_items').update({ is_active: false, updated_by: sess.display_name, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Week input ─────────────────────────────────────────────────────────────

  router.put('/kviz/api/fin/week-input', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const sess = getSession(req)!;
      const { week_start, item_id, amount } = req.body as Record<string, unknown>;
      if (!week_start || !item_id) { res.status(400).json({ error: 'week_start и item_id обязательны' }); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week_start))) { res.status(400).json({ error: 'week_start: YYYY-MM-DD (четверг)' }); return; }
      if (amount === null || amount === undefined) {
        await supabase.from('fin_week_input').delete().eq('branch_id', BRANCH).eq('week_start', week_start).eq('item_id', item_id);
      } else {
        if (Number(amount) < 0) { res.status(400).json({ error: 'Сумма не может быть отрицательной' }); return; }
        const { error } = await supabase.from('fin_week_input').upsert({
          branch_id: BRANCH, week_start, item_id, amount: Number(amount),
          updated_by: sess.display_name, updated_at: new Date().toISOString(),
        }, { onConflict: 'branch_id,week_start,item_id' });
        if (error) { res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── TBU ────────────────────────────────────────────────────────────────────

  router.get('/kviz/api/fin/tbu-summary', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try { res.json(await computeTbuSummary()); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/kviz/api/fin/tbu', async (req, res) => {
    if (!isAdmin(req, res)) return;
    try {
      const mode   = req.query.mode   === 'month' ? 'month' : 'week' as 'week' | 'month';
      const salary = req.query.salary === 'current' ? 'current' : 'max' as 'max' | 'current';
      res.json(await computeTbuPeriods(mode, salary));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return router;
}
