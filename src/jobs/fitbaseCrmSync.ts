import { supabase } from '../db/supabase';
import { paginateGet, rawGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID, TRIAL_SERVICE_NAMES, isTrialServiceName } from '../config';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(build: (off: number, lim: number) => any): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const all: Record<string, unknown>[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await build(off, PAGE);
    if (error) throw new Error((error as { message: string }).message);
    if (!data?.length) break;
    all.push(...(data as Record<string, unknown>[]));
    if ((data as unknown[]).length < PAGE) break;
    off += PAGE;
  }
  return all;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  return n > 0 ? yekDate(n * 1000) : null;
}

const YEK_MS = 5 * 3600_000;

function yekDate(ts: number): string {
  const d = new Date(ts + YEK_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  if (d.length === 10) return '+7' + d;
  return null;
}

async function syncLeads(): Promise<number> {
  const items = await paginateGet('/lead', { page_size: 100 }, 'crm-sync-leads');
  if (!items.length) return 0;

  const rows = items.map(lead => {
    const l = lead as Record<string, unknown>;
    const ts = Number(l.created_at ?? 0) * 1000;
    const createdAt = ts > 0 ? new Date(ts).toISOString() : new Date().toISOString();
    const createdDate = ts > 0 ? yekDate(ts) : new Date().toISOString().slice(0, 10);
    const updTs = l.updated_at ? Number(l.updated_at) * 1000 : null;
    const step = l.funnel_step as Record<string, unknown> | null ?? null;
    const funnel = (step?.purchase_funnel as Record<string, unknown> | null)?.name as string ?? null;
    const stage = step?.name as string ?? null;
    const source = (l.advertising_source as Record<string, unknown> | null)?.name as string ?? null;
    const manager_obj = l.manager as Record<string, unknown> | null ?? null;
    return {
      fitbase_id: String(l.id),
      created_at: createdAt,
      created_date: createdDate,
      source,
      funnel,
      stage,
      status: step?.id != null ? String(step.id) : null,
      manager: (manager_obj?.full_name ?? null) as string | null,
      client_fitbase_id: l.client_id != null ? Number(l.client_id) : null,
      client_name: ([l.name, l.surname].filter(Boolean).join(' ') || null) as string | null,
      client_phone: normalizePhone(l.phone as string | null),
      updated_at: updTs ? new Date(updTs).toISOString() : null,
      raw: l,
    };
  });

  const CHUNK = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('fitbase_leads')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'fitbase_id' })
      .select('fitbase_id');
    if (error) throw new Error(`[crm-sync] leads upsert: ${error.message}`);
    upserted += (data || []).length;
  }
  return upserted;
}

async function syncVisits(): Promise<number> {
  const items = await paginateGet('/schedule-registration', { page_size: 100 }, 'crm-sync-visits');
  if (!items.length) return 0;

  // Batch-fetch client names/phones from fitbase_clients_cache by client_id
  const clientIds = [...new Set(
    items.map(v => (v as Record<string, unknown>).client_id).filter((id): id is number => typeof id === 'number' && id > 0)
  )];
  const cacheMap = new Map<number, { name: string | null; phone: string | null }>();
  if (clientIds.length) {
    const { data: cached } = await supabase
      .from('fitbase_clients_cache')
      .select('fitbase_client_id,name,phone')
      .in('fitbase_client_id', clientIds);
    for (const c of (cached || [])) {
      cacheMap.set(Number(c.fitbase_client_id), { name: (c.name ?? null) as string | null, phone: (c.phone ?? null) as string | null });
    }
  }

  const rows: Record<string, unknown>[] = [];
  for (const visit of items) {
    const v = visit as Record<string, unknown>;
    const event    = v.event    as Record<string, unknown> | null ?? null;
    const training = event?.training as Record<string, unknown> | null ?? null;
    const trainers = Array.isArray(event?.trainers) ? (event!.trainers as Record<string, unknown>[]) : [];
    const place    = event?.place as Record<string, unknown> | null ?? null;

    const clientFitbaseId = v.client_id != null ? Number(v.client_id) : null;
    const cached = clientFitbaseId != null ? cacheMap.get(clientFitbaseId) ?? null : null;

    const dateStr  = event?.date as string | null ?? null;       // "2026-10-25"
    const timeRaw  = event?.time_start as string | null ?? null; // "08:00:00"
    const timeStr  = timeRaw ? timeRaw.slice(0, 5) : null;       // "08:00"
    const bookedTs = v.created_at ? Number(v.created_at) * 1000 : null;

    let visit_at: string | null = null;
    if (dateStr) {
      try {
        const dtStr = timeStr ? `${dateStr}T${timeStr}:00+05:00` : `${dateStr}T00:00:00+05:00`;
        const d = new Date(dtStr);
        if (!isNaN(d.getTime())) visit_at = d.toISOString();
        else console.warn(`[crm-sync] invalid visit_at: ${dtStr} (id=${v.id})`);
      } catch {
        console.warn(`[crm-sync] visit_at parse error for id=${v.id}: ${dateStr} ${timeRaw}`);
      }
    }

    // client_service / client_contract → abonement name (Fitbase may send object or string)
    const csRaw = v.client_service as Record<string, unknown> | string | null ?? null;
    const ccRaw = v.client_contract as Record<string, unknown> | string | null ?? null;
    const nameOf = (raw: Record<string, unknown> | string | null): string | null =>
      typeof raw === 'string' ? raw : raw != null ? (raw.name as string ?? null) : null;
    const abonement = nameOf(csRaw) ?? nameOf(ccRaw) ?? null;

    const isTrial =
      training?.id === TRIAL_TRAINING_ID ||
      isTrialServiceName(training?.name as string | null) ||
      isTrialServiceName(abonement);

    rows.push({
      fitbase_id:        String(v.id),
      client_fitbase_id: clientFitbaseId,
      client_name:       cached?.name ?? null,
      client_phone:      cached?.phone ?? null,
      is_trial:          isTrial,
      booked_at:         bookedTs ? new Date(bookedTs).toISOString() : null,
      visit_at,
      visit_date:        dateStr,
      status:            v.status != null ? Number(v.status) : null,
      service:           (training?.name ?? null) as string | null,
      manager:           (trainers[0]?.full_name as string ?? null),
      resource:          (place?.name as string ?? null),
      abonement,
      raw: v,
    });
  }

  const CHUNK = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('fitbase_visits')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'fitbase_id' })
      .select('fitbase_id');
    if (error) throw new Error(`[crm-sync] visits upsert: ${error.message}`);
    upserted += (data || []).length;
  }
  return upserted;
}

