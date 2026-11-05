import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const SKIP_FUNNEL_FB_IDS = new Set([5, 6, 7]);

function toISO(ts: unknown): string | null {
  const n = Number(ts);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function normPhone(raw: unknown): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return d;
  if (d.length === 10) return '7' + d;
  return null;
}

async function syncDicts(): Promise<void> {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const { data: st } = await supabase.from('sync_state').select('value').eq('key', 'crm_leads_dicts_at').single();
  if ((st as Record<string, unknown> | null)?.value === today) return;

  // /user → upsert crm_fitbase_user_map (fitbase_full_name only, don't touch user_id)
  try {
    const users = await paginateGet('/user', { page_size: 100 }, 'crm-leads-users');
    for (let i = 0; i < users.length; i += 100) {
      const rows = users.slice(i, i + 100)
        .map(u => ({
          fitbase_user_id: Number((u as Record<string, unknown>).id),
          fitbase_full_name: String((u as Record<string, unknown>).full_name ?? '').trim(),
        }))
        .filter(r => r.fitbase_full_name);
      if (rows.length) {
        await supabase.from('crm_fitbase_user_map')
          .upsert(rows, { onConflict: 'fitbase_user_id', ignoreDuplicates: false });
      }
    }
  } catch (e) { console.error('[crm-leads-sync] syncDicts /user:', e); }

  // /advertising-source → update crm_ad_sources.fitbase_id by name (case-insensitive)
  try {
    const adSrcs = await paginateGet('/advertising-source', { page_size: 100 }, 'crm-leads-adsources');
    const { data: ourSrcs } = await supabase.from('crm_ad_sources').select('id,name').eq('branch_id', BRANCH_ID);
    const srcByName = new Map(
      (ourSrcs || []).map(s => [String((s as Record<string, unknown>).name).toLowerCase().trim(), (s as Record<string, unknown>).id as string]),
    );
    for (const a of adSrcs) {
      const ab = a as Record<string, unknown>;
      const name = String(ab.name ?? '').toLowerCase().trim();
      const ourId = srcByName.get(name);
      if (ourId) await supabase.from('crm_ad_sources').update({ fitbase_id: Number(ab.id) }).eq('id', ourId);
    }
  } catch (e) { console.error('[crm-leads-sync] syncDicts /advertising-source:', e); }

  await supabase.from('sync_state').upsert({ key: 'crm_leads_dicts_at', value: today }, { onConflict: 'key' });
}

