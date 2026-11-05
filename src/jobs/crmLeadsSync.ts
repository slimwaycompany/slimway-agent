import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function toISO(ts: unknown): string | null {
  const n = Number(ts);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

function normPhone(raw: unknown): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return d;
  if (d.length === 10) return '7' + d;
  return null;
}

async function syncFunnels(): Promise<{ funnels: number; stages: number }> {
  const [fbFunnels, fbStages] = await Promise.all([
    paginateGet('/purchase-funnel',      { page_size: 100 }, 'crm-leads-funnels'),
    paginateGet('/purchase-funnel-step', { page_size: 100 }, 'crm-leads-stages'),
  ]);

  if (fbFunnels.length) {
    const rows = fbFunnels.map(f => {
      const fb = f as Record<string, unknown>;
      return { branch_id: BRANCH_ID, fitbase_id: Number(fb.id), name: String(fb.name ?? '').trim(), sort: Number(fb.order ?? 0), is_active: true };
    });
    const { error } = await supabase.from('crm_funnels').upsert(rows, { onConflict: 'fitbase_id' });
    if (error) throw new Error(`funnels: ${error.message}`);
  }

  const { data: funnels } = await supabase.from('crm_funnels').select('id,fitbase_id').eq('branch_id', BRANCH_ID);
  const fMap = new Map(
    (funnels || []).filter(f => f.fitbase_id != null).map(f => [Number(f.fitbase_id), f.id as string]),
  );

  if (fbStages.length) {
    const rows = fbStages.map(s => {
      const sb = s as Record<string, unknown>;
      const fbId = Number(sb.id);
      const pf = sb.purchase_funnel as Record<string, unknown> | null;
      const funnelId = pf?.id != null ? (fMap.get(Number(pf.id)) ?? null) : null;
      const name = String(sb.name ?? '').trim();
      const kind = fbId === 0 ? 'inbox' : fbId === -1 ? 'success' : fbId === -2 ? 'fail' : 'normal';
      return {
        branch_id: BRANCH_ID, fitbase_id: fbId, funnel_id: funnelId, name, kind,
        is_personal:      ['Ангелина', 'Вера', 'Назерке'].includes(name),
        is_archived:      Boolean(sb.archive),
        color:            (sb.color            as string | null) ?? null,
        background_color: (sb.background_color as string | null) ?? null,
        text_color:       (sb.text_color       as string | null) ?? null,
        sort: Number(sb.order ?? 0),
      };
    });
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('crm_funnel_stages')
        .upsert(rows.slice(i, i + 100), { onConflict: 'fitbase_id' });
      if (error) throw new Error(`stages: ${error.message}`);
    }
  }
  return { funnels: fbFunnels.length, stages: fbStages.length };
}

