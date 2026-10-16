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
      // Prefer individual name fields; skip patronymic
      const first = String(c.first_name || '').trim();
      const last  = String(c.last_name  || '').trim();
      const name  = [first, last].filter(Boolean).join(' ') || String(c.name || '').trim();

      // phones may be array [{number, is_main}], object {number}, or string
      let phoneRaw = '';
      const phonesArr = Array.isArray(c.phones) ? c.phones as Record<string, unknown>[]
                      : Array.isArray(c.phone)  ? c.phone  as Record<string, unknown>[]
                      : null;
      if (phonesArr && phonesArr.length > 0) {
        const main = phonesArr.find(p => p.is_main) ?? phonesArr[0];
        phoneRaw = String(main.number || '');
      } else if (typeof c.phone === 'object' && c.phone !== null) {
        phoneRaw = String((c.phone as Record<string, unknown>).number || '');
      } else {
        phoneRaw = String(c.phone || '');
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

  r.get('/kviz/api/measure/clients/:id', async (req, res) => {
    try {
      const { data: client, error } = await supabase.from('body_clients').select('*').eq('id', req.params.id).single();
      if (error) { res.status(404).json({ error: 'Клиент не найден' }); return; }
      const { data: ms } = await supabase.from('body_measurements').select('*')
        .eq('client_id', req.params.id).order('measured_at', { ascending: true });
      res.json({ ...client, measurements: ms || [] });
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

    let fitbase_error: string | null = null;
    if (client.fitbase_client_id) {
      try {
        await postFitbaseComment(String(m.id), client_id);
        m.fitbase_comment_at = new Date().toISOString();
      } catch (e) { fitbase_error = String(e); }
    }

    res.json({ ...m, fitbase_error });
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
      res.json(data);
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

      let fitbase_error: string | null = null;
      const { data: cl } = await supabase.from('body_clients').select('fitbase_client_id').eq('id', existing.client_id).single();
      if (cl?.fitbase_client_id) {
        try {
          await postFitbaseComment(req.params.id, String(existing.client_id));
          updated.fitbase_comment_at = new Date().toISOString();
        } catch (e) { fitbase_error = String(e); }
      }

      res.json({ ...updated, fitbase_error });
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
      res.json({ ok: true });
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

  return r;
}
