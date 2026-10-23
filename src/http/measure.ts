import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { addClientNote, paginateGet, rawGet, FITBASE_PAGE_SIZE } from './fitbase';

const CIRC_FIELDS = ['neck','chest','arm_l','arm_r','waist','belly','glutes','thigh_l','thigh_r','shin_l','shin_r'] as const;

function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  return null;
}

// Yekaterinburg = UTC+5
function yekDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}
function todayYek(): string { return yekDay(new Date().toISOString()); }
function isSameDayYek(a: string, b: string): boolean { return yekDay(a) === yekDay(b); }

function validateMeasurement(body: Record<string, unknown>): { ok: true; data: Record<string, number | null> } | { ok: false; error: string } {
  const out: Record<string, number | null> = {};
  const w = body.weight;
  if (w !== undefined && w !== null && w !== '') {
    const n = Number(String(w).replace(',', '.'));
    if (isNaN(n) || n < 30 || n > 250) return { ok: false, error: 'Вес: от 30 до 250 кг' };
    out.weight = Math.round(n * 10) / 10;
  } else {
    out.weight = null;
  }
  for (const f of CIRC_FIELDS) {
    const v = String((body as Record<string, unknown>)[f] ?? '').replace(',', '.');
    const n = Number(v);
    if (isNaN(n) || n < 10 || n > 200) return { ok: false, error: `${f}: введите значение от 10 до 200 см` };
    out[f] = Math.round(n * 10) / 10;
  }
  return { ok: true, data: out };
}

type Meas = Record<string, unknown>;

function fmtDiff(d: number): string {
  return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1);
}

function buildFitbaseComment(m: Meas, prev: Meas | null, start: Meas | null): string {
  const dateStr = new Date(String(m.measured_at)).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const isFirst = !prev;
  const header = isFirst
    ? `📏 Стартовый замер от ${dateStr} (${m.consultant})`
    : `📏 Замер №${m.measure_no} от ${dateStr} (${m.consultant})`;

  const lines = [header];
  const total = Number(m.total_cm ?? 0);

  if (m.weight != null) {
    let wLine = `Вес: ${Number(m.weight).toFixed(1)} кг`;
    if (prev?.weight != null) {
      const dp = Number(m.weight) - Number(prev.weight);
      wLine += ` (${fmtDiff(dp)} к прошлому`;
      if (start && start !== prev && start.weight != null) {
        wLine += `, ${fmtDiff(Number(m.weight) - Number(start.weight))} со старта`;
      }
      wLine += ')';
    }
    lines.push(wLine);
  }

  const prevTotal = prev ? Number(prev.total_cm ?? 0) : null;
  const startTotal = start && start !== prev ? Number(start.total_cm ?? 0) : null;
  let tLine = `Сумма обхватов: ${total.toFixed(1)} см`;
  if (prevTotal !== null) {
    tLine += ` (${fmtDiff(total - prevTotal)} к прошлому`;
    if (startTotal !== null) tLine += `, ${fmtDiff(total - startTotal)} со старта`;
    tLine += ')';
  }
  lines.push(tLine);

  const waist  = Number(m.waist   ?? 0);
  const belly  = Number(m.belly   ?? 0);
  const lThigh = Number(m.thigh_l ?? 0);
  const rThigh = Number(m.thigh_r ?? 0);

  let kLine = `Талия ${waist.toFixed(1)}`;
  if (prev?.waist != null) kLine += ` (${fmtDiff(waist - Number(prev.waist))})`;
  kLine += ` · Живот ${belly.toFixed(1)}`;
  if (prev?.belly != null) kLine += ` (${fmtDiff(belly - Number(prev.belly))})`;
  kLine += ` · Бёдра Л/П ${lThigh.toFixed(1)}/${rThigh.toFixed(1)}`;
  if (prev?.thigh_l != null && prev?.thigh_r != null) {
    kLine += ` (${fmtDiff(lThigh - Number(prev.thigh_l))}/${fmtDiff(rThigh - Number(prev.thigh_r))})`;
  }
  lines.push(kLine);

  return lines.join('\n');
}

