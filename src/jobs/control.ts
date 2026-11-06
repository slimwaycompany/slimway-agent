import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const TZ_MS = 5 * 3600_000; // UTC+5 (Asia/Yekaterinburg)

// ── Helpers ──────────────────────────────────────────────────────────────────

function yekNow(): Date { return new Date(Date.now() + TZ_MS); }

function yekDate(d?: Date): string {
  return (d ?? yekNow()).toISOString().slice(0, 10);
}

function yekDateMinus(days: number): string {
  return yekDate(new Date(Date.now() + TZ_MS - days * 86400_000));
}

function parseTime(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h: h || 8, m: m || 0 };
}

function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

// Returns UTC timestamp for HH:MM on given day (UTC+5 date string)
function yekTimestampForDay(dateStr: string, hhmm: string): number {
  const { h, m } = parseTime(hhmm);
  return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+05:00`).getTime();
}

function digitsOnly(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  return d;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface ControlSettings {
  enabled:                boolean;
  alerts_to_agent:        boolean;
  show_to_managers:       boolean;
  fix_rate:               number;
  standard_price:         number;
  open_time:              string;
  close_time_weekday:     string;
  close_time_weekend:     string;
  fix_deadline_time:      string;
  s1_enabled:             boolean;
  s1_contact_minutes:     number;
  s1_grace_count:         number;
  s1_grace_max_minutes:   number;
  s2_enabled:             boolean;
  s2_random_per_shift:    number;
  s2_unreviewed_counts:   boolean;
  s3_enabled:             boolean;
  s3_booked_stage_ids:    string[];
  s3_task_max_days:       number;
  s3_checks:              string[];
  staff_name_map:         Record<string, string>;
  name_stop_words:        string[];
  session_minutes:        number;
  s3_after_minutes:       number;
  s4_enabled:             boolean;
  s4_sessions_left:       number;
  s4_ended_contact_days:  number;
  s4_no_visit_days:       number;
  s4_retry_days:          number;
  s4_checks:              string[];
  s5_enabled:             boolean;
  s5_mark_minutes:        number;
  s5_checks:              string[];
}

export const DEFAULT_SETTINGS: ControlSettings = {
  enabled:                true,
  alerts_to_agent:        false,
  show_to_managers:       false,
  fix_rate:               10000,
  standard_price:         1000,
  open_time:              '08:00',
  close_time_weekday:     '22:00',
  close_time_weekend:     '20:00',
  fix_deadline_time:      '08:00',
  s1_enabled:             true,
  s1_contact_minutes:     5,
  s1_grace_count:         1,
  s1_grace_max_minutes:   15,
  s2_enabled:             true,
  s2_random_per_shift:    2,
  s2_unreviewed_counts:   true,
  s3_enabled:             true,
  s3_booked_stage_ids:    [],
  s3_task_max_days:       7,
  s3_checks:              ['s3_no_source','s3_no_manager','s3_no_task','s3_no_lost_reason','s3_bad_comment','s3_no_client_card','s3_no_booking','s3_no_next_step','s3_client_fields','s3_bad_name'],
  staff_name_map:         {},
  name_stop_words:        ['тт','заявка','клиент','дочка','подруга','брат','сестра','друг','сын','дочь','мама','папа'],
  session_minutes:        30,
  s3_after_minutes:       30,
  s4_enabled:             true,
  s4_sessions_left:       2,
  s4_ended_contact_days:  3,
  s4_no_visit_days:       7,
  s4_retry_days:          2,
  s4_checks:              ['s4_ending','s4_ended','s4_no_visits','s4_task_overdue'],
  s5_enabled:             true,
  s5_mark_minutes:        30,
  s5_checks:              ['s5_unmarked','s5_no_abonement','s5_expired_abonement'],
};

export async function loadSettings(): Promise<ControlSettings> {
  const { data, error } = await supabase
    .from('control_settings')
    .select('key,value')
    .eq('branch_id', BRANCH_ID);
  if (error) console.error('[control] loadSettings:', error.message);
  if (!data?.length) return { ...DEFAULT_SETTINGS };
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of data) {
    merged[row.key] = row.value;
  }
  return merged as unknown as ControlSettings;
}

export async function saveSettings(patch: Partial<ControlSettings>, updatedBy: string): Promise<void> {
  const rows = Object.entries(patch).map(([key, value]) => ({
    key, value, updated_by: updatedBy, updated_at: new Date().toISOString(),
    branch_id: BRANCH_ID,
  }));
  const { error } = await supabase
    .from('control_settings')
    .upsert(rows, { onConflict: 'key' });
  if (error) console.error('[control] saveSettings:', error.message);
}

// ── Funnel UUIDs (Fitbase funnel_id → crm_funnels.id UUID) ───────────────────

interface FunnelUuids {
  newLeads: string | null;  // fitbase_id=1 «Новые заявки»
  base: string[];           // fitbase_id in [2,3,4] UUIDs
}

async function loadFunnelUuids(): Promise<FunnelUuids> {
  const { data, error } = await supabase
    .from('crm_funnels')
    .select('id,fitbase_id')
    .eq('branch_id', BRANCH_ID);
  if (error) console.error('[control] loadFunnelUuids:', error.message);
  const funnels = data ?? [];
  const newLeads = funnels.find(f => Number(f.fitbase_id) === 1)?.id ?? null;
  const base = funnels.filter(f => [2,3,4].includes(Number(f.fitbase_id))).map(f => String(f.id));
  return { newLeads, base };
}

// ── Who is on shift ───────────────────────────────────────────────────────────

interface ShiftHours { start: string; end: string; is_fact: boolean; }
interface OnShiftResult {
  names:    string[];
  source:   string;
  schedule: Record<string, ShiftHours>; // display_name → hours (empty when no schedule)
}

async function getOnShift(dateStr: string): Promise<OnShiftResult> {
  // 1. control_shift_schedule (fact first, then plan)
  const { data: sched } = await supabase
    .from('control_shift_schedule')
    .select('user_name,plan_start,plan_end,fact_start,fact_end,is_fact')
    .eq('branch_id', BRANCH_ID)
    .eq('shift_date', dateStr);
  if (sched?.length) {
    const schedule: Record<string, ShiftHours> = {};
    const names: string[] = [];
    for (const row of sched) {
      const name    = String(row.user_name);
      const is_fact = !!row.is_fact;
      const start   = is_fact ? String(row.fact_start ?? row.plan_start ?? '') : String(row.plan_start ?? '');
      const end     = is_fact ? String(row.fact_end   ?? row.plan_end   ?? '') : String(row.plan_end   ?? '');
      if (!start || !end) continue;
      schedule[name] = { start, end, is_fact };
      names.push(name);
    }
    if (names.length) return { names, source: 'control_shift_schedule', schedule };
  }

  // 2. control_shift_marks (whole day, no hours)
  const { data: marks, error: e1 } = await supabase
    .from('control_shift_marks')
    .select('user_name')
    .eq('branch_id', BRANCH_ID)
    .eq('shift_date', dateStr);
  if (!e1 && marks?.length) {
    const names = [...new Set(marks.map(m => String(m.user_name)).filter(Boolean))];
    return { names, source: 'control_shift_marks', schedule: {} };
  }

  // Load managers for role filter
  const { data: managers } = await supabase
    .from('app_users')
    .select('id,display_name')
    .eq('branch_id', BRANCH_ID)
    .eq('role', 'manager');
  const managerIds   = new Set((managers ?? []).map(u => String(u.id)));
  const nameById     = new Map((managers ?? []).map(u => [String(u.id), String(u.display_name)]));
  const managerNames = new Set((managers ?? []).map(u => String(u.display_name)));

  // 3. staff_shifts — filter by started_at date
  const dayStartUtc = new Date(`${dateStr}T00:00:00+05:00`).toISOString();
  const nextDayUtc  = new Date(`${dateStr}T23:59:59+05:00`).toISOString();
  const { data: shifts, error: e2 } = await supabase
    .from('staff_shifts')
    .select('user_id,user_name')
    .gte('started_at', dayStartUtc)
    .lte('started_at', nextDayUtc);
  if (!e2 && shifts?.length) {
    const names = [...new Set(
      shifts
        .filter(s => managerIds.has(String(s.user_id)))
        .map(s => nameById.get(String(s.user_id)) ?? String(s.user_name))
        .filter(Boolean),
    )];
    if (names.length) return { names, source: 'staff_shifts', schedule: {} };
  }

  // 4. metrics_day_input.on_shift
  const { data: day } = await supabase
    .from('metrics_day_input')
    .select('on_shift')
    .eq('branch_id', BRANCH_ID)
    .eq('day', dateStr)
    .maybeSingle();
  const arr   = (day?.on_shift as string[] | undefined) ?? [];
  const names = arr.filter(n => n && managerNames.has(n));
  return { names, source: 'metrics_day_input', schedule: {} };
}

// Returns managers whose shift hours include the given HH:MM time (all if no schedule)
function getManagersAtTime(timeHHMM: string, result: OnShiftResult): string[] {
  if (!Object.keys(result.schedule).length) return result.names;
  const [th, tm] = timeHHMM.split(':').map(Number);
  const timeMins = (th || 0) * 60 + (tm || 0);
  return result.names.filter(name => {
    const h = result.schedule[name];
    if (!h) return true; // no hours recorded → include
    const [sh, sm] = h.start.split(':').map(Number);
    const [eh, em] = h.end.split(':').map(Number);
    return timeMins >= (sh * 60 + sm) && timeMins <= (eh * 60 + em);
  });
}

// ── Name mapping: Fitbase name → app_users.display_name ──────────────────────

type UserMap = Map<string, string>; // fitbase_full_name → display_name

async function loadUserMap(): Promise<UserMap> {
  const { data, error } = await supabase
    .from('crm_fitbase_user_map')
    .select('fitbase_full_name,app_user_id,user_id')
    .not('fitbase_full_name', 'is', null);
  if (error) console.error('[control] loadUserMap:', error.message);
  const map = new Map<string, string>();
  if (!data?.length) return map;

  const userIds = data.map((r: Record<string,unknown>) => r.user_id ?? r.app_user_id).filter(Boolean);
  if (!userIds.length) return map;

  const { data: users } = await supabase
    .from('app_users')
    .select('id,display_name')
    .in('id', userIds);
  const userById = new Map((users ?? []).map((u: Record<string,unknown>) => [String(u.id), String(u.display_name)]));

  for (const r of data) {
    const uid = String(r.user_id ?? r.app_user_id ?? '');
    const displayName = userById.get(uid);
    if (displayName && r.fitbase_full_name) {
      map.set(String(r.fitbase_full_name), displayName);
    }
  }
  return map;
}

async function loadFinStaffMap(): Promise<Map<string, string>> {
  const { data } = await supabase.from('fin_staff').select('fitbase_name,display_name');
  return new Map((data ?? []).map((r: Record<string,unknown>) => [String(r.fitbase_name ?? ''), String(r.display_name ?? '')]));
}

function resolveName(fbName: string | null | undefined, userMap: UserMap): string | null {
  if (!fbName) return null;
  return userMap.get(fbName) ?? null;
}

function isBadName(name: string, stopWords: string[]): boolean {
  if (!name.trim()) return true;
  const lower = name.toLowerCase();
  if (stopWords.some(w => w && lower.includes(w.toLowerCase()))) return true;
  if (/\d/.test(name)) return true;                                      // digits in name
  if (!name.trim().includes(' ')) return true;                           // no surname
  return false;
}

// Check if any contact was made with a Fitbase client on a given day
async function hasContactToday(fitbaseClientId: number, dayStart: string, dayEnd: string): Promise<boolean> {
  const { data: lead } = await supabase.from('crm_leads')
    .select('id').eq('fitbase_client_id', fitbaseClientId).limit(1).maybeSingle();
  if (lead?.id) {
    const { data: act } = await supabase.from('crm_lead_activity')
      .select('id').eq('lead_id', lead.id)
      .gte('created_at', dayStart).lte('created_at', dayEnd).limit(1);
    if (act?.length) return true;
    const { data: task } = await supabase.from('crm_lead_tasks')
      .select('id').eq('lead_id', lead.id)
      .gte('created_at', dayStart).lte('created_at', dayEnd).limit(1);
    if (task?.length) return true;
  }
  // Check script_events by phone
  const { data: cc } = await supabase.from('fitbase_clients_cache')
    .select('phone').eq('fitbase_client_id', fitbaseClientId).maybeSingle();
  if (cc?.phone) {
    const phone = digitsOnly(String(cc.phone));
    const { data: sc } = await supabase.from('script_clients').select('id').eq('phone', phone).maybeSingle();
    if (sc?.id) {
      const { data: se } = await supabase.from('script_events')
        .select('id').eq('client_id', sc.id)
        .gte('created_at', dayStart).lte('created_at', dayEnd).limit(1);
      if (se?.length) return true;
    }
  }
  return false;
}

// ── Violation upsert ──────────────────────────────────────────────────────────

interface ViolationInput {
  dedup_key:    string;
  shift_date:   string;
  standard_num: number;
  check_code:   string;
  owner_name:   string | null;
  is_shared:    boolean;
  entity_id:    string;
  entity_label: string;
  entity_link?: string | null;
  details:      string;
  how_to_fix:   string;
  fix_deadline: string; // ISO timestamp
}

async function upsertViolation(v: ViolationInput): Promise<void> {
  const { error } = await supabase
    .from('control_violations')
    .upsert({
      dedup_key:    v.dedup_key,
      branch_id:    BRANCH_ID,
      shift_date:   v.shift_date,
      standard_num: v.standard_num,
      check_code:   v.check_code,
      owner_name:   v.owner_name,
      is_shared:    v.is_shared,
      entity_id:    v.entity_id,
      entity_label: v.entity_label,
      entity_link:  v.entity_link ?? null,
      details:      v.details,
      how_to_fix:   v.how_to_fix,
      fix_deadline: v.fix_deadline,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'dedup_key', ignoreDuplicates: false });
  if (error) console.error(`[control] upsert violation ${v.dedup_key}: ${error.message}`);
}

// ── Fix deadline: next morning at fix_deadline_time ──────────────────────────

function computeFixDeadline(dateStr: string, deadlineTime: string): string {
  const next = new Date(`${dateStr}T12:00:00+05:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return new Date(`${nextDate}T${deadlineTime}:00+05:00`).toISOString();
}

