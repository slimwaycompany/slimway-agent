import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { acquireLock, releaseLock } from '../core/lock';
import { runFitbaseCrmSync } from '../jobs/fitbaseCrmSync';
import { TRIAL_SERVICE_NAMES, VISIT_STATUS_VISITED, VISIT_CANCELLED_STATUSES } from '../config';

interface Lead { fitbase_id: string; source: string | null; stage: string | null; status: string | null; manager: string | null; client_fitbase_id: number | null; client_phone: string | null; client_name: string | null; created_date: string | null }
interface Visit { client_fitbase_id: number | null; status: number | null; is_trial: boolean; client_phone: string | null }

function isAdmin(req: Request, res: Response): boolean {
  if (getSession(req)?.role === 'admin') return true;
  res.status(403).json({ error: 'Только для администратора' }); return false;
}

function digitsOnly(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

// Paginate any Supabase select in 1000-row pages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(build: (off: number, lim: number) => any): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const all: Record<string, unknown>[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await build(off, PAGE);
    if (error) throw new Error((error as { message: string }).message);
    if (!data?.length) break;
    all.push(...(data as Record<string, unknown>[]));
    if ((data as unknown[]).length < PAGE) break;
    off += PAGE;
  }
  return all;
}

function notCancelled(status: number | null): boolean {
  return status == null || !VISIT_CANCELLED_STATUSES.has(status);
}

// Returns latest lead (by created_at) per client_fitbase_id; phone fallback via fitbase_clients_cache
async function buildClientLeadMap(): Promise<Map<number, { source: string | null; manager: string | null }>> {
  const leads = await fetchAll((off, lim) =>
    supabase.from('fitbase_leads').select('client_fitbase_id,source,manager,created_at,client_phone')
      .not('client_fitbase_id', 'is', null).order('created_at', { ascending: true }).range(off, off + lim - 1)
  );
  const map = new Map<number, { source: string | null; manager: string | null }>();
  const byPhone = new Map<string, { source: string | null; manager: string | null }>();
  for (const l of leads) {
    const info = { source: (l.source as string | null) ?? null, manager: (l.manager as string | null) ?? null };
    map.set(Number(l.client_fitbase_id), info);
    const ph = digitsOnly(l.client_phone as string | null);
    if (ph) byPhone.set(ph, info); // ascending order — last write = latest lead
  }
  // Phone-based fallback: clients not in fitbase_leads by ID → look up via cache phone
  if (byPhone.size > 0) {
    const cache = await fetchAll((off, lim) =>
      supabase.from('fitbase_clients_cache').select('fitbase_client_id,phone').range(off, off + lim - 1)
    );
    for (const cc of cache) {
      const cid = Number(cc.fitbase_client_id);
      if (map.has(cid)) continue;
      const ph = digitsOnly(cc.phone as string | null);
      if (!ph) continue;
      const info = byPhone.get(ph);
      if (info) map.set(cid, info);
    }
  }
  return map;
}

function clSrc(id: number | null | undefined, clm: Map<number, { source: string | null; manager: string | null }>): string {
  return (id != null ? clm.get(Number(id))?.source : null) ?? '(без источника)';
}

function clMgr(id: number | null | undefined, clm: Map<number, { source: string | null; manager: string | null }>): string {
  return (id != null ? clm.get(Number(id))?.manager : null) ?? '(без менеджера)';
}

// Extract Fitbase client.id from fitbase_operations.raw
function opCid(op: Record<string, unknown>): number | null {
  const raw = op.raw as Record<string, unknown> | null;
  const c = raw?.client as Record<string, unknown> | null;
  return c?.id != null ? Number(c.id) : null;
}

interface OrderRow { amount: number; cid: number|null; manager: string|null; cashier: string|null; item: string|null; date: string|null; clientName: string|null; itemType: string|null; itemId: number|null }
interface ContractRecord { fitbase_id: number; client_fitbase_id: number; name: string|null; payment_date: string|null; end_date: string|null; status: string; price: number }

// Group individual operation lines into orders by order_id
function groupOrders(ops: Array<Record<string, unknown>>): OrderRow[] {
  const map = new Map<string, OrderRow>();
  for (const op of ops) {
    const raw = op.raw as Record<string, unknown>;
    const orderId = String(raw?.order_id ?? op.fitbase_id);
    const cid = opCid(op);
    const ex = map.get(orderId);
    if (!ex) {
      map.set(orderId, { amount: Number(op.amount ?? 0), cid, manager: (op.manager as string|null) ?? null, cashier: (op.cashier as string|null) ?? null, item: (op.item as string|null) ?? null, date: (op.op_date as string|null) ?? null, clientName: (op.client_name as string|null) ?? null, itemType: (raw?.item_type as string|null) ?? null, itemId: raw?.item_id != null ? Number(raw.item_id) : null });
    } else {
      ex.amount += Number(op.amount ?? 0);
      if (cid != null && ex.cid == null) ex.cid = cid;
    }
  }
  return [...map.values()];
}