async function syncFunnels(): Promise<{ funnels: number; stages: number }> {
  const [fbFunnels, fbStages] = await Promise.all([
    paginateGet('/purchase-funnel',      { page_size: 100 }, 'crm-leads-funnels'),
    paginateGet('/purchase-funnel-step', { page_size: 100 }, 'crm-leads-stages'),
  ]);

  const toSync = fbFunnels.filter(f => !SKIP_FUNNEL_FB_IDS.has(Number((f as Record<string, unknown>).id)));
  if (toSync.length) {
    const rows = toSync.map(f => {
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
    const { data: existing } = await supabase.from('crm_funnel_stages').select('id,fitbase_id').eq('branch_id', BRANCH_ID);
    const existingByFbId = new Map(
      (existing || []).map(s => [Number((s as Record<string, unknown>).fitbase_id), (s as Record<string, unknown>).id as string]),
    );

    for (const s of fbStages) {
      const sb = s as Record<string, unknown>;
      const fbId = Number(sb.id);
      const pf = sb.purchase_funnel as Record<string, unknown> | null;
      const pfFbId = pf?.id != null ? Number(pf.id) : null;
      if (pfFbId != null && SKIP_FUNNEL_FB_IDS.has(pfFbId)) continue;
      const funnelId = pfFbId != null ? (fMap.get(pfFbId) ?? null) : null;
      const name = String(sb.name ?? '').trim();

      const updatable = {
        funnel_id: funnelId, name, is_archived: Boolean(sb.archive),
        color:            (sb.color            as string | null) ?? null,
        background_color: (sb.background_color as string | null) ?? null,
        text_color:       (sb.text_color       as string | null) ?? null,
        sort: Number(sb.order ?? 0),
      };

      const existingId = existingByFbId.get(fbId);
      if (existingId) {
        // UPDATE only — don't touch kind or is_personal
        await supabase.from('crm_funnel_stages').update(updatable).eq('id', existingId);
      } else {
        const kind = fbId === 0 ? 'inbox' : fbId === -1 ? 'success' : fbId === -2 ? 'fail' : 'normal';
        await supabase.from('crm_funnel_stages').insert({
          branch_id: BRANCH_ID, fitbase_id: fbId,
          kind, is_personal: ['Ангелина', 'Вера', 'Назерке'].includes(name),
          ...updatable,
        });
      }
    }
  }

  return { funnels: fbFunnels.length, stages: fbStages.length };
}

async function syncLeads(): Promise<{ total: number; upserted: number; skipped: number; failed: number }> {
  const [
    { data: stages }, { data: adSrcs }, { data: userMap },
    { data: clients }, { data: existing },
  ] = await Promise.all([
    supabase.from('crm_funnel_stages').select('id,fitbase_id,funnel_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_ad_sources').select('id,fitbase_id'),
    supabase.from('crm_fitbase_user_map').select('fitbase_user_id,fitbase_full_name,user_id'),
    supabase.from('crm_clients').select('id,fitbase_client_id').not('fitbase_client_id', 'is', null),
    supabase.from('crm_leads').select('fitbase_id,funnel_id,stage_id,stage_changed_at').eq('branch_id', BRANCH_ID).eq('origin', 'fitbase'),
  ]);

  const { data: defFunnel } = await supabase.from('crm_funnels')
    .select('id').eq('branch_id', BRANCH_ID).ilike('name', '%новые заявки%').limit(1).maybeSingle();
  const defaultFunnelId: string | null = (defFunnel as { id?: string } | null)?.id ?? null;

  const stageMap = new Map<number, { id: string; funnel_id: string | null }>();
  for (const s of stages || []) stageMap.set(Number(s.fitbase_id), { id: s.id as string, funnel_id: s.funnel_id as string | null });

  const adMap = new Map<number, string>();
  for (const a of adSrcs || []) if (a.fitbase_id != null) adMap.set(Number(a.fitbase_id), a.id as string);

  const userByFbId = new Map<number, string>();
  const userByName = new Map<string, string>();
  for (const u of userMap || []) {
    const uid = (u as Record<string, unknown>).user_id as string | null;
    if (uid && u.fitbase_user_id != null) userByFbId.set(Number(u.fitbase_user_id), uid);
    if (uid && u.fitbase_full_name) userByName.set(String(u.fitbase_full_name).trim(), uid);
  }

  const clientMap = new Map<number, string>();
  for (const c of clients || []) if (c.fitbase_client_id != null) clientMap.set(Number(c.fitbase_client_id), c.id as string);

  type PrevEntry = { funnel_id: string | null; stage_id: string | null; stage_changed_at: string | null };
  const prevMap = new Map<number, PrevEntry>();
  for (const l of existing || []) {
    if (l.fitbase_id != null) {
      prevMap.set(Number(l.fitbase_id), {
        funnel_id: l.funnel_id as string | null,
        stage_id: l.stage_id as string | null,
        stage_changed_at: l.stage_changed_at as string | null,
      });
    }
  }

  const fbLeads = await paginateGet('/lead', { page_size: 100 }, 'crm-leads-sync');
  const fetchedFbIds = new Set(fbLeads.map(l => Number((l as Record<string, unknown>).id)));
  const now = new Date().toISOString();
  let upserted = 0;
  let skipped = 0;
  let failed = 0;
  const failedExamples: string[] = [];

  for (let i = 0; i < fbLeads.length; i += 100) {
    const batch = fbLeads.slice(i, i + 100);
    const rows: Record<string, unknown>[] = [];
    const actPending: { fitbase_id: number; kind: string; text: string }[] = [];

    for (const lead of batch) {
      const l = lead as Record<string, unknown>;
      const fbId = Number(l.id);
      const step = l.funnel_step as Record<string, unknown> | null;
      const fbStageId = step?.id != null ? Number(step.id) : null;

      if (fbStageId == null) {
        skipped++;
        if (failedExamples.length < 20) failedExamples.push(`fbId=${fbId}: нет этапа`);
        continue;
      }
      const stageInfo = stageMap.get(fbStageId) ?? null;
      if (!stageInfo) {
        skipped++;
        if (failedExamples.length < 20) failedExamples.push(`fbId=${fbId}: неизвестный этап ${fbStageId}`);
        continue;
      }

      const pf = (step as Record<string, unknown>).purchase_funnel as Record<string, unknown> | null;
      let funnelId: string | null = pf?.id != null ? (stageInfo.funnel_id ?? null) : null;
      const prev = prevMap.get(fbId);
      if (!funnelId) funnelId = prev?.funnel_id ?? defaultFunnelId;

      const mgr = l.manager as Record<string, unknown> | null;
      const mgrFbId = mgr?.id != null ? Number(mgr.id) : null;
      const mgrName = (mgr?.full_name as string | null) ?? null;
      const mgrUserId = (mgrFbId != null ? userByFbId.get(mgrFbId) : null)
        ?? (mgrName ? userByName.get(mgrName.trim()) : null) ?? null;

      const fbClientId = l.client_id != null ? Number(l.client_id) : null;
      const adSrc = l.advertising_source as Record<string, unknown> | null;
      const fbUpdatedAt = toISO(l.updated_at);

      // Track stage changes
      let stageChangedAt: string | null = prev?.stage_changed_at ?? null;
      if (stageInfo.id !== prev?.stage_id) {
        stageChangedAt = prev == null ? fbUpdatedAt : now; // first import → fb_updated_at
        if (prev != null) actPending.push({ fitbase_id: fbId, kind: 'stage_change', text: 'Этап изменён' });
      }

      rows.push({
        branch_id: BRANCH_ID, fitbase_id: fbId, origin: 'fitbase',
        title:        String(l.title ?? '').trim(),
        name:         (l.name        as string | null) ?? null,
        surname:      (l.surname     as string | null) ?? null,
        patronymic:   (l.patronymic  as string | null) ?? null,
        phone:        normPhone(l.phone),
        email:        (l.email       as string | null) ?? null,
        instagram:    (l.instagram   as string | null) ?? null,
        telegram:     (l.telegram    as string | null) ?? null,
        description:  (l.description as string | null) ?? null,
        budget:       toNum(l.budget),
        funnel_id:    funnelId,
        stage_id:     stageInfo.id,
        stage_changed_at: stageChangedAt,
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
        fb_updated_at: fbUpdatedAt,
        synced_at: now,
        raw: l,
      });
    }

    if (rows.length) {
      const { data, error } = await supabase.from('crm_leads')
        .upsert(rows, { onConflict: 'fitbase_id' }).select('id');
      if (!error) {
        upserted += (data || []).length;
      } else {
        // retry per row to isolate bad records
        for (const row of rows) {
          const { data: rd, error: re } = await supabase.from('crm_leads')
            .upsert([row], { onConflict: 'fitbase_id' }).select('id');
          if (!re) { upserted += (rd || []).length; }
          else {
            failed++;
            if (failedExamples.length < 20) failedExamples.push(`fbId=${row.fitbase_id}: ${re.message}`);
          }
        }
      }
    }

    // Activity for stage changes
    for (const act of actPending) {
      const { data: ld } = await supabase.from('crm_leads')
        .select('id').eq('fitbase_id', act.fitbase_id).eq('branch_id', BRANCH_ID).maybeSingle();
      if (ld) {
        await supabase.from('crm_lead_activity').insert({
          branch_id: BRANCH_ID, lead_id: (ld as Record<string, unknown>).id,
          kind: act.kind, text: act.text, author: 'Fitbase', meta: {},
        });
      }
    }
  }

  // Mark deleted leads (all pages loaded without error since paginateGet throws on failure)
  const { data: activeLeads } = await supabase.from('crm_leads')
    .select('id,fitbase_id').eq('branch_id', BRANCH_ID).eq('origin', 'fitbase').eq('is_archived', false);
  for (const lead of activeLeads || []) {
    const fbId = Number((lead as Record<string, unknown>).fitbase_id);
    if (!fetchedFbIds.has(fbId)) {
      const id = (lead as Record<string, unknown>).id as string;
      await supabase.from('crm_leads').update({ is_archived: true, archived_at: now }).eq('id', id);
      await supabase.from('crm_lead_activity').insert({
        branch_id: BRANCH_ID, lead_id: id, kind: 'system',
        text: 'Заявка удалена в Fitbase', author: 'Система', meta: {},
      });
    }
  }

  if (failedExamples.length) console.error('[crm-leads-sync] failures:', failedExamples.join(' | '));
  return { total: fbLeads.length, upserted, skipped, failed };
}

async function syncTasks(): Promise<{ total: number; upserted: number; failed: number }> {
  const [
    { data: leads }, { data: clients },
    { data: taskTypes }, { data: userMap },
  ] = await Promise.all([
    supabase.from('crm_leads').select('id,fitbase_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_clients').select('id,fitbase_client_id').not('fitbase_client_id', 'is', null),
    supabase.from('crm_task_types').select('id,fitbase_id').eq('branch_id', BRANCH_ID),
    supabase.from('crm_fitbase_user_map').select('fitbase_user_id,user_id'),
  ]);

  const leadMap = new Map<number, string>();
  for (const l of leads || []) if (l.fitbase_id != null) leadMap.set(Number(l.fitbase_id), l.id as string);

  const clientMap = new Map<number, string>();
  for (const c of clients || []) if (c.fitbase_client_id != null) clientMap.set(Number(c.fitbase_client_id), c.id as string);

  const typeMap = new Map<number, string>();
  for (const t of taskTypes || []) if (t.fitbase_id != null) typeMap.set(Number(t.fitbase_id), t.id as string);

  const userByFbId = new Map<number, string>();
  for (const u of userMap || []) {
    const uid = (u as Record<string, unknown>).user_id as string | null;
    if (uid && u.fitbase_user_id != null) userByFbId.set(Number(u.fitbase_user_id), uid);
  }

  const fbTasks = await paginateGet('/task', { page_size: 100 }, 'crm-leads-tasks');
  let upserted = 0;
  let failed = 0;
  const failedExamples: string[] = [];

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
    if (!error) {
      upserted += (data || []).length;
    } else {
      for (const row of rows) {
        const { data: rd, error: re } = await supabase.from('crm_lead_tasks')
          .upsert([row], { onConflict: 'fitbase_id' }).select('id');
        if (!re) { upserted += (rd || []).length; }
        else {
          failed++;
          if (failedExamples.length < 20) failedExamples.push(`fbTaskId=${row.fitbase_id}: ${re.message}`);
        }
      }
    }
  }

  if (failedExamples.length) console.error('[crm-leads-sync] task failures:', failedExamples.join(' | '));
  return { total: fbTasks.length, upserted, failed };
}

async function syncClientStatuses(): Promise<void> {
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const { data: st } = await supabase.from('sync_state').select('value').eq('key', 'crm_clients_status_at').single();
  if ((st as Record<string, unknown> | null)?.value === today) return;

  const clients = await paginateGet('/client', { page_size: 100 }, 'crm-clients-status');
  for (let i = 0; i < clients.length; i += 100) {
    for (const c of clients.slice(i, i + 100)) {
      const cb = c as Record<string, unknown>;
      await supabase.from('crm_clients')
        .update({ fitbase_status: (cb.status as string | null) ?? null })
        .eq('fitbase_client_id', Number(cb.id)).eq('branch_id', BRANCH_ID);
    }
  }
  await supabase.from('sync_state').upsert({ key: 'crm_clients_status_at', value: today }, { onConflict: 'key' });
}

export async function runCrmLeadsSync(): Promise<Record<string, unknown>> {
  const start = Date.now();
  let funnelsMeta = { funnels: 0, stages: 0 };
  let leadsMeta   = { total: 0, upserted: 0, skipped: 0, failed: 0 };
  let tasksMeta   = { total: 0, upserted: 0, failed: 0 };
  const errors: string[] = [];

  try { await syncDicts();                        } catch (e) { errors.push(`dicts: ${e}`); }
  try { funnelsMeta = await syncFunnels();        } catch (e) { errors.push(`funnels: ${e}`); }
  try { leadsMeta   = await syncLeads();          } catch (e) { errors.push(`leads: ${e}`); }
  try { tasksMeta   = await syncTasks();          } catch (e) { errors.push(`tasks: ${e}`); }
  try { await syncClientStatuses();               } catch (e) { errors.push(`client_statuses: ${e}`); }

  return { ...funnelsMeta, leads: leadsMeta, tasks: tasksMeta, errors, ms: Date.now() - start };
}
