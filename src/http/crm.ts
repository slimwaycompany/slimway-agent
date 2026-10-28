import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { rawGet } from './fitbase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function requireAuth(req: Request, res: Response): boolean {
  if (getSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function requireAdmin(req: Request, res: Response): boolean {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (s.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return false; }
  return true;
}

function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  return null;
}

function iinToDob(iin: string): string | null {
  if (!/^\d{12}$/.test(iin)) return null;
  const yy = iin.slice(0, 2);
  const mm = iin.slice(2, 4);
  const dd = iin.slice(4, 6);
  const c = parseInt(iin[6]);
  const century = c <= 2 ? '19' : c <= 4 ? '20' : '18';
  if (parseInt(mm) < 1 || parseInt(mm) > 12 || parseInt(dd) < 1 || parseInt(dd) > 31) return null;
  return `${century}${yy}-${mm}-${dd}`;
}

async function writeAudit(entity_type: string, entity_id: string, action: string, actor: string, details?: Record<string, unknown>) {
  try {
    await supabase.from('crm_audit_log').insert({ entity_type, entity_id, action, actor, details: details ?? {} });
  } catch {}
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export function buildCrmRouter(): Router {
  const r = Router();

  // ── Device types ──────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/device-types', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_device_types').select('*').order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/device-types', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.code || !b.name) { res.status(400).json({ error: 'code и name обязательны' }); return; }
      const { data, error } = await supabase.from('crm_device_types').insert({ code: b.code, name: b.name, sort: b.sort ?? 0 }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/device-types/:code', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name !== undefined) upd.name = b.name;
      if (b.sort !== undefined) upd.sort = b.sort;
      const { data, error } = await supabase.from('crm_device_types').update(upd).eq('code', req.params.code).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/device-types/:code', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_device_types').delete().eq('code', req.params.code);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Devices ──────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/devices', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_devices').select('*').eq('branch_id', BRANCH_ID).order('type_code').order('number');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/devices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.type_code || !b.number) { res.status(400).json({ error: 'type_code и number обязательны' }); return; }
      const { data, error } = await supabase.from('crm_devices').insert({
        branch_id: BRANCH_ID, type_code: b.type_code, number: b.number,
        default_phase: b.default_phase ?? null, session_minutes: b.session_minutes ?? null,
        status: b.status ?? 'active', notes: b.notes ?? null,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/devices/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['type_code', 'number', 'default_phase', 'session_minutes', 'status', 'notes']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      const { data, error } = await supabase.from('crm_devices').update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Plans ────────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/plans', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_plans').select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (req.query.kind) q = q.eq('kind', req.query.kind as string);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/plans', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.kind || !b.name) { res.status(400).json({ error: 'kind и name обязательны' }); return; }
      const { data, error } = await supabase.from('crm_plans').insert({
        branch_id: BRANCH_ID, kind: b.kind, name: b.name,
        description: b.description ?? null, price: Number(b.price ?? 0),
        is_promo: Boolean(b.is_promo), is_free_booking: Boolean(b.is_free_booking),
        is_system: false, validity_days: b.validity_days ?? null,
        extra_days: b.extra_days ?? null, freeze_days: b.freeze_days ?? null,
        guest_visits: b.guest_visits ?? null, auto_activate_days: b.auto_activate_days ?? null,
        max_deferred_start_days: b.max_deferred_start_days ?? null,
        is_active: true, sort: b.sort ?? 0,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/plans/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'description', 'price', 'is_promo', 'is_free_booking', 'validity_days',
        'extra_days', 'freeze_days', 'guest_visits', 'auto_activate_days', 'max_deferred_start_days', 'is_active', 'sort']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      const { data, error } = await supabase.from('crm_plans').update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Plan items ───────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/plans/:id/items', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_plan_items').select('*').eq('plan_id', req.params.id).order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/plans/:id/items', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.device_type_code || b.sessions == null) { res.status(400).json({ error: 'device_type_code и sessions обязательны' }); return; }
      const { data, error } = await supabase.from('crm_plan_items').insert({
        plan_id: req.params.id, device_type_code: b.device_type_code,
        phase: b.phase ?? null, sessions: Number(b.sessions), sort: b.sort ?? 0,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/plan-items/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['device_type_code', 'phase', 'sessions', 'sort']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_plan_items').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/plan-items/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_plan_items').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Suppliers ────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/suppliers', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_suppliers').select('*').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/suppliers', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'name обязателен' }); return; }
      const { data, error } = await supabase.from('crm_suppliers').insert({ name: b.name, phone: b.phone ?? null, notes: b.notes ?? null, is_active: true }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/suppliers/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['name', 'phone', 'notes', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_suppliers').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Products ──────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/products', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const [{ data: products, error: pe }, { data: stock, error: se }] = await Promise.all([
        supabase.from('crm_products').select('*').eq('branch_id', BRANCH_ID).order('name'),
        supabase.from('crm_product_stock').select('product_id,stock,retail_price'),
      ]);
      if (pe) { res.status(500).json({ error: pe.message }); return; }
      if (se) { res.status(500).json({ error: se.message }); return; }
      const sm = new Map((stock || []).map(s => [s.product_id, s]));
      res.json((products || []).map(p => ({ ...p, stock: sm.get(p.id)?.stock ?? 0, retail_price: sm.get(p.id)?.retail_price ?? null })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/products', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'name обязателен' }); return; }
      const { data, error } = await supabase.from('crm_products').insert({ branch_id: BRANCH_ID, name: b.name, barcode: b.barcode ?? null, is_active: b.is_active !== false }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/products/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'barcode', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_products').update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Product supplies ──────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/products/:id/supplies', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_product_supplies').select('*').eq('product_id', req.params.id).order('supplied_at', { ascending: false });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/products/:id/supplies', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.quantity || !b.purchase_price) { res.status(400).json({ error: 'quantity и purchase_price обязательны' }); return; }
      const qty = Number(b.quantity);
      const { data, error } = await supabase.from('crm_product_supplies').insert({
        product_id: req.params.id, supplier_id: b.supplier_id ?? null,
        quantity: qty, remaining: qty, purchase_price: Number(b.purchase_price),
        retail_price: b.retail_price ? Number(b.retail_price) : null,
        supplied_at: b.supplied_at ?? new Date().toISOString(),
        notes: b.notes ?? null, created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Promo codes ───────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/promo-codes', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_promo_codes').select('*').order('created_at', { ascending: false });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/promo-codes', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.code || !b.discount_type) { res.status(400).json({ error: 'code и discount_type обязательны' }); return; }
      const { data, error } = await supabase.from('crm_promo_codes').insert({
        code: String(b.code).toUpperCase().trim(),
        discount_type: b.discount_type, discount_value: Number(b.discount_value ?? 0),
        max_uses: b.max_uses ?? null, max_uses_per_client: b.max_uses_per_client ?? null,
        expires_at: b.expires_at ?? null, applies_to_all: Boolean(b.applies_to_all),
        is_active: true, uses_count: 0, created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/promo-codes/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['discount_type', 'discount_value', 'max_uses', 'max_uses_per_client', 'expires_at', 'applies_to_all', 'is_active']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      const { data, error } = await supabase.from('crm_promo_codes').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/promo-codes/:id/targets', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_promo_targets').select('*').eq('promo_id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/promo-codes/:id/targets', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.target_type || !b.target_id) { res.status(400).json({ error: 'target_type и target_id обязательны' }); return; }
      const { error } = await supabase.from('crm_promo_targets').insert({ promo_id: req.params.id, target_type: b.target_type, target_id: b.target_id });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/promo-codes/:id/targets/:ttype/:tid', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_promo_targets').delete()
        .eq('promo_id', req.params.id).eq('target_type', req.params.ttype).eq('target_id', req.params.tid);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Payment methods ───────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/payment-methods', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_payment_methods').select('*').order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/payment-methods', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name || !b.kind) { res.status(400).json({ error: 'name и kind обязательны' }); return; }
      const { data, error } = await supabase.from('crm_payment_methods').insert({ name: b.name, kind: b.kind, is_system: false, is_active: true, sort: b.sort ?? 0 }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/payment-methods/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['name', 'kind', 'is_active', 'sort']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_payment_methods').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Ad sources ────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/ad-sources', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_ad_sources').select('*').order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/ad-sources', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'name обязателен' }); return; }
      const { data, error } = await supabase.from('crm_ad_sources').insert({ name: b.name, requires_referrer: Boolean(b.requires_referrer), is_active: true, sort: b.sort ?? 0 }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/ad-sources/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['name', 'requires_referrer', 'is_active', 'sort']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_ad_sources').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Clients ───────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/clients', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_clients')
        .select('id,full_name,phone,birth_date,ad_source_id,profile_complete,status,fitbase_client_id,created_at,is_deleted')
        .eq('is_deleted', false)
        .order('full_name');
      if (req.query.search) {
        const s = String(req.query.search);
        q = (q as any).or(`full_name.ilike.%${s}%,phone.ilike.%${s}%`);
      }
      if (req.query.ad_source_id) q = q.eq('ad_source_id', req.query.ad_source_id as string);
      if (req.query.profile_complete === 'true') q = q.eq('profile_complete', true);
      if (req.query.profile_complete === 'false') q = q.eq('profile_complete', false);
      if (req.query.status) q = q.eq('status', req.query.status as string);
      const limit = Math.min(Number(req.query.limit ?? 100), 200);
      const offset = Number(req.query.offset ?? 0);
      q = q.range(offset, offset + limit - 1);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.full_name) { res.status(400).json({ error: 'full_name обязателен' }); return; }
      let phone: string | null = null;
      if (b.phone) {
        phone = normalizePhone(String(b.phone));
        if (!phone) { res.status(400).json({ error: 'Неверный формат телефона' }); return; }
        const { data: dup } = await supabase.from('crm_clients').select('id').eq('phone', phone).eq('is_deleted', false).maybeSingle();
        if (dup) { res.status(409).json({ error: 'Клиент с таким телефоном уже существует' }); return; }
      }
      const iin = b.iin ? String(b.iin).replace(/\D/g, '') : null;
      if (iin && iin.length !== 12) { res.status(400).json({ error: 'ИИН должен содержать 12 цифр' }); return; }
      let birth_date = b.birth_date ?? null;
      if (iin && !birth_date) birth_date = iinToDob(iin);
      const { data, error } = await supabase.from('crm_clients').insert({
        branch_id: BRANCH_ID,
        full_name: String(b.full_name).trim(),
        phone, iin,
        birth_date: birth_date ?? null,
        ad_source_id: b.ad_source_id ?? null,
        referrer_client_id: b.referrer_client_id ?? null,
        id_issued_by: b.id_issued_by ?? null,
        id_valid_until: b.id_valid_until ?? null,
        contraindications: b.contraindications ?? null,
        notes: b.notes ?? null,
        profile_complete: Boolean(b.profile_complete),
        source: 'manual', status: 'active', is_deleted: false,
        created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data, error } = await supabase.from('crm_clients').select('*').eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Клиент не найден' }); return; }
      if (data.iin && session.role !== 'admin') {
        data.iin = data.iin.slice(0, 6) + '******';
      }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/clients/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.full_name !== undefined) upd.full_name = String(b.full_name).trim();
      if (b.phone !== undefined) {
        if (b.phone === null || b.phone === '') {
          upd.phone = null;
        } else {
          const p = normalizePhone(String(b.phone));
          if (!p) { res.status(400).json({ error: 'Неверный формат телефона' }); return; }
          const { data: dup } = await supabase.from('crm_clients').select('id').eq('phone', p).eq('is_deleted', false).neq('id', req.params.id).maybeSingle();
          if (dup) { res.status(409).json({ error: 'Клиент с таким телефоном уже существует' }); return; }
          upd.phone = p;
        }
      }
      if (b.iin !== undefined) {
        const iin = b.iin ? String(b.iin).replace(/\D/g, '') : null;
        if (iin && iin.length !== 12) { res.status(400).json({ error: 'ИИН должен содержать 12 цифр' }); return; }
        upd.iin = iin;
        if (iin && !b.birth_date) upd.birth_date = iinToDob(iin);
      }
      for (const k of ['birth_date', 'ad_source_id', 'referrer_client_id', 'id_issued_by', 'id_valid_until', 'contraindications', 'notes', 'profile_complete', 'status']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      const { data, error } = await supabase.from('crm_clients').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/clients/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { error } = await supabase.from('crm_clients').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, 'archive', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client photo ──────────────────────────────────────────────────────────────
  r.post('/kviz/api/crm/clients/:id/photo', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.data || !b.mime) { res.status(400).json({ error: 'data и mime обязательны' }); return; }
      const base64 = String(b.data).replace(/^data:[^,]+,/, '');
      const buf = Buffer.from(base64, 'base64');
      if (buf.length > 5 * 1024 * 1024) { res.status(413).json({ error: 'Фото не более 5 МБ' }); return; }
      const ext = String(b.mime).includes('png') ? 'png' : 'jpg';
      const path = `${req.params.id}/photo.${ext}`;
      const { error: upErr } = await supabase.storage.from('crm-client-photos').upload(path, buf, { contentType: String(b.mime), upsert: true });
      if (upErr) { res.status(500).json({ error: upErr.message }); return; }
      const { error: updErr } = await supabase.from('crm_clients').update({ photo_path: path, updated_at: new Date().toISOString() }).eq('id', req.params.id);
      if (updErr) { res.status(500).json({ error: updErr.message }); return; }
      res.json({ path });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id/photo-url', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data: client } = await supabase.from('crm_clients').select('photo_path').eq('id', req.params.id).single();
      if (!client?.photo_path) { res.json({ url: null }); return; }
      const { data, error } = await supabase.storage.from('crm-client-photos').createSignedUrl(client.photo_path, 3600);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ url: data.signedUrl });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Fitbase import ────────────────────────────────────────────────────────────
  r.post('/kviz/api/crm/clients/fitbase-import', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    let imported = 0, skipped = 0, total = 0;
    try {
      let page = 1;
      while (true) {
        const resp = await rawGet(`/client?page=${page}&page_size=100`) as Record<string, unknown>;
        const items = (resp.items || []) as Record<string, unknown>[];
        total += items.length;
        if (items.length === 0) break;
        for (const c of items) {
          const fitId = String(c.id || '');
          if (!fitId) { skipped++; continue; }
          const { data: existing } = await supabase.from('crm_clients').select('id').eq('fitbase_client_id', fitId).maybeSingle();
          if (existing) { skipped++; continue; }
          const rawPhone = String(c.phone || c.mobile || '');
          const phone = rawPhone ? normalizePhone(rawPhone) : null;
          const fullName = String(c.full_name || c.name || '').trim();
          if (!fullName) { skipped++; continue; }
          const { error } = await supabase.from('crm_clients').insert({
            branch_id: BRANCH_ID, full_name: fullName, phone,
            birth_date: c.birth_date ?? null,
            fitbase_client_id: fitId, source: 'fitbase',
            status: 'active', is_deleted: false, profile_complete: false,
            created_by: session.display_name,
          });
          if (error) { skipped++; } else { imported++; }
        }
        if (items.length < 100) break;
        page++;
        await sleep(400);
      }
      res.json({ imported, skipped, total });
    } catch (e) { res.status(500).json({ error: String(e), imported, skipped, total }); }
  });

  return r;
}