function classifyPurchase(o: OrderRow, contractsByClient: Map<number, ContractRecord[]>): 'new'|'same_day'|'renewal'|'returned'|'goods' {
  if (o.itemType !== 'contract') return 'goods';
  if (o.cid == null || !o.date) return 'new';
  const all = contractsByClient.get(o.cid) ?? [];
  const valid = all.filter(c =>
    Number(c.price) > 0 &&
    !(c.name ?? '').toLowerCase().includes('пробн') &&
    c.status !== 'deleted' &&
    Number(c.fitbase_id) !== o.itemId &&
    (c.payment_date ?? '') <= o.date!
  );
  if (valid.length === 0) return 'new';
  if (valid.some(c => c.payment_date === o.date)) return 'same_day';
  const latest = valid.reduce((a, b) => (a.payment_date ?? '') > (b.payment_date ?? '') ? a : b);
  const prevEnd = latest.end_date;
  if (!prevEnd) return 'renewal';
  const days = Math.floor((new Date(o.date!).getTime() - new Date(prevEnd).getTime()) / 86400_000);
  return days <= 30 ? 'renewal' : 'returned';
}

function buildFunnel(leads: Lead[], visits: Visit[]) {
  const trialBookedById   = new Set(visits.filter(v => v.is_trial && notCancelled(v.status)).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
  const trialBookedByPhone = new Set(visits.filter(v => v.is_trial && notCancelled(v.status)).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));
  const visitedById        = new Set(visits.filter(v => v.is_trial && v.status === VISIT_STATUS_VISITED).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
  const visitedByPhone     = new Set(visits.filter(v => v.is_trial && v.status === VISIT_STATUS_VISITED).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));

  function matched(id: number | null, phone: string | null, byId: Set<number>, byPhone: Set<string>): boolean {
    if (id != null && byId.has(id)) return true;
    const d = digitsOnly(phone);
    return d != null && byPhone.has(d);
  }

  return {
    leads:        leads.length,
    in_work:      leads.filter(l => l.status != null && l.status !== '0').length,
    trial_booked: leads.filter(l => matched(l.client_fitbase_id, l.client_phone, trialBookedById, trialBookedByPhone)).length,
    visited:      leads.filter(l => matched(l.client_fitbase_id, l.client_phone, visitedById, visitedByPhone)).length,
    bought:       leads.filter(l => l.status === '-1').length,
  };
}

