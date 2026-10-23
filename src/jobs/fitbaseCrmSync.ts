import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID } from '../config';

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
    const client = l.client as Record<string, unknown> | null ?? null;
    const source = (l.advertising_source as Record<string, unknown> | null)?.name as string ?? null;
    const responsible = l.responsible as Record<string, unknown> | null ?? null;
    return {
      fitbase_id: String(l.id),
      created_at: createdAt,
      created_date: createdDate,
      source,
      funnel,
      stage,
      status: step?.id != null ? String(step.id) : null,
      manager: (responsible?.full_name ?? null) as string | null,
      client_fitbase_id: client?.id != null ? Number(client.id) : null,
      client_name: (client?.full_name ?? l.name ?? null) as string | null,
      client_phone: normalizePhone((client?.phone ?? l.phone) as string | null),
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

  const rows = items.map(visit => {
    const v = visit as Record<string, unknown>;
    const client = v.client as Record<string, unknown> | null ?? null;
    // training, date and time are nested inside the event object
    const event = v.event as Record<string, unknown> | null ?? null;
    const training = event?.training as Record<string, unknown> | null ?? null;
    const manager = v.manager as Record<string, unknown> | null ?? null;
    const resourceRaw = v.resource as Record<string, unknown> | string | null ?? null;
    const abonementRaw = v.abonement as Record<string, unknown> | string | null ?? null;
    const dateStr = event?.date as string | null ?? null;         // "2026-10-21"
    const timeStr = event?.time_start as string | null ?? null;  // "10:00"
    const bookedTs = v.created_at ? Number(v.created_at) * 1000 : null;

    let visit_at: string | null = null;
    if (dateStr) {
      const dtStr = timeStr ? `${dateStr}T${timeStr}:00+05:00` : `${dateStr}T00:00:00+05:00`;
      visit_at = new Date(dtStr).toISOString();
    }

    return {
      fitbase_id: String(v.id),
      client_fitbase_id: client?.id != null ? Number(client.id) : null,
      client_name: (client?.full_name ?? null) as string | null,
      client_phone: normalizePhone(client?.phone as string | null),
      is_trial: training?.id === TRIAL_TRAINING_ID,
      booked_at: bookedTs ? new Date(bookedTs).toISOString() : null,
      visit_at,
      visit_date: dateStr,
      status: v.status != null ? Number(v.status) : null,
      service: (training?.name ?? null) as string | null,
      manager: (manager?.full_name ?? null) as string | null,
      // resource = аппарат (LPG machine etc), abonement = абонемент
      resource: typeof resourceRaw === 'string' ? resourceRaw : (resourceRaw?.name as string ?? null),
      abonement: typeof abonementRaw === 'string' ? abonementRaw : (abonementRaw?.name as string ?? null),
      raw: v,
    };
  });

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

export async function runFitbaseCrmSync(): Promise<Record<string, unknown>> {
  console.log('[crm-sync] starting');
  const leads = await syncLeads();
  const visits = await syncVisits();
  console.log(`[crm-sync] done: leads=${leads} visits=${visits}`);
  return { leads, visits };
}
