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

function notCancelled(status: number | null): boolean {
  return status == null || !VISIT_CANCELLED_STATUSES.has(status);
}

// Returns latest lead (by created_at) per client_fitbase_id
async function buildClientLeadMap(): Promise<Map<number, { source: string | null; manager: string | null }>> {
  const { data } = await supabase.from('fitbase_leads')
    .select('client_fitbase_id,source,manager,created_at')
    .not('client_fitbase_id', 'is', null)
    .order('created_at', { ascending: true }); // ascending → last write per key = latest lead
  const map = new Map<number, { source: string | null; manager: string | null }>();
  for (const l of (data ?? [])) map.set(Number(l.client_fitbase_id), { source: l.source ?? null, manager: l.manager ?? null });
  return map;
}

function clSrc(id: number | null | undefined, clm: Map<number, { source: string | null; manager: string | null }>): string {
  return (id != null ? clm.get(id)?.source : null) ?? '(без источника)';
}

function clMgr(id: number | null | undefined, clm: Map<number, { source: string | null; manager: string | null }>): string {
  return (id != null ? clm.get(id)?.manager : null) ?? '(без менеджера)';
}

// Extract Fitbase client.id from fitbase_operations.raw
function opCid(op: Record<string, unknown>): number | null {
  const raw = op.raw as Record<string, unknown> | null;
  const c = raw?.client as Record<string, unknown> | null;
  return c?.id != null ? Number(c.id) : null;
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

      const { data: v } = await supabase
        .from('fitbase_visits')
        .select('client_fitbase_id,status,is_trial,client_phone')
        .eq('is_trial', true);
      const allVisits = (v || []) as Visit[];

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

      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows || []).map(r => r.source as string))].sort();
      const { data: mgrRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set((mgrRows || []).map(r => r.manager as string))].sort();

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

      // Client → latest-lead map (all leads, no date filter)
      const clm = await buildClientLeadMap();

      // All leads in period — filter in JS so by_source/by_manager always see full data
      const { data: leadsData, error: leadsErr } = await supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }
      const allLeads = (leadsData ?? []) as Lead[];

      const leads = allLeads.filter(l => {
        if (sources.length > 0 && !sources.includes(l.source ?? '')) return false;
        if (manager && !(l.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      // Trial visits in period
      const { data: visitsData } = await supabase.from('fitbase_visits')
        .select('fitbase_id,client_fitbase_id,client_name,status,visit_at,visit_date,manager,resource')
        .eq('is_trial', true).gte('visit_date', from).lte('visit_date', to);
      const allVisits = (visitsData ?? []) as Array<Record<string, unknown>>;

      // Filter visits via clientLeadMap (source by last lead, manager by last lead)
      const visits = allVisits.filter(v => {
        const cid = v.client_fitbase_id as number | null;
        if (sources.length > 0 && !sources.includes(clm.get(Number(cid))?.source ?? '')) return false;
        if (manager && !(clm.get(Number(cid))?.manager ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      // Sales in period
      const { data: salesRaw } = await supabase.from('fitbase_operations')
        .select('fitbase_id,op_at,amount,client_name,manager,item,pay_method,raw')
        .gte('op_date', from).lte('op_date', to).eq('op_type', 'sale').gt('amount', 0);
      const allSales = (salesRaw ?? []) as Array<Record<string, unknown>>;

      // Sales: source via clientLeadMap; manager via op.manager
      const sales = allSales.filter(op => {
        const cid = opCid(op);
        if (sources.length > 0 && !sources.includes(cid != null ? (clm.get(cid)?.source ?? '') : '')) return false;
        if (manager && !(op.manager as string ?? '').toLowerCase().includes(manager.toLowerCase())) return false;
        return true;
      });

      // Trial sold
      const { data: trialSalesRaw } = await supabase.from('fitbase_operations')
        .select('fitbase_id,client_name,item,raw')
        .gte('op_date', from).lte('op_date', to)
        .in('item', TRIAL_SERVICE_NAMES as string[]);
      const allTrialSold = (trialSalesRaw ?? []) as Array<Record<string, unknown>>;
      const trialSold = allTrialSold.filter(op => {
        const cid = opCid(op);
        if (sources.length > 0 && !sources.includes(cid != null ? (clm.get(cid)?.source ?? '') : '')) return false;
        if (manager) {
          const m = cid != null ? (clm.get(cid)?.manager ?? '') : '';
          if (!m.toLowerCase().includes(manager.toLowerCase())) return false;
        }
        return true;
      });

      const inWork      = leads.filter(l => l.status != null && l.status !== '0');
      const trialBooked = visits.filter(v => notCancelled(v.status as number | null));
      const visited     = visits.filter(v => v.status === VISIT_STATUS_VISITED);
      const salesAmount = sales.reduce((s: number, op) => s + Number(op.amount ?? 0), 0);

      // by_source — 6 columns, computed from all unfiltered data
      const allSrcSet = new Set<string>();
      for (const l of allLeads) allSrcSet.add(l.source ?? '(без источника)');
      const by_source = [...allSrcSet].map(src => {
        const sLeads     = allLeads.filter(l => (l.source ?? '(без источника)') === src);
        const sInWork    = sLeads.filter(l => l.status != null && l.status !== '0');
        const sBooked    = allVisits.filter(v => notCancelled(v.status as number | null) && clSrc(v.client_fitbase_id as number | null, clm) === src);
        const sVisited   = allVisits.filter(v => v.status === VISIT_STATUS_VISITED && clSrc(v.client_fitbase_id as number | null, clm) === src);
        const sTrialSold = allTrialSold.filter(op => clSrc(opCid(op), clm) === src);
        const sSalesAmt  = allSales.filter(op => clSrc(opCid(op), clm) === src).reduce((s, op) => s + Number(op.amount ?? 0), 0);
        return { source: src, leads: sLeads.length, in_work: sInWork.length, trial_booked: sBooked.length, visited: sVisited.length, trial_sold_count: sTrialSold.length, sales_amount: sSalesAmt };
      }).sort((a, b) => b.leads - a.leads);

      // by_manager — 8 columns
      const allMgrSet = new Set<string>();
      for (const l of allLeads) allMgrSet.add(l.manager ?? '(без менеджера)');
      for (const op of allSales) allMgrSet.add((op.manager as string) || '(без менеджера)');
      const by_manager = [...allMgrSet].map(mgr => {
        const mLeads     = allLeads.filter(l => (l.manager ?? '(без менеджера)') === mgr);
        const mInWork    = mLeads.filter(l => l.status != null && l.status !== '0');
        const mBooked    = allVisits.filter(v => notCancelled(v.status as number | null) && clMgr(v.client_fitbase_id as number | null, clm) === mgr);
        const mVisited   = allVisits.filter(v => v.status === VISIT_STATUS_VISITED && clMgr(v.client_fitbase_id as number | null, clm) === mgr);
        const mTrialSold = allTrialSold.filter(op => clMgr(opCid(op), clm) === mgr);
        const mSales     = allSales.filter(op => ((op.manager as string) || '(без менеджера)') === mgr);
        const mSalesAmt  = mSales.reduce((s, op) => s + Number(op.amount ?? 0), 0);
        const items = mLeads.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date }));
        return { manager: mgr, leads: mLeads.length, in_work: mInWork.length, trial_booked: mBooked.length, visited: mVisited.length, trial_sold_count: mTrialSold.length, sales_count: mSales.length, sales_amount: mSalesAmt, items };
      }).sort((a, b) => b.sales_amount - a.sales_amount);

      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows ?? []).map(r => r.source as string))].sort();
      const { data: mgrLeadRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const { data: mgrOpRows } = await supabase.from('fitbase_operations').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set([
        ...(mgrLeadRows ?? []).map(r => r.manager as string),
        ...(mgrOpRows ?? []).map(r => r.manager as string),
      ])].filter(Boolean).sort();

      res.json({
        period: { from, to },
        steps: {
          leads:        { count: leads.length,      items: leads.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          in_work:      { count: inWork.length,      items: inWork.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          trial_booked: {
            count: trialBooked.length,
            trial_sold_count: trialSold.length,
            items: trialBooked.map(v => {
              const vatStr = v.visit_at as string | null;
              const localTime = vatStr ? new Date(new Date(vatStr).getTime() + 5 * 3600_000).toISOString().slice(11, 16) : null;
              return { name: v.client_name, date: localTime ? `${v.visit_date} ${localTime}` : v.visit_date, resource: v.resource, manager: v.manager };
            }),
          },
          visited: { count: visited.length, items: visited.map(v => ({ name: v.client_name, date: v.visit_date, manager: v.manager })) },
          sales:   { count: sales.length, amount: salesAmount, items: sales.map(s => ({ name: s.client_name, amount: s.amount, item: s.item, date: String(s.op_at).slice(0, 10) })) },
        },
        by_source,
        by_manager,
        availableSources,
        availableManagers,
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
      const { data: visitsAll } = await supabase.from('fitbase_visits')
        .select('client_fitbase_id,client_phone,status,is_trial').eq('is_trial', true);
      const allVisits = (visitsAll ?? []) as Visit[];

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

      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows ?? []).map(r => r.source as string))].sort();
      const { data: mgrLeadRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const { data: mgrOpRows } = await supabase.from('fitbase_operations').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set([
        ...(mgrLeadRows ?? []).map(r => r.manager as string),
        ...(mgrOpRows ?? []).map(r => r.manager as string),
      ])].filter(Boolean).sort();

      res.json({ period: { from, to }, steps, by_source, by_manager, availableSources, availableManagers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Async CRM sync — POST starts job, GET returns status
  let syncJob: { status: 'running' | 'done' | 'error'; leads?: number; visits?: number; error?: string; synced_at?: string } | null = null;

  router.post('/kviz/api/metrics/sync', (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    if (syncJob?.status === 'running') { res.json({ status: 'running' }); return; }
    syncJob = { status: 'running' };
    res.json({ status: 'started' });
    (async () => {
      try {
        const locked = await acquireLock('fitbase-crm-sync', 10 * 60);
        if (!locked) { syncJob = { status: 'error', error: 'Уже запущено' }; return; }
        const stats = await runFitbaseCrmSync();
        await releaseLock('fitbase-crm-sync');
        const now = new Date().toISOString();
        await supabase.from('sync_state').upsert({ key: 'fitbase_crm_synced_at', value: now }, { onConflict: 'key' });
        syncJob = { status: 'done', leads: stats.leads as number, visits: stats.visits as number, synced_at: now };
      } catch (e) {
        await releaseLock('fitbase-crm-sync').catch(() => {});
        syncJob = { status: 'error', error: String(e) };
      }
    })();
  });

  router.get('/kviz/api/metrics/sync', (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    res.json(syncJob ?? { status: 'idle' });
  });

  return router;
}
