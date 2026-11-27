import { supabase } from '../../db/supabase';
import {
  evalCondition, loadAutomationSettings, loadClientData, loadLeadTasks,
  type ClientDataBundle, type AutomationSettingsData, type LeadTaskRow,
} from './conditions';
import { emitLive } from '../liveBus';
import { runLeadRules } from '../leadRules';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const LOG_DAYS   = 30;

const ABONEMENT_TYPES = new Set(['has_active_plan','plan_days_left_lte','plan_sessions_left_lte','plan_ended_days']);

export interface RunAutomationOpts {
  ruleId?: string;
  clientIds?: string[];
  dry?: boolean; // skip all DB writes (preview mode)
}

export interface RunAutomationResult {
  stats: Record<string, { matched: number; moved: number; created: number; skipped: number }>;
  previewLeads?: { lead_id: string; title: string | null; from: string; to: string }[];
}

interface AutoRule {
  id: string; name: string;
  target_funnel_id: string; target_stage_id: string;
  source_scope: { funnel_ids?: string[]; stage_ids?: string[] };
  match: 'all' | 'any';
  conditions: { type: string; params: Record<string, unknown> }[];
  actions: {
    create_lead_if_missing?: boolean;
    task?: { type_id: string | null; text: string; due_in_hours: number; responsible: string } | null;
  };
  mode: 'test' | 'live';
  priority: number;
}

interface LeadRow {
  id: string; client_id: string | null; funnel_id: string; stage_id: string;
  stage_changed_at: string | null; created_at: string; fb_created_at: string | null;
  title: string | null; name: string | null; phone: string | null;
  manager_user_id: string | null;
}

function evalSet(
  rule: AutoRule, lead: { stage_changed_at: string | null; created_at: string; fb_created_at?: string | null; client_id: string | null },
  clientId: string | null, bundle: ClientDataBundle, settings: AutomationSettingsData, tasks: LeadTaskRow[],
): boolean {
  const fn = (c: { type: string; params: Record<string, unknown> }) =>
    evalCondition(c, lead, clientId, bundle, settings, tasks);
  return rule.match === 'any' ? rule.conditions.some(fn) : rule.conditions.every(fn);
}