export function buildMetricsRouter(): Router {
  const router = Router();

  router.get('/kviz/api/metrics/funnel', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const fromDate = String(req.query.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      const toDate   = String(req.query.to   || new Date().toISOString().slice(0, 10));
      const sourcesRaw = req.query.sources;
      const sources: string[] = Array.isArray(sourcesRaw) ? sourcesRaw.map(String) : sourcesRaw ? [String(sourcesRaw)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;

      let q = supabase
        .from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone')
        .gte('created_date', fromDate)
        .lte('created_date', toDate);
      if (sources.length === 1) q = q.eq('source', sources[0]);
      else if (sources.length > 1) q = q.in('source', sources);
      if (manager) q = q.ilike('manager', `%${manager}%`);

      const { data: leads, error: leadsErr } = await q;
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }

      const allLeads = (leads || []) as Lead[];

      const visitsRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits').select('client_fitbase_id,status,is_trial,client_phone')
          .eq('is_trial', true).range(off, off + lim - 1)
      );
      const allVisits = visitsRaw as unknown as Visit[];

      const funnel = buildFunnel(allLeads, allVisits);

      const sourceMap = new Map<string, Lead[]>();
      for (const l of allLeads) {
        const s = l.source ?? '(без источника)';
        if (!sourceMap.has(s)) sourceMap.set(s, []);
        sourceMap.get(s)!.push(l);
      }
      const by_source = [...sourceMap.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([source, sLeads]) => ({ source, ...buildFunnel(sLeads, allVisits) }));

      const managerMap = new Map<string, Lead[]>();
      for (const l of allLeads) {
        const m = l.manager ?? '(без менеджера)';
        if (!managerMap.has(m)) managerMap.set(m, []);
        managerMap.get(m)!.push(l);
      }
      const by_manager = [...managerMap.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([mgr, mLeads]) => ({ manager: mgr, ...buildFunnel(mLeads, allVisits) }));

      const srcRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_leads').select('source').not('source', 'is', null).range(off, off + lim - 1)
      );
      const availableSources = [...new Set(srcRaw.map(r => r.source as string))].sort();
      const mgrRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_leads').select('manager').not('manager', 'is', null).range(off, off + lim - 1)
      );
      const availableManagers = [...new Set(mgrRaw.map(r => r.manager as string))].sort();

      res.json({ period: { from: fromDate, to: toDate }, funnel, by_source, by_manager, availableSources, availableManagers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Fact-day: what happened in the selected period
  router.get('/kviz/api/metrics/fact-day', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const from = String(req.query.from || new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
      const to   = String(req.query.to   || new Date().toISOString().slice(0, 10));
      const sources: string[] = Array.isArray(req.query.sources) ? req.query.sources.map(String) : req.query.sources ? [String(req.query.sources)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;
      const cashier = req.query.cashier ? String(req.query.cashier) : null;

      const clm = await buildClientLeadMap();

      const { data: leadsData, error: leadsErr } = await supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }
      const allLeads = (leadsData ?? []) as Lead[];

      // Fetch ops early to build cashier→clientId set for propagating filter
      const { data: opsRaw } = await supabase.from('fitbase_operations')
        .select('fitbase_id,op_at,op_date,amount,client_name,manager,cashier,item,pay_method,op_type,raw')
        .gte('op_date', from).lte('op_date', to).in('op_type', ['sale', 'refund']).gt('amount', 0);
      const allOps = (opsRaw ?? []) as Array<Record<string, unknown>>;
      const allSalesOps = allOps.filter(op => op.op_type === 'sale');
      const allRefundOps = allOps.filter(op => op.op_type === 'refund');

      // Cashier filter propagated to leads/visits via client IDs of matching sales
      const cashierCids: Set<number> | null = cashier ? new Set(
        allSalesOps
          .filter(op => ((op.cashier as string) ?? '').toLowerCase().includes(cashier.toLowerCase()))
          .map(op => opCid(op)).filter((x): x is number => x != null)
      ) : null;

      const leads = allLeads.filter(l => {
        if (sources.length > 0 && !sources.includes(l.source ?? '')) return false;
        if (manager && !(l.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        if (cashierCids && !(l.client_fitbase_id != null && cashierCids.has(l.client_fitbase_id))) return false;
        return true;
      });

      const allVisits = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits').select('fitbase_id,client_fitbase_id,client_name,status,visit_at,visit_date,manager,resource')
          .eq('is_trial', true).gte('visit_date', from).lte('visit_date', to).range(off, off + lim - 1)
      );

      const visits = allVisits.filter(v => {
        const cid = v.client_fitbase_id as number | null;
        if (sources.length > 0 && !sources.includes(clm.get(Number(cid))?.source ?? '')) return false;
        if (manager && !(clm.get(Number(cid))?.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        if (cashierCids && !(cid != null && cashierCids.has(Number(cid)))) return false;
        return true;
      });

      // Sales filter: source from lead map, manager from lead map (not op.manager)
      function matchesFilters(op: Record<string, unknown>): boolean {
        const cid = opCid(op);
        if (sources.length > 0 && !sources.includes(cid != null ? (clm.get(cid)?.source ?? '') : '')) return false;
        if (manager) {
          const leadMgr = cid != null ? (clm.get(cid)?.manager ?? '') : '';
          if (!leadMgr.toLowerCase().includes(manager.toLowerCase())) return false;
        }
        if (cashier && !((op.cashier as string) ?? '').toLowerCase().includes(cashier.toLowerCase())) return false;
        return true;
      }
      const salesOps    = allSalesOps.filter(matchesFilters);
      const refundOps   = allRefundOps.filter(matchesFilters);
      const saleOrders  = groupOrders(salesOps);
      const refundOrders = groupOrders(refundOps);

      // Fetch contracts for all clients with sales in period
      const purCids = [...new Set(allSalesOps.map(op => opCid(op)).filter((x): x is number => x != null))];
      const contractsByClient = new Map<number, ContractRecord[]>();
      if (purCids.length > 0) {
        const cr = await fetchAll((off, lim) =>
          supabase.from('fitbase_contracts').select('fitbase_id,client_fitbase_id,name,payment_date,end_date,status,price')
            .in('client_fitbase_id', purCids).range(off, off + lim - 1)
        );
        for (const c of cr) {
          const cid = Number(c.client_fitbase_id);
          if (!contractsByClient.has(cid)) contractsByClient.set(cid, []);
          contractsByClient.get(cid)!.push(c as unknown as ContractRecord);
        }
      }

      // Test detection: sale + refund of same (cid, itemId) on same date → excluded entirely
      const orderKey = (o: OrderRow) => o.cid != null && o.itemId != null && o.date ? `${o.cid}:${o.itemId}:${o.date}` : null;
      const saleKeySet = new Set<string>();
      for (const o of saleOrders) { const k = orderKey(o); if (k) saleKeySet.add(k); }
      const testKeys = new Set<string>();
      for (const o of refundOrders) { const k = orderKey(o); if (k && saleKeySet.has(k)) testKeys.add(k); }
      const isTest = (o: OrderRow) => { const k = orderKey(o); return k != null && testKeys.has(k); };

      const cleanSaleOrders   = saleOrders.filter(o => !isTest(o));
      const cleanRefundOrders = refundOrders.filter(o => !isTest(o));
      const testSaleOrders    = saleOrders.filter(isTest);
      const refundAmount      = cleanRefundOrders.reduce((s, o) => s + o.amount, 0);

      const classify = (o: OrderRow) => classifyPurchase(o, contractsByClient);
      const newOrders      = cleanSaleOrders.filter(o => classify(o) === 'new');
      const renewOrders    = cleanSaleOrders.filter(o => classify(o) === 'renewal');
      const sameDayOrders  = cleanSaleOrders.filter(o => classify(o) === 'same_day');
      const returnedOrders = cleanSaleOrders.filter(o => classify(o) === 'returned');
      const goodsOrders    = cleanSaleOrders.filter(o => classify(o) === 'goods');

      const periodCids    = new Set(allLeads.map(l => l.client_fitbase_id).filter((x): x is number => x != null));
      const newFromPeriod = newOrders.filter(o => o.cid != null && periodCids.has(o.cid)).length;
      const newAmount     = newOrders.reduce((s, o) => s + o.amount, 0);
      const renewAmount   = renewOrders.reduce((s, o) => s + o.amount, 0);
      const sameDayAmt    = sameDayOrders.reduce((s, o) => s + o.amount, 0);
      const returnedAmt   = returnedOrders.reduce((s, o) => s + o.amount, 0);
      const goodsAmt      = goodsOrders.reduce((s, o) => s + o.amount, 0);
      const totalSalesAmt = newAmount + renewAmount + sameDayAmt + returnedAmt + goodsAmt;
      const totalNetAmt   = totalSalesAmt - refundAmount;

      const { data: trialSalesRaw } = await supabase.from('fitbase_operations')
        .select('fitbase_id,client_name,item,raw')
        .gte('op_date', from).lte('op_date', to)
        .in('item', TRIAL_SERVICE_NAMES as string[]);
      const allTrialSold = (trialSalesRaw ?? []) as Array<Record<string, unknown>>;
      const trialSold = allTrialSold.filter(op => {
        const cid = opCid(op);
        if (sources.length > 0 && !sources.includes(cid != null ? (clm.get(cid)?.source ?? '') : '')) return false;
        if (manager) {
          const leadMgr = cid != null ? (clm.get(cid)?.manager ?? '') : '';
          if (!leadMgr.toLowerCase().includes(manager.toLowerCase())) return false;
        }
        return true;
      });

      const inWork      = leads.filter(l => l.status != null && l.status !== '0');
      const trialBooked = visits.filter(v => notCancelled(v.status as number | null));
      const visited     = visits.filter(v => v.status === VISIT_STATUS_VISITED);

      // by_source
      const allSrcSet = new Set<string>();
      for (const l of allLeads) allSrcSet.add(l.source ?? '(без источника)');
      const by_source = [...allSrcSet].map(src => {
        const sLeads     = allLeads.filter(l => (l.source ?? '(без источника)') === src);
        const sInWork    = sLeads.filter(l => l.status != null && l.status !== '0');
        const sBooked    = allVisits.filter(v => notCancelled(v.status as number | null) && clSrc(v.client_fitbase_id as number | null, clm) === src);
        const sVisited   = allVisits.filter(v => v.status === VISIT_STATUS_VISITED && clSrc(v.client_fitbase_id as number | null, clm) === src);
        const sTrialSold = allTrialSold.filter(op => clSrc(opCid(op), clm) === src);
        const sSaleOrds  = groupOrders(allSalesOps.filter(op => clSrc(opCid(op), clm) === src)).filter(o => !isTest(o));
        const sRefOrds   = groupOrders(allRefundOps.filter(op => clSrc(opCid(op), clm) === src)).filter(o => !isTest(o));
        const sNewOrds   = sSaleOrds.filter(o => classify(o) === 'new');
        const sRenOrds   = sSaleOrds.filter(o => classify(o) === 'renewal');
        const sSalesAmt  = sSaleOrds.reduce((s, o) => s + o.amount, 0);
        const sRefAmt    = sRefOrds.reduce((s, o) => s + o.amount, 0);
        const sNewAmt    = sNewOrds.reduce((s, o) => s + o.amount, 0);
        const sRenAmt    = sRenOrds.reduce((s, o) => s + o.amount, 0);
        const sLeadCids  = new Set(sLeads.map(l => l.client_fitbase_id).filter((x): x is number => x != null));
        const sBuyers    = new Set(sSaleOrds.map(o => o.cid).filter((x): x is number => x != null && sLeadCids.has(x)));
        const sLtbPct    = sLeads.length > 0 ? Math.round(100 * sBuyers.size / sLeads.length) : 0;
        return { source: src, leads: sLeads.length, in_work: sInWork.length, trial_booked: sBooked.length, visited: sVisited.length, trial_sold_count: sTrialSold.length, sales_count: sSaleOrds.length, new_count: sNewOrds.length, renewal_count: sRenOrds.length, sales_amount: sSalesAmt, new_amount: sNewAmt, renewal_amount: sRenAmt, refund_amount: sRefAmt, net_amount: sSalesAmt - sRefAmt, lead_to_buy_pct: sLtbPct };
      }).sort((a, b) => b.leads - a.leads);

      // by_manager — all keyed by lead-map manager (not op.manager)
      const allMgrSet = new Set<string>();
      for (const l of allLeads) allMgrSet.add(l.manager ?? '(без менеджера)');
      for (const op of allSalesOps) allMgrSet.add(clMgr(opCid(op), clm));
      const by_manager = [...allMgrSet].map(mgr => {
        const mLeads     = allLeads.filter(l => (l.manager ?? '(без менеджера)') === mgr);
        const mInWork    = mLeads.filter(l => l.status != null && l.status !== '0');
        const mBooked    = allVisits.filter(v => notCancelled(v.status as number | null) && clMgr(v.client_fitbase_id as number | null, clm) === mgr);
        const mVisited   = allVisits.filter(v => v.status === VISIT_STATUS_VISITED && clMgr(v.client_fitbase_id as number | null, clm) === mgr);
        const mTrialSold = allTrialSold.filter(op => clMgr(opCid(op), clm) === mgr);
        const mSaleOrds  = groupOrders(allSalesOps.filter(op => clMgr(opCid(op), clm) === mgr)).filter(o => !isTest(o));
        const mRefOrds   = groupOrders(allRefundOps.filter(op => clMgr(opCid(op), clm) === mgr)).filter(o => !isTest(o));
        const mNewOrds   = mSaleOrds.filter(o => classify(o) === 'new');
        const mRenOrds   = mSaleOrds.filter(o => classify(o) === 'renewal');
        const mSalesAmt  = mSaleOrds.reduce((s, o) => s + o.amount, 0);
        const mRefAmt    = mRefOrds.reduce((s, o) => s + o.amount, 0);
        const mNewAmt    = mNewOrds.reduce((s, o) => s + o.amount, 0);
        const mRenAmt    = mRenOrds.reduce((s, o) => s + o.amount, 0);
        const mLeadCids  = new Set(mLeads.map(l => l.client_fitbase_id).filter((x): x is number => x != null));
        const mBuyers    = new Set(mSaleOrds.map(o => o.cid).filter((x): x is number => x != null && mLeadCids.has(x)));
        const mLtbPct    = mLeads.length > 0 ? Math.round(100 * mBuyers.size / mLeads.length) : 0;
        const items = mLeads.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date }));
        return { manager: mgr, leads: mLeads.length, in_work: mInWork.length, trial_booked: mBooked.length, visited: mVisited.length, trial_sold_count: mTrialSold.length, sales_count: mSaleOrds.length, new_count: mNewOrds.length, renewal_count: mRenOrds.length, sales_amount: mSalesAmt, new_amount: mNewAmt, renewal_amount: mRenAmt, refund_amount: mRefAmt, net_amount: mSalesAmt - mRefAmt, lead_to_buy_pct: mLtbPct, items };
      }).sort((a, b) => b.net_amount - a.net_amount);

      // by_cashier
      const allCshSet = new Set<string>();
      for (const op of allSalesOps) allCshSet.add((op.cashier as string) || '(без кассира)');
      for (const op of allRefundOps) allCshSet.add((op.cashier as string) || '(без кассира)');
      const by_cashier = [...allCshSet].map(csh => {
        const cSaleOrds = groupOrders(allSalesOps.filter(op => ((op.cashier as string) || '(без кассира)') === csh));
        const cRefOrds  = groupOrders(allRefundOps.filter(op => ((op.cashier as string) || '(без кассира)') === csh));
        const cSalesAmt = cSaleOrds.reduce((s, o) => s + o.amount, 0);
        const cRefAmt   = cRefOrds.reduce((s, o) => s + o.amount, 0);
        return { cashier: csh, sales_count: cSaleOrds.length, sales_amount: cSalesAmt, refund_amount: cRefAmt, net_amount: cSalesAmt - cRefAmt };
      }).sort((a, b) => b.net_amount - a.net_amount);

      const srcRows2 = await fetchAll((off, lim) =>
        supabase.from('fitbase_leads').select('source').not('source', 'is', null).range(off, off + lim - 1)
      );
      const availableSources = [...new Set(srcRows2.map(r => r.source as string))].sort();

      const [mgrLeadRows, mgrOpRows, cashierRows] = await Promise.all([
        supabase.from('fitbase_leads').select('manager').gte('created_date', from).lte('created_date', to).not('manager', 'is', null),
        supabase.from('fitbase_operations').select('manager').gte('op_date', from).lte('op_date', to).not('manager', 'is', null),
        supabase.from('fitbase_operations').select('cashier').gte('op_date', from).lte('op_date', to).not('cashier', 'is', null),
      ]);
      const availableManagers = [...new Set([
        ...(mgrLeadRows.data ?? []).map(r => r.manager as string),
        ...(mgrOpRows.data ?? []).map(r => r.manager as string),
      ])].filter(Boolean).sort();
      const availableCashiers = [...new Set((cashierRows.data ?? []).map(r => r.cashier as string))].filter(Boolean).sort();

      const toItem = (o: OrderRow) => ({ name: o.clientName, amount: o.amount, item: o.item, date: o.date });
      res.json({
        period: { from, to },
        steps: {
          leads:        { count: leads.length,      items: leads.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          in_work:      { count: inWork.length,      items: inWork.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          trial_booked: {
            count: trialBooked.length, trial_sold_count: trialSold.length,
            items: trialBooked.map(v => {
              const vatStr = v.visit_at as string | null;
              const localTime = vatStr ? new Date(new Date(vatStr).getTime() + 5 * 3600_000).toISOString().slice(11, 16) : null;
              return { name: v.client_name, date: localTime ? `${v.visit_date} ${localTime}` : v.visit_date, resource: v.resource, manager: v.manager };
            }),
          },
          visited: { count: visited.length, items: visited.map(v => ({ name: v.client_name, date: v.visit_date, manager: v.manager })) },
          sales: {
            count: newOrders.length, amount: newAmount, net_amount: newAmount,
            from_period_leads: newFromPeriod, from_old_leads: newOrders.length - newFromPeriod,
            refund_count: cleanRefundOrders.filter(o => classifyPurchase(o, contractsByClient) === 'new' || o.itemId == null).length,
            refund_amount: cleanRefundOrders.reduce((s, o) => s + o.amount, 0),
            test_count: testSaleOrders.filter(o => classify(o) === 'new' || o.itemType === 'contract').length,
            test_amount: testSaleOrders.reduce((s, o) => s + o.amount, 0),
            items: newOrders.map(toItem),
            refund_items: cleanRefundOrders.map(toItem),
            test_items: testSaleOrders.map(toItem),
          },
          renewals: {
            count: renewOrders.length, amount: renewAmount, net_amount: renewAmount,
            refund_count: 0, refund_amount: 0, test_count: 0, test_amount: 0,
            items: renewOrders.map(toItem),
            refund_items: [],
            test_items: [],
          },
          same_day: {
            count: sameDayOrders.length, amount: sameDayAmt,
            items: sameDayOrders.map(toItem),
          },
          returned: {
            count: returnedOrders.length, amount: returnedAmt,
            items: returnedOrders.map(toItem),
          },
          goods: {
            count: goodsOrders.length, amount: goodsAmt,
            items: goodsOrders.map(toItem),
          },
          total_net: {
            amount: totalNetAmt,
            sales_amount: totalSalesAmt,
            refund_amount: refundAmount,
            test_count: testSaleOrders.length,
            test_amount: testSaleOrders.reduce((s, o) => s + o.amount, 0),
          },
        },
        by_source,
        by_manager,
        by_cashier,
        availableSources,
        availableManagers,
        availableCashiers,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Day-rhythm: cohort fate of leads created in period
  router.get('/kviz/api/metrics/day-rhythm', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const from = String(req.query.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      const to   = String(req.query.to   || new Date().toISOString().slice(0, 10));
      const sources: string[] = Array.isArray(req.query.sources) ? req.query.sources.map(String) : req.query.sources ? [String(req.query.sources)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;

      // All leads in period — filter in JS
      const { data: leadsData, error: leadsErr } = await supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }
      const allLeads = (leadsData ?? []) as Lead[];

      const cohort = allLeads.filter(l => {
        if (sources.length > 0 && !sources.includes(l.source ?? '')) return false;
        if (manager && !(l.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      // All trial visits for matching
      const visitsAllRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits').select('client_fitbase_id,client_phone,status,is_trial')
          .eq('is_trial', true).range(off, off + lim - 1)
      );
      const allVisits = visitsAllRaw as unknown as Visit[];

      const trialBookedById    = new Set(allVisits.filter(v => notCancelled(v.status)).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
      const trialBookedByPhone = new Set(allVisits.filter(v => notCancelled(v.status)).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));
      const visitedById        = new Set(allVisits.filter(v => v.status === VISIT_STATUS_VISITED).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
      const visitedByPhone     = new Set(allVisits.filter(v => v.status === VISIT_STATUS_VISITED).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));

      function matchedLead(l: Lead, byId: Set<number>, byPhone: Set<string>) {
        if (l.client_fitbase_id != null && byId.has(l.client_fitbase_id)) return true;
        const d = digitsOnly(l.client_phone);
        return d != null && byPhone.has(d);
      }

      const qualified = cohort.filter(l => l.status != null && l.status !== '0');
      const booked    = qualified.filter(l => matchedLead(l, trialBookedById, trialBookedByPhone));
      const visited   = booked.filter(l => matchedLead(l, visitedById, visitedByPhone));
      const bought    = cohort.filter(l => l.status === '-1');

      const pct = (n: number, base: number) => base > 0 ? Math.round(100 * n / base) : 0;
      const steps = [
        { id: 'leads',     label: 'Новые лиды',           count: cohort.length,    pct: 100,                                    items: cohort.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
        { id: 'qualified', label: 'Прошли квалификацию',   count: qualified.length, pct: pct(qualified.length, cohort.length),   items: qualified.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
        { id: 'booked',    label: 'Записались на пробное', count: booked.length,    pct: pct(booked.length, qualified.length),   items: booked.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
        { id: 'visited',   label: 'Пришли на пробное',     count: visited.length,   pct: pct(visited.length, booked.length),     items: visited.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
        { id: 'bought',    label: 'Купили абонемент',       count: bought.length,    pct: pct(bought.length, visited.length),     items: bought.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
      ];

      // by_source — 6 columns (source + 5 funnel steps), all unfiltered data
      const allSrcSet = new Set<string>();
      for (const l of allLeads) allSrcSet.add(l.source ?? '(без источника)');
      const by_source = [...allSrcSet].map(src => {
        const sLeads = allLeads.filter(l => (l.source ?? '(без источника)') === src);
        const sQual  = sLeads.filter(l => l.status != null && l.status !== '0');
        const sBook  = sQual.filter(l => matchedLead(l, trialBookedById, trialBookedByPhone));
        const sVis   = sBook.filter(l => matchedLead(l, visitedById, visitedByPhone));
        const sBuy   = sLeads.filter(l => l.status === '-1');
        return { source: src, leads: sLeads.length, qualified: sQual.length, booked: sBook.length, visited: sVis.length, bought: sBuy.length };
      }).sort((a, b) => b.leads - a.leads);

      // by_manager — same 5-step breakdown
      const allMgrSet = new Set<string>();
      for (const l of allLeads) allMgrSet.add(l.manager ?? '(без менеджера)');
      const by_manager = [...allMgrSet].map(mgr => {
        const mLeads = allLeads.filter(l => (l.manager ?? '(без менеджера)') === mgr);
        const mQual  = mLeads.filter(l => l.status != null && l.status !== '0');
        const mBook  = mQual.filter(l => matchedLead(l, trialBookedById, trialBookedByPhone));
        const mVis   = mBook.filter(l => matchedLead(l, visitedById, visitedByPhone));
        const mBuy   = mLeads.filter(l => l.status === '-1');
        return { manager: mgr, leads: mLeads.length, qualified: mQual.length, booked: mBook.length, visited: mVis.length, bought: mBuy.length };
      }).sort((a, b) => b.leads - a.leads);

      const srcRaw3 = await fetchAll((off, lim) =>
        supabase.from('fitbase_leads').select('source').not('source', 'is', null).range(off, off + lim - 1)
      );
      const availableSources = [...new Set(srcRaw3.map(r => r.source as string))].sort();
      const mgrLeadRaw3 = await fetchAll((off, lim) =>
        supabase.from('fitbase_leads').select('manager').not('manager', 'is', null).range(off, off + lim - 1)
      );
      const mgrOpRaw3 = await fetchAll((off, lim) =>
        supabase.from('fitbase_operations').select('manager').not('manager', 'is', null).range(off, off + lim - 1)
      );
      const availableManagers = [...new Set([
        ...mgrLeadRaw3.map(r => r.manager as string),
        ...mgrOpRaw3.map(r => r.manager as string),
      ])].filter(Boolean).sort();

      res.json({ period: { from, to }, steps, by_source, by_manager, availableSources, availableManagers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Renewals: classify contract purchases in period
  router.get('/kviz/api/metrics/renewals', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const from = String(req.query.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      const to   = String(req.query.to   || new Date().toISOString().slice(0, 10));
      const filterManager = req.query.manager ? String(req.query.manager) : null;
      const filterCashier = req.query.cashier ? String(req.query.cashier) : null;
      const filterType    = req.query.type ? String(req.query.type) : null;

      // Contract sale ops in period (item_type='contract' in raw, op_type='sale')
      const opsData = await fetchAll((off, lim) =>
        supabase.from('fitbase_operations').select('fitbase_id,amount,op_date,client_name,manager,cashier,raw')
          .gte('op_date', from).lte('op_date', to).eq('op_type', 'sale').gt('amount', 0).range(off, off + lim - 1)
      );
      const contractOps = opsData.filter(op => {
        const raw = op.raw as Record<string, unknown>;
        return raw?.item_type === 'contract';
      });

      if (!contractOps.length) { res.json({ period: { from, to }, rows: [], cards: { new: 0, renewal: 0, same_day: 0, returned: 0 }, by_manager: [] }); return; }

      // Get all contracts for involved clients
      const clientIds = [...new Set(contractOps.map(op => opCid(op)).filter((x): x is number => x != null))];
      const contractsRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_contracts').select('fitbase_id,client_fitbase_id,name,payment_date,begin_date,end_date,status,price')
          .in('client_fitbase_id', clientIds).range(off, off + lim - 1)
      );
      const allContracts = contractsRaw as unknown as Array<{ fitbase_id: number; client_fitbase_id: number; name: string|null; payment_date: string|null; begin_date: string|null; end_date: string|null; status: string; price: number }>;

      // Group contracts by client
      const contractsByClient = new Map<number, typeof allContracts>();
      for (const c of allContracts) {
        if (!contractsByClient.has(c.client_fitbase_id)) contractsByClient.set(c.client_fitbase_id, []);
        contractsByClient.get(c.client_fitbase_id)!.push(c);
      }

      type PType = 'new' | 'same_day' | 'renewal' | 'returned';
      interface RenRow { client_name: string|null; contract_name: string|null; purchase_date: string|null; prev_name: string|null; prev_end: string|null; days_between: number|null; type: PType; manager: string|null; cashier: string|null; amount: number }

      const rows: RenRow[] = [];
      for (const op of contractOps) {
        const cid = opCid(op);
        const raw = op.raw as Record<string, unknown>;
        const itemId = Number(raw?.item_id ?? 0);
        const purchaseDate = op.op_date as string|null;
        const thisContract = itemId ? allContracts.find(c => c.fitbase_id === itemId) : null;
        const clientContracts = cid != null ? (contractsByClient.get(cid) ?? []) : [];
        const paid = clientContracts.filter(c => c.status !== 'deleted' && Number(c.price) > 0 && !(c.name ?? '').toLowerCase().includes('пробн')).sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''));

        let type: PType = 'new';
        let prev: typeof allContracts[0] | null = null;
        let daysBetween: number | null = null;

        const idx = paid.findIndex(c => c.fitbase_id === itemId);
        if (idx > 0) {
          prev = paid[idx - 1];
          const pd = purchaseDate ?? '';
          const prevPd = prev.payment_date ?? '';
          if (pd === prevPd) {
            type = 'same_day';
            daysBetween = 0;
          } else {
            const prevEnd = prev.end_date;
            if (!prevEnd) {
              type = 'renewal'; daysBetween = null;
            } else {
              daysBetween = Math.floor((new Date(pd).getTime() - new Date(prevEnd).getTime()) / 86400_000);
              type = daysBetween <= 0 ? 'renewal' : daysBetween <= 30 ? 'renewal' : 'returned';
            }
          }
        }

        rows.push({
          client_name: op.client_name as string|null,
          contract_name: thisContract?.name ?? (raw?.item as Record<string,unknown>)?.name as string|null ?? null,
          purchase_date: purchaseDate,
          prev_name: prev?.name ?? null,
          prev_end: prev?.end_date ?? null,
          days_between: daysBetween,
          type,
          manager: op.manager as string|null,
          cashier: op.cashier as string|null,
          amount: Number(op.amount ?? 0),
        });
      }

      const filtered = rows.filter(r => {
        if (filterManager && !(r.manager ?? '').toLowerCase().includes(filterManager.toLowerCase())) return false;
        if (filterCashier && !(r.cashier ?? '').toLowerCase().includes(filterCashier.toLowerCase())) return false;
        if (filterType && r.type !== filterType) return false;
        return true;
      });

      const cards = { new: 0, renewal: 0, same_day: 0, returned: 0, new_amt: 0, renewal_amt: 0, same_day_amt: 0, returned_amt: 0 };
      for (const r of filtered) { cards[r.type]++; (cards as Record<string, number>)[r.type + '_amt'] += r.amount; }

      const mgrMap = new Map<string, { count: number; amount: number; renewal_count: number; renewal_amount: number }>();
      for (const r of filtered) {
        const m = r.manager ?? '(без менеджера)';
        if (!mgrMap.has(m)) mgrMap.set(m, { count: 0, amount: 0, renewal_count: 0, renewal_amount: 0 });
        const mx = mgrMap.get(m)!; mx.count++; mx.amount += r.amount;
        if (r.type === 'renewal') { mx.renewal_count++; mx.renewal_amount += r.amount; }
      }
      const by_manager = [...mgrMap.entries()].map(([manager, d]) => ({ manager, ...d })).sort((a, b) => b.amount - a.amount);

      // period-filtered available lists
      const [mgrLeadR, mgrOpR, cashierR] = await Promise.all([
        supabase.from('fitbase_leads').select('manager').gte('created_date', from).lte('created_date', to).not('manager', 'is', null),
        supabase.from('fitbase_operations').select('manager').gte('op_date', from).lte('op_date', to).not('manager', 'is', null),
        supabase.from('fitbase_operations').select('cashier').gte('op_date', from).lte('op_date', to).not('cashier', 'is', null),
      ]);
      const availableManagers = [...new Set([...(mgrLeadR.data ?? []).map(r => r.manager as string), ...(mgrOpR.data ?? []).map(r => r.manager as string)])].filter(Boolean).sort();
      const availableCashiers = [...new Set((cashierR.data ?? []).map(r => r.cashier as string))].filter(Boolean).sort();

      res.json({ period: { from, to }, cards, rows: filtered, by_manager, availableManagers, availableCashiers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Async CRM sync — POST starts job, GET returns status
  let syncJob: { status: 'running' | 'done' | 'error'; leads?: number; visits?: number; contracts?: number; error?: string; synced_at?: string } | null = null;

  router.post('/kviz/api/metrics/sync', (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    if (syncJob?.status === 'running') { res.json({ status: 'running' }); return; }
    syncJob = { status: 'running' };
    res.json({ status: 'started' });
    (async () => {
      let locked = false;
      try {
        locked = await acquireLock('fitbase-crm-sync', 10 * 60);
        if (!locked) { syncJob = { status: 'error', error: 'Обновление уже идёт, подождите' }; return; }
        const stats = await runFitbaseCrmSync();
        const now = new Date().toISOString();
        await supabase.from('sync_state').upsert({ key: 'fitbase_crm_synced_at', value: now }, { onConflict: 'key' });
        const stepErrors = stats.errors as string[] | undefined;
        syncJob = {
          status: 'done',
          leads: stats.leads as number,
          visits: stats.visits as number,
          contracts: stats.contracts as number,
          synced_at: now,
          ...(stepErrors?.length ? { error: stepErrors.join('; ') } : {}),
        };
      } catch (e) {
        syncJob = { status: 'error', error: String(e) };
      } finally {
        if (locked) await releaseLock('fitbase-crm-sync').catch(() => {});
      }
    })();
  });

  router.get('/kviz/api/metrics/sync', (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    res.json(syncJob ?? { status: 'idle' });
  });

  return router;
}
