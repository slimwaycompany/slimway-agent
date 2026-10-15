import { supabase }            from '../db/supabase';
import { paginateGet, rawGet } from '../http/fitbase';
import { shortName }           from '../core/names';
import { getLeadFunnel }       from '../core/funnel';
import { getTitle, pickBody }  from '../core/alertTexts';
import { isInWatchWindow }     from '../core/window';
import { env, WATCH_RULES } from '../config';

export const JOB_NAME = 'new-leads';

const ALMATY_MS         = 5 * 3600 * 1000;
const NEW_LEAD_GRACE_MS = 2 * 3600_000;   // 2-hour activity window for NEW_LEAD
const NEW_LEAD_TASK_MIN = 5 * 60_000;     // 5 min grace before NO_TASK fires

const EXCLUDED_MANAGER_STEPS = new Set(['Ангелина', 'Вера', 'Назерке']);

function isEnabled(rule: string): boolean { return WATCH_RULES.has(rule); }

function parseToMs(val: unknown): number {
  if (!val) return 0;
  const s = String(val);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const n = Number(s);
  return isNaN(n) ? 0 : (n > 1e10 ? n : n * 1000);
}

function buildExcludedStepIds(steps: Record<string, unknown>[]): Set<number> {
  const ids = new Set<number>();
  for (const s of steps) {
    const name = String(s.name || '');
    const id   = Number(s.id);
    if (!id) continue;
    if (EXCLUDED_MANAGER_STEPS.has(name)) ids.add(id);
    if (s.archived || s.is_archived)       ids.add(id);
    if (name.startsWith('Архив:'))          ids.add(id);
  }
  return ids;
}

function isActiveFunnel1Lead(lead: Record<string, unknown>, excludedStepIds: Set<number>): boolean {
  if (/^тест/i.test(String(lead.title || ''))) return false;
  if (getLeadFunnel(lead) !== 1) return false;
  const step   = lead.funnel_step as Record<string, unknown> | undefined;
  const stepId = Number(step?.id ?? 0);
  if (stepId === -1 || stepId === -2) return false;
  if (stepId > 0 && excludedStepIds.has(stepId)) return false;
  return true;
}

function getManager(lead: Record<string, unknown>): string | null {
  const r = lead.responsible as Record<string, unknown> | null | undefined;
  if (!r) return null;
  const n = String(r.name || r.full_name || '').trim();
  return n || null;
}

function getSource(lead: Record<string, unknown>): string {
  const s = lead.source || lead.channel || lead.referral_source;
  return String(s || '');
}

interface AlertRow {
  alert_key:       string;
  rule:            string;
  level:           'urgent' | 'important' | 'info';
  lead_id:         number | null;
  client_id:       number | null;
  registration_id: number | null;
  manager_name:    string | null;
  short_name:      string | null;
  title:           string;
  body:            string;
  action_hint:     string | null;
  link:            string | null;
  meta:            Record<string, unknown> | null;
}

interface DbAlert { id: number; alert_key: string; rule: string; created_at: string; }

async function loadOpenNewLeadAlerts(): Promise<DbAlert[]> {
  const { data, error } = await supabase
    .from('watch_alerts')
    .select('id, alert_key, rule, created_at')
    .in('rule', ['NEW_LEAD', 'NEW_LEAD_NO_TASK'])
    .is('resolved_at', null);
  if (error) console.error('[new-leads] loadAlerts:', error.message);
  return (data ?? []) as DbAlert[];
}

