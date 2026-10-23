import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { acquireLock, releaseLock } from '../core/lock';
import { runFitbaseCrmSync } from '../jobs/fitbaseCrmSync';

interface Lead { fitbase_id: string; source: string | null; stage: string | null; status: string | null; manager: string | null; client_fitbase_id: number | null; client_phone: string | null }
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
