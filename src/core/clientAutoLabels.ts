import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

export interface AutoLabelResult {
  code: string; name: string; short_name: string; color: string; sort: number;
}

export interface ClientExtraData {
  profile_complete?: boolean;
  birth_date?: string | null;
}

export interface BookingInputForLabels {
  id: string; client_id: string; booking_date: string; kind: string;
  client_plan_id: string | null; client_plan_item_id: string | null;
  sessions_left: number | null; starts_at: string; status: string;
  is_free_booking?: boolean;
}

type LabelDef = {
  code: string; name: string; short_name: string; color: string; sort: number;
  params: Record<string, number>;
};

function nowUTC5(): Date { return new Date(Date.now() + 5 * 3600_000); }
function daysDiff(from: Date, to: Date): number { return (to.getTime() - from.getTime()) / 86_400_000; }

async function loadDefs(): Promise<Map<string, LabelDef>> {
  const { data } = await supabase.from('crm_client_auto_labels')
    .select('code,name,short_name,color,sort,params').eq('is_active', true).order('sort');
  if (!data || data.length === 0) return new Map();
  return new Map((data as LabelDef[]).map(d => [d.code, d]));
}

function pushLabel(labels: AutoLabelResult[], def: LabelDef) {
  labels.push({ code: def.code, name: def.name, short_name: def.short_name, color: def.color, sort: def.sort });
}