export async function runAutomation(opts: RunAutomationOpts = {}): Promise<RunAutomationResult> {
  const { ruleId, clientIds, dry = false } = opts;

  // Load enabled rules
  let rulesQ = supabase.from('crm_automation_rules')
    .select('id,name,target_funnel_id,target_stage_id,source_scope,match,conditions,actions,mode,priority')
    .eq('branch_id', BRANCH_ID).neq('mode', 'off').order('priority');
  if (ruleId) rulesQ = rulesQ.eq('id', ruleId);
  const { data: rawRules } = await rulesQ;
  if (!rawRules?.length) return { stats: {} };
  const rules = rawRules as unknown as AutoRule[];

  const settings = await loadAutomationSettings(BRANCH_ID);
  const holdMs   = settings.manual_hold_hours * 3600_000;

  // Load non-archived leads
  let leadsQ = supabase.from('crm_leads')
    .select('id,client_id,funnel_id,stage_id,stage_changed_at,created_at,fb_created_at,title,name,phone,manager_user_id')
    .eq('branch_id', BRANCH_ID).eq('is_archived', false);
  if (clientIds?.length) leadsQ = leadsQ.in('client_id', clientIds);
  const { data: rawLeads } = await leadsQ;
  const allLeads = (rawLeads ?? []) as unknown as LeadRow[];

  // Collect all client IDs
  const clientIdSet = new Set<string>();
  for (const l of allLeads) if (l.client_id) clientIdSet.add(l.client_id);
  if (clientIds?.length) for (const c of clientIds) clientIdSet.add(c);
  const allClientIds = [...clientIdSet];

  // Batch load
  const bundle   = await loadClientData(allClientIds, BRANCH_ID);
  const leadIds  = allLeads.map(l => l.id);
  const tasksMap = await loadLeadTasks(leadIds, BRANCH_ID);

  // Leads manually moved in last N hours → hold
  const holdSince = new Date(Date.now() - holdMs).toISOString();
  const { data: recentAct } = leadIds.length
    ? await supabase.from('crm_lead_activity')
        .select('lead_id,author')
        .eq('branch_id', BRANCH_ID).eq('kind', 'stage_change')
        .gte('created_at', holdSince).in('lead_id', leadIds)
    : { data: [] };
  const manualHeld = new Set<string>();
  for (const a of (recentAct ?? []) as { lead_id: string; author: string }[]) {
    if (a.author !== 'Автоматизация' && a.author !== 'система') manualHeld.add(a.lead_id);
  }

  // Latest open lead per client (by stage_changed_at desc, then created_at)
  const latestByClient = new Map<string, string>(); // client_id → lead_id
  for (const l of allLeads) {
    if (!l.client_id) continue;
    const cur = latestByClient.get(l.client_id);
    if (!cur) { latestByClient.set(l.client_id, l.id); continue; }
    const existing = allLeads.find(x => x.id === cur)!;
    const a = l.stage_changed_at ?? l.created_at;
    const b = existing.stage_changed_at ?? existing.created_at;
    if (a > b) latestByClient.set(l.client_id, l.id);
  }

  // Load funnel/stage names for log entries
  const stageIds  = new Set<string>(allLeads.map(l => l.stage_id));
  const funnelIds = new Set<string>(allLeads.map(l => l.funnel_id));
  for (const r of rules) { stageIds.add(r.target_stage_id); funnelIds.add(r.target_funnel_id); }
  const [stagesRes, funnelsRes] = await Promise.all([
    stageIds.size  ? supabase.from('crm_funnel_stages').select('id,name').in('id', [...stageIds])  : Promise.resolve({ data: [] }),
    funnelIds.size ? supabase.from('crm_funnels').select('id,name').in('id', [...funnelIds]) : Promise.resolve({ data: [] }),
  ]);
  const stageNames  = new Map((stagesRes.data ?? []).map((s: Record<string,unknown>) => [s.id as string, s.name as string]));
  const funnelNames = new Map((funnelsRes.data ?? []).map((f: Record<string,unknown>) => [f.id as string, f.name as string]));

  // Load crm_clients for create_lead_if_missing
  const needCreate = rules.some(r => r.actions?.create_lead_if_missing && r.conditions.some(c => ABONEMENT_TYPES.has(c.type)));
  const clientsMap = new Map<string, { full_name: string | null; phone: string | null }>();
  if (needCreate && allClientIds.length) {
    const { data: cRows } = await supabase.from('crm_clients').select('id,full_name,phone').in('id', allClientIds);
    for (const c of (cRows ?? []) as { id: string; full_name: string | null; phone: string | null }[])
      clientsMap.set(c.id, { full_name: c.full_name, phone: c.phone });
  }

  const result: RunAutomationResult = { stats: {} };
  if (dry) result.previewLeads = [];
  const logRows: Record<string, unknown>[] = [];
  const movedLeads = new Set<string>();

  for (const rule of rules) {
    const rStats = { matched: 0, moved: 0, created: 0, skipped: 0 };
    result.stats[rule.id] = rStats;
    const tStageName  = stageNames.get(rule.target_stage_id)  ?? '';
    const tFunnelName = funnelNames.get(rule.target_funnel_id) ?? '';
    const srcFunnels  = rule.source_scope?.funnel_ids ?? [];
    const srcStages   = rule.source_scope?.stage_ids  ?? [];

    for (const lead of allLeads) {
      if (movedLeads.has(lead.id)) continue;
      if (srcFunnels.length && !srcFunnels.includes(lead.funnel_id)) continue;
      if (srcStages.length  && !srcStages.includes(lead.stage_id))  continue;
      if (lead.stage_id === rule.target_stage_id) continue;
      if (lead.client_id && latestByClient.get(lead.client_id) !== lead.id) continue;

      if (manualHeld.has(lead.id)) {
        rStats.skipped++;
        if (!dry) logRows.push({
          branch_id: BRANCH_ID, rule_id: rule.id, rule_name: rule.name,
          lead_id: lead.id, lead_title: lead.title ?? lead.name, client_id: lead.client_id,
          action: 'skip', mode: rule.mode,
          from_stage_id: lead.stage_id, from_funnel_id: lead.funnel_id,
          to_stage_id: rule.target_stage_id, to_funnel_id: rule.target_funnel_id,
          skip_reason: 'manual_hold',
        });
        continue;
      }

      const tasks  = tasksMap.get(lead.id) ?? [];
      const matched = rule.conditions.length === 0 || evalSet(rule, lead, lead.client_id, bundle, settings, tasks);
      if (!matched) continue;

      rStats.matched++;
      const fromStageName  = stageNames.get(lead.stage_id)   ?? '';
      const fromFunnelName = funnelNames.get(lead.funnel_id)  ?? '';

      if (dry) {
        result.previewLeads!.push({
          lead_id: lead.id, title: lead.title ?? lead.name,
          from: `${fromFunnelName} / ${fromStageName}`,
          to:   `${tFunnelName} / ${tStageName}`,
        });
        rStats.moved++;
        continue;
      }

      if (rule.mode === 'live') {
        const now = new Date().toISOString();
        await supabase.from('crm_leads').update({
          stage_id: rule.target_stage_id, funnel_id: rule.target_funnel_id, stage_changed_at: now,
        }).eq('id', lead.id);
        await supabase.from('crm_lead_activity').insert({
          branch_id: BRANCH_ID, lead_id: lead.id, kind: 'stage_change',
          text: `[АВТО] Правило «${rule.name}»: ${fromFunnelName}/${fromStageName} → ${tFunnelName}/${tStageName}`,
          author: 'Автоматизация', meta: { rule_id: rule.id },
        });
        if (rule.actions?.task) await createRuleTask(rule, lead).catch(console.error);
        await runLeadRules({ type: 'stage_enter', leadId: lead.id, stageId: rule.target_stage_id }).catch(console.error);
        emitLive({ topic: 'leads', action: 'automation' });
        rStats.moved++;
        movedLeads.add(lead.id);
      } else {
        // test mode: count as "would move"
        rStats.moved++;
      }

      logRows.push({
        branch_id: BRANCH_ID, rule_id: rule.id, rule_name: rule.name,
        lead_id: lead.id, lead_title: lead.title ?? lead.name, client_id: lead.client_id,
        action: 'move', mode: rule.mode,
        from_stage_id: lead.stage_id, from_funnel_id: lead.funnel_id,
        to_stage_id: rule.target_stage_id, to_funnel_id: rule.target_funnel_id,
      });
    }

    // create_lead_if_missing for clients with no open lead
    if (!dry && rule.actions?.create_lead_if_missing && rule.conditions.some(c => ABONEMENT_TYPES.has(c.type))) {
      const clientsWithLead = new Set(allLeads.map(l => l.client_id).filter(Boolean) as string[]);
      for (const cid of allClientIds) {
        if (clientsWithLead.has(cid)) continue;
        const mockLead = { stage_changed_at: null, created_at: new Date().toISOString(), fb_created_at: null, client_id: cid };
        const matches = rule.conditions.length === 0 || evalSet(rule, mockLead, cid, bundle, settings, []);
        if (!matches) continue;
        const info = clientsMap.get(cid);
        if (!info) continue;
        const name = info.full_name ?? '';
        const { data: nl } = await supabase.from('crm_leads').insert({
          branch_id: BRANCH_ID, client_id: cid, funnel_id: rule.target_funnel_id,
          stage_id: rule.target_stage_id, title: name, name, phone: info.phone,
          origin: 'manual', tags: ['auto'], budget: 0, stage_changed_at: new Date().toISOString(),
          is_archived: false,
        }).select('id').single();
        if (nl) {
          const newId = (nl as Record<string,unknown>).id as string;
          await supabase.from('crm_lead_activity').insert({
            branch_id: BRANCH_ID, lead_id: newId, kind: 'system',
            text: `Заявка создана автоматизацией: правило «${rule.name}»`,
            author: 'Автоматизация', meta: { rule_id: rule.id },
          });
          emitLive({ topic: 'leads', action: 'automation' });
          rStats.created++;
          logRows.push({
            branch_id: BRANCH_ID, rule_id: rule.id, rule_name: rule.name,
            lead_id: newId, lead_title: name, client_id: cid,
            action: 'create_lead', mode: rule.mode,
            to_stage_id: rule.target_stage_id, to_funnel_id: rule.target_funnel_id,
          });
        }
      }
    }

    if (!dry) {
      await supabase.from('crm_automation_rules').update({
        last_run_at: new Date().toISOString(), last_run_stats: rStats,
      }).eq('id', rule.id);
    }
  }

  if (!dry && logRows.length) {
    await supabase.from('crm_automation_log').insert(logRows);
  }

  // Prune old log (only on full cron run)
  if (!dry && !ruleId && !clientIds?.length) {
    const cutoff = new Date(Date.now() - LOG_DAYS * 86400_000).toISOString();
    await supabase.from('crm_automation_log').delete().eq('branch_id', BRANCH_ID).lt('created_at', cutoff);
  }

  return result;
}

