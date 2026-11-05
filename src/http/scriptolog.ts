import path from 'path';
import fs   from 'fs';
import { Router, Application } from 'express';
import { supabase } from '../db/supabase';
import { getSession, makeToken, checkRate, recordFail, clearFails } from './auth';

const PAGE_PATH = path.join(__dirname, '../../public/scriptolog.html');
const TREE_PATH = path.join(__dirname, '../../scripts/sales-tree-v2.json');

let treeCache: unknown = null;
function getTree(): unknown {
  if (!treeCache) {
    treeCache = fs.existsSync(TREE_PATH)
      ? JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'))
      : { blocks: [], nodes: {}, constants: {}, rules: '' };
  }
  return treeCache;
}

function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  return null;
}

function makeClientKey(name: string, phone: string | null | undefined, channel: string): string {
  const n = phone ? normalizePhone(phone) : null;
  if (n) return 'phone:' + n.slice(1); // 7XXXXXXXXXX
  return `chat:${channel}:${name.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function auth(req: import('express').Request, res: import('express').Response): boolean {
  if (getSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

export function buildScriptologRouter(): Router {
  const r = Router();

  // Page with CSP allowing chrome-extension:// iframes
  r.get('/scriptolog', (_req, res) => {
    if (!fs.existsSync(PAGE_PATH)) {
      res.status(503).send('scriptolog page not found');
      return;
    }
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' chrome-extension://*");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(fs.readFileSync(PAGE_PATH, 'utf8'));
  });

  // Login → token in body (extension stores it, sends as Bearer)
  r.post('/api/scriptolog/login', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const login    = String(body.login    ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!login || !password) { res.status(400).json({ error: 'login and password required' }); return; }

    const ip      = String(req.ip || '');
    const rateKey = `sl:${login}:${ip}`;
    const rate    = checkRate(rateKey);
    if (!rate.ok) { res.status(429).json({ error: 'Слишком много попыток', wait_min: rate.waitMin }); return; }

    try {
      const { data, error } = await supabase.rpc('app_check_login', { p_login: login, p_password: password });
      const user = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (error || !user?.id) {
        recordFail(rateKey);
        res.status(401).json({ error: 'Неверный логин или пароль' }); return;
      }
      clearFails(rateKey);
      const token = makeToken({ id: String(user.id), login: String(user.login), display_name: String(user.display_name), role: String(user.role) });
      res.json({ token, display_name: String(user.display_name) });
    } catch (e) {
      recordFail(rateKey);
      res.status(500).json({ error: String(e) });
    }
  });

  // Tree JSON (reload on each call in dev; cached in prod)
  r.get('/api/scriptolog/tree', (req, res) => {
    if (!auth(req, res)) return;
    res.json(getTree());
  });

  // Get or create client by {name, phone, channel}
  r.post('/api/scriptolog/client', async (req, res) => {
    if (!auth(req, res)) return;
    const body    = req.body as Record<string, unknown>;
    const name    = String(body.name    ?? '').trim();
    const phone   = body.phone ? String(body.phone) : null;
    const channel = String(body.channel ?? 'unknown');
    if (!name) { res.status(400).json({ error: 'name required' }); return; }

    const key         = makeClientKey(name, phone, channel);
    const normalPhone = phone ? normalizePhone(phone) : null;

    try {
      const { data: existing } = await supabase
        .from('script_clients')
        .select('*')
        .eq('client_key', key)
        .maybeSingle();

      if (existing) {
        const { data: events } = await supabase
          .from('script_events')
          .select('*')
          .eq('client_id', existing.id)
          .order('created_at', { ascending: false })
          .limit(50);
        res.json({ client: existing, events: events ?? [] });
        return;
      }

      const { data: created, error } = await supabase
        .from('script_clients')
        .insert({ client_key: key, name, phone: normalPhone, channel, facts: {}, vars: {}, status: 'active' })
        .select('*')
        .single();

      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ client: created, events: [] });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Log event + update client state
  r.post('/api/scriptolog/event', async (req, res) => {
    if (!auth(req, res)) return;
    const body       = req.body as Record<string, unknown>;
    const client_id  = body.client_id;
    const event_type = String(body.event_type ?? '');
    if (!client_id || !event_type) { res.status(400).json({ error: 'client_id and event_type required' }); return; }

    try {
      const { error: evErr } = await supabase.from('script_events').insert({
        client_id,
        event_type,
        node_id:    body.node_id    ?? null,
        text:       body.text       ?? null,
        manager:    body.manager    ?? null,
        fact_key:   body.fact_key   ?? null,
        fact_value: body.fact_value != null ? String(body.fact_value) : null,
        meta:       body.meta       ?? null,
      });
      if (evErr) { res.status(500).json({ error: evErr.message }); return; }

      // Build update object
      const updates: Record<string, unknown> = {};

      if (['answer', 'jump', 'start'].includes(event_type) && body.node_id)
        updates.current_node = body.node_id;

      if (body.fact_key && body.fact_value != null) {
        const { data: cl } = await supabase.from('script_clients').select('facts').eq('id', client_id).single();
        updates.facts = { ...((cl?.facts as Record<string, unknown>) ?? {}), [String(body.fact_key)]: body.fact_value };
      }

      if (body.vars && typeof body.vars === 'object') {
        const { data: cl } = await supabase.from('script_clients').select('vars').eq('id', client_id).single();
        updates.vars = { ...((cl?.vars as Record<string, unknown>) ?? {}), ...(body.vars as Record<string, unknown>) };
      }

      if (body.manager) {
        const { data: cl } = await supabase.from('script_clients').select('first_manager').eq('id', client_id).single();
        updates.last_manager = body.manager;
        if (!cl?.first_manager) updates.first_manager = body.manager;
      }

      if (body.status) updates.status = body.status;

      if (Object.keys(updates).length > 0)
        await supabase.from('script_clients').update(updates).eq('id', client_id);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Bind phone to chat-keyed client; merge if phone client already exists
  r.post('/api/scriptolog/bind-phone', async (req, res) => {
    if (!auth(req, res)) return;
    const body      = req.body as Record<string, unknown>;
    const client_id = body.client_id;
    const rawPhone  = String(body.phone ?? '');
    if (!client_id || !rawPhone) { res.status(400).json({ error: 'client_id and phone required' }); return; }

    const normalPhone = normalizePhone(rawPhone);
    if (!normalPhone) { res.status(400).json({ error: 'Неверный номер телефона' }); return; }

    const newKey = 'phone:' + normalPhone.slice(1);

    try {
      const { data: phoneClient } = await supabase
        .from('script_clients')
        .select('*')
        .eq('client_key', newKey)
        .maybeSingle();

      if (!phoneClient) {
        // Simple update: assign phone and change key
        await supabase.from('script_clients').update({ phone: normalPhone, client_key: newKey }).eq('id', client_id);
        const { data: updated } = await supabase.from('script_clients').select('*').eq('id', client_id).single();
        res.json({ client: updated, merged: false });
        return;
      }

      // Merge into phone client
      const { data: oldClient } = await supabase.from('script_clients').select('*').eq('id', client_id).single();
      await supabase.from('script_events').update({ client_id: phoneClient.id }).eq('client_id', client_id);

      const mergedFacts   = { ...((oldClient?.facts as object) ?? {}), ...((phoneClient.facts as object) ?? {}) };
      const mergedVars    = { ...((oldClient?.vars as object) ?? {}),  ...((phoneClient.vars as object) ?? {}) };
      const currentNode   = phoneClient.current_node ?? oldClient?.current_node ?? null;
      const firstManager  = phoneClient.first_manager ?? oldClient?.first_manager ?? null;
      const lastManager   = oldClient?.last_manager ?? phoneClient.last_manager ?? null;

      await supabase.from('script_clients').update({ facts: mergedFacts, vars: mergedVars, current_node: currentNode, first_manager: firstManager, last_manager: lastManager }).eq('id', phoneClient.id);
      await supabase.from('script_clients').update({ merged_into: phoneClient.id }).eq('id', client_id);
      await supabase.from('script_events').insert({ client_id: phoneClient.id, event_type: 'merge', meta: { from_id: client_id } });

      const { data: merged } = await supabase.from('script_clients').select('*').eq('id', phoneClient.id).single();
      res.json({ client: merged, merged: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── Part 7: Confirm trial ───────────────────────────────────────────────────

  r.post('/api/scriptolog/confirm', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const { client_id, booking_date, booking_time, confirmed_at } = b;
    if (!client_id) { res.status(400).json({ error: 'client_id required' }); return; }
    const DRY = (process.env.SCRIPTOLOG_CONFIRM_DRY_RUN ?? 'true') === 'true';
    try {
      const { data: client } = await supabase.from('script_clients').select('name, last_manager').eq('id', client_id).single();
      const clientName = client?.name ?? '?';
      const timeStr = String(booking_time ?? '');
      const dateStr = String(booking_date ?? '');
      const confirmedAt = confirmed_at ? new Date(confirmed_at as string) : new Date();
      const hhmm = confirmedAt.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
      await supabase.from('script_events').insert({
        client_id, event_type: 'confirm', node_id: 'stage:6',
        text: `Подтвердила пробное ${dateStr} ${timeStr} — ответ в чате ${hhmm}`,
        manager: client?.last_manager ?? null,
      });
      await supabase.from('script_clients').update({ status: 'confirmed_trial' }).eq('id', client_id);
      const notif = `✅ ${clientName} подтвердила пробное на ${timeStr}`;
      console.log(`[scriptolog/confirm] ${notif}`);
      // shortcut: Fitbase booking status update skipped — API not verified; set SCRIPTOLOG_CONFIRM_DRY_RUN=false when implemented
      if (DRY) console.log('[scriptolog/confirm] SCRIPTOLOG_CONFIRM_DRY_RUN=true — Fitbase update skipped');
      res.json({ ok: true, dry: DRY, notif });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Part 5a: Promo settings ─────────────────────────────────────────────────

  r.get('/api/scriptolog/settings/promo', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const { data: promo } = await supabase.from('script_promo').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: packages } = await supabase.from('script_promo_packages').select('*').order('sort');
      res.json({ promo: promo ?? null, packages: packages ?? [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/api/scriptolog/settings/promo', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const fields: Record<string, unknown> = {
      name: String(b.name ?? '').trim(),
      valid_from: b.valid_from ?? null,
      valid_to: b.valid_to ?? null,
      is_active: !!b.is_active,
      rule_text: b.rule_text ?? null,
      credit_text: b.credit_text ?? null,
    };
    if (!fields.name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      if (b.id) {
        const { error } = await supabase.from('script_promo').update(fields).eq('id', b.id);
        if (error) { res.status(500).json({ error: error.message }); return; }
      } else {
        const { error } = await supabase.from('script_promo').insert(fields);
        if (error) { res.status(500).json({ error: error.message }); return; }
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/api/scriptolog/settings/packages', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const { data, error } = await supabase.from('script_promo_packages').select('*').order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/api/scriptolog/settings/packages', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body as Record<string, unknown>;
    if (!b.name) { res.status(400).json({ error: 'name required' }); return; }
    try {
      const { data, error } = await supabase.from('script_promo_packages').insert(pkgFields(b)).select('*').single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/api/scriptolog/settings/packages/:id', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body as Record<string, unknown>;
    try {
      const { error } = await supabase.from('script_promo_packages').update(pkgFields(b)).eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/api/scriptolog/settings/packages/:id/archive', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const { error } = await supabase.from('script_promo_packages').update({ is_archived: true }).eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Part 5a: Materials settings ─────────────────────────────────────────────

  const MAT_KEYS = ['video_trial','video_inbody','memo','gis2','guide_newbie','menu_pdf','nutrition_chat'] as const;
  type MatKey = typeof MAT_KEYS[number];

  r.get('/api/scriptolog/settings/materials', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const { data, error } = await supabase.from('script_materials').select('*');
      if (error) { res.status(500).json({ error: error.message }); return; }
      const rows = MAT_KEYS.map(key =>
        (data ?? []).find((m: Record<string, unknown>) => m.key === key) ?? { key, kind: 'link', url: null, label: key },
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/api/scriptolog/settings/materials/:key', async (req, res) => {
    if (!auth(req, res)) return;
    const { key } = req.params;
    if (!MAT_KEYS.includes(key as MatKey)) { res.status(400).json({ error: 'Invalid key' }); return; }
    const b = req.body as Record<string, unknown>;
    try {
      const { error } = await supabase.from('script_materials').upsert(
        { key, kind: b.kind ?? 'link', url: b.url ?? null, label: b.label ?? null },
        { onConflict: 'key' },
      );
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/api/scriptolog/settings/materials/:key/upload', async (req, res) => {
    if (!auth(req, res)) return;
    const { key } = req.params;
    if (!MAT_KEYS.includes(key as MatKey)) { res.status(400).json({ error: 'Invalid key' }); return; }
    const b = req.body as { content_base64?: string; content_type?: string; filename?: string };
    if (!b.content_base64 || !b.filename) { res.status(400).json({ error: 'content_base64 and filename required' }); return; }
    try {
      const buf = Buffer.from(b.content_base64, 'base64');
      const storagePath = `${key}/${b.filename}`;
      const { error: upErr } = await supabase.storage.from('scriptolog-materials').upload(
        storagePath, buf, { contentType: b.content_type ?? 'application/octet-stream', upsert: true },
      );
      if (upErr) { res.status(500).json({ error: upErr.message }); return; }
      const { data: { publicUrl } } = supabase.storage.from('scriptolog-materials').getPublicUrl(storagePath);
      await supabase.from('script_materials').upsert({ key, url: publicUrl }, { onConflict: 'key' });
      res.json({ url: publicUrl });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}

function pkgFields(b: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(b.name ?? '').trim(),
    short_text: b.short_text ?? null,
    client_name: b.client_name ?? null,
    kind: b.kind ?? 'vacu',
    price: Number(b.price ?? 0),
    visits: Number(b.visits ?? 0),
    sessions_per_visit: Number(b.sessions_per_visit ?? 0),
    tempo: Number(b.tempo ?? 2),
    validity_days: b.validity_days != null && b.validity_days !== '' ? Number(b.validity_days) : null,
    freeze_days: Number(b.freeze_days ?? 0),
    main_phase: b.main_phase ?? 'vacu_fixed',
    mechanism: Array.isArray(b.mechanism) ? b.mechanism : [],
    includes: Array.isArray(b.includes) ? b.includes : [],
    excludes: Array.isArray(b.excludes) ? b.excludes : [],
    payment_methods: Array.isArray(b.payment_methods) ? b.payment_methods : [],
    goals: Array.isArray(b.goals) ? b.goals : [],
    show_in_chat: !!b.show_in_chat,
    sort: Number(b.sort ?? 0),
  };
}

export function mountScriptologRoutes(app: Application): void {
  app.use(buildScriptologRouter());
}