async function syncLeads(): Promise<number> {
  const [
    { data: stages }, { data: adSrcs }, { data: userMap },
    { data: clients }, { data: existing },
  ] = await Promise.all([
    supabase.from('crm_funnel_stages').select('id,fitbase_id,funnel_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_ad_sources').select('id,fitbase_id'),
    supabase.from('crm_fitbase_user_map').select('fitbase_user_id,fitbase_full_name,app_user_id'),
    supabase.from('crm_clients').select('id,fitbase_client_id').not('fitbase_client_id', 'is', null),
    supabase.from('crm_leads').select('fitbase_id,funnel_id').eq('branch_id', BRANCH_ID).eq('origin', 'fitbase'),
  ]);

  const stageMap = new Map<number, { id: string; funnel_id: string | null }>();
  for (const s of stages || []) stageMap.set(Number(s.fitbase_id), { id: s.id as string, funnel_id: s.funnel_id as string | null });

  const adMap = new Map<number, string>();
  for (const a of adSrcs || []) if (a.fitbase_id != null) adMap.set(Number(a.fitbase_id), a.id as string);

  const userByFbId = new Map<number, string>();
  const userByName = new Map<string, string>();
  for (const u of userMap || []) {
    if (u.fitbase_user_id != null) userByFbId.set(Number(u.fitbase_user_id), u.app_user_id as string);
    if (u.fitbase_full_name) userByName.set(String(u.fitbase_full_name).trim(), u.app_user_id as string);
  }

  const clientMap = new Map<number, string>();
  for (const c of clients || []) if (c.fitbase_client_id != null) clientMap.set(Number(c.fitbase_client_id), c.id as string);

  const prevFunnelMap = new Map<number, string | null>();
  for (const l of existing || []) if (l.fitbase_id != null) prevFunnelMap.set(Number(l.fitbase_id), l.funnel_id as string | null);

  const fbLeads = await paginateGet('/lead', { page_size: 100 }, 'crm-leads-sync');
  const now = new Date().toISOString();
  let upserted = 0;

  for (let i = 0; i < fbLeads.length; i += 100) {
    const rows = fbLeads.slice(i, i + 100).map(lead => {
      const l = lead as Record<string, unknown>;
      const fbId = Number(l.id);
      const step = l.funnel_step as Record<string, unknown> | null;
      const fbStageId = step?.id != null ? Number(step.id) : null;
      const stageInfo = fbStageId != null ? stageMap.get(fbStageId) ?? null : null;
      const pf = step?.purchase_funnel as Record<string, unknown> | null;
      // For system stages (0,-1,-2) purchase_funnel is null — preserve previous funnel_id
      let funnelId: string | null = pf?.id != null ? stageInfo?.funnel_id ?? null : null;
      if (!funnelId) funnelId = prevFunnelMap.get(fbId) ?? null;

      const mgr = l.manager as Record<string, unknown> | null;
      const mgrFbId = mgr?.id != null ? Number(mgr.id) : null;
      const mgrName = (mgr?.full_name as string | null) ?? null;
      const mgrUserId = (mgrFbId != null ? userByFbId.get(mgrFbId) : null)
        ?? (mgrName ? userByName.get(mgrName.trim()) : null) ?? null;

      const fbClientId = l.client_id != null ? Number(l.client_id) : null;
      const adSrc = l.advertising_source as Record<string, unknown> | null;

      return {
        branch_id: BRANCH_ID, fitbase_id: fbId, origin: 'fitbase',
        title:        (l.title       as string | null) ?? null,
        name:         (l.name        as string | null) ?? null,
        surname:      (l.surname     as string | null) ?? null,
        patronymic:   (l.patronymic  as string | null) ?? null,
        phone:        normPhone(l.phone),
        email:        (l.email       as string | null) ?? null,
        instagram:    (l.instagram   as string | null) ?? null,
        telegram:     (l.telegram    as string | null) ?? null,
        description:  (l.description as string | null) ?? null,
        budget:       l.budget != null ? String(l.budget) : null,
        funnel_id:    funnelId,
        stage_id:     stageInfo?.id ?? null,
        fitbase_stage_id: fbStageId,
        ad_source_id: adSrc?.id != null ? adMap.get(Number(adSrc.id)) ?? null : null,
        manager_user_id:      mgrUserId ?? null,
        fitbase_manager_id:   mgrFbId,
        fitbase_manager_name: mgrName,
        client_id:            fbClientId != null ? clientMap.get(fbClientId) ?? null : null,
        fitbase_client_id:    fbClientId,
        utm_campaign: (l.utm_campaign as string | null) ?? null,
        utm_source:   (l.utm_source   as string | null) ?? null,
        utm_medium:   (l.utm_medium   as string | null) ?? null,
        utm_term:     (l.utm_term     as string | null) ?? null,
        utm_content:  (l.utm_content  as string | null) ?? null,
        tags:          Array.isArray(l.tags)         ? l.tags         : [],
        custom_fields: Array.isArray(l.custom_fields) ? l.custom_fields : [],
        is_duplicate:  Boolean(l.is_duplicate),
        fb_created_at: toISO(l.created_at),
        fb_updated_at: toISO(l.updated_at),
        synced_at: now,
        raw: l,
      };
    });

    const { data, error } = await supabase.from('crm_leads')
      .upsert(rows, { onConflict: 'fitbase_id' }).select('id');
    if (error) throw new Error(`leads: ${error.message}`);
    upserted += (data || []).length;
  }
  return upserted;
}

