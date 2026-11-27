import { supabase } from '../db/supabase';
import { paginateGet } from '../http/fitbase';
import { BRANCH_ID, SKIP_FUNNEL_FB_IDS, toISO, buildFbLeadRow, type FbLeadMaps } from './crmLeadsSync';

export interface PreviewGroup {
  fb_funnel: string;
  fb_stage: string;
  fb_stage_id: number;
  count: number;
  target_stage_id: string | null;
}

export interface ImportRunStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  total?: number;
  inserted?: number;
  skipped?: number;
  failed?: number;
  errors?: string[];
  started_at?: string;
  finished_at?: string;
}

let previewCache: { data: PreviewGroup[]; expiry: number } | null = null;
export let importRunStatus: ImportRunStatus = { status: 'idle' };

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim();

export async function previewFitbaseLeadsImport(): Promise<PreviewGroup[]> {
  if (previewCache && previewCache.expiry > Date.now()) return previewCache.data;

  const [fbFunnels, fbStages, fbLeads] = await Promise.all([
    paginateGet('/purchase-funnel',      { page_size: 100 }, 'fb-import-prev-funnels'),
    paginateGet('/purchase-funnel-step', { page_size: 100 }, 'fb-import-prev-stages'),
    paginateGet('/lead',                 { page_size: 100 }, 'fb-import-prev-leads'),
  ]);

  const [{ data: ourFunnels }, { data: ourStages }] = await Promise.all([
    supabase.from('crm_funnels').select('id,name').eq('branch_id', BRANCH_ID),
    supabase.from('crm_funnel_stages').select('id,name,kind,funnel_id').eq('branch_id', BRANCH_ID),
  ]);

  // Our funnel name → id
  const ourFunnelByName = new Map((ourFunnels || []).map(f => [norm(f.name), f.id as string]));

  // Our normal stages: funnelId → normName → stageId
  const ourNormalByFunnel = new Map<string, Map<string, string>>();
  // Our system stages: kind → stageId
  const ourSystemByKind = new Map<string, string>();
  for (const s of ourStages || []) {
    if (!s.funnel_id) {
      ourSystemByKind.set(s.kind as string, s.id as string);
    } else {
      const fName = (ourFunnels || []).find(f => f.id === s.funnel_id);
      if (fName) {
        const key = norm(fName.name);
        if (!ourNormalByFunnel.has(key)) ourNormalByFunnel.set(key, new Map());
        ourNormalByFunnel.get(key)!.set(norm(s.name), s.id as string);
      }
    }
  }

  // Fitbase funnel id → name (skip test funnels)
  const fbFunnelById = new Map(
    (fbFunnels as Record<string, unknown>[])
      .filter(f => !SKIP_FUNNEL_FB_IDS.has(Number(f.id)))
      .map(f => [Number(f.id), String(f.name ?? '')]),
  );

  // Fitbase stage id → { name, kind, funnelName }
  const fbStageById = new Map<number, { name: string; kind: string | null; funnelName: string }>();
  for (const s of fbStages as Record<string, unknown>[]) {
    const fbId = Number(s.id);
    const pf = s.purchase_funnel as Record<string, unknown> | null;
    const pfId = pf?.id != null ? Number(pf.id) : null;
    if (pfId != null && SKIP_FUNNEL_FB_IDS.has(pfId)) continue;
    const funnelName = pfId != null ? (fbFunnelById.get(pfId) ?? '') : '';
    const kind = fbId === 0 ? 'inbox' : fbId === -1 ? 'success' : fbId === -2 ? 'fail' : null;
    fbStageById.set(fbId, { name: String(s.name ?? ''), kind, funnelName });
  }

  // Count leads per Fitbase stage
  const countByStage = new Map<number, number>();
  for (const lead of fbLeads as Record<string, unknown>[]) {
    const step = lead.funnel_step as Record<string, unknown> | null;
    if (!step) continue;
    const fbStageId = step.id != null ? Number(step.id) : null;
    if (fbStageId == null) continue;
    const pf = step.purchase_funnel as Record<string, unknown> | null;
    const pfId = pf?.id != null ? Number(pf.id) : null;
    if (pfId != null && SKIP_FUNNEL_FB_IDS.has(pfId)) continue;
    countByStage.set(fbStageId, (countByStage.get(fbStageId) ?? 0) + 1);
  }

  const groups: PreviewGroup[] = [];
  for (const [fbStageId, { name: fbStageName, kind, funnelName }] of fbStageById) {
    const count = countByStage.get(fbStageId) ?? 0;
    if (count === 0) continue;

    let targetStageId: string | null = null;
    if (kind) {
      targetStageId = ourSystemByKind.get(kind) ?? null;
    } else {
      targetStageId = ourNormalByFunnel.get(norm(funnelName))?.get(norm(fbStageName)) ?? null;
    }

    groups.push({ fb_funnel: funnelName, fb_stage: fbStageName, fb_stage_id: fbStageId, count, target_stage_id: targetStageId });
  }

  groups.sort((a, b) => a.fb_funnel.localeCompare(b.fb_funnel) || a.fb_stage.localeCompare(b.fb_stage));
  previewCache = { data: groups, expiry: Date.now() + 15 * 60 * 1000 };
  return groups;
}