// Mode (a): per-booking labels for schedule/day view
export async function batchAutoLabelsForDay(
  bookings: BookingInputForLabels[],
): Promise<Map<string, AutoLabelResult[]>> {
  const result = new Map<string, AutoLabelResult[]>();
  for (const b of bookings) result.set(b.id, []);
  if (bookings.length === 0) return result;

  const defs = await loadDefs();
  if (defs.size === 0) return result;

  const clientIds = [...new Set(bookings.map(b => b.client_id).filter(Boolean))];
  const itemIds   = [...new Set(bookings.map(b => b.client_plan_item_id).filter((x): x is string => !!x))];

  // Round 1: five parallel queries
  const [attendedRes, histRes, plansRes, bodyClientsRes, bookedItemsRes] = await Promise.all([
    supabase.from('crm_bookings')
      .select('client_id,client_plan_id,starts_at')
      .eq('branch_id', BRANCH_ID).eq('status', 'attended').in('client_id', clientIds),
    supabase.from('crm_visit_history')
      .select('client_id,visit_at').eq('status', 'attended').in('client_id', clientIds),
    supabase.from('crm_client_plans')
      .select('id,client_id,plan_id,status,sessions_left,valid_until,extra_until,activated_at')
      .in('client_id', clientIds).in('status', ['active', 'not_activated']),
    clientIds.length
      ? supabase.from('body_clients').select('id,crm_client_id,phone_digits')
          .in('crm_client_id', clientIds).not('crm_client_id', 'is', null)
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    itemIds.length
      ? supabase.from('crm_bookings').select('client_plan_item_id,starts_at')
          .in('client_plan_item_id', itemIds).in('status', ['booked', 'confirmed'])
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
  ]);

  // Build maps from Round 1
  const attendedTsByClient = new Map<string, string[]>();
  const attendedTsByPlan   = new Map<string, string[]>();
  for (const b of (attendedRes.data || []) as Record<string,unknown>[]) {
    const cid = b.client_id as string;
    if (!attendedTsByClient.has(cid)) attendedTsByClient.set(cid, []);
    attendedTsByClient.get(cid)!.push(b.starts_at as string);
    if (b.client_plan_id) {
      const pid = b.client_plan_id as string;
      if (!attendedTsByPlan.has(pid)) attendedTsByPlan.set(pid, []);
      attendedTsByPlan.get(pid)!.push(b.starts_at as string);
    }
  }
  const histTsByClient = new Map<string, string[]>();
  for (const v of (histRes.data || []) as Record<string,unknown>[]) {
    const cid = v.client_id as string;
    if (!histTsByClient.has(cid)) histTsByClient.set(cid, []);
    histTsByClient.get(cid)!.push(v.visit_at as string);
  }

  const plansByClient = new Map<string, Record<string,unknown>[]>();
  const planById      = new Map<string, Record<string,unknown>>();
  for (const p of (plansRes.data || []) as Record<string,unknown>[]) {
    const cid = p.client_id as string;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p);
    planById.set(p.id as string, p);
  }

  const bodyClientByClient = new Map<string, Record<string,unknown>>();
  const bodyClientIds: string[] = [];
  const phoneDigitsList: string[] = [];
  for (const bc of (bodyClientsRes.data || []) as Record<string,unknown>[]) {
    if (!bc.crm_client_id) continue;
    bodyClientByClient.set(bc.crm_client_id as string, bc);
    bodyClientIds.push(bc.id as string);
    if (bc.phone_digits) phoneDigitsList.push(bc.phone_digits as string);
  }

  const bookedTsByItem = new Map<string, string[]>();
  for (const b of (bookedItemsRes.data || []) as Record<string,unknown>[]) {
    const iid = b.client_plan_item_id as string;
    if (!bookedTsByItem.has(iid)) bookedTsByItem.set(iid, []);
    bookedTsByItem.get(iid)!.push(b.starts_at as string);
  }

  const clientPlanIds = [...new Set((plansRes.data || []).map((p: Record<string,unknown>) => p.plan_id as string).filter(Boolean))];

  // Round 2: three parallel queries dependent on Round 1
  const [inbodyRes, bodyMeasRes, crmPlansRes] = await Promise.all([
    phoneDigitsList.length
      ? supabase.from('inbody_tests').select('phone_digits,tested_at,weight')
          .in('phone_digits', phoneDigitsList).order('tested_at', { ascending: false })
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    bodyClientIds.length
      ? supabase.from('body_measurements').select('client_id,measured_at')
          .in('client_id', bodyClientIds).order('measured_at', { ascending: false })
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    clientPlanIds.length
      ? supabase.from('crm_plans').select('id,validity_days').in('id', clientPlanIds)
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
  ]);

  const inbodyByPhone = new Map<string, { tested_at: string; weight: number | null }[]>();
  for (const t of (inbodyRes.data || []) as Record<string,unknown>[]) {
    const ph = t.phone_digits as string;
    if (!inbodyByPhone.has(ph)) inbodyByPhone.set(ph, []);
    inbodyByPhone.get(ph)!.push({ tested_at: t.tested_at as string, weight: t.weight as number | null });
  }
  const bodyMeasByBodyClient = new Map<string, string[]>();
  for (const m of (bodyMeasRes.data || []) as Record<string,unknown>[]) {
    const cid = m.client_id as string;
    if (!bodyMeasByBodyClient.has(cid)) bodyMeasByBodyClient.set(cid, []);
    bodyMeasByBodyClient.get(cid)!.push(m.measured_at as string);
  }
  const validityDaysById = new Map<string, number | null>();
  for (const p of (crmPlansRes.data || []) as Record<string,unknown>[]) {
    validityDaysById.set(p.id as string, (p.validity_days as number | null) ?? null);
  }

  const now = nowUTC5();

  for (const b of bookings) {
    if (['cancelled', 'no_show', 'late_cancel'].includes(b.status)) continue;

    const labels: AutoLabelResult[] = [];
    const clientPlan  = b.client_plan_id ? planById.get(b.client_plan_id) : null;
    const bodyClient  = bodyClientByClient.get(b.client_id);
    const bodyClId    = bodyClient?.id as string | undefined;
    const phoneDig    = bodyClient?.phone_digits as string | undefined;
    const clientPlans = plansByClient.get(b.client_id) || [];

    // Visits before this booking (bookings + history)
    const visitsBefore = (attendedTsByClient.get(b.client_id) || []).filter(ts => ts < b.starts_at).length
      + (histTsByClient.get(b.client_id) || []).filter(ts => ts < b.starts_at).length;

    // new_client
    const dNew = defs.get('new_client');
    if (dNew && visitsBefore < (dNew.params.visits ?? 3)) pushLabel(labels, dNew);

    // last_session
    const dLast = defs.get('last_session');
    let isLast = false;
    if (dLast && b.client_plan_item_id && b.sessions_left !== null) {
      const bookedBefore = (bookedTsByItem.get(b.client_plan_item_id) || []).filter(ts => ts < b.starts_at).length;
      isLast = (b.sessions_left - bookedBefore) === 1;
      if (!isLast && clientPlan) {
        const expiry = (clientPlan.extra_until ?? clientPlan.valid_until) as string | null;
        if (expiry && b.booking_date === expiry) isLast = true;
      }
      if (isLast) pushLabel(labels, dLast);
    }

    // measure_inbody
    const dInbody = defs.get('measure_inbody');
    if (dInbody) {
      let need = false;
      if (b.kind === 'free') need = true;
      if (!need && b.client_plan_id) {
        const planVisitsBefore = (attendedTsByPlan.get(b.client_plan_id) || []).filter(ts => ts < b.starts_at).length;
        if (planVisitsBefore === 0) need = true;
      }
      if (!need && isLast) need = true;
      if (!need && bodyClient && phoneDig) {
        const tests = inbodyByPhone.get(phoneDig) || [];
        need = tests.length === 0 || daysDiff(new Date(tests[0].tested_at), now) >= (dInbody.params.days ?? 7);
      }
      if (need) pushLabel(labels, dInbody);
    }

    // measure_body (plan only)
    const dBody = defs.get('measure_body');
    if (dBody && b.kind !== 'free' && b.client_plan_id) {
      let need = false;
      const planVisitsBefore = (attendedTsByPlan.get(b.client_plan_id) || []).filter(ts => ts < b.starts_at).length;
      if (planVisitsBefore === 0) need = true;
      if (!need && isLast) need = true;
      if (!need && clientPlan && bodyClient && bodyClId) {
        const planId = clientPlan.plan_id as string | null;
        const vd = planId ? (validityDaysById.get(planId) ?? null) : null;
        if (vd !== null && vd >= (dBody.params.min_plan_days ?? 31)) {
          const meas = bodyMeasByBodyClient.get(bodyClId) || [];
          need = meas.length === 0 || daysDiff(new Date(meas[0]), now) >= (dBody.params.days ?? 30);
        }
      }
      if (need) pushLabel(labels, dBody);
    }

    // plan_ending (plan only)
    const dEnding = defs.get('plan_ending');
    if (dEnding && clientPlan) {
      const sessLeft = (clientPlan.sessions_left as number | null) ?? null;
      let ending = sessLeft !== null && sessLeft <= (dEnding.params.sessions ?? 2);
      if (!ending) {
        const expiry = (clientPlan.extra_until ?? clientPlan.valid_until) as string | null;
        if (expiry) ending = daysDiff(now, new Date(expiry + 'T00:00:00+05:00')) <= (dEnding.params.days ?? 7);
      }
      if (ending) pushLabel(labels, dEnding);
    }

    // plan_ended: has plans but none active with sessions_left > 0
    const dEnded = defs.get('plan_ended');
    if (dEnded && clientPlans.length > 0) {
      if (!clientPlans.some(p => ((p.sessions_left as number | null) ?? 0) > 0))
        pushLabel(labels, dEnded);
    }

    // no_visits: has active plan AND last visit > params.days ago
    const dNoVisits = defs.get('no_visits');
    if (dNoVisits && clientPlans.some(p => p.status === 'active')) {
      const allTs = [...(attendedTsByClient.get(b.client_id) || []), ...(histTsByClient.get(b.client_id) || [])];
      const lastTs = allTs.sort().pop();
      const daysAgo = lastTs ? daysDiff(new Date(lastTs), now) : Infinity;
      if (daysAgo > (dNoVisits.params.days ?? 7)) pushLabel(labels, dNoVisits);
    }

    // weight_plateau
    const dPlateau = defs.get('weight_plateau');
    if (dPlateau && phoneDig) {
      const tests = inbodyByPhone.get(phoneDig) || [];
      if (tests.length >= 2 && tests[0].weight !== null && tests[1].weight !== null) {
        if (Math.abs(tests[0].weight - tests[1].weight) < (dPlateau.params.kg ?? 0.3))
          pushLabel(labels, dPlateau);
      }
    }

    // irregular: active plan activated ≥ weeks*7 days ago AND visits in that window < per_week*weeks
    const dIrr = defs.get('irregular');
    if (dIrr) {
      const perWeek = dIrr.params.per_week ?? 2;
      const weeks   = dIrr.params.weeks ?? 2;
      const windowMs = weeks * 7 * 86_400_000;
      const hasOld = clientPlans.some(p =>
        p.status === 'active' && p.activated_at &&
        daysDiff(new Date(p.activated_at as string), now) >= weeks * 7
      );
      if (hasOld) {
        const windowStart = new Date(now.getTime() - windowMs).toISOString();
        const allTs = [...(attendedTsByClient.get(b.client_id) || []), ...(histTsByClient.get(b.client_id) || [])];
        const recentCount = allTs.filter(ts => ts >= windowStart).length;
        if (recentCount < perWeek * weeks) pushLabel(labels, dIrr);
      }
    }

    // payment_needed: booking (this or future) has no plan, is not free
    const dPayNeeded = defs.get('payment_needed');
    if (dPayNeeded && ['booked', 'confirmed'].includes(b.status) && b.client_plan_id === null && b.kind !== 'free' && !b.is_free_booking)
      pushLabel(labels, dPayNeeded);

    labels.sort((a, z) => a.sort - z.sort);
    result.set(b.id, labels);
  }

  return result;
}

