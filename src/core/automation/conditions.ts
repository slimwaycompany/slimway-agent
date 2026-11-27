import { supabase } from '../../db/supabase';

export interface ConditionParamDef { key: string; label: string; unit?: string }
export interface ConditionDef { type: string; label: string; paramDefs: ConditionParamDef[]; needsClient: boolean }

export const CONDITION_CATALOG: ConditionDef[] = [
  { type: 'has_active_plan',           label: 'Есть купленный абонемент',                    paramDefs: [],                                                                                   needsClient: true  },
  { type: 'plan_days_left_lte',        label: 'До конца абонемента ≤ … дней',                paramDefs: [{ key: 'days', label: 'Дней', unit: 'дн.' }],                                       needsClient: true  },
  { type: 'plan_sessions_left_lte',    label: 'Осталось занятий ≤ …',                        paramDefs: [{ key: 'sessions', label: 'Занятий' }],                                              needsClient: true  },
  { type: 'plan_ended_days',           label: 'Абонемент закончился от … до … дней назад',   paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }], needsClient: true  },
  { type: 'trial_attended_no_purchase', label: 'Пришла на пробное и не купила',               paramDefs: [],                                                                                   needsClient: true  },
  { type: 'days_on_stage_gte',         label: 'На этапе ≥ … дней',                           paramDefs: [{ key: 'days', label: 'Дней', unit: 'дн.' }],                                       needsClient: false },
  { type: 'no_future_task',            label: 'Нет задачи с датой в будущем',                 paramDefs: [],                                                                                   needsClient: false },
  { type: 'days_since_last_visit',     label: 'Последний визит от … до … дней назад',        paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }], needsClient: true  },
  { type: 'days_since_created',        label: 'Заявка создана от … до … дней назад',         paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }], needsClient: false },
];

export const CONDITION_TYPES = new Set(CONDITION_CATALOG.map(c => c.type));

export interface AutomationSettingsData {
  min_plan_price: number;
  manual_hold_hours: number;
}

export interface ClientPlanRow {
  id: string;
  plan_id: string;
  status: string;
  valid_until: string | null;
  extra_until: string | null;
  sessions_left: number | null;
  price: number | null;
  purchased_at: string | null;
  plan_kind: string;
  plan_is_free: boolean;
  plan_is_system: boolean;
  plan_price: number;
  plan_name: string;
  items: { sessions_left: number | null; is_unlimited: boolean }[];
}

export interface ClientDataBundle {
  // by client_id
  plans: Map<string, ClientPlanRow[]>;
  // by client_id: last attended booking_date (epoch ms)
  lastVisitMs: Map<string, number>;
  // by client_id: has attended trial booking + no subsequent purchase
  trialAttendedNoPurchase: Map<string, boolean>;
  // by client_id: last purchase date ms (for trial check)
  lastPurchaseMs: Map<string, number>;
}

export interface LeadTaskRow { lead_id: string; due_at: string | null; status: string }

function nowMs(): number { return Date.now(); }
function daysToMs(d: number): number { return d * 86400_000; }
function msAgo(ms: number): number { return nowMs() - ms; }

export async function loadAutomationSettings(branchId: string): Promise<AutomationSettingsData> {
  const { data } = await supabase.from('crm_settings')
    .select('key,value').eq('branch_id', branchId)
    .in('key', ['automation.min_plan_price', 'automation.manual_hold_hours']);
  const map = new Map((data ?? []).map(r => [r.key as string, r.value as string]));
  return {
    min_plan_price:     Number(map.get('automation.min_plan_price')    ?? 40000),
    manual_hold_hours:  Number(map.get('automation.manual_hold_hours') ?? 24),
  };
}

