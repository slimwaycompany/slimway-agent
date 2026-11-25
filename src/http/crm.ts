import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../db/supabase';
import { getSession, requireAuth, requireAdmin, getSessionWithPerms, can, requirePerm, windowSecret } from './auth';
import { startHistoryImport, runFitbaseHistoryImport, getHistoryImportJob, linkBodyClients, getLinkStats } from '../jobs/fitbaseHistoryImport';
import { batchAutoLabelsForDay, batchAutoLabelsToday } from '../core/clientAutoLabels';
import type { ClientExtraData } from '../core/clientAutoLabels';

const BRANCH_ID         = '00000000-0000-0000-0000-000000000001';
const GENERIC_CRM_ERROR = 'Ошибка кассы, сообщите администратору';

// ── Kassa token (extra auth layer, stored only in React state) ─────────────────

interface KassaTokenPayload {
  branch_id: string;
  mode: 'sales' | 'full' | 'master';
  user_id: string;
  user_login: string;
  issued_at: number;
  exp: number;
  kv: 1;
}

function makeKassaToken(p: Omit<KassaTokenPayload, 'exp' | 'kv'>): string {
  const payload: KassaTokenPayload = { ...p, exp: Math.floor(Date.now() / 1000) + 12 * 3600, kv: 1 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', windowSecret()).update('kassa.' + encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function parseKassaToken(token: string | undefined): KassaTokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', windowSecret()).update('kassa.' + encoded).digest('base64url');
  try {
    const eSig = Buffer.from(expected, 'base64url');
    const gSig = Buffer.from(sig, 'base64url');
    if (eSig.length !== gSig.length) return null;
    if (!crypto.timingSafeEqual(eSig, gSig)) return null;
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as KassaTokenPayload;
    if (data.exp <= Math.floor(Date.now() / 1000)) return null;
    if (data.kv !== 1) return null;
    return data;
  } catch { return null; }
}

// Returns mode on success, responds with 403 and returns null on failure.
// Pass allowedModes=[] to allow any mode.
function requireKassaToken(
  req: Request, res: Response,
  allowedModes: Array<'sales' | 'full' | 'master'> = []
): KassaTokenPayload | null {
  const token = req.headers['x-kassa-token'] as string | undefined;
  const payload = parseKassaToken(token);
  if (!payload) { res.status(403).json({ error: 'Требуется вход в кассу' }); return null; }
  if (allowedModes.length > 0 && !allowedModes.includes(payload.mode)) {
    res.status(403).json({ error: 'Недоступно в режиме продаж' }); return null;
  }
  return payload;
}
const VALID_PHASES   = new Set(['active', 'finishing']);
const VALID_STATUSES = new Set(['working', 'repair', 'disabled', 'broken']);
const VALID_PM_KIND  = new Set(['cash', 'cashless']);

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

async function inChunks<T>(
  ids: string[],
  fn: (chunk: string[]) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const CHUNK = 150;
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await fn(ids.slice(i, i + CHUNK));
    if (error) console.error('[inChunks]', error.message);
    if (data) results.push(...data);
  }
  return results;
}