// ── Re-check open violations (may have been fixed or deadline expired) ────────

async function recheckOpenViolations(dateStr: string, cfg: ControlSettings): Promise<void> {
  const { data: open, error } = await supabase
    .from('control_violations')
    .select('id,dedup_key,check_code,entity_id,fix_deadline,standard_num,status')
    .eq('branch_id', BRANCH_ID)
    .eq('status', 'open')
    .neq('shift_date', dateStr); // only past days
  if (error) { console.error('[control] recheckOpen:', error.message); return; }
  if (!open?.length) return;

  const now = new Date().toISOString();

  for (const v of open) {
    const stdNum = Number(v.standard_num);
    // s2 violations are only fixed via quality review — skip
    if (stdNum === 2) continue;
    // s1 is non-fixable — only deadline-based failure
    if (stdNum === 1) {
      if (v.fix_deadline && v.fix_deadline < now) {
        await supabase.from('control_violations')
          .update({ status: 'failed', updated_at: now }).eq('id', v.id);
      }
      continue;
    }

    const isFixed = await checkViolationFixed(v.check_code, String(v.entity_id), cfg);
    if (isFixed) {
      await supabase.from('control_violations')
        .update({ status: 'fixed', fixed_at: now, updated_at: now }).eq('id', v.id);
    } else if (v.fix_deadline && v.fix_deadline < now) {
      await supabase.from('control_violations')
        .update({ status: 'failed', updated_at: now }).eq('id', v.id);
    }
  }
}

