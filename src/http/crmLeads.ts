import { Router } from 'express';
import { supabase } from '../db/supabase';
import { getSession, requireAuth, requireAdmin } from './auth';
import { runCrmLeadsSync, isFitbaseSyncEnabled } from '../jobs/crmLeadsSync';
import { acquireLock, releaseLock } from '../core/lock';
import { rawGet, paginateGet } from './fitbase';
import { runLeadRules } from '../core/leadRules';
import { STAGE_CONTENT } from '../core/leadStageContent';
import { answerRowsToAnswers, computeResult, CONTRAINDICATIONS, HINTS, type AnswerRow } from '../core/qualifyCatalog';
import { evalShowIf, type ShowIfCond } from '../core/checklistRules';
import type { Request, Response } from 'express';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const JOB = 'crm-leads-sync';

function todayUtc5(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function normPhone(raw: unknown): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return d;
  if (d.length === 10) return '7' + d;
  return null;
}

async function writeActivity(leadId: string, kind: string, text: string, author: string, meta?: Record<string, unknown>) {
  await supabase.from('crm_lead_activity').insert({ branch_id: BRANCH_ID, lead_id: leadId, kind, text, author, meta: meta ?? {} });
}

// In-memory sync status
let syncStatus: { status: string; result?: Record<string, unknown>; error?: string; started_at?: string; finished_at?: string } = { status: 'idle' };

async function runSyncBg(): Promise<void> {
  const locked = await acquireLock(JOB, 10 * 60);
  if (!locked) { syncStatus = { ...syncStatus, status: 'already_running' }; return; }
  syncStatus = { status: 'running', started_at: new Date().toISOString() };
  try {
    const result = await runCrmLeadsSync();
    syncStatus = { status: 'done', result, started_at: syncStatus.started_at, finished_at: new Date().toISOString() };
  } catch (e) {
    syncStatus = { status: 'error', error: String(e), started_at: syncStatus.started_at, finished_at: new Date().toISOString() };
    console.error('[crm-leads-sync] error:', e);
  } finally {
    await releaseLock(JOB);
  }
}