async function postFitbaseComment(measurementId: string, clientId: string): Promise<void> {
  const { data: client } = await supabase.from('body_clients').select('fitbase_client_id').eq('id', clientId).single();
  if (!client?.fitbase_client_id) return;

  const { data: allM } = await supabase
    .from('body_measurements').select('*').eq('client_id', clientId)
    .order('measured_at', { ascending: true });
  const sorted = (allM || []) as Meas[];
  const idx = sorted.findIndex(m => m.id === measurementId);
  if (idx === -1) return;
  const m     = sorted[idx];
  const prev  = idx > 0 ? sorted[idx - 1] : null;
  const start = idx > 0 ? sorted[0] : null;

  const comment = buildFitbaseComment(m, prev, start);
  await addClientNote(Number(client.fitbase_client_id), comment);
  await supabase.from('body_measurements').update({ fitbase_comment_at: new Date().toISOString() }).eq('id', measurementId);
}

// ── Auto-link body_clients to fitbase_clients_cache by phone ──────────────────

async function autoLinkClients(): Promise<number> {
  const { data: unlinked } = await supabase
    .from('body_clients').select('id, phone').is('fitbase_client_id', null);
  if (!unlinked?.length) return 0;

  const phones = unlinked.map(c => c.phone).filter(Boolean) as string[];
  if (!phones.length) return 0;

  const { data: cached } = await supabase
    .from('fitbase_clients_cache').select('fitbase_client_id, phone').in('phone', phones);
  if (!cached?.length) return 0;

  const phoneMap = new Map<string, number[]>();
  for (const c of cached) {
    if (!c.phone) continue;
    const arr = phoneMap.get(c.phone) || [];
    arr.push(Number(c.fitbase_client_id));
    phoneMap.set(c.phone, arr);
  }

  let linked = 0;
  for (const client of unlinked) {
    if (!client.phone) continue;
    const matches = phoneMap.get(client.phone);
    if (matches?.length === 1) {
      await supabase.from('body_clients').update({ fitbase_client_id: matches[0] }).eq('id', client.id);
      linked++;
    }
  }
  return linked;
}

// ── Shared sync logic ─────────────────────────────────────────────────────────

async function runClientsSync(): Promise<{ ok: true; total: number; upserted: number; linked: number; pages: number; elapsed_ms: number; last_sync_at: string }> {
  const startMs = Date.now();
  const clients = await paginateGet('/client', { page_size: FITBASE_PAGE_SIZE }, 'clients-sync');
  const pages   = Math.ceil(clients.length / FITBASE_PAGE_SIZE) || 1;

  const rows = clients
    .map(c => {
      // Fitbase uses name=Имя, surname=Фамилия (not first_name/last_name)
      const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
      const rawFirst = String(c.name    || '').trim();
      const rawLast  = String(c.surname || '').trim();
      const name = [cap(rawFirst), cap(rawLast)].filter(Boolean).join(' ');

      // Phone is in contacts[].contact where contact_type === 'phone'
      let phoneRaw = '';
      if (Array.isArray(c.contacts)) {
        const contacts = c.contacts as Record<string, unknown>[];
        const ph = contacts.find(ct => ct.contact_type === 'phone' && ct.priority === 1)
                ?? contacts.find(ct => ct.contact_type === 'phone');
        if (ph) phoneRaw = String(ph.contact || '');
      }
      const phone = normalizePhone(phoneRaw) || (phoneRaw || null);

      let fitbaseUpdatedAt: string | null = null;
      if (c.updated_at) {
        try { fitbaseUpdatedAt = new Date(String(c.updated_at)).toISOString(); } catch { /* skip */ }
      }
      return {
        fitbase_client_id:  Number(c.id),
        name,
        phone,
        raw:                c,
        fitbase_updated_at: fitbaseUpdatedAt,
        synced_at:          new Date().toISOString(),
      };
    })
    .filter(c => c.fitbase_client_id && c.name);

  let upserted = 0;
  const BS = 200;
  for (let i = 0; i < rows.length; i += BS) {
    const { error } = await supabase
      .from('fitbase_clients_cache')
      .upsert(rows.slice(i, i + BS), { onConflict: 'fitbase_client_id' });
    if (error) throw error;
    upserted += Math.min(BS, rows.length - i);
  }

  const linked = await autoLinkClients();

  const now = new Date().toISOString();
  await supabase.from('sync_state').upsert(
    { key: 'fitbase_clients', value: { last_sync_at: now, total_count: rows.length }, updated_at: now },
    { onConflict: 'key' },
  );

  return { ok: true, total: rows.length, upserted, linked, pages, elapsed_ms: Date.now() - startMs, last_sync_at: now };
}

