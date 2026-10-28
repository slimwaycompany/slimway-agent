import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

const BRANCH_ID    = '00000000-0000-0000-0000-000000000001';
const VALID_PHASES   = new Set(['active', 'finishing']);
const VALID_STATUSES = new Set(['working', 'repair', 'disabled', 'broken']);
const VALID_PM_KIND  = new Set(['cash', 'cashless']);

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
// crm_* tables store phone as 7XXXXXXXXXX (no + prefix)
function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return d;
  return null;
}
function iinToDob(iin: string): string | null {
  if (!/^\d{12}$/.test(iin)) return null;
  const yy = iin.slice(0, 2), mm = iin.slice(2, 4), dd = iin.slice(4, 6);
  const c = parseInt(iin[6]);
  const century = c <= 2 ? '19' : c <= 4 ? '20' : '18';
  if (parseInt(mm) < 1 || parseInt(mm) > 12 || parseInt(dd) < 1 || parseInt(dd) > 31) return null;
  return `${century}${yy}-${mm}-${dd}`;
}
async function writeAudit(entity_type: string, entity_id: string, action: string, actor: string) {
  try { await supabase.from('crm_audit_log').insert({ entity_type, entity_id, action, actor, details: {} }); } catch {}
}
function n0(v: unknown): number { const x = Number(v); return isNaN(x) ? 0 : x; }
function nNull(v: unknown): number | null { if (v === '' || v == null) return null; const x = Number(v); return isNaN(x) ? null : x; }

