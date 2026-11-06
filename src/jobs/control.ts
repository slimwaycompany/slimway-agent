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
  s3_booked_stage_ids:    number[];
  s3_task_max_days:       number;
  s3_checks:              string[];
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
  s3_checks:              ['s3_no_source','s3_no_manager','s3_wrong_stage','s3_no_task','s3_no_lost_reason','s3_bad_comment','s3_client_card'],
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
  const { data } = await supabase
    .from('control_settings')
    .select('key,value');
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
  await supabase
    .from('control_settings')
    .upsert(rows, { onConflict: 'key' });
}

// ── Who is on shift ───────────────────────────────────────────────────────────

async function getOnShift(dateStr: string): Promise<string[]> {
  const { data: shifts } = await supabase
    .from('staff_shifts')
    .select('user_name')
    .eq('shift_date', dateStr);
  if (shifts?.length) return [...new Set(shifts.map((s: Record<string, unknown>) => String(s.user_name)).filter(Boolean))];

  // fallback: metrics_day_input.on_shift
  const { data: day } = await supabase
    .from('metrics_day_input')
    .select('on_shift')
    .eq('branch_id', BRANCH_ID)
    .eq('day', dateStr)
    .maybeSingle();
  const arr = (day?.on_shift as string[] | undefined) ?? [];
  return arr.filter(Boolean);
}

// ── Name mapping: Fitbase name → app_users.display_name ──────────────────────

type UserMap = Map<string, string>; // fitbase_full_name → display_name