export async function runFitbaseLeadsImportBg(mapping: Record<string, string>): Promise<void> {
  if (importRunStatus.status === 'running') return;
  importRunStatus = { status: 'running', started_at: new Date().toISOString(), total: 0, inserted: 0, skipped: 0, failed: 0, errors: [] };

  try {
    const [
      { data: stagesData }, { data: adSrcs }, { data: userMap },
      { data: clients }, { data: ourFunnels },
    ] = await Promise.all([
      supabase.from('crm_funnel_stages').select('id,funnel_id,kind,name,fitbase_id').eq('branch_id', BRANCH_ID),
      supabase.from('crm_ad_sources').select('id,fitbase_id'),
      supabase.from('crm_fitbase_user_map').select('fitbase_user_id,fitbase_full_name,user_id'),
      supabase.from('crm_clients').select('id,fitbase_client_id').not('fitbase_client_id', 'is', null),
      supabase.from('crm_funnels').select('id,name,fitbase_id').eq('branch_id', BRANCH_ID),
    ]);

    const stageInfoById = new Map<string, { funnel_id: string | null; kind: string; name: string }>();
    for (const s of stagesData || []) stageInfoById.set(s.id as string, { funnel_id: s.funnel_id as string | null, kind: s.kind as string, name: s.name as string });

    const ourFunnelByFbId = new Map<number, string>();
    const ourFunnelByName = new Map<string, string>();
    for (const f of ourFunnels || []) {
      if (f.fitbase_id != null) ourFunnelByFbId.set(Number(f.fitbase_id), f.id as string);
      ourFunnelByName.set(norm(f.name), f.id as string);
    }

    const { data: defFunnel } = await supabase.from('crm_funnels')
      .select('id').eq('branch_id', BRANCH_ID).ilike('name', '%новые заявки%').limit(1).maybeSingle();
    const defaultFunnelId: string | null = (defFunnel as { id?: string } | null)?.id ?? null;

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

    const maps: FbLeadMaps = { adMap, userByFbId, userByName, clientMap };

    const fbLeads = await paginateGet('/lead', { page_size: 100 }, 'fb-import-run');
    importRunStatus.total = fbLeads.length;

    const now = new Date().toISOString();
    let inserted = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < fbLeads.length; i += 100) {
      const batch = fbLeads.slice(i, i + 100);
      const rows: Record<string, unknown>[] = [];
      const rowMeta: { fbId: number; funnelName: string; stageName: string }[] = [];

      for (const lead of batch) {
        const l = lead as Record<string, unknown>;
        const fbId = Number(l.id);
        const step = l.funnel_step as Record<string, unknown> | null;
        const fbStageId = step?.id != null ? Number(step.id) : null;
        if (fbStageId == null) { skipped++; continue; }

        const targetStageId = mapping[String(fbStageId)];
        if (!targetStageId) { skipped++; continue; }

        const stageInfo = stageInfoById.get(targetStageId);
        if (!stageInfo) { skipped++; if (errors.length < 20) errors.push(`fbId=${fbId}: неизвестный этап ${targetStageId}`); continue; }

        // Derive funnel_id: normal stage has it; system stage (funnel_id IS NULL) → from Fitbase funnel
        let funnelId: string | null = stageInfo.funnel_id;
        if (!funnelId) {
          const pf = step?.purchase_funnel as Record<string, unknown> | null;
          const pfFbId = pf?.id != null ? Number(pf.id) : null;
          funnelId = (pfFbId != null ? ourFunnelByFbId.get(pfFbId) : null)
            ?? (pf?.name ? ourFunnelByName.get(norm(String(pf.name))) : null)
            ?? defaultFunnelId;
        }

        const pf = step?.purchase_funnel as Record<string, unknown> | null;
        rowMeta.push({ fbId, funnelName: String(pf?.name ?? ''), stageName: stageInfo.name });
        rows.push(buildFbLeadRow(l, targetStageId, funnelId, fbStageId, maps, toISO(l.updated_at), now));
      }

      if (!rows.length) { skipped += batch.length - rows.length; continue; }

      const { data: ins, error } = await supabase.from('crm_leads')
        .upsert(rows, { onConflict: 'fitbase_id', ignoreDuplicates: true }).select('id,fitbase_id');

      if (error) {
        // retry per row
        for (let j = 0; j < rows.length; j++) {
          const { data: rd, error: re } = await supabase.from('crm_leads')
            .upsert([rows[j]], { onConflict: 'fitbase_id', ignoreDuplicates: true }).select('id,fitbase_id');
          if (!re && rd?.length) {
            inserted++;
            await supabase.from('crm_lead_activity').insert({ branch_id: BRANCH_ID, lead_id: (rd[0] as Record<string, unknown>).id as string, kind: 'system', text: `Перенесена из Fitbase: ${rowMeta[j]?.funnelName} / ${rowMeta[j]?.stageName}`, author: 'Система', meta: {} }).then(null, () => {});
          } else if (re) {
            failed++;
            if (errors.length < 20) errors.push(`fbId=${rows[j].fitbase_id}: ${re.message}`);
          } else {
            skipped++; // already exists
          }
        }
      } else {
        const insertedFbIds = new Set((ins || []).map(r => Number((r as Record<string, unknown>).fitbase_id)));
        for (let j = 0; j < rows.length; j++) {
          if (insertedFbIds.has(Number(rows[j].fitbase_id))) {
            inserted++;
            const insRow = (ins || []).find(r => Number((r as Record<string, unknown>).fitbase_id) === Number(rows[j].fitbase_id));
            if (insRow) {
              await supabase.from('crm_lead_activity').insert({ branch_id: BRANCH_ID, lead_id: (insRow as Record<string, unknown>).id as string, kind: 'system', text: `Перенесена из Fitbase: ${rowMeta[j]?.funnelName} / ${rowMeta[j]?.stageName}`, author: 'Система', meta: {} }).then(null, () => {});
            }
          } else {
            skipped++;
          }
        }
      }

      importRunStatus = { ...importRunStatus, inserted, skipped, failed, errors };
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
    }

    await supabase.from('crm_audit_log').insert({ branch_id: BRANCH_ID, entity_type: 'fitbase_leads_import', action: 'import', data: { inserted, skipped, failed, mapping_keys: Object.keys(mapping).length } }).then(null, () => {});

    importRunStatus = { status: 'done', total: fbLeads.length, inserted, skipped, failed, errors, started_at: importRunStatus.started_at, finished_at: new Date().toISOString() };
  } catch (e) {
    importRunStatus = { ...importRunStatus, status: 'error', errors: [String(e)], finished_at: new Date().toISOString() };
    console.error('[fb-import] error:', e);
  }
}
