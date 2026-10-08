import { supabase }                        from '../db/supabase';
import { rawGet, paginateGet, unwrapItem } from '../http/fitbase';
import { logEvent }                        from '../core/events';
import { shortName }                       from '../core/names';
import { lookupVisitsOverride }            from '../config';

const JOB = 'lifecycle-plan';

const ALMATY_MS    = 5 * 3600 * 1000; // UTC+5, no DST
const MIN_PRICE    = 40000;
const EARLIEST_DATE = '2026-06-01';
const SKIP_STEP_IDS = new Set([-1, -2]);

// ── Funnel step name constants ────────────────────────────────────────────────

const STEP_SUCCESS = 'Успех';

const STEPS_NEWCOMERS = [
  'Неразобранные', 'Купил первый абонемент', 'Выполнен сервис 1', 'Ожидание продления', 'Отстойник',
] as const;

const STEPS_REGULAR = [
  'Неразобранные', 'Только купил абонемент', 'Выполнен сервис 2', 'Ожидание продления', 'Отстойник',
] as const;

const STEPS_REACTIVATION = [
  'Неразобранные', 'До 30 дней', 'От 31д до 90д', 'От 91д до 180д', 'От 181д до года', 'Вечность',
] as const;

// ── Date helpers ──────────────────────────────────────────────────────────────

function toAlmatyDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + ALMATY_MS).toISOString().slice(0, 10);
}

function todayAlmaty(): string {
  return new Date(Date.now() + ALMATY_MS).toISOString().slice(0, 10);
}

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

// ── Lead field helpers ────────────────────────────────────────────────────────

function getFunnelId(lead: Record<string, unknown>): number | null {
  const step = lead.funnel_step as Record<string, unknown> | undefined;
  const pf   = step?.purchase_funnel as Record<string, unknown> | null | undefined;
  const id   = Number(pf?.id ?? 0);
  return id > 0 ? id : null;
}

function getStepId(lead: Record<string, unknown>): number {
  const step = lead.funnel_step as Record<string, unknown> | undefined;
  return Number(step?.id ?? 0);
}

function getManager(lead: Record<string, unknown>): string | null {
  const r = lead.responsible as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const n = String(r.name || r.full_name || '').trim();
  return n || null;
}

// ── Funnel step loader ────────────────────────────────────────────────────────

async function loadSteps(funnelId: number): Promise<Record<string, number>> {
  const items  = await paginateGet('/purchase-funnel-step', { funnel_id: funnelId, page_size: 100 });
  const result: Record<string, number> = {};
  for (const item of items) {
    const name = String(item.name || '');
    const id   = Number(item.id);
    if (name && id) result[name] = id;
  }
  return result;
}

function requireSteps(funnelId: number, steps: Record<string, number>, names: readonly string[]): void {
  const missing = names.filter(n => !(n in steps));
  if (missing.length) {
    throw new Error(
      `[${JOB}] Funnel ${funnelId}: steps not found: ${missing.join(', ')}. Found: ${Object.keys(steps).join(', ')}`,
    );
  }
}

// ── Reactivation target ───────────────────────────────────────────────────────