async function createRuleTask(rule: AutoRule, lead: LeadRow): Promise<void> {
  const task = rule.actions.task!;
  // Duplicate guard
  const { count } = await supabase.from('crm_lead_activity')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', BRANCH_ID).eq('lead_id', lead.id).eq('kind', 'task')
    .filter('meta->>rule_id', 'eq', rule.id);
  if ((count ?? 0) > 0) return;

  const dueAt = task.due_in_hours > 0 ? new Date(Date.now() + task.due_in_hours * 3600_000).toISOString() : null;
  let responsible: string | null = null;
  if (task.responsible === 'lead_manager') responsible = lead.manager_user_id;
  else if (task.responsible && !['lead_manager','all_managers'].includes(task.responsible)) responsible = task.responsible;

  const description = '[АВТО] ' + task.text;
  await supabase.from('crm_lead_tasks').insert({
    branch_id: BRANCH_ID, lead_id: lead.id, type_id: task.type_id ?? null,
    description, due_at: dueAt, status: 'open',
    created_by: null, responsible_user_id: responsible, fitbase_responsible: [],
  });
  await supabase.from('crm_lead_activity').insert({
    branch_id: BRANCH_ID, lead_id: lead.id, kind: 'task',
    text: description, author: 'Автоматизация', meta: { rule_id: rule.id },
  });
}
