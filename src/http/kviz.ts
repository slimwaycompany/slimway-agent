import path from 'path';
import fs from 'fs';
import express, { Router, Application, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { buildMeasureRouter } from './measure';
import { buildManagerRouter } from './manager';
import { buildShiftsRouter } from './shifts';
import { buildCashRouter } from './cash';
import { addLeadNote } from './fitbase';

const CLIENT_DIST = path.resolve(process.cwd(), 'kviz', 'client', 'dist');

function requireKvizAuth(req: Request, res: Response): boolean {
  if (getSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  return null;
}

function buildRouter(): Router {
  const router = Router();

  // Public TV screen and key protected aggregate API. No client identifiers or names leave this route.
  router.get('/api/results/summary', async (req, res) => {
    const expected = process.env.RESULTS_DISPLAY_KEY;
    if (!expected || typeof req.query.key !== 'string' || req.query.key !== expected) { res.status(404).end(); return; }
    try {
      const [{ data: rows, error }, { data: missionRow }] = await Promise.all([
        supabase.from('studio_results').select('cm_lost,kg_lost,fat_kg_lost'),
        supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle(),
      ]);
      if (error) { res.status(500).json({ error: 'Не удалось загрузить результаты' }); return; }
      const totals = (rows || []).reduce((a, row) => ({
        cm_lost: a.cm_lost + Number(row.cm_lost || 0),
        kg_lost: a.kg_lost + Number(row.kg_lost || 0),
        fat_kg_lost: a.fat_kg_lost + Number(row.fat_kg_lost || 0),
      }), { cm_lost: 0, kg_lost: 0, fat_kg_lost: 0 });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...totals, clients: (rows || []).length, mission: String(missionRow?.value || '') });
    } catch (e) { res.status(500).json({ error: 'Не удалось загрузить результаты' }); }
  });

  router.get('/results', (req, res) => {
    const displayKey = process.env.RESULTS_DISPLAY_KEY;
    if (!displayKey || typeof req.query.key !== 'string' || req.query.key !== displayKey) { res.status(404).end(); return; }
    if (!fs.existsSync(CLIENT_DIST)) { res.status(404).end(); return; }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });

  // Staff-only proxy: redirects to /results with key so managers can view without seeing the key in their URL bar
  router.get('/kviz/results-view', (req, res) => {
    if (!getSession(req)) { res.redirect('/login?returnTo=/kviz/results-view'); return; }
    const key = process.env.RESULTS_DISPLAY_KEY;
    if (!key) { res.status(503).send('RESULTS_DISPLAY_KEY не задан'); return; }
    res.redirect(302, `/results?key=${encodeURIComponent(key)}`);
  });

  router.get('/img/logo.png', (_req, res) => {
    const logo = path.resolve(process.cwd(), 'img', 'logo.png');
    if (!fs.existsSync(logo)) { res.status(404).end(); return; }
    res.sendFile(logo);
  });

  // Public: auth status check
  router.get('/kviz/api/me', (req, res) => {
    const session = getSession(req);
    if (!session) { res.json({ authed: false }); return; }
    res.json({ authed: true, login: session.login, display_name: session.display_name, role: session.role });
  });

  // Protect all other /kviz/api/* routes
  router.use('/kviz/api', (req: Request, res: Response, next: NextFunction) => {
    if (!requireKvizAuth(req, res)) return;
    next();
  });

  router.get('/kviz/api/results/mission', async (req, res) => {
    if (getSession(req)?.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    const key = process.env.RESULTS_DISPLAY_KEY;
    res.json({ mission: String(data?.value || ''), display_url: key ? `/results?key=${encodeURIComponent(key)}` : '' });
  });

  router.put('/kviz/api/results/mission', async (req, res) => {
    if (getSession(req)?.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return; }
    const mission = String((req.body as Record<string, unknown>).mission ?? '').trim();
    if (mission.length > 500) { res.status(400).json({ error: 'Текст миссии: не более 500 символов' }); return; }
    const { data, error } = await supabase.from('studio_settings').upsert({ key: 'mission', value: mission }, { onConflict: 'key' }).select('key,value').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  router.post('/kviz/api/sessions', async (req, res) => {
    try {
      const session = getSession(req);
      const consultant = session?.display_name;
      if (!consultant) { res.status(401).json({ error: 'Нет сессии' }); return; }
      const { fitbase_lead_id, client_name, client_phone } = req.body as Record<string, unknown>;
      const insert: Record<string, unknown> = {
        consultant, status: 'draft', current_step: 1, answers: {},
      };
      if (fitbase_lead_id) insert.fitbase_lead_id = fitbase_lead_id;
      if (client_name) {
        const n = String(client_name).trim();
        insert.client_name = n.charAt(0).toUpperCase() + n.slice(1);
      }
      if (client_phone) {
        const norm = normalizePhone(String(client_phone));
        if (norm) insert.client_phone = norm;
      }
      const { data, error } = await supabase.from('qualify_sessions').insert(insert).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/kviz/api/sessions', async (req, res) => {
    try {
      let q = supabase.from('qualify_sessions').select('*').order('created_at', { ascending: false }).limit(200);
      if (req.query.status)      q = q.eq('status', req.query.status as string);
      if (req.query.temperature) q = q.eq('temperature', req.query.temperature as string);
      if (req.query.consultant)  q = q.ilike('consultant', `%${req.query.consultant}%`);
      if (req.query.from)        q = q.gte('created_at', req.query.from as string);
      if (req.query.to)          q = q.lte('created_at', (req.query.to as string) + 'T23:59:59');
      if (req.query.phone)       q = q.eq('client_phone', req.query.phone as string);
      if (req.query.lead_id)     q = q.eq('fitbase_lead_id', req.query.lead_id as string);
      if (req.query.search) {
        const s = req.query.search as string;
        q = (q as any).or(`client_name.ilike.%${s}%,client_phone.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.get('/kviz/api/sessions/:id', async (req, res) => {
    try {
      const { data, error } = await supabase.from('qualify_sessions').select('*').eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.patch('/kviz/api/sessions/:id', async (req, res) => {
    try {
      const { data: curr } = await supabase.from('qualify_sessions').select('status').eq('id', req.params.id).single();
      if (curr?.status === 'done') { res.status(409).json({ error: 'Квалификация закрыта, только просмотр' }); return; }
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const body = req.body as Record<string, unknown>;
      if (body.answers      !== undefined) update.answers      = body.answers;
      if (body.current_step !== undefined) update.current_step = body.current_step;
      if (body.client_name  !== undefined) {
        const name = String(body.client_name).trim();
        if (!name) { res.status(400).json({ error: 'client_name cannot be empty' }); return; }
        update.client_name = name.charAt(0).toUpperCase() + name.slice(1);
      }
      if (body.client_phone !== undefined) {
        const phone = normalizePhone(String(body.client_phone));
        if (!phone) { res.status(400).json({ error: 'Проверьте номер' }); return; }
        update.client_phone = phone;
      }
      const { data, error } = await supabase.from('qualify_sessions').update(update).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/sessions/:id/complete', async (req, res) => {
    try {
      const { data: curr } = await supabase.from('qualify_sessions').select('status').eq('id', req.params.id).single();
      if (curr?.status === 'done') { res.status(409).json({ error: 'Квалификация закрыта, только просмотр' }); return; }
      const { score, temperature, bmi, weeks_left, sessions_possible, recommendation, summary_text } = req.body as Record<string, unknown>;
      const { data, error } = await supabase.from('qualify_sessions')
        .update({ status: 'done', score, temperature, bmi, weeks_left, sessions_possible, recommendation, summary_text,
          completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.delete('/kviz/api/sessions/:id', async (req, res) => {
    try {
      const { error } = await supabase.from('qualify_sessions').delete().eq('id', req.params.id).eq('status', 'draft');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  router.post('/kviz/api/sessions/:id/fitbase', async (req, res) => {
    try {
      const { data: s } = await supabase.from('qualify_sessions').select('fitbase_lead_id, summary_text, answers').eq('id', req.params.id).single();
      if (!s) { res.status(404).json({ error: 'Not found' }); return; }
      if (!s.fitbase_lead_id) { res.status(400).json({ error: 'Нет привязки к заявке Fitbase' }); return; }
      if (!s.summary_text) { res.status(400).json({ error: 'Нет текста квалификации' }); return; }
      await addLeadNote(Number(s.fitbase_lead_id), String(s.summary_text));
      const fitbase_sent_at = new Date().toISOString();
      await supabase.from('qualify_sessions').update({ answers: { ...(s.answers as object || {}), fitbase_sent_at } }).eq('id', req.params.id);
      res.json({ ok: true, fitbase_sent_at });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Error handler for /kviz/api (prevents uncaught errors from propagating)
  router.use('/kviz/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[kviz] API error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });

  // Serve kviz client static files and SPA fallback
  if (fs.existsSync(CLIENT_DIST)) {
    console.log('[kviz] dist found:', CLIENT_DIST);
    router.use('/kviz', (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    });
    router.use('/kviz', express.static(CLIENT_DIST));
    // SPA fallback: redirect direct browser access to shell; serve index for iframes
    router.get(/^\/kviz(?!\/api)/, (req: Request, res: Response) => {
      if (req.headers['sec-fetch-dest'] === 'document') { res.redirect(302, '/'); return; }
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else {
    console.warn('[kviz] dist NOT found:', CLIENT_DIST);
    router.get('/kviz', (_req, res) => res.status(503).send('kviz client not built — run npm run build:kviz'));
  }

  return router;
}

export function mountKvizRoutes(app: Application): void {
  try {
    app.use(buildRouter());
    app.use(buildMeasureRouter());
    app.use(buildManagerRouter());
    app.use(buildShiftsRouter());
    app.use(buildCashRouter());
  } catch (e) {
    console.warn('[kviz] failed to mount routes:', (e as Error).message);
  }
}
