import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const LAST_SYNC_KEY = 'control_sheet_last_sync';

function parseDDMMYYYY(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseHHMMRange(s: string): { start: string; end: string } | null {
  const m = s.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!m) return null;
  const pad = (t: string) => t.length === 4 ? '0' + t : t; // "8:00" → "08:00"
  return { start: pad(m[1]), end: pad(m[2]) };
}

async function resolveDisplayName(
  raw: string,
  staffNameMap: Record<string, string>,
  managerNames: string[],
): Promise<string | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Exact key in staff_name_map
  if (staffNameMap[trimmed]) return staffNameMap[trimmed];

  // 2. The raw name contains a key (e.g. "Ичетовкина Ангелина" contains "Ангелина")
  for (const [key, val] of Object.entries(staffNameMap)) {
    if (key && (trimmed.includes(key) || key.includes(trimmed))) return val;
  }

  // 3. fin_staff.fitbase_name match
  const { data: fs } = await supabase.from('fin_staff').select('fitbase_name,display_name')
    .ilike('fitbase_name', `%${trimmed.split(' ')[0]}%`).limit(5);
  for (const row of fs ?? []) {
    if (row.fitbase_name && trimmed.includes(String(row.fitbase_name))) return String(row.display_name);
  }

  // 4. app_users.display_name contained in raw name (first-name match, manager only)
  for (const name of managerNames) {
    if (name && trimmed.includes(name)) return name;
  }

  return null;
}

export async function syncControlSheet(): Promise<{ ok: boolean; marks: number; schedule: number; error?: string }> {
  const url = process.env.CONTROL_SHEET_URL;
  const key = process.env.CONTROL_SHEET_SECRET;
  if (!url || !key) return { ok: false, marks: 0, schedule: 0, error: 'CONTROL_SHEET_URL/SECRET not set' };

  // Load staff_name_map from settings
  const { data: cfgRow } = await supabase.from('control_settings')
    .select('value').eq('branch_id', BRANCH_ID).eq('key', 'staff_name_map').maybeSingle();
  const staffNameMap = (cfgRow?.value ?? {}) as Record<string, string>;

  // Load manager display_names for fuzzy matching
  const { data: managers } = await supabase.from('app_users')
    .select('display_name').eq('branch_id', BRANCH_ID).eq('role', 'manager');
  const managerNames = (managers ?? []).map(u => String(u.display_name)).filter(Boolean);

  let parsed: { ok: boolean; marks: string[][]; schedule: string[][] };
  try {
    const r = await fetch(`${url}?key=${encodeURIComponent(key)}`);
    if (!r.ok) return { ok: false, marks: 0, schedule: 0, error: `HTTP ${r.status}` };
    parsed = await r.json() as typeof parsed;
  } catch (e) {
    return { ok: false, marks: 0, schedule: 0, error: String(e) };
  }
  if (!parsed.ok) return { ok: false, marks: 0, schedule: 0, error: 'api ok=false' };

  let marksCount = 0;
  let schedCount = 0;

  // ── Marks: skip header row, parse timestamp|branch|name|replacement|photo ────
  if (Array.isArray(parsed.marks)) {
    for (const row of parsed.marks.slice(1)) {
      const shiftDate = parseDDMMYYYY(row[0] ?? '');
      const nameRaw   = (row[2] ?? '').trim();
      if (!shiftDate || !nameRaw) continue;

      const userName = await resolveDisplayName(nameRaw, staffNameMap, managerNames);
      if (!userName) { console.warn(`[sheet-sync] unknown marks name: "${nameRaw}"`); continue; }

      const markedAt = (() => {
        const m = (row[0] ?? '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        const h = m[4].padStart(2, '0');
        return new Date(`${m[3]}-${m[2]}-${m[1]}T${h}:${m[5]}:${m[6]}+05:00`).toISOString();
      })();

      const { error } = await supabase.from('control_shift_marks').upsert({
        branch_id: BRANCH_ID, shift_date: shiftDate, user_name: userName,
        marked_at: markedAt, source: 'google_sheet',
      }, { onConflict: 'branch_id,shift_date,user_name', ignoreDuplicates: false });
      if (error) console.error('[sheet-sync] marks upsert:', error.message);
      else marksCount++;
    }
  }

  // ── Schedule: row[0]=group headers, row[1]=employee names, row[2+]=data ──────
  if (Array.isArray(parsed.schedule) && parsed.schedule.length >= 3) {
    const groupRow = parsed.schedule[0];
    const nameRow  = parsed.schedule[1];
    const dataRows = parsed.schedule.slice(2);

    // Build per-column {isPlan, isFact, empName}
    type ColMeta = { isPlan: boolean; isFact: boolean; emp: string | null };
    const cols: ColMeta[] = [];
    let curGroup = '';
    for (let c = 0; c < nameRow.length; c++) {
      const g = (groupRow[c] ?? '').trim().toLowerCase();
      if (g) curGroup = g;
      cols.push({
        isPlan: curGroup.includes('план'),
        isFact: curGroup.includes('факт'),
        emp:    (nameRow[c] ?? '').trim() || null,
      });
    }

    for (const row of dataRows) {
      const shiftDate = parseDDMMYYYY(row[0] ?? '');
      if (!shiftDate) continue;

      const planByEmp = new Map<string, { start: string; end: string }>();
      const factByEmp = new Map<string, { start: string; end: string }>();

      for (let c = 1; c < row.length; c++) {
        const col = cols[c];
        if (!col?.emp) continue;
        const parsed = parseHHMMRange(row[c] ?? '');
        if (!parsed) continue;
        if (col.isPlan && !planByEmp.has(col.emp)) planByEmp.set(col.emp, parsed);
        if (col.isFact && !factByEmp.has(col.emp)) factByEmp.set(col.emp, parsed);
      }

      const empNames = new Set([...planByEmp.keys(), ...factByEmp.keys()]);
      for (const empRaw of empNames) {
        const userName = await resolveDisplayName(empRaw, staffNameMap, managerNames);
        if (!userName) { console.warn(`[sheet-sync] unknown schedule name: "${empRaw}"`); continue; }

        const plan = planByEmp.get(empRaw);
        const fact = factByEmp.get(empRaw);

        const { error } = await supabase.from('control_shift_schedule').upsert({
          branch_id:  BRANCH_ID, shift_date: shiftDate, user_name: userName,
          plan_start: plan?.start ?? null, plan_end: plan?.end ?? null,
          fact_start: fact?.start ?? null, fact_end: fact?.end ?? null,
          is_fact:    !!fact, source: 'google_sheet', synced_at: new Date().toISOString(),
        }, { onConflict: 'branch_id,shift_date,user_name' });
        if (error) console.error('[sheet-sync] schedule upsert:', error.message);
        else schedCount++;
      }
    }
  }

  // Update last sync timestamp in control_settings
  await supabase.from('control_settings').upsert({
    key: LAST_SYNC_KEY, value: new Date().toISOString(), branch_id: BRANCH_ID,
    updated_by: 'cron', updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });

  return { ok: true, marks: marksCount, schedule: schedCount };
}

export async function shouldSyncSheet(intervalMinutes = 30): Promise<boolean> {
  const { data } = await supabase.from('control_settings')
    .select('value').eq('branch_id', BRANCH_ID).eq('key', LAST_SYNC_KEY).maybeSingle();
  if (!data?.value) return true;
  const lastMs = new Date(data.value as string).getTime();
  return (Date.now() - lastMs) > intervalMinutes * 60_000;
}
