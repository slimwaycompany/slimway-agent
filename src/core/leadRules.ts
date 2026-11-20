import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

export interface LeadRuleEvent {
  type: 'lead_created' | 'stage_enter';
  leadId: string;
  stageId?: string;
}

async function getTaskTypeIdByName(name: string): Promise<string | null> {
  const { data } = await supabase.from('crm_task_types')
    .select('id').eq('branch_id', BRANCH_ID).ilike('name', name).limit(1).maybeSingle();
  return (data as Record<string, string> | null)?.id ?? null;
}

async function hasDuplicate(leadId: string, ruleCode: string, stageId?: string): Promise<boolean> {
  let q = supabase.from('crm_lead_activity')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', BRANCH_ID)
    .eq('lead_id', leadId)
    .eq('kind', 'task')
    .filter('meta->>rule_code', 'eq', ruleCode);
  if (stageId) q = q.filter('meta->>stage_id', 'eq', stageId);
  const { count } = await q;
  return (count ?? 0) > 0;
}

async function applyRule(
  rule: { id: string; code: string; params: Record<string, unknown> },
  event: LeadRuleEvent,
): Promise<void> {
  const p = rule.params ?? {};

  if (rule.code === 'lead_first_contact' && event.type === 'lead_created') {
    if (await hasDuplicate(event.leadId, rule.code)) {
      console.log(`[lead-rules] skipped_duplicate: ${rule.code} lead=${event.leadId}`);
      return;
    }

    const { data: lead } = await supabase.from('crm_leads')
      .select('id,manager_user_id,funnel_id').eq('id', event.leadId).eq('branch_id', BRANCH_ID).maybeSingle();
    if (!lead) return;

    // Check funnel name
    const targetFunnel = String(p.funnel_name ?? 'Новые заявки');
    if ((lead as Record<string, unknown>).funnel_id) {
      const { data: funnel } = await supabase.from('crm_funnels')
        .select('name').eq('id', (lead as Record<string, unknown>).funnel_id as string).maybeSingle();
      if (funnel && !((funnel as Record<string, string>).name ?? '').toLowerCase().includes(targetFunnel.toLowerCase())) return;
    }

    const typeId = await getTaskTypeIdByName(String(p.task_type ?? 'Звонок'));
    const dueMinutes = Number(p.due_in_minutes ?? 5);
    const dueAt = new Date(Date.now() + dueMinutes * 60_000).toISOString();
    const description = '[АВТО] ' + String(p.text ?? 'Первый контакт');
    const managerId = (lead as Record<string, unknown>).manager_user_id as string | null ?? null;

    await supabase.from('crm_lead_tasks').insert({
      branch_id: BRANCH_ID, lead_id: event.leadId,
      type_id: typeId, description, due_at: dueAt,
      status: 'open', created_by: null, responsible_user_id: managerId, fitbase_responsible: [],
    });
    await supabase.from('crm_lead_activity').insert({
      branch_id: BRANCH_ID, lead_id: event.leadId,
      kind: 'task', text: description, author: 'система', meta: { rule_code: rule.code },
    });
    return;
  }

  if (rule.code === 'stage_task' && event.type === 'stage_enter' && event.stageId) {
    if (await hasDuplicate(event.leadId, rule.code, event.stageId)) {
      console.log(`[lead-rules] skipped_duplicate: ${rule.code} lead=${event.leadId} stage=${event.stageId}`);
      return;
    }

    const { data: stage } = await supabase.from('crm_funnel_stages')
      .select('id,name,funnel_id').eq('id', event.stageId).eq('branch_id', BRANCH_ID).maybeSingle();
    if (!stage) return;

    const targetFunnelName = String(p.funnel_name ?? 'Новые заявки');
    const targetStageName  = String(p.stage_name ?? '');
    const stageName = (stage as Record<string, unknown>).name as string;

    if (!stageName.toLowerCase().includes(targetStageName.toLowerCase())) return;

    // Check funnel name
    if ((stage as Record<string, unknown>).funnel_id) {
      const { data: funnel } = await supabase.from('crm_funnels')
        .select('name').eq('id', (stage as Record<string, unknown>).funnel_id as string).maybeSingle();
      if (funnel && !((funnel as Record<string, string>).name ?? '').toLowerCase().includes(targetFunnelName.toLowerCase())) return;
    }

    const { data: lead } = await supabase.from('crm_leads')
      .select('id,manager_user_id').eq('id', event.leadId).eq('branch_id', BRANCH_ID).maybeSingle();
    if (!lead) return;

    const typeId = await getTaskTypeIdByName(String(p.task_type ?? 'Звонок'));
    const dueMinutes = Number(p.due_in_minutes ?? 0);
    const dueAt = dueMinutes > 0 ? new Date(Date.now() + dueMinutes * 60_000).toISOString() : null;
    const description = '[АВТО] ' + String(p.text ?? 'Задача по этапу');
    const managerId = (lead as Record<string, unknown>).manager_user_id as string | null ?? null;

    await supabase.from('crm_lead_tasks').insert({
      branch_id: BRANCH_ID, lead_id: event.leadId,
      type_id: typeId, description, due_at: dueAt,
      status: 'open', created_by: null, responsible_user_id: managerId, fitbase_responsible: [],
    });
    await supabase.from('crm_lead_activity').insert({
      branch_id: BRANCH_ID, lead_id: event.leadId,
      kind: 'task', text: description, author: 'система',
      meta: { rule_code: rule.code, stage_id: event.stageId },
    });
    return;
  }
}

export async function runLeadRules(event: LeadRuleEvent): Promise<void> {
  try {
    const { data: rules } = await supabase.from('crm_lead_rules')
      .select('id,code,is_enabled,params').eq('branch_id', BRANCH_ID).eq('is_enabled', true);
    if (!rules?.length) return;
    for (const rule of rules) {
      try {
        await applyRule(rule as { id: string; code: string; params: Record<string, unknown> }, event);
      } catch (e) {
        console.error(`[lead-rules] rule=${(rule as Record<string, unknown>).code} error:`, e);
      }
    }
  } catch (e) {
    console.error('[lead-rules] error loading rules:', e);
  }
}