// Mode (b): per-client "as of today" for client list (task 93b)
export async function batchAutoLabelsToday(
  clientIds: string[],
  extras?: Map<string, ClientExtraData>
): Promise<Map<string, AutoLabelResult[]>> {
  const result = new Map<string, AutoLabelResult[]>();
  for (const id of clientIds) result.set(id, []);
  if (clientIds.length === 0) return result;

  const defs = await loadDefs();
  if (defs.size === 0) return result;

  const now = nowUTC5();

  const todayIso = now.toISOString().slice(0, 10);
  const [attendedRes, histRes, plansRes, bodyClientsRes, payNeededRes] = await Promise.all([
    supabase.from('crm_bookings')
      .select('client_id,client_plan_id,starts_at')
      .eq('branch_id', BRANCH_ID).eq('status', 'attended').in('client_id', clientIds),
    supabase.from('crm_visit_history')
      .select('client_id,visit_at').eq('status', 'attended').in('client_id', clientIds),
    supabase.from('crm_client_plans')
      .select('id,client_id,plan_id,status,sessions_left,valid_until,extra_until,activated_at')
      .in('client_id', clientIds).in('status', ['active', 'not_activated']),
    supabase.from('body_clients').select('id,crm_client_id,phone_digits')
      .in('crm_client_id', clientIds).not('crm_client_id', 'is', null),
    supabase.from('crm_bookings')
      .select('client_id')
      .eq('branch_id', BRANCH_ID)
      .in('status', ['booked', 'confirmed'])
      .is('client_plan_id', null)
      .neq('kind', 'free')
      .gte('starts_at', todayIso)
      .in('client_id', clientIds),
  ]);

  const visitsByClient = new Map<string, string[]>();
  for (const b of (attendedRes.data || []) as Record<string,unknown>[]) {
    const cid = b.client_id as string;
    if (!visitsByClient.has(cid)) visitsByClient.set(cid, []);
    visitsByClient.get(cid)!.push(b.starts_at as string);
  }
  for (const v of (histRes.data || []) as Record<string,unknown>[]) {
    const cid = v.client_id as string;
    if (!visitsByClient.has(cid)) visitsByClient.set(cid, []);
    visitsByClient.get(cid)!.push(v.visit_at as string);
  }

  const plansByClient = new Map<string, Record<string,unknown>[]>();
  for (const p of (plansRes.data || []) as Record<string,unknown>[]) {
    const cid = p.client_id as string;
    if (!plansByClient.has(cid)) plansByClient.set(cid, []);
    plansByClient.get(cid)!.push(p);
  }

  const bodyClientByClient = new Map<string, Record<string,unknown>>();
  const bodyClientIds: string[] = [];
  const phoneDigitsList: string[] = [];
  for (const bc of (bodyClientsRes.data || []) as Record<string,unknown>[]) {
    if (!bc.crm_client_id) continue;
    bodyClientByClient.set(bc.crm_client_id as string, bc);
    bodyClientIds.push(bc.id as string);
    if (bc.phone_digits) phoneDigitsList.push(bc.phone_digits as string);
  }

  const payNeededSet = new Set<string>(
    ((payNeededRes.data || []) as Record<string,unknown>[]).map(r => r.client_id as string)
  );

  const clientPlanIds = [...new Set((plansRes.data || []).map((p: Record<string,unknown>) => p.plan_id as string).filter(Boolean))];

  const [inbodyRes, bodyMeasRes, crmPlansRes] = await Promise.all([
    phoneDigitsList.length
      ? supabase.from('inbody_tests').select('phone_digits,tested_at,weight')
          .in('phone_digits', phoneDigitsList).order('tested_at', { ascending: false })
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    bodyClientIds.length
      ? supabase.from('body_measurements').select('client_id,measured_at')
          .in('client_id', bodyClientIds).order('measured_at', { ascending: false })
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
    clientPlanIds.length
      ? supabase.from('crm_plans').select('id,validity_days').in('id', clientPlanIds)
      : Promise.resolve({ data: [] as Record<string,unknown>[] }),
  ]);

  const inbodyByPhone = new Map<string, { tested_at: string; weight: number | null }[]>();
  for (const t of (inbodyRes.data || []) as Record<string,unknown>[]) {
    const ph = t.phone_digits as string;
    if (!inbodyByPhone.has(ph)) inbodyByPhone.set(ph, []);
    inbodyByPhone.get(ph)!.push({ tested_at: t.tested_at as string, weight: t.weight as number | null });
  }
  const bodyMeasByBodyClient = new Map<string, string[]>();
  for (const m of (bodyMeasRes.data || []) as Record<string,unknown>[]) {
    const cid = m.client_id as string;
    if (!bodyMeasByBodyClient.has(cid)) bodyMeasByBodyClient.set(cid, []);
    bodyMeasByBodyClient.get(cid)!.push(m.measured_at as string);
  }
  const validityDaysById = new Map<string, number | null>();
  for (const p of (crmPlansRes.data || []) as Record<string,unknown>[]) {
    validityDaysById.set(p.id as string, (p.validity_days as number | null) ?? null);
  }

  for (const clientId of clientIds) {
    const labels: AutoLabelResult[] = [];
    const bodyClient  = bodyClientByClient.get(clientId);
    const bodyClId    = bodyClient?.id as string | undefined;
    const phoneDig    = bodyClient?.phone_digits as string | undefined;
    const clientPlans = plansByClient.get(clientId) || [];
    const visits      = visitsByClient.get(clientId) || [];

    const dNew = defs.get('new_client');
    if (dNew && visits.length < (dNew.params.visits ?? 3)) pushLabel(labels, dNew);

    const dEnding = defs.get('plan_ending');
    if (dEnding && clientPlans.length > 0) {
      for (const plan of clientPlans) {
        const sessLeft = (plan.sessions_left as number | null) ?? null;
        let ending = sessLeft !== null && sessLeft <= (dEnding.params.sessions ?? 2);
        if (!ending) {
          const expiry = (plan.extra_until ?? plan.valid_until) as string | null;
          if (expiry) ending = daysDiff(now, new Date(expiry + 'T00:00:00+05:00')) <= (dEnding.params.days ?? 7);
        }
        if (ending) { pushLabel(labels, dEnding); break; }
      }
    }

    const dEnded = defs.get('plan_ended');
    if (dEnded && clientPlans.length > 0 && !clientPlans.some(p => ((p.sessions_left as number | null) ?? 0) > 0))
      pushLabel(labels, dEnded);

    const dNoVisits = defs.get('no_visits');
    if (dNoVisits && clientPlans.some(p => p.status === 'active')) {
      const lastTs = visits.length > 0 ? [...visits].sort().pop() : null;
      const daysAgo = lastTs ? daysDiff(new Date(lastTs), now) : Infinity;
      if (daysAgo > (dNoVisits.params.days ?? 7)) pushLabel(labels, dNoVisits);
    }

    const dInbody = defs.get('measure_inbody');
    if (dInbody && bodyClient && phoneDig) {
      const tests = inbodyByPhone.get(phoneDig) || [];
      const need = tests.length === 0 || daysDiff(new Date(tests[0].tested_at), now) >= (dInbody.params.days ?? 7);
      if (need) pushLabel(labels, dInbody);
    }

    const dBody = defs.get('measure_body');
    if (dBody && bodyClient && bodyClId && clientPlans.length > 0) {
      const hasLongPlan = clientPlans.some(p => {
        const vd = p.plan_id ? (validityDaysById.get(p.plan_id as string) ?? null) : null;
        return vd !== null && vd >= (dBody.params.min_plan_days ?? 31);
      });
      if (hasLongPlan) {
        const meas = bodyMeasByBodyClient.get(bodyClId) || [];
        const need = meas.length === 0 || daysDiff(new Date(meas[0]), now) >= (dBody.params.days ?? 30);
        if (need) pushLabel(labels, dBody);
      }
    }

    const dPlateau = defs.get('weight_plateau');
    if (dPlateau && phoneDig) {
      const tests = inbodyByPhone.get(phoneDig) || [];
      if (tests.length >= 2 && tests[0].weight !== null && tests[1].weight !== null) {
        if (Math.abs(tests[0].weight - tests[1].weight) < (dPlateau.params.kg ?? 0.3))
          pushLabel(labels, dPlateau);
      }
    }

    const dIrr = defs.get('irregular');
    if (dIrr) {
      const perWeek = dIrr.params.per_week ?? 2;
      const weeks   = dIrr.params.weeks ?? 2;
      const windowMs = weeks * 7 * 86_400_000;
      const hasOld = clientPlans.some(p =>
        p.status === 'active' && p.activated_at &&
        daysDiff(new Date(p.activated_at as string), now) >= weeks * 7
      );
      if (hasOld) {
        const windowStart = new Date(now.getTime() - windowMs).toISOString();
        const recentCount = visits.filter(ts => ts >= windowStart).length;
        if (recentCount < perWeek * weeks) pushLabel(labels, dIrr);
      }
    }

    // incomplete_profile
    const dIncompletePrfl = defs.get('incomplete_profile');
    if (dIncompletePrfl) {
      const extra = extras?.get(clientId);
      if (extra?.profile_complete === false) pushLabel(labels, dIncompletePrfl);
    }

    // birthday — MM-DD match in UTC+5
    const dBirthday = defs.get('birthday');
    if (dBirthday) {
      const extra = extras?.get(clientId);
      const bd = extra?.birth_date;
      if (bd) {
        const todayMD = now.toISOString().slice(5, 10); // MM-DD
        if (bd.slice(5) === todayMD) pushLabel(labels, dBirthday);
      }
    }

    // payment_needed: has future booking without plan
    const dPayNeeded = defs.get('payment_needed');
    if (dPayNeeded && payNeededSet.has(clientId)) pushLabel(labels, dPayNeeded);

    labels.sort((a, z) => a.sort - z.sort);
    result.set(clientId, labels);
  }

  return result;
}