async function syncContracts(): Promise<number> {
  // Collect client_ids from operations with item_type = 'contract'
  const opsData = await fetchAll((off, lim) =>
    supabase.from('fitbase_operations').select('raw').range(off, off + lim - 1)
  );
  const clientIds = new Set<number>();
  for (const op of opsData) {
    const raw = op.raw as Record<string, unknown>;
    if (raw?.item_type === 'contract') {
      const cid = (raw.client as Record<string, unknown> | null)?.id;
      if (cid != null) clientIds.add(Number(cid));
    }
  }
  if (clientIds.size === 0) return 0;

  let upserted = 0;
  const ids = [...clientIds];
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await sleep(300 + Math.random() * 200);
    const cid = ids[i];
    try {
      const resp = await rawGet(`/client-contract?client_id=${cid}`);
      const items = (resp.items ?? []) as Record<string, unknown>[];
      if (!items.length) continue;
      const rows = items.map(c => {
        const ticket = c.ticket as Record<string, unknown> | null;
        const ci = ticket?.contract_item as Record<string, unknown> | null;
        return {
          fitbase_id: Number(c.id),
          client_fitbase_id: cid,
          name: (ci?.name ?? (c.item as Record<string, unknown> | null)?.name ?? null) as string | null,
          status: c.deleted_at ? 'deleted' : c.closed ? 'closed' : 'active',
          price: Number(c.price ?? c.price_full ?? 0),
          payment_date: toDate(c.payment_date),
          begin_date: toDate(c.begin_date),
          activation_date: toDate(c.activation_date),
          end_date: toDate(c.end_date),
          raw: c,
          synced_at: new Date().toISOString(),
        };
      });
      const { data, error } = await supabase
        .from('fitbase_contracts')
        .upsert(rows, { onConflict: 'fitbase_id' })
        .select('fitbase_id');
      if (error) console.warn(`[crm-sync] contracts client=${cid}: ${error.message}`);
      else upserted += (data ?? []).length;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/4\d\d/.test(msg)) { console.warn(`[crm-sync] contracts 4xx client=${cid}`); continue; }
      throw e;
    }
  }
  return upserted;
}

export async function runFitbaseCrmSync(): Promise<Record<string, unknown>> {
  console.log('[crm-sync] starting');
  let leads = 0, visits = 0, contracts = 0;
  const errors: string[] = [];
  try { leads = await syncLeads(); } catch (e) { const m = (e as Error).message; errors.push(`leads: ${m}`); console.error('[crm-sync] leads error:', m); }
  try { visits = await syncVisits(); } catch (e) { const m = (e as Error).message; errors.push(`visits: ${m}`); console.error('[crm-sync] visits error:', m); }
  try { contracts = await syncContracts(); } catch (e) { const m = (e as Error).message; errors.push(`contracts: ${m}`); console.error('[crm-sync] contracts error:', m); }
  console.log(`[crm-sync] done: leads=${leads} visits=${visits} contracts=${contracts}${errors.length ? ` errors=[${errors.join('; ')}]` : ''}`);
  return { leads, visits, contracts, ...(errors.length ? { errors } : {}) };
}
