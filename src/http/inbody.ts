import { Router } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

supabase.from('inbody_tests').select('id').limit(0)
  .then(({ error }) => error
    ? console.error('[inbody_tests] schema check failed:', error.message)
    : console.log('[inbody_tests] OK'));

function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  if (d.length === 10) return '+7' + d;
  return null;
}

function normalizeInbodyId(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  if (d.length === 10) return '7' + d;
  return d;
}

interface InBodyRow {
  inbody_id: string;
  tested_at: string;
  phone: string | null;
  source: 'qr' | 'csv';
  gender?: string | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  bfm?: number | null;
  pbf?: number | null;
  smm?: number | null;
  ffm?: number | null;
  bmi?: number | null;
  vfl?: number | null;
  inbody_score?: number | null;
  whr?: number | null;
  bmr?: number | null;
  data?: Record<string, unknown> | null;
  raw?: string | null;
}

async function knownPhoneDigitsSet(phoneDigits: string[]): Promise<Set<string>> {
  if (!phoneDigits.length) return new Set();
  const [{ data: bc }, { data: fcc }] = await Promise.all([
    supabase.from('body_clients').select('phone_digits').in('phone_digits', phoneDigits),
    supabase.from('fitbase_clients_cache').select('phone_digits').in('phone_digits', phoneDigits),
  ]);
  return new Set([
    ...(bc  || []).map((c: Record<string, unknown>) => c.phone_digits as string),
    ...(fcc || []).map((c: Record<string, unknown>) => c.phone_digits as string),
  ]);
}

