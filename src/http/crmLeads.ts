import { Router } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { runCrmLeadsSync } from '../jobs/crmLeadsSync';
import { acquireLock, releaseLock } from '../core/lock';
import type { Request, Response } from 'express';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const JOB = 'crm-leads-sync';

function requireAuth(req: Request, res: Response): boolean {
  if (getSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' }); return false;
}
function requireAdmin(req: Request, res: Response): boolean {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (s.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return false; }
  return true;
}

function todayUtc5(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

async function writeActivity(leadId: string, kind: string, text: string, author: string, meta?: Record<string, unknown>) {
  await supabase.from('crm_lead_activity').insert({ branch_id: BRANCH_ID, lead_id: leadId, kind, text, author, meta: meta ?? {} });
}

// In-memory sync status
let syncStatus: { status: string; result?: Record<string, unknown>; error?: string; started_at?: string; finished_at?: string } = { status: 'idle' };

async function runSyncBg(): Promise<void> {
  const locked = await acquireLock(JOB, 5 * 60);
  if (!locked) { syncStatus = { ...syncStatus, status: 'already_running' }; return; }
  syncStatus = { status: 'running', started_at: new Date().toISOString() };
  try {
    const result = await runCrmLeadsSync();
    syncStatus = { status: 'done', result, started_at: syncStatus.started_at, finished_at: new Date().toISOString() };
  } catch (e) {
    syncStatus = { status: 'error', error: String(e), started_at: syncStatus.started_at, finished_at: new Date().toISOString() };
    console.error('[crm-leads-sync] error:', e);
  } finally {
    await releaseLock(JOB);
  }
}

export function buildCrmLeadsRouter(): Router {
  const r = Router();

  // ── Sync ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads-sync', (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(syncStatus);
  });

  r.post('/kviz/api/crm/leads-sync', (req, res) => {
    if (!requireAuth(req, res)) return;
    runSyncBg().catch(console.error);
    res.json({ ok: true, status: syncStatus.status });
  });

  // ── Funnels ───────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/funnels', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data: funnels, error } = await supabase.from('crm_funnels')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }

      const { data: stages } = await supabase.from('crm_funnel_stages')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');

      const stagesByFunnel = new Map<string, unknown[]>();
      for (const s of stages || []) {
        const fid = (s as Record<string, unknown>).funnel_id as string | null;
        if (fid) {
          if (!stagesByFunnel.has(fid)) stagesByFunnel.set(fid, []);
          stagesByFunnel.get(fid)!.push(s);
        }
      }

      res.json((funnels || []).map(f => ({
        ...f,
        stages: stagesByFunnel.get((f as Record<string, unknown>).id as string) ?? [],
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/funnels', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название воронки' }); return; }
      const { data, error } = await supabase.from('crm_funnels').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), sort: Number(b.sort ?? 0), is_active: true,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/funnels/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_funnels')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Funnel stages PATCH/POST/DELETE (admin)
  r.post('/kviz/api/crm/funnel-stages', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name || !b.funnel_id) { res.status(400).json({ error: 'Укажите название и воронку' }); return; }
      const { data, error } = await supabase.from('crm_funnel_stages').insert({
        branch_id: BRANCH_ID, funnel_id: b.funnel_id, name: String(b.name).trim(),
        kind: 'normal', sort: Number(b.sort ?? 0), is_archived: false, is_personal: false,
        color: (b.color as string | null) ?? null, background_color: (b.background_color as string | null) ?? null,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/funnel-stages/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name             !== undefined) upd.name             = String(b.name).trim();
      if (b.sort             !== undefined) upd.sort             = Number(b.sort);
      if (b.is_archived      !== undefined) upd.is_archived      = Boolean(b.is_archived);
      if (b.color            !== undefined) upd.color            = b.color ?? null;
      if (b.background_color !== undefined) upd.background_color = b.background_color ?? null;
      const { data, error } = await supabase.from('crm_funnel_stages')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/funnel-stages/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { count } = await supabase.from('crm_leads')
        .select('id', { count: 'exact', head: true }).eq('stage_id', req.params.id);
      if (count && count > 0) {
        res.status(409).json({ error: `Этап используется в ${count} заявках — сначала переместите их` }); return;
      }
      const { error } = await supabase.from('crm_funnel_stages')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Leads ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_leads').select('*').eq('branch_id', BRANCH_ID);
      if (req.query.funnel_id) q = q.eq('funnel_id', req.query.funnel_id as string);
      if (req.query.stage_id)  q = q.eq('stage_id',  req.query.stage_id  as string);
      if (!req.query.is_archived || req.query.is_archived === '0') q = q.eq('is_archived', false);
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        q = q.or(`name.ilike.${s},surname.ilike.${s},phone.ilike.${s},title.ilike.${s}`);
      }
      const { data: leads, error } = await q.order('fb_created_at', { ascending: false }).limit(1000);
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Compute is_overdue from tasks
      const ids = (leads || []).map(l => (l as Record<string, unknown>).id as string);
      let overdueSet = new Set<string>();
      if (ids.length) {
        const { data: td } = await supabase.from('crm_lead_tasks')
          .select('lead_id').in('lead_id', ids).eq('status', 'open').eq('is_overdue', true);
        overdueSet = new Set((td || []).map(t => (t as Record<string, unknown>).lead_id as string));
      }

      res.json((leads || []).map(l => ({ ...l, is_overdue: overdueSet.has((l as Record<string, unknown>).id as string) })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/leads', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.funnel_id) { res.status(400).json({ error: 'Укажите воронку' }); return; }
      const phone = b.phone ? (() => { let d = String(b.phone).replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 11 && d[0] === '7') return d; if (d.length === 10) return '7' + d; return null; })() : null;
      const { data, error } = await supabase.from('crm_leads').insert({
        branch_id: BRANCH_ID, origin: 'manual',
        title:       (b.title      as string | null) ?? null,
        name:        (b.name       as string | null) ?? null,
        surname:     (b.surname    as string | null) ?? null,
        phone,
        description: (b.description as string | null) ?? null,
        budget:      b.budget != null ? String(b.budget) : null,
        funnel_id:   b.funnel_id,
        stage_id:    (b.stage_id as string | null) ?? null,
        ad_source_id: (b.ad_source_id as string | null) ?? null,
        tags: Array.isArray(b.tags) ? b.tags : [],
        fb_created_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeActivity((data as Record<string, unknown>).id as string, 'created', 'Заявка создана', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_leads')
        .select('*').eq('id', req.params.id).eq('branch_id', BRANCH_ID).single();
      if (error || !data) { res.status(404).json({ error: 'Не найдено' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const stringFields = ['title', 'name', 'surname', 'patronymic', 'email', 'instagram', 'telegram', 'description', 'budget', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_term', 'utm_content', 'lost_comment'];
      for (const f of stringFields) if (b[f] !== undefined) upd[f] = b[f] ?? null;
      if (b.phone       !== undefined) {
        const p = b.phone as string | null;
        if (p) { let d = p.replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); upd.phone = d.length === 11 && d[0] === '7' ? d : d.length === 10 ? '7' + d : null; }
        else upd.phone = null;
      }
      if (b.funnel_id       !== undefined) upd.funnel_id       = b.funnel_id ?? null;
      if (b.stage_id        !== undefined) upd.stage_id        = b.stage_id  ?? null;
      if (b.stage_id        !== undefined) upd.stage_changed_at = new Date().toISOString();
      if (b.ad_source_id    !== undefined) upd.ad_source_id    = b.ad_source_id ?? null;
      if (b.manager_user_id !== undefined) upd.manager_user_id = b.manager_user_id ?? null;
      if (b.client_id       !== undefined) upd.client_id       = b.client_id ?? null;
      if (b.lost_reason_id  !== undefined) upd.lost_reason_id  = b.lost_reason_id ?? null;
      if (b.is_archived     !== undefined) upd.is_archived     = Boolean(b.is_archived);
      if (b.is_archived === true)          upd.archived_at     = new Date().toISOString();
      if (b.tags            !== undefined) upd.tags            = Array.isArray(b.tags) ? b.tags : [];
      if (b.is_duplicate    !== undefined) upd.is_duplicate    = Boolean(b.is_duplicate);

      const { data, error } = await supabase.from('crm_leads')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Record stage change in activity
      if (b.stage_id !== undefined) {
        const { data: stage } = await supabase.from('crm_funnel_stages').select('name').eq('id', b.stage_id as string).single();
        await writeActivity(req.params.id, 'stage_change', `Этап → ${stage?.name ?? 'Unknown'}`, session.display_name);
      }

      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_leads')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead activity ─────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads/:id/activity', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_activity')
        .select('*').eq('branch_id', BRANCH_ID).eq('lead_id', req.params.id)
        .order('created_at', { ascending: false }).limit(100);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/leads/:id/activity', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.text) { res.status(400).json({ error: 'Укажите текст' }); return; }
      const { data, error } = await supabase.from('crm_lead_activity').insert({
        branch_id: BRANCH_ID, lead_id: req.params.id,
        kind: 'comment', text: String(b.text), author: session.display_name, meta: {},
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead tasks ────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lead-tasks', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_lead_tasks').select(`
        *,
        crm_leads(id, title, name, surname, funnel_id, stage_id,
          crm_funnels(name),
          crm_funnel_stages(name)
        ),
        crm_task_types(id, name)
      `).eq('branch_id', BRANCH_ID);

      if (req.query.lead_id) q = q.eq('lead_id', req.query.lead_id as string);
      if (req.query.status)  q = q.eq('status', req.query.status as string);
      if (req.query.today === '1' || req.query.today === 'true') {
        const today = todayUtc5();
        q = q.lte('due_at', today + 'T23:59:59Z').eq('status', 'open');
      }
      const { data, error } = await q.order('due_at').limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lead-tasks', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.lead_id && !b.client_id) { res.status(400).json({ error: 'Нужен lead_id или client_id' }); return; }
      if (!b.description) { res.status(400).json({ error: 'Укажите описание задачи' }); return; }
      const { data, error } = await supabase.from('crm_lead_tasks').insert({
        branch_id:  BRANCH_ID,
        lead_id:    (b.lead_id    as string | null) ?? null,
        client_id:  (b.client_id  as string | null) ?? null,
        type_id:    (b.type_id    as string | null) ?? null,
        description: String(b.description),
        due_at:      (b.due_at    as string | null) ?? null,
        is_allday:   Boolean(b.is_allday),
        status:      'open',
        created_by:  session.display_name,
        responsible_user_id: (b.responsible_user_id as string | null) ?? null,
        fitbase_responsible: [],
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      if (b.lead_id) await writeActivity(b.lead_id as string, 'task', `Задача: ${b.description}`, session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lead-tasks/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.description !== undefined) upd.description = String(b.description);
      if (b.result      !== undefined) upd.result      = b.result ?? null;
      if (b.due_at      !== undefined) upd.due_at      = b.due_at ?? null;
      if (b.is_allday   !== undefined) upd.is_allday   = Boolean(b.is_allday);
      if (b.type_id     !== undefined) upd.type_id     = b.type_id ?? null;
      if (b.responsible_user_id !== undefined) upd.responsible_user_id = b.responsible_user_id ?? null;
      if (b.status !== undefined) {
        upd.status = b.status;
        if (b.status === 'done') { upd.closed_at = new Date().toISOString(); upd.closed_by = session.display_name; }
      }
      const { data, error } = await supabase.from('crm_lead_tasks')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lead-tasks/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { error } = await supabase.from('crm_lead_tasks')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead tags ─────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lead-tags', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_tags')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lead-tags', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название тега' }); return; }
      const { data, error } = await supabase.from('crm_lead_tags').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(),
        color: (b.color as string | null) ?? null, is_system: false, is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lead-tags/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.color     !== undefined) upd.color     = b.color ?? null;
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_lead_tags')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lead-tags/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: tag } = await supabase.from('crm_lead_tags').select('is_system,name').eq('id', req.params.id).single();
      if (tag?.is_system) { res.status(409).json({ error: `Системный тег «${tag.name}» нельзя удалять` }); return; }
      const { error } = await supabase.from('crm_lead_tags').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Task types ────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/task-types', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_task_types')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/task-types', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название' }); return; }
      const { data, error } = await supabase.from('crm_task_types').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/task-types/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_task_types')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/task-types/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { count } = await supabase.from('crm_lead_tasks')
        .select('id', { count: 'exact', head: true }).eq('type_id', req.params.id);
      if (count && count > 0) { res.status(409).json({ error: `Тип используется в ${count} задачах` }); return; }
      const { error } = await supabase.from('crm_task_types').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lost reasons ──────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lost-reasons', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_lost_reasons')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lost-reasons', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите причину' }); return; }
      const { data, error } = await supabase.from('crm_lead_lost_reasons').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lost-reasons/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_lead_lost_reasons')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lost-reasons/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_lead_lost_reasons')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Fitbase user map ──────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/fitbase-users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data } = await supabase.from('crm_leads')
        .select('fitbase_manager_name,fitbase_manager_id')
        .eq('branch_id', BRANCH_ID)
        .not('fitbase_manager_name', 'is', null);
      const seen = new Map<string, number>();
      for (const row of data || []) {
        const name = (row as Record<string, unknown>).fitbase_manager_name as string;
        const fbId = (row as Record<string, unknown>).fitbase_manager_id as number | null;
        if (name && !seen.has(name)) seen.set(name, fbId ?? 0);
      }
      res.json([...seen.entries()].map(([name, id]) => ({ fitbase_full_name: name, fitbase_user_id: id })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/fitbase-user-map', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_fitbase_user_map').select(`
        *,
        app_users(id, display_name)
      `);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/fitbase-user-map', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.fitbase_full_name || !b.app_user_id) { res.status(400).json({ error: 'Укажите имя Fitbase и пользователя' }); return; }
      const { data, error } = await supabase.from('crm_fitbase_user_map').insert({
        fitbase_full_name: String(b.fitbase_full_name).trim(),
        fitbase_user_id:   b.fitbase_user_id != null ? Number(b.fitbase_user_id) : null,
        app_user_id:       b.app_user_id,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/fitbase-user-map/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.app_user_id !== undefined) upd.app_user_id = b.app_user_id ?? null;
      if (b.fitbase_full_name !== undefined) upd.fitbase_full_name = b.fitbase_full_name ?? null;
      const { data, error } = await supabase.from('crm_fitbase_user_map')
        .update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/fitbase-user-map/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_fitbase_user_map').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── App users ─────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/app-users', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('app_users')
        .select('id,display_name,role').order('display_name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
