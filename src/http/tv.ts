import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

const BUCKET = 'tv-media';

// Active SSE connections for real-time push
const sseClients = new Set<Response>();

export function tvNotify(): void {
  if (!sseClients.size) return;
  const msg = 'event: update\ndata: {}\n\n';
  for (const c of sseClients) {
    try { c.write(msg); } catch { sseClients.delete(c); }
  }
}

function checkKey(req: Request): boolean {
  const exp = process.env.RESULTS_DISPLAY_KEY;
  return !!exp && req.query.key === exp;
}

function isAdmin(req: Request): boolean {
  return getSession(req)?.role === 'admin';
}

// JPEG: FF D8 FF | PNG: 89 50 4E 47
function validImg(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ||
         (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47);
}

async function proxyMedia(storagePath: string, res: Response): Promise<void> {
  if (!storagePath || !/^[a-zA-Z0-9/_.-]+$/.test(storagePath)) { res.status(400).end(); return; }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) { res.status(404).end(); return; }
    const buf = Buffer.from(await data.arrayBuffer());
    res.setHeader('Content-Type', data.type || (storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch { res.status(500).end(); }
}

export function buildTvRouter(): Router {
  const r = Router();

  // ── Public endpoints (key-protected) ──────────────────────────────────────

  r.get('/api/tv/data', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    try {
      const [{ data: settings }, { data: counters }, { data: results }, { data: mission }] = await Promise.all([
        supabase.from('tv_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('studio_results').select('cm_lost,kg_lost,fat_kg_lost'),
        supabase.from('tv_results').select('*').order('position'),
        supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle(),
      ]);
      const totals = (counters || []).reduce((a: Record<string, number>, row) => ({
        cm_lost: a.cm_lost + Number(row.cm_lost || 0),
        kg_lost: a.kg_lost + Number(row.kg_lost || 0),
        fat_kg_lost: a.fat_kg_lost + Number(row.fat_kg_lost || 0),
      }), { cm_lost: 0, kg_lost: 0, fat_kg_lost: 0 });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        settings: settings ?? {},
        summary: { ...totals, clients: (counters || []).length, mission: String(mission?.value || '') },
        results: results ?? [],
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/api/tv/stream', (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // Public media proxy (key-protected)
  r.get('/api/tv/media', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    await proxyMedia(String(req.query.path || ''), res);
  });

  // Admin media proxy (session auth — for settings preview)
  r.get('/kviz/api/tv/media', async (req, res) => {
    if (!getSession(req)) { res.status(401).end(); return; }
    await proxyMedia(String(req.query.path || ''), res);
  });

  // ── Admin settings ─────────────────────────────────────────────────────────

  r.get('/kviz/api/tv/settings', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_settings').select('*').eq('id', 1).maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? {});
  });

  r.put('/kviz/api/tv/settings', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    const toB = (v: unknown) => v === true || v === 'true' || v === 1;
    const toS = (v: unknown, def: number) => Math.max(5, Math.min(300, Number(v) || def));
    if ('main_enabled'      in b) upd.main_enabled      = toB(b.main_enabled);
    if ('main_seconds'      in b) upd.main_seconds      = toS(b.main_seconds, 15);
    if ('main_label_cm'     in b) upd.main_label_cm     = String(b.main_label_cm  || '').slice(0, 60);
    if ('main_label_kg'     in b) upd.main_label_kg     = String(b.main_label_kg  || '').slice(0, 60);
    if ('main_label_fat'    in b) upd.main_label_fat    = String(b.main_label_fat || '').slice(0, 60);
    if ('results_enabled'   in b) upd.results_enabled   = toB(b.results_enabled);
    if ('results_seconds'   in b) upd.results_seconds   = toS(b.results_seconds, 15);
    if ('results_show_count' in b) upd.results_show_count = Math.max(1, Math.min(12, Number(b.results_show_count) || 3));
    if ('promo_enabled'     in b) upd.promo_enabled     = toB(b.promo_enabled);
    if ('promo_seconds'     in b) upd.promo_seconds     = toS(b.promo_seconds, 15);
    const { data, error } = await supabase.from('tv_settings').upsert(upd, { onConflict: 'id' }).select('*').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/tv/settings/promo-upload', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const sp = `promo/promo.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`, upsert: true });
    if (upErr) { res.status(500).json({ error: upErr.message }); return; }
    const { data, error } = await supabase.from('tv_settings').update({ promo_image_path: sp, updated_at: new Date().toISOString() }).eq('id', 1).select('*').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  // ── Admin tv_results CRUD ──────────────────────────────────────────────────

  r.get('/kviz/api/tv/results', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_results').select('*').order('position');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  });

  r.post('/kviz/api/tv/results', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const title = String(b.title || '').trim();
    if (!title) { res.status(400).json({ error: 'Название обязательно' }); return; }
    const { data: last } = await supabase.from('tv_results').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('tv_results')
      .insert({ title, before_path: '', after_path: '', position: (Number(last?.position ?? 0) + 1) })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.put('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = {};
    if ('title'    in b) upd.title    = String(b.title || '').trim();
    if ('position' in b) upd.position = Number(b.position);
    if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нет данных' }); return; }
    const { data, error } = await supabase.from('tv_results').update(upd).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.delete('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data: row } = await supabase.from('tv_results').select('before_path,after_path').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('tv_results').delete().eq('id', req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const paths = [row?.before_path, row?.after_path].filter(Boolean) as string[];
    if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    res.json({ ok: true });
  });

  r.post('/kviz/api/tv/results/:id/before-upload', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    await uploadResultImg(req, res, 'before');
  });

  r.post('/kviz/api/tv/results/:id/after-upload', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    await uploadResultImg(req, res, 'after');
  });

  return r;
}

async function uploadResultImg(req: Request, res: Response, side: 'before' | 'after'): Promise<void> {
  const b = req.body as Record<string, unknown>;
  if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
  const buf = Buffer.from(b.content_base64, 'base64');
  if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
  const ext = buf[0] === 0x89 ? 'png' : 'jpg';
  const sp = `results/${req.params.id}/${side}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`, upsert: true });
  if (upErr) { res.status(500).json({ error: upErr.message }); return; }
  const { data, error } = await supabase.from('tv_results').update({ [`${side}_path`]: sp }).eq('id', req.params.id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
}