// Asia/Yekaterinburg = UTC+5
function todayUtc5(): string {
  const d = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const RPC_ERROR_MAP: Record<string, string> = {
  SHIFT_NOT_OPEN:            'Смена не открыта',
  EMPTY_CART:                'Корзина пуста',
  CLIENT_REQUIRED:           'Для абонемента, услуги и депозита нужен клиент',
  CLIENT_NOT_FOUND:          'Клиент не найден',
  PAYMENT_MISMATCH:          'Сумма оплат не равна итогу',
  REASON_REQUIRED:           'Укажите причину',
  REFUND_EXCEEDS_SALE:       'Сумма возврата превышает сумму продажи',
  BAD_REFUND_QTY:            'Неверное количество для возврата',
  PROMO_INACTIVE:            'Промокод неактивен',
  PROMO_EXPIRED:             'Срок действия промокода истёк',
  PROMO_LIMIT:               'Лимит использований промокода исчерпан',
  PROMO_CLIENT_LIMIT:        'Вы уже использовали этот промокод',
  PROMO_NEEDS_CLIENT:        'Для этого промокода нужен клиент',
};

function translateRpcError(msg: string): string {
  if (msg.includes('OUT_OF_STOCK')) {
    const name = msg.split('OUT_OF_STOCK:')[1]?.split(/[\s,"]/)[0] ?? '';
    return `Не хватает на складе${name ? ': ' + name : ''}`;
  }
  if (msg.includes('INSUFFICIENT_BALANCE')) {
    const wallet = msg.split('INSUFFICIENT_BALANCE:')[1]?.split(/[\s,"]/)[0] ?? '';
    return wallet === 'deposit' ? 'Недостаточно на депозите' : 'Недостаточно бонусов';
  }
  for (const [code, text] of Object.entries(RPC_ERROR_MAP)) {
    if (msg.includes(code)) return text;
  }
  return msg;
}

// Compute profile_complete from merged client fields
async function computeProfileComplete(fields: Record<string, unknown>): Promise<boolean> {
  if (!fields.full_name || !fields.phone || !fields.birth_date) return false;
  if (!fields.iin || !fields.id_issued_by || !fields.id_valid_until) return false;
  if (!fields.ad_source_id) return false;
  const { data: src } = await supabase.from('crm_ad_sources').select('requires_referrer').eq('id', fields.ad_source_id as string).single();
  if (!src) return false;
  if (src.requires_referrer && !fields.referrer_client_id) return false;
  return true;
}

export async function runCrmLifecycle(): Promise<Record<string, number>> {
  const today = todayUtc5();
  let activated = 0, expired = 0;

  // Activate: not_activated where planned_start_date <= today OR auto_activate_on <= today
  const { data: toActivate } = await supabase.from('crm_client_plans')
    .select('id, plan_id, planned_start_date, auto_activate_on')
    .eq('status', 'not_activated')
    .or(`planned_start_date.lte.${today},auto_activate_on.lte.${today}`);

  for (const cp of toActivate || []) {
    const startDate = cp.planned_start_date || today;
    const { data: plan } = await supabase.from('crm_plans')
      .select('validity_days, extra_days').eq('id', cp.plan_id).single();
    if (!plan) continue;
    const validUntil = plan.validity_days
      ? addDays(startDate, plan.validity_days - 1)
      : null;
    const extraUntil = validUntil && plan.extra_days
      ? addDays(validUntil, plan.extra_days)
      : null;
    const { error } = await supabase.from('crm_client_plans').update({
      status: 'active', activated_at: startDate,
      valid_until: validUntil, extra_until: extraUntil,
    }).eq('id', cp.id);
    if (!error) {
      await writeAudit('client_plan', cp.id, 'activated', 'system');
      activated++;
    }
  }

  // Expire: active where today > coalesce(extra_until, valid_until)
  const { data: toExpire } = await supabase.from('crm_client_plans')
    .select('id, valid_until, extra_until')
    .eq('status', 'active');

  for (const cp of toExpire || []) {
    const deadline = cp.extra_until || cp.valid_until;
    if (!deadline) continue;
    if (today > deadline) {
      const { error } = await supabase.from('crm_client_plans').update({ status: 'expired' }).eq('id', cp.id);
      if (!error) {
        await writeAudit('client_plan', cp.id, 'expired', 'system');
        expired++;
      }
    }
  }

  return { activated, expired };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Fitbase import (background job, single instance) ─────────────────────────

interface ImportJob {
  status: 'running' | 'done' | 'error';
  total: number; processed: number;
  added: number; updated: number; skipped: number;
  errors: string[];
}
let fitbaseImportJob: ImportJob | null = null;

async function runFitbaseImport(): Promise<void> {
  const job = fitbaseImportJob!;
  try {
    const { data: cache } = await supabase.from('fitbase_clients_cache').select('fitbase_client_id,phone,name');
    job.total = (cache || []).length;

    const { data: existing } = await supabase.from('crm_clients')
      .select('id,fitbase_client_id,phone').eq('is_deleted', false);
    const byFitId = new Map<string, string>();
    const existingPhones = new Set<string>();
    for (const c of existing || []) {
      if (c.fitbase_client_id) byFitId.set(String(c.fitbase_client_id), c.id);
      if (c.phone) existingPhones.add(c.phone);
    }

    const toInsert: Record<string, unknown>[] = [];
    for (const c of cache || []) {
      const fitId = String(c.fitbase_client_id || '');
      const fullName = String(c.name || '').trim();
      const phone = c.phone ? (normalizePhone(c.phone) ?? null) : null;
      if (!fullName) {
        job.skipped++; job.processed++;
        if (job.errors.length < 20) job.errors.push(`${fitId}: пустое имя`);
        continue;
      }
      const existingId = fitId ? byFitId.get(fitId) : null;
      if (existingId) {
        await supabase.from('crm_clients').update({ fitbase_client_id: fitId || null }).eq('id', existingId);
        job.updated++; job.processed++;
      } else {
        if (phone && existingPhones.has(phone)) {
          job.skipped++; job.processed++;
          if (job.errors.length < 20) job.errors.push(`${fitId}: телефон уже есть`);
          continue;
        }
        toInsert.push({
          branch_id: BRANCH_ID, full_name: fullName, phone,
          fitbase_client_id: fitId || null,
          source: 'fitbase_import', status: 'active', is_deleted: false,
          profile_complete: false, created_by: 'fitbase_import',
        });
        if (phone) existingPhones.add(phone);
      }
    }

    // Batch insert (100 at a time to stay within memory and Supabase limits)
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error } = await supabase.from('crm_clients').insert(batch);
      if (error) {
        job.skipped += batch.length;
        if (job.errors.length < 20) job.errors.push(error.message);
      } else {
        job.added += batch.length;
      }
      job.processed += batch.length;
    }
    job.status = 'done';
  } catch (e) {
    job.status = 'error';
    if (job.errors.length < 20) job.errors.push(String(e));
  }
}

export function buildCrmRouter(): Router {
  const r = Router();

  // ── Device types ────────────────────────────────────────────────────────────
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
      if (!b.code || !b.name) { res.status(400).json({ error: 'Укажите код и название' }); return; }
      const { data, error } = await supabase.from('crm_device_types')
        .insert({ code: b.code, name: b.name, sort: n0(b.sort) }).select().single();
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
      if (b.sort !== undefined) upd.sort = n0(b.sort);
      const { data, error } = await supabase.from('crm_device_types')
        .update(upd).eq('code', req.params.code).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/device-types/:code', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { count } = await supabase.from('crm_devices')
        .select('id', { count: 'exact', head: true }).eq('type_code', req.params.code);
      if (count && count > 0) {
        res.status(409).json({ error: `Тип используется ${count} аппаратами — сначала удалите их` }); return;
      }
      const { error } = await supabase.from('crm_device_types').delete().eq('code', req.params.code);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('device_type', req.params.code, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Devices ─────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/devices/next-number', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const tc = req.query.type_code as string;
      if (!tc) { res.json({ next: 1 }); return; }
      const { data } = await supabase.from('crm_devices')
        .select('number').eq('branch_id', BRANCH_ID).eq('type_code', tc).order('number', { ascending: false });
      const nums = (data || []).map(d => parseInt(String(d.number)) || 0).filter(n => n > 0);
      const max = nums.length ? Math.max(...nums) : 0;
      res.json({ next: max + 1 });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/devices', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_devices')
        .select('*').eq('branch_id', BRANCH_ID).order('type_code').order('number');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/devices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.type_code) { res.status(400).json({ error: 'Выберите вид аппарата' }); return; }
      if (!b.number)    { res.status(400).json({ error: 'Укажите номер аппарата' }); return; }
      const phase  = b.default_phase ? String(b.default_phase) : null;
      const status = b.status ? String(b.status) : 'working';
      if (phase  && !VALID_PHASES.has(phase))   { res.status(400).json({ error: 'Укажите фазу: active или finishing' }); return; }
      if (!VALID_STATUSES.has(status))           { res.status(400).json({ error: 'Неверный статус аппарата' }); return; }
      // duplicate check
      const { count } = await supabase.from('crm_devices').select('id', { count: 'exact', head: true })
        .eq('branch_id', BRANCH_ID).eq('type_code', String(b.type_code)).eq('number', String(b.number));
      if (count && count > 0) {
        const { data: dt } = await supabase.from('crm_device_types').select('name').eq('code', b.type_code).single();
        const typeName = dt?.name ?? String(b.type_code);
        res.status(409).json({ error: `Аппарат ${typeName} №${b.number} уже есть` }); return;
      }
      const { data, error } = await supabase.from('crm_devices').insert({
        branch_id: BRANCH_ID, type_code: b.type_code, number: String(b.number),
        default_phase: phase, session_minutes: nNull(b.session_minutes),
        status, notes: b.notes ?? null,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('device', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/devices/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.type_code        !== undefined) upd.type_code        = b.type_code;
      if (b.number           !== undefined) upd.number           = String(b.number);
      if (b.session_minutes  !== undefined) upd.session_minutes  = nNull(b.session_minutes);
      if (b.notes            !== undefined) upd.notes            = b.notes;
      if (b.default_phase !== undefined) {
        const phase = b.default_phase ? String(b.default_phase) : null;
        if (phase && !VALID_PHASES.has(phase)) { res.status(400).json({ error: 'Неверная фаза' }); return; }
        upd.default_phase = phase;
      }
      if (b.status !== undefined) {
        const status = String(b.status);
        if (!VALID_STATUSES.has(status)) { res.status(400).json({ error: 'Неверный статус аппарата' }); return; }
        upd.status = status;
      }
      const { data, error } = await supabase.from('crm_devices')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('device', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/devices/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { error } = await supabase.from('crm_devices').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('device', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Plans ────────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/plans', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_plans')
        .select('*, crm_plan_items(*)')
        .eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (req.query.kind) q = q.eq('kind', req.query.kind as string);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json((data || []).map(({ crm_plan_items, ...p }) => ({ ...p, items: crm_plan_items || [] })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  function validateItems(items: unknown[]): string | null {
    for (const it of items as Record<string, unknown>[]) {
      if (!it.device_type_code) return 'Выберите тип аппарата для каждой позиции';
      if (!VALID_PHASES.has(String(it.phase))) return 'Укажите фазу для каждой позиции';
      if (!it.sessions || Number(it.sessions) < 1) return 'Укажите количество сеансов (не менее 1)';
    }
    return null;
  }

  r.post('/kviz/api/crm/plans', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.kind || !b.name) { res.status(400).json({ error: 'Укажите вид и название' }); return; }
      const items = Array.isArray(b.items) ? b.items as Record<string, unknown>[] : [];
      if (b.kind === 'abonement' && items.length === 0) {
        res.status(400).json({ error: 'Абонемент должен содержать хотя бы 1 аппарат в составе' }); return;
      }
      const itemErr = validateItems(items);
      if (itemErr) { res.status(400).json({ error: itemErr }); return; }

      const { data: plan, error: planErr } = await supabase.from('crm_plans').insert({
        branch_id: BRANCH_ID, kind: b.kind, name: String(b.name).trim(),
        description: b.description ?? null, price: n0(b.price),
        is_promo: Boolean(b.is_promo), is_free_booking: Boolean(b.is_free_booking),
        is_system: false,
        validity_days: nNull(b.validity_days), extra_days: n0(b.extra_days),
        freeze_days: n0(b.freeze_days), guest_visits: n0(b.guest_visits),
        auto_activate_days: nNull(b.auto_activate_days),
        max_deferred_start_days: n0(b.max_deferred_start_days),
        is_active: true, sort: n0(b.sort),
      }).select().single();
      if (planErr) { res.status(500).json({ error: planErr.message }); return; }

      if (items.length > 0) {
        const rows = items.map((it, i) => ({
          plan_id: plan.id, device_type_code: it.device_type_code,
          phase: String(it.phase), sessions: n0(it.sessions), sort: i,
        }));
        const { error: itemsErr } = await supabase.from('crm_plan_items').insert(rows);
        if (itemsErr) {
          await supabase.from('crm_plans').delete().eq('id', plan.id);
          res.status(500).json({ error: `Состав не сохранился: ${itemsErr.message}` }); return;
        }
      }
      await writeAudit('plan', plan.id, 'create', session.display_name);
      res.json(plan);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/plans/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.name            !== undefined) upd.name            = String(b.name).trim();
      if (b.description     !== undefined) upd.description     = b.description ?? null;
      if (b.price           !== undefined) upd.price           = n0(b.price);
      if (b.is_promo        !== undefined) upd.is_promo        = Boolean(b.is_promo);
      if (b.is_free_booking !== undefined) upd.is_free_booking = Boolean(b.is_free_booking);
      if (b.is_active       !== undefined) upd.is_active       = Boolean(b.is_active);
      if (b.sort            !== undefined) upd.sort            = n0(b.sort);
      if (b.validity_days        !== undefined) upd.validity_days        = nNull(b.validity_days);
      if (b.extra_days           !== undefined) upd.extra_days           = n0(b.extra_days);
      if (b.freeze_days          !== undefined) upd.freeze_days          = n0(b.freeze_days);
      if (b.guest_visits         !== undefined) upd.guest_visits         = n0(b.guest_visits);
      if (b.auto_activate_days   !== undefined) upd.auto_activate_days   = nNull(b.auto_activate_days);
      if (b.max_deferred_start_days !== undefined) upd.max_deferred_start_days = n0(b.max_deferred_start_days);

      const { data, error } = await supabase.from('crm_plans')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      if (Array.isArray(b.items)) {
        const items = b.items as Record<string, unknown>[];
        const itemErr = validateItems(items);
        if (itemErr) { res.status(400).json({ error: itemErr }); return; }
        await supabase.from('crm_plan_items').delete().eq('plan_id', req.params.id);
        if (items.length > 0) {
          const rows = items.map((it, i) => ({
            plan_id: req.params.id, device_type_code: it.device_type_code,
            phase: String(it.phase), sessions: n0(it.sessions), sort: i,
          }));
          const { error: ie } = await supabase.from('crm_plan_items').insert(rows);
          if (ie) { res.status(500).json({ error: `Состав: ${ie.message}` }); return; }
        }
      }
      await writeAudit('plan', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/plans/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: plan } = await supabase.from('crm_plans').select('name, is_system').eq('id', req.params.id).single();
      if (!plan) { res.status(404).json({ error: 'Не найден' }); return; }
      if (plan.is_system) { res.status(409).json({ error: `Системный план «${plan.name}» нельзя удалять` }); return; }
      await supabase.from('crm_plan_items').delete().eq('plan_id', req.params.id);
      await supabase.from('crm_promo_targets').delete().eq('target_type', 'plan').eq('target_id', req.params.id);
      const { error } = await supabase.from('crm_plans').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('plan', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Plan items (kept for direct use) ─────────────────────────────────────────
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
      if (!b.device_type_code) { res.status(400).json({ error: 'Выберите тип аппарата' }); return; }
      const phase = b.phase ? String(b.phase) : null;
      if (phase && !VALID_PHASES.has(phase)) { res.status(400).json({ error: 'Укажите фазу' }); return; }
      if (!b.sessions || Number(b.sessions) < 1) { res.status(400).json({ error: 'Укажите количество сеансов' }); return; }
      const { data, error } = await supabase.from('crm_plan_items').insert({
        plan_id: req.params.id, device_type_code: b.device_type_code,
        phase, sessions: n0(b.sessions), sort: n0(b.sort),
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
      if (b.device_type_code !== undefined) upd.device_type_code = b.device_type_code;
      if (b.sessions         !== undefined) upd.sessions         = n0(b.sessions);
      if (b.sort             !== undefined) upd.sort             = n0(b.sort);
      if (b.phase !== undefined) {
        const phase = b.phase ? String(b.phase) : null;
        if (phase && !VALID_PHASES.has(phase)) { res.status(400).json({ error: 'Укажите фазу' }); return; }
        upd.phase = phase;
      }
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
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название поставщика' }); return; }
      const { data, error } = await supabase.from('crm_suppliers').insert({
        name: String(b.name).trim(), phone: b.phone ?? null,
        link: b.link ?? null, notes: b.notes ?? null, is_active: true,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('supplier', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/suppliers/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['name', 'phone', 'link', 'notes', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_suppliers').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('supplier', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/suppliers/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { count } = await supabase.from('crm_product_supplies')
        .select('id', { count: 'exact', head: true }).eq('supplier_id', req.params.id);
      if (count && count > 0) {
        res.status(409).json({ error: `Поставщик использован в ${count} поставках — можно только отправить в архив` }); return;
      }
      const { error } = await supabase.from('crm_suppliers').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('supplier', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
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
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название товара' }); return; }
      const { data, error } = await supabase.from('crm_products').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(),
        barcode: b.barcode ?? null, is_active: b.is_active !== false,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('product', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/products/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'barcode', 'is_active']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_products')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('product', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/products/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { count } = await supabase.from('crm_product_supplies')
        .select('id', { count: 'exact', head: true }).eq('product_id', req.params.id);
      if (count && count > 0) {
        res.status(409).json({ error: `Товар имеет ${count} поставок — можно только отправить в архив` }); return;
      }
      const { error } = await supabase.from('crm_products').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('product', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Product supplies ──────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/products/:id/supplies', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_product_supplies')
        .select('*').eq('product_id', req.params.id).order('supplied_at', { ascending: false });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/products/:id/supplies', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.supplier_id)    { res.status(400).json({ error: 'Выберите поставщика' }); return; }
      if (!b.quantity)       { res.status(400).json({ error: 'Укажите количество' }); return; }
      if (!b.purchase_price) { res.status(400).json({ error: 'Укажите закупочную цену' }); return; }
      if (!b.retail_price)   { res.status(400).json({ error: 'Укажите розничную цену' }); return; }
      if (!b.supplied_at)    { res.status(400).json({ error: 'Укажите дату поставки' }); return; }
      const qty = n0(b.quantity);
      const { data, error } = await supabase.from('crm_product_supplies').insert({
        product_id: req.params.id, supplier_id: b.supplier_id,
        quantity: qty, remaining: qty,
        purchase_price: n0(b.purchase_price), retail_price: n0(b.retail_price),
        supplied_at: b.supplied_at, notes: b.notes ?? null,
        created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('supply', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/product-supplies/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: supply } = await supabase.from('crm_product_supplies')
        .select('quantity, remaining').eq('id', req.params.id).single();
      if (!supply) { res.status(404).json({ error: 'Поставка не найдена' }); return; }
      if (supply.remaining < supply.quantity) {
        res.status(409).json({ error: 'Из этой поставки уже продано — удаление невозможно' }); return;
      }
      const { error } = await supabase.from('crm_product_supplies').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('supply', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
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
      if (!b.code)          { res.status(400).json({ error: 'Укажите код промокода' }); return; }
      if (!b.discount_type) { res.status(400).json({ error: 'Укажите тип скидки' }); return; }
      const { data, error } = await supabase.from('crm_promo_codes').insert({
        code: String(b.code).toUpperCase().trim(),
        discount_type: b.discount_type, discount_value: n0(b.discount_value),
        max_uses: b.max_uses ?? null, max_uses_per_client: b.max_uses_per_client ?? null,
        expires_at: b.expires_at ?? null, applies_to_all: Boolean(b.applies_to_all),
        is_active: true, uses_count: 0, created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('promo_code', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/promo-codes/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['discount_type', 'discount_value', 'max_uses', 'max_uses_per_client', 'expires_at', 'applies_to_all', 'is_active']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      const { data, error } = await supabase.from('crm_promo_codes').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('promo_code', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/promo-codes/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: promo } = await supabase.from('crm_promo_codes').select('uses_count').eq('id', req.params.id).single();
      if (!promo) { res.status(404).json({ error: 'Не найден' }); return; }
      if (promo.uses_count > 0) {
        res.status(409).json({ error: `Промокод использован ${promo.uses_count} раз — можно только деактивировать` }); return;
      }
      await supabase.from('crm_promo_targets').delete().eq('promo_id', req.params.id);
      const { error } = await supabase.from('crm_promo_codes').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('promo_code', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
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
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название' }); return; }
      const kind = String(b.kind || '');
      if (!VALID_PM_KIND.has(kind)) { res.status(400).json({ error: 'Тип должен быть «Наличные» или «Безналичные»' }); return; }
      const { data, error } = await supabase.from('crm_payment_methods').insert({
        name: String(b.name).trim(), kind, is_system: false, is_active: true, sort: n0(b.sort),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('payment_method', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/payment-methods/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const { data: existing } = await supabase.from('crm_payment_methods').select('is_system').eq('id', req.params.id).single();
      if (!existing) { res.status(404).json({ error: 'Не найден' }); return; }
      const upd: Record<string, unknown> = {};
      if (existing.is_system) {
        // system: only toggle active
        if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      } else {
        if (b.name      !== undefined) upd.name      = String(b.name).trim();
        if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
        if (b.sort      !== undefined) upd.sort      = n0(b.sort);
        if (b.kind !== undefined) {
          const kind = String(b.kind);
          if (!VALID_PM_KIND.has(kind)) { res.status(400).json({ error: 'Тип должен быть «Наличные» или «Безналичные»' }); return; }
          upd.kind = kind;
        }
      }
      if (!Object.keys(upd).length) { res.json(existing); return; }
      const { data, error } = await supabase.from('crm_payment_methods').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('payment_method', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/payment-methods/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: pm } = await supabase.from('crm_payment_methods').select('name, is_system').eq('id', req.params.id).single();
      if (!pm) { res.status(404).json({ error: 'Не найден' }); return; }
      if (pm.is_system) { res.status(409).json({ error: `Системный вид оплаты «${pm.name}» нельзя удалять` }); return; }
      const { error } = await supabase.from('crm_payment_methods').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('payment_method', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
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
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название источника' }); return; }
      const { data, error } = await supabase.from('crm_ad_sources').insert({
        name: String(b.name).trim(), requires_referrer: Boolean(b.requires_referrer), is_active: true, sort: n0(b.sort),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('ad_source', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/ad-sources/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      for (const k of ['name', 'requires_referrer', 'is_active', 'sort']) if (b[k] !== undefined) upd[k] = b[k];
      const { data, error } = await supabase.from('crm_ad_sources').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('ad_source', req.params.id, 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/ad-sources/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { error } = await supabase.from('crm_ad_sources').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('ad_source', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Clients ───────────────────────────────────────────────────────────────────
  r.get('/kviz/api/crm/clients', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_clients')
        .select('id,full_name,phone,birth_date,ad_source_id,profile_complete,status,fitbase_client_id,created_at,is_deleted')
        .eq('is_deleted', false).order('full_name');
      if (req.query.search) {
        const s = String(req.query.search);
        q = (q as any).or(`full_name.ilike.%${s}%,phone.ilike.%${s}%`);
      }
      if (req.query.ad_source_id)     q = q.eq('ad_source_id', req.query.ad_source_id as string);
      if (req.query.profile_complete === 'true')  q = q.eq('profile_complete', true);
      if (req.query.profile_complete === 'false') q = q.eq('profile_complete', false);
      if (req.query.status) q = q.eq('status', req.query.status as string);
      const limit  = Math.min(Number(req.query.limit ?? 100), 200);
      const offset = Number(req.query.offset ?? 0);
      q = q.range(offset, offset + limit - 1);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients/fitbase-import', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (fitbaseImportJob?.status === 'running') {
      res.status(409).json({ error: 'Импорт уже идёт', ...fitbaseImportJob }); return;
    }
    fitbaseImportJob = { status: 'running', total: 0, processed: 0, added: 0, updated: 0, skipped: 0, errors: [] };
    res.json({ status: 'started' });
    runFitbaseImport().catch(e => {
      if (fitbaseImportJob) { fitbaseImportJob.status = 'error'; fitbaseImportJob.errors.push(String(e)); }
    });
  });

  r.get('/kviz/api/crm/clients/fitbase-import/status', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!fitbaseImportJob) { res.json({ status: 'idle' }); return; }
    res.json(fitbaseImportJob);
  });

  r.post('/kviz/api/crm/clients', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.full_name) { res.status(400).json({ error: 'Укажите ФИО клиента' }); return; }
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
      const mergedForProfile = { full_name: b.full_name, phone, birth_date, iin,
        id_issued_by: b.id_issued_by, id_valid_until: b.id_valid_until,
        ad_source_id: b.ad_source_id, referrer_client_id: b.referrer_client_id };
      const profile_complete = await computeProfileComplete(mergedForProfile);
      const { data, error } = await supabase.from('crm_clients').insert({
        branch_id: BRANCH_ID, full_name: String(b.full_name).trim(), phone, iin,
        birth_date: birth_date ?? null, ad_source_id: b.ad_source_id ?? null,
        referrer_client_id: b.referrer_client_id ?? null,
        id_issued_by: b.id_issued_by ?? null, id_valid_until: b.id_valid_until ?? null,
        contraindications: b.contraindications ?? null, notes: b.notes ?? null,
        profile_complete, source: 'manual',
        status: 'active', is_deleted: false, created_by: session.display_name,
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
      if (data.iin && session.role !== 'admin') data.iin = data.iin.slice(0, 6) + '******';
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
        if (!b.phone) { upd.phone = null; } else {
          const p = normalizePhone(String(b.phone));
          if (!p) { res.status(400).json({ error: 'Неверный формат телефона' }); return; }
          const { data: dup } = await supabase.from('crm_clients').select('id')
            .eq('phone', p).eq('is_deleted', false).neq('id', req.params.id).maybeSingle();
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
      for (const k of ['birth_date', 'ad_source_id', 'referrer_client_id', 'id_issued_by', 'id_valid_until', 'contraindications', 'notes', 'status', 'is_deleted']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      // Compute profile_complete from merged state
      const { data: cur } = await supabase.from('crm_clients').select('full_name,phone,birth_date,iin,id_issued_by,id_valid_until,ad_source_id,referrer_client_id').eq('id', req.params.id).single();
      if (cur) {
        const merged: Record<string, unknown> = { ...cur, ...upd };
        upd.profile_complete = await computeProfileComplete(merged);
      }
      const { data, error } = await supabase.from('crm_clients').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, b.is_deleted === true ? 'archive' : 'update', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/clients/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: client } = await supabase.from('crm_clients').select('photo_path').eq('id', req.params.id).single();
      if (client?.photo_path) {
        await supabase.storage.from('crm-client-photos').remove([client.photo_path]);
      }
      const { error } = await supabase.from('crm_clients').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, 'delete', session.display_name);
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
      await supabase.from('crm_clients').update({ photo_path: path, updated_at: new Date().toISOString() }).eq('id', req.params.id);
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

  // ── Recalculate profile_complete for all clients ───────────────────────────
  r.post('/kviz/api/crm/clients/recalculate-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const [{ data: clients }, { data: adSrcs }] = await Promise.all([
        supabase.from('crm_clients').select('id,full_name,phone,birth_date,iin,id_issued_by,id_valid_until,ad_source_id,referrer_client_id').eq('is_deleted', false),
        supabase.from('crm_ad_sources').select('id,requires_referrer'),
      ]);
      const srcMap = new Map((adSrcs || []).map((s: Record<string,unknown>) => [s.id, s.requires_referrer]));
      let updated = 0;
      for (const c of clients || []) {
        const ok = !!(c.full_name && c.phone && c.birth_date && c.iin && c.id_issued_by && c.id_valid_until && c.ad_source_id);
        const requiresRef = c.ad_source_id ? srcMap.get(c.ad_source_id) : false;
        const pc = ok && !(requiresRef && !c.referrer_client_id);
        await supabase.from('crm_clients').update({ profile_complete: pc }).eq('id', c.id);
        updated++;
      }
      res.json({ updated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Users (for manager dropdown) ─────────────────────────────────────────────
  r.get('/kviz/api/crm/users', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('app_users').select('id,display_name,role').order('display_name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Cash shifts ───────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/shifts/current', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_cash_shifts')
        .select('*').eq('branch_id', BRANCH_ID).eq('status', 'open').maybeSingle();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? null);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/shifts', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      // Only one open shift allowed
      const { data: existing } = await supabase.from('crm_cash_shifts')
        .select('id').eq('branch_id', BRANCH_ID).eq('status', 'open').maybeSingle();
      if (existing) { res.status(409).json({ error: 'Смена уже открыта' }); return; }

      const b = req.body as Record<string, unknown>;
      // Default opening_cash = counted_cash of last closed shift
      let opening_cash = 0;
      const { data: lastShift } = await supabase.from('crm_cash_shifts')
        .select('counted_cash').eq('branch_id', BRANCH_ID).eq('status', 'closed')
        .order('closed_at', { ascending: false }).limit(1).maybeSingle();
      if (lastShift) opening_cash = n0(lastShift.counted_cash);

      const overridden = b.opening_cash !== undefined && session.role === 'admin';
      if (overridden) opening_cash = n0(b.opening_cash);
      else if (b.opening_cash !== undefined && session.role !== 'admin') {
        res.status(403).json({ error: 'Изменять остаток на открытие может только администратор' }); return;
      }

      const { data, error } = await supabase.from('crm_cash_shifts').insert({
        branch_id: BRANCH_ID, shift_date: todayUtc5(),
        opened_by: session.display_name, opened_at: new Date().toISOString(),
        opening_cash, opening_cash_overridden: overridden, status: 'open',
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      if (overridden && b.override_reason) {
        await writeAudit('shift', data.id, `opening_cash_override: ${b.override_reason}`, session.display_name);
      }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/shifts/:id/close', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: shift } = await supabase.from('crm_cash_shifts').select('*').eq('id', req.params.id).single();
      if (!shift) { res.status(404).json({ error: 'Смена не найдена' }); return; }
      if (shift.status !== 'open') { res.status(409).json({ error: 'Смена уже закрыта' }); return; }

      // Get expected cash from RPC
      const { data: expected } = await supabase.rpc('crm_shift_expected_cash', { shift_id: req.params.id });
      const expected_cash = n0(expected);

      const b = req.body as Record<string, unknown>;
      if (b.counted_cash === undefined) { res.status(400).json({ error: 'Укажите фактическую сумму' }); return; }
      const counted_cash = n0(b.counted_cash);
      const difference = counted_cash - expected_cash;

      const { data, error } = await supabase.from('crm_cash_shifts').update({
        status: 'closed', closed_by: session.display_name, closed_at: new Date().toISOString(),
        expected_cash, counted_cash, difference,
        close_comment: b.comment ?? null,
      }).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('shift', req.params.id, 'close', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/shifts/:id/expected-cash', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.rpc('crm_shift_expected_cash', { shift_id: req.params.id });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ expected_cash: n0(data) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Cash movements ────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/shifts/:id/movements', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_cash_movements')
        .select('*').eq('shift_id', req.params.id).order('created_at');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/shifts/:id/movements', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.direction || !['in', 'out'].includes(String(b.direction))) {
        res.status(400).json({ error: 'direction должен быть "in" или "out"' }); return;
      }
      if (!b.amount || n0(b.amount) <= 0) { res.status(400).json({ error: 'Укажите сумму' }); return; }
      if (!b.comment || !String(b.comment).trim()) { res.status(400).json({ error: 'Комментарий обязателен' }); return; }
      // Check shift is open
      const { data: shift } = await supabase.from('crm_cash_shifts').select('status').eq('id', req.params.id).single();
      if (!shift || shift.status !== 'open') { res.status(409).json({ error: 'Смена не открыта' }); return; }

      const { data, error } = await supabase.from('crm_cash_movements').insert({
        shift_id: req.params.id, branch_id: BRANCH_ID,
        direction: b.direction, amount: n0(b.amount),
        comment: String(b.comment).trim(), created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Sales ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/shifts/:id/sales', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_sales')
        .select('id,number,client_id,cashier,manager,total_amount,discount_kind,status,created_at,crm_sale_payments(method_id,amount)')
        .eq('shift_id', req.params.id).order('created_at', { ascending: false });
      if (req.query.date_from) q = q.gte('created_at', req.query.date_from as string);
      if (req.query.date_to)   q = q.lte('created_at', req.query.date_to as string);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/sales', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const session = getSession(req)!;
      let q = supabase.from('crm_sales')
        .select('id,number,client_id,cashier,manager,total_amount,status,created_at,crm_sale_payments(method_id,amount)')
        .eq('branch_id', BRANCH_ID).order('created_at', { ascending: false }).limit(200);
      if (req.query.client_id) q = q.eq('client_id', req.query.client_id as string);
      // Non-admins only see their own shift (current open shift)
      if (session.role !== 'admin' && req.query.shift_id) q = q.eq('shift_id', req.query.shift_id as string);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/sales/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_sales')
        .select('*,crm_sale_items(*),crm_sale_payments(*)')
        .eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Продажа не найдена' }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Checkout ──────────────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/checkout', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const payload = { ...(req.body as Record<string, unknown>) };
      payload.cashier = session.display_name; // always override
      // Admin-only: discount kind 'admin'
      if (payload.discount_kind === 'admin' && session.role !== 'admin') {
        res.status(403).json({ error: 'Скидка администратора — только для администратора' }); return;
      }
      const { data, error } = await supabase.rpc('crm_checkout', { params: payload });
      if (error) { res.status(400).json({ error: translateRpcError(error.message) }); return; }
      await writeAudit('sale', String(data), 'checkout', session.display_name);
      res.json({ sale_id: data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Refund ────────────────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/refund', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const payload = { ...(req.body as Record<string, unknown>), created_by: session.display_name };
      const { data, error } = await supabase.rpc('crm_refund', { params: payload });
      if (error) { res.status(400).json({ error: translateRpcError(error.message) }); return; }
      await writeAudit('refund', String(data), 'refund', session.display_name);
      res.json({ refund_id: data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client balance & plans ────────────────────────────────────────────────────

  r.get('/kviz/api/crm/clients/:id/balance', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_client_balances')
        .select('deposit,bonus').eq('client_id', req.params.id).maybeSingle();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? { deposit: 0, bonus: 0 });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id/plans', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      // Trigger lifecycle update for this client's plans
      const today = todayUtc5();
      const { data: cps } = await supabase.from('crm_client_plans')
        .select('id,plan_id,status,planned_start_date,auto_activate_on,valid_until,extra_until,activated_at,purchase_date,freeze_used,crm_client_plan_items(*)')
        .eq('client_id', req.params.id).order('purchase_date', { ascending: false });

      for (const cp of cps || []) {
        if (cp.status === 'not_activated') {
          const shouldActivate = (cp.planned_start_date && cp.planned_start_date <= today)
            || (cp.auto_activate_on && cp.auto_activate_on <= today);
          if (shouldActivate) {
            const startDate = cp.planned_start_date || today;
            const { data: plan } = await supabase.from('crm_plans')
              .select('validity_days,extra_days').eq('id', cp.plan_id).single();
            if (plan) {
              const validUntil = plan.validity_days ? addDays(startDate, plan.validity_days - 1) : null;
              const extraUntil = validUntil && plan.extra_days ? addDays(validUntil, plan.extra_days) : null;
              await supabase.from('crm_client_plans').update({
                status: 'active', activated_at: startDate, valid_until: validUntil, extra_until: extraUntil,
              }).eq('id', cp.id);
              cp.status = 'active'; cp.activated_at = startDate; cp.valid_until = validUntil; cp.extra_until = extraUntil;
            }
          }
        } else if (cp.status === 'active') {
          const deadline = cp.extra_until || cp.valid_until;
          if (deadline && today > deadline) {
            await supabase.from('crm_client_plans').update({ status: 'expired' }).eq('id', cp.id);
            cp.status = 'expired';
          }
        }
      }

      // Join with plan names
      const planIds = [...new Set((cps || []).map(cp => cp.plan_id))];
      const { data: plans } = planIds.length
        ? await supabase.from('crm_plans').select('id,name,kind').in('id', planIds)
        : { data: [] };
      const planMap = new Map((plans || []).map((p: Record<string,unknown>) => [p.id, p]));

      res.json((cps || []).map(cp => ({ ...cp, plan: planMap.get(cp.plan_id) ?? null })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id/balance-ops', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_balance_ops')
        .select('*').eq('client_id', req.params.id)
        .order('created_at', { ascending: false }).limit(50);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients/:id/balance-ops', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.wallet || !['deposit', 'bonus'].includes(String(b.wallet))) {
        res.status(400).json({ error: 'wallet должен быть "deposit" или "bonus"' }); return;
      }
      if (!b.direction || !['in', 'out'].includes(String(b.direction))) {
        res.status(400).json({ error: 'direction должен быть "in" или "out"' }); return;
      }
      if (!b.amount || n0(b.amount) <= 0) { res.status(400).json({ error: 'Укажите сумму' }); return; }
      if (!b.reason || !String(b.reason).trim()) { res.status(400).json({ error: 'Причина обязательна' }); return; }
      const { data, error } = await supabase.from('crm_balance_ops').insert({
        client_id: req.params.id, wallet: b.wallet, direction: b.direction,
        amount: n0(b.amount), reason: String(b.reason).trim(),
        created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('balance_op', data.id, `${b.direction} ${b.wallet}`, session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Promo validation ──────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/promo-codes/validate', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const code = String(b.code || '').toUpperCase().trim();
      if (!code) { res.status(400).json({ error: 'Укажите промокод' }); return; }
      const { data: promo, error } = await supabase.from('crm_promo_codes')
        .select('*').eq('code', code).maybeSingle();
      if (error || !promo) { res.status(404).json({ error: 'Промокод не найден' }); return; }
      if (!promo.is_active) { res.status(400).json({ error: 'Промокод неактивен' }); return; }
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        res.status(400).json({ error: 'Срок действия промокода истёк' }); return;
      }
      if (promo.max_uses && promo.uses_count >= promo.max_uses) {
        res.status(400).json({ error: 'Лимит использований промокода исчерпан' }); return;
      }
      if (promo.max_uses_per_client && b.client_id) {
        const { count } = await supabase.from('crm_promo_usages')
          .select('id', { count: 'exact', head: true })
          .eq('promo_code_id', promo.id).eq('client_id', b.client_id as string);
        if (count && count >= promo.max_uses_per_client) {
          res.status(400).json({ error: 'Вы уже использовали этот промокод' }); return;
        }
      }
      // Get applicable targets
      let targets: { target_type: string; target_id: string }[] = [];
      if (!promo.applies_to_all) {
        const { data: t } = await supabase.from('crm_promo_targets').select('target_type,target_id').eq('promo_id', promo.id);
        targets = t || [];
      }
      res.json({ id: promo.id, code: promo.code, discount_type: promo.discount_type, discount_value: promo.discount_value, applies_to_all: promo.applies_to_all, targets });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── CRM lifecycle (plan activation/expiry) ────────────────────────────────────

  r.post('/kviz/api/crm/lifecycle', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await runCrmLifecycle();
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