async function checkViolationFixed(checkCode: string, entityId: string, cfg: ControlSettings): Promise<boolean> {
  try {
    switch (checkCode) {
      case 's3_no_source': {
        const { data } = await supabase.from('crm_leads').select('ad_source_id').eq('id', entityId).maybeSingle();
        return !!data?.ad_source_id;
      }
      case 's3_no_manager': {
        const { data } = await supabase.from('crm_leads').select('fitbase_manager_name,manager_user_id').eq('id', entityId).maybeSingle();
        return !!(data?.fitbase_manager_name || data?.manager_user_id);
      }
      case 's3_no_task': {
        const maxDue = new Date(Date.now() + TZ_MS + cfg.s3_task_max_days * 86400_000).toISOString().slice(0, 10);
        const { data } = await supabase.from('crm_lead_tasks').select('id').eq('lead_id', entityId).eq('status', 'open').lte('due_at', maxDue + 'T23:59:59').limit(1);
        return !!data?.length;
      }
      case 's3_no_lost_reason': {
        const { data } = await supabase.from('crm_leads').select('lost_reason_id').eq('id', entityId).maybeSingle();
        return !!data?.lost_reason_id;
      }
      case 's3_bad_comment': {
        const { data } = await supabase.from('crm_lead_activity').select('text').eq('lead_id', entityId).eq('kind', 'comment').order('created_at', { ascending: false }).limit(1);
        return !!(data?.[0] && checkCommentTemplate(String(data[0].text || '')));
      }
      case 's4_task_overdue': {
        const { data } = await supabase.from('crm_lead_tasks').select('status').eq('id', entityId).maybeSingle();
        return data?.status === 'done';
      }
      case 's5_unmarked': {
        // entityId = fitbase_visits.id (integer as string)
        const { data } = await supabase.from('fitbase_visits').select('status').eq('id', entityId).maybeSingle();
        return !!(data && ![0, 1].includes(Number(data.status)));
      }
      case 's5_no_abonement':
      case 's5_expired_abonement': {
        // entityId = fitbase_visits.id; check if client now has an active contract
        const { data: visit } = await supabase.from('fitbase_visits').select('client_fitbase_id').eq('id', entityId).maybeSingle();
        if (!visit?.client_fitbase_id) return false;
        const { data: active } = await supabase.from('fitbase_contracts').select('id').eq('client_fitbase_id', visit.client_fitbase_id).neq('status', 'closed').limit(1);
        return !!active?.length;
      }
      case 's3_no_client_card': {
        const { data } = await supabase.from('crm_leads').select('fitbase_client_id').eq('id', entityId).maybeSingle();
        return data?.fitbase_client_id != null;
      }
      case 's3_bad_name': {
        const isUuid = entityId.includes('-');
        let name = '';
        if (isUuid) {
          const { data: lead } = await supabase.from('crm_leads').select('fitbase_client_id,title').eq('id', entityId).maybeSingle();
          if (lead?.fitbase_client_id) {
            const { data: cc } = await supabase.from('fitbase_clients_cache').select('name').eq('fitbase_client_id', lead.fitbase_client_id).maybeSingle();
            name = String(cc?.name ?? '');
          }
          if (!name) name = String(lead?.title ?? '');
        } else {
          const { data: vt } = await supabase.from('fitbase_visits').select('client_fitbase_id,client_name').eq('id', entityId).maybeSingle();
          if (vt?.client_fitbase_id) {
            const { data: cc } = await supabase.from('fitbase_clients_cache').select('name').eq('fitbase_client_id', vt.client_fitbase_id).maybeSingle();
            name = String(cc?.name ?? '');
          }
          if (!name) name = String(vt?.client_name ?? '');
        }
        return !!name && !isBadName(name, cfg.name_stop_words);
      }
      case 's3_no_booking': {
        const { data: lead } = await supabase.from('crm_leads').select('fitbase_client_id').eq('id', entityId).maybeSingle();
        if (!lead?.fitbase_client_id) return false;
        const { data: trial } = await supabase.from('fitbase_visits').select('id').eq('client_fitbase_id', lead.fitbase_client_id).eq('is_trial', true).limit(1);
        if (trial?.length) return true;
        const { data: task } = await supabase.from('crm_lead_tasks').select('id').eq('lead_id', entityId).eq('status', 'open').limit(1);
        return !!task?.length;
      }
      case 's3_no_next_step': {
        const isUuid = entityId.includes('-');
        if (isUuid) {
          const { data: act } = await supabase.from('crm_lead_activity').select('id').eq('lead_id', entityId).limit(1);
          if (act?.length) return true;
          const { data: task } = await supabase.from('crm_lead_tasks').select('id').eq('lead_id', entityId).limit(1);
          return !!task?.length;
        } else {
          const { data: vt } = await supabase.from('fitbase_visits').select('client_fitbase_id').eq('id', entityId).maybeSingle();
          if (!vt?.client_fitbase_id) return false;
          const { data: lead } = await supabase.from('crm_leads').select('id').eq('fitbase_client_id', vt.client_fitbase_id).limit(1);
          return !!lead?.length;
        }
      }
      case 's3_client_fields': {
        const { data: lead } = await supabase.from('crm_leads').select('fitbase_client_id').eq('id', entityId).maybeSingle();
        if (!lead?.fitbase_client_id) return false;
        const { data: cc } = await supabase.from('fitbase_clients_cache').select('name').eq('fitbase_client_id', lead.fitbase_client_id).maybeSingle();
        const name = String(cc?.name ?? '');
        return !!name && !isBadName(name, cfg.name_stop_words);
      }
      default:
        return false;
    }
  } catch (e) {
    console.error(`[control] checkViolationFixed ${checkCode}:`, (e as Error).message);
    return false;
  }
}

// ── Compute shift scores ──────────────────────────────────────────────────────

async function computeShiftScores(
  dateStr: string, onShift: string[], cfg: ControlSettings,
  finalize: boolean, noDataStds: Set<number> = new Set()
): Promise<void> {
  const standards = [1, 2, 3, 4, 5];

  // "Без смены" synthetic row: collect shared violations when nobody is on shift
  const computeForOwners = onShift.length > 0 ? onShift : ['(без смены)'];
  const isNoShift = onShift.length === 0;

  for (const person of computeForOwners) {
    for (const stdNum of standards) {
      const stdEnabled = getStdEnabled(stdNum, cfg);
      if (!stdEnabled) {
        await upsertScore(dateStr, person, stdNum, 'off', 0, 0, finalize);
        continue;
      }

      // no_data: standard that can't be reliably computed for past dates
      if (noDataStds.has(stdNum)) {
        await upsertScore(dateStr, person, stdNum, 'no_data', 0, 0, finalize);
        continue;
      }

      // Count violations: for "без смены" row, only shared violations
      let q = supabase
        .from('control_violations')
        .select('id,status,is_shared,check_code')
        .eq('branch_id', BRANCH_ID)
        .eq('shift_date', dateStr)
        .eq('standard_num', stdNum);
      if (isNoShift) {
        q = q.eq('is_shared', true);
      } else {
        q = q.or(`owner_name.eq."${person.replace(/"/g, '\\"')}",is_shared.eq.true`);
      }
      const { data: vios, error: vError } = await q;
      if (vError) {
        console.error(`[control] violations query ${person}/${stdNum}: ${vError.message}`);
        await upsertScore(dateStr, person, stdNum, 'fail', 0, 0, finalize);
        continue;
      }
      const all = vios ?? [];

      // №2 special: not_reviewed if no reviews checked for this person this shift
      if (stdNum === 2 && !isNoShift) {
        const { data: reviews } = await supabase
          .from('control_quality_reviews')
          .select('id,reviewed_at,c1_needs,c2_presented,c3_objections,c4_outcome')
          .eq('branch_id', BRANCH_ID)
          .eq('shift_date', dateStr)
          .eq('manager_name', person);

        const checked = (reviews ?? []).filter(r => r.reviewed_at);
        if (!checked.length) {
          const amount = cfg.s2_unreviewed_counts ? cfg.standard_price : 0;
          await upsertScore(dateStr, person, 2, 'not_reviewed', all.length, amount, finalize);
          continue;
        }
        const anyFail = checked.some(r => !r.c1_needs || !r.c2_presented || !r.c3_objections || !r.c4_outcome);
        await upsertScore(dateStr, person, 2, anyFail ? 'fail' : 'ok', all.length, anyFail ? 0 : cfg.standard_price, finalize);
        continue;
      }

      // №1: grace logic (late violations)
      if (stdNum === 1) {
        const lateVios   = all.filter(v => v.status !== 'waived' && v.check_code === 's1_late');
        const noContact  = all.some(v => v.check_code === 's1_no_contact' && v.status !== 'waived');
        const graceOk    = lateVios.length <= cfg.s1_grace_count;
        const longLate   = lateVios.some(v => {
          const details = (v as Record<string,unknown>).details as string | undefined;
          if (!details) return false;
          const m = details.match(/опоздал на (\d+) мин/);
          return m && Number(m[1]) > cfg.s1_grace_max_minutes;
        });
        const fail = noContact || !graceOk || longLate;
        await upsertScore(dateStr, person, 1, fail ? 'fail' : 'ok', all.length, fail ? 0 : cfg.standard_price, finalize);
        continue;
      }

      // General: open → pending, all fixed → fixed, any failed → fail
      const active    = all.filter(v => v.status !== 'waived');
      const hasFailed = active.some(v => v.status === 'failed');
      const hasOpen   = active.some(v => v.status === 'open');
      const allFixed  = active.length > 0 && active.every(v => v.status === 'fixed');
      const noVios    = active.length === 0;

      let result: string;
      let amount: number;
      if (noVios)        { result = 'ok';      amount = cfg.standard_price; }
      else if (hasFailed){ result = 'fail';    amount = 0; }
      else if (hasOpen)  { result = 'pending'; amount = 0; }
      else if (allFixed) { result = 'fixed';   amount = cfg.standard_price; }
      else               { result = 'ok';      amount = cfg.standard_price; }

      await upsertScore(dateStr, person, stdNum, result, active.length, amount, finalize);
    }
  }
}

