import { Router } from 'express';
import { supabase } from '../db/supabase';
import { getSessionWithPerms, requireAdmin, can, seeAll } from './auth';
import { catalog } from '../control/catalog';
import { getAllVersions, createVersion, LineConfig } from '../control/lineVersions';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

export function buildControl2Router(): Router {
  const r = Router();

  // ── Catalog ──────────────────────────────────────────────────────────────────

  r.get('/kviz/api/control2/catalog', async (_req, res) => {
    res.json(catalog.map(c => ({
      key: c.key,
      title: c.title,
      description: c.description,
      roles: c.roles,
      params: c.params,
      status: c.status,
    })));
  });

  // ── Line versions ────────────────────────────────────────────────────────────

  r.get('/kviz/api/control2/versions/:role', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const role = req.params.role as 'call_center' | 'consultant';
    if (role !== 'call_center' && role !== 'consultant') {
      res.status(400).json({ error: 'Неверная роль' }); return;
    }
    try {
      const versions = await getAllVersions(role);
      res.json(versions);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/control2/versions/:role', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const role = req.params.role as 'call_center' | 'consultant';
    if (role !== 'call_center' && role !== 'consultant') {
      res.status(400).json({ error: 'Неверная роль' }); return;
    }
    const { effective_from, config } = req.body as { effective_from: string; config: LineConfig };
    if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
      res.status(400).json({ error: 'effective_from: нужна дата ГГГГ-ММ-ДД' }); return;
    }
    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'config: обязателен' }); return;
    }

    // Basic validation
    const errs: string[] = [];
    if (typeof config.fixed_pay !== 'number') errs.push('fixed_pay должен быть числом');
    if (typeof config.point_price !== 'number') errs.push('point_price должен быть числом');
    if (typeof config.max_variable !== 'number') errs.push('max_variable должен быть числом');
    if (!['forgive_then_all', 'per_point'].includes(config.formula)) errs.push('formula: forgive_then_all или per_point');
    if (!['next_morning', 'after_review'].includes(config.finalize)) errs.push('finalize: next_morning или after_review');
    if (!Array.isArray(config.points)) errs.push('points должен быть массивом');
    if (errs.length) { res.status(400).json({ error: errs.join('; ') }); return; }

    try {
      const session = (await getSessionWithPerms(req))!;
      const result = await createVersion(role, effective_from, config, session.display_name);
      if (!result.ok) { res.status(400).json({ error: result.error }); return; }

      await supabase.from('crm_audit_log').insert({
        entity: 'control_line_versions',
        action: 'create',
        actor: session.display_name,
        note: `role=${role} effective_from=${effective_from}`,
      });

      res.json({ ok: true, id: result.id });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Summary ──────────────────────────────────────────────────────────────────

  r.get('/kviz/api/control2/summary', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const role = req.query.role as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    // Permission: admin or reports.control_cc / reports.control_consultant
    const canCC   = can(session, 'reports.control_cc');
    const canCons = can(session, 'reports.control_consultant');
    if (!canCC && !canCons) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const allowedRoles: string[] = [];
    if (canCC)   allowedRoles.push('call_center');
    if (canCons) allowedRoles.push('consultant');

    // see_all determines if they see all names or only their own
    const all = seeAll(session, 'reports.control_cc') || seeAll(session, 'reports.control_consultant');

    let query = supabase
      .from('control_shift_pay')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .in('role', allowedRoles);

    if (role && allowedRoles.includes(role)) query = query.eq('role', role);
    if (from) query = query.gte('shift_date', from);
    if (to)   query = query.lte('shift_date', to);
    if (!all) query = query.eq('user_name', session.display_name);

    try {
      const { data, error } = await query.order('shift_date', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Violations ───────────────────────────────────────────────────────────────

  r.get('/kviz/api/control2/violations', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const canCC   = can(session, 'reports.control_cc');
    const canCons = can(session, 'reports.control_consultant');
    if (!canCC && !canCons) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const allowedRoles: string[] = [];
    if (canCC)   allowedRoles.push('call_center');
    if (canCons) allowedRoles.push('consultant');

    const all = seeAll(session, 'reports.control_cc') || seeAll(session, 'reports.control_consultant');

    const { date, user, point } = req.query as Record<string, string>;

    let query = supabase
      .from('control_violations')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .in('role', allowedRoles);

    if (date)  query = query.eq('shift_date', date);
    if (user && all) query = query.eq('owner_name', user);
    if (point) query = query.eq('point_key', point);
    if (!all)  query = query.eq('owner_name', session.display_name);

    try {
      const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Waive violation ──────────────────────────────────────────────────────────

  r.post('/kviz/api/control2/violations/:id/waive', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { reason } = req.body as { reason: string };
    if (!reason?.trim()) { res.status(400).json({ error: 'reason обязателен' }); return; }

    const id = req.params.id;
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    try {
      const { error } = await supabase
        .from('control_violations')
        .update({ status: 'waived', waived_by: session.display_name, waived_reason: reason.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }

      await supabase.from('crm_audit_log').insert({
        entity: 'control_violations',
        entity_id: id,
        action: 'waive',
        actor: session.display_name,
        note: reason.trim(),
      });

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Dispute violation (staff) ────────────────────────────────────────────────

  r.post('/kviz/api/control2/violations/:id/dispute', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { text } = req.body as { text: string };
    if (!text?.trim()) { res.status(400).json({ error: 'text обязателен' }); return; }

    const id = req.params.id;

    // Can only dispute own violations
    const { data: viol } = await supabase
      .from('control_violations')
      .select('id, owner_name, status')
      .eq('id', id).eq('branch_id', BRANCH_ID).maybeSingle();

    if (!viol) { res.status(404).json({ error: 'Нарушение не найдено' }); return; }
    if (viol.owner_name !== session.display_name && session.role !== 'admin') {
      res.status(403).json({ error: 'Нельзя оспорить чужое нарушение' }); return;
    }
    if (!['open', 'fail'].includes(String(viol.status))) {
      res.status(400).json({ error: 'Нарушение уже закрыто' }); return;
    }

    try {
      await supabase.from('control_violations').update({
        status: 'disputed',
        dispute_text: text.trim(),
        dispute_by: session.display_name,
        dispute_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      await supabase.from('crm_audit_log').insert({
        entity: 'control_violations',
        entity_id: id,
        action: 'dispute',
        actor: session.display_name,
        note: text.trim(),
      });

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Resolve dispute (admin) ──────────────────────────────────────────────────

  r.post('/kviz/api/control2/violations/:id/dispute/resolve', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { decision } = req.body as { decision: 'accept' | 'reject' };
    if (decision !== 'accept' && decision !== 'reject') {
      res.status(400).json({ error: 'decision: accept или reject' }); return;
    }

    const id = req.params.id;
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const newStatus = decision === 'accept' ? 'waived' : 'open';
    try {
      await supabase.from('control_violations').update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('branch_id', BRANCH_ID);

      await supabase.from('crm_audit_log').insert({
        entity: 'control_violations',
        entity_id: id,
        action: `dispute_resolve_${decision}`,
        actor: session.display_name,
      });

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Manual reviews ───────────────────────────────────────────────────────────

  r.get('/kviz/api/control2/reviews', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!can(session, 'control.review')) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const { status } = req.query as { status?: string };

    let query = supabase
      .from('control_manual_reviews')
      .select('*')
      .eq('branch_id', BRANCH_ID)
      .order('created_at', { ascending: false })
      .limit(200);

    if (status === 'open') query = query.is('result', null);
    else if (status === 'reviewed') query = query.not('result', 'is', null);

    try {
      const { data, error } = await query;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/control2/reviews/:id', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!can(session, 'control.review')) { res.status(403).json({ error: 'Нет доступа' }); return; }

    const id = req.params.id;
    const { result, comment } = req.body as { result: 'ok' | 'fail'; comment?: string };
    if (result !== 'ok' && result !== 'fail') {
      res.status(400).json({ error: 'result: ok или fail' }); return;
    }

    try {
      const { error } = await supabase
        .from('control_manual_reviews')
        .update({
          result,
          comment: comment?.trim() ?? null,
          reviewed_by: session.display_name,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }

      await supabase.from('crm_audit_log').insert({
        entity: 'control_manual_reviews',
        entity_id: id,
        action: `review_${result}`,
        actor: session.display_name,
        note: comment?.trim() ?? null,
      });

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