export async function runNewLeads(): Promise<Record<string, unknown>> {
  const nowMs  = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!isInWatchWindow()) return { status: 'skipped', reason: 'outside watch window' };

  const yesterday      = new Date(nowMs - 86400_000 + ALMATY_MS).toISOString().slice(0, 10);
  const todayAlmaty    = new Date(nowMs + ALMATY_MS).toISOString().slice(0, 10);
  const workStartMs    = new Date(todayAlmaty + 'T03:00:00Z').getTime(); // 08:00 Almaty

  // 1. Funnel-1 steps (for manager/archived exclusion)
  const stepItems       = await paginateGet('/purchase-funnel-step', { funnel_id: 1, page_size: 100 });
  const excludedStepIds = buildExcludedStepIds(stepItems);

  // 2. Leads created from yesterday in Almaty time
  const rawLeads = await paginateGet('/lead', { created_at_from: yesterday, page_size: 100 });
  const leads    = rawLeads.filter(l => isActiveFunnel1Lead(l, excludedStepIds));

  // 3. Existing open NEW_LEAD / NEW_LEAD_NO_TASK alerts
  const openAlerts = await loadOpenNewLeadAlerts();
  const openByKey  = new Map(openAlerts.map(a => [a.alert_key, a]));

  const activeKeys = new Set<string>();
  const toUpsert:  AlertRow[] = [];

  for (const lead of leads) {
    const leadId   = Number(lead.id);
    const clientId = Number(lead.client_id ?? 0) || null;
    const created  = parseToMs(lead.created_at);
    if (created <= 0) continue;

    const ageMs   = nowMs - created;
    if (ageMs >= NEW_LEAD_GRACE_MS) continue; // older than 2h: not our responsibility

    const manager = getManager(lead);
    const sname   = shortName(lead);
    const source  = getSource(lead);

    // Per-lead task check (spec: GET /task?lead_id=<id>&status=O)
    let hasOpenTask = false;
    try {
      const resp = await rawGet(`/task?lead_id=${leadId}&status=O`);
      hasOpenTask = ((resp.items || []) as unknown[]).length > 0;
    } catch { /* assume no task on API error */ }

    if (isEnabled('NEW_LEAD') && !hasOpenTask) {
      const key = `NEW_LEAD:lead:${leadId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NEW_LEAD', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: getTitle('NEW_LEAD'),
        body:  pickBody('NEW_LEAD', key, { name: sname, source: source || 'неизвестен' }),
        action_hint: null, link: null,
        meta: { phone: String((lead.phone || lead.mobile || '') as string) || null },
      });
    }

    // NEW_LEAD_NO_TASK: 5 min passed, within 2h, after today's work window start, no open task
    if (isEnabled('NEW_LEAD_NO_TASK') && ageMs > NEW_LEAD_TASK_MIN && created >= workStartMs && !hasOpenTask) {
      const key = `NEW_LEAD_NO_TASK:lead:${leadId}`;
      activeKeys.add(key);
      toUpsert.push({
        alert_key: key, rule: 'NEW_LEAD_NO_TASK', level: 'urgent',
        lead_id: leadId, client_id: clientId, registration_id: null,
        manager_name: manager, short_name: sname,
        title: getTitle('NEW_LEAD_NO_TASK'),
        body:  pickBody('NEW_LEAD_NO_TASK', key, { name: sname, source: source || 'неизвестен' }),
        action_hint: null, link: null,
        meta: { phone: String((lead.phone || lead.mobile || '') as string) || null },
      });
    }
  }

  // Flood guard — same limit as watch
  const maxNew = env.WATCH_MAX_NEW_PER_RULE ?? 20;
  const newCountByRule = new Map<string, number>();
  for (const row of toUpsert) {
    if (!openByKey.has(row.alert_key))
      newCountByRule.set(row.rule, (newCountByRule.get(row.rule) ?? 0) + 1);
  }
  const floodedRules = new Set<string>();
  for (const [rule, count] of newCountByRule) {
    if (count > maxNew) {
      floodedRules.add(rule);
      console.error(`[new-leads] flood guard: rule=${rule} count=${count} max=${maxNew}`);
    }
  }
  const toUpsertFinal = floodedRules.size > 0
    ? toUpsert.filter(row => !floodedRules.has(row.rule) || openByKey.has(row.alert_key))
    : toUpsert;

  // Upsert active alerts
  let upsertCount = 0;
  if (toUpsertFinal.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .upsert(toUpsertFinal, { onConflict: 'alert_key', ignoreDuplicates: true });
    if (error) throw new Error(`[new-leads] upsert: ${error.message}`);
    upsertCount = toUpsertFinal.length;
  }

  // Resolve: open NEW_LEAD / NEW_LEAD_NO_TASK alerts no longer in active conditions
  const toResolve: string[] = [];
  for (const [key] of openByKey) {
    if (!activeKeys.has(key)) toResolve.push(key);
  }
  if (toResolve.length > 0) {
    const { error } = await supabase
      .from('watch_alerts')
      .update({ resolved_at: nowIso })
      .in('alert_key', toResolve)
      .is('resolved_at', null);
    if (error) console.error('[new-leads] resolve error:', error.message);
  }

  const newCount = toUpsertFinal.filter(r => !openByKey.has(r.alert_key)).length;
  console.log(`[new-leads] checked=${leads.length} new=${newCount} upsert=${upsertCount} resolved=${toResolve.length}`);
  return { checked: leads.length, new_alerts: newCount, upserted: upsertCount, resolved: toResolve.length };
}