function getStdEnabled(num: number, cfg: ControlSettings): boolean {
  switch (num) {
    case 1: return cfg.s1_enabled;
    case 2: return cfg.s2_enabled;
    case 3: return cfg.s3_enabled;
    case 4: return cfg.s4_enabled;
    case 5: return cfg.s5_enabled;
    default: return false;
  }
}

async function upsertScore(
  dateStr: string, ownerName: string, standardNum: number,
  result: string, violationsCount: number, amount: number, isFinal: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('control_shift_scores')
    .upsert({
      branch_id:        BRANCH_ID,
      shift_date:       dateStr,
      owner_name:       ownerName,
      standard_num:     standardNum,
      result,
      violations_count: violationsCount,
      amount,
      is_final:         isFinal,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'branch_id,shift_date,owner_name,standard_num' });
  if (error) console.error(`[control] upsert score ${ownerName}/${standardNum}: ${error.message}`);
}

// ── Standard 1: Speed ─────────────────────────────────────────────────────────

async function checkS1(
  dateStr: string, cfg: ControlSettings, userMap: UserMap,
  onShift: string[], funnelUuids: FunnelUuids, errors: string[],
): Promise<number> {
  if (!cfg.s1_enabled) return 0;
  if (!funnelUuids.newLeads) {
    errors.push('s1: не найдена воронка «Новые заявки» (fitbase_id=1)');
    return 0;
  }

  const openMs  = yekTimestampForDay(dateStr, cfg.open_time);
  const closeMs = yekTimestampForDay(dateStr, isWeekend(dateStr) ? cfg.close_time_weekend : cfg.close_time_weekday);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);

  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;

  const { data: leads, error: leadsErr } = await supabase
    .from('crm_leads')
    .select('id,fitbase_id,fitbase_manager_id,fitbase_manager_name,fb_created_at,phone')
    .eq('branch_id', BRANCH_ID)
    .eq('funnel_id', funnelUuids.newLeads)
    .gte('fb_created_at', dayStart)
    .lte('fb_created_at', dayEnd)
    .eq('is_archived', false);
  if (leadsErr) {
    errors.push(`s1: leads query: ${leadsErr.message}`);
    return 0;
  }
  if (!leads?.length) return 0;

  let violations = 0;

  for (const lead of leads) {
    const leadCreatedMs  = new Date(lead.fb_created_at as string).getTime();
    const contactStartMs = leadCreatedMs < openMs ? openMs : leadCreatedMs;

    const fbManager = lead.fitbase_manager_name as string | null;
    const owner     = fbManager ? resolveName(fbManager, userMap) : null;

    const leadId = String(lead.id);
    const phone  = lead.phone ? digitsOnly(String(lead.phone)) : null;

    // Activity in crm_lead_activity
    const { data: acts } = await supabase
      .from('crm_lead_activity')
      .select('author,created_at')
      .eq('lead_id', leadId)
      .neq('kind', 'system')
      .gte('created_at', lead.fb_created_at as string)
      .order('created_at', { ascending: true })
      .limit(1);

    // Tasks in crm_lead_tasks
    const { data: tasks } = await supabase
      .from('crm_lead_tasks')
      .select('created_by,created_at')
      .eq('lead_id', leadId)
      .gte('created_at', lead.fb_created_at as string)
      .order('created_at', { ascending: true })
      .limit(1);

    // Script events (insert/copy/sent) for this phone — look up UUID via script_clients
    let scriptContactMs = Infinity;
    if (phone) {
      const { data: sc } = await supabase
        .from('script_clients')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      if (sc?.id) {
        const { data: se } = await supabase
          .from('script_events')
          .select('created_at,manager')
          .eq('client_id', sc.id)
          .in('event_type', ['insert', 'copy', 'sent'])
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd)
          .order('created_at', { ascending: true })
          .limit(1);
        if (se?.[0]) scriptContactMs = new Date(se[0].created_at as string).getTime();
      }
    }

    const actMs         = acts?.[0]  ? new Date(acts[0].created_at  as string).getTime() : Infinity;
    const taskMs        = tasks?.[0] ? new Date(tasks[0].created_at as string).getTime() : Infinity;
    const firstContactMs = Math.min(actMs, taskMs, scriptContactMs);

    // No contact by end of day
    if (firstContactMs === Infinity || firstContactMs > closeMs) {
      await upsertViolation({
        dedup_key:    `s1_no_contact:${leadId}`,
        shift_date:   dateStr, standard_num: 1, check_code: 's1_no_contact',
        owner_name:   null, is_shared: true,
        entity_id:    leadId, entity_label: String(lead.fitbase_manager_name ?? 'Новая заявка'),
        details:      'Нет первого контакта с заявкой до конца рабочего дня',
        how_to_fix:   'Нарушение скорости не исправляется',
        fix_deadline: fixDeadline,
      });
      violations++;
      continue;
    }

    const latencyMin = (firstContactMs - contactStartMs) / 60_000;
    if (latencyMin <= cfg.s1_contact_minutes) continue; // on time

    // Late contact — find who made it
    let contactOwner: string | null = null;
    if (actMs <= Math.min(taskMs, scriptContactMs) && acts?.[0]?.author) {
      contactOwner = acts[0].author;
    } else if (taskMs <= Math.min(actMs, scriptContactMs) && tasks?.[0]?.created_by) {
      contactOwner = tasks[0].created_by;
    } else {
      contactOwner = owner;
    }

    const minLate = Math.round(latencyMin - cfg.s1_contact_minutes);
    await upsertViolation({
      dedup_key:    `s1_late:${leadId}`,
      shift_date:   dateStr, standard_num: 1, check_code: 's1_late',
      owner_name:   contactOwner, is_shared: !contactOwner,
      entity_id:    leadId, entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
      details:      `Первый контакт опоздал на ${minLate} мин (порог ${cfg.s1_contact_minutes} мин)`,
      how_to_fix:   'Нарушение скорости не исправляется',
      fix_deadline: fixDeadline,
    });
    violations++;
  }

  return violations;
}

// ── Standard 2: Quality ───────────────────────────────────────────────────────

