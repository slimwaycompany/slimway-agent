import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

const BUCKET = 'tv-media';
const sseClients = new Set<Response>();

export function tvNotify(): void {
  if (!sseClients.size) return;
  const msg = 'event: changed\ndata: {}\n\n';
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

const VALID_FONTS = new Set(['Manrope', 'Montserrat', 'Oswald', 'Barlow Condensed', 'Playfair Display', 'Russo One', 'Unbounded']);
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateLayout(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'layout должен быть объектом';
  const l = raw as Record<string, unknown>;
  if (typeof l.frame !== 'boolean') return 'layout.frame должен быть true или false';
  if (!Array.isArray(l.elements)) return 'layout.elements должен быть массивом';
  if ((l.elements as unknown[]).length > 12) return 'Максимум 12 элементов в слайде';
  const ids = new Set<string>();
  for (const item of l.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'Элемент не является объектом';
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'id элемента должен быть UUID';
    if (ids.has(e.id)) return `Дублирующийся id: ${e.id}`;
    ids.add(e.id);
    if (e.type !== 'text' && e.type !== 'image') return 'type элемента: text или image';
    for (const [k, min, max] of [['x', 0, 100], ['y', 0, 100], ['w', 1, 100], ['h', 1, 100]] as const) {
      const v = e[k];
      if (typeof v !== 'number' || v < min || v > max) return `${k}: число ${min}–${max}`;
    }
    if (typeof e.z !== 'number' || !Number.isInteger(e.z) || e.z < 0 || e.z > 50) return 'z: целое 0–50';
    if (e.type === 'text') {
      if (typeof e.text !== 'string' || e.text.length > 500) return 'text: строка до 500 символов';
      if (!VALID_FONTS.has(e.font as string)) return `Неверный шрифт: ${e.font}. Допустимые: ${[...VALID_FONTS].join(', ')}`;
      if (typeof e.size !== 'number' || e.size < 1 || e.size > 60) return 'size: число 1–60';
      if (e.weight !== 400 && e.weight !== 600 && e.weight !== 800) return 'weight: 400, 600 или 800';
      if (typeof e.color !== 'string' || !HEX_RE.test(e.color)) return 'color: формат #RRGGBB';
      if (e.align !== 'left' && e.align !== 'center' && e.align !== 'right') return 'align: left, center или right';
      if (typeof e.scaleX !== 'number' || e.scaleX < 0.5 || e.scaleX > 2) return 'scaleX: 0.5–2';
      if (typeof e.scaleY !== 'number' || e.scaleY < 0.5 || e.scaleY > 2) return 'scaleY: 0.5–2';
    }
    if (e.type === 'image') {
      if (typeof e.path !== 'string' || !/^free\/[0-9a-f-]+\.(jpg|png)$/.test(e.path)) return 'path: free/<uuid>.jpg или free/<uuid>.png';
      if (e.fit !== 'cover' && e.fit !== 'contain' && e.fit !== 'stretch') return 'fit: cover, contain или stretch';
    }
  }
  return null;
}

// ── Screen layout (синхронизировать с kviz/client/src/lib/tvScreenLayout.ts) ──

const VALID_SCREEN_KINDS = new Set([
  'logo', 'panel', 'carousel', 'intro', 'mission', 'datetime',
  'counter_cm', 'counter_kg', 'counter_fat',
]);
const TEXT_SCREEN_KINDS   = new Set(['intro', 'mission', 'datetime']);
const COUNTER_SCREEN_KINDS = new Set(['counter_cm', 'counter_kg', 'counter_fat']);

function validateScreenLayout(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'screen_layout должен быть объектом';
  const l = raw as Record<string, unknown>;
  if (l.version !== 1) return 'version должна быть 1';
  if (!Array.isArray(l.elements)) return 'elements должен быть массивом';
  const kinds = new Set<string>();
  for (const item of l.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'элемент не объект';
    const e = item as Record<string, unknown>;
    const kind = String(e.kind);
    if (!VALID_SCREEN_KINDS.has(kind)) return `Неверный kind: ${kind}`;
    if (kinds.has(kind)) return `Дублирующийся kind: ${kind}`;
    kinds.add(kind);
    for (const [k, min, max] of [['x', 0, 100], ['y', 0, 100], ['w', 1, 100], ['h', 1, 100]] as const) {
      const v = e[k];
      if (typeof v !== 'number' || v < min || v > max) return `${kind}.${k}: число ${min}–${max}`;
    }
    if ('z' in e && (typeof e.z !== 'number' || !Number.isInteger(e.z) || (e.z as number) < 0 || (e.z as number) > 50))
      return `${kind}.z: целое 0–50`;
    if (TEXT_SCREEN_KINDS.has(kind) || COUNTER_SCREEN_KINDS.has(kind)) {
      if ('font' in e && e.font !== undefined && !VALID_FONTS.has(e.font as string))
        return `${kind}.font: неверный шрифт`;
      if ('size' in e && e.size !== undefined && (typeof e.size !== 'number' || (e.size as number) < 0.3 || (e.size as number) > 20))
        return `${kind}.size: 0.3–20`;
      if ('weight' in e && e.weight !== undefined && e.weight !== 400 && e.weight !== 600 && e.weight !== 800)
        return `${kind}.weight: 400, 600 или 800`;
      if ('color' in e && e.color !== undefined && (typeof e.color !== 'string' || !HEX_RE.test(e.color as string)))
        return `${kind}.color: формат #RRGGBB`;
      if ('align' in e && e.align !== undefined && e.align !== 'left' && e.align !== 'center' && e.align !== 'right')
        return `${kind}.align: left, center или right`;
    }
    if (TEXT_SCREEN_KINDS.has(kind) && 'text' in e && e.text !== undefined) {
      if (typeof e.text !== 'string' || (e.text as string).length > 300) return `${kind}.text: строка до 300 символов`;
    }
    if (COUNTER_SCREEN_KINDS.has(kind)) {
      if ('label' in e && e.label !== undefined && (typeof e.label !== 'string' || (e.label as string).length > 100))
        return `${kind}.label: строка до 100 символов`;
      if ('unit' in e && e.unit !== undefined && (typeof e.unit !== 'string' || (e.unit as string).length > 20))
        return `${kind}.unit: строка до 20 символов`;
    }
  }
  return null;
}

type ScreenElServer = Record<string, unknown>;
interface ScreenLayoutServer { version: 1; elements: ScreenElServer[] }

// синхронизировать с kviz/client/src/lib/tvScreenLayout.ts (defaultScreenLayout)
function defaultScreenLayoutServer(): ScreenLayoutServer {
  return {
    version: 1,
    elements: [
      { kind: 'logo',        x: 36, y: 1,  w: 28, h: 9,  z: 2 },
      { kind: 'panel',       x: 2,  y: 11, w: 27, h: 80, z: 0 },
      { kind: 'intro',       x: 3,  y: 12, w: 25, h: 7,  z: 1,
        text: 'На сегодня мы', font: 'Manrope', size: 1.1, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'counter_cm',  x: 3,  y: 20, w: 25, h: 23, z: 1,
        label: 'Сантиметров убрали',    unit: 'см' },
      { kind: 'counter_kg',  x: 3,  y: 44, w: 25, h: 23, z: 1,
        label: 'Килограммов сбросили',  unit: 'кг' },
      { kind: 'counter_fat', x: 3,  y: 68, w: 25, h: 22, z: 1,
        label: 'Жира сожгли',           unit: 'кг' },
      { kind: 'carousel',    x: 30, y: 11, w: 69, h: 80, z: 0 },
      { kind: 'mission',     x: 20, y: 92, w: 60, h: 5,  z: 2,
        text: 'Вместе к лучшей версии себя', font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'datetime',    x: 81, y: 92, w: 18, h: 5,  z: 2,
        font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' },
    ],
  };
}

// JPEG: FF D8 FF | PNG: 89 50 4E 47
function validImg(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ||
         (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47);
}

// cacheImmutable=true for public (UUID filenames never reuse a URL)
// cacheImmutable=false for admin preview (must always show latest)
async function proxyMedia(storagePath: string, res: Response, cacheImmutable = false): Promise<void> {
  if (!storagePath || !/^[a-zA-Z0-9/_.-]+$/.test(storagePath)) { res.status(400).end(); return; }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) { res.status(404).end(); return; }
    const buf = Buffer.from(await data.arrayBuffer());
    res.setHeader('Content-Type', data.type || (storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'));
    res.setHeader('Cache-Control', cacheImmutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.send(buf);
  } catch { res.status(500).end(); }
}

// Fetch tv_results rows for a list of UUIDs, returns a Map<id, row>
async function fetchResultsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('tv_results').select('id,title,before_path,after_path').in('id', ids);
  const map = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? [])) map.set(r.id as string, r as Record<string, unknown>);
  return map;
}

