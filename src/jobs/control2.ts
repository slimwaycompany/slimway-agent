/**
 * Control 2.0 — engine v2.
 * Runs per-role line checks for each person with a known role on day D.
 * Compatible params with /run/control: ?date=, ?from=&to=, ?finalize=1
 */
import { supabase } from '../db/supabase';
import { catalog, CheckCtx, CheckResult, ViolationSpec } from '../control/catalog';
import { getLineVersion, seedDefaultVersions, calcVariablePay, LineConfig, PointConfig, CheckConfig } from '../control/lineVersions';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const TZ_MS = 5 * 3600_000;

function yekNow() { return new Date(Date.now() + TZ_MS); }
function yekDate(d?: Date): string { return (d ?? yekNow()).toISOString().slice(0, 10); }

export type Control2Role = 'call_center' | 'consultant';

interface PersonDay {
  userName: string;
  role: Control2Role;
  roleSource: 'staff_shift' | 'schedule';
}

interface DayStats {
  date: string;
  evaluated: number;
  violations: number;
  noRole: string[];
  errors: string[];
}

// ── Load who's working today with their role ──────────────────────────────────

async function getPeopleWithRoles(date: string): Promise<{ people: PersonDay[]; noRole: string[] }> {
  // Load staff_shifts for the day
  const { data: shifts } = await supabase
    .from('staff_shifts')
    .select('user_name, role, started_at')
    .eq('branch_id', BRANCH_ID)
    .gte('started_at', `${date}T00:00:00+05:00`)
    .lte('started_at', `${date}T23:59:59+05:00`);

  // Load control_shift_schedule for the day
  const { data: sched } = await supabase
    .from('control_shift_schedule')
    .select('user_name, role')
    .eq('branch_id', BRANCH_ID)
    .eq('shift_date', date);

  const schedMap = new Map<string, Control2Role>();
  for (const row of sched ?? []) {
    if (row.role === 'call_center' || row.role === 'consultant') {
      schedMap.set(String(row.user_name), row.role as Control2Role);
    }
  }

  const seen = new Set<string>();
  const people: PersonDay[] = [];
  const noRole: string[] = [];

  for (const shift of shifts ?? []) {
    const name = String(shift.user_name);
    if (seen.has(name)) continue;
    seen.add(name);

    if (shift.role === 'call_center' || shift.role === 'consultant') {
      people.push({ userName: name, role: shift.role as Control2Role, roleSource: 'staff_shift' });
    } else if (schedMap.has(name)) {
      people.push({ userName: name, role: schedMap.get(name)!, roleSource: 'schedule' });
    } else {
      noRole.push(name);
    }
  }

  // Also check schedule for people without staff_shifts (planned but not checked in)
  for (const row of sched ?? []) {
    const name = String(row.user_name);
    if (seen.has(name)) continue;
    if (row.role === 'call_center' || row.role === 'consultant') {
      seen.add(name);
      people.push({ userName: name, role: row.role as Control2Role, roleSource: 'schedule' });
    }
  }

  return { people, noRole };
}

// ── Load context data for a person+day ───────────────────────────────────────

async function loadPersonCtxData(userName: string, date: string) {
  const [shiftsRes, schedRes, visitsRes, contractsRes, measurementsRes, ibTestsRes] = await Promise.all([
    supabase.from('staff_shifts')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .eq('user_name', userName)
      .gte('started_at', `${date}T00:00:00+05:00`)
      .lte('started_at', `${date}T23:59:59+05:00`),

    supabase.from('control_shift_schedule')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .eq('shift_date', date)
      .eq('user_name', userName)
      .maybeSingle(),

    supabase.from('fitbase_visits')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .gte('visit_date', date)
      .lte('visit_date', date),

    supabase.from('fitbase_contracts')
      .select('*')
      .eq('branch_id', BRANCH_ID),

    supabase.from('body_measurements')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .gte('measure_date', yekDate(new Date(new Date(date + 'T12:00:00Z').getTime() - 35 * 86400_000)))
      .lte('measure_date', date),

    supabase.from('inbody_tests')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .gte('test_date', yekDate(new Date(new Date(date + 'T12:00:00Z').getTime() - 35 * 86400_000)))
      .lte('test_date', date),
  ]);

  return {
    shifts: shiftsRes.data ?? [],
    schedule: schedRes.data ?? null,
    visits: visitsRes.data ?? [],
    contracts: contractsRes.data ?? [],
    measurements: measurementsRes.data ?? [],
    ibTests: ibTestsRes.data ?? [],
  };
}