async function checkS2(
  dateStr: string, cfg: ControlSettings, userMap: UserMap,
  onShift: string[], errors: string[],
): Promise<number> {
  if (!cfg.s2_enabled) return 0;

  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;

  const { data: events, error } = await supabase
    .from('script_events')
    .select('client_id,event_type,fact_key,manager,created_at')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);
  if (error) {
    errors.push(`s2: script_events: ${error.message}`);
    return 0;
  }
  if (!events?.length) return 0;

  // Group by manager → client
  const managerClients = new Map<string, Set<string>>();
  for (const ev of events) {
    if (!ev.manager || !ev.client_id) continue;
    const mgr = String(ev.manager);
    if (!managerClients.has(mgr)) managerClients.set(mgr, new Set());
    managerClients.get(mgr)!.add(String(ev.client_id));
  }

  for (const [manager, clientKeys] of managerClients) {
    const toReview: Array<{ clientKey: string; flags: string[]; pickReason: string }> = [];

    for (const clientKey of clientKeys) {
      const clientEvents = events.filter(e => e.client_id === clientKey && e.manager === manager);
      const facts = new Set(clientEvents.filter(e => e.event_type === 'fact').map(e => e.fact_key));
      const hasFacts = facts.has('цель') || facts.has('goal') || facts.has('experience') || facts.has('опыт') || facts.has('time');
      const hasOutcome = clientEvents.some(e => e.event_type === 'answer' &&
        ['booked','refused','dnd','confirmed_trial'].some(x => String(e.fact_key ?? '').includes(x)));
      const lastEventTs = clientEvents.reduce((m, e) => Math.max(m, new Date(e.created_at as string).getTime()), 0);
      const isAbandoned = !hasOutcome && lastEventTs > 0 && (Date.now() - lastEventTs) > 86400_000;

      const flags: string[] = [];
      if (!hasFacts)   flags.push('no_facts');
      if (!hasOutcome) flags.push('no_outcome');
      if (isAbandoned) flags.push('abandoned');

      if (flags.length > 0) {
        toReview.push({ clientKey, flags, pickReason: 'flagged' });
      }
    }

    // Add random non-flagged up to s2_random_per_shift
    const flaggedKeys = new Set(toReview.map(r => r.clientKey));
    const nonFlagged  = [...clientKeys].filter(k => !flaggedKeys.has(k));
    const randomPicks = nonFlagged.sort(() => Math.random() - 0.5).slice(0, Math.max(0, cfg.s2_random_per_shift - toReview.length));
    for (const k of randomPicks) toReview.push({ clientKey: k, flags: [], pickReason: 'random' });

    for (const item of toReview) {
      const { error: qrErr } = await supabase
        .from('control_quality_reviews')
        .upsert({
          branch_id: BRANCH_ID, shift_date: dateStr, manager_name: manager,
          client_key: item.clientKey, pick_reason: item.pickReason,
          flag_no_facts:   item.flags.includes('no_facts'),
          flag_no_outcome: item.flags.includes('no_outcome'),
          flag_abandoned:  item.flags.includes('abandoned'),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'branch_id,shift_date,manager_name,client_key' });
      if (qrErr) console.error('[control] s2 upsert quality_review:', qrErr.message);
    }
  }

  return 0; // violations created only on manual review save
}

// ── Standard 3: Card ─────────────────────────────────────────────────────────