function reactTarget(
  days:    number | null,
  steps4:  Record<string, number>,
): { target_funnel: 4; target_stage: number } {
  let name: string;
  if (days === null || days > 365) name = 'Вечность';
  else if (days > 180)             name = 'От 181д до года';
  else if (days > 90)              name = 'От 91д до 180д';
  else if (days > 30)              name = 'От 31д до 90д';
  else                             name = 'До 30 дней';
  const id = steps4[name];
  if (!id) throw new Error(`[${JOB}] Reactivation step not found: "${name}"`);
  return { target_funnel: 4, target_stage: id };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContractEntry {
  contract:    Record<string, unknown>;
  visitsTotal: number;
  visitsLeft:  number;
}

// ── PlanRow ───────────────────────────────────────────────────────────────────

interface PlanRow {
  run_id:                number;
  lead_id:               number;
  client_id:             number | null;
  short_name:            string | null;
  manager:               string | null;
  current_funnel:        number | null;
  current_stage:         number | null;
  target_funnel:         number | null;
  target_stage:          number | null;
  action:                'stay' | 'move' | 'skip' | 'review';
  reason:                string | null;
  purchase_days:         number | null;
  active_count:          number | null;
  visits_total:          number | null;
  visits_left:           number | null;
  left_pct:              number | null;
  last_visit_at:         string | null;
  days_since_last_visit: number | null;
  task_planned:          string | null;
  flags:                 string | null;
}

// ── Core: classify one lead ───────────────────────────────────────────────────

async function processLead(
  lead:          Record<string, unknown>,
  runId:         number,
  funnelSteps:   Record<number, Record<string, number>>,
  clientCache:   Map<number, Record<string, unknown>>,
  contractCache: Map<number, Record<string, unknown>[]>,
  visitCache:    Map<number, Record<string, unknown>[]>,
): Promise<PlanRow> {
  const leadId        = Number(lead.id);
  const clientId      = Number(lead.client_id ?? 0) || null;
  const currentFunnel = getFunnelId(lead);
  const currentStage  = getStepId(lead) || null;
  const manager       = getManager(lead);

  let client: Record<string, unknown> | null = null;
  if (clientId) {
    if (!clientCache.has(clientId)) {
      try {
        client = unwrapItem(await rawGet(`/client/${clientId}`));
        clientCache.set(clientId, client);
      } catch { clientCache.set(clientId, {}); }
    } else {
      client = clientCache.get(clientId)!;
    }
    if (client && Object.keys(client).length === 0) client = null;
  }

  const name = shortName(lead, client ?? undefined);

  const base: PlanRow = {
    run_id: runId, lead_id: leadId, client_id: clientId,
    short_name: name || null, manager,
    current_funnel: currentFunnel, current_stage: currentStage,
    target_funnel: null, target_stage: null,
    action: 'skip', reason: null,
    purchase_days: null, active_count: null,
    visits_total: null, visits_left: null, left_pct: null,
    last_visit_at: null, days_since_last_visit: null,
    task_planned: null, flags: null,
  };

  if (!clientId)              return { ...base, action: 'skip', reason: 'NO_CLIENT' };
  if (!client)                return { ...base, action: 'skip', reason: 'CLIENT_FETCH_ERROR' };
  if (Number(client.status ?? 0) === 4) return { ...base, action: 'skip', reason: 'FROZEN' };

  // ── Contracts ──────────────────────────────────────────────────────────────
  if (!contractCache.has(clientId)) {
    try {
      const resp = await rawGet(`/client-contract?client_id=${clientId}`);
      contractCache.set(clientId, (resp.items || []) as Record<string, unknown>[]);
    } catch { contractCache.set(clientId, []); }
  }
  const allContracts = contractCache.get(clientId)!;

  const purchases = allContracts.filter(c =>
    Number(c.price_full ?? 0) >= MIN_PRICE && !String(c.deleted_at ?? '').trim(),
  );

  // Load schedule registrations here — needed for override visit counting + last_visit_at
  if (!visitCache.has(clientId)) {
    try {
      const resp = await rawGet(`/schedule-registration?client_id=${clientId}`);
      visitCache.set(clientId, (resp.items || []) as Record<string, unknown>[]);
    } catch { visitCache.set(clientId, []); }
  }
  const regs = visitCache.get(clientId)!;

  // Categorize: countable (visits>0), VISITS_OVERRIDES (visits=null + known name), unlimited (visits=null)
  const countable: ContractEntry[] = [];
  let hasUnlimited      = false;
  let hasVisitsComputed = false;

  for (const c of purchases) {
    const ticket    = c.ticket as Record<string, unknown> | null;
    const rawVisits = ticket?.visits;
    const itemName  = String((ticket?.contract_item as Record<string, unknown> | null)?.name ?? '');

    if (rawVisits !== null && rawVisits !== undefined && Number(rawVisits) > 0) {
      countable.push({ contract: c, visitsTotal: Number(rawVisits), visitsLeft: Number(c.visits_left ?? 0) });
    } else if (rawVisits === null) {
      const override = lookupVisitsOverride(itemName);
      if (override !== null) {
        // visits_used = schedule registrations with status=3 linked to this specific contract
        const contractId = Number(c.id);
        const used = regs.filter(r => {
          if (String(r.status) !== '3') return false;
          const cref = r.contract as Record<string, unknown> | null | undefined;
          return Number(cref?.id ?? r.contract_id ?? -1) === contractId;
        }).length;
        countable.push({ contract: c, visitsTotal: override, visitsLeft: Math.max(0, override - used) });
        hasVisitsComputed = true;
      } else {
        hasUnlimited = true;
      }
    }
    // visits === 0 or undefined: edge case, skip for metrics
  }

  // All purchases exist but none are countable → show for review (not silent skip)
  if (purchases.length > 0 && countable.length === 0) {
    return {
      ...base,
      flags: hasUnlimited ? 'UNLIMITED' : null,
      action: 'review', reason: 'UNLIMITED_ONLY',
      target_funnel: currentFunnel, target_stage: currentStage,
    };
  }

  // purchase_days: unique Almaty dates by created_at (countable contracts only)
  const daySet = new Set<string>();
  for (const { contract: c } of countable) {
    const d = toAlmatyDate(String(c.created_at || ''));
    if (d) daySet.add(d);
  }
  const purchaseDays = daySet.size;

  // Active: closed falsy AND visits_left > 0
  const active = countable.filter(e => !e.contract.closed && e.visitsLeft > 0);

  let visitsTotal: number | null = null;
  let visitsLeft:  number | null = null;
  let leftPct:     number | null = null;
  if (active.length > 0) {
    let tot = 0, lft = 0;
    for (const e of active) { tot += e.visitsTotal; lft += e.visitsLeft; }
    visitsTotal = tot;
    visitsLeft  = lft;
    leftPct     = tot > 0 ? Math.round((lft / tot) * 100) : null;
  }

  // ── Last visit (status=3) — regs already loaded ────────────────────────────
  const visited = regs.filter(r => String(r.status) === '3');

  let lastVisitAt: string | null = null;
  if (visited.length > 0) {
    visited.sort((a, b) => {
      const da = String((a.event as Record<string, unknown>)?.date || '');
      const db = String((b.event as Record<string, unknown>)?.date || '');
      return db.localeCompare(da);
    });
    lastVisitAt = String((visited[0].event as Record<string, unknown>)?.date || '') || null;
  }
  const daysSinceVisit = daysSince(lastVisitAt);

  // ── Flags ──────────────────────────────────────────────────────────────────
  const flags: string[] = [];
  const today = todayAlmaty();
  const isStrange = (d: string | null) => !!d && (d > today || d < EARLIEST_DATE);
  if (isStrange(lastVisitAt)) flags.push('STRANGE_DATES');
  for (const { contract: c } of countable) {
    const d = toAlmatyDate(String(c.created_at || ''));
    if (isStrange(d)) { flags.push('STRANGE_DATES'); break; }
  }
  if (hasUnlimited)      flags.push('UNLIMITED');
  if (hasVisitsComputed) flags.push('VISITS_COMPUTED');
  const flagStr = () => flags.length > 0 ? [...new Set(flags)].join(',') : null;

  const partial: PlanRow = {
    ...base,
    purchase_days: purchaseDays, active_count: active.length,
    visits_total: visitsTotal, visits_left: visitsLeft, left_pct: leftPct,
    last_visit_at: lastVisitAt, days_since_last_visit: daysSinceVisit,
  };

  // ── Classification rules ───────────────────────────────────────────────────

  if (purchaseDays === 0) {
    if (currentFunnel === 2 || currentFunnel === 3) {
      return {
        ...partial, flags: flagStr(),
        action: 'review', reason: 'NO_PURCHASE_IN_LIFECYCLE',
        target_funnel: currentFunnel, target_stage: currentStage,
      };
    }
    // Funnel 1 or 4: reactivation by last visit or lead creation date
    const since = daysSinceVisit ?? daysSince(String(lead.created_at || ''));
    const rt     = reactTarget(since, funnelSteps[4]);
    const action = (currentFunnel === rt.target_funnel && currentStage === rt.target_stage) ? 'stay' : 'move';
    return { ...partial, flags: flagStr(), ...rt, action };
  }

  if (active.length > 0) {
    const tf  = purchaseDays === 1 ? 2 : 3;
    const ts  = funnelSteps[tf];
    const vl  = visitsLeft ?? 0;
    const lp  = leftPct    ?? 100;

    let stepName: string;
    let taskPlanned: string | null = null;

    if (vl <= 2) {
      stepName    = 'Ожидание продления';
      taskPlanned = `Абонемент заканчивается (осталось ${vl}) — менеджеру карточки`;
    } else if (lp < 50) {
      stepName = tf === 2 ? 'Выполнен сервис 1' : 'Выполнен сервис 2';
    } else {
      stepName = tf === 2 ? 'Купил первый абонемент' : 'Только купил абонемент';
    }

    const sid = ts[stepName];
    if (!sid) throw new Error(`[${JOB}] Step not found: "${stepName}" in funnel ${tf}`);
    const action = (currentFunnel === tf && currentStage === sid) ? 'stay' : 'move';
    return { ...partial, flags: flagStr(), action, target_funnel: tf, target_stage: sid, task_planned: taskPlanned };
  }

  // No active contracts, but had purchases
  const since  = daysSinceVisit ?? daysSince(String(lead.created_at || ''));
  const sinceN = since ?? Infinity;

  if (sinceN <= 10) {
    const tf  = purchaseDays >= 2 ? 3 : 2;
    const sid = funnelSteps[tf]['Отстойник'];
    if (!sid) throw new Error(`[${JOB}] Step "Отстойник" not found in funnel ${tf}`);
    const action = (currentFunnel === tf && currentStage === sid) ? 'stay' : 'move';
    return {
      ...partial, flags: flagStr(),
      action, target_funnel: tf, target_stage: sid,
      task_planned: 'Абонемент закончился — всем троим',
    };
  }

  const rt     = reactTarget(since, funnelSteps[4]);
  const action = (currentFunnel === rt.target_funnel && currentStage === rt.target_stage) ? 'stay' : 'move';
  return { ...partial, flags: flagStr(), ...rt, action };
}

// ── Public entry: accepts runId from index.ts executeJob chain ────────────────

export async function runLifecyclePlan(runId: number): Promise<Record<string, unknown>> {
  console.log(`[${JOB}] runId=${runId} — loading funnel steps...`);

  // 1. Load and validate all funnel steps
  const [steps1, steps2, steps3, steps4] = await Promise.all([
    loadSteps(1), loadSteps(2), loadSteps(3), loadSteps(4),
  ]);
  requireSteps(1, steps1, [STEP_SUCCESS]);
  requireSteps(2, steps2, STEPS_NEWCOMERS);
  requireSteps(3, steps3, STEPS_REGULAR);
  requireSteps(4, steps4, STEPS_REACTIVATION);

  const funnelSteps: Record<number, Record<string, number>> = { 1: steps1, 2: steps2, 3: steps3, 4: steps4 };
  const successStepId = steps1[STEP_SUCCESS];
  console.log(`[${JOB}] steps loaded. successStepId=${successStepId}`);

  // 2. Fetch all leads, keep only target ones
  const allLeads = await paginateGet('/lead', { page_size: 100 }, JOB);
  const leads    = allLeads.filter(l => {
    const fi = getFunnelId(l);
    const si = getStepId(l);
    if (!fi || SKIP_STEP_IDS.has(si)) return false;
    if (fi === 1) return si === successStepId;
    return fi === 2 || fi === 3 || fi === 4;
  });
  console.log(`[${JOB}] ${leads.length} leads to process (total fetched: ${allLeads.length})`);

  // 3. Process leads with per-run caches
  const clientCache   = new Map<number, Record<string, unknown>>();
  const contractCache = new Map<number, Record<string, unknown>[]>();
  const visitCache    = new Map<number, Record<string, unknown>[]>();
  const rows: PlanRow[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      const row = await processLead(lead, runId, funnelSteps, clientCache, contractCache, visitCache);
      rows.push(row);
    } catch (e) {
      const msg = String(e).substring(0, 150);
      console.error(`[${JOB}] lead=${lead.id}: ${msg}`);
      rows.push({
        run_id: runId, lead_id: Number(lead.id),
        client_id: Number(lead.client_id ?? 0) || null,
        short_name: String(lead.name || lead.id || ''), manager: null,
        current_funnel: getFunnelId(lead), current_stage: getStepId(lead) || null,
        target_funnel: null, target_stage: null,
        action: 'skip', reason: `ERROR: ${msg}`,
        purchase_days: null, active_count: null,
        visits_total: null, visits_left: null, left_pct: null,
        last_visit_at: null, days_since_last_visit: null,
        task_planned: null, flags: null,
      });
    }
    if ((i + 1) % 20 === 0 || i + 1 === leads.length) {
      console.log(`[${JOB}] progress: ${i + 1}/${leads.length}`);
    }
  }

  // 4. DUPLICATE_CLIENT: flag client_ids appearing in multiple cards across funnels 2,3,4
  const clientFunnelCount = new Map<number, number>();
  for (const row of rows) {
    const cf = row.current_funnel;
    if (row.client_id && (cf === 2 || cf === 3 || cf === 4)) {
      clientFunnelCount.set(row.client_id, (clientFunnelCount.get(row.client_id) ?? 0) + 1);
    }
  }
  for (const row of rows) {
    if (row.client_id && (clientFunnelCount.get(row.client_id) ?? 0) > 1) {
      const existing = row.flags ? row.flags.split(',') : [];
      if (!existing.includes('DUPLICATE_CLIENT')) existing.push('DUPLICATE_CLIENT');
      row.flags  = existing.join(',');
      row.action = 'review';
    }
  }

  // 5. Batch insert into lifecycle_plan
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('lifecycle_plan').insert(batch);
    if (error) throw new Error(`[${JOB}] insert batch ${i}: ${error.message}`);
  }

  // 6. Stats
  const byAction: Record<string, number> = { stay: 0, move: 0, skip: 0, review: 0 };
  const byStage:  Record<string, number> = {};
  for (const row of rows) {
    byAction[row.action] = (byAction[row.action] ?? 0) + 1;
    if (row.target_stage != null) {
      const k = `f${row.target_funnel}:s${row.target_stage}`;
      byStage[k] = (byStage[k] ?? 0) + 1;
    }
  }
  const stats = { total: rows.length, by_action: byAction, by_target_stage: byStage };

  // 7. Summary event
  await logEvent({
    job: JOB, type: 'run_finished', dry: false,
    text: `План разбора готов: ${rows.length} карточек, переедут ${byAction.move}, на проверку ${byAction.review}`,
    meta: stats,
  });

  return stats;
}