let _cashPmIds: string[] | null = null;
async function getCashPmIds(): Promise<string[]> {
  if (_cashPmIds) return _cashPmIds;
  const { data } = await supabase.from('crm_payment_methods').select('id').in('kind', ['cash', 'cashless']);
  _cashPmIds = (data ?? []).map((m: Record<string,unknown>) => m.id as string);
  return _cashPmIds;
}
function maskPhone(p: string): string {
  return `+7 7•• ••• •• ${p.slice(-2)}`;
}
function n0(v: unknown): number { const x = Number(v); return isNaN(x) ? 0 : x; }
function nNull(v: unknown): number | null { if (v === '' || v == null) return null; const x = Number(v); return isNaN(x) ? null : x; }
function normSocial(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.replace(/^https?:\/\/[^/]+\//i, '').replace(/^@/, '').split('?')[0].replace(/\/$/, '') || null;
}

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
  BAD_PAYMENT_METHOD:        'Недопустимый способ оплаты',
  BAD_QTY:                   'Неверное количество',
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
  console.error('[crm rpc] unhandled error:', msg);
  return GENERIC_CRM_ERROR;
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
    const { data: cache } = await supabase.from('fitbase_clients_cache').select('fitbase_client_id,phone,name').limit(10000);
    job.total = (cache || []).length;

    const { data: existing } = await supabase.from('crm_clients')
      .select('id,fitbase_client_id,phone').eq('is_deleted', false).limit(10000);
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

async function batchEnrich(
  clients: Record<string,unknown>[],
  opts?: {
    adSourceMap?: Map<string,string>;
    preLtv?: Map<string,number>;
    preDeposit?: Map<string,number>;
  }
): Promise<Record<string,unknown>[]> {
  if (!clients.length) return clients;
  const ids = clients.map(c => c.id as string);
  const todayStr = todayUtc5();

  // Round 1: all independent data in parallel
  const [vhRes, bkRes, plansRes, salesRes, balancesRes, tagLinksRes, bodyClientsRes] = await Promise.all([
    supabase.from('crm_visit_history').select('client_id,visit_at').eq('status','attended').in('client_id', ids),
    supabase.from('crm_bookings').select('client_id,booking_date').eq('status','attended').in('client_id', ids),
    supabase.from('crm_client_plans').select('client_id,name,plan_id,status,valid_until,sessions_left,sessions_total').in('client_id', ids).in('status', ['active','not_activated']),
    opts?.preLtv ? Promise.resolve({ data: [] as Record<string,unknown>[] }) : supabase.from('crm_sales').select('id,client_id').in('client_id', ids),
    opts?.preDeposit ? Promise.resolve({ data: [] as Record<string,unknown>[] }) : supabase.from('crm_client_balances').select('client_id,deposit').in('client_id', ids),
    supabase.from('crm_client_tag_links').select('client_id,tag_id').in('client_id', ids),
    supabase.from('body_clients').select('id,crm_client_id').in('crm_client_id', ids),
  ]);

  const visitCountMap = new Map<string,number>();
  const lastVisitMap = new Map<string,string>();
  for (const v of (vhRes.data ?? []) as Record<string,unknown>[]) {
    const id = v.client_id as string;
    visitCountMap.set(id, (visitCountMap.get(id) ?? 0) + 1);
    const lv = lastVisitMap.get(id);
    if (!lv || (v.visit_at as string) > lv) lastVisitMap.set(id, v.visit_at as string);
  }
  for (const b of (bkRes.data ?? []) as Record<string,unknown>[]) {
    const id = b.client_id as string;
    visitCountMap.set(id, (visitCountMap.get(id) ?? 0) + 1);
    const lv = lastVisitMap.get(id);
    if (!lv || (b.booking_date as string) > lv) lastVisitMap.set(id, b.booking_date as string);
  }

  const plansData = (plansRes.data ?? []) as Record<string,unknown>[];
  const planIds = [...new Set(plansData.map(p => p.plan_id as string).filter(Boolean))];
  const saleRows = (salesRes.data ?? []) as Record<string,unknown>[];
  const saleIds = saleRows.map(s => s.id as string);
  const tagLinks = (tagLinksRes.data ?? []) as Record<string,unknown>[];
  const allTagIds = [...new Set(tagLinks.map(l => l.tag_id as string))];
  const bodyClientRows = (bodyClientsRes.data ?? []) as Record<string,unknown>[];
  const bodyClientIds = bodyClientRows.map(b => b.id as string);
  const pmIds = opts?.preLtv ? [] : await getCashPmIds();

  // Round 2: dependent data in parallel
  const [planNamesRes, salePayRes, refundIdsRes, tagRowsRes, bodyMeasRes] = await Promise.all([
    planIds.length ? supabase.from('crm_plans').select('id,name').in('id', planIds) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    saleIds.length && pmIds.length ? supabase.from('crm_sale_payments').select('sale_id,amount').in('sale_id', saleIds).in('payment_method_id', pmIds) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    saleIds.length ? supabase.from('crm_refunds').select('id,sale_id').in('sale_id', saleIds) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    allTagIds.length ? supabase.from('crm_client_tags').select('id,name,color').in('id', allTagIds).eq('is_active', true) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    bodyClientIds.length ? supabase.from('body_measurements').select('client_id,measured_at').in('client_id', bodyClientIds).order('measured_at', { ascending: false }) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
  ]);

  // Round 3: refund payments
  const refundRows = (refundIdsRes.data ?? []) as Record<string,unknown>[];
  const refundIds = refundRows.map(r => r.id as string);
  let refPayData: Record<string,unknown>[] = [];
  if (refundIds.length && pmIds.length) {
    const { data: rfp } = await supabase.from('crm_refund_payments').select('refund_id,amount').in('refund_id', refundIds).in('payment_method_id', pmIds);
    refPayData = (rfp ?? []) as Record<string,unknown>[];
  }

  // ── Build lookup maps ──────────────────────────────────────────────────────
  const planNameMap = new Map<string,string>();
  for (const pn of (planNamesRes.data ?? []) as Record<string,unknown>[]) planNameMap.set(pn.id as string, pn.name as string);

  const plansByClient = new Map<string, Record<string,unknown>[]>();
  for (const p of plansData) {
    const cid = p.client_id as string;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p);
  }

  // LTV
  let ltvByClient: Map<string,number>;
  if (opts?.preLtv) {
    ltvByClient = opts.preLtv;
  } else {
    const clientBySaleId = new Map<string,string>(saleRows.map(s => [s.id as string, s.client_id as string]));
    const salesAmtByClient = new Map<string,number>();
    for (const p of (salePayRes.data ?? []) as Record<string,unknown>[]) {
      const cid = clientBySaleId.get(p.sale_id as string);
      if (cid) salesAmtByClient.set(cid, (salesAmtByClient.get(cid) ?? 0) + Number(p.amount ?? 0));
    }
    const clientByRefundId = new Map<string,string>(refundRows.map(r => [r.id as string, clientBySaleId.get(r.sale_id as string) ?? '']));
    const refundAmtByClient = new Map<string,number>();
    for (const p of refPayData) {
      const cid = clientByRefundId.get(p.refund_id as string);
      if (cid) refundAmtByClient.set(cid, (refundAmtByClient.get(cid) ?? 0) + Number(p.amount ?? 0));
    }
    ltvByClient = new Map(ids.map(id => [id, (salesAmtByClient.get(id) ?? 0) - (refundAmtByClient.get(id) ?? 0)]));
  }

  // Deposit
  const depositByClient: Map<string,number> = opts?.preDeposit ?? new Map(
    (balancesRes.data as Record<string,unknown>[] ?? []).map((b: Record<string,unknown>) => [b.client_id as string, Number(b.deposit ?? 0)])
  );

  // Personal tags
  const tagById = new Map<string,{id:string;name:string;color:string}>();
  for (const t of (tagRowsRes.data ?? []) as Record<string,unknown>[]) tagById.set(t.id as string, t as {id:string;name:string;color:string});
  const personalTagsByClient = new Map<string,{id:string;name:string;color:string}[]>();
  for (const link of tagLinks) {
    const cid = link.client_id as string;
    const tag = tagById.get(link.tag_id as string);
    if (!tag) continue;
    if (!personalTagsByClient.has(cid)) personalTagsByClient.set(cid, []);
    personalTagsByClient.get(cid)!.push(tag);
  }

  // Auto labels (replaces manual system_tags computation from task 86)
  const extrasMap = new Map<string, ClientExtraData>(
    clients.map(c => [c.id as string, { profile_complete: c.profile_complete as boolean, birth_date: c.birth_date as string | null }])
  );
  const autoLabelsMap = await batchAutoLabelsToday(ids, extrasMap);

  return clients.map(c => {
    const cid = c.id as string;
    const last_visit_at = lastVisitMap.get(cid) ?? null;
    const days_since_visit = last_visit_at
      ? Math.floor((new Date(todayStr+'T00:00:00+05:00').getTime() - new Date(last_visit_at.slice(0,10)+'T00:00:00+05:00').getTime()) / 86400000)
      : null;

    const activePlans = (plansByClient.get(cid) ?? []).sort((a: Record<string,unknown>, b: Record<string,unknown>) => {
      if (!a.valid_until) return 1; if (!b.valid_until) return -1;
      return (a.valid_until as string) < (b.valid_until as string) ? -1 : 1;
    });
    const mp = activePlans[0] ?? null;
    const plan_name = mp ? ((mp.name as string | null) ?? planNameMap.get(mp.plan_id as string) ?? null) : null;
    const extra_plans_count = activePlans.length > 1 ? activePlans.length - 1 : 0;
    const sessions_summary = mp?.sessions_left != null
      ? (mp.sessions_total != null ? `${mp.sessions_left}/${mp.sessions_total}` : String(mp.sessions_left))
      : null;

    return {
      ...c,
      last_visit_at,
      days_since_visit,
      plan_name,
      extra_plans_count,
      sessions_summary,
      personal_tags: personalTagsByClient.get(cid) ?? [],
      ltv: ltvByClient.get(cid) ?? 0,
      deposit: depositByClient.get(cid) ?? 0,
      source_name: c.ad_source_id ? (opts?.adSourceMap?.get(c.ad_source_id as string) ?? null) : null,
      auto_labels: autoLabelsMap.get(c.id as string) ?? [],
    };
  });
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
      if (b.grid_step_minutes !== undefined) {
        const v = n0(b.grid_step_minutes);
        if (v < 10 || v > 180) { res.status(400).json({ error: 'Шаг сетки: 10–180 мин' }); return; }
        upd.grid_step_minutes = v;
      }
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
        .select('*').eq('branch_id', BRANCH_ID).eq('is_virtual', false).order('type_code').order('number');
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

  async function validateItems(items: unknown[]): Promise<string | null> {
    let poolCount = 0;
    const allCodes: string[] = [];
    for (const it of items as Record<string, unknown>[]) {
      const hasCode = typeof it.device_type_code === 'string' && it.device_type_code.trim().length > 0;
      const hasCodes = Array.isArray(it.device_type_codes) && (it.device_type_codes as unknown[]).length >= 2;
      if (hasCode && hasCodes) return 'Строка не может содержать и аппарат, и пул одновременно';
      if (!hasCode && !hasCodes) return 'Выберите тип аппарата или настройте пул (≥ 2 аппаратов)';
      if (hasCodes) {
        poolCount++;
        if (poolCount > 1) return 'В абонементе допустим только один пул';
        if (!VALID_PHASES.has(String(it.phase))) return 'Укажите фазу пула Cross';
        for (const c of it.device_type_codes as string[]) allCodes.push(c);
      } else {
        if (!VALID_PHASES.has(String(it.phase))) return 'Укажите фазу для каждой позиции';
        allCodes.push(String(it.device_type_code));
      }
      if (!it.is_unlimited) {
        if (!it.sessions || Number(it.sessions) < 1) return 'Укажите количество сеансов (не менее 1)';
      }
      if (it.daily_limit !== undefined && it.daily_limit !== null && Number(it.daily_limit) <= 0) {
        return 'Лимит в день должен быть > 0';
      }
    }
    const seen = new Set<string>();
    for (const c of allCodes) {
      if (seen.has(c)) return `Аппарат ${c} встречается несколько раз в составе`;
      seen.add(c);
    }
    if (allCodes.length > 0) {
      const { data } = await supabase.from('crm_device_types').select('code').in('code', allCodes);
      const validSet = new Set((data || []).map((d: Record<string,unknown>) => d.code as string));
      for (const c of allCodes) {
        if (!validSet.has(c)) return `Неизвестный тип аппарата: ${c}`;
      }
    }
    return null;
  }

  function validateRestriction(b: Record<string, unknown>): string | null {
    if (Array.isArray(b.allowed_weekdays) && (b.allowed_weekdays as number[]).length === 0) {
      return 'Выберите хотя бы один день недели';
    }
    const hasFrom = !!(b.time_from && String(b.time_from).trim());
    const hasTo   = !!(b.time_to   && String(b.time_to).trim());
    if (hasFrom !== hasTo) return 'Укажите и «с», и «до» для ограничения по времени';
    if (hasFrom && hasTo && String(b.time_from).slice(0,5) >= String(b.time_to).slice(0,5)) {
      return '«До» должно быть позже «с»';
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
      const itemErr = await validateItems(items);
      if (itemErr) { res.status(400).json({ error: itemErr }); return; }
      const restrictErr = validateRestriction(b);
      if (restrictErr) { res.status(400).json({ error: restrictErr }); return; }

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
        allowed_weekdays: Array.isArray(b.allowed_weekdays) ? (b.allowed_weekdays as number[]).slice().sort((a,b)=>a-b) : null,
        time_from: b.time_from ? String(b.time_from).slice(0,5) : null,
        time_to: b.time_to ? String(b.time_to).slice(0,5) : null,
      }).select().single();
      if (planErr) { res.status(500).json({ error: planErr.message }); return; }

      if (items.length > 0) {
        const rows = items.map((it, i) => {
          const isPool = Array.isArray(it.device_type_codes) && (it.device_type_codes as unknown[]).length >= 2;
          return {
            plan_id: plan.id,
            device_type_code: isPool ? null : it.device_type_code,
            device_type_codes: isPool ? it.device_type_codes : null,
            phase: String(it.phase),
            sessions: n0(it.sessions),
            is_unlimited: Boolean(it.is_unlimited),
            daily_limit: it.daily_limit != null ? Number(it.daily_limit) : null,
            sort: i,
          };
        });
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
      if (b.allowed_weekdays !== undefined) {
        const restrictErr = validateRestriction(b);
        if (restrictErr) { res.status(400).json({ error: restrictErr }); return; }
        upd.allowed_weekdays = Array.isArray(b.allowed_weekdays) && (b.allowed_weekdays as number[]).length > 0
          ? (b.allowed_weekdays as number[]).slice().sort((a,b)=>a-b) : null;
        upd.time_from = b.time_from ? String(b.time_from).slice(0,5) : null;
        upd.time_to   = b.time_to   ? String(b.time_to).slice(0,5)   : null;
      }

      const { data, error } = await supabase.from('crm_plans')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      if (Array.isArray(b.items)) {
        const items = b.items as Record<string, unknown>[];
        const itemErr = await validateItems(items);
        if (itemErr) { res.status(400).json({ error: itemErr }); return; }
        await supabase.from('crm_plan_items').delete().eq('plan_id', req.params.id);
        if (items.length > 0) {
          const rows = items.map((it, i) => {
            const isPool = Array.isArray(it.device_type_codes) && (it.device_type_codes as unknown[]).length >= 2;
            return {
              plan_id: req.params.id,
              device_type_code: isPool ? null : it.device_type_code,
              device_type_codes: isPool ? it.device_type_codes : null,
              phase: String(it.phase),
              sessions: n0(it.sessions),
              is_unlimited: Boolean(it.is_unlimited),
              daily_limit: it.daily_limit != null ? Number(it.daily_limit) : null,
              sort: i,
            };
          });
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
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const showPhone = can(session, 'clients.phone', 'view');
    const sortBy  = (req.query.sort as string) || 'last_visit';
    const sortDir = (req.query.dir  as string) === 'asc' ? 'asc' : 'desc';
    const minDays = req.query.min_days != null && req.query.min_days !== '' ? Number(req.query.min_days) : undefined;
    const limit   = Math.min(Number(req.query.limit ?? 100), 200);
    const offset  = Number(req.query.offset ?? 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyFilters(q: any): any {
      if (req.query.search) {
        const s = String(req.query.search);
        const digits = s.replace(/\D/g, '');
        const phoneFilter = digits.length >= 7 ? `phone.ilike.%${digits.slice(-10)}%` : `phone.ilike.%${s}%`;
        q = q.or(`full_name.ilike.%${s}%,${phoneFilter}`);
      }
      if (req.query.ad_source_id) q = q.eq('ad_source_id', req.query.ad_source_id as string);
      if (req.query.profile_complete === 'true')  q = q.eq('profile_complete', true);
      if (req.query.profile_complete === 'false') q = q.eq('profile_complete', false);
      if (req.query.status) q = q.eq('status', req.query.status as string);
      return q;
    }

    const ALL_SCAN_SORTS = new Set(['last_visit', 'days', 'days_without_visit', 'ltv', 'deposit', 'plan', 'sessions', 'source']);
    const DB_SORT_COLS: Record<string, string> = {
      name: 'full_name', created: 'created_at', birth: 'birth_date',
      profile: 'profile_complete', fitbase: 'fitbase_client_id',
    };

    try {
      const { data: adSrcRows } = await supabase.from('crm_ad_sources').select('id,name');
      const adSourceMap = new Map<string,string>((adSrcRows ?? []).map((s: Record<string,unknown>) => [s.id as string, s.name as string]));

      if (ALL_SCAN_SORTS.has(sortBy) || minDays != null) {
        // ── All-scan path ────────────────────────────────────────────────────
        const { data: allBase } = await (applyFilters(
          supabase.from('crm_clients').select('id,ad_source_id').eq('branch_id', BRANCH_ID).eq('is_deleted', false)
        ) as any).limit(10000);
        const allClients = (allBase ?? []) as Record<string,unknown>[];
        const allIds = allClients.map(c => c.id as string);
        if (!allIds.length) { res.json({ items: [], total: 0 }); return; }

        const todayStr = todayUtc5();
        let preLtv: Map<string,number> | undefined;
        let preDeposit: Map<string,number> | undefined;
        let sortKeyFn: (id: string) => number | string = () => 0;

        const needVisits = minDays != null || sortBy === 'last_visit' || sortBy === 'days' || sortBy === 'days_without_visit';
        const needLtv     = sortBy === 'ltv';
        const needDeposit = sortBy === 'deposit';
        const needPlan    = sortBy === 'plan' || sortBy === 'sessions';

        // Personal tag pre-filter
        const filterTagId = req.query.filter_tag as string | undefined;
        let filteredIds = allIds;
        if (filterTagId) {
          const tagClientData = await inChunks<Record<string,unknown>>(allIds, (chunk) =>
            supabase.from('crm_client_tag_links').select('client_id').eq('tag_id', filterTagId).in('client_id', chunk) as any
          );
          const tagSet = new Set(tagClientData.map(r => r.client_id as string));
          filteredIds = allIds.filter(id => tagSet.has(id));
          if (!filteredIds.length) { res.json({ items: [], total: 0 }); return; }
        }

        const [vhAll, bkAll, ltvSalesRows, depRows, planAllRows] = await Promise.all([
          needVisits ? inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
            supabase.from('crm_visit_history').select('client_id,visit_at').eq('status','attended').in('client_id', chunk) as any
          ) : Promise.resolve([]),
          needVisits ? inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
            supabase.from('crm_bookings').select('client_id,booking_date').eq('status','attended').in('client_id', chunk) as any
          ) : Promise.resolve([]),
          needLtv ? inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
            supabase.from('crm_sales').select('id,client_id').in('client_id', chunk) as any
          ) : Promise.resolve([]),
          needDeposit ? inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
            supabase.from('crm_client_balances').select('client_id,deposit').in('client_id', chunk) as any
          ) : Promise.resolve([]),
          needPlan ? inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
            (supabase.from('crm_client_plans').select('client_id,name,plan_id,sessions_left,valid_until').in('client_id', chunk).in('status', ['active','not_activated'])) as any
          ) : Promise.resolve([]),
        ]);

        const lastVisitAll = new Map<string,string>();
        if (needVisits) {
          for (const v of vhAll) {
            const lv = lastVisitAll.get(v.client_id as string);
            if (!lv || (v.visit_at as string) > lv) lastVisitAll.set(v.client_id as string, v.visit_at as string);
          }
          for (const b of bkAll) {
            const lv = lastVisitAll.get(b.client_id as string);
            if (!lv || (b.booking_date as string) > lv) lastVisitAll.set(b.client_id as string, b.booking_date as string);
          }
        }

        function dwDays(id: string): number {
          const lv = lastVisitAll.get(id);
          if (!lv) return 9999;
          return Math.floor((new Date(todayStr+'T00:00:00+05:00').getTime() - new Date(lv.slice(0,10)+'T00:00:00+05:00').getTime()) / 86400000);
        }

        if (needLtv) {
          const pmIds = await getCashPmIds();
          const salesRows = ltvSalesRows;
          const saleIds = salesRows.map(s => s.id as string);
          const clientBySaleId = new Map<string,string>(salesRows.map(s => [s.id as string, s.client_id as string]));
          const salesAmtByClient = new Map<string,number>();
          const refundAmtByClient = new Map<string,number>();
          if (saleIds.length && pmIds.length) {
            const [spRes, riRes] = await Promise.all([
              supabase.from('crm_sale_payments').select('sale_id,amount').in('sale_id', saleIds).in('payment_method_id', pmIds),
              supabase.from('crm_refunds').select('id,sale_id').in('sale_id', saleIds),
            ]);
            if (spRes.error) console.error('[clients/ltv] sale_payments error:', spRes.error.message);
            if (riRes.error) console.error('[clients/ltv] refunds error:', riRes.error.message);
            for (const p of (spRes.data ?? []) as Record<string,unknown>[]) {
              const cid = clientBySaleId.get(p.sale_id as string);
              if (cid) salesAmtByClient.set(cid, (salesAmtByClient.get(cid) ?? 0) + Number(p.amount ?? 0));
            }
            const refRows = (riRes.data ?? []) as Record<string,unknown>[];
            const refIds = refRows.map(r => r.id as string);
            const clientByRefId = new Map<string,string>(refRows.map(r => [r.id as string, clientBySaleId.get(r.sale_id as string) ?? '']));
            if (refIds.length) {
              const { data: rfp, error: rfpErr } = await supabase.from('crm_refund_payments').select('refund_id,amount').in('refund_id', refIds).in('payment_method_id', pmIds);
              if (rfpErr) console.error('[clients/ltv] refund_payments error:', rfpErr.message);
              for (const p of (rfp ?? []) as Record<string,unknown>[]) {
                const cid = clientByRefId.get(p.refund_id as string);
                if (cid) refundAmtByClient.set(cid, (refundAmtByClient.get(cid) ?? 0) + Number(p.amount ?? 0));
              }
            }
          }
          preLtv = new Map(filteredIds.map(id => [id, (salesAmtByClient.get(id) ?? 0) - (refundAmtByClient.get(id) ?? 0)]));
          sortKeyFn = id => preLtv!.get(id) ?? 0;
        } else if (needDeposit) {
          preDeposit = new Map(depRows.map((b: Record<string,unknown>) => [b.client_id as string, Number(b.deposit ?? 0)]));
          sortKeyFn = id => preDeposit!.get(id) ?? 0;
        } else if (needPlan) {
          const plansAll = planAllRows;
          const planIds = [...new Set(plansAll.map(p => p.plan_id as string).filter(Boolean))];
          const planNameMap = new Map<string,string>();
          if (planIds.length) {
            const { data: pns, error: pnsErr } = await supabase.from('crm_plans').select('id,name').in('id', planIds);
            if (pnsErr) console.error('[clients/plan] plans error:', pnsErr.message);
            for (const pn of (pns ?? []) as Record<string,unknown>[]) planNameMap.set(pn.id as string, pn.name as string);
          }
          const primaryPlan = new Map<string,Record<string,unknown>>();
          for (const p of plansAll) {
            const cid = p.client_id as string;
            const ex = primaryPlan.get(cid);
            if (!ex || (!p.valid_until && ex.valid_until) ||
                (p.valid_until && ex.valid_until && (p.valid_until as string) < (ex.valid_until as string))) {
              primaryPlan.set(cid, p);
            }
          }
          if (sortBy === 'plan') {
            sortKeyFn = id => {
              const p = primaryPlan.get(id);
              if (!p) return '￿';
              return ((p.name as string | null) ?? planNameMap.get(p.plan_id as string) ?? '￿').toLowerCase();
            };
          } else {
            sortKeyFn = id => primaryPlan.get(id)?.sessions_left as number ?? 9999;
          }
        } else if (sortBy === 'source') {
          const srcByClient = new Map<string,string>(allClients.map(c => [
            c.id as string,
            c.ad_source_id ? (adSourceMap.get(c.ad_source_id as string) ?? '￿').toLowerCase() : '￿',
          ]));
          sortKeyFn = id => srcByClient.get(id) ?? '￿';
        } else {
          // last_visit / days / days_without_visit
          sortKeyFn = id => dwDays(id);
        }

        // Auto-label filter (post-filter, runs batchAutoLabelsToday for filtered set)
        const filterAutoLabel = req.query.filter_auto_label as string | undefined;
        if (filterAutoLabel) {
          let extrasForFilter: Map<string, ClientExtraData> | undefined;
          if (filterAutoLabel === 'incomplete_profile' || filterAutoLabel === 'birthday') {
            const extrasData = await inChunks<Record<string,unknown>>(filteredIds, (chunk) =>
              supabase.from('crm_clients').select('id,profile_complete,birth_date').in('id', chunk) as any
            );
            extrasForFilter = new Map(extrasData.map(r => [r.id as string, { profile_complete: r.profile_complete as boolean, birth_date: r.birth_date as string | null }]));
          }
          const labelMap = await batchAutoLabelsToday(filteredIds, extrasForFilter);
          filteredIds = filteredIds.filter(id => (labelMap.get(id) ?? []).some(l => l.code === filterAutoLabel));
          if (!filteredIds.length) { res.json({ items: [], total: 0 }); return; }
        }

        let filtered = filteredIds;
        if (minDays != null) filtered = filteredIds.filter(id => dwDays(id) >= minDays!);

        const asc = sortDir === 'asc';
        filtered.sort((a, b) => {
          const ka = sortKeyFn(a), kb = sortKeyFn(b);
          if (ka < kb) return asc ? -1 : 1;
          if (ka > kb) return asc ? 1 : -1;
          return 0;
        });

        const count = filtered.length;
        const pageIds = filtered.slice(offset, offset + limit);
        if (!pageIds.length) { res.json({ items: [], total: count }); return; }

        const { data: pageData, error: pe } = await supabase.from('crm_clients')
          .select('id,full_name,phone,birth_date,ad_source_id,profile_complete,status,fitbase_client_id,created_at,is_deleted')
          .in('id', pageIds);
        if (pe) { res.status(500).json({ error: pe.message }); return; }
        const byId = new Map((pageData ?? []).map((c: Record<string,unknown>) => [c.id, c]));
        const orderedPage = pageIds.map(id => byId.get(id)).filter(Boolean) as Record<string,unknown>[];
        const enriched = await batchEnrich(orderedPage, { adSourceMap, preLtv, preDeposit });
        const items = showPhone ? enriched : enriched.map(c => ({ ...c, phone: c.phone ? maskPhone(c.phone as string) : null }));
        res.json({ items, total: count });
        return;
      }

      // ── DB sort path ───────────────────────────────────────────────────────
      const orderCol = DB_SORT_COLS[sortBy] ?? 'full_name';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from('crm_clients')
        .select('id,full_name,phone,birth_date,ad_source_id,profile_complete,status,fitbase_client_id,created_at,is_deleted', { count: 'exact' })
        .eq('branch_id', BRANCH_ID).eq('is_deleted', false).order(orderCol, { ascending: sortDir !== 'desc', nullsFirst: false });
      q = applyFilters(q);
      q = q.range(offset, offset + limit - 1);
      const { data, count, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      const enriched = await batchEnrich(data as Record<string,unknown>[] ?? [], { adSourceMap });
      const items = showPhone ? enriched : enriched.map(c => ({ ...c, phone: c.phone ? maskPhone(c.phone as string) : null }));
      res.json({ items, total: count ?? 0 });
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

  r.get('/kviz/api/crm/clients/junk-report', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: allClients } = await supabase.from('crm_clients')
        .select('id,full_name,phone,created_at').eq('branch_id', BRANCH_ID).eq('is_deleted', false).limit(10000);
      const junkRe = [/^[0-9+@_~]/, /заявка/i, /инст/i, /ватсап/i, /сайт/i, /клиент/i, /Тт/];
      const junk = ((allClients ?? []) as Record<string,unknown>[]).filter(c => junkRe.some(re => re.test(c.full_name as string)));
      if (!junk.length) { res.json({ total: 0, no_activity: 0, examples: [] }); return; }
      const junkIds = junk.map(c => c.id as string);
      const [salesRes, plansRes, visitsRes, bkRes] = await Promise.all([
        supabase.from('crm_sales').select('client_id').in('client_id', junkIds),
        supabase.from('crm_client_plans').select('client_id').in('client_id', junkIds),
        supabase.from('crm_visit_history').select('client_id').eq('status','attended').in('client_id', junkIds),
        supabase.from('crm_bookings').select('client_id').eq('status','attended').in('client_id', junkIds),
      ]);
      const hasActivity = new Set([
        ...(salesRes.data ?? []).map((r: Record<string,unknown>) => r.client_id as string),
        ...(plansRes.data ?? []).map((r: Record<string,unknown>) => r.client_id as string),
        ...(visitsRes.data ?? []).map((r: Record<string,unknown>) => r.client_id as string),
        ...(bkRes.data ?? []).map((r: Record<string,unknown>) => r.client_id as string),
      ]);
      const noActivity = junk.filter(c => !hasActivity.has(c.id as string));
      res.json({ total: junk.length, no_activity: noActivity.length, examples: junk.slice(0, 10).map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone, created_at: c.created_at })) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients/fill-fitbase-data', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: adSrcs } = await supabase.from('crm_ad_sources').select('id,name');
      const srcByName = new Map<string, string>();
      for (const s of adSrcs ?? []) srcByName.set(String(s.name).toLowerCase(), s.id as string);

      const { data: clients } = await supabase.from('crm_clients')
        .select('id,fitbase_client_id').eq('is_deleted', false).is('ad_source_id', null)
        .not('fitbase_client_id', 'is', null).limit(10000);
      const fitIds = (clients ?? []).map((c: Record<string,unknown>) => c.fitbase_client_id as string);
      if (!fitIds.length) { res.json({ updated: 0, not_found_sources: [] }); return; }

      const { data: leads } = await supabase.from('fitbase_leads')
        .select('client_fitbase_id,source').in('client_fitbase_id', fitIds.map(Number).filter(n => !isNaN(n))).limit(10000);
      const fitIdToSource = new Map<string, string>();
      for (const l of leads ?? []) {
        if (l.source && l.client_fitbase_id) fitIdToSource.set(String(l.client_fitbase_id), String(l.source));
      }

      const notFound: string[] = [];
      let updated = 0;
      for (const c of clients ?? []) {
        const src = fitIdToSource.get(String(c.fitbase_client_id));
        if (!src) continue;
        const srcId = srcByName.get(src.toLowerCase());
        if (!srcId) { if (!notFound.includes(src)) notFound.push(src); continue; }
        await supabase.from('crm_clients').update({ ad_source_id: srcId }).eq('id', c.id as string);
        updated++;
      }
      res.json({ updated, not_found_sources: notFound });
    } catch (e) { res.status(500).json({ error: String(e) }); }
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
        gender: (b.gender === 'male' ? 'male' : 'female'),
        instagram: normSocial(b.instagram), tiktok: normSocial(b.tiktok),
        email: !b.email ? null : String(b.email).trim().toLowerCase() || null,
        profile_complete, source: 'manual',
        status: 'active', is_deleted: false, created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', data.id, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/auto-labels', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const raw = String(req.query.ids ?? '');
      const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
      if (ids.length === 0) { res.json({}); return; }
      const labelsMap = await batchAutoLabelsToday(ids);
      const out: Record<string, unknown> = {};
      labelsMap.forEach((v, k) => { out[k] = v; });
      res.json(out);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const { data, error } = await supabase.from('crm_clients').select('*').eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Клиент не найден' }); return; }
      if (data.iin && !can(session, 'clients.documents', 'view')) data.iin = data.iin.slice(0, 6) + '******';
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
      if (b.gender !== undefined) {
        const g = b.gender === null || b.gender === '' ? null : String(b.gender);
        if (g && !['female', 'male'].includes(g)) { res.status(400).json({ error: 'Пол: female или male' }); return; }
        upd.gender = g;
      }
      if (b.instagram !== undefined) upd.instagram = normSocial(b.instagram);
      if (b.tiktok !== undefined) upd.tiktok = normSocial(b.tiktok);
      if (b.email !== undefined) upd.email = !b.email ? null : String(b.email).trim().toLowerCase() || null;
      for (const k of ['birth_date', 'ad_source_id', 'referrer_client_id', 'id_issued_by', 'id_valid_until', 'contraindications', 'notes', 'status', 'is_deleted', 'address', 'important_note', 'skirt_size']) {
        if (b[k] !== undefined) upd[k] = b[k];
      }
      // device_settings NOT NULL — never store null
      if (b.device_settings !== undefined) upd.device_settings = (b.device_settings && typeof b.device_settings === 'object') ? b.device_settings : {};
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
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'clients.delete', 'edit', session)) return;
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
        supabase.from('crm_clients').select('id,full_name,phone,birth_date,iin,id_issued_by,id_valid_until,ad_source_id,referrer_client_id').eq('is_deleted', false).limit(10000),
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
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.shift', 'edit', session)) return;
    if (!requireKassaToken(req, res)) return;
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
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.shift', 'edit', session)) return;
    if (!requireKassaToken(req, res)) return;
    try {
      const { data: shift } = await supabase.from('crm_cash_shifts').select('*').eq('id', req.params.id).single();
      if (!shift) { res.status(404).json({ error: 'Смена не найдена' }); return; }
      if (shift.status !== 'open') { res.status(409).json({ error: 'Смена уже закрыта' }); return; }

      // Get expected cash from RPC
      const { data: expected, error: expErr } = await supabase.rpc('crm_shift_expected_cash', { p_shift: req.params.id });
      if (expErr) { res.status(500).json({ error: 'Не удалось рассчитать ожидаемые наличные' }); return; }
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
      const { data, error } = await supabase.rpc('crm_shift_expected_cash', { p_shift: req.params.id });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ expected_cash: n0(data) });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Cash movements ────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/shifts/:id/movements', async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
    try {
      const { data, error } = await supabase.from('crm_cash_movements')
        .select('*').eq('shift_id', req.params.id).order('created_at');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/shifts/:id/movements', async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.type || !['in', 'out'].includes(String(b.type))) {
        res.status(400).json({ error: '"type" должен быть "in" или "out"' }); return;
      }
      if (!b.amount || n0(b.amount) <= 0) { res.status(400).json({ error: 'Укажите сумму' }); return; }
      if (!b.comment || !String(b.comment).trim()) { res.status(400).json({ error: 'Комментарий обязателен' }); return; }
      // Check shift is open
      const { data: shift } = await supabase.from('crm_cash_shifts').select('status').eq('id', req.params.id).single();
      if (!shift || shift.status !== 'open') { res.status(409).json({ error: 'Смена не открыта' }); return; }

      const { data, error } = await supabase.from('crm_cash_movements').insert({
        shift_id: req.params.id,
        type: b.type, amount: n0(b.amount),
        comment: String(b.comment).trim(), created_by: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Sales ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/shifts/:id/sales', async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
    try {
      let q = supabase.from('crm_sales')
        .select('id,number,client_id,cashier,manager,total,discount_kind,status,created_at,crm_sale_payments(payment_method_id,amount)')
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
        .select('id,number,client_id,cashier,manager,total,status,created_at,crm_sale_payments(payment_method_id,amount)')
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
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
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
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.sale', 'edit', session)) return;
    if (!requireKassaToken(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (b.discount_kind === 'admin' && session.role !== 'admin') {
        res.status(403).json({ error: 'Скидка администратора — только для администратора' }); return;
      }

      const rawItems = Array.isArray(b.items) ? b.items as Record<string, unknown>[] : [];
      const planIds    = rawItems.filter(it => it.item_type === 'plan').map(it => String(it.plan_id)).filter(Boolean);
      const productIds = rawItems.filter(it => it.item_type === 'product').map(it => String(it.product_id)).filter(Boolean);

      const [planRes, stockRes] = await Promise.all([
        planIds.length ? supabase.from('crm_plans').select('id,price').in('id', planIds) : { data: [] as any[], error: null },
        productIds.length ? supabase.from('crm_product_stock').select('product_id,retail_price').in('product_id', productIds) : { data: [] as any[], error: null },
      ]);
      const planPriceMap    = new Map((planRes.data || []).map((p: any) => [String(p.id), n0(p.price)]));
      const productPriceMap = new Map((stockRes.data || []).map((p: any) => [String(p.product_id), n0(p.retail_price)]));

      const items: Record<string, unknown>[] = [];
      for (const it of rawItems) {
        const itemType = String(it.item_type || '');
        if (itemType === 'plan') {
          const pid = String(it.plan_id || '');
          if (!planPriceMap.has(pid)) { res.status(400).json({ error: 'Абонемент недоступен для продажи' }); return; }
          const startDate = it.start_mode === 'date' ? (it.start_date || null) : null;
          items.push({ type: 'plan', plan_id: pid, qty: 1, unit_price: planPriceMap.get(pid), start_date: startDate });
        } else if (itemType === 'product') {
          const pid = String(it.product_id || '');
          if (!productPriceMap.has(pid)) { res.status(400).json({ error: 'Товар недоступен для продажи' }); return; }
          items.push({ type: 'product', product_id: pid, qty: Math.max(1, Math.round(n0(it.qty))), unit_price: productPriceMap.get(pid) });
        } else if (itemType === 'deposit') {
          const amount = n0(it.price);
          if (amount <= 0) { res.status(400).json({ error: 'Укажите сумму пополнения депозита' }); return; }
          items.push({ type: 'deposit', qty: 1, unit_price: amount });
        }
      }

      const rawPays = Array.isArray(b.payments) ? b.payments as Record<string, unknown>[] : [];
      const payments = rawPays
        .filter(p => p.method_id && Number(p.amount) > 0)
        .map(p => ({ method_id: Number(p.method_id), amount: Number(p.amount) }));

      const payload: Record<string, unknown> = {
        shift_id:             b.shift_id,
        client_id:            b.client_id ?? null,
        cashier:              session.display_name,
        manager:              b.manager ?? null,
        comment:              b.comment ?? null,
        discount_kind:        b.discount_kind ?? 'none',
        promo_code_id:        b.promo_code_id ?? null,
        admin_discount_type:  b.admin_discount_type ?? null,
        admin_discount_value: b.admin_discount_value ?? null,
        items,
        payments,
      };

      const { data, error } = await supabase.rpc('crm_checkout', { p: payload });
      if (error) {
        console.error('[checkout] rpc error:', error.message, JSON.stringify(payload));
        res.status(400).json({ error: translateRpcError(error.message) }); return;
      }
      const result = data as { sale_id: string; number: number; total: number };
      await writeAudit('sale', result.sale_id, 'checkout', session.display_name);

      // Fill price/sale_id/sold_by in resulting crm_client_plans
      const planItem = items.find(it => it.type === 'plan');
      if (planItem && payload.client_id) {
        const { data: saleItems } = await supabase.from('crm_sale_items')
          .select('plan_id,unit_price').eq('sale_id', result.sale_id).eq('item_type', 'plan');
        for (const si of (saleItems ?? []) as Record<string,unknown>[]) {
          if (!si.plan_id || !si.unit_price) continue;
          await supabase.from('crm_client_plans')
            .update({ price: Number(si.unit_price), sale_id: result.sale_id, sold_by: session.display_name })
            .eq('client_id', payload.client_id as string)
            .eq('plan_id', si.plan_id as string)
            .is('price', null);
        }
      }

      res.json(result);
    } catch (e) {
      console.error('[checkout] unexpected:', e);
      res.status(500).json({ error: GENERIC_CRM_ERROR });
    }
  });

  // ── Refund ────────────────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/refund', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.refunds', 'edit', session)) return;
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
    try {
      const b = req.body as Record<string, unknown>;
      const { data: openShift } = await supabase.from('crm_cash_shifts')
        .select('id').eq('branch_id', BRANCH_ID).eq('status', 'open').maybeSingle();
      if (!openShift) { res.status(409).json({ error: 'Нет открытой смены' }); return; }

      const rawItems = Array.isArray(b.items) ? b.items as Record<string, unknown>[] : [];
      const rawPays  = Array.isArray(b.payments) ? b.payments as Record<string, unknown>[] : [];

      const items = rawItems.map(it => ({
        sale_item_id: it.sale_item_id,
        qty:          Number(it.qty),
        amount:       Number(it.amount),
      }));
      const payments = rawPays
        .filter(p => p.method_id && Number(p.amount) > 0)
        .map(p => ({ method_id: Number(p.method_id), amount: Number(p.amount) }));

      const payload: Record<string, unknown> = {
        sale_id:    b.sale_id,
        shift_id:   openShift.id,
        reason:     b.reason ?? null,
        created_by: session.display_name,
        items,
        payments,
      };

      const { data, error } = await supabase.rpc('crm_refund', { p: payload });
      if (error) {
        console.error('[refund] rpc error:', error.message, JSON.stringify(payload));
        res.status(400).json({ error: translateRpcError(error.message) }); return;
      }
      const result = data as { refund_id: string; amount: number };
      await writeAudit('refund', result.refund_id, 'refund', session.display_name);
      res.json(result);
    } catch (e) {
      console.error('[refund] unexpected:', e);
      res.status(500).json({ error: GENERIC_CRM_ERROR });
    }
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
        .select('id,plan_id,source,name,status,planned_start_date,auto_activate_on,valid_until,extra_until,activated_at,purchased_at,freeze_days_used,sessions_total,sessions_left,needs_split,allowed_weekdays,time_from,time_to,price,sale_id,sold_by,crm_client_plan_items(*)')
        .eq('client_id', req.params.id).order('purchased_at', { ascending: false });

      for (const cp of cps || []) {
        if (cp.status === 'not_activated') {
          const shouldActivate = (cp.planned_start_date && cp.planned_start_date <= today)
            || (cp.auto_activate_on && cp.auto_activate_on <= today);
          if (shouldActivate && cp.plan_id) { // only auto-activate CRM plans with a valid plan_id
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

      // Join with plan names (only for plans with plan_id)
      const planIds = [...new Set((cps || []).map(cp => cp.plan_id).filter(Boolean))];
      const { data: plans } = planIds.length
        ? await supabase.from('crm_plans').select('id,name,kind,freeze_days,extra_days').in('id', planIds)
        : { data: [] };
      const planMap = new Map((plans || []).map((p: Record<string,unknown>) => [p.id, p]));

      res.json((cps || []).map(cp => ({ ...cp, plan: cp.plan_id ? (planMap.get(cp.plan_id) ?? null) : null })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id/visits', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const clientId = req.params.id;
      const limit = Math.min(Number(req.query.limit ?? 30), 100);
      const offset = Number(req.query.offset ?? 0);
      const status = req.query.status as string | undefined;

      const ATTENDED = ['attended'];
      const NO_SHOW  = ['no_show'];
      const CANCELLED = ['cancelled', 'late_cancel'];

      // Build status filter sets
      const bkStatuses =
        status === 'attended'  ? ATTENDED :
        status === 'no_show'   ? NO_SHOW :
        status === 'cancelled' ? CANCELLED :
        ['attended', 'no_show', 'cancelled', 'late_cancel'];

      const vhStatuses =
        status === 'attended'  ? ['attended'] :
        status === 'no_show'   ? ['no_show'] :
        status === 'cancelled' ? [] :
        ['attended', 'no_show'];

      const [bkRes, vhRes] = await Promise.all([
        supabase.from('crm_bookings')
          .select('id,booking_date,starts_at,status,device_type_code')
          .eq('client_id', clientId).in('status', bkStatuses)
          .order('booking_date', { ascending: false }).order('starts_at', { ascending: false }),
        vhStatuses.length
          ? supabase.from('crm_visit_history')
              .select('id,visit_at,status,training_name')
              .eq('client_id', clientId).in('status', vhStatuses)
              .order('visit_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (bkRes.error) console.error('[visits] bookings error', clientId, bkRes.error.message);
      if ((vhRes as { error: { message: string } | null }).error) console.error('[visits] visit_history error', clientId, (vhRes as { error: { message: string } }).error.message);

      const bkRows = ((bkRes.data ?? []) as Record<string,unknown>[]).map(r => ({
        id: r.id as string, source: 'crm' as const,
        date: r.booking_date as string, time: r.starts_at ? (r.starts_at as string).slice(11, 16) : null,
        status: r.status as string,
        label: r.device_type_code as string | null,
      }));
      const vhRows = (((vhRes as { data: Record<string,unknown>[] | null }).data) ?? []).map(r => ({
        id: r.id as string, source: 'fitbase' as const,
        date: (r.visit_at as string).slice(0, 10), time: (r.visit_at as string).slice(11, 16) || null,
        status: r.status as string,
        label: r.training_name as string | null,
      }));

      // Merge & sort by date+time desc
      const all = [...bkRows, ...vhRows].sort((a, b) => {
        const da = `${a.date}${a.time ?? '00:00'}`;
        const db = `${b.date}${b.time ?? '00:00'}`;
        return da < db ? 1 : da > db ? -1 : 0;
      });

      res.json({ items: all.slice(offset, offset + limit), total: all.length });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Visits by plan ────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/client-plans/:id/visits', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const planId = req.params.id;
      const { data, error } = await supabase.from('crm_bookings')
        .select('id,booking_date,starts_at,status,device_type_code')
        .eq('client_plan_id', planId)
        .in('status', ['attended', 'no_show', 'cancelled', 'late_cancel'])
        .order('booking_date', { ascending: false }).order('starts_at', { ascending: false })
        .limit(100);
      if (error) { console.error('[plan-visits]', planId, error.message); res.status(500).json({ error: 'Ошибка загрузки посещений' }); return; }
      res.json((data ?? []).map((r: Record<string,unknown>) => ({
        id: r.id, date: r.booking_date, time: r.starts_at ? (r.starts_at as string).slice(11, 16) : null,
        status: r.status, label: r.device_type_code,
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Plan freeze / unfreeze / split ────────────────────────────────────────────

  r.post('/kviz/api/crm/client-plans/:id/freeze', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const days = n0(b.days);
      if (!days || days < 1 || days > 365) { res.status(400).json({ error: 'Укажите дни заморозки (1–365)' }); return; }
      const { data: cp } = await supabase.from('crm_client_plans')
        .select('id,status,freeze_days_used,plan_id').eq('id', req.params.id).single();
      if (!cp) { res.status(404).json({ error: 'Абонемент не найден' }); return; }
      if (cp.status !== 'active') { res.status(400).json({ error: 'Можно заморозить только активный абонемент' }); return; }
      // Check limit unless admin
      if (cp.plan_id && session.role !== 'admin') {
        const { data: plan } = await supabase.from('crm_plans').select('freeze_days').eq('id', cp.plan_id).single();
        const maxFreeze = Number((plan as Record<string,unknown>)?.freeze_days ?? 0);
        const used = Number(cp.freeze_days_used ?? 0);
        if (days > maxFreeze - used) {
          res.status(400).json({ error: `Превышен лимит заморозки. Доступно: ${maxFreeze - used} дней` }); return;
        }
      }
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (!reason) { res.status(400).json({ error: 'Укажите причину заморозки' }); return; }
      const { data: cpFull } = await supabase.from('crm_client_plans').select('client_id').eq('id', req.params.id).single();
      const { error } = await supabase.rpc('crm_plan_freeze', { p_plan_id: req.params.id, p_days: days });
      if (error) { res.status(400).json({ error: translateRpcError(error.message) }); return; }
      if (cpFull?.client_id) {
        await supabase.from('crm_client_comments').insert({ client_id: cpFull.client_id, kind: 'freeze', text: reason, author: session.display_name });
      }
      await writeAudit('client_plan', req.params.id, `freeze:${days}d`, session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/client-plans/:id/unfreeze', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (!reason) { res.status(400).json({ error: 'Укажите причину разморозки' }); return; }
      const { data: cp } = await supabase.from('crm_client_plans')
        .select('id,status,client_id').eq('id', req.params.id).single();
      if (!cp) { res.status(404).json({ error: 'Абонемент не найден' }); return; }
      if (cp.status !== 'frozen') { res.status(400).json({ error: 'Абонемент не заморожен' }); return; }
      const { error } = await supabase.rpc('crm_plan_unfreeze', { p_plan_id: req.params.id });
      if (error) { res.status(400).json({ error: translateRpcError(error.message) }); return; }
      if (cp.client_id) {
        await supabase.from('crm_client_comments').insert({ client_id: cp.client_id, kind: 'unfreeze', text: reason, author: session.display_name });
      }
      await writeAudit('client_plan', req.params.id, 'unfreeze', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/client-plans/:id/split', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const items = Array.isArray(b.items) ? b.items as { device_type_code?: string; device_type_codes?: string[]; is_pool?: boolean; sessions: number; phase?: string }[] : [];
      if (!items.length) { res.status(400).json({ error: 'Укажите распределение по аппаратам' }); return; }
      const { data: cp } = await supabase.from('crm_client_plans')
        .select('id,sessions_left').eq('id', req.params.id).single();
      if (!cp) { res.status(404).json({ error: 'Абонемент не найден' }); return; }
      const totalSessions = items.reduce((s, i) => s + Number(i.sessions ?? 0), 0);
      if (totalSessions !== Number(cp.sessions_left ?? 0)) {
        res.status(400).json({ error: `Сумма (${totalSessions}) должна равняться остатку (${cp.sessions_left})` }); return;
      }
      const allCodes = items.flatMap(i => i.is_pool && i.device_type_codes ? i.device_type_codes : [i.device_type_code as string]);
      const seen = new Set<string>();
      for (const c of allCodes) {
        if (!c) continue;
        if (seen.has(c)) { res.status(400).json({ error: `Аппарат ${c} встречается несколько раз` }); return; }
        seen.add(c);
      }
      const { data: dtypes } = await supabase.from('crm_device_types').select('code').in('code', allCodes);
      const validCodes = new Set((dtypes ?? []).map((d: Record<string,unknown>) => d.code as string));
      for (const code of allCodes) {
        if (!validCodes.has(code)) { res.status(400).json({ error: `Неизвестный тип аппарата: ${code}` }); return; }
      }
      const inserts = items.map(i => i.is_pool && i.device_type_codes ? {
        client_plan_id: req.params.id,
        device_type_code: null,
        device_type_codes: i.device_type_codes,
        sessions_total: Number(i.sessions),
        sessions_left: Number(i.sessions),
        phase: VALID_PHASES.has(String(i.phase)) ? String(i.phase) : 'active',
      } : {
        client_plan_id: req.params.id,
        device_type_code: i.device_type_code,
        sessions_total: Number(i.sessions),
        sessions_left: Number(i.sessions),
        phase: i.phase ?? 'active',
      });
      const { error: insertErr } = await supabase.from('crm_client_plan_items').insert(inserts);
      if (insertErr) { res.status(500).json({ error: insertErr.message }); return; }
      await supabase.from('crm_client_plans').update({ needs_split: false }).eq('id', req.params.id);
      await writeAudit('client_plan', req.params.id, 'split', session.display_name);
      res.json({ ok: true });
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
    if (!requireKassaToken(req, res, ['full', 'master'])) return;
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
      const signedAmt = b.direction === 'out' ? -n0(b.amount) : n0(b.amount);
      const { data, error } = await supabase.from('crm_balance_ops').insert({
        client_id: req.params.id, wallet: b.wallet,
        amount: signedAmt, reason: String(b.reason).trim(),
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

  // ── Client tags ───────────────────────────────────────────────────────────────

  const SYSTEM_TAG_DEFS = [
    { id: 'new_client',          name: 'Новый клиент',            color: '#6366f1', is_system: true },
    { id: 'incomplete_profile',  name: 'Анкета неполная',         color: '#f59e0b', is_system: true },
    { id: 'subscription_ending', name: 'Абонемент заканчивается', color: '#ef4444', is_system: true },
    { id: 'measure_soon',        name: 'Замер скоро',             color: '#10b981', is_system: true },
    { id: 'measure_overdue',     name: 'Замер просрочен',         color: '#dc2626', is_system: true },
    { id: 'birthday',            name: 'День рождения',           color: '#ec4899', is_system: true },
  ];

  r.get('/kviz/api/crm/client-tags', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_client_tags')
        .select('id,name,color,is_active').eq('branch_id', BRANCH_ID).eq('is_active', true).order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json([...SYSTEM_TAG_DEFS, ...(data ?? [])]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/client-tags', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.client_tags', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name || !String(b.name).trim()) { res.status(400).json({ error: 'Укажите название' }); return; }
      if (b.color && !/^#[0-9a-fA-F]{6}$/.test(String(b.color))) { res.status(400).json({ error: 'Цвет: #RRGGBB' }); return; }
      const { data, error } = await supabase.from('crm_client_tags').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(),
        color: b.color ? String(b.color) : '#6366f1', is_active: true,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/client-tags/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.client_tags', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name !== undefined) upd.name = String(b.name).trim();
      if (b.color !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) { res.status(400).json({ error: 'Цвет: #RRGGBB' }); return; }
        upd.color = String(b.color);
      }
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_client_tags').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/client-tags/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.client_tags', 'edit', session)) return;
    try {
      const { count } = await supabase.from('crm_client_tag_links')
        .select('id', { count: 'exact', head: true }).eq('tag_id', req.params.id);
      if (count && count > 0) {
        res.status(400).json({ error: `Метка используется у ${count} клиентов. Сначала снимите её.` }); return;
      }
      const { error } = await supabase.from('crm_client_tags').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/clients/:id/tags', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data } = await supabase.from('crm_client_tag_links').select('tag_id').eq('client_id', req.params.id);
      const tagIds = (data ?? []).map((l: Record<string,unknown>) => l.tag_id as string);
      let tags: Record<string,unknown>[] = [];
      if (tagIds.length) {
        const { data: ts } = await supabase.from('crm_client_tags').select('id,name,color').in('id', tagIds).eq('is_active', true);
        tags = (ts ?? []) as Record<string,unknown>[];
      }
      res.json(tags);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients/:id/tags', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!can(session, 'clients.edit', 'edit') && session.role !== 'admin') {
      res.status(403).json({ error: 'Нет прав для добавления меток' }); return;
    }
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.tag_id) { res.status(400).json({ error: 'tag_id обязателен' }); return; }
      const { error } = await supabase.from('crm_client_tag_links').upsert(
        { client_id: req.params.id, tag_id: String(b.tag_id) }, { onConflict: 'client_id,tag_id' }
      );
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, `add_tag:${b.tag_id}`, session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/clients/:id/tags/:tagId', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!can(session, 'clients.edit', 'edit') && session.role !== 'admin') {
      res.status(403).json({ error: 'Нет прав для удаления меток' }); return;
    }
    try {
      const { error } = await supabase.from('crm_client_tag_links')
        .delete().eq('client_id', req.params.id).eq('tag_id', req.params.tagId);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client', req.params.id, `remove_tag:${req.params.tagId}`, session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client comments ───────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/clients/:id/comments', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_client_comments')
        .select('id,text,author,created_at,updated_at').eq('client_id', req.params.id)
        .order('created_at', { ascending: false }).limit(50);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/clients/:id/comments', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const text = String(b.text ?? '').trim();
      if (!text) { res.status(400).json({ error: 'Текст комментария обязателен' }); return; }
      const { data, error } = await supabase.from('crm_client_comments').insert({
        client_id: req.params.id, text, author: session.display_name,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/client-comments/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const text = String(b.text ?? '').trim();
      if (!text) { res.status(400).json({ error: 'Текст обязателен' }); return; }
      const { data: existing } = await supabase.from('crm_client_comments').select('author').eq('id', req.params.id).single();
      if ((existing as Record<string,unknown>)?.author !== session.display_name && session.role !== 'admin') {
        res.status(403).json({ error: 'Только свои комментарии' }); return;
      }
      const { data, error } = await supabase.from('crm_client_comments')
        .update({ text, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/client-comments/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const { data: existing } = await supabase.from('crm_client_comments').select('author').eq('id', req.params.id).single();
      if ((existing as Record<string,unknown>)?.author !== session.display_name && session.role !== 'admin') {
        res.status(403).json({ error: 'Только свои комментарии' }); return;
      }
      const { error } = await supabase.from('crm_client_comments').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client feed ───────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/clients/:id/feed', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const clientId = req.params.id;
      const kind = (req.query.kind as string) || 'all';
      const before = (req.query.before as string) || new Date().toISOString();
      const LIMIT = 30;
      const items: { id: string; kind: string; at: string; text: string; author: string; extra?: Record<string,unknown> }[] = [];

      if (kind === 'all' || kind === 'comments') {
        const { data: comments } = await supabase.from('crm_client_comments')
          .select('id,text,author,created_at').eq('client_id', clientId)
          .lt('created_at', before).order('created_at', { ascending: false }).limit(LIMIT);
        for (const c of (comments ?? []) as Record<string,unknown>[])
          items.push({ id: c.id as string, kind: 'comment', at: c.created_at as string, text: c.text as string, author: c.author as string });
      }
      if (kind === 'all' || kind === 'tasks') {
        const TASK_STATUS_RU: Record<string, string> = { open: 'Открыта', done: 'Выполнена', overdue: 'Просрочена', cancelled: 'Отменена' };
        const { data: tasks } = await supabase.from('crm_lead_tasks')
          .select('id,description,status,due_at,created_by,created_at').eq('client_id', clientId)
          .lt('created_at', before).order('created_at', { ascending: false }).limit(LIMIT);
        for (const t of (tasks ?? []) as Record<string,unknown>[])
          items.push({ id: t.id as string, kind: 'task', at: t.created_at as string, text: t.description as string,
            author: (t.created_by as string) ?? '—', extra: { status: TASK_STATUS_RU[t.status as string] ?? (t.status as string), due_at: t.due_at as string | null } });
      }
      if (kind === 'all' || kind === 'actions' || kind === 'log') {
        // Human-readable actions: freeze/unfreeze comments + audit log
        const { data: actions } = await supabase.from('crm_client_comments')
          .select('id,kind,text,author,created_at').eq('client_id', clientId)
          .in('kind', ['freeze', 'unfreeze', 'break', 'agreement'])
          .lt('created_at', before).order('created_at', { ascending: false }).limit(LIMIT);
        for (const c of (actions ?? []) as Record<string,unknown>[]) {
          const kindLabel: Record<string, string> = { freeze: '❄ Заморозка', unfreeze: '▶ Разморозка', break: '⚡ Разбивка', agreement: '📋 Договор' };
          items.push({ id: `act-${c.id as string}`, kind: 'action', at: c.created_at as string,
            text: `${kindLabel[c.kind as string] ?? c.kind}: ${c.text as string}`, author: c.author as string });
        }
        const { data: logs } = await supabase.from('crm_audit_log')
          .select('id,action,actor,created_at,details').eq('entity_type', 'client').eq('entity_id', clientId)
          .lt('created_at', before).order('created_at', { ascending: false }).limit(LIMIT);
        const ACTION_LABEL: Record<string, string> = {
          checkout: 'Продажа', refund: 'Возврат', 'plan.freeze': 'Заморозка абонемента',
          'plan.unfreeze': 'Разморозка абонемента', 'plan.split': 'Распределение абонемента',
          'client.edit': 'Редактирование анкеты',
        };
        for (const l of (logs ?? []) as Record<string,unknown>[]) {
          const label = ACTION_LABEL[l.action as string] ?? (l.action as string);
          items.push({ id: l.id as string, kind: kind === 'log' ? 'audit' : 'action',
            at: l.created_at as string, text: label, author: l.actor as string });
        }
      }

      items.sort((a, b) => b.at.localeCompare(a.at));
      res.json(items.slice(0, LIMIT));
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

  // ── Settings: classes ─────────────────────────────────────────────────────────

  const CLASSES_KEYS = ['schedule.day_start','schedule.day_end','lessons.early_cancel_minutes',
    'lessons.late_cancel_burns_session','lessons.no_show_burns_session','lessons.trial_minutes',
    'labels.renewal_sessions_left'];

  r.get('/kviz/api/crm/settings/classes', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'view', session)) return;
    try {
      const { data } = await supabase.from('crm_settings').select('key,value').in('key', CLASSES_KEYS);
      const out: Record<string, unknown> = {};
      for (const row of data || []) out[row.key as string] = row.value;
      res.json(out);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/kviz/api/crm/settings/classes', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const ds = b['schedule.day_start'] as string | undefined;
      const de = b['schedule.day_end']   as string | undefined;
      if (ds && !/^\d{2}:\d{2}$/.test(ds)) { res.status(400).json({ error: 'Неверный формат начала дня' }); return; }
      if (de && !/^\d{2}:\d{2}$/.test(de)) { res.status(400).json({ error: 'Неверный формат конца дня' }); return; }
      if (ds && de && ds >= de)             { res.status(400).json({ error: 'Начало дня должно быть раньше конца' }); return; }
      const ecm = b['lessons.early_cancel_minutes'];
      if (ecm !== undefined) {
        const v = Number(ecm);
        if (!Number.isInteger(v) || v < 0 || v > 10080) { res.status(400).json({ error: 'Минуты ранней отмены: 0–10080' }); return; }
      }
      const rsl = b['labels.renewal_sessions_left'];
      if (rsl !== undefined) {
        const v = Number(rsl);
        if (!Number.isInteger(v) || v < 0 || v > 20) { res.status(400).json({ error: 'Порог продления: 0–20' }); return; }
      }
      const keyMap: Record<string, unknown> = {
        'schedule.day_start':             ds !== undefined ? ds : undefined,
        'schedule.day_end':               de !== undefined ? de : undefined,
        'lessons.early_cancel_minutes':   ecm !== undefined ? Number(ecm) : undefined,
        'lessons.late_cancel_burns_session': b['lessons.late_cancel_burns_session'] !== undefined ? Boolean(b['lessons.late_cancel_burns_session']) : undefined,
        'lessons.no_show_burns_session':  b['lessons.no_show_burns_session'] !== undefined ? Boolean(b['lessons.no_show_burns_session']) : undefined,
        'lessons.trial_minutes':          b['lessons.trial_minutes'] !== undefined ? Number(b['lessons.trial_minutes']) : undefined,
        'labels.renewal_sessions_left':   rsl !== undefined ? Number(rsl) : undefined,
      };
      for (const [key, value] of Object.entries(keyMap)) {
        if (value === undefined) continue;
        await supabase.from('crm_settings').upsert({ key, value }, { onConflict: 'key' });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Booking labels ────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/booking-labels', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_booking_labels').select('*').order('sort').order('id');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/booking-labels', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название' }); return; }
      if (!b.color || !/^#[0-9a-fA-F]{6}$/.test(String(b.color))) { res.status(400).json({ error: 'Укажите цвет (#RRGGBB)' }); return; }
      const shortName = String(b.short_name ?? '').trim();
      if (!shortName) { res.status(400).json({ error: 'Укажите аббревиатуру (1–4 символа)' }); return; }
      if (shortName.length > 4) { res.status(400).json({ error: 'Аббревиатура не более 4 символов' }); return; }
      const { data, error } = await supabase.from('crm_booking_labels')
        .insert({ name: b.name, color: b.color, sort: n0(b.sort), short_name: shortName, is_active: true, is_system: false })
        .select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/booking-labels/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const { data: lbl } = await supabase.from('crm_booking_labels').select('is_system').eq('id', req.params.id).single();
      if (!lbl) { res.status(404).json({ error: 'Этикетка не найдена' }); return; }
      const upd: Record<string, unknown> = {};
      if (b.name !== undefined) upd.name = b.name;
      if (b.color !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) { res.status(400).json({ error: 'Цвет должен быть #RRGGBB' }); return; }
        upd.color = b.color;
      }
      if (b.sort !== undefined) upd.sort = n0(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      if (b.short_name !== undefined) {
        const sn = String(b.short_name).trim();
        if (sn.length > 4) { res.status(400).json({ error: 'Аббревиатура не более 4 символов' }); return; }
        upd.short_name = sn;
      }
      if (lbl.is_system && b.code !== undefined) { res.status(400).json({ error: 'Код системной этикетки нельзя менять' }); return; }
      const { data, error } = await supabase.from('crm_booking_labels').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/booking-labels/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'edit', session)) return;
    try {
      const { data: lbl } = await supabase.from('crm_booking_labels').select('is_system').eq('id', req.params.id).single();
      if (!lbl) { res.status(404).json({ error: 'Этикетка не найдена' }); return; }
      if (lbl.is_system) { res.status(409).json({ error: 'Системные этикетки удалять нельзя' }); return; }
      const { count } = await supabase.from('crm_booking_label_links').select('booking_id', { count: 'exact', head: true }).eq('label_id', req.params.id);
      if (count && count > 0) {
        const { error } = await supabase.from('crm_booking_labels').update({ is_active: false }).eq('id', req.params.id);
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.json({ ok: true, archived: true });
        return;
      }
      const { error } = await supabase.from('crm_booking_labels').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, archived: false });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Branch settings ───────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/branch', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.branch', 'view', session)) return;
    try {
      const [branchRes, hoursRes] = await Promise.all([
        supabase.from('crm_branches').select('*').eq('id', BRANCH_ID).single(),
        supabase.from('crm_branch_hours').select('*').eq('branch_id', BRANCH_ID).order('weekday'),
      ]);
      if (branchRes.error) { res.status(500).json({ error: branchRes.error.message }); return; }
      res.json({ branch: branchRes.data, hours: hoursRes.data || [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/kviz/api/crm/branch', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.branch', 'edit', session)) return;
    try {
      const { branch, hours } = req.body as { branch: Record<string, unknown>; hours?: unknown[] };
      const allowed = ['name','legal_name','bin','country','city','address','phone','timezone','currency','language','socials'];
      const branchUpd: Record<string, unknown> = {};
      for (const k of allowed) if (branch && k in branch) branchUpd[k] = branch[k];

      // Validations
      if (branchUpd.bin) {
        if (!/^\d{12}$/.test(String(branchUpd.bin))) {
          res.status(400).json({ error: 'БИН должен содержать 12 цифр' }); return;
        }
      }
      if (branchUpd.phone) {
        const ph = normalizePhone(String(branchUpd.phone));
        if (!ph) { res.status(400).json({ error: 'Неверный формат телефона' }); return; }
        branchUpd.phone = ph;
      }
      // NOT NULL fields — skip if empty/null
      for (const k of ['timezone', 'currency', 'language']) {
        if (!branchUpd[k]) delete branchUpd[k];
      }
      // socials: ensure object, never null
      if ('socials' in branchUpd) {
        branchUpd.socials = (branchUpd.socials && typeof branchUpd.socials === 'object') ? branchUpd.socials : {};
      }

      // Hours validation
      const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
      if (Array.isArray(hours)) {
        for (const h of hours) {
          const hr = h as Record<string, unknown>;
          if (hr.is_open && hr.open_time && hr.close_time) {
            if (String(hr.close_time) <= String(hr.open_time)) {
              const dn = DAY_NAMES[Number(hr.weekday) - 1] ?? '';
              res.status(400).json({ error: `Время закрытия должно быть позже открытия (${dn})` }); return;
            }
          }
        }
      }

      if (Object.keys(branchUpd).length > 0) {
        const { error } = await supabase.from('crm_branches').update(branchUpd).eq('id', BRANCH_ID);
        if (error) { console.error('[branch] update:', error); res.status(500).json({ error: 'Не удалось сохранить, попробуйте ещё раз' }); return; }
      }
      if (Array.isArray(hours)) {
        const rows = hours.map((h: unknown) => {
          const hr = h as Record<string, unknown>;
          return { branch_id: BRANCH_ID, weekday: Number(hr.weekday), is_open: Boolean(hr.is_open), open_time: hr.open_time || null, close_time: hr.close_time || null };
        });
        const { error } = await supabase.from('crm_branch_hours').upsert(rows, { onConflict: 'branch_id,weekday' });
        if (error) { console.error('[branch hours] upsert:', error); res.status(500).json({ error: 'Не удалось сохранить, попробуйте ещё раз' }); return; }
      }
      res.json({ ok: true });
    } catch (e) { console.error('[branch] put:', e); res.status(500).json({ error: 'Не удалось сохранить, попробуйте ещё раз' }); }
  });

  // ── Branch: special day exceptions ───────────────────────────────────────────

  r.get('/kviz/api/crm/branch/exceptions', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.branch', 'view', session)) return;
    try {
      const { data, error } = await supabase.from('crm_branch_hours_exceptions')
        .select('day,is_open,note').eq('branch_id', BRANCH_ID).order('day');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/branch/exceptions', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.branch', 'edit', session)) return;
    try {
      const { day, is_open, note } = req.body as Record<string, unknown>;
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) {
        res.status(400).json({ error: 'Неверный формат даты' }); return;
      }
      let conflict_count = 0;
      if (!is_open) {
        const { count } = await supabase.from('crm_bookings').select('id', { count: 'exact', head: true })
          .eq('branch_id', BRANCH_ID).eq('booking_date', String(day)).in('status', ['booked', 'confirmed', 'attended']);
        conflict_count = count ?? 0;
      }
      const { error } = await supabase.from('crm_branch_hours_exceptions')
        .upsert({ branch_id: BRANCH_ID, day: String(day), is_open: Boolean(is_open), note: note || null }, { onConflict: 'branch_id,day' });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, conflict_count });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/branch/exceptions/:day', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.branch', 'edit', session)) return;
    try {
      const { error } = await supabase.from('crm_branch_hours_exceptions')
        .delete().eq('branch_id', BRANCH_ID).eq('day', req.params.day);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: day view ────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/schedule/day', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const dateStr = String(req.query.date || todayUtc5());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { res.status(400).json({ error: 'Неверная дата' }); return; }

      const [settingsRows, deviceTypesRaw, devicesRaw, dayHoursRes, exRes] = await Promise.all([
        supabase.from('crm_settings').select('key,value').in('key', ['schedule.day_start','schedule.day_end']),
        supabase.from('crm_device_types').select('code,name,sort,grid_step_minutes').order('sort'),
        supabase.from('crm_devices').select('id,type_code,number,status,session_minutes,is_virtual').eq('branch_id', BRANCH_ID).not('status', 'eq', 'disabled').order('number'),
        supabase.rpc('crm_day_hours', { p_date: dateStr }),
        supabase.from('crm_branch_hours_exceptions').select('is_open,note').eq('branch_id', BRANCH_ID).eq('day', dateStr).maybeSingle(),
      ]);

      const settingsMap: Record<string, string> = {};
      for (const s of settingsRows.data || []) settingsMap[s.key as string] = s.value as string;
      const fallbackStart = settingsMap['schedule.day_start'] ?? '07:00';
      const fallbackEnd   = settingsMap['schedule.day_end']   ?? '22:00';

      const dh = Array.isArray(dayHoursRes.data) ? (dayHoursRes.data as Record<string,unknown>[])[0] : dayHoursRes.data as Record<string,unknown> | null;
      const is_open  = dh ? Boolean(dh.is_open) : true; // null row = no config = open
      // slice to HH:MM — Postgres time type may return HH:MM:SS
      const dayStart = ((dh?.open_time  as string | null) ?? fallbackStart).slice(0, 5);
      const dayEnd   = ((dh?.close_time as string | null) ?? fallbackEnd).slice(0, 5);
      const exRow = exRes.data as { is_open: boolean; note: string | null } | null;
      const special_day = exRow ? { is_open: exRow.is_open, note: exRow.note } : null;

      if (!is_open) {
        res.json({ date: dateStr, day_start: dayStart, day_end: dayEnd, now: new Date().toISOString(), blocks: [], bookings: [], is_open: false, special_day });
        return;
      }

      const realByType: Record<string, { id: string; number: string; status: string; session_minutes: number | null }[]> = {};
      const virtByType: Record<string, { id: string; number: string }[]> = {};
      for (const d of devicesRaw.data || []) {
        const isVirt = !!(d as Record<string,unknown>).is_virtual;
        if (isVirt) {
          if (!virtByType[d.type_code]) virtByType[d.type_code] = [];
          virtByType[d.type_code]!.push({ id: d.id, number: d.number });
        } else {
          if (!realByType[d.type_code]) realByType[d.type_code] = [];
          realByType[d.type_code]!.push({ id: d.id, number: d.number, status: d.status, session_minutes: d.session_minutes });
        }
      }

      const blocks = (deviceTypesRaw.data || [])
        .filter(dt => realByType[dt.code]?.length)
        .map(dt => ({
          type_code: dt.code, name: dt.name,
          grid_step_minutes: dt.grid_step_minutes ?? 40,
          devices: (realByType[dt.code] || []),
          virtual_devices: (virtByType[dt.code] || []),
        }));

      // Bookings for the day
      const { data: bookingsRaw } = await supabase.from('crm_bookings')
        .select('*').eq('branch_id', BRANCH_ID).eq('booking_date', dateStr);
      const bookingIds = (bookingsRaw || []).map((b: Record<string, unknown>) => b.id as string);

      const clientIdsForDay = [...new Set((bookingsRaw || []).map((b: Record<string,unknown>) => b.client_id as string).filter(Boolean))];

      // Parallel: clients, plans, items, booking-labels, client-tag-links
      const [clientsRes, plansRes, itemsRes, labelsRes, tagLinksRes] = await Promise.all([
        clientIdsForDay.length ? supabase.from('crm_clients').select('id,full_name,phone').in('id', clientIdsForDay) : Promise.resolve({ data: [] }),
        bookingIds.length ? supabase.from('crm_plans').select('id,name').in('id', [...new Set((bookingsRaw||[]).map((b:Record<string,unknown>) => b.plan_id as string).filter(Boolean))]) : Promise.resolve({ data: [] }),
        bookingIds.length ? supabase.from('crm_client_plan_items').select('id,sessions_left,sessions_total').in('id', (bookingsRaw||[]).map((b:Record<string,unknown>) => b.client_plan_item_id as string).filter(Boolean)) : Promise.resolve({ data: [] }),
        bookingIds.length ? supabase.from('crm_booking_label_links').select('booking_id,label_id,crm_booking_labels(id,name,color,sort,short_name)').in('booking_id', bookingIds) : Promise.resolve({ data: [] }),
        clientIdsForDay.length ? supabase.from('crm_client_tag_links').select('client_id,tag_id').in('client_id', clientIdsForDay) : Promise.resolve({ data: [] }),
      ]);

      const clientMap = new Map((clientsRes.data||[]).map((c:Record<string,unknown>) => [c.id, c]));
      const planMap   = new Map((plansRes.data||[]).map((p:Record<string,unknown>) => [p.id, p]));
      const itemMap   = new Map((itemsRes.data||[]).map((i:Record<string,unknown>) => [i.id, i]));
      const labelsMap: Record<string, unknown[]> = {};
      for (const ll of labelsRes.data || []) {
        const lid = (ll as Record<string,unknown>).booking_id as string;
        if (!labelsMap[lid]) labelsMap[lid] = [];
        const lbl = (ll as Record<string,unknown>).crm_booking_labels;
        if (lbl) labelsMap[lid].push(lbl);
      }

      // Build input list for auto-label computation
      const bookingsForLabel = (bookingsRaw || []).map((b: Record<string,unknown>) => {
        const item = b.client_plan_item_id ? (itemMap.get(b.client_plan_item_id as string) as Record<string,unknown> | undefined) : null;
        return {
          id: b.id as string,
          client_id: b.client_id as string,
          booking_date: b.booking_date as string,
          kind: b.kind as string,
          client_plan_id: b.client_plan_id as string | null,
          client_plan_item_id: b.client_plan_item_id as string | null,
          sessions_left: (item?.sessions_left as number | null) ?? null,
          starts_at: b.starts_at as string,
          status: b.status as string,
        };
      });

      // Collect unique tag ids to fetch tag details
      const tagIds = [...new Set((tagLinksRes.data || []).map((l: Record<string,unknown>) => l.tag_id as string))];

      // Second parallel: auto-labels + tag rows
      const [autoLabelsMap, tagRowsRes] = await Promise.all([
        batchAutoLabelsForDay(bookingsForLabel),
        tagIds.length ? supabase.from('crm_client_tags').select('id,name,color').in('id', tagIds).eq('is_active', true) : Promise.resolve({ data: [] as Record<string,unknown>[] }),
      ]);

      // Build client → tags map
      const tagRowMap = new Map<string, Record<string,unknown>>();
      for (const t of (tagRowsRes.data || []) as Record<string,unknown>[]) tagRowMap.set(t.id as string, t);
      const clientTagsMap = new Map<string, { id: string; name: string; color: string }[]>();
      for (const link of (tagLinksRes.data || []) as Record<string,unknown>[]) {
        const cid = link.client_id as string;
        const tag = tagRowMap.get(link.tag_id as string);
        if (!tag) continue;
        if (!clientTagsMap.has(cid)) clientTagsMap.set(cid, []);
        clientTagsMap.get(cid)!.push({ id: link.tag_id as string, name: tag.name as string, color: tag.color as string });
      }

      const bookings = (bookingsRaw || []).map((b: Record<string, unknown>) => {
        const item = b.client_plan_item_id ? itemMap.get(b.client_plan_item_id as string) : null;
        return {
          ...b,
          client: clientMap.get(b.client_id as string) ?? null,
          plan_name: b.plan_id ? (planMap.get(b.plan_id as string) as Record<string,unknown>)?.name ?? null : null,
          sessions_left: (item as Record<string,unknown> | null)?.sessions_left ?? null,
          sessions_total: (item as Record<string,unknown> | null)?.sessions_total ?? null,
          labels: (labelsMap[b.id as string] || []).sort((a: unknown, b: unknown) => ((a as Record<string,unknown>).sort as number) - ((b as Record<string,unknown>).sort as number)),
          auto_labels: autoLabelsMap.get(b.id as string) ?? [],
          client_tags: clientTagsMap.get(b.client_id as string) ?? [],
        };
      });

      const now = new Date().toISOString();
      res.json({ date: dateStr, day_start: dayStart, day_end: dayEnd, now, blocks, bookings, is_open: true, special_day });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: client upcoming bookings search ────────────────────────────────

  r.get('/kviz/api/crm/schedule/client-bookings', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const search = String(req.query.search || '').trim();
      if (search.length < 2) { res.json([]); return; }
      const digits = search.replace(/\D/g, '');
      let q = supabase.from('crm_clients').select('id,full_name,phone').eq('branch_id', BRANCH_ID).eq('is_deleted', false);
      q = digits.length >= 4
        ? q.or(`full_name.ilike.%${search}%,phone.ilike.%${digits}%`)
        : q.ilike('full_name', `%${search}%`);
      const { data: clients } = await q.limit(20);
      if (!clients?.length) { res.json([]); return; }
      const clientIds = clients.map((c: Record<string,unknown>) => c.id as string);
      const { data: bookings } = await supabase.from('crm_bookings')
        .select('id,booking_date,starts_at,device_type_code,client_id,status')
        .eq('branch_id', BRANCH_ID).in('client_id', clientIds)
        .gte('booking_date', todayUtc5()).in('status', ['booked', 'confirmed'])
        .order('starts_at').limit(10);
      const clientMap = new Map((clients || []).map((c: Record<string,unknown>) => [c.id as string, c]));
      res.json((bookings || []).map((b: Record<string,unknown>) => ({
        id: b.id, booking_date: b.booking_date, starts_at: b.starts_at,
        device_type_code: b.device_type_code, status: b.status,
        client: clientMap.get(b.client_id as string) ?? null,
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: client options ──────────────────────────────────────────────────

  r.get('/kviz/api/crm/schedule/client-options', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const clientId = req.query.client_id as string;
      if (!clientId) { res.status(400).json({ error: 'client_id обязателен' }); return; }

      const [plansRes, freeRes, bookedRes] = await Promise.all([
        supabase.from('crm_client_plans')
          .select('id,plan_id,status,valid_until,extra_until,activated_at,allowed_weekdays,time_from,time_to,crm_plans!plan_id(id,name),crm_client_plan_items(id,device_type_code,device_type_codes,phase,sessions_left,sessions_total,is_unlimited,daily_limit)')
          .eq('client_id', clientId).in('status', ['active','not_activated']),
        supabase.from('crm_plans').select('id,name').eq('kind','service').eq('is_free_booking',true).eq('is_active',true),
        supabase.from('crm_bookings').select('client_plan_item_id').eq('client_id', clientId).in('status',['booked','confirmed']).not('client_plan_item_id','is',null),
      ]);

      const bookedAhead: Record<string, number> = {};
      for (const b of bookedRes.data || []) {
        const iid = (b as Record<string,unknown>).client_plan_item_id as string;
        bookedAhead[iid] = (bookedAhead[iid] ?? 0) + 1;
      }

      const plans = (plansRes.data || []).map((cp: Record<string,unknown>) => ({
        ...cp,
        items: ((cp.crm_client_plan_items as Record<string,unknown>[]) || []).map((it: Record<string,unknown>) => ({
          ...it, booked_ahead: bookedAhead[it.id as string] ?? 0,
        })),
      }));

      res.json({ plans, free_services: freeRes.data || [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: free devices for a slot ────────────────────────────────────────

  r.get('/kviz/api/crm/schedule/free-devices', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const { type, date, time, exclude_group } = req.query as Record<string,string>;
      if (!type || !date || !time) { res.status(400).json({ error: 'type, date, time обязательны' }); return; }

      const { data: dt } = await supabase.from('crm_device_types').select('grid_step_minutes').eq('code', type).single();
      const step = (dt as Record<string,unknown>)?.grid_step_minutes as number ?? 40;
      const startMs = new Date(`${date}T${time}:00+05:00`).getTime();
      const endMs   = startMs + step * 60_000;

      const includeVirtual = req.query.include_virtual === '1';
      let devQ = supabase.from('crm_devices').select('id,number,status,session_minutes').eq('branch_id', BRANCH_ID).eq('type_code', type).eq('status', 'working');
      if (!includeVirtual) devQ = devQ.eq('is_virtual', false);
      const { data: devices } = await devQ;

      const startIso = new Date(startMs).toISOString();
      const endIso   = new Date(endMs).toISOString();
      const { data: busyBookings } = await supabase.from('crm_bookings')
        .select('device_id').in('status',['booked','confirmed','attended','no_show'])
        .eq('booking_date', date).eq('device_type_code', type)
        .gte('starts_at', startIso).lt('ends_at', endIso); // simplified overlap: same slot

      const busyDeviceIds = new Set((busyBookings || []).map((b:Record<string,unknown>) => b.device_id as string));
      // More precise overlap: ends_at > startIso AND starts_at < endIso
      const { data: busyOverlap } = await supabase.from('crm_bookings')
        .select('device_id').in('status',['booked','confirmed','attended','no_show'])
        .eq('device_type_code', type).lt('starts_at', endIso).gt('ends_at', startIso);
      const busyAll = new Set([...busyDeviceIds, ...(busyOverlap||[]).map((b:Record<string,unknown>) => b.device_id as string)]);
      if (exclude_group) {
        const { data: grpDevs } = await supabase.from('crm_bookings').select('device_id').eq('group_id', exclude_group);
        for (const g of grpDevs || []) busyAll.delete((g as Record<string,unknown>).device_id as string);
      }

      const free = (devices || []).filter((d:Record<string,unknown>) => !busyAll.has(d.id as string));
      res.json(free);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: suggest free slots ─────────────────────────────────────────────

  r.get('/kviz/api/crm/schedule/suggest', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const { client_plan_id, type, date, time } = req.query as Record<string,string>;
      if (!type || !date) { res.status(400).json({ error: 'type, date обязательны' }); return; }

      const [settingsRes, dtRes, dayHoursSugRes] = await Promise.all([
        supabase.from('crm_settings').select('key,value').in('key',['schedule.day_start','schedule.day_end']),
        supabase.from('crm_device_types').select('code,grid_step_minutes').eq('code', type).single(),
        supabase.rpc('crm_day_hours', { p_date: date }),
      ]);
      const sm: Record<string,string> = {};
      for (const s of settingsRes.data || []) sm[s.key as string] = s.value as string;
      const dhSug = Array.isArray(dayHoursSugRes.data) ? (dayHoursSugRes.data as Record<string,unknown>[])[0] : dayHoursSugRes.data as Record<string,unknown> | null;
      const dayStart = (dhSug?.open_time  as string | null) ?? sm['schedule.day_start'] ?? '07:00';
      const dayEnd   = (dhSug?.close_time as string | null) ?? sm['schedule.day_end']   ?? '22:00';
      const step = (dtRes.data as Record<string,unknown>)?.grid_step_minutes as number ?? 40;

      // Find finishing type (if plan has finishing item for another type)
      let finishingType: string | null = null;
      let finishingStep = 0;
      if (client_plan_id) {
        const { data: items } = await supabase.from('crm_client_plan_items')
          .select('device_type_code,phase,sessions_left').eq('client_plan_id', client_plan_id);
        const finItem = (items || []).find((i:Record<string,unknown>) => i.phase === 'finishing' && (i.sessions_left as number) > 0);
        if (finItem) {
          finishingType = (finItem as Record<string,unknown>).device_type_code as string;
          const { data: fdt } = await supabase.from('crm_device_types').select('grid_step_minutes').eq('code', finishingType).single();
          finishingStep = (fdt as Record<string,unknown>)?.grid_step_minutes as number ?? 40;
        }
      }

      function slotMins(t: string): number {
        const [h, m] = t.split(':').map(Number); return h * 60 + m;
      }
      function minsToStr(m: number): string {
        return String(Math.floor(m / 60)).padStart(2,'0') + ':' + String(m % 60).padStart(2,'0');
      }

      const [sh, em] = [slotMins(dayStart), slotMins(dayEnd)];
      const afterMins = time ? slotMins(time) : sh;

      // Collect slots for today and tomorrow
      const dates = [date];
      const tomorrow = new Date(date + 'T00:00:00Z');
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      dates.push(tomorrow.toISOString().slice(0,10));

      // Load bookings for both dates
      const { data: allBookings } = await supabase.from('crm_bookings')
        .select('device_id,device_type_code,client_id,starts_at,ends_at,status,group_id')
        .in('booking_date', dates)
        .in('status',['booked','confirmed','attended','no_show']);

      // Load working devices
      const typeCodes = [type, ...(finishingType ? [finishingType] : [])];
      const { data: allDevices } = await supabase.from('crm_devices')
        .select('id,type_code,number').eq('branch_id', BRANCH_ID).eq('status','working').in('type_code', typeCodes);

      const mainDevices = (allDevices || []).filter((d:Record<string,unknown>) => d.type_code === type);
      const finDevices  = finishingType ? (allDevices || []).filter((d:Record<string,unknown>) => d.type_code === finishingType) : [];

      function isBusy(devList: { id: string }[], startMs: number, endMs: number, clientId?: string): boolean {
        const slotStart = new Date(startMs).toISOString();
        const slotEnd   = new Date(endMs).toISOString();
        const devIds = new Set(devList.map(d => d.id));
        if (devIds.size === 0) return true; // no devices → can't book
        const busyDevIds = new Set<string>();
        for (const b of (allBookings || [])) {
          const bs = b as Record<string,unknown>;
          if (!devIds.has(bs.device_id as string)) continue;
          if ((bs.starts_at as string) < slotEnd && (bs.ends_at as string) > slotStart) {
            busyDevIds.add(bs.device_id as string);
          }
        }
        if (devIds.size === busyDevIds.size) return true; // all devices busy
        if (clientId && (allBookings || []).some((b:Record<string,unknown>) => {
          const bs = b as Record<string,unknown>;
          return bs.client_id === clientId && (bs.starts_at as string) < slotEnd && (bs.ends_at as string) > slotStart;
        })) return true;
        return false;
      }

      const suggestions: { date: string; time: string }[] = [];
      let clientId: string | undefined;
      let planWd: number[] | null = null;
      let planTf: string | null = null;
      let planTt: string | null = null;
      if (client_plan_id) {
        const { data: cp } = await supabase.from('crm_client_plans')
          .select('client_id,allowed_weekdays,time_from,time_to').eq('id', client_plan_id).single();
        if (cp) {
          clientId = (cp as Record<string,unknown>).client_id as string;
          planWd = (cp as Record<string,unknown>).allowed_weekdays as number[] | null;
          planTf = (cp as Record<string,unknown>).time_from as string | null;
          planTt = (cp as Record<string,unknown>).time_to   as string | null;
        }
      }

      outer: for (const d of dates) {
        // Skip dates that don't match plan weekday restriction
        if (planWd && planWd.length > 0 && planWd.length < 7) {
          const dow = new Date(d + 'T12:00:00').getDay();
          const wd  = dow === 0 ? 7 : dow;
          if (!planWd.includes(wd)) continue;
        }
        const isToday = d === date;
        const rStart = planTf ? Math.max(sh, slotMins(planTf.slice(0,5))) : sh;
        const rEnd   = planTt ? Math.min(em, slotMins(planTt.slice(0,5))) : em;
        for (let t = rStart; t + step <= rEnd; t += step) {
          if (isToday && t < afterMins + step) continue; // skip current and past slots
          const slotMs  = new Date(`${d}T${minsToStr(t)}:00+05:00`).getTime();
          const slotEndMs = slotMs + step * 60_000;
          if (isBusy(mainDevices, slotMs, slotEndMs, clientId)) continue;
          if (finishingType && finDevices.length) {
            const finMs    = slotEndMs;
            const finEndMs = finMs + finishingStep * 60_000;
            const dayEndMs = new Date(`${d}T${dayEnd}:00+05:00`).getTime();
            if (finEndMs > dayEndMs) continue;
            if (isBusy(finDevices, finMs, finEndMs, clientId)) continue;
          }
          suggestions.push({ date: d, time: minsToStr(t) });
          if (suggestions.length >= 3) break outer;
        }
      }

      res.json(suggestions);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: day notes ──────────────────────────────────────────────────────

  r.get('/kviz/api/crm/schedule/notes', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const { date } = req.query as Record<string, string>;
      if (!date) { res.status(400).json({ error: 'date обязателен' }); return; }
      const { data, error } = await supabase.from('crm_schedule_notes')
        .select('id,text,author,author_user_id,created_at,edited')
        .eq('branch_id', BRANCH_ID).eq('note_date', date).eq('is_deleted', false)
        .order('created_at', { ascending: true });
      if (error) { console.error('notes get:', error); res.status(500).json({ error: 'Не удалось загрузить заметки' }); return; }
      const userId = session.id;
      res.json((data || []).map(n => ({ ...n, can_edit: n.author_user_id === userId || session.role === 'admin' })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/schedule/notes', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const { date, text } = req.body as Record<string, string>;
      if (!date) { res.status(400).json({ error: 'date обязателен' }); return; }
      const trimmed = (text ?? '').trim();
      if (!trimmed) { res.status(400).json({ error: 'Напишите текст заметки' }); return; }
      if (trimmed.length > 1000) { res.status(400).json({ error: 'Заметка длиннее 1000 символов' }); return; }
      const { data, error } = await supabase.from('crm_schedule_notes').insert({
        branch_id: BRANCH_ID, note_date: date, text: trimmed,
        author: session.display_name, author_user_id: session.id,
      }).select().single();
      if (error) { console.error('notes post:', error); res.status(500).json({ error: 'Не удалось сохранить заметку' }); return; }
      await writeAudit('schedule_note', (data as Record<string,unknown>).id as string, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/schedule/notes/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const trimmed = ((req.body as Record<string, string>).text ?? '').trim();
      if (!trimmed) { res.status(400).json({ error: 'Напишите текст заметки' }); return; }
      if (trimmed.length > 1000) { res.status(400).json({ error: 'Заметка длиннее 1000 символов' }); return; }
      const { data: existing } = await supabase.from('crm_schedule_notes').select('author_user_id').eq('id', req.params.id).eq('is_deleted', false).single();
      if (!existing) { res.status(404).json({ error: 'Заметка не найдена' }); return; }
      if ((existing as Record<string,unknown>).author_user_id !== session.id && session.role !== 'admin') {
        res.status(403).json({ error: 'Можно изменить только свою заметку' }); return;
      }
      const { error } = await supabase.from('crm_schedule_notes').update({ text: trimmed, edited: true }).eq('id', req.params.id);
      if (error) { console.error('notes patch:', error); res.status(500).json({ error: 'Не удалось обновить заметку' }); return; }
      await writeAudit('schedule_note', req.params.id, 'update', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/schedule/notes/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.main', 'view', session)) return;
    try {
      const { data: existing } = await supabase.from('crm_schedule_notes').select('author_user_id').eq('id', req.params.id).eq('is_deleted', false).single();
      if (!existing) { res.status(404).json({ error: 'Заметка не найдена' }); return; }
      if ((existing as Record<string,unknown>).author_user_id !== session.id && session.role !== 'admin') {
        res.status(403).json({ error: 'Можно удалить только свою заметку' }); return;
      }
      const { error } = await supabase.from('crm_schedule_notes').update({ is_deleted: true }).eq('id', req.params.id);
      if (error) { console.error('notes delete:', error); res.status(500).json({ error: 'Не удалось удалить заметку' }); return; }
      await writeAudit('schedule_note', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client auto-labels settings ───────────────────────────────────────────────

  r.get('/kviz/api/crm/client-auto-labels', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'view', session)) return;
    try {
      const { data, error } = await supabase.from('crm_client_auto_labels')
        .select('code,name,short_name,color,sort,is_active,params').order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/client-auto-labels/:code', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.classes', 'edit', session)) return;
    try {
      const code = req.params.code;
      const b = req.body as Record<string, unknown>;

      // debt label cannot be enabled
      if (code === 'debt' && b.is_active === true) {
        res.status(400).json({ error: 'Метка «Долг» включится автоматически, когда в кассе появится оплата частями' });
        return;
      }

      const upd: Record<string, unknown> = {};
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      if (b.color !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) { res.status(400).json({ error: 'Неверный формат цвета' }); return; }
        upd.color = String(b.color);
      }
      if (b.sort !== undefined) upd.sort = Number(b.sort);

      // Validate and merge params
      if (b.params !== undefined && typeof b.params === 'object') {
        const p = b.params as Record<string, unknown>;
        const limits: Record<string, [number, number]> = {
          days: [1, 365], visits: [1, 20], sessions: [0, 20],
          kg: [0.1, 5], per_week: [1, 7], weeks: [1, 8], min_plan_days: [1, 365],
        };
        for (const [key, val] of Object.entries(p)) {
          const lim = limits[key];
          if (!lim) continue;
          const n = Number(val);
          if (!Number.isFinite(n) || n < lim[0] || n > lim[1]) {
            res.status(400).json({ error: `Параметр «${key}» должен быть от ${lim[0]} до ${lim[1]}` });
            return;
          }
        }
        upd.params = p;
      }

      if (Object.keys(upd).length === 0) { res.status(400).json({ error: 'Нечего обновлять' }); return; }

      const { error } = await supabase.from('crm_client_auto_labels').update(upd).eq('code', code);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('client_auto_label', code, 'update', session!.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Schedule: bookings ────────────────────────────────────────────────────────

  const SCHEDULE_RPC_ERRORS: Record<string, string> = {
    BAD_PARAMS:          'Не хватает данных для записи',
    CLIENT_NOT_FOUND:    'Клиент не найден',
    IN_PAST:             'Нельзя записать на прошедший день',
    BAD_DEVICE_TYPE:     'Неизвестный вид аппарата',
    OUT_OF_HOURS:        'Время вне рабочих часов',
    DEVICE_UNAVAILABLE:  'Этот аппарат сейчас не работает',
    NO_FREE_DEVICE:      'На это время все аппараты этого вида заняты',
    PLAN_NOT_FOUND:      'Абонемент не найден у этого клиента',
    PLAN_FROZEN:         'Абонемент заморожен',
    PLAN_INACTIVE:       'Абонемент закончился или возвращён',
    PLAN_EXPIRES:        'Абонемент закончится раньше этой даты',
    TYPE_NOT_IN_PLAN:    'Этого аппарата нет в абонементе',
    DAILY_LIMIT:         'Лимит посещений на сегодня исчерпан',
    NO_SESSIONS:         'Сеансы на этот аппарат закончились (с учётом будущих записей)',
    NO_FINISHING_SLOT:   'Нет места на завершающую фазу сразу после активной',
    NOT_FREE_SERVICE:    'Эта услуга не бесплатная',
    CLIENT_BUSY:         'Клиент уже записан на это время',
    DEVICE_BUSY:         'Аппарат уже занят на это время',
    BAD_STATUS:          'Неверный статус',
    BOOKING_NOT_FOUND:   'Запись не найдена',
    BOOKING_CANCELLED:   'Запись уже отменена',
    NOT_YET:             'Отметить «Пришёл / Не пришёл» можно только в день занятия или позже',
    NOTHING_TO_CANCEL:   'Нечего отменять',
    CANNOT_MOVE:         'Перенести нельзя: по записи уже отмечено посещение',
    CLOSED_DAY:          'Филиал в этот день не работает',
    PLAN_WRONG_DAY:      'Абонемент не действует в этот день',
    PLAN_WRONG_TIME:     'Абонемент не действует в это время',
  };

  function translateScheduleRpcError(msg: string): string {
    for (const [code, text] of Object.entries(SCHEDULE_RPC_ERRORS)) {
      if (msg.includes(code)) return text;
    }
    console.error('[schedule rpc] unhandled error:', msg);
    return 'Не удалось выполнить действие, попробуйте ещё раз';
  }

  r.post('/kviz/api/crm/schedule/bookings', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const payload = { ...b, created_by: session.display_name };
      const { data, error } = await supabase.rpc('crm_booking_create', { p: payload });
      if (error) {
        const msg = translateScheduleRpcError(error.message);
        // For NO_FINISHING_SLOT / NO_FREE_DEVICE: client calls /suggest with same params
        res.status(409).json({ error: msg, needs_suggest: error.message.includes('NO_FINISHING_SLOT') || error.message.includes('NO_FREE_DEVICE') });
        return;
      }
      await writeAudit('booking', (data as Record<string,unknown>)?.group_id as string, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/schedule/bookings/:id/status', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.attend', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const { data, error } = await supabase.rpc('crm_booking_set_status', {
        p: { booking_id: req.params.id, status: b.status, by: session.display_name, only_this: Boolean(b.only_this) },
      });
      if (error) { res.status(409).json({ error: translateScheduleRpcError(error.message) }); return; }
      const ids = (data as Record<string,unknown> | null)?.booking_ids as string[] | undefined;
      for (const id of (ids ?? [req.params.id])) {
        await writeAudit('booking', id, `status:${b.status}`, session.display_name);
      }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/schedule/bookings/:id/cancel', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const forceEarly = Boolean(b.force_early) && session.role === 'admin';
      const { data, error } = await supabase.rpc('crm_booking_cancel', { p: { booking_id: req.params.id, reason: b.reason, by: session.display_name, force_early: forceEarly } });
      if (error) { res.status(409).json({ error: translateScheduleRpcError(error.message) }); return; }
      await writeAudit('booking', req.params.id, 'cancel', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/schedule/bookings/:id/move', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const { data, error } = await supabase.rpc('crm_booking_move', { p: { booking_id: req.params.id, date: b.date, time: b.time, device_id: b.device_id ?? null } });
      if (error) {
        if (error.message.includes('PLAN_WRONG_DAY') || error.message.includes('PLAN_WRONG_TIME')) {
          const { data: bk } = await supabase.from('crm_bookings').select('client_plan_id').eq('id', req.params.id).single();
          const cpId = (bk as Record<string,unknown>)?.client_plan_id as string | null;
          if (cpId) {
            const { data: cp } = await supabase.from('crm_client_plans').select('allowed_weekdays,time_from,time_to').eq('id', cpId).single();
            const days = (cp as Record<string,unknown> | null)?.allowed_weekdays as number[] | null;
            const tf   = (cp as Record<string,unknown> | null)?.time_from as string | null;
            const tt   = (cp as Record<string,unknown> | null)?.time_to   as string | null;
            const DS   = ['','пн','вт','ср','чт','пт','сб','вс'];
            if (error.message.includes('PLAN_WRONG_DAY') && days?.length) {
              res.status(409).json({ error: 'Абонемент действует только: ' + [...days].sort((a,b)=>a-b).map(d=>DS[d]).join(', ') }); return;
            }
            if (error.message.includes('PLAN_WRONG_TIME') && tf && tt) {
              res.status(409).json({ error: `Абонемент действует только с ${tf.slice(0,5)} до ${tt.slice(0,5)}` }); return;
            }
          }
        }
        res.status(409).json({ error: translateScheduleRpcError(error.message) }); return;
      }
      await writeAudit('booking', req.params.id, 'move', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/schedule/bookings/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.note    !== undefined) upd.note    = b.note;
      if (b.trainer !== undefined) upd.trainer = b.trainer;
      if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нечего обновлять' }); return; }
      const { data, error } = await supabase.from('crm_bookings').update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/kviz/api/crm/schedule/bookings/:id/labels', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'schedule.book', 'edit', session)) return;
    try {
      const { label_ids } = req.body as { label_ids: number[] };
      if (!Array.isArray(label_ids)) { res.status(400).json({ error: 'label_ids должен быть массивом' }); return; }
      // Apply to all non-cancelled bookings in the same group
      const { data: bk } = await supabase.from('crm_bookings').select('group_id').eq('id', req.params.id).single();
      const groupId = (bk as Record<string,unknown> | null)?.group_id as string | null;
      let bookingIds = [req.params.id];
      if (groupId) {
        const { data: grp } = await supabase.from('crm_bookings')
          .select('id').eq('group_id', groupId).not('status', 'in', '("cancelled","late_cancel")');
        if (grp?.length) bookingIds = (grp as { id: string }[]).map(b => b.id);
      }
      for (const bid of bookingIds) {
        await supabase.from('crm_booking_label_links').delete().eq('booking_id', bid);
      }
      if (label_ids.length) {
        const rows = bookingIds.flatMap(bid =>
          label_ids.map(lid => ({ booking_id: bid, label_id: lid, set_by: session.display_name }))
        );
        await supabase.from('crm_booking_label_links').insert(rows);
      }
      res.json({ ok: true });
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

  // ── Fitbase history import (admin, from UI) ───────────────────────────────────

  r.post('/kviz/api/crm/fitbase-history-import', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    // In-memory guard (fast path)
    if (getHistoryImportJob()?.status === 'running') {
      res.status(409).json({ error: 'Импорт уже идёт', ...getHistoryImportJob() }); return;
    }

    // DB guard: stale 'running' run from before server restart → mark as error
    const { data: staleRuns } = await supabase
      .from('crm_fitbase_import_runs').select('id').eq('status', 'running');
    if (staleRuns?.length) {
      await supabase.from('crm_fitbase_import_runs')
        .update({ status: 'error', finished_at: new Date().toISOString() })
        .eq('status', 'running');
      console.log(`[history-import] marked ${staleRuns.length} stale running run(s) as error`);
    }

    const kind = (req.body?.kind === 'nightly' ? 'nightly' : 'full') as 'full' | 'nightly';
    const rawIds = req.body?.client_ids;
    const clientIds: number[] | undefined = Array.isArray(rawIds) ? rawIds.map(Number).filter(Boolean) : undefined;
    const job = startHistoryImport(kind);
    if (!job) { res.status(409).json({ error: 'Импорт уже идёт', ...getHistoryImportJob() }); return; }
    console.log(`[history-import] started kind=${kind} client_ids=${clientIds?.join(',') ?? 'all'}`);
    res.json({ status: 'started', kind, client_ids: clientIds ?? null });
    runFitbaseHistoryImport(kind, clientIds).catch(e => {
      const j = getHistoryImportJob();
      if (j) { j.status = 'error'; j.errors.push(String(e)); }
      console.error('[history-import] unhandled rejection:', String(e));
    });
  });

  r.get('/kviz/api/crm/fitbase-history-import/status', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const job = getHistoryImportJob();
    if (job) { res.json(job); return; }
    // Server restarted — fall back to last DB run
    const { data } = await supabase
      .from('crm_fitbase_import_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    res.json(data ?? { status: 'idle' });
  });

  // ── InBody ↔ CRM client link ──────────────────────────────────────────────────

  r.get('/kviz/api/crm/inbody-link-stats', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const stats = await getLinkStats();
      res.json(stats);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/inbody-link-auto', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await linkBodyClients();
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/body-clients/:id/link', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.crm_client_id) { res.status(400).json({ error: 'crm_client_id required' }); return; }
      const { data: client } = await supabase.from('crm_clients').select('id').eq('id', b.crm_client_id as string).eq('is_deleted', false).maybeSingle();
      if (!client) { res.status(404).json({ error: 'Клиент CRM не найден' }); return; }
      const { error } = await supabase.from('body_clients')
        .update({ crm_client_id: b.crm_client_id, crm_link_method: 'manual' })
        .eq('id', Number(req.params.id));
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/body-clients/:id/unlink', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('body_clients')
        .update({ crm_client_id: null, crm_link_method: null })
        .eq('id', Number(req.params.id));
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client summary (LTV, active plan, visits, tags, inbody, measures) ──────────

  r.get('/kviz/api/crm/clients/:id/summary', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const clientId = req.params.id;

      // Client base info
      const { data: client } = await supabase.from('crm_clients')
        .select('phone,profile_complete,birth_date').eq('id', clientId).single();

      // Cash/cashless payment method IDs for LTV
      const { data: pmRows } = await supabase.from('crm_payment_methods').select('id').in('kind', ['cash', 'cashless']);
      const pmIds = (pmRows ?? []).map((m: Record<string,unknown>) => m.id as string);

      // Sale IDs for client
      const { data: salesRows } = await supabase.from('crm_sales').select('id').eq('client_id', clientId);
      const saleIds = (salesRows ?? []).map((s: Record<string,unknown>) => s.id as string);

      // Parallel queries
      const [activePlanRes, visitsRes, bodyRes, salePayRes, refundIdRes, bookingsRes] = await Promise.all([
        supabase.from('crm_client_plans')
          .select('id,name,plan_id,status,valid_until,sessions_left,source,freeze_days_used')
          .eq('client_id', clientId).in('status', ['active', 'not_activated'])
          .order('purchased_at', { ascending: false }).limit(1),
        supabase.from('crm_visit_history').select('visit_at,status').eq('client_id', clientId),
        supabase.from('body_clients').select('id,phone_digits').eq('crm_client_id', clientId).limit(1),
        saleIds.length && pmIds.length
          ? supabase.from('crm_sale_payments').select('amount').in('sale_id', saleIds).in('payment_method_id', pmIds)
          : Promise.resolve({ data: [] as Record<string,unknown>[] }),
        saleIds.length
          ? supabase.from('crm_refunds').select('id').in('sale_id', saleIds)
          : Promise.resolve({ data: [] as Record<string,unknown>[] }),
        supabase.from('crm_bookings').select('booking_date,status').eq('client_id', clientId).eq('status','attended'),
      ]);

      // LTV: cash/cashless sale payments − refund payments
      const salesPayTotal = ((salePayRes as { data: Record<string,unknown>[] | null }).data ?? [])
        .reduce((s: number, r) => s + Number(r.amount ?? 0), 0);
      const refundIds = ((refundIdRes as { data: Record<string,unknown>[] | null }).data ?? []).map(r => r.id as string);
      let refundPayTotal = 0;
      if (refundIds.length && pmIds.length) {
        const { data: rfp } = await supabase.from('crm_refund_payments')
          .select('amount').in('refund_id', refundIds).in('payment_method_id', pmIds);
        refundPayTotal = (rfp ?? []).reduce((s: number, r: Record<string,unknown>) => s + Number(r.amount ?? 0), 0);
      }
      const ltv = salesPayTotal - refundPayTotal;

      // Active plan
      const activePlanRaw = (activePlanRes.data ?? [])[0] as Record<string,unknown> | null ?? null;
      let activePlanWithName: Record<string,unknown> | null = activePlanRaw;
      if (activePlanRaw?.plan_id) {
        const { data: planRow } = await supabase.from('crm_plans')
          .select('name,freeze_days').eq('id', activePlanRaw.plan_id as string).single();
        if (planRow) activePlanWithName = { ...activePlanRaw,
          plan_name: (planRow as Record<string,unknown>).name,
          freeze_days: (planRow as Record<string,unknown>).freeze_days };
      } else if (activePlanRaw?.name) {
        activePlanWithName = { ...activePlanRaw, plan_name: activePlanRaw.name };
      }

      // Visits: crm_visit_history attended + crm_bookings attended
      const attendedHistory = (visitsRes.data ?? []).filter((v: Record<string,unknown>) => v.status === 'attended');
      const attendedBookings = (bookingsRes.data ?? []) as Record<string,unknown>[];
      const visits_attended_total = attendedHistory.length + attendedBookings.length;
      const historyDates = attendedHistory.map((v: Record<string,unknown>) => v.visit_at as string | null).filter(Boolean) as string[];
      const bookingDates = attendedBookings.map((v: Record<string,unknown>) => v.booking_date as string | null).filter(Boolean) as string[];
      const sortedDates = [...historyDates, ...bookingDates].sort();
      const last_visit_at = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;

      // Body client
      const bodyClient = (bodyRes.data ?? [])[0] as Record<string,unknown> | undefined;
      const body_client_id = bodyClient?.id ?? null;
      const bodyPhoneDigits = bodyClient?.phone_digits as string | null ?? null;

      // InBody: query by phone_digits (fallback: use crm_client.phone directly)
      const phoneForInBody = bodyPhoneDigits ?? (client?.phone as string | null ?? null);
      let inbody_last: string | null = null;
      let inbody_latest: Record<string,unknown> | null = null;
      let inbody_prev: Record<string,unknown> | null = null;
      let inbody_count = 0;
      let inbody_first: string | null = null;
      if (phoneForInBody) {
        const { data: ibRows, error: ibErr } = await supabase.from('inbody_tests')
          .select('tested_at,weight,pbf,smm,ffm,vfl,bfm,bmi,bmr,whr,inbody_score,data')
          .eq('phone_digits', phoneForInBody).order('tested_at', { ascending: false });
        if (ibErr) console.error('[summary] inbody_tests error client_id:', clientId, ibErr.message);
        inbody_count = (ibRows ?? []).length;
        if (ibRows?.[0]) { inbody_last = (ibRows[0] as Record<string,unknown>).tested_at as string; inbody_latest = ibRows[0] as Record<string,unknown>; }
        if (ibRows?.[1]) inbody_prev = ibRows[1] as Record<string,unknown>;
        if (ibRows && ibRows.length > 0) inbody_first = (ibRows[ibRows.length - 1] as Record<string,unknown>).tested_at as string;
      }

      // Measures: latest + first + all points via body_measurements (linked by body_clients.id)
      const ZONE_SEL = 'neck,chest,arm_l,arm_r,waist,belly,glutes,thigh_l,thigh_r,shin_l,shin_r';
      let measure_last: string | null = null;
      let measure_latest: Record<string,unknown> | null = null;
      let measure_first: Record<string,unknown> | null = null;
      let measure_count = 0;
      let measure_points: { measured_at: string; total_cm: number }[] = [];
      if (body_client_id) {
        const [mLatestRes, mFirstRes, mAllRes] = await Promise.all([
          supabase.from('body_measurements').select(`measured_at,total_cm,weight,${ZONE_SEL}`).eq('client_id', body_client_id as string).order('measured_at', { ascending: false }).limit(1),
          supabase.from('body_measurements').select(`measured_at,total_cm,weight,${ZONE_SEL}`).eq('client_id', body_client_id as string).order('measured_at', { ascending: true }).limit(1),
          supabase.from('body_measurements').select('measured_at,total_cm').eq('client_id', body_client_id as string).order('measured_at', { ascending: true }),
        ]);
        if (mLatestRes.data?.[0]) { measure_last = (mLatestRes.data[0] as Record<string,unknown>).measured_at as string; measure_latest = mLatestRes.data[0] as Record<string,unknown>; }
        if (mFirstRes.data?.[0] && measure_last && (mFirstRes.data[0] as Record<string,unknown>).measured_at !== measure_last) measure_first = mFirstRes.data[0] as Record<string,unknown>;
        measure_points = ((mAllRes.data ?? []) as Record<string,unknown>[]).map(r => ({ measured_at: r.measured_at as string, total_cm: Number(r.total_cm ?? 0) }));
        measure_count = measure_points.length;
      }

      // Auto labels
      const extrasForSummary = new Map<string, ClientExtraData>([
        [clientId, { profile_complete: client?.profile_complete as boolean, birth_date: client?.birth_date as string | null }],
      ]);
      const autoLabelsMap = await batchAutoLabelsToday([clientId], extrasForSummary);
      const auto_labels = autoLabelsMap.get(clientId) ?? [];

      // Personal tags
      const { data: tagLinks } = await supabase.from('crm_client_tag_links').select('tag_id').eq('client_id', clientId);
      const tagIds = (tagLinks ?? []).map((l: Record<string,unknown>) => l.tag_id as string);
      let personal_tags: Record<string,unknown>[] = [];
      if (tagIds.length) {
        const { data: ts } = await supabase.from('crm_client_tags').select('id,name,color').in('id', tagIds).eq('is_active', true);
        personal_tags = (ts ?? []) as Record<string,unknown>[];
      }

      res.json({
        ltv, active_plan: activePlanWithName, visits_attended_total, last_visit_at,
        inbody_last, inbody_latest, inbody_prev, inbody_count, inbody_first,
        measure_last, measure_latest, measure_first, measure_count, measure_points, body_client_id,
        auto_labels, personal_tags,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Kassa auth ────────────────────────────────────────────────────────────────

  // POST /kviz/api/crm/kassa/auth — verify kassa password, return mode token
  r.post('/kviz/api/crm/kassa/auth', async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { password } = req.body as { password?: string };
    if (!password) { res.status(400).json({ error: 'Укажите пароль' }); return; }

    try {
      const { data: branch } = await supabase
        .from('crm_branches')
        .select('kassa_sales_pass_hash,kassa_full_pass_hash,kassa_failed_attempts,kassa_locked_at')
        .eq('id', BRANCH_ID).single();
      if (!branch) { res.status(500).json({ error: 'Ошибка конфигурации' }); return; }

      const isLocked = branch.kassa_locked_at != null;

      async function logEvent(mode: string | null, event: string) {
        try {
          await supabase.from('crm_kassa_auth_log').insert({
            branch_id: BRANCH_ID, user_login: session!.login, user_name: session!.display_name,
            mode: mode ?? 'unknown', event,
          });
        } catch {}
      }

      // Try master password first (always bypasses lockout)
      const masterHash = process.env.KASSA_MASTER_PASSWORD_HASH;
      if (masterHash) {
        const isMaster = await bcrypt.compare(password, masterHash).catch(() => false);
        if (isMaster) {
          // Reset lockout on master login
          await supabase.from('crm_branches').update({ kassa_failed_attempts: 0, kassa_locked_at: null }).eq('id', BRANCH_ID);
          const token = makeKassaToken({ branch_id: BRANCH_ID, mode: 'master', user_id: session.id, user_login: session.login, issued_at: Math.floor(Date.now() / 1000) });
          await logEvent('master', 'login');
          res.json({ token, mode: 'master' }); return;
        }
      }

      // If locked, only master can unlock (checked above)
      if (isLocked) {
        await logEvent(null, 'fail');
        res.status(423).json({ error: 'Касса заблокирована после 5 неверных попыток. Обратитесь к администратору или введите полный пароль.' }); return;
      }

      // Try full password
      const fullHash = branch.kassa_full_pass_hash as string | null;
      if (fullHash) {
        const isFull = await bcrypt.compare(password, fullHash).catch(() => false);
        if (isFull) {
          await supabase.from('crm_branches').update({ kassa_failed_attempts: 0, kassa_locked_at: null }).eq('id', BRANCH_ID);
          const token = makeKassaToken({ branch_id: BRANCH_ID, mode: 'full', user_id: session.id, user_login: session.login, issued_at: Math.floor(Date.now() / 1000) });
          await logEvent('full', 'login');
          res.json({ token, mode: 'full' }); return;
        }
      }

      // Try sales password
      const salesHash = branch.kassa_sales_pass_hash as string | null;
      if (salesHash) {
        const isSales = await bcrypt.compare(password, salesHash).catch(() => false);
        if (isSales) {
          await supabase.from('crm_branches').update({ kassa_failed_attempts: 0, kassa_locked_at: null }).eq('id', BRANCH_ID);
          const token = makeKassaToken({ branch_id: BRANCH_ID, mode: 'sales', user_id: session.id, user_login: session.login, issued_at: Math.floor(Date.now() / 1000) });
          await logEvent('sales', 'login');
          res.json({ token, mode: 'sales' }); return;
        }
      }

      // No password matched — increment failure counter
      const attempts = (Number(branch.kassa_failed_attempts) || 0) + 1;
      const shouldLock = attempts >= 5;
      await supabase.from('crm_branches').update({
        kassa_failed_attempts: attempts,
        kassa_locked_at: shouldLock ? new Date().toISOString() : null,
      }).eq('id', BRANCH_ID);
      await logEvent(null, shouldLock ? 'locked' : 'fail');

      if (shouldLock) {
        res.status(423).json({ error: 'Касса заблокирована после 5 неверных попыток.' }); return;
      }
      res.status(401).json({ error: `Неверный пароль. Попыток осталось: ${5 - attempts}` });
    } catch (e) { console.error('[kassa/auth]', e); res.status(500).json({ error: 'Ошибка' }); }
  });

  // POST /kviz/api/crm/kassa/set-password — set/clear kassa passwords
  r.post('/kviz/api/crm/kassa/set-password', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.kassa_passwords', 'edit', session)) return;
    const { kind, password } = req.body as { kind?: string; password?: string };
    if (kind !== 'sales' && kind !== 'full') { res.status(400).json({ error: 'kind: sales или full' }); return; }
    const field = kind === 'sales' ? 'kassa_sales_pass_hash' : 'kassa_full_pass_hash';
    try {
      const hash = password ? await bcrypt.hash(password, 10) : null;
      const { error } = await supabase.from('crm_branches').update({ [field]: hash }).eq('id', BRANCH_ID);
      if (error) { res.status(500).json({ error: 'Не удалось сохранить' }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /kviz/api/crm/kassa/status — lockout status for settings page
  r.get('/kviz/api/crm/kassa/status', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.kassa_passwords', 'view', session)) return;
    try {
      const { data } = await supabase
        .from('crm_branches')
        .select('kassa_failed_attempts,kassa_locked_at,kassa_sales_pass_hash,kassa_full_pass_hash')
        .eq('id', BRANCH_ID).single();
      res.json({
        locked: data?.kassa_locked_at != null,
        locked_at: data?.kassa_locked_at ?? null,
        failed_attempts: data?.kassa_failed_attempts ?? 0,
        has_sales_password: !!data?.kassa_sales_pass_hash,
        has_full_password: !!data?.kassa_full_pass_hash,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST /kviz/api/crm/kassa/unlock — admin unlock
  r.post('/kviz/api/crm/kassa/unlock', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.kassa_passwords', 'edit', session)) return;
    try {
      await supabase.from('crm_branches').update({ kassa_failed_attempts: 0, kassa_locked_at: null }).eq('id', BRANCH_ID);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Kassa closings (Reports) ────────────────────────────────────────────────

  r.get('/kviz/api/crm/kassa/closings', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.closings', 'view', session)) return;
    try {
      const limit = Math.min(Number(req.query.limit ?? 50), 100);
      const offset = Number(req.query.offset ?? 0);
      const { data, error } = await supabase.from('crm_cash_shifts')
        .select('id,shift_date,number,opened_by,opened_at,closed_by,closed_at,opening_cash,expected_cash,counted_cash,difference,closing_no,closing_doc,status')
        .eq('branch_id', BRANCH_ID).eq('status', 'closed').not('closing_no', 'is', null)
        .order('closing_no', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Shift: closing data for bill-counting form ─────────────────────────────

  r.get('/kviz/api/crm/shifts/:id/closing-data', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.shift', 'view', session)) return;
    if (!requireKassaToken(req, res)) return;
    try {
      const shiftId = req.params.id;
      const { data: shift } = await supabase.from('crm_cash_shifts')
        .select('id,shift_date,number,opened_by,opened_at,opening_cash,branch_id').eq('id', shiftId).single();
      if (!shift || (shift.branch_id as string) !== BRANCH_ID) { res.status(404).json({ error: 'Смена не найдена' }); return; }

      // Cash sales and refunds (only shifts with this shift_id)
      const [movRes, salesPayRes, refundPayRes] = await Promise.all([
        supabase.from('crm_cash_movements').select('type,amount').eq('shift_id', shiftId),
        supabase.from('crm_sale_payments').select('amount,payment_method_id,crm_payment_methods(kind)')
          .eq('crm_sales.shift_id', shiftId)
          .in('crm_payment_methods.kind', ['cash', 'cashless'])
          // Note: joining through crm_sales isn't directly supported this way in Supabase
          // Using a different approach via crm_sales
          .neq('amount', -1), // placeholder; will re-query below
        Promise.resolve({ data: null }),
      ]);

      // Get all sales for this shift
      const { data: salesInShift } = await supabase.from('crm_sales').select('id').eq('shift_id', shiftId);
      const saleIds = (salesInShift ?? []).map((s: Record<string, unknown>) => s.id as string);

      const { data: salePays } = saleIds.length
        ? await supabase.from('crm_sale_payments').select('amount,payment_method_id,crm_payment_methods(kind)').in('sale_id', saleIds)
        : { data: [] as unknown[] };
      const { data: refundsInShift } = await supabase.from('crm_refunds').select('id').eq('shift_id', shiftId);
      const refundIds = (refundsInShift ?? []).map((r: Record<string, unknown>) => r.id as string);
      const { data: refundPays } = refundIds.length
        ? await supabase.from('crm_refund_payments').select('amount,payment_method_id,crm_payment_methods(kind)').in('refund_id', refundIds)
        : { data: [] as unknown[] };

      let cashSales = 0, cardSales = 0, cashRefunds = 0, cardRefunds = 0;
      for (const p of (salePays ?? []) as Array<Record<string, unknown>>) {
        const kind = (p.crm_payment_methods as Record<string, unknown> | null)?.kind as string ?? '';
        if (kind === 'cash') cashSales += Number(p.amount);
        else if (kind === 'cashless') cardSales += Number(p.amount);
      }
      for (const p of (refundPays ?? []) as Array<Record<string, unknown>>) {
        const kind = (p.crm_payment_methods as Record<string, unknown> | null)?.kind as string ?? '';
        if (kind === 'cash') cashRefunds += Number(p.amount);
        else if (kind === 'cashless') cardRefunds += Number(p.amount);
      }

      let movIn = 0, movOut = 0;
      for (const m of (movRes.data ?? []) as Array<Record<string, unknown>>) {
        if (m.type === 'in') movIn += Number(m.amount);
        else movOut += Number(m.amount);
      }

      const opening = Number(shift.opening_cash);
      const expectedCash = opening + cashSales + movIn - cashRefunds - movOut;

      // Next closing_no: max of crm_cash_shifts.closing_no and cash_closings.number
      const [crmMaxRes, oldMaxRes] = await Promise.all([
        supabase.from('crm_cash_shifts').select('closing_no').eq('branch_id', BRANCH_ID).not('closing_no', 'is', null).order('closing_no', { ascending: false }).limit(1),
        supabase.from('cash_closings').select('number').order('number', { ascending: false }).limit(1),
      ]);
      const crmMax = Number((crmMaxRes.data?.[0] as Record<string, unknown> | undefined)?.closing_no ?? 0);
      const oldMax = Number((oldMaxRes.data?.[0] as Record<string, unknown> | undefined)?.number ?? 0);
      const nextClosingNo = Math.max(crmMax, oldMax) + 1;

      res.json({
        shift_date: shift.shift_date, opened_by: shift.opened_by, opened_at: shift.opened_at,
        opening, cash_sales: cashSales, card_sales: cardSales,
        cash_refunds: cashRefunds, card_refunds: cardRefunds,
        mov_in: movIn, mov_out: movOut, expected_cash: expectedCash,
        next_closing_no: nextClosingNo,
      });
    } catch (e) { console.error('[closing-data]', e); res.status(500).json({ error: String(e) }); }
  });

  // PATCH /kviz/api/crm/shifts/:id/close-with-doc
  r.patch('/kviz/api/crm/shifts/:id/close-with-doc', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'kassa.shift', 'edit', session)) return;
    if (!requireKassaToken(req, res)) return;
    try {
      const shiftId = req.params.id;
      const { counted_cash, cash_count, comment } = req.body as { counted_cash: number; cash_count?: Record<string, number>; comment?: string };
      if (counted_cash === undefined || counted_cash === null) { res.status(400).json({ error: 'counted_cash обязателен' }); return; }

      const { data: shift } = await supabase.from('crm_cash_shifts')
        .select('id,shift_date,number,opened_by,opened_at,opening_cash,status,branch_id').eq('id', shiftId).single();
      if (!shift) { res.status(404).json({ error: 'Смена не найдена' }); return; }
      if ((shift.branch_id as string) !== BRANCH_ID) { res.status(403).json({ error: 'Нет доступа' }); return; }
      if ((shift.status as string) !== 'open') { res.status(400).json({ error: 'Смена уже закрыта' }); return; }

      // Build totals
      const { data: salesInShift } = await supabase.from('crm_sales').select('id').eq('shift_id', shiftId);
      const saleIds = (salesInShift ?? []).map((s: Record<string, unknown>) => s.id as string);
      const { data: refundsInShift } = await supabase.from('crm_refunds').select('id').eq('shift_id', shiftId);
      const refundIds = (refundsInShift ?? []).map((r: Record<string, unknown>) => r.id as string);

      const [movRes, salePays, refundPays] = await Promise.all([
        supabase.from('crm_cash_movements').select('type,amount').eq('shift_id', shiftId),
        saleIds.length ? supabase.from('crm_sale_payments').select('amount,payment_method_id,crm_payment_methods(kind)').in('sale_id', saleIds) : { data: [] as unknown[] },
        refundIds.length ? supabase.from('crm_refund_payments').select('amount,payment_method_id,crm_payment_methods(kind)').in('refund_id', refundIds) : { data: [] as unknown[] },
      ]);

      let cashSales = 0, cardSales = 0, cashRefunds = 0, cardRefunds = 0;
      for (const p of (salePays.data ?? []) as Array<Record<string, unknown>>) {
        const kind = (p.crm_payment_methods as Record<string, unknown> | null)?.kind as string ?? '';
        if (kind === 'cash') cashSales += Number(p.amount);
        else if (kind === 'cashless') cardSales += Number(p.amount);
      }
      for (const p of (refundPays.data ?? []) as Array<Record<string, unknown>>) {
        const kind = (p.crm_payment_methods as Record<string, unknown> | null)?.kind as string ?? '';
        if (kind === 'cash') cashRefunds += Number(p.amount);
        else if (kind === 'cashless') cardRefunds += Number(p.amount);
      }
      let movIn = 0, movOut = 0;
      for (const m of (movRes.data ?? []) as Array<Record<string, unknown>>) {
        if (m.type === 'in') movIn += Number(m.amount);
        else movOut += Number(m.amount);
      }

      const opening = Number(shift.opening_cash);
      const expectedCash = opening + cashSales + movIn - cashRefunds - movOut;
      const difference = Number(counted_cash) - expectedCash;

      // Determine closing_no
      const [crmMaxRes, oldMaxRes] = await Promise.all([
        supabase.from('crm_cash_shifts').select('closing_no').eq('branch_id', BRANCH_ID).not('closing_no', 'is', null).order('closing_no', { ascending: false }).limit(1),
        supabase.from('cash_closings').select('number').order('number', { ascending: false }).limit(1),
      ]);
      const crmMax = Number((crmMaxRes.data?.[0] as Record<string, unknown> | undefined)?.closing_no ?? 0);
      const oldMax = Number((oldMaxRes.data?.[0] as Record<string, unknown> | undefined)?.number ?? 0);
      const closingNo = Math.max(crmMax, oldMax) + 1;

      const closedBy = session.display_name;
      const closedAt = new Date().toISOString();

      const closing_doc = {
        closing_no: closingNo, shift_date: shift.shift_date,
        opened_at: shift.opened_at, closed_at: closedAt,
        opened_by: shift.opened_by, closed_by: closedBy,
        opening_cash: opening,
        cash_sales: cashSales, card_sales: cardSales,
        cash_refunds: cashRefunds, card_refunds: cardRefunds,
        mov_in: movIn, mov_out: movOut,
        expected_cash: expectedCash,
        counted_cash: Number(counted_cash),
        difference,
        cash_count: cash_count ?? null,
        comment: comment ?? null,
      };

      const { error } = await supabase.from('crm_cash_shifts').update({
        status: 'closed', closed_by: closedBy, closed_at: closedAt,
        expected_cash: expectedCash, counted_cash: Number(counted_cash), difference,
        closing_no: closingNo, cash_count: cash_count ?? null,
        closing_doc, closing_doc_at: closedAt,
      }).eq('id', shiftId);

      if (error) { console.error('[close-with-doc]', error); res.status(500).json({ error: 'Не удалось закрыть смену' }); return; }
      res.json({ ok: true, closing_no: closingNo, closing_doc });
    } catch (e) { console.error('[close-with-doc]', e); res.status(500).json({ error: String(e) }); }
  });

  return r;
}
