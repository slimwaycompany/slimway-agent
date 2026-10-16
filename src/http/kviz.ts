import path from 'path';
import fs from 'fs';
import express, { Router, Application, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getToken, verifyToken } from './auth';

const CLIENT_DIST = path.resolve(process.cwd(), 'kviz', 'client', 'dist');

function requireKvizAuth(req: Request, res: Response): boolean {
  const token = getToken(req);
  if (token && verifyToken(token)) return true;
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

  // Public: auth status check
  router.get('/kviz/api/me', (req, res) => {
    const token = getToken(req);
    res.json({ authed: !!(token && verifyToken(token)) });
  });

  // Protect all other /kviz/api/* routes
  router.use('/kviz/api', (req: Request, res: Response, next: NextFunction) => {
    if (!requireKvizAuth(req, res)) return;
    next();
  });

  router.post('/kviz/api/sessions', async (req, res) => {
    try {
      const { consultant, fitbase_lead_id, client_name, client_phone } = req.body as Record<string, unknown>;
      if (!consultant || typeof consultant !== 'string') {
        res.status(400).json({ error: 'consultant is required' }); return;
      }
      const insert: Record<string, unknown> = {
        consultant: consultant.trim(), status: 'draft', current_step: 1, answers: {},
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
  } catch (e) {
    console.warn('[kviz] failed to mount routes:', (e as Error).message);
  }
}