export function buildTvRouter(): Router {
  const r = Router();

  // ── Public endpoints (key-protected) ──────────────────────────────────────

  r.get('/api/tv/data', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    try {
      const [settingsRes, countersRes, slidesRes, missionRes] = await Promise.all([
        supabase.from('tv_settings').select('screen_layout,main_label_cm,main_label_kg,main_label_fat,intro_text').eq('id', 1).maybeSingle(),
        supabase.from('studio_results').select('cm_lost,kg_lost,fat_kg_lost'),
        supabase.from('tv_slides').select('*').order('position'),
        supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle(),
      ]);
      const totals = ((countersRes.data ?? []) as Record<string, unknown>[]).reduce((a: Record<string, number>, row) => ({
        cm_lost:     a.cm_lost     + Number(row.cm_lost     || 0),
        kg_lost:     a.kg_lost     + Number(row.kg_lost     || 0),
        fat_kg_lost: a.fat_kg_lost + Number(row.fat_kg_lost || 0),
      }), { cm_lost: 0, kg_lost: 0, fat_kg_lost: 0 });

      // Resolve screen_layout: use saved or generate default seeded with current values
      const settings = settingsRes.data as Record<string, unknown> | null;
      let screenLayout = (settings?.screen_layout ?? null) as ScreenLayoutServer | null;
      if (!screenLayout) {
        screenLayout = defaultScreenLayoutServer();
        const mission = String(missionRes.data?.value || '');
        const intro   = String(settings?.intro_text || '');
        const lCm  = String(settings?.main_label_cm  || 'Сантиметров убрали');
        const lKg  = String(settings?.main_label_kg  || 'Килограммов сбросили');
        const lFat = String(settings?.main_label_fat || 'Жира сожгли');
        for (const el of screenLayout.elements) {
          if (el.kind === 'mission'     && mission) el.text  = mission;
          if (el.kind === 'intro'       && intro)   el.text  = intro;
          if (el.kind === 'counter_cm')             el.label = lCm;
          if (el.kind === 'counter_kg')             el.label = lKg;
          if (el.kind === 'counter_fat')            el.label = lFat;
        }
      }

      const slides = (slidesRes.data ?? []) as Record<string, unknown>[];
      const resultIds = [...new Set(
        slides.flatMap(s => [s.result_a, s.result_b].filter(Boolean) as string[])
      )];
      const resultsMap = await fetchResultsByIds(resultIds);

      const enriched = slides.map(s => ({
        ...s,
        result_a: s.result_a ? (resultsMap.get(s.result_a as string) ?? null) : null,
        result_b: s.result_b ? (resultsMap.get(s.result_b as string) ?? null) : null,
      }));

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        screen_layout: screenLayout,
        counters: totals,
        slides: enriched,
        serverTime: new Date().toISOString(),
        version: '3',
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

  // Public media proxy: immutable cache — URL always changes on upload
  r.get('/api/tv/media', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    await proxyMedia(String(req.query.path || ''), res, true);
  });

  // Admin media proxy: no-cache — always show latest for settings preview
  r.get('/kviz/api/tv/media', async (req, res) => {
    if (!getSession(req)) { res.status(401).end(); return; }
    await proxyMedia(String(req.query.path || ''), res, false);
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
    // main_label_* и intro_text перенесены в screen_layout (screen editor)
    if ('main_enabled'   in b) upd.main_enabled  = b.main_enabled === true || b.main_enabled === 'true';
    if ('main_seconds'   in b) upd.main_seconds  = Math.max(1, Math.min(300, Number(b.main_seconds) || 5));
    if ('results_enabled' in b) upd.results_enabled = b.results_enabled === true || b.results_enabled === 'true';
    if ('results_seconds' in b) upd.results_seconds = Math.max(1, Math.min(300, Number(b.results_seconds) || 5));
    if (!Object.keys(upd).some(k => !['id', 'updated_at'].includes(k))) {
      res.status(400).json({ error: 'Нет допустимых полей для обновления. Текст экрана редактируется в редакторе экрана.' }); return;
    }
    const { data, error } = await supabase.from('tv_settings').upsert(upd, { onConflict: 'id' }).select('*').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    tvNotify();
    res.json(data);
  });

  // ── Screen layout ──────────────────────────────────────────────────────────

  r.get('/kviz/api/tv/screen', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data } = await supabase.from('tv_settings').select('screen_layout,main_label_cm,main_label_kg,main_label_fat,intro_text').eq('id', 1).maybeSingle();
    const settings = data as Record<string, unknown> | null;
    let layout = (settings?.screen_layout ?? null) as ScreenLayoutServer | null;
    if (!layout) {
      layout = defaultScreenLayoutServer();
      const lCm  = String(settings?.main_label_cm  || 'Сантиметров убрали');
      const lKg  = String(settings?.main_label_kg  || 'Килограммов сбросили');
      const lFat = String(settings?.main_label_fat || 'Жира сожгли');
      const intro = String(settings?.intro_text || '');
      for (const el of layout.elements) {
        if (el.kind === 'intro'       && intro)  el.text  = intro;
        if (el.kind === 'counter_cm')            el.label = lCm;
        if (el.kind === 'counter_kg')            el.label = lKg;
        if (el.kind === 'counter_fat')           el.label = lFat;
      }
      // mission from studio_settings
      const { data: missionRow } = await supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle();
      const mission = String((missionRow as Record<string, unknown> | null)?.value || '');
      for (const el of layout.elements) {
        if (el.kind === 'mission' && mission) el.text = mission;
      }
    }
    res.json(layout);
  });

  r.put('/kviz/api/tv/screen', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const err = validateScreenLayout(req.body);
    if (err) { res.status(400).json({ error: err }); return; }
    const { data, error } = await supabase.from('tv_settings')
      .upsert({ id: 1, screen_layout: req.body, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('screen_layout').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    tvNotify();
    res.json((data as Record<string, unknown>).screen_layout);
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
      .insert({ title, before_path: '', after_path: '', position: (Number((last as Record<string, number>)?.position ?? 0) + 1) })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.put('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = {};
    if ('title' in b) upd.title = String(b.title || '').trim();
    if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нет данных' }); return; }
    const { data, error } = await supabase.from('tv_results').update(upd).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.delete('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    // Check usage in slides before deleting
    const { data: usedSlide } = await supabase.from('tv_slides')
      .select('position')
      .or(`result_a.eq.${req.params.id},result_b.eq.${req.params.id}`)
      .order('position').limit(1).maybeSingle();
    if (usedSlide) {
      res.status(409).json({ error: `Карточка используется в слайде №${(usedSlide as Record<string, number>).position}. Сначала удалите или измените слайд` });
      return;
    }
    const { data: row } = await supabase.from('tv_results').select('before_path,after_path').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('tv_results').delete().eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') {
        res.status(409).json({ error: 'Карточка используется в слайде. Сначала удалите или измените слайд' });
      } else {
        console.error('tv results delete:', error);
        res.status(500).json({ error: 'Ошибка удаления' });
      }
      return;
    }
    const paths = [(row as Record<string, string>)?.before_path, (row as Record<string, string>)?.after_path].filter(Boolean) as string[];
    if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(e => console.error('tv result delete paths:', e));
    tvNotify();
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

  // ── Admin tv_slides CRUD ───────────────────────────────────────────────────

  r.get('/kviz/api/tv/slides', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_slides').select('*').order('position');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  });

  r.post('/kviz/api/tv/slides', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const kind = String(b.kind || '');
    if (!['result1', 'result2', 'promo', 'usp', 'free'].includes(kind)) {
      res.status(400).json({ error: 'Неверный тип слайда' }); return;
    }

    const { count } = await supabase.from('tv_slides').select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= 20) { res.status(400).json({ error: 'Можно добавить не больше 20 слайдов' }); return; }

    if (kind === 'free') {
      const layout = b.layout ?? { frame: true, elements: [] };
      if (b.layout) {
        const validErr = validateLayout(layout);
        if (validErr) { res.status(400).json({ error: validErr }); return; }
      }
      const dur = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
      const { data: last } = await supabase.from('tv_slides').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
      const position = (Number((last as Record<string, number>)?.position ?? 0) + 1);
      const { data, error } = await supabase.from('tv_slides').insert({
        kind: 'free', position, duration_sec: dur, enabled: b.enabled !== false,
        result_a: null, result_b: null, image_path: null, layout,
      }).select().single();
      if (error) { console.error('tv free slide insert:', error); res.status(500).json({ error: 'Ошибка создания слайда' }); return; }
      tvNotify();
      res.json(data);
      return;
    }

    const result_a = b.result_a ? String(b.result_a) : null;
    const result_b = b.result_b ? String(b.result_b) : null;
    if (kind === 'result1' && !result_a) { res.status(400).json({ error: 'Выберите карточку клиента' }); return; }
    if (kind === 'result2') {
      if (!result_a || !result_b) { res.status(400).json({ error: 'Выберите двух клиентов' }); return; }
      if (result_a === result_b) { res.status(400).json({ error: 'Выберите двух разных клиентов' }); return; }
    }

    let image_path: string | null = null;
    if (kind === 'promo' || kind === 'usp') {
      if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'Загрузите изображение' }); return; }
      const buf = Buffer.from(b.content_base64, 'base64');
      if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
      if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
      const ext = buf[0] === 0x89 ? 'png' : 'jpg';
      const sp = `slides/${randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
      if (upErr) { console.error('tv slide upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
      image_path = sp;
    }

    const dur = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
    const { data: last } = await supabase.from('tv_slides').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    const position = (Number((last as Record<string, number>)?.position ?? 0) + 1);

    const { data, error } = await supabase.from('tv_slides').insert({
      kind, position, duration_sec: dur,
      enabled: b.enabled !== false,
      result_a: (kind === 'result1' || kind === 'result2') ? result_a : null,
      result_b: kind === 'result2' ? result_b : null,
      image_path,
    }).select().single();
    if (error) { console.error('tv slide insert:', error); res.status(500).json({ error: 'Ошибка создания слайда' }); return; }
    tvNotify();
    res.json(data);
  });

  r.post('/kviz/api/tv/slides/:id/free-image', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const sp = `free/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (upErr) { console.error('tv free img upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
    res.json({ path: sp });
  });

  r.patch('/kviz/api/tv/slides/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = {};

    // Free slide layout update
    if ('layout' in b) {
      const { data: curRow } = await supabase.from('tv_slides').select('kind,layout').eq('id', req.params.id).maybeSingle();
      if ((curRow as Record<string, unknown> | null)?.kind !== 'free') {
        res.status(400).json({ error: 'layout можно изменить только у слайда типа free' }); return;
      }
      const validErr = validateLayout(b.layout);
      if (validErr) { res.status(400).json({ error: validErr }); return; }
      type LayoutEl = { type: string; path?: string };
      type LayoutObj = { elements?: LayoutEl[] };
      const oldLayout = (curRow as Record<string, unknown> | null)?.layout as LayoutObj | null;
      const oldPaths = new Set((oldLayout?.elements ?? []).filter(e => e.type === 'image' && e.path).map(e => e.path as string));
      const newPaths = new Set(((b.layout as LayoutObj).elements ?? []).filter(e => e.type === 'image' && e.path).map(e => (e as LayoutEl).path as string));
      const toRemove = [...oldPaths].filter(p => !newPaths.has(p));
      const { data, error } = await supabase.from('tv_slides').update({ layout: b.layout }).eq('id', req.params.id).select().single();
      if (error) { console.error('tv free layout update:', error); res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      if (toRemove.length) supabase.storage.from(BUCKET).remove(toRemove).catch(e => console.error('tv free slide remove old imgs:', e));
      tvNotify();
      res.json(data);
      return;
    }

    if ('duration_sec' in b) upd.duration_sec = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
    if ('enabled'      in b) upd.enabled      = b.enabled === true || b.enabled === 'true';
    if ('result_a'     in b) upd.result_a     = b.result_a || null;
    if ('result_b'     in b) upd.result_b     = b.result_b || null;

    // Position swap: exchange with the slide currently at the target position
    if ('position' in b) {
      const newPos = Number(b.position);
      const [curRes, targetRes] = await Promise.all([
        supabase.from('tv_slides').select('position').eq('id', req.params.id).maybeSingle(),
        supabase.from('tv_slides').select('id,position').eq('position', newPos).maybeSingle(),
      ]);
      const curPos = (curRes.data as Record<string, number> | null)?.position;
      const target = targetRes.data as Record<string, unknown> | null;
      if (curPos != null && target && target.id !== req.params.id) {
        // Use high temp position to avoid unique-constraint conflict during swap
        await supabase.from('tv_slides').update({ position: 9999 }).eq('id', req.params.id);
        await supabase.from('tv_slides').update({ position: curPos }).eq('id', target.id as string);
        await supabase.from('tv_slides').update({ position: newPos }).eq('id', req.params.id);
      }
      tvNotify();
      const { data: updated } = await supabase.from('tv_slides').select('*').eq('id', req.params.id).single();
      res.json(updated ?? {});
      return;
    }

    if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нет данных' }); return; }
    const { data, error } = await supabase.from('tv_slides').update(upd).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    tvNotify();
    res.json(data);
  });

  r.post('/kviz/api/tv/slides/:id/image', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const { data: oldRow } = await supabase.from('tv_slides').select('image_path').eq('id', req.params.id).maybeSingle();
    const sp = `slides/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (upErr) { console.error('tv slide img upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
    const { data, error } = await supabase.from('tv_slides').update({ image_path: sp }).eq('id', req.params.id).select().single();
    if (error) { console.error('tv slide img update:', error); res.status(500).json({ error: 'Ошибка обновления слайда' }); return; }
    const oldPath = (oldRow as Record<string, string> | null)?.image_path;
    if (oldPath) supabase.storage.from(BUCKET).remove([oldPath]).catch(e => console.error('tv slide remove old:', e));
    tvNotify();
    res.json(data);
  });

  r.delete('/kviz/api/tv/slides/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data: row } = await supabase.from('tv_slides').select('image_path,kind,layout').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('tv_slides').delete().eq('id', req.params.id);
    if (error) { console.error('tv slide delete:', error); res.status(500).json({ error: 'Ошибка удаления слайда' }); return; }
    const r2 = row as Record<string, unknown> | null;
    const pathsToRemove: string[] = [];
    if (r2?.image_path) pathsToRemove.push(r2.image_path as string);
    if (r2?.kind === 'free' && r2?.layout) {
      type LayoutEl = { type: string; path?: string };
      const layout = r2.layout as { elements?: LayoutEl[] };
      for (const el of (layout.elements ?? [])) {
        if (el.type === 'image' && el.path) pathsToRemove.push(el.path);
      }
    }
    if (pathsToRemove.length) supabase.storage.from(BUCKET).remove(pathsToRemove).catch(e => console.error('tv slide delete imgs:', e));
    // Renumber remaining slides 1..n so there are no gaps
    const { data: remaining } = await supabase.from('tv_slides').select('id').order('position');
    if (remaining?.length) {
      await Promise.all((remaining as Record<string, string>[]).map((s, i) =>
        supabase.from('tv_slides').update({ position: i + 1 }).eq('id', s.id)
      ));
    }
    tvNotify();
    res.json({ ok: true });
  });

  return r;
}

async function uploadResultImg(req: Request, res: Response, side: 'before' | 'after'): Promise<void> {
  const b = req.body as Record<string, unknown>;
  if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
  const buf = Buffer.from(b.content_base64, 'base64');
  if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
  const ext = buf[0] === 0x89 ? 'png' : 'jpg';
  const { data: oldRow } = await supabase.from('tv_results').select(`${side}_path`).eq('id', req.params.id).maybeSingle();
  const sp = `results/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
  if (upErr) { console.error('tv result upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
  const { data, error } = await supabase.from('tv_results').update({ [`${side}_path`]: sp }).eq('id', req.params.id).select().single();
  if (error) { console.error('tv result update:', error); res.status(500).json({ error: 'Ошибка обновления записи' }); return; }
  const oldPath = (oldRow as Record<string, unknown>)?.[`${side}_path`] as string | undefined;
  if (oldPath) supabase.storage.from(BUCKET).remove([oldPath]).catch(e => console.error('tv result remove old:', e));
  tvNotify();
  res.json(data);
}