export async function loadClientData(clientIds: string[], branchId: string): Promise<ClientDataBundle> {
  if (!clientIds.length) {
    return { plans: new Map(), lastVisitMs: new Map(), trialAttendedNoPurchase: new Map(), lastPurchaseMs: new Map() };
  }

  // Load trial plan IDs (system free-booking services named "пробн*")
  const { data: trialPlansData } = await supabase.from('crm_plans').select('id')
    .eq('branch_id', branchId).eq('kind', 'service').eq('is_system', true).eq('is_free_booking', true)
    .ilike('name', '%пробн%');
  const trialPlanIds = new Set((trialPlansData ?? []).map(p => p.id as string));

  // Batch: client plans with plan details and items
  const { data: cpRaw } = await supabase.from('crm_client_plans')
    .select('id,client_id,plan_id,status,valid_until,extra_until,sessions_left,price,purchased_at,crm_plans!plan_id(id,kind,is_free_booking,is_system,price,name),crm_client_plan_items(sessions_left,is_unlimited)')
    .in('client_id', clientIds).not('status', 'in', '(cancelled)').order('purchased_at', { ascending: false });

  const plans = new Map<string, ClientPlanRow[]>();
  for (const cp of (cpRaw ?? []) as Record<string, unknown>[]) {
    const cid = cp.client_id as string;
    const p = (cp as Record<string, unknown>)['crm_plans!plan_id'] as Record<string, unknown> | null ?? null;
    const items = ((cp.crm_client_plan_items ?? []) as Record<string, unknown>[]).map(it => ({
      sessions_left: it.sessions_left != null ? Number(it.sessions_left) : null,
      is_unlimited: Boolean(it.is_unlimited),
    }));
    const row: ClientPlanRow = {
      id: cp.id as string,
      plan_id: cp.plan_id as string,
      status: cp.status as string,
      valid_until: (cp.valid_until as string | null) ?? null,
      extra_until: (cp.extra_until as string | null) ?? null,
      sessions_left: cp.sessions_left != null ? Number(cp.sessions_left) : null,
      price: cp.price != null ? Number(cp.price) : null,
      purchased_at: (cp.purchased_at as string | null) ?? null,
      plan_kind: (p?.kind as string) ?? '',
      plan_is_free: Boolean(p?.is_free_booking),
      plan_is_system: Boolean(p?.is_system),
      plan_price: p?.price != null ? Number(p.price) : 0,
      plan_name: (p?.name as string) ?? '',
      items,
    };
    if (!plans.has(cid)) plans.set(cid, []);
    plans.get(cid)!.push(row);
  }

  // Build a map: client_plan_id → { client_id, plan_id }
  const cpIdToClient = new Map<string, { cid: string; planId: string }>();
  for (const cp of (cpRaw ?? []) as Record<string, unknown>[]) {
    cpIdToClient.set(cp.id as string, { cid: cp.client_id as string, planId: cp.plan_id as string });
  }

  // Batch: attended bookings
  const { data: bkRaw } = await supabase.from('crm_bookings')
    .select('client_id,booking_date,status,kind,client_plan_id')
    .in('client_id', clientIds).in('status', ['attended']);

  // Batch: attended visits
  const { data: visitRaw } = await supabase.from('crm_visit_history')
    .select('client_id,visit_at,status')
    .in('client_id', clientIds).eq('status', 'attended');

  // Compute lastVisitMs and trialAttendedNoPurchase per client
  const lastVisitMs = new Map<string, number>();
  const trialAttendedMs = new Map<string, number>(); // most recent trial booking ms per client
  const lastPurchaseMs = new Map<string, number>();

  for (const bk of (bkRaw ?? []) as Record<string, unknown>[]) {
    const cid = bk.client_id as string;
    const ms = new Date(bk.booking_date as string).getTime();
    if (!isNaN(ms)) {
      if (!lastVisitMs.has(cid) || ms > lastVisitMs.get(cid)!) lastVisitMs.set(cid, ms);
    }
    // Check trial: free attended booking for a trial plan
    if (bk.kind === 'free' && bk.client_plan_id) {
      const info = cpIdToClient.get(bk.client_plan_id as string);
      if (info && trialPlanIds.has(info.planId)) {
        if (!trialAttendedMs.has(cid) || ms > trialAttendedMs.get(cid)!) trialAttendedMs.set(cid, ms);
      }
    }
  }

  for (const v of (visitRaw ?? []) as Record<string, unknown>[]) {
    const cid = v.client_id as string;
    const ms = new Date(v.visit_at as string).getTime();
    if (!isNaN(ms)) {
      if (!lastVisitMs.has(cid) || ms > lastVisitMs.get(cid)!) lastVisitMs.set(cid, ms);
    }
  }

  // Compute lastPurchaseMs from client_plans (purchased abonements)
  for (const [cid, cps] of plans) {
    for (const cp of cps) {
      if (cp.plan_kind === 'abonement' && !cp.plan_is_free && !cp.plan_is_system) {
        const ms = cp.purchased_at ? new Date(cp.purchased_at).getTime() : NaN;
        if (!isNaN(ms) && (!lastPurchaseMs.has(cid) || ms > lastPurchaseMs.get(cid)!)) {
          lastPurchaseMs.set(cid, ms);
        }
      }
    }
  }

  // trial_attended_no_purchase: has trial attended AND (no purchase OR purchase is before trial)
  const trialAttendedNoPurchase = new Map<string, boolean>();
  for (const [cid, trialMs] of trialAttendedMs) {
    const purchaseMs = lastPurchaseMs.get(cid) ?? 0;
    trialAttendedNoPurchase.set(cid, purchaseMs <= trialMs);
  }

  return { plans, lastVisitMs, trialAttendedNoPurchase, lastPurchaseMs };
}

export async function loadLeadTasks(leadIds: string[], branchId: string): Promise<Map<string, LeadTaskRow[]>> {
  if (!leadIds.length) return new Map();
  const { data } = await supabase.from('crm_lead_tasks')
    .select('lead_id,due_at,status').in('lead_id', leadIds).eq('branch_id', branchId);
  const m = new Map<string, LeadTaskRow[]>();
  for (const t of (data ?? []) as Record<string, unknown>[]) {
    const lid = t.lead_id as string;
    if (!m.has(lid)) m.set(lid, []);
    m.get(lid)!.push({ lead_id: lid, due_at: t.due_at as string | null, status: t.status as string });
  }
  return m;
}

