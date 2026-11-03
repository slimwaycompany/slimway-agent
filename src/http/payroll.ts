import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { fetchAll, groupOrders, classifyPurchase, opCid, OrderRow, ContractRecord } from './metrics';

const BRANCH = '00000000-0000-0000-0000-000000000001';

function isAdmin(req: Request, res: Response): boolean {
  if (getSession(req)?.role === 'admin') return true;
  res.status(403).json({ error: 'Только для администратора' }); return false;
}

interface EmployeeSettings {
  shift_rate: number; shifts_count: number | null; new_sales_pct: number; renewal_pct: number;
  goods_pct: number; plan_bonus: number; plan_bonus_on: boolean; premium: number; deduction: number; advance: number;
  note: string | null;
}

const DEFAULT_SETTINGS: EmployeeSettings = {
  shift_rate: 0, shifts_count: null, new_sales_pct: 0, renewal_pct: 2,
  goods_pct: 0, plan_bonus: 30000, plan_bonus_on: false, premium: 0, deduction: 0, advance: 0, note: null,
};

interface DrillItem { name: string|null; amount: number; date: string|null; is_refund: boolean; orig_date?: string|null }

async function computePayroll(month: string) {
  const [yr, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const to = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  // Fetch all ops in month (sale + refund)
  const allOps = await fetchAll((off, lim) =>
    supabase.from('fitbase_operations')
      .select('fitbase_id,op_date,amount,client_name,manager,cashier,item,op_type,raw')
      .gte('op_date', from).lte('op_date', to)
      .in('op_type', ['sale', 'refund']).gt('amount', 0)
      .range(off, off + lim - 1)
  );

  const saleOps = allOps.filter(op => op.op_type === 'sale');
  const refundOps = allOps.filter(op => op.op_type === 'refund');

  // Contracts for classification
  const purCids = [...new Set(saleOps.map(op => opCid(op)).filter((x): x is number => x != null))];
  const contractsByClient = new Map<number, ContractRecord[]>();
  if (purCids.length > 0) {
    const cr = await fetchAll((off, lim) =>
      supabase.from('fitbase_contracts')
        .select('fitbase_id,client_fitbase_id,name,payment_date,end_date,status,price')
        .in('client_fitbase_id', purCids).range(off, off + lim - 1)
    );
    for (const c of cr) {
      const cid = Number(c.client_fitbase_id);
      if (!contractsByClient.has(cid)) contractsByClient.set(cid, []);
      contractsByClient.get(cid)!.push(c as unknown as ContractRecord);
    }
  }

  // Test detection: same (cid:itemId:date) sale+refund pair
  const saleOrders   = groupOrders(saleOps);
  const refundOrders = groupOrders(refundOps);
  const oKey = (o: OrderRow) => o.cid != null && o.itemId != null && o.date ? `${o.cid}:${o.itemId}:${o.date}` : null;
  const saleKeySet = new Set<string>();
  for (const o of saleOrders) { const k = oKey(o); if (k) saleKeySet.add(k); }
  const testKeys = new Set<string>();
  for (const o of refundOrders) { const k = oKey(o); if (k && saleKeySet.has(k)) testKeys.add(k); }
  const isTest = (o: OrderRow) => { const k = oKey(o); return k != null && testKeys.has(k); };

  const cleanSales   = saleOrders.filter(o => !isTest(o));
  const cleanRefunds = refundOrders.filter(o => !isTest(o));

  // Historical sales for refund attribution (2 years back)
  const itemToOriginal = new Map<number, { cashier: string; date: string|null; type: 'new'|'renewal'|'returned'|'goods' }>();
  const refundItemIds = [...new Set(cleanRefunds.map(o => o.itemId).filter((x): x is number => x != null))];

  if (refundItemIds.length > 0) {
    const twoYearsAgo = `${yr - 2}-${String(mo).padStart(2, '0')}-01`;
    const histOps = await fetchAll((off, lim) =>
      supabase.from('fitbase_operations')
        .select('fitbase_id,cashier,raw,op_date')
        .eq('op_type', 'sale').gte('op_date', twoYearsAgo).lt('op_date', from)
        .range(off, off + lim - 1)
    );
    const histOrders = groupOrders(histOps);
    const histCids = [...new Set(histOrders.map(o => o.cid).filter((x): x is number => x != null && !contractsByClient.has(x)))];
    if (histCids.length > 0) {
      const cr = await fetchAll((off, lim) =>
        supabase.from('fitbase_contracts')
          .select('fitbase_id,client_fitbase_id,name,payment_date,end_date,status,price')
          .in('client_fitbase_id', histCids).range(off, off + lim - 1)
      );
      for (const c of cr) {
        const cid = Number(c.client_fitbase_id);
        if (!contractsByClient.has(cid)) contractsByClient.set(cid, []);
        contractsByClient.get(cid)!.push(c as unknown as ContractRecord);
      }
    }
    for (const o of histOrders) {
      if (o.itemId == null || !o.cashier) continue;
      itemToOriginal.set(o.itemId, { cashier: o.cashier, date: o.date, type: classifyPurchase(o, contractsByClient) });
    }
  }
  for (const o of cleanSales) {
    if (o.itemId != null && o.cashier) {
      itemToOriginal.set(o.itemId, { cashier: o.cashier, date: o.date, type: classifyPurchase(o, contractsByClient) });
    }
  }

  // Per-cashier bases
  interface CData { new_sales: number; renewals: number; goods: number; new_items: DrillItem[]; renewal_items: DrillItem[]; goods_items: DrillItem[] }
  const cashierData = new Map<string, CData>();
  const getCData = (c: string): CData => {
    if (!cashierData.has(c)) cashierData.set(c, { new_sales: 0, renewals: 0, goods: 0, new_items: [], renewal_items: [], goods_items: [] });
    return cashierData.get(c)!;
  };

  for (const o of cleanSales) {
    const cashier = o.cashier ?? '(без кассира)';
    const d = getCData(cashier);
    const type = classifyPurchase(o, contractsByClient);
    const item: DrillItem = { name: o.clientName, amount: o.amount, date: o.date, is_refund: false };
    if (type === 'new') { d.new_sales += o.amount; d.new_items.push(item); }
    else if (type === 'renewal' || type === 'returned') { d.renewals += o.amount; d.renewal_items.push(item); }
    else { d.goods += o.amount; d.goods_items.push(item); }
  }

  for (const o of cleanRefunds) {
    const orig = o.itemId != null ? itemToOriginal.get(o.itemId) : null;
    const origCashier = orig?.cashier ?? o.cashier ?? '(без кассира)';
    const origType: 'new'|'renewal'|'returned'|'goods' = orig?.type ?? classifyPurchase(o, contractsByClient);
    const d = getCData(origCashier);
    const item: DrillItem = { name: o.clientName, amount: -o.amount, date: o.date, is_refund: true, orig_date: orig?.date };
    if (origType === 'new') { d.new_sales -= o.amount; d.new_items.push(item); }
    else if (origType === 'renewal' || origType === 'returned') { d.renewals -= o.amount; d.renewal_items.push(item); }
    else { d.goods -= o.amount; d.goods_items.push(item); }
  }

  // On-shift counts per employee
  const { data: dayInputs } = await supabase.from('metrics_day_input')
    .select('on_shift').eq('branch_id', BRANCH).gte('day', from).lte('day', to);
  const shiftCounts = new Map<string, number>();
  for (const di of (dayInputs ?? [])) {
    for (const name of ((di.on_shift as string[]) ?? [])) {
      shiftCounts.set(name, (shiftCounts.get(name) ?? 0) + 1);
    }
  }

  // Seller plans
  const { data: spRows } = await supabase.from('metrics_seller_plan')
    .select('seller,sales_plan').eq('branch_id', BRANCH).eq('month', from);
  const sellerPlans: Record<string, number> = {};
  for (const sp of (spRows ?? [])) sellerPlans[sp.seller as string] = Number(sp.sales_plan);

  // Settings this month
  const { data: settingsRows } = await supabase.from('payroll_month_employee')
    .select('*').eq('branch_id', BRANCH).eq('month', from);
  const settingsMap = new Map<string, EmployeeSettings>();
  for (const r of (settingsRows ?? [])) {
    settingsMap.set(r.employee as string, {
      shift_rate: Number(r.shift_rate ?? 0), shifts_count: r.shifts_count != null ? Number(r.shifts_count) : null,
      new_sales_pct: Number(r.new_sales_pct ?? 0), renewal_pct: Number(r.renewal_pct ?? 2),
      goods_pct: Number(r.goods_pct ?? 0), plan_bonus: Number(r.plan_bonus ?? 30000),
      plan_bonus_on: !!(r.plan_bonus_on),
      premium: Number(r.premium ?? 0), deduction: Number(r.deduction ?? 0),
      advance: Number(r.advance ?? 0), note: r.note as string|null,
    });
  }

  // Previous month settings as draft for new employees (plan_bonus_on NOT carried over)
  const [prevYr, prevMo] = mo === 1 ? [yr - 1, 12] : [yr, mo - 1];
  const prevFrom = `${prevYr}-${String(prevMo).padStart(2, '0')}-01`;
  const { data: prevRows } = await supabase.from('payroll_month_employee')
    .select('*').eq('branch_id', BRANCH).eq('month', prevFrom);
  const prevMap = new Map<string, Omit<EmployeeSettings, 'plan_bonus_on'>>();
  for (const r of (prevRows ?? [])) {
    prevMap.set(r.employee as string, {
      shift_rate: Number(r.shift_rate ?? 0), shifts_count: null,
      new_sales_pct: Number(r.new_sales_pct ?? 0), renewal_pct: Number(r.renewal_pct ?? 2),
      goods_pct: Number(r.goods_pct ?? 0), plan_bonus: Number(r.plan_bonus ?? 30000),
      premium: 0, deduction: 0, advance: 0, note: null,
    });
  }

  // fin_staff: payroll employees + display names
  const { data: finStaffRows } = await supabase.from('fin_staff')
    .select('fitbase_name,display_name,hidden_in_reports')
    .eq('branch_id', BRANCH).eq('in_payroll', true).eq('is_active', true);
  const finStaffMap = new Map<string, { display_name: string; hidden: boolean }>();
  for (const r of (finStaffRows ?? [])) {
    finStaffMap.set(r.fitbase_name as string, {
      display_name: (r.display_name as string) || (r.fitbase_name as string),
      hidden: !!(r.hidden_in_reports),
    });
  }

  // Overall plan from metrics_month_plan
  const { data: overallPlanRow } = await supabase.from('metrics_month_plan')
    .select('sales_plan').eq('branch_id', BRANCH).eq('month', from).maybeSingle();
  const overallPlan = overallPlanRow?.sales_plan != null ? Number(overallPlanRow.sales_plan) : null;

  // All employees: fin_staff (in_payroll) + cashiers with ops + any with explicit settings
  const allEmployees = new Set<string>([
    ...finStaffMap.keys(),
    ...cashierData.keys(),
    ...settingsMap.keys(),
  ]);
  allEmployees.delete('(без кассира)');

  // Phase 1: compute per-employee facts
  interface RowFact {
    employee: string; is_draft: boolean; settings: EmployeeSettings;
    d: CData; fact_sales: number; plan_amount: number|null; plan_pct: number|null;
    shifts_from_schedule: number; shifts_amt: number; new_pct_amt: number; ren_pct_amt: number; gds_pct_amt: number;
  }
  const emptyData: CData = { new_sales: 0, renewals: 0, goods: 0, new_items: [], renewal_items: [], goods_items: [] };
  const rowFacts: RowFact[] = [...allEmployees].sort().map(employee => {
    const d = cashierData.get(employee) ?? emptyData;
    let settings = settingsMap.get(employee);
    const is_draft = !settings;
    if (!settings) {
      const prev = prevMap.get(employee);
      settings = prev ? { ...prev, plan_bonus_on: false } : { ...DEFAULT_SETTINGS };
    }
    const fact_sales    = Math.round(d.new_sales + d.renewals + d.goods);
    const plan_amount   = sellerPlans[employee] ?? null;
    const plan_pct      = plan_amount != null && plan_amount > 0 ? Math.round(100 * fact_sales / plan_amount) : null;
    const shifts_from_schedule = shiftCounts.get(employee) ?? 0;
    const eff_shifts    = settings.shifts_count ?? shifts_from_schedule;
    const shifts_amt    = Math.round(eff_shifts * settings.shift_rate);
    const new_pct_amt   = Math.round(Math.max(0, d.new_sales) * settings.new_sales_pct / 100);
    const ren_pct_amt   = Math.round(Math.max(0, d.renewals) * settings.renewal_pct / 100);
    const gds_pct_amt   = Math.round(Math.max(0, d.goods) * settings.goods_pct / 100);
    return { employee, is_draft, settings, d, fact_sales, plan_amount, plan_pct, shifts_from_schedule, shifts_amt, new_pct_amt, ren_pct_amt, gds_pct_amt };
  });

  // Phase 2: overall plan check
  const overall_plan_fact = rowFacts.reduce((s, r) => s + r.fact_sales, 0);
  const overall_plan_achieved = overallPlan != null && overall_plan_fact >= overallPlan;

  // Phase 3: final rows with plan_bonus applied
  const rows = rowFacts.map(rf => {
    const { employee, is_draft, settings, d, fact_sales, plan_amount, plan_pct, shifts_from_schedule, shifts_amt, new_pct_amt, ren_pct_amt, gds_pct_amt } = rf;
    const plan_bonus_amt = settings.plan_bonus_on && overall_plan_achieved ? settings.plan_bonus : 0;
    const total_earned = shifts_amt + new_pct_amt + ren_pct_amt + gds_pct_amt + plan_bonus_amt + settings.premium - settings.deduction;
    const finInfo = finStaffMap.get(employee);
    return {
      employee,
      display_name: finInfo?.display_name ?? employee,
      hidden: finInfo?.hidden ?? false,
      is_draft,
      new_sales: Math.round(d.new_sales), renewals: Math.round(d.renewals), goods: Math.round(d.goods),
      new_items: d.new_items, renewal_items: d.renewal_items, goods_items: d.goods_items,
      fact_sales, plan_amount, plan_pct,
      plan_bonus_on: settings.plan_bonus_on,
      shifts_from_schedule, settings,
      shifts_amt, new_pct_amt, renewal_pct_amt: ren_pct_amt, goods_pct_amt: gds_pct_amt,
      plan_bonus_amt, total_earned: Math.round(total_earned),
      to_pay: Math.round(total_earned - settings.advance),
    };
  });

  const totals = {
    new_sales:    rows.reduce((s, r) => s + r.new_sales, 0),
    renewals:     rows.reduce((s, r) => s + r.renewals, 0),
    goods:        rows.reduce((s, r) => s + r.goods, 0),
    shifts_amt:   rows.reduce((s, r) => s + r.shifts_amt, 0),
    total_earned: rows.reduce((s, r) => s + r.total_earned, 0),
    to_pay:       rows.reduce((s, r) => s + r.to_pay, 0),
  };

  return { rows, totals, overall_plan_fact, overall_plan_amount: overallPlan, overall_plan_achieved };
}

export function buildPayrollRouter(): Router {
  const router = Router();

  router.get('/kviz/api/payroll', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const yekNow = new Date(Date.now() + 5 * 3600_000);
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : yekNow.toISOString().slice(0, 7);
      const from = `${month}-01`;

      const { data: closeRow } = await supabase.from('payroll_month_close')
        .select('snapshot,closed_by,closed_at').eq('branch_id', BRANCH).eq('month', from).maybeSingle();
      if (closeRow) {
        res.json({ month, closed: true, closed_by: closeRow.closed_by, closed_at: closeRow.closed_at, ...(closeRow.snapshot as Record<string, unknown>) });
        return;
      }

      const result = await computePayroll(month);
      res.json({ month, closed: false, ...result });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/payroll/employee', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const { month, employee, ...fields } = req.body as { month?: string; employee?: string; [k: string]: unknown };
      if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: 'Неверный month' }); return; }
      if (!employee) { res.status(400).json({ error: 'Не указан сотрудник' }); return; }
      const from = `${month}-01`;

      const { data: closeRow } = await supabase.from('payroll_month_close')
        .select('month').eq('branch_id', BRANCH).eq('month', from).maybeSingle();
      if (closeRow) { res.status(400).json({ error: 'Месяц закрыт. Откройте заново для изменений.' }); return; }

      const pctFields = ['new_sales_pct', 'renewal_pct', 'goods_pct'];
      for (const f of pctFields) {
        if (fields[f] !== undefined && fields[f] !== null && Number(fields[f]) > 100) {
          res.status(400).json({ error: 'Процент должен быть от 0 до 100' }); return;
        }
      }
      const numFields = ['shift_rate','shifts_count','new_sales_pct','renewal_pct','goods_pct','plan_bonus','premium','deduction','advance'];
      for (const f of numFields) {
        if (fields[f] !== undefined && fields[f] !== null && (isNaN(Number(fields[f])) || Number(fields[f]) < 0)) {
          res.status(400).json({ error: `Поле ${f} должно быть неотрицательным числом` }); return;
        }
      }

      const session = getSession(req)!;
      const payload: Record<string, unknown> = {
        branch_id: BRANCH, month: from, employee,
        updated_by: session.display_name, updated_at: new Date().toISOString(),
      };
      for (const f of [...numFields, 'note']) {
        if (fields[f] !== undefined) payload[f] = fields[f] === '' ? null : fields[f];
      }
      if (fields.plan_bonus_on !== undefined) payload.plan_bonus_on = !!fields.plan_bonus_on;

      const { error } = await supabase.from('payroll_month_employee').upsert(payload, { onConflict: 'branch_id,month,employee' });
      if (error) { console.error('[payroll/employee]:', error.message); res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/payroll/close', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const { month } = req.body as { month?: string };
      if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: 'Неверный month' }); return; }
      const from = `${month}-01`;

      const { data: existing } = await supabase.from('payroll_month_close')
        .select('month').eq('branch_id', BRANCH).eq('month', from).maybeSingle();
      if (existing) { res.status(400).json({ error: 'Месяц уже закрыт' }); return; }

      const result = await computePayroll(month);
      const session = getSession(req)!;
      const { error } = await supabase.from('payroll_month_close').insert({
        branch_id: BRANCH, month: from, snapshot: result,
        closed_by: session.display_name, closed_at: new Date().toISOString(),
      });
      if (error) { console.error('[payroll/close]:', error.message); res.status(500).json({ error: 'Ошибка закрытия месяца' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/payroll/reopen', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const { month } = req.body as { month?: string };
      if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: 'Неверный month' }); return; }
      const { error } = await supabase.from('payroll_month_close')
        .delete().eq('branch_id', BRANCH).eq('month', `${month}-01`);
      if (error) { console.error('[payroll/reopen]:', error.message); res.status(500).json({ error: 'Ошибка открытия месяца' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return router;
}