export function buildInbodyRouter(): Router {
  const r = Router();

  // ── QR scan → save to inbody_tests ────────────────────────────────────────

  r.post('/kviz/api/inbody/qr', async (req, res) => {
    const session = getSession(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const { inbody } = req.body as Record<string, unknown>;
      const ib = inbody as Record<string, unknown>;
      if (!ib || !ib.measured_at) { res.status(400).json({ error: 'inbody.measured_at обязателен' }); return; }

      const rawPhone = String(ib.phone || '').replace(/\D/g, '');
      const inbody_id = normalizeInbodyId(rawPhone || String(ib.phone || ''));
      const phone = normalizePhone(String(ib.phone || ''));
      const tested_at = new Date(String(ib.measured_at)).toISOString();

      const lean_seg = ib.lean_by_segment as Record<string, number> | null;
      const fat_seg  = ib.fat_by_segment  as Record<string, number> | null;

      const row: InBodyRow = {
        inbody_id, tested_at, phone, source: 'qr',
        weight: ib.weight_kg != null ? Number(ib.weight_kg) : null,
        bfm:    ib.fat_kg     != null ? Number(ib.fat_kg)    : null,
        pbf:    ib.fat_pct    != null ? Number(ib.fat_pct)   : null,
        smm:    ib.skeletal_muscle_kg != null ? Number(ib.skeletal_muscle_kg) : null,
        ffm:    ib.lean_kg    != null ? Number(ib.lean_kg)   : null,
        bmi:    ib.bmi        != null ? Number(ib.bmi)       : null,
        whr:    ib.whr        != null ? Number(ib.whr)       : null,
        bmr:    ib.bmr_kcal   != null ? Number(ib.bmr_kcal)  : null,
        data: {
          weight: ib.weight_kg, bfm: ib.fat_kg, pbf: ib.fat_pct,
          smm: ib.skeletal_muscle_kg, ffm: ib.lean_kg, bmi: ib.bmi, whr: ib.whr, bmr: ib.bmr_kcal,
          weight_min: (ib.weight_norm as number[])?.[0], weight_max: (ib.weight_norm as number[])?.[1],
          bfm_min: (ib.fat_norm as number[])?.[0],    bfm_max: (ib.fat_norm as number[])?.[1],
          smm_min: null, smm_max: null,
          ffm_min: (ib.lean_norm as number[])?.[0],   ffm_max: (ib.lean_norm as number[])?.[1],
          ...(lean_seg ? {
            ffm_ra: lean_seg.right_arm, ffm_la: lean_seg.left_arm,
            ffm_tr: lean_seg.trunk,
            ffm_rl: lean_seg.right_leg, ffm_ll: lean_seg.left_leg,
          } : {}),
          ...(fat_seg ? {
            bfm_ra: fat_seg.right_arm, bfm_la: fat_seg.left_arm,
            bfm_tr: fat_seg.trunk,
            bfm_rl: fat_seg.right_leg, bfm_ll: fat_seg.left_leg,
          } : {}),
          height: ib.height_cm, age: ib.age, gender: ib.gender,
          protein: ib.protein_kg, minerals: ib.minerals_kg,
          tbw: ib.water_l, bmr_kcal: ib.bmr_kcal,
          obesity_pct: ib.obesity_pct, ideal_weight: ib.ideal_weight_kg,
        },
      };

      const { data, error } = await supabase.from('inbody_tests')
        .upsert(row, { onConflict: 'inbody_id,tested_at', ignoreDuplicates: false })
        .select('id, tested_at, bfm, pbf, smm, weight').single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, test: data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Get all tests for a client (by phone_digits) ──────────────────────────

  r.get('/kviz/api/inbody/clients/:clientId', async (req, res) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const { clientId } = req.params;
      const { data: client } = await supabase.from('body_clients')
        .select('id, phone_digits').eq('id', clientId).maybeSingle();
      if (!client || !client.phone_digits) { res.json([]); return; }

      const { data: tests, error } = await supabase.from('inbody_tests')
        .select('id, inbody_id, tested_at, source, gender, age, height, weight, bfm, pbf, smm, ffm, bmi, vfl, inbody_score, whr, bmr, data')
        .eq('phone_digits', client.phone_digits)
        .order('tested_at', { ascending: true });
      if (error) { res.status(500).json({ error: error.message }); return; }

      res.json(tests || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── CSV preview (admin) ────────────────────────────────────────────────────

  r.post('/kviz/api/inbody/csv-preview', async (req, res) => {
    const session = getSession(req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      const { rows } = req.body as { rows: { inbody_id: string; tested_at: string; phone: string | null }[] };
      if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: 'rows обязателен' }); return; }

      const inbodyIds = [...new Set(rows.map(r => r.inbody_id))];
      const { data: existing } = await supabase.from('inbody_tests')
        .select('inbody_id, tested_at').in('inbody_id', inbodyIds);
      const existingSet = new Set((existing || []).map(e => `${e.inbody_id}|${e.tested_at}`));
      const newRows = rows.filter(r => !existingSet.has(`${r.inbody_id}|${r.tested_at}`));
      const dupRows = rows.filter(r =>  existingSet.has(`${r.inbody_id}|${r.tested_at}`));

      // Check client matches against body_clients + fitbase_clients_cache
      const phoneDigits = [...new Set(rows.map(r => r.phone?.replace(/\D/g, '')).filter(Boolean) as string[])];
      const clientDigitsSet = await knownPhoneDigitsSet(phoneDigits);
      const linked   = rows.filter(r => r.phone && clientDigitsSet.has(r.phone.replace(/\D/g, '')));
      const unlinked = rows.filter(r => !r.phone || !clientDigitsSet.has(r.phone.replace(/\D/g, '')));
      const unlinkedIds = [...new Set(unlinked.map(r => r.inbody_id))].slice(0, 20);

      res.json({
        total: rows.length,
        new: newRows.length,
        duplicates: dupRows.length,
        linked: linked.length,
        unlinked: unlinked.length,
        unlinked_ids: unlinkedIds,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── CSV import (admin) ─────────────────────────────────────────────────────

  r.post('/kviz/api/inbody/csv-import', async (req, res) => {
    const session = getSession(req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      const { rows } = req.body as { rows: InBodyRow[] };
      if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: 'rows обязателен' }); return; }

      const prepared = rows.map(r => ({ ...r, source: 'csv' as const }));

      const CHUNK = 50;
      let added = 0, skipped = 0;
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const chunk = prepared.slice(i, i + CHUNK);
        const { data: inserted, error } = await supabase.from('inbody_tests')
          .upsert(chunk, { onConflict: 'inbody_id,tested_at', ignoreDuplicates: true })
          .select('id');
        if (error) { res.status(500).json({ error: error.message, at_chunk: i }); return; }
        added   += (inserted || []).length;
        skipped += chunk.length - (inserted || []).length;
      }

      // Count without any matching client (body_clients + fitbase_clients_cache)
      const phoneDigits = [...new Set(rows.map(r => r.phone?.replace(/\D/g, '')).filter(Boolean) as string[])];
      const knownDigits = await knownPhoneDigitsSet(phoneDigits);
      const without_client = rows.filter(r => !r.phone || !knownDigits.has(r.phone.replace(/\D/g, ''))).length;

      res.json({ ok: true, added, skipped, without_client });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── InBody test counts per client (for reports table) ────────────────────

  r.get('/kviz/api/inbody/counts', async (req, res) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const ids = String(req.query.client_ids || '').split(',').filter(Boolean);
      if (!ids.length) { res.json({}); return; }

      // 1. phone_digits for these clients
      const { data: clients } = await supabase.from('body_clients')
        .select('id, phone_digits').in('id', ids);
      const phoneToClient = new Map<string, string>();
      for (const c of (clients || []) as { id: string; phone_digits: string | null }[]) {
        if (c.phone_digits) phoneToClient.set(c.phone_digits, c.id);
      }
      const phoneDigits = [...phoneToClient.keys()];
      if (!phoneDigits.length) { res.json({}); return; }

      // 2. count tests per phone_digits
      const { data: tests, error } = await supabase.from('inbody_tests')
        .select('phone_digits').in('phone_digits', phoneDigits);
      if (error) { res.status(500).json({ error: error.message }); return; }

      const counts: Record<string, number> = {};
      for (const t of (tests || []) as { phone_digits: string | null }[]) {
        const cid = t.phone_digits ? phoneToClient.get(t.phone_digits) : undefined;
        if (cid) counts[cid] = (counts[cid] || 0) + 1;
      }
      res.json(counts);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Unlinked tests: no matching client in body_clients or fitbase_clients_cache ──

  r.get('/kviz/api/inbody/unlinked', async (req, res) => {
    const session = getSession(req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      const { data, error } = await supabase.from('inbody_tests')
        .select('id, inbody_id, tested_at, phone, weight, bfm, smm, inbody_score, source, phone_digits')
        .is('phone', null)
        .order('tested_at', { ascending: false })
        .limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