export function buildCrmLeadsRouter(): Router {
  const r = Router();

  // ── Sync ─────────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads-sync', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const enabled = await isFitbaseSyncEnabled().catch(() => false);
    res.json({ ...syncStatus, enabled });
  });

  r.post('/kviz/api/crm/leads-sync', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const enabled = await isFitbaseSyncEnabled().catch(() => false);
    if (!enabled) { res.status(403).json({ error: 'sync_disabled' }); return; }
    runSyncBg().catch(console.error);
    res.json({ ok: true, status: syncStatus.status });
  });

  // Canonical aliases (must be before /:id routes)
  r.get('/kviz/api/crm/leads/sync/status', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const enabled = await isFitbaseSyncEnabled().catch(() => false);
    res.json({ ...syncStatus, enabled });
  });

  r.post('/kviz/api/crm/leads/sync', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const enabled = await isFitbaseSyncEnabled().catch(() => false);
    if (!enabled) { res.status(403).json({ error: 'sync_disabled' }); return; }
    if (syncStatus.status === 'running') { res.status(409).json({ error: 'Синхронизация уже идёт' }); return; }
    runSyncBg().catch(console.error);
    res.json({ ok: true, status: 'running' });
  });

  // Sync settings (admin): toggle fitbase sync flag
  r.patch('/kviz/api/crm/settings/sync', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const enabled = Boolean((req.body as Record<string, unknown>).enabled);
      if (enabled) { res.status(409).json({ error: 'Включение синхронизации отключено — воронки ведутся в своей CRM' }); return; }
      await supabase.from('crm_settings')
        .upsert({ key: 'leads.fitbase_sync_enabled', value: false }, { onConflict: 'key' });
      res.json({ ok: true, enabled: false });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Funnels ───────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/funnels', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const [{ data: funnels, error }, { data: stages }, { data: leadRows }] = await Promise.all([
        supabase.from('crm_funnels').select('*').eq('branch_id', BRANCH_ID).order('sort').order('name'),
        supabase.from('crm_funnel_stages').select('*').eq('branch_id', BRANCH_ID).order('sort').order('name'),
        supabase.from('crm_leads').select('stage_id').eq('branch_id', BRANCH_ID).eq('is_archived', false),
      ]);
      if (error) { res.status(500).json({ error: error.message }); return; }

      const countByStage = new Map<string, number>();
      for (const l of leadRows || []) {
        const sid = (l as Record<string, unknown>).stage_id as string;
        if (sid) countByStage.set(sid, (countByStage.get(sid) ?? 0) + 1);
      }

      const stagesByFunnel = new Map<string, unknown[]>();
      const systemStages: unknown[] = [];
      for (const s of stages || []) {
        const st = s as Record<string, unknown>;
        const fid = st.funnel_id as string | null;
        const withCount = { ...st, leads_count: countByStage.get(st.id as string) ?? 0 };
        if (fid) {
          if (!stagesByFunnel.has(fid)) stagesByFunnel.set(fid, []);
          stagesByFunnel.get(fid)!.push(withCount);
        } else {
          systemStages.push(withCount);
        }
      }

      // system stages (funnel_id IS NULL: inbox/success/fail) are included in every active funnel
      res.json((funnels || []).map(f => ({
        ...f,
        stages: [...systemStages, ...(stagesByFunnel.get((f as Record<string, unknown>).id as string) ?? [])],
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/funnels', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название воронки' }); return; }
      const { data, error } = await supabase.from('crm_funnels').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), sort: Number(b.sort ?? 0), is_active: true,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Reorder endpoints — must be before /:id to avoid route conflict
  r.patch('/kviz/api/crm/funnels/reorder', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const order = (req.body as Record<string, unknown>).order as string[];
      if (!Array.isArray(order)) { res.status(400).json({ error: 'order: array of ids' }); return; }
      for (let i = 0; i < order.length; i++) {
        await supabase.from('crm_funnels').update({ sort: i }).eq('id', order[i]).eq('branch_id', BRANCH_ID);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/funnel-stages/reorder', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const order = (req.body as Record<string, unknown>).order as string[];
      if (!Array.isArray(order)) { res.status(400).json({ error: 'order: array of ids' }); return; }
      for (let i = 0; i < order.length; i++) {
        await supabase.from('crm_funnel_stages').update({ sort: i }).eq('id', order[i]).eq('branch_id', BRANCH_ID);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/funnels/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      if (b.hidden_system_kinds !== undefined) {
        const v = b.hidden_system_kinds as string[];
        const VALID = ['inbox', 'success', 'fail'];
        if (!Array.isArray(v) || !v.every(k => VALID.includes(k))) {
          res.status(400).json({ error: 'hidden_system_kinds: допустимые значения inbox, success, fail' }); return;
        }
        upd.hidden_system_kinds = v;
      }
      const { data, error } = await supabase.from('crm_funnels')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Reset stage content from STAGE_CONTENT table (admin)
  r.post('/kviz/api/crm/funnels/:id/reset-content', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: stages } = await supabase.from('crm_funnel_stages')
        .select('id,name,kind,funnel_id').eq('branch_id', BRANCH_ID)
        .or(`funnel_id.eq.${req.params.id},funnel_id.is.null`);
      const updated: string[] = [];
      for (const s of (stages || [])) {
        const st = s as Record<string, unknown>;
        const content = STAGE_CONTENT.find(c =>
          st.kind === 'inbox'   ? c.scope === 'inbox' :
          st.kind === 'fail'    ? c.scope === 'fail' :
          st.kind === 'success' ? c.scope === 'success' :
          c.name.toLowerCase() === (st.name as string).toLowerCase()
        );
        if (!content) continue;
        await supabase.from('crm_funnel_stages').update({
          helper: content.helper,
          require_comment: content.require_comment,
          checklist: content.items,
        }).eq('id', st.id).eq('branch_id', BRANCH_ID);
        updated.push(st.name as string);
      }
      res.json({ ok: true, updated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/funnels/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { count } = await supabase.from('crm_leads')
        .select('id', { count: 'exact', head: true })
        .eq('funnel_id', req.params.id).eq('is_archived', false).eq('branch_id', BRANCH_ID);

      const move_funnel_id = (req.body as Record<string, unknown>)?.move_funnel_id as string | undefined;
      if (count && count > 0) {
        if (!move_funnel_id) {
          res.status(409).json({ error: `В воронке ${count} активных заявок — укажите move_funnel_id для переноса` }); return;
        }
        const { data: inboxStage } = await supabase.from('crm_funnel_stages')
          .select('id').eq('branch_id', BRANCH_ID).eq('kind', 'inbox').is('funnel_id', null).maybeSingle();
        if (!inboxStage) { res.status(422).json({ error: 'inbox_stage_not_found' }); return; }
        await supabase.from('crm_leads')
          .update({ funnel_id: move_funnel_id, stage_id: (inboxStage as Record<string, unknown>).id })
          .eq('funnel_id', req.params.id).eq('is_archived', false).eq('branch_id', BRANCH_ID);
      }

      await supabase.from('crm_funnel_stages').delete().eq('funnel_id', req.params.id).eq('branch_id', BRANCH_ID);
      const { error } = await supabase.from('crm_funnels').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Funnel stages PATCH/POST/DELETE (admin)
  r.post('/kviz/api/crm/funnel-stages', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name || !b.funnel_id) { res.status(400).json({ error: 'Укажите название и воронку' }); return; }
      const { data, error } = await supabase.from('crm_funnel_stages').insert({
        branch_id: BRANCH_ID, funnel_id: b.funnel_id, name: String(b.name).trim(),
        kind: 'normal', sort: Number(b.sort ?? 0), is_archived: false, is_personal: false,
        color: (b.color as string | null) ?? null, background_color: (b.background_color as string | null) ?? null,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/funnel-stages/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name             !== undefined) upd.name             = String(b.name).trim();
      if (b.sort             !== undefined) upd.sort             = Number(b.sort);
      if (b.is_archived      !== undefined) upd.is_archived      = Boolean(b.is_archived);
      if (b.color            !== undefined) upd.color            = b.color ?? null;
      if (b.background_color !== undefined) upd.background_color = b.background_color ?? null;
      if (b.memo             !== undefined) {
        const m = b.memo ? String(b.memo) : null;
        if (m && m.length > 1000) { res.status(400).json({ error: 'memo не более 1000 символов' }); return; }
        upd.memo = m;
      }
      if (b.action_label !== undefined) {
        const al = String(b.action_label ?? '').trim();
        if (!al || al.length > 30) { res.status(400).json({ error: 'action_label: 1–30 символов' }); return; }
        upd.action_label = al;
      }
      if (b.helper !== undefined) {
        const h = b.helper as Record<string, unknown>;
        for (const k of ['manager', 'transition', 'important', 'agent']) {
          if (h[k] !== undefined && h[k] !== null && String(h[k]).length > 4000) {
            res.status(400).json({ error: `helper.${k} не более 4000 символов` }); return;
          }
        }
        upd.helper = { manager: h.manager ?? null, transition: h.transition ?? null, important: h.important ?? null, agent: h.agent ?? null };
      }
      if (b.require_comment !== undefined) upd.require_comment = Boolean(b.require_comment);
      if (b.checklist !== undefined) {
        if (!Array.isArray(b.checklist)) { res.status(400).json({ error: 'checklist должен быть массивом' }); return; }
        if (b.checklist.length > 25) { res.status(400).json({ error: 'checklist не более 25 пунктов' }); return; }
        const VALID_TYPES = ['question', 'check', 'text', 'comment', 'multi', 'number', 'date'];
        const keys = new Set<string>();
        for (const item of b.checklist) {
          const it = item as Record<string, unknown>;
          if (!it.key || String(it.key).length > 50) { res.status(400).json({ error: 'key: 1–50 символов' }); return; }
          if (keys.has(it.key as string)) { res.status(400).json({ error: `key «${it.key}» повторяется` }); return; }
          keys.add(it.key as string);
          if (!VALID_TYPES.includes(it.type as string)) { res.status(400).json({ error: 'type: question|check|text|comment|multi|number|date' }); return; }
          if (!it.label || String(it.label).length > 200) { res.status(400).json({ error: 'label: 1–200 символов' }); return; }
          if (it.hint !== undefined && it.hint !== null && String(it.hint).length > 500) { res.status(400).json({ error: 'hint: до 500 символов' }); return; }
          if (it.who !== 'human' && it.who !== 'auto') { res.status(400).json({ error: 'who: human или auto' }); return; }
          if (it.type === 'question' || it.type === 'multi') {
            if (!Array.isArray(it.options) || (it.options as unknown[]).length > 25) {
              res.status(400).json({ error: `options: массив до 25 вариантов для ${it.type}` }); return;
            }
          }
          if (it.type === 'multi' && it.none_option != null) {
            const opts = it.options as unknown[] ?? [];
            const optIds = opts.map(o => typeof o === 'string' ? o : (o as Record<string,unknown>).id);
            if (!optIds.includes(it.none_option)) {
              res.status(400).json({ error: `none_option «${it.none_option}» не найден в options` }); return;
            }
          }
          if (it.show_if) {
            const sf = it.show_if as Record<string, unknown>;
            const VALID_OPS = ['eq','neq','contains','not_contains','not_none','in','gte','lte'];
            if (!sf.key || !VALID_OPS.includes(sf.op as string)) {
              res.status(400).json({ error: 'show_if: нужны key и op' }); return;
            }
          }
        }
        upd.checklist = (b.checklist as Record<string, unknown>[]).map(it => {
          const mapped: Record<string, unknown> = {
            key: it.key, block: it.block ?? '', type: it.type, label: it.label,
            required: Boolean(it.required), who: it.who,
          };
          if (it.hint) mapped.hint = it.hint;
          if (it.type === 'question' || it.type === 'multi') mapped.options = it.options ?? [];
          if (it.who === 'auto' && it.rule) mapped.rule = it.rule;
          if (it.show_if) mapped.show_if = it.show_if;
          if (it.none_option != null) mapped.none_option = it.none_option;
          if (it.min != null) mapped.min = Number(it.min);
          if (it.max != null) mapped.max = Number(it.max);
          if (it.allow_other) mapped.allow_other = true;
          return mapped;
        });
      }
      const { data, error } = await supabase.from('crm_funnel_stages')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/funnel-stages/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: stage } = await supabase.from('crm_funnel_stages')
        .select('kind').eq('id', req.params.id).eq('branch_id', BRANCH_ID).maybeSingle();
      if (!stage) { res.status(404).json({ error: 'Этап не найден' }); return; }
      if ((stage as Record<string, unknown>).kind !== 'normal') {
        res.status(409).json({ error: 'Системный этап нельзя удалить — его можно скрыть в настройках воронки' }); return;
      }

      const { count } = await supabase.from('crm_leads')
        .select('id', { count: 'exact', head: true }).eq('stage_id', req.params.id).eq('branch_id', BRANCH_ID);
      const move_to = (req.body as Record<string, unknown>)?.move_to as string | undefined;
      if (count && count > 0) {
        if (!move_to) {
          res.status(409).json({ error: `Этап используется в ${count} заявках — укажите move_to для переноса`, leads_count: count }); return;
        }
        await supabase.from('crm_leads').update({ stage_id: move_to })
          .eq('stage_id', req.params.id).eq('branch_id', BRANCH_ID);
      }

      const { error } = await supabase.from('crm_funnel_stages')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Hints catalog ────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/hints', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const stage = req.query.stage as string | undefined;
    if (!stage) { res.json([]); return; }
    res.json(HINTS.filter(h => h.stage === stage));
  });

  // ── Leads ─────────────────────────────────────────────────────────────────────

  r.post('/kviz/api/crm/leads/bulk-move', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const lead_ids = b.lead_ids as string[];
      const stage_id = b.stage_id as string;
      const funnel_id = b.funnel_id as string;
      if (!Array.isArray(lead_ids) || !lead_ids.length || !stage_id || !funnel_id) {
        res.status(400).json({ error: 'Нужны lead_ids, stage_id, funnel_id' }); return;
      }
      for (let i = 0; i < lead_ids.length; i += 100) {
        await supabase.from('crm_leads')
          .update({ stage_id, funnel_id })
          .in('id', lead_ids.slice(i, i + 100)).eq('branch_id', BRANCH_ID);
      }
      res.json({ ok: true, moved: lead_ids.length });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/leads', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_leads').select('*').eq('branch_id', BRANCH_ID);
      if (req.query.funnel_id)        q = q.eq('funnel_id',        req.query.funnel_id        as string);
      if (req.query.stage_id)         q = q.eq('stage_id',         req.query.stage_id         as string);
      if (!req.query.is_archived || req.query.is_archived === '0') q = q.eq('is_archived', false);
      if (req.query.manager_user_id)  q = q.eq('manager_user_id',  req.query.manager_user_id  as string);
      if (req.query.ad_source_id)     q = q.eq('ad_source_id',     req.query.ad_source_id     as string);
      if (req.query.tag)              q = q.contains('tags', [req.query.tag as string]);
      if (req.query.created_from)     q = q.gte('fb_created_at',   req.query.created_from     as string);
      if (req.query.created_to)       q = q.lte('fb_created_at',   (req.query.created_to as string) + 'T23:59:59Z');
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        q = q.or(`name.ilike.${s},surname.ilike.${s},phone.ilike.${s},title.ilike.${s}`);
      }
      const { data: leads, error } = await q.order('fb_created_at', { ascending: false }).limit(1000);
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Compute is_overdue from tasks + qualify_temperature from answers
      const ids = (leads || []).map(l => (l as Record<string, unknown>).id as string);
      let overdueSet = new Set<string>();
      const tempMap = new Map<string, string>();
      if (ids.length) {
        const [{ data: td }, { data: allAnswers }] = await Promise.all([
          supabase.from('crm_lead_tasks').select('lead_id').in('lead_id', ids).eq('status', 'open').eq('is_overdue', true),
          supabase.from('crm_lead_answers').select('lead_id,item_key,kind,answer_option,answer_text').in('lead_id', ids).eq('branch_id', BRANCH_ID),
        ]);
        overdueSet = new Set((td || []).map(t => (t as Record<string, unknown>).lead_id as string));
        const answersByLead = new Map<string, AnswerRow[]>();
        for (const a of (allAnswers ?? [])) {
          const r2 = a as Record<string, unknown>;
          const lid = r2.lead_id as string;
          if (!answersByLead.has(lid)) answersByLead.set(lid, []);
          answersByLead.get(lid)!.push(a as unknown as AnswerRow);
        }
        for (const [lid, rows] of answersByLead) {
          const qa = answerRowsToAnswers(rows);
          tempMap.set(lid, computeResult(qa).temperature);
        }
      }

      res.json((leads || []).map(l => ({
        ...l,
        is_overdue: overdueSet.has((l as Record<string, unknown>).id as string),
        qualify_temperature: tempMap.get((l as Record<string, unknown>).id as string) ?? null,
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/leads', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const name = String(b.name ?? '').trim();
      if (!name) { res.status(400).json({ error: 'Укажите имя' }); return; }
      const phone = normPhone(b.phone);
      if (!phone) { res.status(400).json({ error: 'Укажите корректный номер телефона' }); return; }

      // Find active funnel "Новые заявки"
      const { data: funnels } = await supabase.from('crm_funnels')
        .select('id,name').eq('branch_id', BRANCH_ID).eq('is_active', true);
      const funnel = (funnels || []).find(f => (f as Record<string, unknown>).name as string ? ((f as Record<string, unknown>).name as string).toLowerCase().includes('новые заявки') : false);
      if (!funnel) { res.status(422).json({ error: 'funnel_not_found' }); return; }

      // Find system inbox stage (kind='inbox', funnel_id IS NULL)
      const { data: inboxStage } = await supabase.from('crm_funnel_stages')
        .select('id').eq('branch_id', BRANCH_ID).eq('kind', 'inbox').is('funnel_id', null).maybeSingle();
      if (!inboxStage) { res.status(422).json({ error: 'inbox_stage_not_found' }); return; }

      // Duplicate check: non-archived lead with same phone
      if (!b.force) {
        const { data: dup } = await supabase.from('crm_leads')
          .select('id').eq('branch_id', BRANCH_ID).eq('phone', phone).eq('is_archived', false).maybeSingle();
        if (dup) { res.status(409).json({ error: 'duplicate', lead_id: (dup as Record<string, unknown>).id }); return; }
      }

      const surname = String(b.surname ?? '').trim();
      const title = [name, surname].filter(Boolean).join(' ');
      const funnelId = (funnel as Record<string, unknown>).id as string;
      const stageId = (inboxStage as Record<string, unknown>).id as string;

      const { data, error } = await supabase.from('crm_leads').insert({
        branch_id: BRANCH_ID, origin: 'manual', fitbase_id: null,
        title, name, surname: surname || null, phone,
        funnel_id: funnelId, stage_id: stageId,
        budget: '0', tags: [], custom_fields: {},
        fb_created_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      const leadId = (data as Record<string, unknown>).id as string;
      await writeActivity(leadId, 'created', 'Заявка создана вручную', session.display_name);
      runLeadRules({ type: 'lead_created', leadId }).catch(console.error);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Check phone duplicates (before /:id to avoid route conflict) ───────────────
  r.get('/kviz/api/crm/leads/check-phone', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const phone = normPhone(String(req.query.phone ?? ''));
    if (!phone) { res.json({ leads: [], clients: [] }); return; }
    try {
      const [leadsRes, clientsRes] = await Promise.all([
        supabase.from('crm_leads')
          .select('id,title,name,surname,stage_id,funnel_id,manager_user_id,fitbase_manager_name')
          .eq('branch_id', BRANCH_ID).eq('phone', phone).eq('is_archived', false).limit(5),
        supabase.from('crm_clients')
          .select('id,full_name,phone').eq('branch_id', BRANCH_ID).eq('phone', phone).eq('is_deleted', false).limit(5),
      ]);
      if (leadsRes.error) console.error('[check-phone] leads:', leadsRes.error.message);
      if (clientsRes.error) console.error('[check-phone] clients:', clientsRes.error.message);
      res.json({ leads: leadsRes.data || [], clients: clientsRes.data || [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const [{ data, error }, { data: ansRows }] = await Promise.all([
        supabase.from('crm_leads').select('*').eq('id', req.params.id).eq('branch_id', BRANCH_ID).single(),
        supabase.from('crm_lead_answers').select('item_key,kind,answer_option,answer_text')
          .eq('branch_id', BRANCH_ID).eq('lead_id', req.params.id),
      ]);
      if (error || !data) { res.status(404).json({ error: 'Не найдено' }); return; }
      let qualify = null;
      if (ansRows && ansRows.length > 0) {
        const qa = answerRowsToAnswers(ansRows as unknown as AnswerRow[]);
        const qr = computeResult(qa);
        qualify = { score: qr.score, temperature: qr.temperature, warnings: qr.warnings, flags: qr.flags };
      }
      res.json({ ...data, qualify });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const stringFields = ['title', 'name', 'surname', 'patronymic', 'email', 'instagram', 'telegram', 'description', 'budget', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_term', 'utm_content', 'lost_comment'];
      for (const f of stringFields) if (b[f] !== undefined) upd[f] = b[f] ?? null;
      if (b.phone       !== undefined) {
        const p = b.phone as string | null;
        if (p) { let d = p.replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); upd.phone = d.length === 11 && d[0] === '7' ? d : d.length === 10 ? '7' + d : null; }
        else upd.phone = null;
      }
      if (b.funnel_id       !== undefined) upd.funnel_id       = b.funnel_id ?? null;
      if (b.stage_id        !== undefined) upd.stage_id        = b.stage_id  ?? null;
      if (b.stage_id        !== undefined) upd.stage_changed_at = new Date().toISOString();
      if (b.ad_source_id    !== undefined) upd.ad_source_id    = b.ad_source_id ?? null;
      if (b.manager_user_id !== undefined) upd.manager_user_id = b.manager_user_id ?? null;
      if (b.client_id       !== undefined) upd.client_id       = b.client_id ?? null;
      if (b.lost_reason_id  !== undefined) upd.lost_reason_id  = b.lost_reason_id ?? null;
      if (b.is_archived     !== undefined) upd.is_archived     = Boolean(b.is_archived);
      if (b.is_archived === true)          upd.archived_at     = new Date().toISOString();
      if (b.tags            !== undefined) upd.tags            = Array.isArray(b.tags) ? b.tags : [];
      if (b.is_duplicate    !== undefined) upd.is_duplicate    = Boolean(b.is_duplicate);

      const { data, error } = await supabase.from('crm_leads')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Record stage change in activity
      if (b.stage_id !== undefined) {
        const { data: stage } = await supabase.from('crm_funnel_stages').select('name').eq('id', b.stage_id as string).single();
        await writeActivity(req.params.id, 'stage_change', `Этап → ${stage?.name ?? 'Unknown'}`, session.display_name);
      }

      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/leads/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_leads')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead activity ─────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads/:id/activity', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const [{ data: acts, error }, { data: ans }] = await Promise.all([
        supabase.from('crm_lead_activity').select('*').eq('branch_id', BRANCH_ID).eq('lead_id', req.params.id)
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('crm_lead_answers').select('*').eq('branch_id', BRANCH_ID).eq('lead_id', req.params.id)
          .order('created_at', { ascending: false }).limit(500),
      ]);
      if (error) { res.status(500).json({ error: error.message }); return; }
      // group answers by move_activity_id, expose as kind='answer'
      const answersByMove = new Map<string, unknown[]>();
      for (const a of (ans || [])) {
        const r2 = a as Record<string, unknown>;
        const mid = (r2.move_activity_id ?? 'standalone') as string;
        if (!answersByMove.has(mid)) answersByMove.set(mid, []);
        answersByMove.get(mid)!.push(a);
      }
      const result: unknown[] = [...(acts || [])];
      for (const [mid, items] of answersByMove) {
        if (mid === 'standalone') {
          result.push({ id: `ans-standalone`, kind: 'answer', created_at: (items[0] as Record<string,unknown>).created_at, items });
        }
      }
      result.sort((a, b) => {
        const ta = (a as Record<string,unknown>).created_at as string;
        const tb = (b as Record<string,unknown>).created_at as string;
        return tb.localeCompare(ta);
      });
      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/leads/:id/activity', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.text) { res.status(400).json({ error: 'Укажите текст' }); return; }
      const { data, error } = await supabase.from('crm_lead_activity').insert({
        branch_id: BRANCH_ID, lead_id: req.params.id,
        kind: 'comment', text: String(b.text), author: session.display_name, meta: {},
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead move (stage change with optional lost reason) ────────────────────────

  r.post('/kviz/api/crm/leads/:id/move', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.stage_id) { res.status(400).json({ error: 'Укажите этап' }); return; }

      const { data: stage } = await supabase.from('crm_funnel_stages')
        .select('id,name,kind,funnel_id,checklist,require_comment').eq('id', b.stage_id as string).single();
      if (!stage) { res.status(400).json({ error: 'Этап не найден' }); return; }

      const st = stage as Record<string, unknown>;
      if (st.kind === 'fail' && !b.lost_reason_id) {
        res.status(400).json({ error: 'Укажите причину отказа' }); return;
      }

      // Build answer lookups for show_if evaluation and validation
      const checklist = (st.checklist as null | Record<string, unknown>[]) ?? [];
      const answers   = Array.isArray(b.answers) ? (b.answers as Record<string, unknown>[]) : [];
      const answerByKey  = new Map<string, { option: string; text: string }>();
      const multiByKey   = new Map<string, Set<string>>();
      for (const a of answers) {
        const key  = String(a.item_key ?? '');
        const kind = String(a.kind ?? '');
        if (kind === 'multi') {
          if (!multiByKey.has(key)) multiByKey.set(key, new Set());
          if (a.answer_option) multiByKey.get(key)!.add(String(a.answer_option));
        } else {
          answerByKey.set(key, { option: String(a.answer_option ?? ''), text: String(a.answer_text ?? '') });
        }
      }
      // Build none_option map for not_none evaluation
      const noneByKey = new Map<string, string | null>();
      for (const it of checklist) {
        const val = it.none_option;
        if (!val) continue;
        noneByKey.set(it.key as string, typeof val === 'boolean' ? '__none__' : String(val));
      }

      // Validate required items (only visible ones — respecting show_if)
      const answeredKeys = new Set([...answerByKey.keys(), ...multiByKey.keys()]);
      const missing = checklist.filter(it => {
        if (!it.required || it.who === 'auto') return false;
        if (it.show_if && !evalShowIf(it.show_if as ShowIfCond, answerByKey, multiByKey, noneByKey)) return false;
        if (it.type === 'multi') return (multiByKey.get(it.key as string)?.size ?? 0) === 0;
        return !answeredKeys.has(it.key as string);
      }).map(it => it.key as string);
      if (missing.length) {
        res.status(400).json({ error: 'required_missing', missing }); return;
      }
      if (st.require_comment && !String(b.comment ?? '').trim()) {
        res.status(400).json({ error: 'comment_required' }); return;
      }

      // Check stop contraindications — require bant_contra_warned acknowledgment
      const stopIds = new Set(CONTRAINDICATIONS.stop.map(c => c.id));
      const contraSelected = Array.from(multiByKey.get('bant_contra') ?? []);
      if (contraSelected.some(id => stopIds.has(id)) && !b.bant_contra_warned) {
        res.status(400).json({ error: 'contra_stop', items: contraSelected.filter(id => stopIds.has(id)) }); return;
      }

      // Validate number item ranges
      for (const a of answers) {
        const key = String(a.item_key ?? '');
        if (!a.answer_text) continue;
        const item = checklist.find(it => it.key === key) as Record<string, unknown> | undefined;
        if (!item || item.type !== 'number') continue;
        const val = Number(a.answer_text);
        if (isNaN(val)) { res.status(400).json({ error: `${item.label}: введите число` }); return; }
        if (item.min != null && val < (item.min as number)) { res.status(400).json({ error: `${item.label}: минимум ${item.min}` }); return; }
        if (item.max != null && val > (item.max as number)) { res.status(400).json({ error: `${item.label}: максимум ${item.max}` }); return; }
      }

      const upd: Record<string, unknown> = {
        stage_id: b.stage_id,
        funnel_id: st.funnel_id ?? null,
        stage_changed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (b.lost_reason_id !== undefined) upd.lost_reason_id = b.lost_reason_id ?? null;
      if (b.lost_comment   !== undefined) upd.lost_comment   = b.lost_comment   ?? null;

      const { data, error } = await supabase.from('crm_leads')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      const stageName = st.name as string;
      const { data: actRow } = await supabase.from('crm_lead_activity').insert({
        branch_id: BRANCH_ID, lead_id: req.params.id,
        kind: 'stage_change', text: `Этап → ${stageName}`, author: session.display_name, meta: {},
      }).select('id').single();

      if (b.comment && String(b.comment).trim()) {
        await writeActivity(req.params.id, 'comment', String(b.comment).trim(), session.display_name);
      }

      // Write answers
      if (answers.length) {
        const moveActId = (actRow as Record<string, unknown> | null)?.id as string | null;
        const rows = answers.map(a => ({
          branch_id: BRANCH_ID, lead_id: req.params.id, stage_id: b.stage_id as string,
          move_activity_id: moveActId ?? null,
          item_key: String(a.item_key ?? ''), kind: String(a.kind ?? ''),
          answer_option: (a.answer_option as string | null) ?? null,
          answer_text:   (a.answer_text   as string | null) ?? null,
          author: session.display_name,
        }));
        await supabase.from('crm_lead_answers').insert(rows);
      }

      // Auto-move: "Не удобно говорить" in inbox → "Отложенное решение" + "Перезвонить" task
      const notConvenient = answers.find(
        a => a.item_key === 'inbox_contact_result' && a.answer_option === 'not_convenient',
      );
      if (notConvenient && st.kind === 'inbox') {
        try {
          const { data: delayStage } = await supabase.from('crm_funnel_stages')
            .select('id,name,funnel_id').eq('branch_id', BRANCH_ID)
            .ilike('name', '%отложен%').maybeSingle();
          if (delayStage) {
            const ds = delayStage as Record<string, unknown>;
            await supabase.from('crm_leads').update({
              stage_id: ds.id, funnel_id: ds.funnel_id ?? (st.funnel_id ?? null),
              stage_changed_at: new Date().toISOString(),
            }).eq('id', req.params.id).eq('branch_id', BRANCH_ID);
            await writeActivity(req.params.id, 'stage_change',
              `Этап → ${ds.name} [авто: не удобно говорить]`, 'Автоматика');
            const { data: leadRow } = await supabase.from('crm_leads')
              .select('manager_user_id').eq('id', req.params.id).single();
            const { data: callType } = await supabase.from('crm_task_types')
              .select('id').eq('branch_id', BRANCH_ID).ilike('name', '%Звонок%').limit(1).maybeSingle();
            const tomorrow = new Date(Date.now() + 5 * 3600_000);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(5, 0, 0, 0); // 10:00 UTC+5
            await supabase.from('crm_lead_tasks').insert({
              branch_id: BRANCH_ID, lead_id: req.params.id,
              type_id: (callType as Record<string, unknown> | null)?.id ?? null,
              description: '[АВТО] Перезвонить (не удобно говорить)',
              due_at: tomorrow.toISOString(), status: 'open',
              created_by: null,
              responsible_user_id: (leadRow as Record<string, unknown> | null)?.manager_user_id ?? null,
              fitbase_responsible: [],
            });
            await writeActivity(req.params.id, 'task', '[АВТО] Перезвонить (не удобно говорить)', 'Автоматика');
          }
        } catch (e) { console.error('[move] not_convenient auto-move:', e); }
      }

      runLeadRules({ type: 'stage_enter', leadId: req.params.id, stageId: b.stage_id as string }).catch(console.error);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead answers ──────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads/:id/answers', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_lead_answers').select('*')
        .eq('branch_id', BRANCH_ID).eq('lead_id', req.params.id)
        .order('created_at', { ascending: false }).limit(500);
      if (req.query.stage_id) q = q.eq('stage_id', req.query.stage_id as string);
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/leads/:id/answers', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const answers = Array.isArray(b.answers) ? (b.answers as Record<string, unknown>[]) : [];
      if (!answers.length) { res.status(400).json({ error: 'Нет ответов' }); return; }
      const stageId = b.stage_id as string | null ?? null;
      const rows = answers.map(a => ({
        branch_id: BRANCH_ID, lead_id: req.params.id, stage_id: stageId,
        move_activity_id: null, item_key: String(a.item_key ?? ''), kind: String(a.kind ?? ''),
        answer_option: (a.answer_option as string | null) ?? null,
        answer_text:   (a.answer_text   as string | null) ?? null,
        author: session.display_name,
      }));
      const { data, error } = await supabase.from('crm_lead_answers').insert(rows).select();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead Fitbase notes ────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/leads/:id/notes', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data: lead } = await supabase.from('crm_leads')
        .select('fitbase_client_id').eq('id', req.params.id).eq('branch_id', BRANCH_ID).single();
      if (!lead || !(lead as Record<string, unknown>).fitbase_client_id) { res.json([]); return; }
      const clientId = Number((lead as Record<string, unknown>).fitbase_client_id);
      const notes = await paginateGet(`/note`, { client_id: clientId, page_size: 100 }, 'crm-lead-notes');
      res.json(notes);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead tasks ────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lead-tasks', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      let q = supabase.from('crm_lead_tasks').select(`
        *,
        crm_leads(id, title, name, surname, funnel_id, stage_id,
          crm_funnels(name),
          crm_funnel_stages(name)
        ),
        crm_task_types(id, name)
      `).eq('branch_id', BRANCH_ID);

      if (req.query.lead_id)              q = q.eq('lead_id', req.query.lead_id as string);
      if (req.query.status)               q = q.eq('status', req.query.status as string);
      if (req.query.responsible_user_id)  q = q.eq('responsible_user_id', req.query.responsible_user_id as string);
      if (req.query.today === '1' || req.query.today === 'true') {
        const today = todayUtc5();
        q = q.lte('due_at', today + 'T23:59:59Z').eq('status', 'open');
      }
      const { data, error } = await q.order('due_at').limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lead-tasks', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.lead_id && !b.client_id) { res.status(400).json({ error: 'Нужен lead_id или client_id' }); return; }
      if (!b.description) { res.status(400).json({ error: 'Укажите описание задачи' }); return; }
      const { data, error } = await supabase.from('crm_lead_tasks').insert({
        branch_id:  BRANCH_ID,
        lead_id:    (b.lead_id    as string | null) ?? null,
        client_id:  (b.client_id  as string | null) ?? null,
        type_id:    (b.type_id    as string | null) ?? null,
        description: String(b.description),
        due_at:      (b.due_at    as string | null) ?? null,
        is_allday:   Boolean(b.is_allday),
        status:      'open',
        created_by:  session.display_name,
        responsible_user_id: (b.responsible_user_id as string | null) ?? null,
        fitbase_responsible: [],
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      if (b.lead_id) await writeActivity(b.lead_id as string, 'task', `Задача: ${b.description}`, session.display_name);
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lead-tasks/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const session = getSession(req)!;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.description !== undefined) upd.description = String(b.description);
      if (b.result      !== undefined) upd.result      = b.result ?? null;
      if (b.due_at      !== undefined) upd.due_at      = b.due_at ?? null;
      if (b.is_allday   !== undefined) upd.is_allday   = Boolean(b.is_allday);
      if (b.type_id     !== undefined) upd.type_id     = b.type_id ?? null;
      if (b.responsible_user_id !== undefined) upd.responsible_user_id = b.responsible_user_id ?? null;
      if (b.status !== undefined) {
        upd.status = b.status;
        if (b.status === 'done') { upd.closed_at = new Date().toISOString(); upd.closed_by = session.display_name; }
      }
      const { data, error } = await supabase.from('crm_lead_tasks')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lead-tasks/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { error } = await supabase.from('crm_lead_tasks')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead tags ─────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lead-tags', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_tags')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lead-tags', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название тега' }); return; }
      const { data, error } = await supabase.from('crm_lead_tags').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(),
        color: (b.color as string | null) ?? null, is_system: false, is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lead-tags/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.color     !== undefined) upd.color     = b.color ?? null;
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_lead_tags')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lead-tags/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: tag } = await supabase.from('crm_lead_tags').select('is_system,name').eq('id', req.params.id).single();
      if (tag?.is_system) { res.status(409).json({ error: `Системный тег «${tag.name}» нельзя удалять` }); return; }
      const { error } = await supabase.from('crm_lead_tags').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Task types ────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/task-types', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_task_types')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/task-types', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите название' }); return; }
      const { data, error } = await supabase.from('crm_task_types').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/task-types/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_task_types')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/task-types/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { count } = await supabase.from('crm_lead_tasks')
        .select('id', { count: 'exact', head: true }).eq('type_id', req.params.id);
      if (count && count > 0) { res.status(409).json({ error: `Тип используется в ${count} задачах` }); return; }
      const { error } = await supabase.from('crm_task_types').delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lost reasons ──────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lost-reasons', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_lost_reasons')
        .select('*').eq('branch_id', BRANCH_ID).order('sort').order('name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/lost-reasons', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ error: 'Укажите причину' }); return; }
      const { data, error } = await supabase.from('crm_lead_lost_reasons').insert({
        branch_id: BRANCH_ID, name: String(b.name).trim(), is_active: true, sort: Number(b.sort ?? 0),
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lost-reasons/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.name      !== undefined) upd.name      = String(b.name).trim();
      if (b.sort      !== undefined) upd.sort      = Number(b.sort);
      if (b.is_active !== undefined) upd.is_active = Boolean(b.is_active);
      const { data, error } = await supabase.from('crm_lead_lost_reasons')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/lost-reasons/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_lead_lost_reasons')
        .delete().eq('id', req.params.id).eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Fitbase user map ──────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/fitbase-users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data } = await supabase.from('crm_leads')
        .select('fitbase_manager_name,fitbase_manager_id')
        .eq('branch_id', BRANCH_ID)
        .not('fitbase_manager_name', 'is', null);
      const seen = new Map<string, number>();
      for (const row of data || []) {
        const name = (row as Record<string, unknown>).fitbase_manager_name as string;
        const fbId = (row as Record<string, unknown>).fitbase_manager_id as number | null;
        if (name && !seen.has(name)) seen.set(name, fbId ?? 0);
      }
      res.json([...seen.entries()].map(([name, id]) => ({ fitbase_full_name: name, fitbase_user_id: id })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/crm/fitbase-user-map', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_fitbase_user_map').select('*');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/crm/fitbase-user-map', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.fitbase_full_name || !b.user_id) { res.status(400).json({ error: 'Укажите имя Fitbase и пользователя' }); return; }
      const { data, error } = await supabase.from('crm_fitbase_user_map').insert({
        fitbase_full_name: String(b.fitbase_full_name).trim(),
        fitbase_user_id:   b.fitbase_user_id != null ? Number(b.fitbase_user_id) : null,
        user_id:           b.user_id,
      }).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/fitbase-user-map/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.user_id !== undefined) upd.user_id = b.user_id ?? null;
      if (b.fitbase_full_name !== undefined) upd.fitbase_full_name = b.fitbase_full_name ?? null;
      const { data, error } = await supabase.from('crm_fitbase_user_map')
        .update(upd).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/kviz/api/crm/fitbase-user-map/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase.from('crm_fitbase_user_map').delete().eq('id', req.params.id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Recalculate manager_user_id in leads and responsible_user_id in tasks after map changes
  r.post('/kviz/api/crm/fitbase-user-map/recalculate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data: map } = await supabase.from('crm_fitbase_user_map').select('fitbase_user_id,fitbase_full_name,user_id');
      const userByFbId  = new Map<number, string>();
      const userByName  = new Map<string, string>();
      for (const u of map || []) {
        const uid = (u as Record<string, unknown>).user_id as string | null;
        if (uid && u.fitbase_user_id != null) userByFbId.set(Number(u.fitbase_user_id), uid);
        if (uid && u.fitbase_full_name) userByName.set(String(u.fitbase_full_name).trim(), uid);
      }

      const { data: leads } = await supabase.from('crm_leads')
        .select('id,fitbase_manager_id,fitbase_manager_name').eq('branch_id', BRANCH_ID).eq('origin', 'fitbase');
      let leadsUpdated = 0;
      for (const l of leads || []) {
        const lb = l as Record<string, unknown>;
        const uid = (lb.fitbase_manager_id != null ? userByFbId.get(Number(lb.fitbase_manager_id)) : null)
          ?? (lb.fitbase_manager_name ? userByName.get(String(lb.fitbase_manager_name).trim()) : null) ?? null;
        await supabase.from('crm_leads').update({ manager_user_id: uid }).eq('id', lb.id as string);
        leadsUpdated++;
      }

      const { data: tasks } = await supabase.from('crm_lead_tasks')
        .select('id,fitbase_responsible').eq('branch_id', BRANCH_ID);
      let tasksUpdated = 0;
      for (const t of tasks || []) {
        const tb = t as Record<string, unknown>;
        const responsible = Array.isArray(tb.fitbase_responsible) ? tb.fitbase_responsible : [];
        const firstResp = responsible[0] as Record<string, unknown> | undefined;
        const respFbId = firstResp?.id != null ? Number(firstResp.id) : null;
        const uid = respFbId != null ? userByFbId.get(respFbId) ?? null : null;
        await supabase.from('crm_lead_tasks').update({ responsible_user_id: uid }).eq('id', tb.id as string);
        tasksUpdated++;
      }

      res.json({ ok: true, leadsUpdated, tasksUpdated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Lead rules ────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/lead-rules', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase.from('crm_lead_rules')
        .select('*').eq('branch_id', BRANCH_ID).order('code');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/kviz/api/crm/lead-rules/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const b = req.body as Record<string, unknown>;
      const upd: Record<string, unknown> = {};
      if (b.is_enabled !== undefined) upd.is_enabled = Boolean(b.is_enabled);
      if (b.params     !== undefined) upd.params     = b.params ?? {};
      const { data, error } = await supabase.from('crm_lead_rules')
        .update(upd).eq('id', req.params.id).eq('branch_id', BRANCH_ID).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── App users ─────────────────────────────────────────────────────────────────

  r.get('/kviz/api/crm/app-users', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { data, error } = await supabase.from('app_users')
        .select('id,display_name,role').order('display_name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data || []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