// ── Upsert violation row ──────────────────────────────────────────────────────

async function upsertViolation(
  date: string,
  userName: string,
  role: Control2Role,
  pointKey: string,
  checkKey: string,
  versionId: string,
  spec: ViolationSpec,
): Promise<void> {
  const { data: existing } = await supabase
    .from('control_violations')
    .select('id, status')
    .eq('dedup_key', spec.dedup_key)
    .maybeSingle();

  if (existing) {
    // Don't overwrite waived/resolved violations
    if (existing.status === 'waived') return;
    await supabase.from('control_violations').update({
      details: spec.details,
      how_to_fix: spec.how_to_fix,
      evidence: spec.evidence,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return;
  }

  await supabase.from('control_violations').insert({
    branch_id: BRANCH_ID,
    dedup_key: spec.dedup_key,
    shift_date: date,
    owner_name: userName,
    role,
    point_key: pointKey,
    check_key: checkKey,
    version_id: versionId,
    details: spec.details,
    how_to_fix: spec.how_to_fix,
    evidence: spec.evidence,
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

// ── Upsert point score ────────────────────────────────────────────────────────

async function upsertPointScore(
  date: string,
  userName: string,
  role: Control2Role,
  pointKey: string,
  violated: boolean,
  pending: boolean,
  isFinal: boolean,
): Promise<void> {
  const result = pending ? 'pending' : (violated ? 'fail' : 'ok');
  await supabase.from('control_point_scores').upsert({
    branch_id: BRANCH_ID,
    shift_date: date,
    user_name: userName,
    role,
    point_key: pointKey,
    result,
    is_final: isFinal,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id,shift_date,user_name,point_key' });
}

// ── Upsert shift pay ──────────────────────────────────────────────────────────

async function upsertShiftPay(
  date: string,
  userName: string,
  role: Control2Role,
  config: LineConfig,
  violatedPointCount: number,
  isFinal: boolean,
): Promise<void> {
  const fixedPay = config.fixed_pay;
  const variablePay = calcVariablePay(config, violatedPointCount);
  const totalPay = fixedPay + variablePay;

  await supabase.from('control_shift_pay').upsert({
    branch_id: BRANCH_ID,
    shift_date: date,
    user_name: userName,
    role,
    fixed_pay: fixedPay,
    variable_pay: variablePay,
    total_pay: totalPay,
    violated_points: violatedPointCount,
    is_final: isFinal,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id,shift_date,user_name' });
}

// ── Auto-accept reviews past deadline ────────────────────────────────────────

async function autoAcceptStaleReviews(reviewAutoDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - reviewAutoDays * 86400_000).toISOString();
  const { data: stale } = await supabase
    .from('control_manual_reviews')
    .select('id')
    .eq('branch_id', BRANCH_ID)
    .is('result', null)
    .lt('created_at', cutoff);

  if (!stale?.length) return 0;
  const ids = stale.map(r => r.id);
  await supabase.from('control_manual_reviews')
    .update({ result: 'ok', reviewed_by: 'system', reviewed_at: new Date().toISOString() })
    .in('id', ids);
  return ids.length;
}

// ── Evaluate one person for one day ──────────────────────────────────────────

interface PersonResult {
  violated: string[];   // point keys
  pending: string[];    // point keys with open manual reviews
  errors: string[];
}

async function evaluatePerson(
  userName: string,
  role: Control2Role,
  date: string,
  config: LineConfig,
  versionId: string,
  isFinal: boolean,
): Promise<PersonResult> {
  const ctxData = await loadPersonCtxData(userName, date);
  const result: PersonResult = { violated: [], pending: [], errors: [] };

  for (const point of config.points) {
    if (!point.enabled) continue;

    let pointViolated = false;
    let pointPending = false;

    for (const check of point.checks) {
      if (!check.enabled) continue;

      const checkType = catalog.find(c => c.key === check.type);
      if (!checkType) {
        result.errors.push(`Unknown check type: ${check.type} in point ${point.key}`);
        continue;
      }

      const ctx: CheckCtx = {
        date,
        userName,
        branchId: BRANCH_ID,
        role,
        params: check.params,
        ...ctxData,
      };

      let checkResult: CheckResult;
      try {
        checkResult = await checkType.evaluate(ctx);
      } catch (e) {
        result.errors.push(`${check.type}: ${(e as Error).message}`);
        continue;
      }

      if (checkResult.outcome === 'violation') {
        pointViolated = true;
        for (const spec of checkResult.violations) {
          await upsertViolation(date, userName, role, point.key, check.key, versionId, spec);
        }
      } else if (checkResult.outcome === 'pending') {
        pointPending = true;
      }
    }

    if (pointViolated) result.violated.push(point.key);
    else if (pointPending) result.pending.push(point.key);

    await upsertPointScore(date, userName, role, point.key, pointViolated, pointPending, isFinal);
  }

  await upsertShiftPay(date, userName, role, config, result.violated.length, isFinal);
  return result;
}

// ── Determine if scores for this date are final ───────────────────────────────

function isFinalForDate(date: string, config: LineConfig): boolean {
  if (config.finalize === 'next_morning') {
    // Final once today > date (i.e. the morning after)
    return yekDate() > date;
  }
  // after_review: not automatically final (requires manual sign-off or auto-accept)
  return false;
}

// ── Main per-day runner ───────────────────────────────────────────────────────

async function runDay(date: string): Promise<DayStats> {
  const { people, noRole } = await getPeopleWithRoles(date);
  const stats: DayStats = { date, evaluated: 0, violations: 0, noRole, errors: [] };

  // Group by role to load version once per role
  const byRole = new Map<Control2Role, PersonDay[]>();
  for (const p of people) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }

  for (const [role, group] of byRole) {
    const version = await getLineVersion(role, date);
    if (!version) {
      stats.errors.push(`No line version for role=${role} date=${date}`);
      continue;
    }
    const isFinal = isFinalForDate(date, version.config);

    // Auto-accept stale manual reviews
    await autoAcceptStaleReviews(version.config.review_auto_days);

    for (const person of group) {
      try {
        const r = await evaluatePerson(person.userName, role, date, version.config, version.id, isFinal);
        stats.evaluated++;
        stats.violations += r.violated.length;
        if (r.errors.length) stats.errors.push(`${person.userName}: ${r.errors.join('; ')}`);
      } catch (e) {
        stats.errors.push(`${person.userName}: ${(e as Error).message}`);
      }
    }
  }

  if (noRole.length) {
    console.log(`[control2] ${date}: no role — ${noRole.join(', ')}`);
  }

  return stats;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runControl2(date?: string): Promise<DayStats> {
  await seedDefaultVersions();
  const d = date ?? yekDate();
  console.log(`[control2] running for ${d}`);
  return runDay(d);
}

export async function runControl2Range(from: string, to: string): Promise<DayStats[]> {
  await seedDefaultVersions();
  const results: DayStats[] = [];
  let cur = from;
  while (cur <= to) {
    console.log(`[control2] range: ${cur}`);
    const stats = await runDay(cur);
    results.push(stats);
    // advance by 1 day
    cur = new Date(new Date(cur + 'T12:00:00Z').getTime() + 86400_000).toISOString().slice(0, 10);
  }
  return results;
}
