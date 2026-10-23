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

// Look up override phones from inbody_id_links for a list of inbody_ids
async function phoneOverrides(inbodyIds: string[]): Promise<Map<string, string>> {
  if (!inbodyIds.length) return new Map();
  const { data } = await supabase.from('inbody_id_links')
    .select('inbody_id, phone').in('inbody_id', inbodyIds);
  const m = new Map<string, string>();
  for (const r of (data || []) as { inbody_id: string; phone: string }[]) {
    m.set(r.inbody_id, r.phone);
  }
  return m;
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
      const tested_at = new Date(String(ib.measured_at)).toISOString();

      // Check inbody_id_links for an explicit phone override
      const overrides = await phoneOverrides([inbody_id]);
      const phone = overrides.get(inbody_id) ?? normalizePhone(String(ib.phone || ''));

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
        .select('id, phone, phone_digits').eq('id', clientId).maybeSingle();
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

      // Check inbody_id_links overrides for linked phones
      const linksMap = await phoneOverrides(inbodyIds);

      // Effective phone per row (override or original)
      const rowsWithPhone = rows.map(r => ({
        ...r,
        effectivePhone: linksMap.has(r.inbody_id) ? linksMap.get(r.inbody_id)! : r.phone,
      }));

      // Check client matches against body_clients + fitbase_clients_cache
      const phoneDigits = [...new Set(rowsWithPhone.map(r => r.effectivePhone?.replace(/\D/g, '')).filter(Boolean) as string[])];
      const clientDigitsSet = await knownPhoneDigitsSet(phoneDigits);
      const linked   = rowsWithPhone.filter(r => r.effectivePhone && clientDigitsSet.has(r.effectivePhone.replace(/\D/g, '')));
      const unlinked = rowsWithPhone.filter(r => !r.effectivePhone || !clientDigitsSet.has(r.effectivePhone.replace(/\D/g, '')));
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

      // Check inbody_id_links for phone overrides
      const inbodyIds = [...new Set(rows.map(r => r.inbody_id))];
      const linksMap = await phoneOverrides(inbodyIds);

      const prepared = rows.map(r => ({
        ...r,
        source: 'csv' as const,
        phone: linksMap.has(r.inbody_id) ? linksMap.get(r.inbody_id)! : r.phone,
      }));

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

      // Count without any matching client
      const phoneDigits = [...new Set(prepared.map(r => r.phone?.replace(/\D/g, '')).filter(Boolean) as string[])];
      const knownDigits = await knownPhoneDigitsSet(phoneDigits);
      const without_client = prepared.filter(r => !r.phone || !knownDigits.has(r.phone.replace(/\D/g, ''))).length;

      res.json({ ok: true, added, skipped, without_client });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Recalculate all CSV tests from stored raw ─────────────────────────────

  r.post('/kviz/api/inbody/recalculate', async (req, res) => {
    const session = getSession(req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      // Column number → data key (mirrors parseLookinBodyCSV.ts COL_KEY)
      const COL_KEY: Record<number, string> = {
        1:'id',2:'height',3:'gender',4:'age',5:'tested_at',6:'weight',7:'weight_min',8:'weight_max',
        9:'tbw',10:'tbw_min',11:'tbw_max',12:'protein',13:'protein_min',14:'protein_max',
        15:'minerals',16:'minerals_min',17:'minerals_max',18:'bfm',19:'bfm_min',20:'bfm_max',
        21:'ffm',22:'ffm_min',23:'ffm_max',24:'smm',25:'smm_min',26:'smm_max',
        27:'bmi',28:'bmi_min',29:'bmi_max',30:'pbf',31:'pbf_min',32:'pbf_max',
        33:'ffm_ra',34:'ffm_ra_pct',35:'ffm_la',36:'ffm_la_pct',37:'ffm_tr',38:'ffm_tr_pct',
        39:'ffm_rl',40:'ffm_rl_pct',41:'ffm_ll',42:'ffm_ll_pct',
        43:'bfm_ra',44:'bfm_ra_pct',45:'bfm_la',46:'bfm_la_pct',47:'bfm_tr',48:'bfm_tr_pct',
        49:'bfm_rl',50:'bfm_rl_pct',51:'bfm_ll',52:'bfm_ll_pct',
        53:'inbody_score',54:'target_weight',55:'weight_control',56:'bfm_control',57:'ffm_control',58:'bmr',
        59:'whr',60:'whr_min',61:'whr_max',62:'vfl',63:'obesity_degree',64:'obesity_degree_min',65:'obesity_degree_max',
        66:'imp20_ra',67:'imp20_la',68:'imp20_tr',69:'imp20_rl',70:'imp20_ll',
        71:'imp100_ra',72:'imp100_la',73:'imp100_tr',74:'imp100_rl',75:'imp100_ll',
        76:'abdomen_circumference',77:'growth_score',78:'child_obesity',79:'child_obesity_min',80:'child_obesity_max',
        81:'systolic',82:'diastolic',83:'pulse',84:'map',85:'pulse_pressure',86:'rpp',
        87:'smi',88:'recommended_kcal',89:'bmr_min',90:'bmr_max',
        91:'systolic2',92:'diastolic2',93:'pulse2',94:'map2',95:'pulse_pressure2',96:'rpp2',
        97:'smm_wt',98:'ffmi',99:'fmi',100:'grip_l1',101:'grip_l2',102:'grip_r1',103:'grip_r2',
      };
      const TOP_COL: Record<number, string> = {
        2:'height',4:'age',6:'weight',18:'bfm',21:'ffm',24:'smm',27:'bmi',30:'pbf',53:'inbody_score',58:'bmr',59:'whr',62:'vfl',
      };
      const STRING_COLS = new Set([1, 3, 5]);

      function parseNum(s: string): number | null {
        const t = s.trim();
        if (!t || t === '-' || t === '--') return null;
        const m = t.match(/^level\s+(\d+(?:\.\d+)?)/i);
        if (m) return parseFloat(m[1]);
        const n = parseFloat(t);
        return isNaN(n) ? null : n;
      }

      function parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
          } else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
          else cur += ch;
        }
        result.push(cur);
        return result;
      }

      // Load all CSV tests with raw stored
      const { data: tests, error: loadErr } = await supabase.from('inbody_tests')
        .select('id, raw').eq('source', 'csv').not('raw', 'is', null);
      if (loadErr) { res.status(500).json({ error: loadErr.message }); return; }

      let updated = 0;
      const CHUNK = 50;
      const toUpdate: { id: string; data: Record<string, unknown>; weight: number | null; bfm: number | null; pbf: number | null; smm: number | null; ffm: number | null; bmi: number | null; vfl: number | null; inbody_score: number | null; whr: number | null; bmr: number | null; height: number | null; age: number | null; gender: string | null }[] = [];

      for (const t of (tests || []) as { id: string; raw: string | null }[]) {
        if (!t.raw) continue;
        const cols = parseCSVLine(t.raw);
        const data: Record<string, unknown> = {};
        for (let j = 0; j < Math.min(cols.length, 103); j++) {
          const colNum = j + 1;
          const key = COL_KEY[colNum];
          if (!key) continue;
          const rawVal = (cols[j] ?? '').trim();
          data[key] = STRING_COLS.has(colNum)
            ? (rawVal === '-' || rawVal === '--' ? null : rawVal || null)
            : parseNum(rawVal);
        }
        const patch: Record<string, unknown> = { id: t.id, data };
        for (const [colNumStr, field] of Object.entries(TOP_COL)) {
          const arrIdx = parseInt(colNumStr) - 1;
          if (arrIdx >= 0 && arrIdx < cols.length) patch[field] = parseNum(cols[arrIdx] ?? '');
        }
        const genderVal = (cols[2] ?? '').trim();
        patch.gender = genderVal === '-' || genderVal === '--' ? null : genderVal || null;
        toUpdate.push(patch as typeof toUpdate[0]);
      }

      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const chunk = toUpdate.slice(i, i + CHUNK);
        const { error } = await supabase.from('inbody_tests')
          .upsert(chunk, { onConflict: 'id' });
        if (error) { res.status(500).json({ error: error.message, at_index: i }); return; }
        updated += chunk.length;
      }

      res.json({ ok: true, updated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── InBody test counts per client (for reports table) ────────────────────

  r.get('/kviz/api/inbody/counts', async (req, res) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const ids = String(req.query.client_ids || '').split(',').filter(Boolean);
      if (!ids.length) { res.json({}); return; }

      const { data: clients } = await supabase.from('body_clients')
        .select('id, phone_digits').in('id', ids);
      const phoneToClient = new Map<string, string>();
      for (const c of (clients || []) as { id: string; phone_digits: string | null }[]) {
        if (c.phone_digits) phoneToClient.set(c.phone_digits, c.id);
      }
      const phoneDigits = [...phoneToClient.keys()];
      if (!phoneDigits.length) { res.json({}); return; }

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

  // ── Unlinked tests (no matching client + not in inbody_id_links) ──────────

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

  // ── Unlinked tests for client linking dialog ──────────────────────────────

  r.get('/kviz/api/inbody/unlinked-tests', async (req, res) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      // Get all known client phone_digits
      const [{ data: bc }, { data: fcc }, { data: links }] = await Promise.all([
        supabase.from('body_clients').select('phone_digits').not('phone_digits', 'is', null),
        supabase.from('fitbase_clients_cache').select('phone_digits').not('phone_digits', 'is', null),
        supabase.from('inbody_id_links').select('inbody_id'),
      ]);
      const knownDigits = new Set([
        ...(bc  || []).map((c: Record<string, unknown>) => c.phone_digits as string),
        ...(fcc || []).map((c: Record<string, unknown>) => c.phone_digits as string),
      ]);
      const linkedIds = new Set((links || []).map((l: Record<string, unknown>) => l.inbody_id as string));

      const { data: tests, error } = await supabase.from('inbody_tests')
        .select('id, inbody_id, tested_at, gender, age, height, weight, bfm, smm, inbody_score, source, phone, phone_digits')
        .order('tested_at', { ascending: false })
        .limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }

      const q = String(req.query.q || '').toLowerCase();
      const result = (tests || []).filter((t: Record<string, unknown>) => {
        if (linkedIds.has(t.inbody_id as string)) return false;
        if (t.phone_digits && knownDigits.has(t.phone_digits as string)) return false;
        if (!q) return true;
        const id = String(t.inbody_id || '').toLowerCase();
        const dt = String(t.tested_at || '').slice(0, 10);
        return id.includes(q) || dt.includes(q);
      });

      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Link selected tests to a client ──────────────────────────────────────

  r.post('/kviz/api/inbody/link-to-client', async (req, res) => {
    const session = getSession(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const { client_id, test_ids } = req.body as { client_id: string; test_ids: string[] };
      if (!client_id || !Array.isArray(test_ids) || !test_ids.length) {
        res.status(400).json({ error: 'client_id и test_ids обязательны' }); return;
      }

      // Get client's phone
      const { data: client } = await supabase.from('body_clients')
        .select('id, phone').eq('id', client_id).maybeSingle();
      if (!client || !client.phone) { res.status(400).json({ error: 'Клиент не найден или нет телефона' }); return; }

      // Get inbody_ids for these test_ids
      const { data: tests } = await supabase.from('inbody_tests')
        .select('id, inbody_id').in('id', test_ids);
      const inbodyIds = [...new Set((tests || []).map((t: Record<string, unknown>) => t.inbody_id as string))];

      // Upsert into inbody_id_links
      const linkRows = inbodyIds.map(ibId => ({
        inbody_id: ibId,
        phone: client.phone,
        linked_by: session.display_name,
        linked_at: new Date().toISOString(),
      }));
      const { error: linkErr } = await supabase.from('inbody_id_links')
        .upsert(linkRows, { onConflict: 'inbody_id' });
      if (linkErr) { res.status(500).json({ error: linkErr.message }); return; }

      // Update phone in inbody_tests for all tests with these inbody_ids
      const { error: updateErr } = await supabase.from('inbody_tests')
        .update({ phone: client.phone }).in('inbody_id', inbodyIds);
      if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

      res.json({ ok: true, linked: inbodyIds.length });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Unlink test from client (admin) ──────────────────────────────────────

  r.post('/kviz/api/inbody/tests/:id/unlink', async (req, res) => {
    const session = getSession(req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      // Get the test
      const { data: test } = await supabase.from('inbody_tests')
        .select('id, inbody_id').eq('id', req.params.id).maybeSingle();
      if (!test) { res.status(404).json({ error: 'Тест не найден' }); return; }

      // Remove from inbody_id_links
      await supabase.from('inbody_id_links').delete().eq('inbody_id', test.inbody_id);

      // Reset phone to normalized inbody_id (may or may not be a valid phone)
      const resetPhone = normalizePhone(test.inbody_id);
      await supabase.from('inbody_tests')
        .update({ phone: resetPhone }).eq('inbody_id', test.inbody_id);

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
