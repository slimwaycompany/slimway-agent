import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

interface Lead { fitbase_id: string; source: string | null; stage: string | null; status: string | null; manager: string | null; client_fitbase_id: number | null }
interface Visit { client_fitbase_id: number | null; status: number | null; is_trial: boolean }

function isAdmin(req: Request, res: Response): boolean {
  if (getSession(req)?.role === 'admin') return true;
  res.status(403).json({ error: 'Только для администратора' }); return false;
}

function buildFunnel(leads: Lead[], visits: Visit[]) {
  const bookedIds = new Set(visits.filter(v => v.status !== null && [0, 1, 3].includes(v.status)).map(v => v.client_fitbase_id));
  const visitedIds = new Set(visits.filter(v => v.status === 3).map(v => v.client_fitbase_id));
  const trialIds = new Set(visits.filter(v => v.is_trial && v.status === 3).map(v => v.client_fitbase_id));

  return {
    leads:   leads.length,
    in_work: leads.filter(l => l.status != null && l.status !== '0').length,
    booked:  leads.filter(l => l.client_fitbase_id != null && bookedIds.has(l.client_fitbase_id)).length,
    trial:   leads.filter(l => l.client_fitbase_id != null && trialIds.has(l.client_fitbase_id)).length,
    visited: leads.filter(l => l.client_fitbase_id != null && visitedIds.has(l.client_fitbase_id)).length,
    bought:  leads.filter(l => l.status === '-1').length,
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
        .select('fitbase_id,source,stage,status,manager,client_fitbase_id')
        .gte('created_date', fromDate)
        .lte('created_date', toDate);
      if (sources.length === 1) q = q.eq('source', sources[0]);
      else if (sources.length > 1) q = q.in('source', sources);
      if (manager) q = q.ilike('manager', `%${manager}%`);

      const { data: leads, error: leadsErr } = await q;
      if (leadsErr) { res.status(500).json({ error: leadsErr.message }); return; }

      const allLeads = (leads || []) as Lead[];
      const clientIds = [...new Set(allLeads.map(l => l.client_fitbase_id).filter((id): id is number => id != null))];

      let allVisits: Visit[] = [];
      if (clientIds.length > 0) {
        const { data: v } = await supabase
          .from('fitbase_visits')
          .select('client_fitbase_id,status,is_trial')
          .in('client_fitbase_id', clientIds);
        allVisits = (v || []) as Visit[];
      }

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
          ...buildFunnel(sLeads, allVisits.filter(v => sLeads.some(l => l.client_fitbase_id === v.client_fitbase_id))),
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
          ...buildFunnel(mLeads, allVisits.filter(v => mLeads.some(l => l.client_fitbase_id === v.client_fitbase_id))),
        }));

      // Available sources and managers for filter dropdowns
      const { data: srcRows } = await supabase.from('fitbase_leads').select('source').not('source', 'is', null);
      const availableSources = [...new Set((srcRows || []).map(r => r.source as string))].sort();
      const { data: mgrRows } = await supabase.from('fitbase_leads').select('manager').not('manager', 'is', null);
      const availableManagers = [...new Set((mgrRows || []).map(r => r.manager as string))].sort();

      res.json({ period: { from: fromDate, to: toDate }, funnel, by_source, by_manager, availableSources, availableManagers });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Trigger CRM sync (admin only, fires cron endpoint internally)
  router.post('/kviz/api/metrics/sync', async (req: Request, res: Response) => {
    if (!isAdmin(req, res)) return;
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: 'CRON_SECRET не задан' }); return; }
    try {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/run/fitbase-crm-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      const json = await resp.json() as Record<string, unknown>;
      res.json(json);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return router;
}