async function checkS3(
  dateStr: string, cfg: ControlSettings, userMap: UserMap,
  funnelUuids: FunnelUuids, errors: string[],
): Promise<number> {
  if (!cfg.s3_enabled) return 0;
  if (!funnelUuids.newLeads) {
    errors.push('s3: не найдена воронка «Новые заявки» (fitbase_id=1)');
    return 0;
  }

  const dayStart    = `${dateStr}T00:00:00+05:00`;
  const dayEnd      = `${dateStr}T23:59:59+05:00`;
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const enabled     = new Set(cfg.s3_checks);
  const stopWords   = cfg.name_stop_words ?? [];
  const delaySec    = ((cfg.session_minutes ?? 30) + (cfg.s3_after_minutes ?? 30)) * 60;
  const nowMs       = Date.now();

  // Leads worked on this shift (by activity today)
  const { data: activeLeadIds, error: actErr } = await supabase
    .from('crm_lead_activity')
    .select('lead_id')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .neq('kind', 'system');
  if (actErr) { errors.push(`s3: lead_activity: ${actErr.message}`); return 0; }

  const leadIds = [...new Set((activeLeadIds ?? []).map((r: Record<string,unknown>) => String(r.lead_id)))];
  if (!leadIds.length) {
    // Still need to check trial visitors even if no lead activity today
    return checkS3TrialVisitors(dateStr, cfg, enabled, delaySec, nowMs, fixDeadline, stopWords, errors);
  }

  const { data: leads, error: leadsErr } = await supabase
    .from('crm_leads')
    .select('id,fitbase_id,fitbase_manager_name,manager_user_id,ad_source_id,funnel_id,stage_id,phone,lost_reason_id,fitbase_client_id,title')
    .eq('branch_id', BRANCH_ID)
    .eq('funnel_id', funnelUuids.newLeads)
    .in('id', leadIds.slice(0, 200));
  if (leadsErr) { errors.push(`s3: leads: ${leadsErr.message}`); return 0; }
  if (!leads?.length) return checkS3TrialVisitors(dateStr, cfg, enabled, delaySec, nowMs, fixDeadline, stopWords, errors);

  // Load funnel stages
  const { data: stages, error: stagesErr } = await supabase
    .from('crm_funnel_stages').select('id,kind').eq('funnel_id', funnelUuids.newLeads);
  if (stagesErr) console.error('[control] s3 stages:', stagesErr.message);
  const stageById = new Map((stages ?? []).map((s: Record<string,unknown>) => [String(s.id), s]));

  // Load open tasks
  const { data: tasks } = await supabase
    .from('crm_lead_tasks').select('lead_id,due_at')
    .in('lead_id', leadIds.slice(0, 200)).eq('status', 'open');
  const tasksByLead = new Map<string, { due_at: string }[]>();
  for (const t of tasks ?? []) {
    const lid = String(t.lead_id);
    if (!tasksByLead.has(lid)) tasksByLead.set(lid, []);
    tasksByLead.get(lid)!.push({ due_at: String(t.due_at) });
  }

  // Load last comment per lead
  const { data: comments } = await supabase
    .from('crm_lead_activity').select('lead_id,text,author,created_at')
    .in('lead_id', leadIds.slice(0, 200)).eq('kind', 'comment')
    .order('created_at', { ascending: false });
  const lastCommentByLead = new Map<string, { text: string; author: string; created_at: string }>();
  for (const c of comments ?? []) {
    const lid = String(c.lead_id);
    if (!lastCommentByLead.has(lid)) lastCommentByLead.set(lid, c as { text: string; author: string; created_at: string });
  }

  // Load fitbase_clients_cache for name checks
  const clientFbIds = leads.map(l => Number(l.fitbase_client_id)).filter(Boolean);
  const clientNameMap = new Map<number, string>(); // fitbase_client_id → name
  if (clientFbIds.length) {
    const { data: cc } = await supabase.from('fitbase_clients_cache')
      .select('fitbase_client_id,name').in('fitbase_client_id', clientFbIds);
    for (const r of cc ?? []) clientNameMap.set(Number(r.fitbase_client_id), String(r.name ?? ''));
  }

  // Load trial visits for clients (for s3_no_booking)
  const trialsForClient = new Set<number>();
  if (clientFbIds.length) {
    const { data: trials } = await supabase.from('fitbase_visits')
      .select('client_fitbase_id').in('client_fitbase_id', clientFbIds).eq('is_trial', true).limit(1000);
    for (const t of trials ?? []) trialsForClient.add(Number(t.client_fitbase_id));
  }

  // Load contracts for s3_client_fields
  const clientsWithContract = new Set<number>();
  if (clientFbIds.length) {
    const { data: conts } = await supabase.from('fitbase_contracts')
      .select('client_fitbase_id').in('client_fitbase_id', clientFbIds).limit(1000);
    for (const c of conts ?? []) clientsWithContract.add(Number(c.client_fitbase_id));
  }

  let violations = 0;

  for (const lead of leads) {
    const leadId     = String(lead.id);
    const owner      = resolveName(lead.fitbase_manager_name as string | null, userMap) ?? null;
    const stage      = stageById.get(String(lead.stage_id));
    const stageKind  = String((stage as Record<string,unknown> | undefined)?.kind ?? 'normal');
    const clientFbId = lead.fitbase_client_id ? Number(lead.fitbase_client_id) : null;
    const clientName = clientFbId ? (clientNameMap.get(clientFbId) ?? '') : '';
    const leadTitle  = String(lead.title ?? lead.fitbase_manager_name ?? '');
    const labelName  = clientName || leadTitle || `Заявка ${lead.fitbase_id ?? ''}`;

    // ── s3_no_client_card ────────────────────────────────────────────────────
    if (enabled.has('s3_no_client_card') && !clientFbId) {
      await upsertViolation({
        dedup_key: `s3_no_client_card:${leadId}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_client_card', owner_name: owner, is_shared: !owner,
        entity_id: leadId, entity_label: leadTitle || 'Заявка',
        details: 'Не заведена карточка клиента в Fitbase',
        how_to_fix: 'Создайте карточку клиента в Fitbase и привяжите к заявке',
        fix_deadline: fixDeadline,
      }); violations++;
    }

    // ── s3_bad_name ──────────────────────────────────────────────────────────
    if (enabled.has('s3_bad_name')) {
      const checkName = clientName || leadTitle;
      if (checkName && isBadName(checkName, stopWords)) {
        const eid = clientFbId ? String(clientFbId) : leadId;
        await upsertViolation({
          dedup_key: `s3_bad_name:${eid}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_bad_name', owner_name: owner, is_shared: !owner,
          entity_id: leadId, entity_label: labelName,
          details: `Имя клиента служебное или неполное: «${checkName}»`,
          how_to_fix: 'Введите настоящие фамилию и имя в карточке клиента Fitbase',
          fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // ── s3_no_source ─────────────────────────────────────────────────────────
    if (enabled.has('s3_no_source') && !lead.ad_source_id) {
      await upsertViolation({
        dedup_key: `s3_no_source:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_source', owner_name: owner, is_shared: !owner,
        entity_id: leadId, entity_label: labelName,
        details: 'Не указан источник заявки', how_to_fix: 'Укажите источник в карточке заявки',
        fix_deadline: fixDeadline,
      }); violations++;
    }

    // ── s3_no_manager ────────────────────────────────────────────────────────
    if (enabled.has('s3_no_manager') && !lead.fitbase_manager_name && !lead.manager_user_id) {
      await upsertViolation({
        dedup_key: `s3_no_manager:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_manager', owner_name: null, is_shared: true,
        entity_id: leadId, entity_label: labelName,
        details: 'Заявка без назначенного менеджера', how_to_fix: 'Назначьте менеджера в карточке заявки',
        fix_deadline: fixDeadline,
      }); violations++;
    }

    // ── s3_no_booking: active lead + no trial visit + no open task ───────────
    if (enabled.has('s3_no_booking') && stageKind !== 'success' && stageKind !== 'fail' && clientFbId) {
      const hasTrial = trialsForClient.has(clientFbId);
      const hasTasks = (tasksByLead.get(leadId) ?? []).length > 0;
      if (!hasTrial && !hasTasks) {
        await upsertViolation({
          dedup_key: `s3_no_booking:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_no_booking', owner_name: owner, is_shared: !owner,
          entity_id: leadId, entity_label: labelName,
          details: 'Активная заявка: нет записи на пробное и нет открытой задачи',
          how_to_fix: 'Запишите клиентку на пробное занятие или создайте задачу «перезвонить»',
          fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // ── s3_no_task (non-success/fail leads) ──────────────────────────────────
    if (enabled.has('s3_no_task') && stageKind !== 'success' && stageKind !== 'fail') {
      const leadTasks = tasksByLead.get(leadId) ?? [];
      const maxDue    = new Date(Date.now() + TZ_MS + cfg.s3_task_max_days * 86400_000).toISOString().slice(0, 10);
      const hasTask   = leadTasks.some(t => t.due_at && t.due_at.slice(0, 10) <= maxDue);
      if (!hasTask) {
        await upsertViolation({
          dedup_key: `s3_no_task:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_no_task', owner_name: owner, is_shared: !owner,
          entity_id: leadId, entity_label: labelName,
          details: `Нет открытой задачи со сроком ≤${cfg.s3_task_max_days} дней`,
          how_to_fix: 'Создайте задачу в карточке заявки', fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // ── s3_no_lost_reason ────────────────────────────────────────────────────
    if (enabled.has('s3_no_lost_reason') && stageKind === 'fail' && !lead.lost_reason_id) {
      await upsertViolation({
        dedup_key: `s3_no_lost_reason:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_lost_reason', owner_name: owner, is_shared: !owner,
        entity_id: leadId, entity_label: labelName,
        details: 'Этап «Отказ» без причины отказа', how_to_fix: 'Укажите причину отказа',
        fix_deadline: fixDeadline,
      }); violations++;
    }

    // ── s3_bad_comment ───────────────────────────────────────────────────────
    if (enabled.has('s3_bad_comment')) {
      const lastComment = lastCommentByLead.get(leadId);
      if (lastComment && lastComment.created_at >= dayStart && lastComment.created_at <= dayEnd) {
        if (!checkCommentTemplate(String(lastComment.text || ''))) {
          await upsertViolation({
            dedup_key: `s3_bad_comment:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
            check_code: 's3_bad_comment', owner_name: lastComment.author ?? owner, is_shared: false,
            entity_id: leadId, entity_label: labelName,
            details: 'Комментарий не по шаблону (нужно: Сделано / Результат / Дальше / Когда)',
            how_to_fix: 'Используйте шаблон комментария в Скриптологе', fix_deadline: fixDeadline,
          }); violations++;
        }
      }
    }

    // ── s3_client_fields: client bought but name/phone incomplete ────────────
    if (enabled.has('s3_client_fields') && clientFbId && clientsWithContract.has(clientFbId)) {
      const name = clientNameMap.get(clientFbId) ?? '';
      const badName = !name || isBadName(name, stopWords);
      if (badName) {
        await upsertViolation({
          dedup_key: `s3_client_fields:${clientFbId}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_client_fields', owner_name: owner, is_shared: !owner,
          entity_id: leadId, entity_label: labelName,
          details: `После покупки карточка клиента неполная: имя «${name || 'пусто'}»`,
          how_to_fix: 'Заполните ФИО, дату рождения и город в карточке клиента',
          fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  // ── s3_no_next_step: trial visitors without next action ──────────────────
  violations += await checkS3TrialVisitors(dateStr, cfg, enabled, delaySec, nowMs, fixDeadline, stopWords, errors);

  return violations;
}

async function checkS3TrialVisitors(
  dateStr: string, cfg: ControlSettings, enabled: Set<string>,
  delaySec: number, nowMs: number, fixDeadline: string,
  stopWords: string[], errors: string[],
): Promise<number> {
  if (!enabled.has('s3_no_next_step') && !enabled.has('s3_bad_name')) return 0;

  // Load trial visits that happened on this date (status=3 = пришла)
  const { data: trials, error } = await supabase
    .from('fitbase_visits')
    .select('id,client_fitbase_id,visit_at,client_name')
    .eq('visit_date', dateStr)
    .eq('is_trial', true)
    .eq('status', 3);
  if (error) { errors.push(`s3_trial: ${error.message}`); return 0; }
  if (!trials?.length) return 0;

  let violations = 0;

  for (const visit of trials) {
    const visitId     = String(visit.id);
    const clientFbId  = visit.client_fitbase_id ? Number(visit.client_fitbase_id) : null;
    if (!clientFbId) continue;

    const visitAtMs = visit.visit_at ? new Date(visit.visit_at as string).getTime() : 0;
    if (!visitAtMs) continue;

    const cutoffMs = visitAtMs + delaySec * 1000;
    if (cutoffMs > nowMs) continue; // too early to fire

    const clientLabel = String(visit.client_name ?? `Клиент ${clientFbId}`);

    // Find crm_lead for this client
    const { data: lead } = await supabase.from('crm_leads')
      .select('id,fitbase_manager_name,title')
      .eq('fitbase_client_id', clientFbId).limit(1).maybeSingle();

    // s3_bad_name for trial visitors
    if (enabled.has('s3_bad_name')) {
      const name = clientLabel;
      if (isBadName(name, stopWords)) {
        await upsertViolation({
          dedup_key: `s3_bad_name:${clientFbId}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_bad_name', owner_name: null, is_shared: true,
          entity_id: visitId, entity_label: clientLabel,
          details: `Имя клиента служебное или неполное: «${name}»`,
          how_to_fix: 'Введите настоящие фамилию и имя в карточке клиента Fitbase',
          fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    if (!enabled.has('s3_no_next_step')) continue;

    if (!lead?.id) {
      // No lead at all after trial — always a violation
      await upsertViolation({
        dedup_key: `s3_no_next_step:${visitId}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_next_step', owner_name: null, is_shared: true,
        entity_id: visitId, entity_label: clientLabel,
        details: `Пришла на пробное, нет заявки в CRM и нет дальнейшего шага`,
        how_to_fix: 'Создайте заявку, добавьте задачу или переведите в «Отказ» с причиной',
        fix_deadline: fixDeadline,
      }); violations++;
      continue;
    }

    // Has lead — check for activity after trial
    const visitAt = visit.visit_at as string;
    const { data: acts } = await supabase.from('crm_lead_activity')
      .select('id').eq('lead_id', lead.id).gte('created_at', visitAt).limit(1);
    if (acts?.length) continue; // contact was made

    const { data: taskActs } = await supabase.from('crm_lead_tasks')
      .select('id').eq('lead_id', lead.id).gte('created_at', visitAt).limit(1);
    if (taskActs?.length) continue;

    const managerName = lead.fitbase_manager_name ? null : null; // resolved elsewhere
    await upsertViolation({
      dedup_key: `s3_no_next_step:${visitId}`, shift_date: dateStr, standard_num: 3,
      check_code: 's3_no_next_step', owner_name: null, is_shared: true,
      entity_id: String(lead.id), entity_label: clientLabel,
      details: `После пробного занятия нет следующего шага (покупка / задача / отказ)`,
      how_to_fix: 'Оформите покупку, создайте задачу или переведите в «Отказ» с причиной',
      fix_deadline: fixDeadline,
    }); violations++;
  }

  return violations;
}

function checkCommentTemplate(text: string): boolean {
  const lines  = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const labels = [/^(сделано|сделан)[:\s\-—]/i, /^результат[:\s\-—]/i, /^дальше[:\s\-—]/i, /^когда[:\s\-—]/i];
  let matched  = 0;
  for (const line of lines) {
    if (labels[matched]?.test(line)) matched++;
    if (matched === 4) return true;
  }
  return false;
}

// ── Standard 4: Base ──────────────────────────────────────────────────────────

async function checkS4(
  dateStr: string, cfg: ControlSettings,
  userMap: UserMap, finStaffMap: Map<string, string>,
  funnelUuids: FunnelUuids, isPast: boolean, errors: string[],
): Promise<number> {
  if (!cfg.s4_enabled) return 0;

  const enabled     = new Set(cfg.s4_checks);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const dayStart    = `${dateStr}T00:00:00+05:00`;
  const dayEnd      = `${dateStr}T23:59:59+05:00`;
  let violations    = 0;

  // Build client→cashier map from operations (once, shared across all s4 checks)
  let clientCashierMap = new Map<number, string>();
  if (enabled.has('s4_ending') || enabled.has('s4_ended')) {
    const { data: ops, error: opsErr } = await supabase
      .from('fitbase_operations')
      .select('cashier,raw,op_date')
      .order('op_date', { ascending: false })
      .limit(5000);
    if (opsErr) {
      errors.push(`s4: operations: ${opsErr.message}`);
    } else {
      for (const op of ops ?? []) {
        const raw      = op.raw as Record<string,unknown>|null;
        const clientId = Number((raw?.client as Record<string,unknown>|null)?.id ?? 0);
        const cashier  = String(op.cashier ?? '');
        if (clientId && cashier && !clientCashierMap.has(clientId)) {
          clientCashierMap.set(clientId, cashier);
        }
      }
    }
  }

  // ── s4_ending: visits_left ≤ threshold ─────────────────────────────────────
  // For past dates, we can't reconstruct contract state → skip (no_data handled in computeShiftScores)
  if (enabled.has('s4_ending') && !isPast) {
    const { data: contracts, error: cErr } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name,end_date,begin_date')
      .neq('status', 'closed')
      .not('client_fitbase_id', 'is', null);
    if (cErr) {
      errors.push(`s4_ending: ${cErr.message}`);
    } else {
      for (const c of contracts ?? []) {
        const raw      = c.raw as Record<string, unknown> | null;
        const ticket0  = raw?.ticket as Record<string,unknown>|null;
        const visitsLeft = Number(raw?.visits_left ?? ticket0?.visits_left ?? -1);
        if (visitsLeft < 0 || visitsLeft > cfg.s4_sessions_left) continue;

        const cashierFbName = clientCashierMap.get(Number(c.client_fitbase_id)) ?? '';
        const cashier = cashierFbName ? (finStaffMap.get(cashierFbName) ?? resolveName(cashierFbName, userMap)) : null;
        const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${c.client_fitbase_id}`);

        if (await hasContactToday(Number(c.client_fitbase_id), dayStart, dayEnd)) continue;

        await upsertViolation({
          dedup_key: `s4_ending:${c.client_fitbase_id}:${dateStr}`, shift_date: dateStr, standard_num: 4,
          check_code: 's4_ending', owner_name: cashier, is_shared: !cashier,
          entity_id: String(c.client_fitbase_id), entity_label: clientLabel,
          details: `Осталось ${visitsLeft} посещений (порог ≤${cfg.s4_sessions_left})`,
          how_to_fix: 'Напишите клиентке, предложите продление, сделайте комментарий и задачу', fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  // ── s4_ended: contract ended, not renewed ───────────────────────────────────
  if (enabled.has('s4_ended') && !isPast) {
    const daysAgo = yekDateMinus(cfg.s4_ended_contact_days);
    const { data: ended, error: eErr } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name,end_date')
      .eq('status', 'closed')
      .gte('end_date', daysAgo)
      .lte('end_date', yekDateMinus(1));
    if (eErr) {
      errors.push(`s4_ended: ${eErr.message}`);
    } else {
      for (const c of ended ?? []) {
        const clientId    = String(c.client_fitbase_id);
        const raw         = c.raw as Record<string, unknown> | null;
        const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${clientId}`);

        // Check if renewed (new contract after end_date)
        const { data: newer } = await supabase
          .from('fitbase_contracts')
          .select('id')
          .eq('client_fitbase_id', c.client_fitbase_id)
          .gte('payment_date', c.end_date as string)
          .neq('status', 'closed')
          .limit(1);
        if (newer?.length) continue;

        // Check if there's a reactivation activity
        const { data: activity } = await supabase
          .from('crm_lead_activity')
          .select('id')
          .eq('kind', 'comment')
          .gte('created_at', (c.end_date as string) + 'T00:00:00+05:00')
          .limit(1);
        if (activity?.length) continue;

        if (await hasContactToday(Number(c.client_fitbase_id), dayStart, dayEnd)) continue;

        await upsertViolation({
          dedup_key: `s4_ended:${clientId}:${dateStr}`, shift_date: dateStr, standard_num: 4,
          check_code: 's4_ended', owner_name: null, is_shared: true,
          entity_id: clientId, entity_label: clientLabel,
          details: `Абонемент закончился ${c.end_date}, продления нет`,
          how_to_fix: 'Свяжитесь с клиенткой, добавьте в «Реактивацию» с открытой задачей', fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  // ── s4_no_visits: active contract, no visits for N days ────────────────────
  if (enabled.has('s4_no_visits') && !isPast) {
    const noVisitSince = yekDateMinus(cfg.s4_no_visit_days);
    const { data: activeContracts, error: acErr } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name')
      .neq('status', 'closed')
      .gt('end_date', dateStr)
      .not('client_fitbase_id', 'is', null);
    if (acErr) {
      errors.push(`s4_no_visits: ${acErr.message}`);
    } else {
      for (const c of activeContracts ?? []) {
        const raw     = c.raw as Record<string,unknown> | null;
        const isTrial = /проб/i.test(String(raw?.name ?? c.name ?? ''));
        const isGift  = /подар/i.test(String(raw?.name ?? c.name ?? ''));
        if (isTrial || isGift) continue;

        const { data: lastVisit } = await supabase
          .from('fitbase_visits')
          .select('visit_date')
          .eq('client_fitbase_id', c.client_fitbase_id)
          .in('status', [3])
          .order('visit_date', { ascending: false })
          .limit(1);

        const lastDate = lastVisit?.[0]?.visit_date as string | undefined;
        if (lastDate && lastDate >= noVisitSince) continue;

        const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${c.client_fitbase_id}`);

        if (await hasContactToday(Number(c.client_fitbase_id), dayStart, dayEnd)) continue;

        await upsertViolation({
          dedup_key: `s4_no_visits:${c.client_fitbase_id}:${dateStr}`, shift_date: dateStr, standard_num: 4,
          check_code: 's4_no_visits', owner_name: null, is_shared: true,
          entity_id: String(c.client_fitbase_id), entity_label: clientLabel,
          details: `Нет визитов ${cfg.s4_no_visit_days}+ дней (последний: ${lastDate ?? 'нет'})`,
          how_to_fix: 'Позвоните клиентке, сделайте комментарий или задачу', fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  // ── s4_task_overdue: overdue tasks in base funnels (works for any date) ─────
  if (enabled.has('s4_task_overdue') && funnelUuids.base.length > 0) {
    const { data: overdue, error: odErr } = await supabase
      .from('crm_lead_tasks')
      .select('id,lead_id,due_at,closed_at,responsible_user_id,description')
      .eq('status', 'open')
      .lte('due_at', dayEnd)
      .gte('due_at', dayStart.slice(0, 10) + 'T00:00:00');
    if (odErr) {
      errors.push(`s4_task_overdue: ${odErr.message}`);
    } else {
      for (const t of overdue ?? []) {
        const { data: lead } = await supabase
          .from('crm_leads')
          .select('funnel_id,fitbase_manager_name,fitbase_id')
          .eq('id', t.lead_id)
          .maybeSingle();
        // Check if lead is in base funnels (UUIDs, not integers)
        if (!lead || !funnelUuids.base.includes(String(lead.funnel_id))) continue;

        const owner = resolveName(lead.fitbase_manager_name as string | null, userMap) ?? null;
        await upsertViolation({
          dedup_key: `s4_task_overdue:${t.id}:${dateStr}`, shift_date: dateStr, standard_num: 4,
          check_code: 's4_task_overdue', owner_name: owner, is_shared: !owner,
          entity_id: String(t.lead_id), entity_label: String(lead.fitbase_manager_name ?? 'Клиент'),
          details: `Задача со сроком ${(t.due_at as string)?.slice(0, 10)} не закрыта`,
          how_to_fix: 'Закройте задачу с результатом или поставьте новую', fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  return violations;
}

// ── Standard 5: Visits ────────────────────────────────────────────────────────

async function checkS5(
  dateStr: string, cfg: ControlSettings, isPast: boolean, errors: string[],
): Promise<number> {
  if (!cfg.s5_enabled) return 0;

  const enabled     = new Set(cfg.s5_checks);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const nowMs       = Date.now();
  let violations    = 0;

  const { data: visits, error } = await supabase
    .from('fitbase_visits')
    .select('id,client_fitbase_id,visit_date,visit_at,status,is_trial,client_name,resource')
    .eq('visit_date', dateStr);
  if (error) {
    errors.push(`s5: visits: ${error.message}`);
    return 0;
  }
  if (!visits?.length) return 0;

  for (const v of visits) {
    const clientFitbaseId = Number(v.client_fitbase_id ?? 0);
    const label   = String(v.client_name ?? `Клиент ${clientFitbaseId}`);
    const visitId = String(v.id);

    // s5_unmarked: status 0 or 1, N minutes after start
    if (enabled.has('s5_unmarked') && (v.status === 0 || v.status === 1)) {
      const visitStartMs = v.visit_at ? new Date(v.visit_at as string).getTime() : 0;
      if (visitStartMs > 0) {
        const minPassed = (nowMs - visitStartMs) / 60_000;
        // For past dates fire unconditionally; for today check threshold
        const shouldFire = isPast || minPassed > cfg.s5_mark_minutes;
        if (shouldFire) {
          await upsertViolation({
            dedup_key: `s5_unmarked:${visitId}:${dateStr}`, shift_date: dateStr, standard_num: 5,
            check_code: 's5_unmarked', owner_name: null, is_shared: true,
            entity_id: visitId, entity_label: label,
            details: `Запись не отмечена спустя ${Math.round(minPassed)} мин после начала (порог ${cfg.s5_mark_minutes} мин)`,
            how_to_fix: 'Отметьте статус занятия в расписании Fitbase', fix_deadline: fixDeadline,
          }); violations++;
        }
      }
    }

    // s5_no_abonement: status 3 (пришла), not trial — check if client has active contract
    if (enabled.has('s5_no_abonement') && v.status === 3 && !v.is_trial && clientFitbaseId) {
      const { data: active } = await supabase
        .from('fitbase_contracts')
        .select('id')
        .eq('client_fitbase_id', clientFitbaseId)
        .neq('status', 'closed')
        .gte('end_date', dateStr)
        .limit(1);
      if (!active?.length) {
        await upsertViolation({
          dedup_key: `s5_no_abonement:${visitId}:${dateStr}`, shift_date: dateStr, standard_num: 5,
          check_code: 's5_no_abonement', owner_name: null, is_shared: true,
          entity_id: visitId, entity_label: label,
          details: 'Клиентка отмечена «Пришла», но активного абонемента нет',
          how_to_fix: 'Оформите абонемент или проверьте правильность записи', fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // s5_expired_abonement: status 3, exists closed contract with end_date < today
    if (enabled.has('s5_expired_abonement') && v.status === 3 && clientFitbaseId) {
      const { data: contract } = await supabase
        .from('fitbase_contracts')
        .select('end_date')
        .eq('client_fitbase_id', clientFitbaseId)
        .eq('status', 'closed')
        .lt('end_date', dateStr)
        .order('end_date', { ascending: false })
        .limit(1);
      if (contract?.length) {
        await upsertViolation({
          dedup_key: `s5_expired_abonement:${visitId}:${dateStr}`, shift_date: dateStr, standard_num: 5,
          check_code: 's5_expired_abonement', owner_name: null, is_shared: true,
          entity_id: visitId, entity_label: label,
          details: `Занятие отмечено по закончившемуся абонементу (истёк ${contract[0].end_date})`,
          how_to_fix: 'Проверьте абонемент клиентки, при необходимости оформите новый', fix_deadline: fixDeadline,
        }); violations++;
      }
    }
  }

  return violations;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runControl(finalize = false, overrideDate?: string): Promise<Record<string, unknown>> {
  const cfg = await loadSettings();
  if (!cfg.enabled) return { status: 'disabled' };

  const todayYek = yekDate();
  const dateStr  = overrideDate ?? (finalize ? yekDateMinus(1) : todayYek);
  const isPast   = dateStr < todayYek;
  const shouldFinalize = finalize || isPast; // past dates are always finalized

  const stats: Record<string, unknown> = { date: dateStr, finalize: shouldFinalize };
  const errors: string[] = [];

  console.log(`[control] start date=${dateStr} finalize=${shouldFinalize} isPast=${isPast}`);

  const [onShiftResult, userMap, finStaffMap, funnelUuids] = await Promise.all([
    getOnShift(dateStr),
    loadUserMap(),
    loadFinStaffMap(),
    loadFunnelUuids(),
  ]);

  const { names: onShift, source: shiftSource } = onShiftResult;
  stats.on_shift  = onShift;
  stats.shift_source = shiftSource;
  console.log(`[control] on_shift: ${onShift.join(', ') || 'none'} (src: ${shiftSource})`);

  // Re-check past open violations (deadline → failed; condition gone → fixed)
  if (!isPast) {
    try { await recheckOpenViolations(dateStr, cfg); }
    catch (e) { errors.push(`recheck: ${(e as Error).message}`); }
  }

  // s4 for past dates → no_data (can't reconstruct contract state)
  const noDataStds: Set<number> = isPast ? new Set([4]) : new Set();

  // Run each standard (violations recorded regardless of who's on shift)
  for (const [stdNum, fn] of [
    [1, () => checkS1(dateStr, cfg, userMap, onShift, funnelUuids, errors)],
    [2, () => checkS2(dateStr, cfg, userMap, onShift, errors)],
    [3, () => checkS3(dateStr, cfg, userMap, funnelUuids, errors)],
    [4, () => checkS4(dateStr, cfg, userMap, finStaffMap, funnelUuids, isPast, errors)],
    [5, () => checkS5(dateStr, cfg, isPast, errors)],
  ] as [number, () => Promise<number>][]) {
    try {
      const count = await fn();
      stats[`s${stdNum}_violations`] = count;
    } catch (e) {
      const msg = `s${stdNum}: ${(e as Error).message}`;
      console.error(`[control] ${msg}`);
      errors.push(msg);
      stats[`s${stdNum}_violations`] = 0;
    }
  }

  // Compute shift scores (always, even with empty onShift — creates "(без смены)" row)
  try {
    await computeShiftScores(dateStr, onShift, cfg, shouldFinalize, noDataStds);
  } catch (e) {
    errors.push(`scores: ${(e as Error).message}`);
  }

  if (errors.length) stats.errors = errors;
  console.log(`[control] done: ${JSON.stringify(stats)}`);
  return stats;
}

// Run for a date range (day by day, used for history)
export async function runControlRange(from: string, to: string): Promise<Record<string, unknown>> {
  const days: string[] = [];
  let cur = new Date(from + 'T12:00:00Z');
  const end = new Date(to + 'T12:00:00Z');
  while (cur <= end && days.length < 60) { // cap at 60 days
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400_000);
  }

  const results: Record<string, unknown>[] = [];
  for (const day of days) {
    try {
      const r = await runControl(true, day);
      results.push({ day, ...r });
      console.log(`[control-range] ${day}: s1=${r.s1_violations} s2=${r.s2_violations} s3=${r.s3_violations}`);
    } catch (e) {
      results.push({ day, error: (e as Error).message });
      console.error(`[control-range] ${day}:`, (e as Error).message);
    }
  }
  return { from, to, days: days.length, results };
}
