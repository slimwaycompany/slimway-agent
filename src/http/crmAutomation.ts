import { Router } from 'express';
import { supabase } from '../db/supabase';
import { getSessionWithPerms, requirePerm } from './auth';
import { CONDITION_TYPES } from '../core/automation/conditions';
import { runAutomation } from '../core/automation/engine';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const VALID_MODES = new Set(['off', 'test', 'live']);
const VALID_MATCH = new Set(['all', 'any']);

async function writeAudit(entity_type: string, entity_id: string, action: string, actor: string) {
  try { await supabase.from('crm_audit_log').insert({ entity_type, entity_id, action, actor, details: {} }); } catch {}
}

function validateConditions(conds: unknown): string | null {
  if (!Array.isArray(conds)) return 'conditions должен быть массивом';
  for (const c of conds) {
    if (!c || typeof c !== 'object') return 'Неверный формат условия';
    const { type, params } = c as Record<string, unknown>;
    if (!CONDITION_TYPES.has(type as string)) return `Неизвестный тип условия: ${type}`;
    const p = (params ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      if (v === '' || v === null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return `Параметр ${k} должен быть целым ≥ 0`;
    }
    if (p.from !== undefined && p.to !== undefined && p.to !== '' && Number(p.from) > Number(p.to))
      return 'Параметр «от» не может быть больше «до»';
  }
  return null;
}

export function buildCrmAutomationRouter(): Router {
  const r = Router();

  // ── Settings ─────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/automation/settings', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'view', session)) return;
    try {
      const { data } = await supabase.from('crm_settings')
        .select('key,value').eq('branch_id', BRANCH_ID)
        .in('key', ['automation.min_plan_price', 'automation.manual_hold_hours']);
      const map = new Map((data ?? []).map(r => [r.key as string, r.value as string]));
      res.json({
        min_plan_price:    Number(map.get('automation.min_plan_price')    ?? 40000),
        manual_hold_hours: Number(map.get('automation.manual_hold_hours') ?? 24),
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/kviz/api/crm/automation/settings', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const pairs: { key: string; value: string }[] = [];
      if (b.min_plan_price !== undefined) {
        const v = Number(b.min_plan_price);
        if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: 'Неверная минимальная цена' }); return; }
        pairs.push({ key: 'automation.min_plan_price', value: String(v) });
      }
      if (b.manual_hold_hours !== undefined) {
        const v = Number(b.manual_hold_hours);
        if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: 'Неверное количество часов' }); return; }
        pairs.push({ key: 'automation.manual_hold_hours', value: String(v) });
      }
      for (const { key, value } of pairs) {
        await supabase.from('crm_settings').upsert({ branch_id: BRANCH_ID, key, value }, { onConflict: 'branch_id,key' });
      }
      await writeAudit('crm_settings', BRANCH_ID, 'automation.settings.update', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Rules ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/automation/rules', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'view', session)) return;
    try {
      const [rulesRes, stagesRes, funnelsRes] = await Promise.all([
        supabase.from('crm_automation_rules')
          .select('id,name,target_funnel_id,target_stage_id,source_scope,match,conditions,actions,mode,priority,last_run_at,last_run_stats')
          .eq('branch_id', BRANCH_ID).order('priority'),
        supabase.from('crm_funnel_stages').select('id,name,funnel_id,color').eq('branch_id', BRANCH_ID),
        supabase.from('crm_funnels').select('id,name').eq('branch_id', BRANCH_ID),
      ]);
      res.json({
        rules: rulesRes.data ?? [],
        stages: stagesRes.data ?? [],
        funnels: funnelsRes.data ?? [],
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/automation/rules', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name || !String(b.name).trim()) { res.status(400).json({ error: 'Укажите название правила' }); return; }
      if (!b.target_funnel_id || !b.target_stage_id) { res.status(400).json({ error: 'Укажите целевой этап' }); return; }

      const { data: stage } = await supabase.from('crm_funnel_stages')
        .select('id,funnel_id').eq('id', b.target_stage_id).eq('branch_id', BRANCH_ID).maybeSingle();
      if (!stage || (stage as Record<string, unknown>).funnel_id !== b.target_funnel_id)
        { res.status(400).json({ error: 'Целевой этап не принадлежит выбранной воронке' }); return; }

      if (!VALID_MODES.has(b.mode as string)) { res.status(400).json({ error: 'Неверный режим' }); return; }
      if (!VALID_MATCH.has(b.match as string)) { res.status(400).json({ error: 'Неверный тип совпадения' }); return; }

      const condErr = validateConditions(b.conditions);
      if (condErr) { res.status(400).json({ error: condErr }); return; }

      // Max priority + 10
      const { data: maxPri } = await supabase.from('crm_automation_rules')
        .select('priority').eq('branch_id', BRANCH_ID).order('priority', { ascending: false }).limit(1).maybeSingle();
      const priority = maxPri ? Number((maxPri as Record<string,unknown>).priority) + 10 : 10;

      const { data, error } = await supabase.from('crm_automation_rules').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(),
        target_funnel_id: b.target_funnel_id, target_stage_id: b.target_stage_id,
        source_scope: b.source_scope ?? { funnel_ids: [], stage_ids: [] },
        match: b.match, conditions: b.conditions ?? [],
        actions: b.actions ?? {}, mode: b.mode ?? 'off', priority,
      }).select('id').single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('automation_rule', (data as Record<string,unknown>).id as string, 'create', session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/automation/rules/reorder', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids должен быть массивом' }); return; }
      for (let i = 0; i < ids.length; i++) {
        await supabase.from('crm_automation_rules').update({ priority: i * 10 }).eq('id', ids[i]).eq('branch_id', BRANCH_ID);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/automation/rules/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};

      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (!name) { res.status(400).json({ error: 'Укажите название' }); return; }
        upd.name = name;
      }
      if (b.target_funnel_id !== undefined || b.target_stage_id !== undefined) {
        const funnelId = b.target_funnel_id as string;
        const stageId  = b.target_stage_id as string;
        const { data: stage } = await supabase.from('crm_funnel_stages')
          .select('id,funnel_id').eq('id', stageId).eq('branch_id', BRANCH_ID).maybeSingle();
        if (!stage || (stage as Record<string,unknown>).funnel_id !== funnelId)
          { res.status(400).json({ error: 'Целевой этап не принадлежит выбранной воронке' }); return; }
        upd.target_funnel_id = funnelId;
        upd.target_stage_id  = stageId;
      }
      if (b.mode !== undefined) {
        if (!VALID_MODES.has(b.mode as string)) { res.status(400).json({ error: 'Неверный режим' }); return; }
        upd.mode = b.mode;
      }
      if (b.match !== undefined) {
        if (!VALID_MATCH.has(b.match as string)) { res.status(400).json({ error: 'Неверный тип совпадения' }); return; }
        upd.match = b.match;
      }
      if (b.conditions !== undefined) {
        const err = validateConditions(b.conditions);
        if (err) { res.status(400).json({ error: err }); return; }
        upd.conditions = b.conditions;
      }
      if (b.source_scope !== undefined) upd.source_scope = b.source_scope;
      if (b.actions !== undefined)      upd.actions      = b.actions;

      if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нечего обновлять' }); return; }
      const { error } = await supabase.from('crm_automation_rules')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('automation_rule', req.params.id, 'update', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/automation/rules/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    try {
      const { error } = await supabase.from('crm_automation_rules')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await writeAudit('automation_rule', req.params.id, 'delete', session.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/automation/rules/:id/preview', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'view', session)) return;
    try {
      const { data: ruleRow } = await supabase.from('crm_automation_rules')
        .select('target_stage_id,source_scope').eq('id', req.params.id).eq('branch_id', BRANCH_ID).maybeSingle();
      const result = await runAutomation({ ruleId: req.params.id, dry: true });
      const leads = result.previewLeads ?? [];

      let already_on_target = 0;
      let no_client_or_visit = 0;
      if (ruleRow) {
        const rule = ruleRow as { target_stage_id: string; source_scope: { funnel_ids?: string[]; stage_ids?: string[] } };
        const srcFunnels = rule.source_scope?.funnel_ids ?? [];
        const srcStages  = rule.source_scope?.stage_ids ?? [];

        let atQ = supabase.from('crm_leads')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', BRANCH_ID).eq('is_archived', false).eq('stage_id', rule.target_stage_id);
        if (srcFunnels.length) atQ = atQ.in('funnel_id', srcFunnels);

        let ncQ = supabase.from('crm_leads')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', BRANCH_ID).eq('is_archived', false).is('client_id', null);
        if (srcFunnels.length) ncQ = ncQ.in('funnel_id', srcFunnels);
        if (srcStages.length)  ncQ = ncQ.in('stage_id',  srcStages);

        const [atRes, ncRes] = await Promise.all([atQ, ncQ]);
        already_on_target  = atRes.count ?? 0;
        no_client_or_visit = ncRes.count ?? 0;
      }

      res.json({ total: leads.length, items: leads.slice(0, 100), already_on_target, no_client_or_visit });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Run now ───────────────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/automation/run', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'edit', session)) return;
    res.status(202).json({ ok: true, status: 'accepted' });
    runAutomation().catch(console.error);
  });

  // ── Log ───────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/automation/log', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!requirePerm(req, res, 'settings.automation', 'view', session)) return;
    try {
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      let q = supabase.from('crm_automation_log')
        .select('id,rule_id,rule_name,lead_id,lead_title,client_id,action,mode,from_stage_id,from_funnel_id,to_stage_id,to_funnel_id,skip_reason,created_at')
        .eq('branch_id', BRANCH_ID).order('created_at', { ascending: false }).limit(limit);
      if (req.query.rule_id) q = q.eq('rule_id', String(req.query.rule_id));
      if (req.query.mode)    q = q.eq('mode', String(req.query.mode));
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
