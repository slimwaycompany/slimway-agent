import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { runAutomation } from '../core/automation/engine';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function mapBookingStatus(raw: unknown): string | null {
  const n = Number(raw);
  if (n === 0) return 'booked';
  if (n === 1) return 'confirmed';
  if (n === 2) return 'cancelled';
  if (n === 3) return 'attended';
  if (n === 4) return 'no_show';
  return null;
}

// Visit history uses booked/cancelled/attended/no_show (no 'confirmed')
function mapToVisitStatus(n: number): string {
  if (n === 0 || n === 1) return 'booked';
  if (n === 2) return 'cancelled';
  if (n === 3) return 'attended';
  if (n === 4) return 'no_show';
  return 'booked';
}

// "Vacuactiv 1" → { typeCode: 'vacuactiv', num: 1 }
function parsePlaceName(name: string): { typeCode: string; num: number } | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const num = Number(parts[parts.length - 1]);
  if (!Number.isInteger(num) || num < 1) return null;
  const typeCode = parts.slice(0, -1).join('').toLowerCase();
  return { typeCode, num };
}

function toUTCIso(date: string, time: string): string {
  return new Date(`${date}T${time}+05:00`).toISOString();
}

function todayUTC5(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

type PlanItem = { id: string; device_type_code: string | null; device_type_codes: string[] | null; phase: string };
type PlanEntry = { client_plan_id: string; plan_id: string; items: PlanItem[] };

// Finds first item whose device type matches; prefers phase='active'
function findMatchingItem(items: PlanItem[], typeCode: string): PlanItem | null {
  const matches = items.filter(it =>
    it.device_type_code === typeCode ||
    (Array.isArray(it.device_type_codes) && it.device_type_codes.includes(typeCode))
  );
  return matches.find(it => it.phase === 'active') ?? matches[0] ?? null;
}

export interface BookingsImportJob {
  status: 'running' | 'done' | 'error';
  total_clients: number;
  done_clients: number;
  stats: {
    created: number;
    updated: number;
    to_virtual: number;
    to_history: number;
    skipped_no_device: number;
    skipped_unknown_status: number;
    errors: number;
  };
  to_history_reasons: { no_plan: number; no_item: number; bad_time: number; overlap: number };
  errors: string[];
  started_at: string;
  finished_at?: string;
}

let _job: BookingsImportJob | null = null;
export function getBookingsImportJob(): BookingsImportJob | null { return _job; }

export function startBookingsImport(): BookingsImportJob | null {
  if (_job?.status === 'running') return null;
  _job = {
    status: 'running',
    total_clients: 0, done_clients: 0,
    stats: { created: 0, updated: 0, to_virtual: 0, to_history: 0, skipped_no_device: 0, skipped_unknown_status: 0, errors: 0 },
    to_history_reasons: { no_plan: 0, no_item: 0, bad_time: 0, overlap: 0 },
    errors: [],
    started_at: new Date().toISOString(),
  };
  return _job;
}

export async function resetBookingsCheckpoint(): Promise<void> {
  await supabase.from('crm_settings')
    .delete().eq('branch_id', BRANCH_ID).eq('key', 'bookings_import_checkpoint');
}

export async function runBookingsImport(): Promise<void> {
  if (!_job) return;
  const job = _job;

  // Shared helper: write a registration to visit history instead of bookings
  async function saveToHistory(
    reason: 'no_plan' | 'no_item' | 'bad_time' | 'overlap',
    p: { clientId: string; fid: number; fitbaseRegId: number; statusRaw: number; date: string; trainingName: string | null },
  ) {
    const { error } = await supabase.from('crm_visit_history').upsert({
      client_id:         p.clientId,
      client_fitbase_id: p.fid,
      fitbase_reg_id:    p.fitbaseRegId,
      status:            mapToVisitStatus(p.statusRaw),
      visit_at:          p.date,
      training_name:     p.trainingName,
    }, { onConflict: 'fitbase_reg_id' });
    if (error) {
      if (job.errors.length < 20) job.errors.push(`history fid=${p.fid} reg=${p.fitbaseRegId}: ${error.message}`);
      job.stats.errors++;
    } else {
      job.stats.to_history++;
      job.to_history_reasons[reason]++;
    }
  }

  try {
    // Find trial plan by name (not hardcoded ID — plan may be recreated)
    const { data: trialRows } = await supabase
      .from('crm_plans').select('id')
      .eq('branch_id', BRANCH_ID).ilike('name', '%пробн%').limit(1);
    const trialPlanId = (trialRows?.[0] as Record<string, unknown> | undefined)?.id as string | undefined;
    if (!trialPlanId) {
      job.status = 'error';
      job.finished_at = new Date().toISOString();
      job.errors.push('Нет плана «Пробное занятие» в crm_plans — прерываем импорт');
      return;
    }

    // Load devices (excluding disabled)
    type DevRow = { id: string; type_code: string; number: number; is_virtual: boolean; session_minutes: number | null };
    const { data: devData } = await supabase
      .from('crm_devices')
      .select('id, type_code, number, is_virtual, session_minutes')
      .eq('branch_id', BRANCH_ID)
      .neq('status', 'disabled');
    const devices = (devData ?? []) as DevRow[];

    const realDeviceMap = new Map<string, DevRow>();
    const virtualByType = new Map<string, DevRow[]>();
    for (const d of devices) {
      if (!d.is_virtual) {
        realDeviceMap.set(`${d.type_code}/${d.number}`, d);
      } else {
        if (!virtualByType.has(d.type_code)) virtualByType.set(d.type_code, []);
        virtualByType.get(d.type_code)!.push(d);
      }
    }
    // Sort virtuals by number so assignment is deterministic
    for (const list of virtualByType.values()) list.sort((a, b) => a.number - b.number);

    // Load clients ordered by fitbase_client_id — required for checkpoint correctness
    const { data: clientData } = await supabase
      .from('crm_clients')
      .select('id, fitbase_client_id')
      .not('fitbase_client_id', 'is', null)
      .eq('is_deleted', false)
      .order('fitbase_client_id');
    const clients = (clientData ?? []) as Array<{ id: string; fitbase_client_id: number }>;
    job.total_clients = clients.length;

    // Load checkpoint
    const { data: cpData } = await supabase
      .from('crm_settings')
      .select('value')
      .eq('branch_id', BRANCH_ID)
      .eq('key', 'bookings_import_checkpoint')
      .maybeSingle();
    let lastFid = 0;
    if (cpData) {
      try { lastFid = Number(JSON.parse((cpData as Record<string, string>).value)?.last_fid ?? 0); } catch {}
    }

    for (let i = 0; i < clients.length; i++) {
      const { id: clientId, fitbase_client_id: fid } = clients[i];
      if (fid <= lastFid) { job.done_clients++; continue; }

      try {
        await sleep(100);
        const regsRaw = await paginateGet(
          '/schedule-registration',
          { page_size: 100, client_id: fid, date_from: '2020-01-01', date_to: todayUTC5() },
          'bookings-import',
        );
        await sleep(300 + Math.random() * 200);

        // Sort chronologically for deterministic virtual device assignment
        regsRaw.sort((a, b) => {
          const ea = ((a as Record<string,unknown>).event as Record<string,unknown>) ?? {};
          const eb = ((b as Record<string,unknown>).event as Record<string,unknown>) ?? {};
          const ka = `${ea.date ?? ''}${ea.time_start ?? ''}`;
          const kb = `${eb.date ?? ''}${eb.time_start ?? ''}`;
          return ka.localeCompare(kb);
        });

        // Load this client's plans with items (1 query per client)
        const { data: cpRows } = await supabase
          .from('crm_client_plans')
          .select('id, plan_id, fitbase_contract_id, crm_client_plan_items(id,device_type_code,device_type_codes,phase)')
          .eq('client_id', clientId)
          .not('fitbase_contract_id', 'is', null)
          .not('plan_id', 'is', null);

        const contractToEntry = new Map<number, PlanEntry>();
        for (const cp of (cpRows ?? []) as Record<string, unknown>[]) {
          if (!cp.fitbase_contract_id || !cp.plan_id) continue;
          const rawItems = cp.crm_client_plan_items;
          contractToEntry.set(Number(cp.fitbase_contract_id), {
            client_plan_id: cp.id as string,
            plan_id: cp.plan_id as string,
            items: (Array.isArray(rawItems) ? rawItems : []) as PlanItem[],
          });
        }

        for (const reg of regsRaw) {
          const r   = reg as Record<string, unknown>;
          const ev  = (r.event as Record<string, unknown>) ?? {};
          const tr  = (ev.training as Record<string, unknown> | null) ?? {};
          const pl  = (ev.place   as Record<string, unknown> | null) ?? {};
          const cc  = r.client_contract as Record<string, unknown> | null;

          const statusRaw = Number(r.status);
          const status = mapBookingStatus(r.status);
          if (!status) { job.stats.skipped_unknown_status++; continue; }

          const date = ev.date as string | undefined;
          const timeStart = ev.time_start as string | undefined;
          const timeEnd   = ev.time_end   as string | undefined;
          if (!date || !timeStart || !timeEnd) { job.stats.skipped_unknown_status++; continue; }

          const placeName = (pl.name as string) ?? '';
          const parsed = parsePlaceName(placeName);
          const device = parsed ? realDeviceMap.get(`${parsed.typeCode}/${parsed.num}`) : undefined;
          if (!device) { job.stats.skipped_no_device++; continue; }

          const trainingName = (tr.name as string | null) ?? null;
          const isTrial = trainingName != null && /пробн/i.test(trainingName);
          const fitbaseRegId = Number(r.id);
          const histParams = { clientId, fid, fitbaseRegId, statusRaw, date, trainingName };

          // Check time validity (crm_bookings_check: ends_at > starts_at)
          const startsAt = toUTCIso(date, timeStart);
          const endsAt   = toUTCIso(date, timeEnd);
          if (endsAt <= startsAt) {
            await saveToHistory('bad_time', histParams);
            continue;
          }

          // Resolve plan fields per booking kind
          let planId: string;
          let clientPlanId: string | null = null;
          let clientPlanItemId: string | null = null;
          let phase = 'active';

          if (isTrial) {
            // kind='free': plan_id=trialPlanId, client_plan_id=null, client_plan_item_id=null (crm_bookings_check1)
            planId = trialPlanId;
          } else {
            const fitbaseContractId = cc?.id != null ? Number(cc.id) : null;
            const entry = fitbaseContractId ? contractToEntry.get(fitbaseContractId) : undefined;
            if (!entry) {
              await saveToHistory('no_plan', histParams);
              continue;
            }
            const item = findMatchingItem(entry.items, device.type_code);
            if (!item) {
              await saveToHistory('no_item', histParams);
              continue;
            }
            planId = entry.plan_id;
            clientPlanId = entry.client_plan_id;
            clientPlanItemId = item.id;
            phase = item.phase || 'active';
          }

          const kind = isTrial ? 'free' : 'plan';
          const baseRow = {
            group_id:            randomUUID(),
            branch_id:           BRANCH_ID,
            fitbase_reg_id:      fitbaseRegId,
            booking_date:        date,
            starts_at:           startsAt,
            ends_at:             endsAt,
            device_type_code:    device.type_code,
            client_id:           clientId,
            kind,
            plan_id:             planId,
            client_plan_id:      clientPlanId,
            client_plan_item_id: clientPlanItemId,
            phase,
            status,
            session_burned:      status === 'attended',
            note:                'Перенесено из Fitbase',
            created_by:          'fitbase_import',
          };

          // Try insert on real device first
          let { error } = await supabase.from('crm_bookings').insert({ ...baseRow, device_id: device.id });

          if (error?.code === '23505') {
            // Duplicate fitbase_reg_id — update status only, keep device/time unchanged
            const { error: upErr } = await supabase.from('crm_bookings')
              .update({ status }).eq('fitbase_reg_id', fitbaseRegId);
            if (upErr) {
              const msg = `fid=${fid} reg=${fitbaseRegId}: update ${upErr.message}`;
              if (job.errors.length < 20) job.errors.push(msg);
              job.stats.errors++;
            } else {
              job.stats.updated++;
            }
            continue;
          }

          if (error?.code === '23P01') {
            const errStr = `${error.message ?? ''} ${(error as unknown as Record<string,unknown>).detail ?? ''}`.toLowerCase();
            if (errStr.includes('client_id')) {
              // Client already has a booking in this time slot
              await saveToHistory('overlap', histParams);
              continue;
            }

            // Device time slot conflict — try virtual devices in ascending order
            const virtuals = virtualByType.get(device.type_code) ?? [];
            let placed = false;
            for (const vd of virtuals) {
              const { error: vErr } = await supabase.from('crm_bookings')
                .insert({ ...baseRow, device_id: vd.id, device_type_code: vd.type_code });
              if (!vErr) { placed = true; job.stats.to_virtual++; break; }
              if (vErr.code !== '23P01') {
                const msg = `fid=${fid} reg=${fitbaseRegId}: virtual ${vErr.message}`;
                if (job.errors.length < 20) job.errors.push(msg);
                job.stats.errors++;
                break;
              }
            }
            if (!placed) {
              job.stats.skipped_no_device++;
            }
            continue;
          }

          if (error) {
            const msg = `fid=${fid} reg=${fitbaseRegId}: ${error.message}`;
            console.error('[bookings-import]', msg);
            if (job.errors.length < 20) job.errors.push(msg);
            job.stats.errors++;
          } else {
            job.stats.created++;
          }
        }
      } catch (e) {
        const msg = `fid=${fid}: ${(e as Error).message}`;
        console.error('[bookings-import]', msg);
        if (job.errors.length < 20) job.errors.push(msg);
        job.stats.errors++;
      }

      job.done_clients++;
      if (job.done_clients % 10 === 0) {
        await supabase.from('crm_settings').upsert({
          branch_id: BRANCH_ID,
          key: 'bookings_import_checkpoint',
          value: JSON.stringify({ last_fid: fid, done: job.done_clients, total: job.total_clients }),
        }, { onConflict: 'branch_id,key' });
      }
    }

    job.status = 'done';
    job.finished_at = new Date().toISOString();
    runAutomation().catch(console.error);

    await supabase.from('crm_settings')
      .delete().eq('branch_id', BRANCH_ID).eq('key', 'bookings_import_checkpoint');

  } catch (e) {
    job.status = 'error';
    job.finished_at = new Date().toISOString();
    if (job.errors.length < 20) job.errors.push(`fatal: ${(e as Error).message}`);
  }
}