async function syncTasks(): Promise<number> {
  const [
    { data: leads }, { data: clients },
    { data: taskTypes }, { data: userMap },
  ] = await Promise.all([
    supabase.from('crm_leads').select('id,fitbase_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_clients').select('id,fitbase_client_id').not('fitbase_client_id', 'is', null),
    supabase.from('crm_task_types').select('id,fitbase_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_fitbase_user_map').select('fitbase_user_id,app_user_id'),
  ]);

  const leadMap = new Map<number, string>();
  for (const l of leads || []) if (l.fitbase_id != null) leadMap.set(Number(l.fitbase_id), l.id as string);

  const clientMap = new Map<number, string>();
  for (const c of clients || []) if (c.fitbase_client_id != null) clientMap.set(Number(c.fitbase_client_id), c.id as string);

  const typeMap = new Map<number, string>();
  for (const t of taskTypes || []) if (t.fitbase_id != null) typeMap.set(Number(t.fitbase_id), t.id as string);

  const userByFbId = new Map<number, string>();
  for (const u of userMap || []) if (u.fitbase_user_id != null) userByFbId.set(Number(u.fitbase_user_id), u.app_user_id as string);

  const fbTasks = await paginateGet('/task', { page_size: 100 }, 'crm-leads-tasks');
  let upserted = 0;

  for (let i = 0; i < fbTasks.length; i += 100) {
    const rows = fbTasks.slice(i, i + 100).map(task => {
      const t = task as Record<string, unknown>;
      const fbLeadId   = t.lead_id   != null ? Number(t.lead_id)   : null;
      const fbClientId = t.client_id != null ? Number(t.client_id) : null;
      const catId      = t.category_id != null ? Number(t.category_id) : null;
      const analytics  = t.analytics as Record<string, unknown> | null;
      const responsible = Array.isArray(t.responsible) ? t.responsible : [];
      const firstResp  = responsible[0] as Record<string, unknown> | undefined;
      const respFbId   = firstResp?.id != null ? Number(firstResp.id) : null;
      const creator    = t.creator    as Record<string, unknown> | null;
      const whoClosed  = t.who_closed as Record<string, unknown> | null;
      return {
        branch_id:  BRANCH_ID,
        fitbase_id: Number(t.id),
        lead_id:    fbLeadId   != null ? leadMap.get(fbLeadId)     ?? null : null,
        client_id:  fbClientId != null ? clientMap.get(fbClientId) ?? null : null,
        type_id:    catId      != null ? typeMap.get(catId)        ?? null : null,
        description: (t.description as string | null) ?? '',
        result:      (t.result      as string | null) ?? null,
        due_at:      toISO(t.available_to),
        is_allday:   Boolean(t.is_allday),
        status:      t.status === 'C' ? 'done' : 'open',
        is_overdue:  Boolean(analytics?.is_overdue),
        closed_at:   toISO(t.closed_at),
        closed_by:   (whoClosed?.full_name as string | null) ?? null,
        created_by:  (creator?.full_name   as string | null) ?? null,
        responsible_user_id: respFbId != null ? userByFbId.get(respFbId) ?? null : null,
        fitbase_responsible: responsible,
        raw: t,
      };
    });
    const { data, error } = await supabase.from('crm_lead_tasks')
      .upsert(rows, { onConflict: 'fitbase_id' }).select('id');
    if (error) throw new Error(`tasks: ${error.message}`);
    upserted += (data || []).length;
  }
  return upserted;
}

export async function runCrmLeadsSync(): Promise<Record<string, unknown>> {
  const start = Date.now();
  const meta  = await syncFunnels();
  const leads = await syncLeads();
  const tasks = await syncTasks();
  return { ...meta, leads, tasks, ms: Date.now() - start };
}
