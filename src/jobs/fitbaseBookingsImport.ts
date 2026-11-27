import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { runAutomation } from '../core/automation/engine';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const TRIAL_PLAN_ID = 'b86b4718-94e3-4e15-be75-25ebc4bb6095';

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

export interface BookingsImportJob {
  status: 'running' | 'done' | 'error';
  total_clients: number;
  done_clients: number;
  stats: {
    created: number;
    updated: number;
    to_virtual: number;
    skipped_no_device: number;
    skipped_client_overlap: number;
    skipped_unknown_status: number;
    errors: number;
  };
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
    stats: { created: 0, updated: 0, to_virtual: 0, skipped_no_device: 0, skipped_client_overlap: 0, skipped_unknown_status: 0, errors: 0 },
    errors: [],
    started_at: new Date().toISOString(),
  };
  return _job;
}

export async function runBookingsImport(): Promise<void> {
  if (!_job) return;
  const job = _job;

  try {
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

    const { data: clientData } = await supabase
      .from('crm_clients')
      .select('id, fitbase_client_id')
      .not('fitbase_client_id', 'is', null)
      .eq('is_deleted', false);
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

        // Preload client_plan_id mapping for this client
        const { data: cpRows } = await supabase
          .from('crm_client_plans')
          .select('id, fitbase_contract_id')
          .eq('client_id', clientId)
          .not('fitbase_contract_id', 'is', null);
        const contractToPlanId = new Map<number, string>(
          ((cpRows ?? []) as Array<{ id: string; fitbase_contract_id: number }>)
            .map(cp => [cp.fitbase_contract_id, cp.id]),
        );

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
          const isTrial   = trainingName != null && /пробн/i.test(trainingName);
          const kind      = isTrial ? 'free' : 'plan';
          const fitbaseContractId = cc?.id != null ? Number(cc.id) : null;
          const clientPlanId = fitbaseContractId ? contractToPlanId.get(fitbaseContractId) ?? null : null;

          const baseRow = {
            group_id:         randomUUID(),
            branch_id:        BRANCH_ID,
            fitbase_reg_id:   Number(r.id),
            booking_date:     date,
            starts_at:        toUTCIso(date, timeStart),
            ends_at:          toUTCIso(date, timeEnd),
            device_type_code: device.type_code,
            client_id:        clientId,
            kind,
            plan_id:          isTrial ? TRIAL_PLAN_ID : null,
            client_plan_id:   clientPlanId,
            phase:            'active',
            status,
            session_burned:   status === 'attended',
            note:             'Перенесено из Fitbase',
            created_by:       'fitbase_import',
          };

          const fitbaseRegId = Number(r.id);

          // Try insert on real device first
          let { error } = await supabase.from('crm_bookings').insert({ ...baseRow, device_id: device.id });

          if (error?.code === '23505') {
            // Duplicate fitbase_reg_id — update status only, keep device/time unchanged
            const { error: upErr } = await supabase.from('crm_bookings')
              .update({ status })
              .eq('fitbase_reg_id', fitbaseRegId);
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
              // Client already has a booking in this time slot — save to visit history
              void supabase.from('crm_visit_history').upsert({
                client_id:         clientId,
                client_fitbase_id: fid,
                fitbase_reg_id:    fitbaseRegId,
                status:            mapToVisitStatus(statusRaw),
                visit_at:          date,
                training_name:     trainingName,
              }, { onConflict: 'fitbase_reg_id' });
              job.stats.skipped_client_overlap++;
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
              const msg = `no free device: ${date} ${timeStart} type=${device.type_code}`;
              if (job.errors.length < 20) job.errors.push(msg);
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
        void supabase.from('crm_settings').upsert({
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
      .delete()
      .eq('branch_id', BRANCH_ID)
      .eq('key', 'bookings_import_checkpoint');

  } catch (e) {
    job.status = 'error';
    job.finished_at = new Date().toISOString();
    if (job.errors.length < 20) job.errors.push(`fatal: ${(e as Error).message}`);
  }
}
