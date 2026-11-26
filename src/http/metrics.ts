import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession, requireAdmin } from './auth';
import { acquireLock, releaseLock } from '../core/lock';
import { runFitbaseCrmSync } from '../jobs/fitbaseCrmSync';
import { TRIAL_SERVICE_NAMES, VISIT_STATUS_VISITED, VISIT_CANCELLED_STATUSES } from '../config';
import { getStaffMap } from './fin';

interface Lead { fitbase_id: string; source: string | null; stage: string | null; funnel: string | null; status: string | null; manager: string | null; client_fitbase_id: number | null; client_phone: string | null; client_name: string | null; created_date: string | null }
interface Visit { client_fitbase_id: number | null; status: number | null; is_trial: boolean; client_phone: string | null }

function digitsOnly(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

// Paginate any Supabase select in 1000-row pages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll(build: (off: number, lim: number) => any): Promise<Record<string, unknown>[]> {
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
export async function buildClientLeadMap(): Promise<Map<number, { source: string | null; manager: string | null }>> {
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

export function clMgr(id: number | null | undefined, clm: Map<number, { source: string | null; manager: string | null }>): string {
  return (id != null ? clm.get(Number(id))?.manager : null) ?? '(без менеджера)';
}

// Extract Fitbase client.id from fitbase_operations.raw
export function opCid(op: Record<string, unknown>): number | null {
  const raw = op.raw as Record<string, unknown> | null;
  const c = raw?.client as Record<string, unknown> | null;
  return c?.id != null ? Number(c.id) : null;
}

export interface OrderRow { amount: number; cid: number|null; manager: string|null; cashier: string|null; item: string|null; date: string|null; clientName: string|null; itemType: string|null; itemId: number|null }
export interface ContractRecord { fitbase_id: number; client_fitbase_id: number; name: string|null; payment_date: string|null; end_date: string|null; status: string; price: number }

// Group individual operation lines into orders by order_id
export function groupOrders(ops: Array<Record<string, unknown>>): OrderRow[] {
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

export function classifyPurchase(o: OrderRow, contractsByClient: Map<number, ContractRecord[]>): 'new'|'renewal'|'returned'|'goods' {
  if (o.itemType !== 'contract') return 'goods';
  if (o.cid == null || !o.date) return 'new';
  const all = contractsByClient.get(o.cid) ?? [];
  // strictly < date so same-day purchases all see the same history and get the same category
  const valid = all.filter(c =>
    Number(c.price) > 0 &&
    !(c.name ?? '').toLowerCase().includes('пробн') &&
    c.status !== 'deleted' &&
    Number(c.fitbase_id) !== o.itemId &&
    (c.payment_date ?? '') < o.date!
  );
  if (valid.length === 0) return 'new';
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
    in_work:      leads.filter(l => l.client_fitbase_id != null).length,
    trial_booked: leads.filter(l => matched(l.client_fitbase_id, l.client_phone, trialBookedById, trialBookedByPhone)).length,
    visited:      leads.filter(l => matched(l.client_fitbase_id, l.client_phone, visitedById, visitedByPhone)).length,
    bought:       leads.filter(l => l.status === '-1').length,
  };
}

export function buildMetricsRouter(): Router {
  const router = Router();

  router.get('/kviz/api/metrics/funnel', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
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
    if (!requireAdmin(req, res)) return;
    try {
      const from = String(req.query.from || new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
      const to   = String(req.query.to   || new Date().toISOString().slice(0, 10));
      const sources: string[] = Array.isArray(req.query.sources) ? req.query.sources.map(String) : req.query.sources ? [String(req.query.sources)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;
      const cashier = req.query.cashier ? String(req.query.cashier) : null;

      const clm = await buildClientLeadMap();

      const { data: leadsData, error: leadsErr } = await supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,funnel,status,manager,client_fitbase_id,client_phone,client_name,created_date')
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
      const returnedOrders = cleanSaleOrders.filter(o => classify(o) === 'returned');
      const goodsOrders    = cleanSaleOrders.filter(o => classify(o) === 'goods');

      const periodCids    = new Set(allLeads.map(l => l.client_fitbase_id).filter((x): x is number => x != null));
      const newFromPeriod = newOrders.filter(o => o.cid != null && periodCids.has(o.cid)).length;
      const newAmount     = newOrders.reduce((s, o) => s + o.amount, 0);
      const renewAmount   = renewOrders.reduce((s, o) => s + o.amount, 0);
      const returnedAmt   = returnedOrders.reduce((s, o) => s + o.amount, 0);
      const goodsAmt      = goodsOrders.reduce((s, o) => s + o.amount, 0);
      const totalSalesAmt = newAmount + renewAmount + returnedAmt + goodsAmt;
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

      const isAlive = (l: Lead) => ['Новые заявки', 'Новички', 'Постоянные'].includes(l.funnel ?? '') && l.stage !== 'Отказ';
      const qual        = leads.filter(l => l.client_fitbase_id != null);
      const alive       = leads.filter(isAlive);
      const trialBooked = visits.filter(v => notCancelled(v.status as number | null));
      const visited     = visits.filter(v => v.status === VISIT_STATUS_VISITED);

      // by_source
      const allSrcSet = new Set<string>();
      for (const l of allLeads) allSrcSet.add(l.source ?? '(без источника)');
      const by_source = [...allSrcSet].map(src => {
        const sLeads     = allLeads.filter(l => (l.source ?? '(без источника)') === src);
        const sQual      = sLeads.filter(l => l.client_fitbase_id != null);
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
        return { source: src, leads: sLeads.length, in_work: sQual.length, alive_count: sLeads.filter(isAlive).length, trial_booked: sBooked.length, visited: sVisited.length, trial_sold_count: sTrialSold.length, sales_count: sSaleOrds.length, new_count: sNewOrds.length, renewal_count: sRenOrds.length, sales_amount: sSalesAmt, new_amount: sNewAmt, renewal_amount: sRenAmt, refund_amount: sRefAmt, net_amount: sSalesAmt - sRefAmt, lead_to_buy_pct: sLtbPct };
      }).sort((a, b) => b.leads - a.leads);

      // by_manager — all keyed by lead-map manager (not op.manager)
      const allMgrSet = new Set<string>();
      for (const l of allLeads) allMgrSet.add(l.manager ?? '(без менеджера)');
      for (const op of allSalesOps) allMgrSet.add(clMgr(opCid(op), clm));
      const by_manager = [...allMgrSet].map(mgr => {
        const mLeads     = allLeads.filter(l => (l.manager ?? '(без менеджера)') === mgr);
        const mQual      = mLeads.filter(l => l.client_fitbase_id != null);
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
        return { manager: mgr, leads: mLeads.length, in_work: mQual.length, alive_count: mLeads.filter(isAlive).length, trial_booked: mBooked.length, visited: mVisited.length, trial_sold_count: mTrialSold.length, sales_count: mSaleOrds.length, new_count: mNewOrds.length, renewal_count: mRenOrds.length, sales_amount: mSalesAmt, new_amount: mNewAmt, renewal_amount: mRenAmt, refund_amount: mRefAmt, net_amount: mSalesAmt - mRefAmt, lead_to_buy_pct: mLtbPct, items };
      }).sort((a, b) => b.net_amount - a.net_amount);

      // by_cashier
      const allCshSet = new Set<string>();
      for (const op of allSalesOps) allCshSet.add((op.cashier as string) || '(без кассира)');
      for (const op of allRefundOps) allCshSet.add((op.cashier as string) || '(без кассира)');
      const by_cashier = [...allCshSet].map(csh => {
        const cSaleOrds = groupOrders(allSalesOps.filter(op => ((op.cashier as string) || '(без кассира)') === csh)).filter(o => !isTest(o));
        const cRefOrds  = groupOrders(allRefundOps.filter(op => ((op.cashier as string) || '(без кассира)') === csh)).filter(o => !isTest(o));
        const cNewOrds  = cSaleOrds.filter(o => classify(o) === 'new');
        const cRenOrds  = cSaleOrds.filter(o => classify(o) === 'renewal');
        const cSalesAmt = cSaleOrds.reduce((s, o) => s + o.amount, 0);
        const cRefAmt   = cRefOrds.reduce((s, o) => s + o.amount, 0);
        const cNewAmt   = cNewOrds.reduce((s, o) => s + o.amount, 0);
        const cRenAmt   = cRenOrds.reduce((s, o) => s + o.amount, 0);
        return { cashier: csh, sales_count: cSaleOrds.length, sales_amount: cSalesAmt, refund_amount: cRefAmt, net_amount: cSalesAmt - cRefAmt, new_count: cNewOrds.length, renewal_count: cRenOrds.length, new_amount: cNewAmt, renewal_amount: cRenAmt };
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
          in_work:      { count: qual.length, alive_count: alive.length, alive_items: alive.map(l => ({ name: l.client_name, funnel: l.funnel, stage: l.stage, manager: l.manager })), items: qual.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
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
    if (!requireAdmin(req, res)) return;
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

      const qualified = cohort.filter(l => l.client_fitbase_id != null);
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
        const sQual  = sLeads.filter(l => l.client_fitbase_id != null);
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
        const mQual  = mLeads.filter(l => l.client_fitbase_id != null);
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
    if (!requireAdmin(req, res)) return;
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

      if (!contractOps.length) { res.json({ period: { from, to }, rows: [], cards: { new: 0, renewal: 0, returned: 0, new_amt: 0, renewal_amt: 0, returned_amt: 0 }, by_manager: [] }); return; }

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

      type PType = 'new' | 'renewal' | 'returned';
      interface RenRow { client_name: string|null; contract_name: string|null; purchase_date: string|null; prev_name: string|null; prev_end: string|null; days_between: number|null; type: PType; manager: string|null; cashier: string|null; amount: number }

      const rows: RenRow[] = [];
      for (const op of contractOps) {
        const cid = opCid(op);
        const raw = op.raw as Record<string, unknown>;
        const itemId = Number(raw?.item_id ?? 0);
        const purchaseDate = op.op_date as string|null;
        const thisContract = itemId ? allContracts.find(c => c.fitbase_id === itemId) : null;
        const clientContracts = cid != null ? (contractsByClient.get(cid) ?? []) : [];
        // use strictly < purchaseDate so same-day contracts (trial or otherwise) don't count as "previous"
        const prevContracts = clientContracts
          .filter(c => c.status !== 'deleted' && Number(c.price) > 0 && !(c.name ?? '').toLowerCase().includes('пробн') && (c.payment_date ?? '') < (purchaseDate ?? ''))
          .sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''));
        let type: PType = 'new';
        let prev: typeof allContracts[0] | null = prevContracts.length > 0 ? prevContracts[prevContracts.length - 1] : null;
        let daysBetween: number | null = null;
        if (prev) {
          const prevEnd = prev.end_date;
          if (!prevEnd) {
            type = 'renewal'; daysBetween = null;
          } else {
            daysBetween = Math.floor((new Date(purchaseDate ?? '').getTime() - new Date(prevEnd).getTime()) / 86400_000);
            type = daysBetween <= 0 ? 'renewal' : daysBetween <= 30 ? 'renewal' : 'returned';
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

      const cards = { new: 0, renewal: 0, returned: 0, new_amt: 0, renewal_amt: 0, returned_amt: 0 };
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
    if (!requireAdmin(req, res)) return;
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
    if (!requireAdmin(req, res)) return;
    res.json(syncJob ?? { status: 'idle' });
  });

  // ── Daily metrics by day ────────────────────────────────────────────────────

  router.get('/kviz/api/metrics/daily', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const yekNow   = new Date(Date.now() + 5 * 3600_000);
      const month    = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : yekNow.toISOString().slice(0, 7);
      const todayStr = yekNow.toISOString().slice(0, 10);
      const buyFilter = String(req.query.buy || 'all') as 'all' | 'new';
      const sources: string[] = Array.isArray(req.query.sources) ? req.query.sources.map(String) : req.query.sources ? [String(req.query.sources)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;

      const [yr, mo] = month.split('-').map(Number);
      const from = `${month}-01`;
      const daysInMonth = new Date(yr, mo, 0).getDate();
      const to = `${month}-${String(daysInMonth).padStart(2, '0')}`;
      const BRANCH = '00000000-0000-0000-0000-000000000001';

      const [planRes, dayInputRes, staffRes, sellerPlanRes, finStaffMap] = await Promise.all([
        supabase.from('metrics_month_plan').select('leads_plan,sales_plan').eq('month', from).eq('branch_id', BRANCH).maybeSingle(),
        supabase.from('metrics_day_input').select('day,is_day_off,budget,on_shift,leads_plan,sales_plan').eq('branch_id', BRANCH).gte('day', from).lte('day', to),
        supabase.from('app_users').select('display_name').order('display_name'),
        supabase.from('metrics_seller_plan').select('seller,sales_plan').eq('branch_id', BRANCH).eq('month', from),
        getStaffMap(),
      ]);

      if (planRes.error) console.error('[daily] metrics_month_plan read error:', planRes.error.message);
      if (dayInputRes.error) console.error('[daily] metrics_day_input read error:', dayInputRes.error.message);

      const monthPlan = planRes.data as { leads_plan: number | null; sales_plan: number | null } | null;
      const diMap = new Map<string, Record<string, unknown>>();
      for (const d of (dayInputRes.data ?? [])) diMap.set(d.day as string, d as Record<string, unknown>);
      const availableStaff = (staffRes.data ?? []).map((u: Record<string, unknown>) => u.display_name as string).filter(Boolean);
      const sellerPlansData: Record<string, number> = {};
      for (const sp of (sellerPlanRes.data ?? [])) sellerPlansData[sp.seller as string] = Number(sp.sales_plan);

      const allDates: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) allDates.push(`${month}-${String(d).padStart(2, '0')}`);

      const isDayOff = (date: string): boolean => {
        const di = diMap.get(date);
        return di?.is_day_off != null ? (di.is_day_off as boolean) : (date === from);
      };

      // Plan distribution
      const workingDays = allDates.filter(d => !isDayOff(d));
      const mLeadsPlan = monthPlan?.leads_plan != null ? Number(monthPlan.leads_plan) : null;
      const mSalesPlan = monthPlan?.sales_plan != null ? Number(monthPlan.sales_plan) : null;
      const wdNoLeadsOvr = workingDays.filter(d => (diMap.get(d)?.leads_plan as number | null) == null);
      const wdNoSalesOvr = workingDays.filter(d => (diMap.get(d)?.sales_plan as number | null) == null);
      const leadsOvrSum  = workingDays.reduce((s, d) => s + ((diMap.get(d)?.leads_plan as number | null) != null ? Number(diMap.get(d)!.leads_plan) : 0), 0);
      const salesOvrSum  = workingDays.reduce((s, d) => s + ((diMap.get(d)?.sales_plan as number | null) != null ? Number(diMap.get(d)!.sales_plan) : 0), 0);

      const getDayLeadsPlan = (date: string): number => {
        if (isDayOff(date)) return 0;
        const di = diMap.get(date);
        if (di?.leads_plan != null) return Number(di.leads_plan);
        return mLeadsPlan != null && wdNoLeadsOvr.length > 0 ? Math.round((mLeadsPlan - leadsOvrSum) / wdNoLeadsOvr.length) : 0;
      };
      const getDaySalesPlan = (date: string): number => {
        if (isDayOff(date)) return 0;
        const di = diMap.get(date);
        if (di?.sales_plan != null) return Number(di.sales_plan);
        return mSalesPlan != null && wdNoSalesOvr.length > 0 ? Math.round((mSalesPlan - salesOvrSum) / wdNoSalesOvr.length) : 0;
      };

      const clm = await buildClientLeadMap();

      const { data: leadsRaw } = await supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,funnel,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      const allLeads = ((leadsRaw ?? []) as Lead[]).filter(l => {
        if (sources.length > 0 && !sources.includes(l.source ?? '')) return false;
        if (manager && !(l.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      const visitsRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits').select('client_fitbase_id,client_phone,status,is_trial,visit_date')
          .eq('is_trial', true).gte('visit_date', from).lte('visit_date', to).range(off, off + lim - 1)
      );
      const allVisits = visitsRaw.filter(v => {
        const cid = v.client_fitbase_id as number | null;
        if (sources.length > 0 && !sources.includes(clm.get(Number(cid))?.source ?? '')) return false;
        if (manager && !(clm.get(Number(cid))?.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      const { data: opsRaw } = await supabase.from('fitbase_operations')
        .select('fitbase_id,op_date,amount,client_name,manager,cashier,item,op_type,raw')
        .gte('op_date', from).lte('op_date', to).in('op_type', ['sale', 'refund']).gt('amount', 0);
      const allOps = (opsRaw ?? []) as Array<Record<string, unknown>>;

      // Month-level test detection
      const mSaleOrds = groupOrders(allOps.filter(o => o.op_type === 'sale'));
      const mRefOrds  = groupOrders(allOps.filter(o => o.op_type === 'refund'));
      const oKey = (o: OrderRow) => o.cid != null && o.itemId != null && o.date ? `${o.cid}:${o.itemId}:${o.date}` : null;
      const saleKeys = new Set<string>(); for (const o of mSaleOrds) { const k = oKey(o); if (k) saleKeys.add(k); }
      const testKeys = new Set<string>(); for (const o of mRefOrds)  { const k = oKey(o); if (k && saleKeys.has(k)) testKeys.add(k); }
      const isTest = (o: OrderRow) => { const k = oKey(o); return k != null && testKeys.has(k); };

      const purCids = [...new Set(allOps.filter(o => o.op_type === 'sale').map(o => opCid(o)).filter((x): x is number => x != null))];
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

      const opMatchesFlt = (op: Record<string, unknown>): boolean => {
        const cid = opCid(op);
        if (sources.length > 0 && !sources.includes(cid != null ? (clm.get(cid)?.source ?? '') : '')) return false;
        if (manager) { const lm = cid != null ? (clm.get(cid)?.manager ?? '') : ''; if (!lm.toLowerCase().includes(manager.toLowerCase())) return false; }
        return true;
      };

      let salesCumulative = 0;
      let pastWorkingCount = 0;
      const classify = (o: OrderRow) => classifyPurchase(o, contractsByClient);

      const days = allDates.map(date => {
        const di      = diMap.get(date);
        const dayOff  = isDayOff(date);
        const isFuture = date > todayStr;

        const dayLeads  = allLeads.filter(l => l.created_date === date);
        const dayVisits = allVisits.filter(v => v.visit_date === date);

        const daySaleOps = allOps.filter(op => op.op_type === 'sale' && op.op_date === date);
        const dayRefOps  = allOps.filter(op => op.op_type === 'refund' && op.op_date === date);

        // Studio total (no source/manager filter)
        const cleanSaleAll = groupOrders(daySaleOps).filter(o => !isTest(o));
        const cleanRefAll  = groupOrders(dayRefOps).filter(o => !isTest(o));
        const salesFact    = cleanSaleAll.reduce((s, o) => s + o.amount, 0) - cleanRefAll.reduce((s, o) => s + o.amount, 0);

        salesCumulative += salesFact;
        if (!dayOff && !isFuture) pastWorkingCount++;

        // Filtered cols for funnel
        const filtSaleOrds = groupOrders(daySaleOps.filter(opMatchesFlt)).filter(o => !isTest(o));
        const filtRefOrds  = groupOrders(dayRefOps.filter(opMatchesFlt)).filter(o => !isTest(o));
        const buyOrds    = buyFilter === 'new' ? filtSaleOrds.filter(o => classify(o) === 'new') : filtSaleOrds;
        const buyRefOrds = buyFilter === 'new' ? filtRefOrds.filter(o => classify(o) === 'new') : filtRefOrds;
        const uniqueBuyers = new Set(buyOrds.map(o => o.cid).filter((x): x is number => x != null));
        const funnelSalesAmt = buyOrds.reduce((s, o) => s + o.amount, 0) - buyRefOrds.reduce((s, o) => s + o.amount, 0);

        const byCashier: Record<string, number> = {};
        for (const o of cleanSaleAll) { const c = o.cashier ?? ''; byCashier[c] = (byCashier[c] ?? 0) + o.amount; }
        for (const o of cleanRefAll)  { const c = o.cashier ?? ''; byCashier[c] = (byCashier[c] ?? 0) - o.amount; }

        const forecast = !isFuture && pastWorkingCount > 0 && workingDays.length > 0
          ? Math.round(salesCumulative / pastWorkingCount * workingDays.length) : 0;

        return {
          date, is_day_off: dayOff, is_future: isFuture,
          budget:     di?.budget != null ? Number(di.budget) : null,
          on_shift:   (di?.on_shift as string[] | null) ?? [],
          leads_plan: getDayLeadsPlan(date), sales_plan: getDaySalesPlan(date),
          leads_fact: dayLeads.length,
          qual_fact:    dayLeads.filter(l => l.client_fitbase_id != null).length,
          booked_fact:  dayVisits.filter(v => notCancelled(v.status as number | null)).length,
          visited_fact: dayVisits.filter(v => v.status === VISIT_STATUS_VISITED).length,
          bought_fact:  uniqueBuyers.size, funnel_sales_amt: funnelSalesAmt,
          sales_fact: salesFact, by_cashier: byCashier, orders_count: cleanSaleAll.length,
          sales_cumulative: salesCumulative, sales_forecast: forecast,
        };
      });

      const totals = {
        leads_plan:       days.reduce((s, d) => s + d.leads_plan, 0),
        sales_plan:       days.reduce((s, d) => s + d.sales_plan, 0),
        leads_fact:       days.reduce((s, d) => s + d.leads_fact, 0),
        qual_fact:        days.reduce((s, d) => s + d.qual_fact, 0),
        booked_fact:      days.reduce((s, d) => s + d.booked_fact, 0),
        visited_fact:     days.reduce((s, d) => s + d.visited_fact, 0),
        bought_fact:      days.reduce((s, d) => s + d.bought_fact, 0),
        funnel_sales_amt: days.reduce((s, d) => s + d.funnel_sales_amt, 0),
        sales_fact:       days.reduce((s, d) => s + d.sales_fact, 0),
        orders_count:     days.reduce((s, d) => s + d.orders_count, 0),
      };

      const [srcRaw, mgrRaw, cshRes] = await Promise.all([
        fetchAll((off, lim) => supabase.from('fitbase_leads').select('source').not('source', 'is', null).range(off, off + lim - 1)),
        fetchAll((off, lim) => supabase.from('fitbase_leads').select('manager').not('manager', 'is', null).range(off, off + lim - 1)),
        supabase.from('fitbase_operations').select('cashier').gte('op_date', from).lte('op_date', to).not('cashier', 'is', null),
      ]);
      const availableSources  = [...new Set(srcRaw.map(r => r.source as string))].sort();
      const availableManagers = [...new Set(mgrRaw.map(r => r.manager as string))].sort();
      const availableCashiers = [...new Set((cshRes.data ?? []).map(r => r.cashier as string))].filter(Boolean).sort();

      const staff = [...finStaffMap.entries()].map(([fitbase_name, info]) => ({ fitbase_name, display_name: info.display_name, hidden: info.hidden }));
      res.json({ month, days, totals, month_plan: monthPlan, seller_plans: sellerPlansData, availableSources, availableManagers, availableCashiers, availableStaff, staff });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/metrics/month-plan', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { month, leads_plan, sales_plan } = req.body as { month?: string; leads_plan?: number | null; sales_plan?: number | null };
      if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: 'Неверный month' }); return; }
      const BRANCH = '00000000-0000-0000-0000-000000000001';
      const monthDate = `${month}-01`; // month column is DATE, always store first day
      const session = getSession(req)!;
      const payload: Record<string, unknown> = { month: monthDate, branch_id: BRANCH, updated_by: session.display_name, updated_at: new Date().toISOString() };
      if (leads_plan !== undefined) payload.leads_plan = leads_plan;
      if (sales_plan !== undefined) payload.sales_plan = sales_plan;
      const { error } = await supabase.from('metrics_month_plan').upsert(payload, { onConflict: 'branch_id,month' });
      if (error) { console.error('[month-plan] upsert error:', error.message); res.status(500).json({ error: 'Ошибка сохранения плана' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Seller plan ────────────────────────────────────────────────────────────────

  router.get('/kviz/api/metrics/seller-plan', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
      const BRANCH_SP = '00000000-0000-0000-0000-000000000001';
      const { data, error } = await supabase.from('metrics_seller_plan')
        .select('seller,sales_plan').eq('branch_id', BRANCH_SP).eq('month', `${month}-01`);
      if (error) { console.error('[seller-plan] read:', error.message); res.status(500).json({ error: 'Ошибка загрузки планов продавцов' }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/metrics/seller-plan', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { month, seller, sales_plan } = req.body as { month?: string; seller?: string; sales_plan?: number | null };
      if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: 'Неверный month' }); return; }
      if (!seller) { res.status(400).json({ error: 'Не указан продавец' }); return; }
      const BRANCH_SP = '00000000-0000-0000-0000-000000000001';
      const session = getSession(req)!;
      const { error } = await supabase.from('metrics_seller_plan').upsert({
        branch_id: BRANCH_SP, month: `${month}-01`, seller,
        sales_plan: sales_plan != null ? Number(sales_plan) : 0,
        updated_by: session.display_name, updated_at: new Date().toISOString(),
      }, { onConflict: 'branch_id,month,seller' });
      if (error) { console.error('[seller-plan] upsert:', error.message); res.status(500).json({ error: 'Ошибка сохранения плана продавца' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.put('/kviz/api/metrics/day-input', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { date, is_day_off, budget, on_shift, leads_plan, sales_plan } = req.body as { date?: string; is_day_off?: boolean; budget?: number | null; on_shift?: string[]; leads_plan?: number | null; sales_plan?: number | null };
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'Неверный date' }); return; }
      const BRANCH = '00000000-0000-0000-0000-000000000001';
      const session = getSession(req)!;
      const payload: Record<string, unknown> = { day: date, branch_id: BRANCH, updated_by: session.display_name, updated_at: new Date().toISOString() };
      if (is_day_off !== undefined) payload.is_day_off = is_day_off;
      if (budget !== undefined) payload.budget = budget;
      payload.on_shift = Array.isArray(on_shift) ? on_shift : []; // not null — column has NOT NULL default '{}'
      if (leads_plan !== undefined) payload.leads_plan = leads_plan !== null && leads_plan !== 0 ? leads_plan : null;
      if (sales_plan !== undefined) payload.sales_plan = sales_plan !== null && sales_plan !== 0 ? sales_plan : null;
      const { error } = await supabase.from('metrics_day_input').upsert(payload, { onConflict: 'branch_id,day' });
      if (error) { console.error('[day-input] upsert error:', error.message); res.status(500).json({ error: 'Ошибка сохранения данных дня' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Plan-fact slice report (admin only)
  router.get('/kviz/api/metrics/plan-fact', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const BRANCH = '00000000-0000-0000-0000-000000000001';
      const TOTAL_STEPS = 10;
      const STEP_DAYS   = 3;

      const yekYesterday = new Date(Date.now() + 5 * 3600_000 - 86400_000).toISOString().slice(0, 10);
      const dateStr  = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? String(req.query.date) : yekYesterday;
      const dateObj  = new Date(dateStr + 'T00:00:00Z');
      const year     = dateObj.getUTCFullYear();
      const monthNum = dateObj.getUTCMonth() + 1;
      const dom      = dateObj.getUTCDate();
      const monthStr   = `${year}-${String(monthNum).padStart(2, '0')}`;
      const monthStart = `${monthStr}-01`;
      const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
      const monthEnd = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
      const stepsDone = Math.floor(dom / STEP_DAYS);

      const [planRes, sellerRes, dayInputRes, finStaffMap] = await Promise.all([
        supabase.from('metrics_month_plan').select('sales_plan').eq('branch_id', BRANCH).eq('month', monthStart).maybeSingle(),
        supabase.from('metrics_seller_plan').select('seller,sales_plan').eq('branch_id', BRANCH).eq('month', monthStart),
        supabase.from('metrics_day_input').select('day,is_day_off').eq('branch_id', BRANCH).gte('day', monthStart).lte('day', monthEnd),
        getStaffMap(),
      ]);

      const monthPlan   = planRes.data?.sales_plan != null ? Number(planRes.data.sales_plan) : 0;
      const sellerPlans = new Map<string, number>();
      for (const sp of (sellerRes.data ?? [])) sellerPlans.set(sp.seller as string, Number(sp.sales_plan ?? 0));

      const dayOffSet = new Set<string>();
      for (const di of (dayInputRes.data ?? [])) { if (di.is_day_off) dayOffSet.add(di.day as string); }

      const allMonthDays: string[] = [];
      for (let d = 1; d <= daysInMonth; d++) allMonthDays.push(`${monthStr}-${String(d).padStart(2, '0')}`);
      const workingDays  = allMonthDays.filter(d => !dayOffSet.has(d));
      const wdElapsed    = workingDays.filter(d => d <= dateStr).length;
      const wdRemaining  = workingDays.filter(d => d > dateStr).length;

      const allOps = await fetchAll((off, lim) =>
        supabase.from('fitbase_operations')
          .select('fitbase_id,op_type,amount,manager,cashier,item,raw,client_name,op_date')
          .gte('op_date', monthStart).lte('op_date', dateStr).range(off, off + lim - 1)
      );

      const pfSaleOps   = allOps.filter(op => (op.op_type as string) !== 'refund' && Number(op.amount) > 0);
      const pfRefundOps = allOps.filter(op => (op.op_type as string) === 'refund' || Number(op.amount) < 0);
      const pfSaleOrd   = groupOrders(pfSaleOps);
      const pfRefOrd    = groupOrders(pfRefundOps);

      const purCids = [...new Set(pfSaleOps.map(op => opCid(op)).filter((x): x is number => x != null))];
      const cbc = new Map<number, ContractRecord[]>();
      if (purCids.length > 0) {
        const cr = await fetchAll((off, lim) =>
          supabase.from('fitbase_contracts').select('fitbase_id,client_fitbase_id,name,payment_date,end_date,status,price')
            .in('client_fitbase_id', purCids).range(off, off + lim - 1)
        );
        for (const c of cr) {
          const cid = Number(c.client_fitbase_id);
          if (!cbc.has(cid)) cbc.set(cid, []);
          cbc.get(cid)!.push(c as unknown as ContractRecord);
        }
      }

      const oKey = (o: OrderRow) => o.cid != null && o.itemId != null && o.date ? `${o.cid}:${o.itemId}:${o.date}` : null;
      const skSet = new Set<string>(); for (const o of pfSaleOrd) { const k = oKey(o); if (k) skSet.add(k); }
      const tkSet = new Set<string>(); for (const o of pfRefOrd)  { const k = oKey(o); if (k && skSet.has(k)) tkSet.add(k); }
      const isTst = (o: OrderRow) => { const k = oKey(o); return k != null && tkSet.has(k); };

      const cleanSale = pfSaleOrd.filter(o => !isTst(o));
      const cleanRef  = pfRefOrd.filter(o => !isTst(o));
      const cls = (o: OrderRow) => classifyPurchase(o, cbc);

      // Build itemToOriginal for attributing refunds to the original seller
      const itemToOriginal = new Map<number, { cashier: string }>();
      for (const o of cleanSale) {
        if (o.itemId != null && o.cashier) itemToOriginal.set(o.itemId, { cashier: o.cashier });
      }
      const refMissingIds = [...new Set(
        cleanRef.map(o => o.itemId).filter((x): x is number => x != null && !itemToOriginal.has(x))
      )];
      if (refMissingIds.length > 0) {
        const twoYearsAgo = `${year - 2}-${String(monthNum).padStart(2, '0')}-01`;
        const histOps = await fetchAll((off, lim) =>
          supabase.from('fitbase_operations')
            .select('fitbase_id,cashier,raw,op_date')
            .neq('op_type', 'refund').gt('amount', 0)
            .gte('op_date', twoYearsAgo).lt('op_date', monthStart)
            .range(off, off + lim - 1)
        );
        for (const o of groupOrders(histOps)) {
          if (o.itemId != null && o.cashier && !itemToOriginal.has(o.itemId)) {
            itemToOriginal.set(o.itemId, { cashier: o.cashier });
          }
        }
      }
      const origCashierForRefund = (o: OrderRow): string => {
        const orig = o.itemId != null ? itemToOriginal.get(o.itemId) : null;
        return orig?.cashier ?? o.cashier ?? '';
      };

      const hidden = new Set<string>();
      for (const [name, info] of finStaffMap.entries()) { if (info.hidden) hidden.add(name); }

      const deptStep = monthPlan > 0 ? monthPlan / TOTAL_STEPS : 0;

      function computeFact(seller: string | null = null) {
        const ms = seller !== null ? cleanSale.filter(o => o.cashier === seller) : cleanSale;
        const mr = seller !== null ? cleanRef.filter(o => origCashierForRefund(o) === seller) : cleanRef;
        const mn = ms.filter(o => cls(o) === 'new');
        const mk = ms.filter(o => cls(o) === 'renewal');
        const sa = ms.reduce((s, o) => s + o.amount, 0);
        const ra = mr.reduce((s, o) => s + o.amount, 0);
        const stepFacts: (number | null)[] = [];
        for (let i = 0; i < TOTAL_STEPS; i++) {
          const ss = `${monthStr}-${String(i * STEP_DAYS + 1).padStart(2, '0')}`;
          const se = `${monthStr}-${String(Math.min((i + 1) * STEP_DAYS, daysInMonth)).padStart(2, '0')}`;
          if (se > dateStr) { stepFacts.push(null); continue; }
          stepFacts.push(
            ms.filter(o => o.date && o.date >= ss && o.date <= se).reduce((s, o) => s + o.amount, 0) -
            mr.filter(o => o.date && o.date >= ss && o.date <= se).reduce((s, o) => s + o.amount, 0)
          );
        }
        return { fact: sa - ra, newAmt: mn.reduce((s,o)=>s+o.amount,0), renewAmt: mk.reduce((s,o)=>s+o.amount,0), newCnt: mn.length, renewCnt: mk.length, stepFacts };
      }

      function buildRow(plan: number, stepPlan: number, f: ReturnType<typeof computeFact>) {
        const pod = stepsDone * stepPlan;
        const pct = pod > 0 ? Math.round(100 * f.fact / pod) : (f.fact > 0 ? 100 : 0);
        const dev = f.fact - pod;
        const pom = plan > 0 ? Math.round(100 * f.fact / plan) : 0;
        const fct = wdElapsed > 0 ? Math.round(f.fact / wdElapsed * workingDays.length) : 0;
        const fcp = plan > 0 ? Math.round(100 * fct / plan) : 0;
        const npd = wdRemaining > 0 ? Math.round((plan - f.fact) / wdRemaining) : 0;
        const st  = pct >= 100 ? 'в плане' : pct >= 90 ? 'почти' : 'отстаёт';
        let cum = 0;
        const sr: (number|null)[] = f.stepFacts.map((sf, i) => { if (sf === null) return null; cum += sf; return cum - (i+1)*stepPlan; });
        return { plan, step_plan: stepPlan, plan_on_date: pod, fact: f.fact, new_amount: f.newAmt, renewal_amount: f.renewAmt, new_count: f.newCnt, renewal_count: f.renewCnt, pct_of_step: pct, deviation: dev, pct_of_month: pom, forecast: fct, forecast_pct: fcp, needed_per_day: npd, status: st, steps: f.stepFacts, steps_running: sr };
      }

      // Collect sellers from sales and refund attribution
      const salesSellerSet = new Set<string>();
      for (const o of cleanSale) if (o.cashier) salesSellerSet.add(o.cashier);
      for (const o of cleanRef) { const c = origCashierForRefund(o); if (c) salesSellerSet.add(c); }

      // Add sellers with plan but no sales this month (not hidden)
      const allSellerSet = new Set<string>(salesSellerSet);
      for (const seller of sellerPlans.keys()) if (!hidden.has(seller)) allSellerSet.add(seller);

      const sellers = [...allSellerSet]
        .filter(s => !hidden.has(s))
        .map(seller => {
          const pp = sellerPlans.get(seller) ?? 0;
          const sp = pp > 0 ? pp / TOTAL_STEPS : 0;
          const info = finStaffMap.get(seller);
          const display_name = info?.display_name ?? seller;
          return { name: seller, display_name, ...buildRow(pp, sp, computeFact(seller)) };
        })
        .sort((a, b) => b.fact - a.fact);

      const deptRow = buildRow(monthPlan, deptStep, computeFact(null));

      const spVals = [...sellerPlans.values()].filter(v => v > 0);
      const personalStepPlan = spVals.length > 0 ? spVals.reduce((a,b)=>a+b,0) / spVals.length / TOTAL_STEPS : 0;

      res.json({
        date: dateStr, month: monthStr, steps_done: stepsDone, total_steps: TOTAL_STEPS, step_days: STEP_DAYS,
        month_plan: monthPlan, dept_step_plan: deptStep, personal_step_plan: personalStepPlan,
        working_days_month: workingDays.length, working_days_elapsed: wdElapsed, working_days_remaining: wdRemaining,
        sellers, dept: deptRow,
        has_hidden_sellers: [...salesSellerSet].some(s => hidden.has(s)) || cleanSale.some(o => !o.cashier),
        seller_plans: Object.fromEntries(sellerPlans),
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Trial Peak ──────────────────────────────────────────────────────────────

  router.get('/kviz/api/metrics/trial-peak', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const yekNow = new Date(Date.now() + 5 * 3600_000);
      const todayUTC5 = yekNow.toISOString().slice(0, 10);
      const monthStartUTC5 = todayUTC5.slice(0, 7) + '-01';

      const from    = String(req.query.from  || monthStartUTC5);
      const to      = String(req.query.to    || todayUTC5);
      const group   = (['day','week','month'].includes(String(req.query.group)) ? String(req.query.group) : 'day') as 'day'|'week'|'month';
      const sources = Array.isArray(req.query.sources) ? (req.query.sources as string[]).map(String)
                    : req.query.sources ? [String(req.query.sources)] : [];
      const manager = req.query.manager ? String(req.query.manager) : null;

      // helpers
      function tpAddDays(d: string, n: number): string {
        const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
      }
      function tpWeekStart(d: string): string {
        const dt = new Date(d + 'T00:00:00Z');
        const diff = (dt.getUTCDay() + 3) % 7; // 0 if Thursday
        return tpAddDays(d, -diff);
      }
      function tpDateUTC5(iso: string): string {
        return new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
      }
      function tpHourUTC5(iso: string | null): number | null {
        if (!iso) return null;
        return (new Date(iso).getUTCHours() + 5) % 24;
      }
      function tpHourKey(h: number | null): string {
        if (h == null) return 'до 08';
        if (h < 8) return 'до 08';
        if (h > 23) return 'после 23';
        return String(h).padStart(2,'0') + ':00';
      }
      const HOUR_KEYS = ['до 08', ...Array.from({length: 16}, (_,i) => String(i+8).padStart(2,'0')+':00'), 'после 23'];

      // load visits: extend range by 30 days to capture cohort (booked in period, visited later)
      const toExt = tpAddDays(to, 30);
      const rawVisits = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits')
          .select('fitbase_id,client_fitbase_id,status,booked_at,visit_at,visit_date')
          .eq('is_trial', true)
          .gte('visit_date', from)
          .lte('visit_date', toExt)
          .range(off, off + lim - 1)
      );
      // also load visits booked in [from, to] but scheduled before from (edge case: rescheduled)
      const bookedEarlyRaw = await fetchAll((off, lim) =>
        supabase.from('fitbase_visits')
          .select('fitbase_id,client_fitbase_id,status,booked_at,visit_at,visit_date')
          .eq('is_trial', true)
          .lt('visit_date', from)
          .gte('booked_at', from + 'T00:00:00+05:00')
          .lte('booked_at', to + 'T23:59:59+05:00')
          .range(off, off + lim - 1)
      );
      const seenIds = new Set(rawVisits.map(v => v.fitbase_id as string));
      const allRaw = [...rawVisits, ...bookedEarlyRaw.filter(v => !seenIds.has(v.fitbase_id as string))];

      // source/manager filter via lead map
      const clm = await buildClientLeadMap();
      type TV = { fitbase_id: string; cid: number|null; status: number|null; booked_at: string|null; visit_at: string|null; visit_date: string|null; src: string|null; mgr: string|null };
      const visits: TV[] = allRaw.map(v => {
        const cid = v.client_fitbase_id != null ? Number(v.client_fitbase_id) : null;
        const lead = cid != null ? clm.get(cid) : undefined;
        return { fitbase_id: v.fitbase_id as string, cid, status: v.status != null ? Number(v.status) : null, booked_at: (v.booked_at as string|null) ?? null, visit_at: (v.visit_at as string|null) ?? null, visit_date: (v.visit_date as string|null) ?? null, src: lead?.source ?? null, mgr: lead?.manager ?? null };
      }).filter(v => {
        if (sources.length > 0 && !sources.includes(v.src ?? '')) return false;
        if (manager && !(v.mgr ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      // partition helpers (status 2 = cancelled, excluded everywhere)
      const notCancelledV = (v: TV) => v.status !== 2;
      const visitedV      = (v: TV) => v.status === 3;
      const inPeriodByVisitDate = (v: TV) => v.visit_date != null && v.visit_date >= from && v.visit_date <= to;
      const inPeriodByBookedAt  = (v: TV) => { if (!v.booked_at) return false; const d = tpDateUTC5(v.booked_at); return d >= from && d <= to; };

      // generate periods (all, no gaps)
      function genPeriods(): { key: string; label: string; from: string; to: string }[] {
        const res: { key: string; label: string; from: string; to: string }[] = [];
        if (group === 'day') {
          let d = from;
          while (d <= to) {
            const dt = new Date(d + 'T00:00:00Z');
            const dd = dt.getUTCDate(), mm = dt.toLocaleString('ru', { month: 'short', timeZone: 'UTC' });
            res.push({ key: d, label: `${dd}.${String(dt.getUTCMonth()+1).padStart(2,'0')}`, from: d, to: d });
            d = tpAddDays(d, 1);
          }
        } else if (group === 'week') {
          let ws = tpWeekStart(from);
          while (ws <= to) {
            const we = tpAddDays(ws, 6);
            const dFrom = new Date(ws + 'T00:00:00Z'), dTo = new Date(we + 'T00:00:00Z');
            const fD = dFrom.getUTCDate(), fM = dFrom.toLocaleString('ru', { month: 'short', timeZone: 'UTC' });
            const tD = dTo.getUTCDate(), tM = dTo.toLocaleString('ru', { month: 'short', timeZone: 'UTC' });
            const label = `Чт ${String(fD).padStart(2,'0')}.${String(dFrom.getUTCMonth()+1).padStart(2,'0')}–Ср ${String(tD).padStart(2,'0')}.${String(dTo.getUTCMonth()+1).padStart(2,'0')}`;
            res.push({ key: ws, label, from: ws, to: we });
            ws = tpAddDays(ws, 7);
          }
        } else { // month
          let ym = from.slice(0, 7);
          const ymTo = to.slice(0, 7);
          while (ym <= ymTo) {
            const [y, m] = ym.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            const monthLabel = new Date(ym + '-01T00:00:00Z').toLocaleString('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
            res.push({ key: ym, label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1), from: ym + '-01', to: `${ym}-${String(lastDay).padStart(2,'0')}` });
            const nextM = m === 12 ? 1 : m + 1, nextY = m === 12 ? y + 1 : y;
            ym = `${nextY}-${String(nextM).padStart(2,'0')}`;
          }
        }
        return res;
      }
      const periods = genPeriods();

      // compute period metrics
      function periodKey(v: TV, useBooked: boolean): string | null {
        const dateStr = useBooked
          ? (v.booked_at ? tpDateUTC5(v.booked_at) : null)
          : v.visit_date;
        if (!dateStr) return null;
        if (group === 'day') return dateStr;
        if (group === 'week') return tpWeekStart(dateStr);
        return dateStr.slice(0, 7);
      }

      // build maps
      const pBooked    = new Map<string, number>();
      const pScheduled = new Map<string, number>();
      const pPrVisit   = new Map<string, number>();
      const pPrBooked  = new Map<string, number>();
      for (const p of periods) { pBooked.set(p.key,0); pScheduled.set(p.key,0); pPrVisit.set(p.key,0); pPrBooked.set(p.key,0); }

      for (const v of visits) {
        if (notCancelledV(v)) {
          const bk = inPeriodByBookedAt(v) ? periodKey(v, true) : null;
          if (bk && pBooked.has(bk)) pBooked.set(bk, (pBooked.get(bk)??0) + 1);
          const sc = inPeriodByVisitDate(v) ? periodKey(v, false) : null;
          if (sc && pScheduled.has(sc)) pScheduled.set(sc, (pScheduled.get(sc)??0) + 1);
        }
        if (visitedV(v)) {
          const pv = inPeriodByVisitDate(v) ? periodKey(v, false) : null;
          if (pv && pPrVisit.has(pv)) pPrVisit.set(pv, (pPrVisit.get(pv)??0) + 1);
          const pb = inPeriodByBookedAt(v) ? periodKey(v, true) : null;
          if (pb && pPrBooked.has(pb)) pPrBooked.set(pb, (pPrBooked.get(pb)??0) + 1);
        }
      }

      const periodsResult = periods.map(p => ({
        key: p.key, label: p.label, from: p.from, to: p.to,
        booked: pBooked.get(p.key)??0,
        scheduled: pScheduled.get(p.key)??0,
        pr_by_visit: pPrVisit.get(p.key)??0,
        pr_by_booked: pPrBooked.get(p.key)??0,
      }));

      // by_hour (over the entire period)
      type HourMap = Map<string, { booked: number; scheduled: number; pr_by_visit: number; pr_by_booked: number }>;
      const hMap: HourMap = new Map(HOUR_KEYS.map(k => [k, { booked:0, scheduled:0, pr_by_visit:0, pr_by_booked:0 }]));
      for (const v of visits) {
        if (notCancelledV(v)) {
          if (inPeriodByBookedAt(v)) {
            const h = tpHourKey(tpHourUTC5(v.booked_at));
            hMap.get(h)!.booked++;
          }
          if (inPeriodByVisitDate(v)) {
            const h = tpHourKey(tpHourUTC5(v.visit_at));
            hMap.get(h)!.scheduled++;
          }
        }
        if (visitedV(v)) {
          if (inPeriodByVisitDate(v)) {
            const h = tpHourKey(tpHourUTC5(v.visit_at));
            hMap.get(h)!.pr_by_visit++;
          }
          if (inPeriodByBookedAt(v)) {
            const h = tpHourKey(tpHourUTC5(v.booked_at));
            hMap.get(h)!.pr_by_booked++;
          }
        }
      }
      const by_hour = HOUR_KEYS.map(k => ({ key: k, ...hMap.get(k)! }));

      // heatmap: day × hour (by visit_date and visit_at time for scheduled/pr_by_visit; by booked_at for booked/pr_by_booked)
      const days: string[] = [];
      { let d = from; while (d <= to) { days.push(d); d = tpAddDays(d, 1); } }
      const heatmap = days.map(day => {
        const cells: Record<string, { booked: number; scheduled: number; pr_by_visit: number; pr_by_booked: number }> = {};
        for (const hk of HOUR_KEYS) cells[hk] = { booked:0, scheduled:0, pr_by_visit:0, pr_by_booked:0 };
        for (const v of visits) {
          if (notCancelledV(v)) {
            if (inPeriodByBookedAt(v) && v.booked_at && tpDateUTC5(v.booked_at) === day) {
              const h = tpHourKey(tpHourUTC5(v.booked_at));
              cells[h].booked++;
            }
            if (v.visit_date === day) {
              const h = tpHourKey(tpHourUTC5(v.visit_at));
              cells[h].scheduled++;
            }
          }
          if (visitedV(v)) {
            if (v.visit_date === day) {
              const h = tpHourKey(tpHourUTC5(v.visit_at));
              cells[h].pr_by_visit++;
            }
            if (inPeriodByBookedAt(v) && v.booked_at && tpDateUTC5(v.booked_at) === day) {
              const h = tpHourKey(tpHourUTC5(v.booked_at));
              cells[h].pr_by_booked++;
            }
          }
        }
        const dt = new Date(day + 'T00:00:00Z');
        const DOW = ['вс','пн','вт','ср','чт','пт','сб'];
        const label = `${String(dt.getUTCDate()).padStart(2,'0')}.${String(dt.getUTCMonth()+1).padStart(2,'0')} ${DOW[dt.getUTCDay()]}`;
        const total = { booked:0, scheduled:0, pr_by_visit:0, pr_by_booked:0 };
        for (const hk of HOUR_KEYS) { total.booked += cells[hk].booked; total.scheduled += cells[hk].scheduled; total.pr_by_visit += cells[hk].pr_by_visit; total.pr_by_booked += cells[hk].pr_by_booked; }
        return { date: day, label, cells, total };
      });

      // peaks: for each metric, find period and hour with max
      function peakOf(arr: { key: string; val: number }[]): { key: string; val: number } {
        return arr.reduce((best, cur) => cur.val > best.val ? cur : best, { key: '', val: 0 });
      }
      const peaks = {
        booked:      { period: peakOf(periodsResult.map(p => ({ key: p.key, val: p.booked }))),      hour: peakOf(by_hour.map(h => ({ key: h.key, val: h.booked }))) },
        scheduled:   { period: peakOf(periodsResult.map(p => ({ key: p.key, val: p.scheduled }))),   hour: peakOf(by_hour.map(h => ({ key: h.key, val: h.scheduled }))) },
        pr_by_visit: { period: peakOf(periodsResult.map(p => ({ key: p.key, val: p.pr_by_visit }))), hour: peakOf(by_hour.map(h => ({ key: h.key, val: h.pr_by_visit }))) },
        pr_by_booked:{ period: peakOf(periodsResult.map(p => ({ key: p.key, val: p.pr_by_booked }))),hour: peakOf(by_hour.map(h => ({ key: h.key, val: h.pr_by_booked }))) },
      };

      // available sources/managers for filter dropdowns (from all visits in extended range, unfiltered)
      const availSrcs = new Set<string>(), availMgrs = new Set<string>();
      for (const v of allRaw) {
        const cid = v.client_fitbase_id != null ? Number(v.client_fitbase_id) : null;
        const lead = cid != null ? clm.get(cid) : undefined;
        if (lead?.source) availSrcs.add(lead.source);
        if (lead?.manager) availMgrs.add(lead.manager);
      }

      res.json({ periods: periodsResult, by_hour, heatmap, peaks, availableSources: [...availSrcs].sort(), availableManagers: [...availMgrs].sort() });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return router;
}