interface CondInput { type: string; params: Record<string, unknown> }

function activePlans(cps: ClientPlanRow[]): ClientPlanRow[] {
  return cps.filter(cp => cp.status === 'active' || cp.status === 'not_activated' || cp.status === 'frozen');
}

function isPaidAbonement(cp: ClientPlanRow, minPrice: number): boolean {
  return cp.plan_kind === 'abonement' && !cp.plan_is_free && !cp.plan_is_system && cp.plan_price >= minPrice;
}

export function evalCondition(
  cond: CondInput,
  lead: { stage_changed_at: string | null; created_at: string; client_id: string | null },
  clientId: string | null,
  bundle: ClientDataBundle,
  settings: AutomationSettingsData,
  tasks: LeadTaskRow[],
): boolean {
  const p = cond.params ?? {};
  const now = nowMs();

  switch (cond.type) {
    case 'has_active_plan': {
      if (!clientId) return false;
      const cps = bundle.plans.get(clientId) ?? [];
      return activePlans(cps).some(cp => isPaidAbonement(cp, settings.min_plan_price));
    }

    case 'plan_days_left_lte': {
      if (!clientId) return false;
      const days = Number(p.days ?? 0);
      const cps = bundle.plans.get(clientId) ?? [];
      const active = activePlans(cps).filter(cp => isPaidAbonement(cp, settings.min_plan_price));
      if (!active.length) return false;
      // Latest end date among active plans
      let latestEndMs = -Infinity;
      for (const cp of active) {
        const endStr = cp.extra_until ?? cp.valid_until;
        if (!endStr) continue;
        const ms = new Date(endStr).getTime();
        if (ms > latestEndMs) latestEndMs = ms;
      }
      if (latestEndMs === -Infinity) return false;
      return (latestEndMs - now) <= daysToMs(days);
    }

    case 'plan_sessions_left_lte': {
      if (!clientId) return false;
      const maxSess = Number(p.sessions ?? 0);
      const cps = bundle.plans.get(clientId) ?? [];
      const active = activePlans(cps).filter(cp => isPaidAbonement(cp, settings.min_plan_price));
      if (!active.length) return false;
      let total = 0;
      let hasNonUnlimited = false;
      for (const cp of active) {
        for (const item of cp.items) {
          if (!item.is_unlimited) { hasNonUnlimited = true; total += item.sessions_left ?? 0; }
        }
      }
      if (!hasNonUnlimited) return false; // all unlimited
      return total <= maxSess;
    }

    case 'plan_ended_days': {
      if (!clientId) return false;
      const from = Number(p.from ?? 0);
      const to = p.to != null && p.to !== '' ? Number(p.to) : null;
      const cps = bundle.plans.get(clientId) ?? [];
      // No active plans
      if (activePlans(cps).some(cp => isPaidAbonement(cp, settings.min_plan_price))) return false;
      // Find last ended paid abonement
      let lastEndMs = -Infinity;
      for (const cp of cps) {
        if (!isPaidAbonement(cp, settings.min_plan_price)) continue;
        if (cp.status !== 'expired' && cp.status !== 'cancelled') continue;
        const endStr = cp.extra_until ?? cp.valid_until;
        if (!endStr) continue;
        const ms = new Date(endStr).getTime();
        if (ms > lastEndMs) lastEndMs = ms;
      }
      if (lastEndMs === -Infinity) return false;
      const daysAgo = msAgo(lastEndMs) / daysToMs(1);
      return daysAgo >= from && (to === null || daysAgo <= to);
    }

    case 'trial_attended_no_purchase': {
      if (!clientId) return false;
      return bundle.trialAttendedNoPurchase.get(clientId) === true;
    }

    case 'days_on_stage_gte': {
      const days = Number(p.days ?? 0);
      const changedAt = lead.stage_changed_at;
      if (!changedAt) return false;
      return msAgo(new Date(changedAt).getTime()) >= daysToMs(days);
    }

    case 'no_future_task': {
      return !tasks.some(t => t.status === 'open' && t.due_at && new Date(t.due_at).getTime() > now);
    }

    case 'days_since_last_visit': {
      if (!clientId) return false;
      const from = Number(p.from ?? 0);
      const to = p.to != null && p.to !== '' ? Number(p.to) : null;
      const lastMs = bundle.lastVisitMs.get(clientId);
      if (!lastMs) return false;
      const daysAgo = msAgo(lastMs) / daysToMs(1);
      return daysAgo >= from && (to === null || daysAgo <= to);
    }

    case 'days_since_created': {
      const from = Number(p.from ?? 0);
      const to = p.to != null && p.to !== '' ? Number(p.to) : null;
      const ms = new Date(lead.created_at).getTime();
      if (isNaN(ms)) return false;
      const daysAgo = msAgo(ms) / daysToMs(1);
      return daysAgo >= from && (to === null || daysAgo <= to);
    }

    default: return false;
  }
}