// ── Measure router ────────────────────────────────────────────────────────────

export function buildMeasureRouter(): Router {
  const r = Router();

  // Auth guard for all /kviz/api/measure/* routes
  r.use('/kviz/api/measure', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // Manual sync button (rate-limited to once per minute)
  let lastManualSync = 0;
  r.post('/kviz/api/measure/clients/sync', async (_req, res) => {
    const now = Date.now();
    if (now - lastManualSync < 60_000) {
      res.status(429).json({ error: 'Подождите минуту перед следующим обновлением' }); return;
    }
    lastManualSync = now;
    try {
      const result = await runClientsSync();
      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Client search ──────────────────────────────────────────────────────────

  r.get('/kviz/api/measure/clients', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) { res.json([]); return; }
    try {
      const digits = q.replace(/\D/g, '');

      const phoneFilter = digits.length >= 4 ? `,phone_digits.ilike.%${digits}%` : '';
      const [bcRes, fcRes] = await Promise.all([
        supabase.from('body_clients')
          .select('id, name, phone, fitbase_client_id, created_at')
          .or(`name.ilike.%${q}%${phoneFilter}`)
          .limit(10),
        supabase.from('fitbase_clients_cache')
          .select('fitbase_client_id, name, phone')
          .or(`name.ilike.%${q}%${phoneFilter}`)
          .limit(10),
      ]);

      const bc = (bcRes.data || []) as Meas[];
      const fc = (fcRes.data || []) as Meas[];

      const bcIds = bc.map(c => c.id as string).filter(Boolean);
      const countMap: Record<string, number> = {};
      const lastMap: Record<string, string> = {};

      if (bcIds.length > 0) {
        const { data: cnt } = await supabase
          .from('body_measurements').select('client_id, measured_at')
          .in('client_id', bcIds).order('measured_at', { ascending: false });
        for (const m of (cnt || []) as Meas[]) {
          const cid = String(m.client_id);
          countMap[cid] = (countMap[cid] || 0) + 1;
          if (!lastMap[cid]) lastMap[cid] = String(m.measured_at);
        }
      }

      const results: Meas[] = [];
      const seenFbIds = new Set<number>();

      for (const c of bc) {
        if (c.fitbase_client_id) seenFbIds.add(Number(c.fitbase_client_id));
        results.push({
          id: c.id, name: c.name, phone: c.phone, fitbase_client_id: c.fitbase_client_id,
          source: 'measure',
          measure_count: countMap[String(c.id)] || 0,
          last_measured: lastMap[String(c.id)] || null,
        });
      }
      for (const c of fc) {
        if (seenFbIds.has(Number(c.fitbase_client_id))) continue;
        results.push({ id: null, fitbase_client_id: c.fitbase_client_id, name: c.name, phone: c.phone, source: 'fitbase', measure_count: 0, last_measured: null });
      }

      res.json(results.slice(0, 15));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/measure/clients', async (req, res) => {
    const { name, phone: rawPhone, fitbase_client_id } = req.body as Record<string, unknown>;
    const n = String(name || '').trim();
    if (!n) { res.status(400).json({ error: 'name обязателен' }); return; }
    const phone = rawPhone ? normalizePhone(String(rawPhone)) : null;
    const fbId  = fitbase_client_id ? Number(fitbase_client_id) : null;
    if (!phone && !fbId) { res.status(400).json({ error: 'Укажите телефон или выберите из Fitbase' }); return; }

    if (phone) {
      const { data: ex } = await supabase.from('body_clients').select('id, name').eq('phone', phone).maybeSingle();
      if (ex) { res.status(409).json({ error: 'Клиент с этим телефоном уже есть', existing: ex }); return; }
    }
    if (fbId) {
      const { data: ex } = await supabase.from('body_clients').select('id, name').eq('fitbase_client_id', fbId).maybeSingle();
      if (ex) { res.status(409).json({ error: 'Клиент уже добавлен', existing: ex }); return; }
    }

    const { data, error } = await supabase.from('body_clients')
      .insert({ name: n.charAt(0).toUpperCase() + n.slice(1), phone: phone || null, fitbase_client_id: fbId })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.patch('/kviz/api/measure/clients/:id', async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      const allowed: Record<string, unknown> = {};
      if (b.fitbase_client_id !== undefined) allowed.fitbase_client_id = b.fitbase_client_id != null ? Number(b.fitbase_client_id) : null;
      if (!Object.keys(allowed).length) { res.status(400).json({ error: 'Нечего обновлять' }); return; }
      const { data: upd, error } = await supabase.from('body_clients').update(allowed).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(upd);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/measure/clients/:id', async (req, res) => {
    try {
      const { data: client, error } = await supabase.from('body_clients').select('*').eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Клиент не найден' }); return; }
      const { data: ms } = await supabase.from('body_measurements').select('*')
        .eq('client_id', req.params.id).order('measured_at', { ascending: true });
      res.json({ ...client, measurements: ms || [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/measure/clients/:id/results', async (req, res) => {
    const { data, error } = await supabase.from('studio_results').select('*').eq('client_id', req.params.id).maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/measure/clients/:id/results', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session?.display_name) { res.status(401).json({ error: 'Нет сессии' }); return; }
      const { data: ms, error: msError } = await supabase.from('body_measurements').select('measure_no,total_cm,weight,measured_at')
        .eq('client_id', req.params.id).order('measure_no', { ascending: true });
      if (msError) { res.status(500).json({ error: msError.message }); return; }
      if (!ms?.length) { res.status(400).json({ error: 'У клиента пока нет замеров' }); return; }
      const first = ms[0], last = ms[ms.length - 1];
      const cmLost = Math.max(0, Number(first.total_cm ?? 0) - Number(last.total_cm ?? 0));
      const kgLost = first.weight != null && last.weight != null ? Math.max(0, Number(first.weight) - Number(last.weight)) : 0;
      if (cmLost <= 0 && kgLost <= 0) { res.status(400).json({ error: 'Потерь со старта пока нет' }); return; }
      // fat_kg_lost: auto-calc from InBody (first test after first measurement − last test)
      let fatKgLost: number | null = null;
      const { data: clientRow } = await supabase.from('body_clients').select('phone_digits').eq('id', req.params.id).maybeSingle();
      if (clientRow?.phone_digits) {
        const firstDate = String(ms[0].measured_at ?? '').slice(0, 10);
        const { data: ibTests } = await supabase.from('inbody_tests')
          .select('tested_at,bfm').eq('phone_digits', clientRow.phone_digits)
          .gte('tested_at', firstDate).order('tested_at', { ascending: true });
        if (ibTests && ibTests.length >= 2) {
          const ibFirst = ibTests[0], ibLast = ibTests[ibTests.length - 1];
          if (ibFirst.bfm != null && ibLast.bfm != null) {
            fatKgLost = Math.max(0, Number(ibFirst.bfm) - Number(ibLast.bfm));
          }
        }
      }
      const row = { client_id: req.params.id, from_measure_no: 1, to_measure_no: last.measure_no,
        cm_lost: cmLost, kg_lost: kgLost, fat_kg_lost: fatKgLost, sent_by: session.display_name, sent_at: new Date().toISOString() };
      const { data, error } = await supabase.from('studio_results').upsert(row, { onConflict: 'client_id' }).select('*').single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Measurements ───────────────────────────────────────────────────────────

  r.post('/kviz/api/measure/measurements', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const client_id  = String(body.client_id  || '').trim();
    const session    = getSession(req);
    const consultant = session?.display_name || '';
    const measured_at = String(body.measured_at || '').trim();

    if (!client_id)   { res.status(400).json({ error: 'client_id обязателен' }); return; }
    if (!consultant)  { res.status(401).json({ error: 'Нет сессии' }); return; }
    if (!measured_at || measured_at > todayYek()) {
      res.status(400).json({ error: 'Дата не может быть в будущем' }); return;
    }

    const val = validateMeasurement(body);
    if (!val.ok) { res.status(400).json({ error: val.error }); return; }

    const { data: client } = await supabase.from('body_clients').select('id, fitbase_client_id').eq('id', client_id).single();
    if (!client) { res.status(404).json({ error: 'Клиент не найден' }); return; }

    const { data: m, error } = await supabase.from('body_measurements')
      .insert({ client_id, consultant, measured_at, ...val.data })
      .select('*').single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json(m);
  });

  r.get('/kviz/api/measure/measurements', async (req, res) => {
    try {
      let q = supabase.from('body_measurements')
        .select('*, body_clients!inner(name, phone, fitbase_client_id)')
        .order('measured_at', { ascending: false }).limit(500);
      if (req.query.from)       q = q.gte('measured_at', req.query.from as string);
      if (req.query.to)         q = q.lte('measured_at', req.query.to as string);
      if (req.query.client_id)  q = q.eq('client_id', req.query.client_id as string);
      if (req.query.consultant) q = (q as any).ilike('consultant', `%${req.query.consultant}%`);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      const ids = [...new Set((data || []).map((m: any) => m.client_id))];
      const { data: results } = ids.length ? await supabase.from('studio_results').select('client_id,cm_lost,kg_lost,sent_by,sent_at').in('client_id', ids) : { data: [] };
      const byClient = new Map((results || []).map((x: any) => [x.client_id, x]));
      res.json((data || []).map((m: any) => ({ ...m, studio_result: byClient.get(m.client_id) || null })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/measure/measurements/:id', async (req, res) => {
    try {
      const { data: existing, error: fe } = await supabase.from('body_measurements').select('*').eq('id', req.params.id).single();
      if (fe || !existing) { res.status(404).json({ error: 'Замер не найден' }); return; }
      if (!isSameDayYek(String(existing.created_at), new Date().toISOString())) {
        res.status(409).json({ error: 'Замер можно менять только в день создания' }); return;
      }

      const body = req.body as Record<string, unknown>;
      const merged = { ...existing, ...body };
      const val = validateMeasurement(merged);
      if (!val.ok) { res.status(400).json({ error: val.error }); return; }

      const session       = getSession(req);
      const consultantName = session?.display_name || String(existing.consultant);
      const measured_at   = body.measured_at ? String(body.measured_at) : String(existing.measured_at);
      if (measured_at > todayYek()) { res.status(400).json({ error: 'Дата не может быть в будущем' }); return; }

      const nowHHMM = new Date(Date.now() + 5 * 3600_000).toISOString().slice(11, 16);
      const note = `исправлено ${consultantName} ${nowHHMM}`;

      const { data: updated, error } = await supabase.from('body_measurements')
        .update({ ...val.data, consultant: consultantName, measured_at, note, updated_at: new Date().toISOString(), fitbase_comment_at: null })
        .eq('id', req.params.id).select('*').single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      res.json(updated);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/measure/measurements/:id', async (req, res) => {
    try {
      const { data: existing } = await supabase.from('body_measurements').select('created_at').eq('id', req.params.id).single();
      if (!existing) { res.status(404).json({ error: 'Замер не найден' }); return; }
      if (!isSameDayYek(String(existing.created_at), new Date().toISOString())) {
        res.status(409).json({ error: 'Замер можно менять только в день создания' }); return;
      }
      await supabase.from('body_measurements').delete().eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/measure/measurements/:id/fitbase', async (req, res) => {
    try {
      const { data: m } = await supabase.from('body_measurements').select('client_id').eq('id', req.params.id).single();
      if (!m) { res.status(404).json({ error: 'Замер не найден' }); return; }
      await postFitbaseComment(req.params.id, String(m.client_id));
      const { data: upd } = await supabase.from('body_measurements').select('fitbase_comment_at').eq('id', req.params.id).single();
      res.json({ ok: true, fitbase_comment_at: upd?.fitbase_comment_at ?? new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Share link (staff-authenticated) ────────────────────────────────────────

  r.get('/kviz/api/measure/clients/:id/share', async (req, res) => {
    try {
      const { data: c } = await supabase.from('body_clients').select('share_token').eq('id', req.params.id).single();
      if (!c) { res.status(404).json({ error: 'Клиент не найден' }); return; }
      let token = c.share_token as string | null;
      if (!token) {
        token = crypto.randomBytes(18).toString('base64url'); // 24 URL-safe chars
        const { error } = await supabase.from('body_clients').update({ share_token: token }).eq('id', req.params.id);
        if (error) { res.status(500).json({ error: error.message }); return; }
      }
      res.json({ token, url: `/r/${token}` });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/measure/clients/:id/share/refresh', async (req, res) => {
    try {
      const token = crypto.randomBytes(18).toString('base64url');
      const { error } = await supabase.from('body_clients').update({ share_token: token }).eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ token, url: `/r/${token}` });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}

// Fitbase clients sync — cron endpoint + shared runClientsSync
export function buildClientsSyncRoute(): Router {
  const r = Router();

  r.get('/run/clients-sync', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers['x-cron-secret'] !== secret && req.query.key !== secret && req.query.secret !== secret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const result = await runClientsSync();
      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Debug: returns 2 raw Fitbase client objects (phones masked) to verify field names
  r.get('/run/clients-debug', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers['x-cron-secret'] !== secret && req.query.key !== secret && req.query.secret !== secret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const resp  = await rawGet('/client?page_size=2');
      const items = (resp.items || []) as Record<string, unknown>[];
      const masked = items.map(c => {
        const out: Record<string, unknown> = { ...c };
        for (const k of ['phone', 'phones', 'mobile']) {
          if (!out[k]) continue;
          if (typeof out[k] === 'string') {
            const s = String(out[k]);
            out[k] = s.length > 2 ? s.slice(0, -2) + 'XX' : 'XX';
          } else if (Array.isArray(out[k])) {
            out[k] = (out[k] as unknown[]).map(p => {
              if (typeof p === 'object' && p !== null) {
                const po = { ...(p as Record<string, unknown>) };
                if (po.number) po.number = String(po.number).slice(0, -2) + 'XX';
                return po;
              }
              return p;
            });
          }
        }
        return out;
      });
      res.json(masked);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Migrate InBody clients → body_clients (idempotent) ───────────────────────
  r.post('/kviz/api/measure/migrate-inbody', async (req, res) => {
    try {
      const session = getSession(req);
      if (session?.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }

      // Get all unique phone_digits from inbody_tests
      const { data: ibRows } = await supabase.from('inbody_tests').select('phone_digits,phone').not('phone_digits', 'is', null);
      const uniqueDigits = [...new Set((ibRows ?? []).map((r: Record<string,unknown>) => r.phone_digits as string).filter(Boolean))];
      if (!uniqueDigits.length) { res.json({ added: 0, already: 0 }); return; }

      // Existing body_clients by phone_digits
      const { data: existing } = await supabase.from('body_clients').select('phone_digits').in('phone_digits', uniqueDigits);
      const existingSet = new Set((existing ?? []).map((c: Record<string,unknown>) => c.phone_digits as string));

      const newDigits = uniqueDigits.filter(d => !existingSet.has(d));
      if (!newDigits.length) { res.json({ added: 0, already: uniqueDigits.length }); return; }

      // Lookup names from fitbase_clients_cache
      const { data: fbRows } = await supabase.from('fitbase_clients_cache').select('name,phone,phone_digits').in('phone_digits', newDigits);
      type FbC = { name: string; phone: string | null; phone_digits: string };
      const fbMap = new Map((fbRows ?? [] as FbC[]).map((c: FbC) => [c.phone_digits, c]));

      // Build insert rows — one per new phone_digits
      const phoneByDigits = new Map((ibRows ?? []).map((r: Record<string,unknown>) => [r.phone_digits as string, r.phone as string | null]));
      const toInsert = newDigits.map(d => {
        const fb = fbMap.get(d);
        const phone = fb?.phone ?? phoneByDigits.get(d) ?? null;
        const name = fb?.name ?? (phone ?? d);
        return { name, phone };
      });

      // Insert in batches of 100
      let added = 0;
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from('body_clients').insert(toInsert.slice(i, i + 100));
        if (error) { res.status(500).json({ error: error.message }); return; }
        added += Math.min(100, toInsert.length - i);
      }
      res.json({ added, already: existingSet.size });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Bulk results: calculate losses for all clients ────────────────────────────
  async function calcAllResults(sentBy: string) {
    const { data: allClients } = await supabase.from('body_clients').select('id,phone_digits');
    const clients = (allClients ?? []) as Array<{ id: string; phone_digits: string | null }>;
    if (!clients.length) return { rows: [], skipped: 0 };

    // All measurements grouped by client_id
    const { data: allMs } = await supabase.from('body_measurements')
      .select('client_id,measure_no,measured_at,total_cm,weight').order('measure_no', { ascending: true });
    const msMap = new Map<string, Array<Record<string,unknown>>>();
    for (const m of (allMs ?? [])) {
      const cid = m.client_id as string;
      if (!msMap.has(cid)) msMap.set(cid, []);
      msMap.get(cid)!.push(m);
    }

    // All InBody tests grouped by phone_digits
    const { data: allIb } = await supabase.from('inbody_tests')
      .select('phone_digits,tested_at,weight,bfm').order('tested_at', { ascending: true });
    const ibMap = new Map<string, Array<Record<string,unknown>>>();
    for (const t of (allIb ?? [])) {
      const d = t.phone_digits as string | null;
      if (!d) continue;
      if (!ibMap.has(d)) ibMap.set(d, []);
      ibMap.get(d)!.push(t);
    }

    const rows: Array<{ client_id: string; cm_lost: number; kg_lost: number; fat_kg_lost: number | null; sent_by: string; sent_at: string }> = [];
    let skipped = 0;
    const now = new Date().toISOString();

    for (const { id, phone_digits } of clients) {
      const ms = msMap.get(id) ?? [];
      const ibTests = phone_digits ? (ibMap.get(phone_digits) ?? []) : [];
      let cm_lost = 0, kg_lost = 0, fat_kg_lost: number | null = null;

      if (ms.length >= 2) {
        const first = ms[0], last = ms[ms.length - 1];
        cm_lost    = Math.max(0, Number(first.total_cm ?? 0) - Number(last.total_cm ?? 0));
        kg_lost    = first.weight != null && last.weight != null
          ? Math.max(0, Number(first.weight) - Number(last.weight)) : 0;
        // fat: first IB test at or after first measurement date
        if (ibTests.length >= 2) {
          const firstDate = String(first.measured_at ?? '').slice(0, 10);
          const afterFirst = ibTests.filter(t => String(t.tested_at ?? '').slice(0, 10) >= firstDate);
          const ibRef = afterFirst.length ? afterFirst : ibTests;
          const ibLast = ibRef[ibRef.length - 1];
          if (ibRef[0].bfm != null && ibLast.bfm != null)
            fat_kg_lost = Math.max(0, Number(ibRef[0].bfm) - Number(ibLast.bfm));
        }
      } else if (ms.length === 0 && ibTests.length >= 1) {
        // InBody-only
        if (ibTests.length >= 2) {
          const ib0 = ibTests[0], ibN = ibTests[ibTests.length - 1];
          kg_lost = ib0.weight != null && ibN.weight != null
            ? Math.max(0, Number(ib0.weight) - Number(ibN.weight)) : 0;
          fat_kg_lost = ib0.bfm != null && ibN.bfm != null
            ? Math.max(0, Number(ib0.bfm) - Number(ibN.bfm)) : null;
        }
      }

      if (cm_lost <= 0 && kg_lost <= 0 && (fat_kg_lost == null || fat_kg_lost <= 0)) { skipped++; continue; }
      rows.push({ client_id: id, cm_lost, kg_lost, fat_kg_lost: fat_kg_lost ?? null, sent_by: sentBy, sent_at: now });
    }
    return { rows, skipped };
  }

  r.get('/kviz/api/measure/bulk-results/preview', async (req, res) => {
    try {
      const session = getSession(req);
      if (session?.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
      const { rows } = await calcAllResults(session.display_name);
      if (!rows.length) { res.json({ will_add: 0, will_update: 0, delta_cm: 0, delta_kg: 0, delta_fat: 0 }); return; }

      const clientIds = rows.map(r => r.client_id);
      const { data: existing } = await supabase.from('studio_results').select('client_id,cm_lost,kg_lost,fat_kg_lost').in('client_id', clientIds);
      const existMap = new Map((existing ?? []).map((e: Record<string,unknown>) => [e.client_id as string, e]));

      let will_add = 0, will_update = 0, delta_cm = 0, delta_kg = 0, delta_fat = 0;
      for (const r of rows) {
        const ex = existMap.get(r.client_id);
        if (!ex) {
          will_add++;
          delta_cm  += r.cm_lost;
          delta_kg  += r.kg_lost;
          delta_fat += r.fat_kg_lost ?? 0;
        } else {
          const changed = Math.abs(Number(ex.cm_lost) - r.cm_lost) > 0.01
            || Math.abs(Number(ex.kg_lost) - r.kg_lost) > 0.01
            || Math.abs(Number(ex.fat_kg_lost ?? 0) - (r.fat_kg_lost ?? 0)) > 0.01;
          if (changed) {
            will_update++;
            delta_cm  += r.cm_lost  - Number(ex.cm_lost ?? 0);
            delta_kg  += r.kg_lost  - Number(ex.kg_lost ?? 0);
            delta_fat += (r.fat_kg_lost ?? 0) - Number(ex.fat_kg_lost ?? 0);
          }
        }
      }
      res.json({ will_add, will_update, delta_cm, delta_kg, delta_fat });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/measure/bulk-results', async (req, res) => {
    try {
      const session = getSession(req);
      if (session?.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
      const { rows } = await calcAllResults(session.display_name);
      if (!rows.length) { res.json({ added: 0, updated: 0 }); return; }

      const clientIds = rows.map(r => r.client_id);
      const { data: existing } = await supabase.from('studio_results').select('client_id,cm_lost,kg_lost,fat_kg_lost').in('client_id', clientIds);
      const existMap = new Map((existing ?? []).map((e: Record<string,unknown>) => [e.client_id as string, e]));

      const toUpsert = rows.filter(r => {
        const ex = existMap.get(r.client_id);
        if (!ex) return true;
        return Math.abs(Number(ex.cm_lost) - r.cm_lost) > 0.01
          || Math.abs(Number(ex.kg_lost) - r.kg_lost) > 0.01
          || Math.abs(Number(ex.fat_kg_lost ?? 0) - (r.fat_kg_lost ?? 0)) > 0.01;
      });

      if (!toUpsert.length) { res.json({ added: 0, updated: 0 }); return; }

      const newIds = new Set(toUpsert.filter(r => !existMap.has(r.client_id)).map(r => r.client_id));
      let added = 0, updated = 0;
      for (let i = 0; i < toUpsert.length; i += 100) {
        const { error } = await supabase.from('studio_results').upsert(toUpsert.slice(i, i + 100), { onConflict: 'client_id' });
        if (error) { res.status(500).json({ error: error.message }); return; }
      }
      for (const r of toUpsert) { if (newIds.has(r.client_id)) added++; else updated++; }
      res.json({ added, updated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
