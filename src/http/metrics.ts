import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { acquireLock, releaseLock } from '../core/lock';
import { runFitbaseCrmSync } from '../jobs/fitbaseCrmSync';

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

function buildFunnel(leads: Lead[], visits: Visit[]) {
  // Match by client_fitbase_id OR last-10-digits of phone
  const trialBookedById   = new Set(visits.filter(v => v.is_trial && v.status !== null && [0,1,3].includes(v.status)).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
  const trialBookedByPhone = new Set(visits.filter(v => v.is_trial && v.status !== null && [0,1,3].includes(v.status)).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));
  const visitedById        = new Set(visits.filter(v => v.is_trial && v.status === 3).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
  const visitedByPhone     = new Set(visits.filter(v => v.is_trial && v.status === 3).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));

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

      // Load ALL trial visits — match by client_fitbase_id OR phone
      const { data: v } = await supabase
        .from('fitbase_visits')
        .select('client_fitbase_id,status,is_trial,client_phone')
        .eq('is_trial', true);
      const allVisits = (v || []) as Visit[];

      const funnel = buildFunnel(allLeads, allVisits);

      // Breakdown by source
      const sourceMap = new Map<string, Lead[]>();
      for (const l of allLeads) {
        const s = l.source ?? '(без источника)';
        if (!sourceMap.has(s)) sourceMap.set(s, []);
        sourceMap.get(s)!.push(l);
      }
      const by_source = [...sourceMap.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([source, sLeads]) => ({
          source,
          ...buildFunnel(sLeads, allVisits),
        }));

      // Breakdown by manager
      const managerMap = new Map<string, Lead[]>();
      for (const l of allLeads) {
        const m = l.manager ?? '(без менеджера)';
        if (!managerMap.has(m)) managerMap.set(m, []);
        managerMap.get(m)!.push(l);
      }
      const by_manager = [...managerMap.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([mgr, mLeads]) => ({
          manager: mgr,
          ...buildFunnel(mLeads, allVisits),
        }));

      // Available sources and managers for filter dropdowns
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

      // Leads created in period
      let leadsQ = supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      if (sources.length === 1) leadsQ = leadsQ.eq('source', sources[0]);
      else if (sources.length > 1) leadsQ = leadsQ.in('source', sources);
      if (manager) leadsQ = leadsQ.ilike('manager', `%${manager}%`);

      // Trial visits scheduled for these dates
      const { data: visitsData } = await supabase.from('fitbase_visits')
        .select('fitbase_id,client_fitbase_id,client_name,client_phone,status,visit_date,is_trial,manager,resource')
        .eq('is_trial', true).gte('visit_date', from).lte('visit_date', to);

      // Abonement sales in period
      const { data: salesData } = await supabase.from('fitbase_operations')
        .select('fitbase_id,op_at,amount,client_name,manager,item,pay_method')
        .gte('op_date', from).lte('op_date', to).eq('op_type', 'sale').gt('amount', 0);

      const { data: leadsData, error: leadsErr } = await leadsQ;
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }

      const allLeads = (leadsData || []) as Lead[];
      const visits = (visitsData || []) as Array<Record<string, unknown>>;
      const sales = (salesData || []) as Array<Record<string, unknown>>;

      const inWork = allLeads.filter(l => l.status != null && l.status !== '0');
      const trialBooked = visits; // already filtered is_trial + date
      const visited = visits.filter(v => v.status === 3);

      // Source breakdown for leads
      const srcMap = new Map<string, number>();
      for (const l of allLeads) { const s = l.source ?? '(без источника)'; srcMap.set(s, (srcMap.get(s) ?? 0) + 1); }
      const by_source = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }));

      // Available filter options
      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows || []).map(r => r.source as string))].sort();
      const { data: mgrRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set((mgrRows || []).map(r => r.manager as string))].sort();

      const salesAmount = sales.reduce((s: number, op) => s + Number(op.amount ?? 0), 0);

      res.json({
        period: { from, to },
        steps: {
          leads:        { count: allLeads.length, items: allLeads.map(l => ({ id: l.fitbase_id, name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          in_work:      { count: inWork.length,   items: inWork.map(l => ({ id: l.fitbase_id, name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
          trial_booked: { count: trialBooked.length, items: trialBooked.map(v => ({ id: v.fitbase_id, name: v.client_name, date: v.visit_date, manager: v.manager })) },
          visited:      { count: visited.length,     items: visited.map(v => ({ id: v.fitbase_id, name: v.client_name, date: v.visit_date, manager: v.manager })) },
          sales:        { count: sales.length, amount: salesAmount, items: sales.map(s => ({ id: s.fitbase_id, name: s.client_name, amount: s.amount, item: s.item, date: String(s.op_at).slice(0,10) })) },
        },
        by_source,
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

      // Cohort: leads created in period
      let leadsQ = supabase.from('fitbase_leads')
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id,client_phone,client_name,created_date')
        .gte('created_date', from).lte('created_date', to);
      if (sources.length === 1) leadsQ = leadsQ.eq('source', sources[0]);
      else if (sources.length > 1) leadsQ = leadsQ.in('source', sources);
      if (manager) leadsQ = leadsQ.ilike('manager', `%${manager}%`);

      const { data: leadsData, error: leadsErr } = await leadsQ;
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }
      const allLeads = (leadsData || []) as Lead[];

      // All trial visits (for matching)
      const { data: visitsAll } = await supabase.from('fitbase_visits')
        .select('client_fitbase_id,client_phone,status,is_trial,visit_date,client_name').eq('is_trial', true);
      const allVisits = (visitsAll || []) as Visit[];

      const trialBookedById   = new Set(allVisits.filter(v => v.status !== null && [0,1,3].includes(v.status as number)).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
      const trialBookedByPhone = new Set(allVisits.filter(v => v.status !== null && [0,1,3].includes(v.status as number)).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));
      const visitedById        = new Set(allVisits.filter(v => v.status === 3).map(v => v.client_fitbase_id).filter((x): x is number => x != null));
      const visitedByPhone     = new Set(allVisits.filter(v => v.status === 3).map(v => digitsOnly(v.client_phone)).filter((x): x is string => x != null));

      function matchedLead(l: Lead, byId: Set<number>, byPhone: Set<string>) {
        if (l.client_fitbase_id != null && byId.has(l.client_fitbase_id)) return true;
        const d = digitsOnly(l.client_phone);
        return d != null && byPhone.has(d);
      }

      const qualified = allLeads.filter(l => l.status != null && l.status !== '0');
      const booked    = qualified.filter(l => matchedLead(l, trialBookedById, trialBookedByPhone));
      const visited   = booked.filter(l => matchedLead(l, visitedById, visitedByPhone));
      const bought    = allLeads.filter(l => l.status === '-1');

      const pct = (n: number, base: number) => base > 0 ? Math.round(100 * n / base) : 0;

      const steps = [
        { id: 'leads',     label: 'Новые лиды',               count: allLeads.length,  pct: 100,                                items: allLeads.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
        { id: 'qualified', label: 'Прошли квалификацию',       count: qualified.length, pct: pct(qualified.length, allLeads.length), items: qualified.map(l => ({ name: l.client_name, source: l.source, manager: l.manager, date: l.created_date })) },
        { id: 'booked',    label: 'Записались на пробное',     count: booked.length,    pct: pct(booked.length, qualified.length), items: booked.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
        { id: 'visited',   label: 'Пришли на пробное',         count: visited.length,   pct: pct(visited.length, booked.length), items: visited.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
        { id: 'bought',    label: 'Купили абонемент',          count: bought.length,    pct: pct(bought.length, visited.length), items: bought.map(l => ({ name: l.client_name, source: l.source, manager: l.manager })) },
      ];

      // Source breakdown for new leads
      const srcMap = new Map<string, number>();
      for (const l of allLeads) { const s = l.source ?? '(без источника)'; srcMap.set(s, (srcMap.get(s) ?? 0) + 1); }
      const by_source = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }));

      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows || []).map(r => r.source as string))].sort();
      const { data: mgrRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set((mgrRows || []).map(r => r.manager as string))].sort();

      res.json({ period: { from, to }, steps, by_source, availableSources, availableManagers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Trigger CRM sync (admin only, calls job directly)
  router.post('/kviz/api/metrics/sync', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    try {
      const locked = await acquireLock('fitbase-crm-sync', 10 * 60);
      if (!locked) { res.json({ status: 'already_running' }); return; }
      const stats = await runFitbaseCrmSync();
      await releaseLock('fitbase-crm-sync');
      await supabase.from('sync_state').upsert({ key: 'fitbase_crm_synced_at', value: new Date().toISOString() }, { onConflict: 'key' });
      res.json({ ok: true, ...stats, synced_at: new Date().toISOString() });
    } catch (e) {
      await releaseLock('fitbase-crm-sync').catch(() => {});
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