async function loadUserMap(): Promise<UserMap> {
  const { data } = await supabase
    .from('crm_fitbase_user_map')
    .select('fitbase_full_name,app_user_id,user_id')
    .not('fitbase_full_name', 'is', null);
  const map = new Map<string, string>();
  if (!data?.length) return map;

  // Load app_users to resolve display_name
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
  // next day at deadlineTime (UTC+5)
  const next = new Date(`${dateStr}T12:00:00+05:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return new Date(`${nextDate}T${deadlineTime}:00+05:00`).toISOString();
}

// ── Re-check open violations (may have been fixed) ────────────────────────────

async function recheckOpenViolations(dateStr: string, cfg: ControlSettings): Promise<void> {
  const { data: open } = await supabase
    .from('control_violations')
    .select('id,dedup_key,check_code,entity_id,fix_deadline,standard_num')
    .eq('branch_id', BRANCH_ID)
    .eq('status', 'open')
    .neq('shift_date', dateStr); // past days
  if (!open?.length) return;

  const now = new Date().toISOString();

  for (const v of open) {
    // After deadline → failed
    if (v.fix_deadline && v.fix_deadline < now) {
      await supabase
        .from('control_violations')
        .update({ status: 'failed', updated_at: now })
        .eq('id', v.id);
    }
    // Check if fixed (standard-specific re-check is complex; skip for now)
    // shortcut: re-check not implemented in this iteration — deadline-based only
  }
}

// ── Compute shift scores ──────────────────────────────────────────────────────

async function computeShiftScores(dateStr: string, onShift: string[], cfg: ControlSettings, finalize: boolean): Promise<void> {
  const standards = [1, 2, 3, 4, 5];

  for (const person of onShift) {
    for (const stdNum of standards) {
      const stdEnabled = getStdEnabled(stdNum, cfg);
      if (!stdEnabled) {
        await upsertScore(dateStr, person, stdNum, 'off', 0, 0, finalize);
        continue;
      }

      // Count violations for this person + this standard on this shift
      const { data: vios } = await supabase
        .from('control_violations')
        .select('id,status,is_shared')
        .eq('branch_id', BRANCH_ID)
        .eq('shift_date', dateStr)
        .eq('standard_num', stdNum)
        .or(`owner_name.eq.${person},is_shared.eq.true`);

      const all = vios ?? [];

      // №2 special: not_reviewed if no reviews checked for this person this shift
      if (stdNum === 2) {
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
        const result = anyFail ? 'fail' : 'ok';
        await upsertScore(dateStr, person, 2, result, all.length, anyFail ? 0 : cfg.standard_price, finalize);
        continue;
      }

      // №1: grace logic
      if (stdNum === 1) {
        const lateVios = all.filter(v => v.status !== 'waived' && (v as Record<string,unknown>).check_code !== 's1_no_contact');
        // shortcut: grace_count check not persisted per-violation; use violation count
        const graceOk = lateVios.length <= cfg.s1_grace_count;
        const noContact = all.some(v => !v.is_shared && (v as Record<string,unknown>).check_code === 's1_no_contact' && v.status !== 'waived');
        if (noContact || !graceOk) {
          await upsertScore(dateStr, person, 1, 'fail', all.length, 0, finalize);
        } else {
          await upsertScore(dateStr, person, 1, all.length ? 'ok' : 'ok', all.length, cfg.standard_price, finalize);
        }
        continue;
      }

      // General: open → pending, all fixed → fixed, any failed → fail
      const active = all.filter(v => v.status !== 'waived');
      const hasFailed  = active.some(v => v.status === 'failed');
      const hasOpen    = active.some(v => v.status === 'open');
      const allFixed   = active.length > 0 && active.every(v => v.status === 'fixed');
      const noVios     = active.length === 0;

      let result: string;
      let amount: number;
      if (noVios)         { result = 'ok';      amount = cfg.standard_price; }
      else if (hasFailed) { result = 'fail';    amount = 0; }
      else if (hasOpen)   { result = 'pending'; amount = 0; }
      else if (allFixed)  { result = 'fixed';   amount = cfg.standard_price; }
      else                { result = 'ok';      amount = cfg.standard_price; }

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

async function checkS1(dateStr: string, cfg: ControlSettings, userMap: UserMap, onShift: string[]): Promise<number> {
  if (!cfg.s1_enabled) return 0;

  const openMs = yekTimestampForDay(dateStr, cfg.open_time);
  const closeMs = yekTimestampForDay(dateStr, isWeekend(dateStr) ? cfg.close_time_weekend : cfg.close_time_weekday);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);

  // Get new leads in "Новые заявки" (funnel_id=1) created on day D
  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;

  const { data: leads } = await supabase
    .from('crm_leads')
    .select('id,fitbase_id,fitbase_manager_id,fitbase_manager_name,fb_created_at,phone')
    .eq('branch_id', BRANCH_ID)
    .eq('funnel_id', 1) // "Новые заявки"
    .gte('fb_created_at', dayStart)
    .lte('fb_created_at', dayEnd)
    .is('is_archived', false);

  if (!leads?.length) return 0;

  let violations = 0;

  for (const lead of leads) {
    const leadCreatedMs = new Date(lead.fb_created_at as string).getTime();
    // If outside working hours, start from opening
    const contactStartMs = leadCreatedMs < openMs ? openMs : leadCreatedMs;

    const fbManager = lead.fitbase_manager_name as string | null;
    const owner = fbManager ? resolveName(fbManager, userMap) : null;

    // Find first contact time
    const leadId = String(lead.id);
    const phone = lead.phone ? digitsOnly(String(lead.phone)) : null;

    // Activity in crm_lead_activity (after lead created)
    const { data: acts } = await supabase
      .from('crm_lead_activity')
      .select('author,created_at')
      .eq('lead_id', leadId)
      .neq('kind', 'system')
      .gte('created_at', (lead.fb_created_at as string))
      .order('created_at', { ascending: true })
      .limit(1);

    // Tasks in crm_lead_tasks
    const { data: tasks } = await supabase
      .from('crm_lead_tasks')
      .select('created_by,created_at')
      .eq('lead_id', leadId)
      .gte('created_at', (lead.fb_created_at as string))
      .order('created_at', { ascending: true })
      .limit(1);

    // Script events (insert/copy/sent) for this phone on day D
    let scriptContactMs = Infinity;
    if (phone) {
      const { data: se } = await supabase
        .from('script_events')
        .select('created_at,manager')
        .eq('client_id', `phone:${phone}`)
        .in('event_type', ['insert', 'copy', 'sent'])
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: true })
        .limit(1);
      if (se?.[0]) scriptContactMs = new Date(se[0].created_at as string).getTime();
    }

    const actMs = acts?.[0] ? new Date(acts[0].created_at as string).getTime() : Infinity;
    const taskMs = tasks?.[0] ? new Date(tasks[0].created_at as string).getTime() : Infinity;
    const firstContactMs = Math.min(actMs, taskMs, scriptContactMs);

    // No contact by end of day
    if (firstContactMs === Infinity || firstContactMs > closeMs) {
      const dedup = `s1_no_contact:${leadId}`;
      await upsertViolation({
        dedup_key:    dedup,
        shift_date:   dateStr,
        standard_num: 1,
        check_code:   's1_no_contact',
        owner_name:   null,
        is_shared:    true,
        entity_id:    leadId,
        entity_label: String(lead.fitbase_manager_name ?? 'Новая заявка'),
        details:      'Нет первого контакта с заявкой до конца рабочего дня',
        how_to_fix:   'Сделайте первое действие в карточке заявки или через Скриптолог',
        fix_deadline: fixDeadline,
      });
      violations++;
      continue;
    }

    const latencyMin = (firstContactMs - contactStartMs) / 60_000;
    if (latencyMin <= cfg.s1_contact_minutes) continue; // on time

    // Late — find who made the first contact
    let contactOwner: string | null = null;
    if (actMs <= Math.min(taskMs, scriptContactMs) && acts?.[0]?.author) {
      contactOwner = acts[0].author;
    } else if (taskMs <= Math.min(actMs, scriptContactMs) && tasks?.[0]?.created_by) {
      contactOwner = tasks[0].created_by;
    } else {
      contactOwner = owner;
    }

    const minLate = Math.round(latencyMin - cfg.s1_contact_minutes);
    const dedup = `s1_late:${leadId}`;
    await upsertViolation({
      dedup_key:    dedup,
      shift_date:   dateStr,
      standard_num: 1,
      check_code:   's1_late',
      owner_name:   contactOwner,
      is_shared:    !contactOwner,
      entity_id:    leadId,
      entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
      details:      `Первый контакт опоздал на ${minLate} мин (порог ${cfg.s1_contact_minutes} мин)`,
      how_to_fix:   'Нарушение скорости не исправляется, учитывается в итоге смены',
      fix_deadline: fixDeadline,
    });
    violations++;
  }

  return violations;
}

// ── Standard 2: Quality ───────────────────────────────────────────────────────

async function checkS2(dateStr: string, cfg: ControlSettings, userMap: UserMap, onShift: string[]): Promise<number> {
  if (!cfg.s2_enabled) return 0;

  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;
  const yesterday = new Date(new Date(dayEnd).getTime() - 86400_000).toISOString().slice(0, 10);

  // Get clients with script events on this day grouped by manager
  const { data: events } = await supabase
    .from('script_events')
    .select('client_id,event_type,fact_key,manager,created_at')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  if (!events?.length) return 0;

  // Group by manager → client
  const managerClients = new Map<string, Set<string>>();
  for (const ev of events) {
    if (!ev.manager || !ev.client_id) continue;
    const mgr = String(ev.manager);
    if (!managerClients.has(mgr)) managerClients.set(mgr, new Set());
    managerClients.get(mgr)!.add(String(ev.client_id));
  }

  let violations = 0;

  for (const [manager, clientKeys] of managerClients) {
    const toReview: Array<{ clientKey: string; flags: string[]; pickReason: string }> = [];

    for (const clientKey of clientKeys) {
      const clientId = clientKey;

      // Check flags
      const clientEvents = events.filter(e => e.client_id === clientId && e.manager === manager);
      const facts = new Set(clientEvents.filter(e => e.event_type === 'fact').map(e => e.fact_key));
      const hasFacts = facts.has('цель') || facts.has('goal') || facts.has('experience') || facts.has('опыт') || facts.has('time');
      const hasOutcome = clientEvents.some(e => e.event_type === 'answer' &&
        ['booked','refused','dnd','confirmed_trial'].some(x => String(e.fact_key ?? '').includes(x)));

      // Abandoned: last event is not an outcome and > 24h ago
      const lastEventTs = clientEvents.reduce((m, e) => Math.max(m, new Date(e.created_at as string).getTime()), 0);
      const isAbandoned = !hasOutcome && lastEventTs > 0 && (Date.now() - lastEventTs) > 86400_000;

      const flags: string[] = [];
      if (!hasFacts) flags.push('no_facts');
      if (!hasOutcome) flags.push('no_outcome');
      if (isAbandoned) flags.push('abandoned');

      if (flags.length > 0) {
        toReview.push({ clientKey: clientId, flags, pickReason: 'flagged' });
      }
    }

    // Add random non-flagged up to s2_random_per_shift
    const flaggedKeys = new Set(toReview.map(r => r.clientKey));
    const nonFlagged = [...clientKeys].filter(k => !flaggedKeys.has(k));
    const randomPicks = nonFlagged
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(0, cfg.s2_random_per_shift - toReview.length));
    for (const k of randomPicks) {
      toReview.push({ clientKey: k, flags: [], pickReason: 'random' });
    }

    // Upsert into control_quality_reviews (no violation created yet — only on save)
    for (const item of toReview) {
      await supabase
        .from('control_quality_reviews')
        .upsert({
          branch_id:       BRANCH_ID,
          shift_date:      dateStr,
          manager_name:    manager,
          client_key:      item.clientKey,
          pick_reason:     item.pickReason,
          flag_no_facts:   item.flags.includes('no_facts'),
          flag_no_outcome: item.flags.includes('no_outcome'),
          flag_abandoned:  item.flags.includes('abandoned'),
          updated_at:      new Date().toISOString(),
        }, { onConflict: 'branch_id,shift_date,manager_name,client_key' });
    }
  }

  return violations;
}

// ── Standard 3: Card ─────────────────────────────────────────────────────────

async function checkS3(dateStr: string, cfg: ControlSettings, userMap: UserMap): Promise<number> {
  if (!cfg.s3_enabled) return 0;

  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const enabled = new Set(cfg.s3_checks);

  // Get leads in "Новые заявки" worked on this shift (activity or task today)
  const { data: activeLeadIds } = await supabase
    .from('crm_lead_activity')
    .select('lead_id')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .neq('kind', 'system');

  const leadIds = [...new Set((activeLeadIds ?? []).map((r: Record<string,unknown>) => String(r.lead_id)))];
  if (!leadIds.length) return 0;

  const { data: leads } = await supabase
    .from('crm_leads')
    .select('id,fitbase_id,fitbase_manager_name,manager_user_id,ad_source_id,funnel_id,stage_id,phone,lost_reason_id')
    .eq('branch_id', BRANCH_ID)
    .eq('funnel_id', 1)
    .in('id', leadIds.slice(0, 200));

  if (!leads?.length) return 0;

  // Load funnel stages for this funnel
  const { data: stages } = await supabase
    .from('crm_funnel_stages')
    .select('id,kind,fitbase_id')
    .eq('funnel_id', 1);
  const stageById = new Map((stages ?? []).map((s: Record<string,unknown>) => [String(s.id), s]));

  // Load tasks for these leads
  const { data: tasks } = await supabase
    .from('crm_lead_tasks')
    .select('lead_id,status,due_at')
    .in('lead_id', leadIds.slice(0, 200))
    .eq('status', 'open');
  const tasksByLead = new Map<string, { due_at: string }[]>();
  for (const t of tasks ?? []) {
    const lid = String(t.lead_id);
    if (!tasksByLead.has(lid)) tasksByLead.set(lid, []);
    tasksByLead.get(lid)!.push({ due_at: t.due_at });
  }

  // Load last comment for each lead
  const { data: comments } = await supabase
    .from('crm_lead_activity')
    .select('lead_id,text,author,created_at')
    .in('lead_id', leadIds.slice(0, 200))
    .eq('kind', 'comment')
    .order('created_at', { ascending: false });
  const lastCommentByLead = new Map<string, { text: string; author: string; created_at: string }>();
  for (const c of comments ?? []) {
    const lid = String(c.lead_id);
    if (!lastCommentByLead.has(lid)) lastCommentByLead.set(lid, c as { text: string; author: string; created_at: string });
  }

  // Check for booked trial visits
  let bookedLeadFitIds: Set<number> = new Set();
  if (cfg.s3_booked_stage_ids.length && enabled.has('s3_wrong_stage')) {
    const { data: visits } = await supabase
      .from('fitbase_visits')
      .select('client_id')
      .in('status', [0, 1])
      .eq('is_trial', true);
    bookedLeadFitIds = new Set((visits ?? []).map((v: Record<string,unknown>) => Number(v.client_id)));
  }

  let violations = 0;

  for (const lead of leads) {
    const leadId = String(lead.id);
    const owner = resolveName(lead.fitbase_manager_name as string | null, userMap) ?? null;
    const stage = stageById.get(String(lead.stage_id));
    const stageKind = String((stage as Record<string,unknown> | undefined)?.kind ?? 'normal');

    // s3_no_source
    if (enabled.has('s3_no_source') && !lead.ad_source_id) {
      await upsertViolation({
        dedup_key: `s3_no_source:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_source', owner_name: owner, is_shared: !owner,
        entity_id: leadId, entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
        details: 'Не указан источник заявки', how_to_fix: 'Укажите источник в карточке заявки', fix_deadline: fixDeadline,
      }); violations++;
    }

    // s3_no_manager
    if (enabled.has('s3_no_manager') && !lead.fitbase_manager_name && !lead.manager_user_id) {
      await upsertViolation({
        dedup_key: `s3_no_manager:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_manager', owner_name: null, is_shared: true,
        entity_id: leadId, entity_label: 'Заявка без менеджера',
        details: 'Заявка без назначенного менеджера', how_to_fix: 'Назначьте менеджера в карточке заявки', fix_deadline: fixDeadline,
      }); violations++;
    }

    // s3_no_task (skip for success/fail stages)
    if (enabled.has('s3_no_task') && stageKind !== 'success' && stageKind !== 'fail') {
      const leadTasks = tasksByLead.get(leadId) ?? [];
      const maxDue = new Date(Date.now() + TZ_MS + cfg.s3_task_max_days * 86400_000).toISOString().slice(0, 10);
      const hasTask = leadTasks.some(t => t.due_at && t.due_at.slice(0, 10) <= maxDue);
      if (!hasTask) {
        await upsertViolation({
          dedup_key: `s3_no_task:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
          check_code: 's3_no_task', owner_name: owner, is_shared: !owner,
          entity_id: leadId, entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
          details: `Нет открытой задачи со сроком ≤${cfg.s3_task_max_days} дней`,
          how_to_fix: 'Создайте задачу в карточке заявки', fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // s3_no_lost_reason
    if (enabled.has('s3_no_lost_reason') && stageKind === 'fail' && !lead.lost_reason_id) {
      await upsertViolation({
        dedup_key: `s3_no_lost_reason:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
        check_code: 's3_no_lost_reason', owner_name: owner, is_shared: !owner,
        entity_id: leadId, entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
        details: 'Этап «Отказ» без причины отказа', how_to_fix: 'Укажите причину отказа в карточке заявки', fix_deadline: fixDeadline,
      }); violations++;
    }

    // s3_bad_comment
    if (enabled.has('s3_bad_comment')) {
      const lastComment = lastCommentByLead.get(leadId);
      // Only check if there is a comment today from this manager
      if (lastComment && lastComment.created_at >= dayStart && lastComment.created_at <= dayEnd) {
        const text = String(lastComment.text || '');
        const isBad = !checkCommentTemplate(text);
        if (isBad) {
          await upsertViolation({
            dedup_key: `s3_bad_comment:${leadId}:${dateStr}`, shift_date: dateStr, standard_num: 3,
            check_code: 's3_bad_comment', owner_name: lastComment.author ?? owner, is_shared: false,
            entity_id: leadId, entity_label: String(lead.fitbase_manager_name ?? 'Заявка'),
            details: 'Комментарий не по шаблону (нужно: Сделано / Результат / Дальше / Когда)',
            how_to_fix: 'Используйте шаблон комментария в Скриптологе или впишите 4 строки по шаблону', fix_deadline: fixDeadline,
          }); violations++;
        }
      }
    }
  }

  return violations;
}

// Comment template check: 4 lines starting with Сделано/Результат/Дальше/Когда
function checkCommentTemplate(text: string): boolean {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const labels = [/^(сделано|сделан)[:\s\-—]/i, /^результат[:\s\-—]/i, /^дальше[:\s\-—]/i, /^когда[:\s\-—]/i];
  let matched = 0;
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
): Promise<number> {
  if (!cfg.s4_enabled) return 0;

  const enabled = new Set(cfg.s4_checks);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const dayStart = `${dateStr}T00:00:00+05:00`;
  const dayEnd   = `${dateStr}T23:59:59+05:00`;
  let violations = 0;

  // ── s4_ending: visits_left ≤ threshold ──────────────────────────────────
  if (enabled.has('s4_ending')) {
    // Use fitbase_contracts.raw for visits_left; fallback: total_visits - visits status 3
    const { data: contracts } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name,end_date,begin_date')
      .is('closed', false)
      .not('client_fitbase_id', 'is', null);

    for (const c of contracts ?? []) {
      const raw = c.raw as Record<string, unknown> | null;
      const ticket0 = raw?.ticket as Record<string,unknown>|null;
      const visitsLeft = Number(raw?.visits_left ?? ticket0?.visits_left ?? -1);
      if (visitsLeft < 0 || visitsLeft > cfg.s4_sessions_left) continue;

      // Find cashier who sold (from fitbase_operations)
      const { data: op } = await supabase
        .from('fitbase_operations')
        .select('cashier,manager')
        .eq('client_id', c.client_fitbase_id)
        .order('pay_ts', { ascending: false })
        .limit(1);
      const cashierFbName = String(op?.[0]?.cashier ?? '');
      const cashier = cashierFbName ? (finStaffMap.get(cashierFbName) ?? resolveName(cashierFbName, userMap)) : null;

      const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${c.client_fitbase_id}`);
      const dedup = `s4_ending:${c.client_fitbase_id}:${dateStr}`;
      await upsertViolation({
        dedup_key: dedup, shift_date: dateStr, standard_num: 4,
        check_code: 's4_ending', owner_name: cashier, is_shared: !cashier,
        entity_id: String(c.client_fitbase_id), entity_label: clientLabel,
        details: `Осталось ${visitsLeft} посещений (порог ≤${cfg.s4_sessions_left})`,
        how_to_fix: 'Напишите клиентке, предложите продление, сделайте комментарий и задачу', fix_deadline: fixDeadline,
      }); violations++;
    }
  }

  // ── s4_ended: contract ended, not renewed ────────────────────────────────
  if (enabled.has('s4_ended')) {
    const daysAgo = yekDateMinus(cfg.s4_ended_contact_days);
    const { data: ended } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name,end_date')
      .eq('closed', true)
      .gte('end_date', daysAgo)
      .lte('end_date', yekDateMinus(1)); // ended yesterday or earlier

    for (const c of ended ?? []) {
      const clientId = String(c.client_fitbase_id);
      const raw = c.raw as Record<string, unknown> | null;
      const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${clientId}`);

      // Check if renewed (new contract after end_date)
      const { data: newer } = await supabase
        .from('fitbase_contracts')
        .select('id')
        .eq('client_fitbase_id', c.client_fitbase_id)
        .gte('payment_date', c.end_date as string)
        .is('closed', false)
        .limit(1);
      if (newer?.length) continue;

      // Check if there's a comment or reactivation task
      const { data: activity } = await supabase
        .from('crm_lead_activity')
        .select('id')
        .eq('kind', 'comment')
        .gte('created_at', (c.end_date as string) + 'T00:00:00+05:00')
        .limit(1);
      if (activity?.length) continue;

      const dedup = `s4_ended:${clientId}:${dateStr}`;
      await upsertViolation({
        dedup_key: dedup, shift_date: dateStr, standard_num: 4,
        check_code: 's4_ended', owner_name: null, is_shared: true,
        entity_id: clientId, entity_label: clientLabel,
        details: `Абонемент закончился ${c.end_date}, продления нет`,
        how_to_fix: 'Свяжитесь с клиенткой, добавьте в «Реактивацию» с открытой задачей', fix_deadline: fixDeadline,
      }); violations++;
    }
  }

  // ── s4_no_visits: active contract, no visits for N days ──────────────────
  if (enabled.has('s4_no_visits')) {
    const noVisitSince = yekDateMinus(cfg.s4_no_visit_days);
    const { data: activeContracts } = await supabase
      .from('fitbase_contracts')
      .select('id,client_fitbase_id,raw,name')
      .is('closed', false)
      .gt('end_date', dateStr)
      .not('client_fitbase_id', 'is', null);

    for (const c of activeContracts ?? []) {
      const raw = c.raw as Record<string,unknown> | null;
      const ticket = raw?.ticket as Record<string,unknown>|null;
      // Skip trial and gift contracts
      const price = Number(raw?.price ?? c.name ?? 0);
      const isTrial = /проб/i.test(String(raw?.name ?? c.name ?? '')) || price === 0;
      const isGift  = /подар/i.test(String(raw?.name ?? c.name ?? ''));
      if (isTrial || isGift) continue;

      // Last visit
      const { data: lastVisit } = await supabase
        .from('fitbase_visits')
        .select('visit_date')
        .eq('client_id', c.client_fitbase_id)
        .in('status', [3]) // пришла
        .order('visit_date', { ascending: false })
        .limit(1);

      const lastDate = lastVisit?.[0]?.visit_date as string | undefined;
      if (lastDate && lastDate >= noVisitSince) continue;

      // Check for comment after last visit
      const clientLabel = String((raw?.client as Record<string,unknown>|null)?.name ?? `Клиент ${c.client_fitbase_id}`);
      const dedup = `s4_no_visits:${c.client_fitbase_id}:${dateStr}`;
      await upsertViolation({
        dedup_key: dedup, shift_date: dateStr, standard_num: 4,
        check_code: 's4_no_visits', owner_name: null, is_shared: true,
        entity_id: String(c.client_fitbase_id), entity_label: clientLabel,
        details: `Нет визитов ${cfg.s4_no_visit_days}+ дней (последний: ${lastDate ?? 'нет'})`,
        how_to_fix: 'Позвоните клиентке, сделайте комментарий или задачу', fix_deadline: fixDeadline,
      }); violations++;
    }
  }

  // ── s4_task_overdue: overdue tasks in base funnels ───────────────────────
  if (enabled.has('s4_task_overdue')) {
    const { data: overdue } = await supabase
      .from('crm_lead_tasks')
      .select('id,lead_id,due_at,closed_at,responsible_user_id,description')
      .eq('status', 'open')
      .lte('due_at', dayEnd)
      .gte('due_at', dayStart.slice(0, 10) + 'T00:00:00'); // due today

    for (const t of overdue ?? []) {
      // Check if lead is in base funnels (2=Новички, 3=Постоянные, 4=Реактивация)
      const { data: lead } = await supabase
        .from('crm_leads')
        .select('funnel_id,fitbase_manager_name,fitbase_id')
        .eq('id', t.lead_id)
        .maybeSingle();
      if (!lead || ![2, 3, 4].includes(Number(lead.funnel_id))) continue;

      const owner = resolveName(lead.fitbase_manager_name as string | null, userMap) ?? null;
      const dedup = `s4_task_overdue:${t.id}:${dateStr}`;
      await upsertViolation({
        dedup_key: dedup, shift_date: dateStr, standard_num: 4,
        check_code: 's4_task_overdue', owner_name: owner, is_shared: !owner,
        entity_id: String(t.lead_id), entity_label: String(lead.fitbase_manager_name ?? 'Клиент'),
        details: `Задача со сроком ${(t.due_at as string)?.slice(0, 10)} не закрыта`,
        how_to_fix: 'Закройте задачу с результатом или поставьте новую', fix_deadline: fixDeadline,
      }); violations++;
    }
  }

  return violations;
}

// ── Standard 5: Visits ────────────────────────────────────────────────────────

async function checkS5(dateStr: string, cfg: ControlSettings): Promise<number> {
  if (!cfg.s5_enabled) return 0;

  const enabled = new Set(cfg.s5_checks);
  const fixDeadline = computeFixDeadline(dateStr, cfg.fix_deadline_time);
  const nowMs = Date.now();
  let violations = 0;

  // Get all visits for the day
  const { data: visits } = await supabase
    .from('fitbase_visits')
    .select('id,client_id,visit_date,time_start,status,is_trial,abonement,resource')
    .eq('visit_date', dateStr);

  if (!visits?.length) return 0;

  for (const v of visits) {
    const clientId = String(v.client_id ?? '');
    const label = `Клиент ${clientId}`;
    const visitId = String(v.id);

    // s5_unmarked: status 0 or 1, N minutes after start
    if (enabled.has('s5_unmarked') && (v.status === 0 || v.status === 1)) {
      const timeStr = String(v.time_start ?? '').slice(0, 5); // HH:MM
      if (timeStr) {
        const visitStartMs = yekTimestampForDay(dateStr, timeStr);
        const minPassed = (nowMs - visitStartMs) / 60_000;
        if (minPassed > cfg.s5_mark_minutes) {
          const dedup = `s5_unmarked:${visitId}:${dateStr}`;
          await upsertViolation({
            dedup_key: dedup, shift_date: dateStr, standard_num: 5,
            check_code: 's5_unmarked', owner_name: null, is_shared: true,
            entity_id: visitId, entity_label: label,
            details: `Запись не отмечена спустя ${Math.round(minPassed)} мин после начала (порог ${cfg.s5_mark_minutes} мин)`,
            how_to_fix: 'Отметьте статус занятия в расписании Fitbase', fix_deadline: fixDeadline,
          }); violations++;
        }
      }
    }

    // s5_no_abonement: status 3 (пришла), not trial, no abonement
    if (enabled.has('s5_no_abonement') && v.status === 3 && !v.is_trial) {
      const hasAbonement = !!v.abonement;
      if (!hasAbonement) {
        const dedup = `s5_no_abonement:${visitId}:${dateStr}`;
        await upsertViolation({
          dedup_key: dedup, shift_date: dateStr, standard_num: 5,
          check_code: 's5_no_abonement', owner_name: null, is_shared: true,
          entity_id: visitId, entity_label: label,
          details: 'Клиентка отмечена как «Пришла», но абонемент не указан',
          how_to_fix: 'Привяжите абонемент к записи в Fitbase', fix_deadline: fixDeadline,
        }); violations++;
      }
    }

    // s5_expired_abonement: status 3 (пришла), abonement exists but its end_date < today
    if (enabled.has('s5_expired_abonement') && v.status === 3 && v.abonement) {
      // Check fitbase_contracts for this client
      const { data: contract } = await supabase
        .from('fitbase_contracts')
        .select('end_date,closed')
        .eq('client_fitbase_id', v.client_id)
        .eq('closed', true)
        .lt('end_date', dateStr)
        .order('end_date', { ascending: false })
        .limit(1);
      if (contract?.length) {
        const dedup = `s5_expired_abonement:${visitId}:${dateStr}`;
        await upsertViolation({
          dedup_key: dedup, shift_date: dateStr, standard_num: 5,
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

export async function runControl(finalize = false): Promise<Record<string, unknown>> {
  const cfg = await loadSettings();
  if (!cfg.enabled) return { status: 'disabled' };

  const dateStr = finalize ? yekDateMinus(1) : yekDate();
  const stats: Record<string, unknown> = { date: dateStr, finalize };
  const errors: string[] = [];

  console.log(`[control] start date=${dateStr} finalize=${finalize}`);

  const [onShift, userMap, finStaffMap] = await Promise.all([
    getOnShift(dateStr),
    loadUserMap(),
    loadFinStaffMap(),
  ]);

  stats.on_shift = onShift;
  console.log(`[control] on_shift: ${onShift.join(', ') || 'none'}`);

  // Re-check past open violations (deadline → failed)
  if (!finalize) {
    try { await recheckOpenViolations(dateStr, cfg); }
    catch (e) { errors.push(`recheck: ${(e as Error).message}`); }
  }

  // Run each standard
  for (const [stdNum, fn] of [
    [1, () => checkS1(dateStr, cfg, userMap, onShift)],
    [2, () => checkS2(dateStr, cfg, userMap, onShift)],
    [3, () => checkS3(dateStr, cfg, userMap)],
    [4, () => checkS4(dateStr, cfg, userMap, finStaffMap)],
    [5, () => checkS5(dateStr, cfg)],
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

  // Compute shift scores
  if (onShift.length) {
    try { await computeShiftScores(dateStr, onShift, cfg, finalize); }
    catch (e) { errors.push(`scores: ${(e as Error).message}`); }
  } else {
    // Shared scores even without named staff (edge case)
    console.log('[control] no shift staff found — skipping score computation');
  }

  if (errors.length) stats.errors = errors;
  console.log(`[control] done: ${JSON.stringify(stats)}`);
  return stats;
}
