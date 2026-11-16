import express, { Application } from 'express';
import { supabase } from '../db/supabase';
import { getSessionWithPerms, requireAdmin, invalidateUserCache, invalidatePositionCache, can, PermEntry } from './auth';
import { PERM_CATALOG, POSITION_PRESETS } from '../core/permissions';
import type { ExtendedSession } from './auth';

type Perms = Record<string, PermEntry>;

function permsNotWider(actorPerms: Perms, candidates: Array<{perm_key: string; level: string; see_all: boolean}>): boolean {
  for (const pp of candidates) {
    const ap = actorPerms[pp.perm_key];
    if (!ap) return false;
    if (pp.level === 'edit' && ap.level !== 'edit') return false;
    if (pp.see_all && !ap.see_all) return false;
  }
  return true;
}

async function requireStaffAccess(
  req: express.Request,
  res: express.Response,
  level: 'view' | 'edit' = 'view',
): Promise<{ session: ExtendedSession; isAdmin: boolean } | null> {
  const session = await getSessionWithPerms(req);
  if (!session) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  if (session.role === 'admin') return { session, isAdmin: true };
  if (!can(session, 'settings.staff', level)) { res.status(403).json({ error: 'Нет доступа' }); return null; }
  return { session, isAdmin: false };
}

async function auditLog(actor: string, action: string, entityId: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await supabase.from('crm_audit_log').insert({
      entity_type: 'app_users', entity_id: entityId, action, actor, details,
    });
  } catch {}
}

export function mountStaffRoutes(app: Application): void {

  // GET /api/permissions/catalog — authed staff management users
  app.get('/api/permissions/catalog', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'view');
    if (!r) return;
    res.json(PERM_CATALOG);
  });

  // ── Positions (admin-only) ───────────────────────────────────────────────────

  app.get('/api/positions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_positions')
      .select('id, code, name, description, sort, is_archived, created_at')
      .order('sort', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    // Add employee count per position
    const { data: counts } = await supabase
      .from('app_users')
      .select('position_id')
      .not('position_id', 'is', null)
      .eq('is_active', true);
    const countMap: Record<string, number> = {};
    for (const u of counts || []) countMap[u.position_id as string] = (countMap[u.position_id as string] || 0) + 1;
    res.json((data || []).map(p => ({ ...p, employee_count: countMap[p.id] || 0 })));
  });

  app.post('/api/positions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name, description } = req.body as Record<string, string>;
    if (!name?.trim()) { res.status(400).json({ error: 'Название обязательно' }); return; }
    if (name.trim().length < 2 || name.trim().length > 60) {
      res.status(400).json({ error: 'Название: от 2 до 60 символов' }); return;
    }
    const { data, error } = await supabase.from('app_positions').insert({
      name: name.trim(), description: description?.trim() || null,
    }).select('id').single();
    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        res.status(409).json({ error: 'Такая должность уже есть' }); return;
      }
      res.status(500).json({ error: 'Не удалось создать должность' }); return;
    }
    res.status(201).json({ id: (data as any).id });
  });

  app.patch('/api/positions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name, description, is_archived } = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const n = String(name).trim();
      if (n.length < 2 || n.length > 60) { res.status(400).json({ error: 'Название: от 2 до 60 символов' }); return; }
      patch.name = n;
    }
    if (description !== undefined) patch.description = description ? String(description).trim() : null;
    if (is_archived !== undefined) patch.is_archived = Boolean(is_archived);
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Нет полей' }); return; }
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('app_positions').update(patch).eq('id', req.params.id);
    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        res.status(409).json({ error: 'Такая должность уже есть' }); return;
      }
      res.status(500).json({ error: 'Не удалось обновить должность' }); return;
    }
    res.json({ ok: true });
  });

  app.delete('/api/positions/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { count } = await supabase
      .from('app_users')
      .select('*', { count: 'exact', head: true })
      .eq('position_id', req.params.id);
    if ((count ?? 0) > 0) {
      res.status(409).json({ error: `Нельзя удалить: у должности ${count} сотрудников` }); return;
    }
    // Only allow deleting custom positions (code is null)
    const { data: pos } = await supabase.from('app_positions').select('code').eq('id', req.params.id).maybeSingle();
    if (pos?.code) { res.status(409).json({ error: 'Готовую должность удалить нельзя, только архивировать' }); return; }
    await supabase.from('app_position_permissions').delete().eq('position_id', req.params.id);
    const { error } = await supabase.from('app_positions').delete().eq('id', req.params.id);
    if (error) { res.status(500).json({ error: 'Не удалось удалить должность' }); return; }
    res.json({ ok: true });
  });

  app.get('/api/positions/:id/permissions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_position_permissions')
      .select('perm_key, level, see_all')
      .eq('position_id', req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });

  app.put('/api/positions/:id/permissions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const rows = req.body as Array<{ perm_key: string; level: string; see_all?: boolean }>;
    if (!Array.isArray(rows)) { res.status(400).json({ error: 'Ожидается массив' }); return; }
    await supabase.from('app_position_permissions').delete().eq('position_id', id);
    const insert = rows
      .filter(r => r.perm_key && ['view', 'edit'].includes(r.level))
      .map(r => ({ position_id: id, perm_key: r.perm_key, level: r.level, see_all: Boolean(r.see_all) }));
    if (insert.length > 0) {
      const { error } = await supabase.from('app_position_permissions').insert(insert);
      if (error) { res.status(500).json({ error: 'Не удалось сохранить права' }); return; }
    }
    await invalidatePositionCache(id);
    res.json({ ok: true });
  });

  // POST /api/positions/:id/reset — reset to preset
  app.post('/api/positions/:id/reset', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data: pos } = await supabase.from('app_positions').select('code').eq('id', req.params.id).maybeSingle();
    if (!pos?.code || !POSITION_PRESETS[pos.code as string]) {
      res.status(400).json({ error: 'У этой должности нет стандартного набора' }); return;
    }
    const id = req.params.id;
    await supabase.from('app_position_permissions').delete().eq('position_id', id);
    const rows = POSITION_PRESETS[pos.code as string].map(p => ({ position_id: id, ...p }));
    await supabase.from('app_position_permissions').insert(rows);
    await invalidatePositionCache(id);
    res.json({ ok: true });
  });

  // POST /api/positions/:id/copy-perms — copy perms from another position
  app.post('/api/positions/:id/copy-perms', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { from_position_id } = req.body as Record<string, string>;
    if (!from_position_id) { res.status(400).json({ error: 'from_position_id обязателен' }); return; }
    const { data: src } = await supabase
      .from('app_position_permissions')
      .select('perm_key, level, see_all')
      .eq('position_id', from_position_id);
    const id = req.params.id;
    await supabase.from('app_position_permissions').delete().eq('position_id', id);
    if ((src || []).length > 0) {
      await supabase.from('app_position_permissions').insert(
        (src || []).map(r => ({ position_id: id, perm_key: r.perm_key, level: r.level, see_all: r.see_all })),
      );
    }
    await invalidatePositionCache(id);
    res.json({ ok: true });
  });

  // ── Staff CRUD ────────────────────────────────────────────────────────────────

  app.get('/api/staff', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'view');
    if (!r) return;
    let q = supabase
      .from('app_users')
      .select('id, login, display_name, role, phone, is_active, fired_at, last_login_at, created_at, position_id, custom_permissions, branch_id, all_branches')
      .order('created_at', { ascending: true });
    // Non-admin: only own branch, no admins
    if (!r.isAdmin) {
      if (!r.session.all_branches && r.session.branch_id) q = q.eq('branch_id', r.session.branch_id);
      q = q.eq('role', 'manager');
    }
    const { data, error } = await q;
    if (error) { res.status(500).json({ error: error.message }); return; }
    // Enrich with position names
    const posIds = [...new Set((data || []).map(u => u.position_id).filter(Boolean))] as string[];
    let posMap: Record<string, string> = {};
    if (posIds.length > 0) {
      const { data: positions } = await supabase.from('app_positions').select('id, name').in('id', posIds);
      for (const p of positions || []) posMap[p.id as string] = p.name as string;
    }
    res.json((data || []).map(u => ({ ...u, position_name: u.position_id ? (posMap[u.position_id as string] || null) : null })));
  });

  app.post('/api/staff', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { login, display_name, role, phone, password, position_id, branch_id } = req.body as Record<string, string>;
    if (!login || !display_name || !password) {
      res.status(400).json({ error: 'login, display_name, password обязательны' }); return;
    }
    const finalRole = role || 'manager';
    if (!['admin', 'manager'].includes(finalRole)) {
      res.status(400).json({ error: 'role должен быть admin или manager' }); return;
    }
    if (!r.isAdmin && finalRole === 'admin') {
      res.status(403).json({ error: 'Нельзя назначить роль admin' }); return;
    }
    if (!r.isAdmin && finalRole === 'manager' && !position_id) {
      res.status(400).json({ error: 'Должность обязательна' }); return;
    }
    // Non-admin: check position perms are not wider
    if (!r.isAdmin && position_id) {
      const { data: posPerms } = await supabase
        .from('app_position_permissions').select('perm_key, level, see_all').eq('position_id', position_id);
      if (!permsNotWider(r.session.perms, posPerms || [])) {
        res.status(403).json({ error: 'Нельзя выдать права шире своих' }); return;
      }
    }
    const { data, error } = await supabase.rpc('app_create_user', {
      p_login: login.trim().toLowerCase(),
      p_display_name: display_name.trim(),
      p_role: finalRole,
      p_phone: phone?.trim() || null,
      p_password: password,
    });
    if (error) {
      const msg = error.message;
      if (msg.includes('login_taken') || msg.includes('duplicate') || msg.includes('unique')) {
        res.status(409).json({ error: 'Такой логин уже есть' }); return;
      }
      if (msg.includes('bad_login')) { res.status(400).json({ error: 'Логин: латиница, цифры, . _ -, от 3 до 32 символов' }); return; }
      if (msg.includes('password_too_short')) { res.status(400).json({ error: 'Пароль минимум 6 символов' }); return; }
      res.status(500).json({ error: 'Не удалось создать сотрудника' }); return;
    }
    const newId = data as string;
    // Update additional fields
    const patch: Record<string, unknown> = {};
    if (position_id) patch.position_id = position_id;
    if (branch_id && r.isAdmin) patch.branch_id = branch_id;
    else if (!r.isAdmin && r.session.branch_id) patch.branch_id = r.session.branch_id;
    if (Object.keys(patch).length > 0) {
      await supabase.from('app_users').update(patch).eq('id', newId);
    }
    await auditLog(r.session.display_name, 'create', newId, { login: login.trim().toLowerCase() });
    res.status(201).json({ id: newId });
  });

  app.patch('/api/staff/:id', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    // Non-admin can't modify themselves
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    // Load target user
    const { data: target } = await supabase
      .from('app_users')
      .select('role, branch_id, position_id')
      .eq('id', id)
      .maybeSingle();
    if (!target) { res.status(404).json({ error: 'Сотрудник не найден' }); return; }
    if (!r.isAdmin && target.role === 'admin') {
      res.status(403).json({ error: 'Нет доступа' }); return;
    }
    if (!r.isAdmin && !r.session.all_branches && target.branch_id !== r.session.branch_id) {
      res.status(403).json({ error: 'Сотрудник другого филиала' }); return;
    }
    const { display_name, phone, login, role, position_id, branch_id, all_branches } = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (display_name !== undefined) patch.display_name = String(display_name).trim();
    if (phone !== undefined) patch.phone = phone ? String(phone).trim() : null;
    if (login !== undefined) patch.login = String(login).trim().toLowerCase();
    if (role !== undefined) {
      if (!['admin', 'manager'].includes(String(role))) {
        res.status(400).json({ error: 'role должен быть admin или manager' }); return;
      }
      if (!r.isAdmin && String(role) === 'admin') {
        res.status(403).json({ error: 'Нельзя назначить роль admin' }); return;
      }
      patch.role = role;
    }
    if (position_id !== undefined) {
      // Non-admin: check new position perms are not wider
      if (!r.isAdmin && position_id) {
        const { data: posPerms } = await supabase
          .from('app_position_permissions').select('perm_key, level, see_all').eq('position_id', position_id);
        if (!permsNotWider(r.session.perms, posPerms || [])) {
          res.status(403).json({ error: 'Нельзя выдать права шире своих' }); return;
        }
      }
      patch.position_id = position_id || null;
    }
    if (branch_id !== undefined && r.isAdmin) patch.branch_id = branch_id || null;
    if (all_branches !== undefined && r.isAdmin) patch.all_branches = Boolean(all_branches);
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Нет полей для обновления' }); return; }
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('app_users').update(patch).eq('id', id);
    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        res.status(409).json({ error: 'Такой логин уже есть' }); return;
      }
      res.status(500).json({ error: 'Не удалось обновить сотрудника' }); return;
    }
    invalidateUserCache(id);
    await auditLog(r.session.display_name, 'update', id, patch);
    res.json({ ok: true });
  });

  app.post('/api/staff/:id/password', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    const { password } = req.body as Record<string, string>;
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Пароль минимум 6 символов' }); return;
    }
    const { error } = await supabase.rpc('app_set_password', { p_user_id: id, p_password: password });
    if (error) {
      if (error.message.includes('password_too_short')) { res.status(400).json({ error: 'Пароль минимум 6 символов' }); return; }
      res.status(500).json({ error: 'Не удалось сменить пароль' }); return;
    }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // GET /api/staff/:id/permissions
  app.get('/api/staff/:id/permissions', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'view');
    if (!r) return;
    const { data, error } = await supabase
      .from('app_user_permissions')
      .select('perm_key, level, see_all')
      .eq('user_id', req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });

  // PUT /api/staff/:id/permissions — replace custom permissions
  app.put('/api/staff/:id/permissions', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    const rows = req.body as Array<{ perm_key: string; level: string; see_all?: boolean }>;
    if (!Array.isArray(rows)) { res.status(400).json({ error: 'Ожидается массив' }); return; }
    // Non-admin: check new perms are not wider
    if (!r.isAdmin && !permsNotWider(r.session.perms, rows as any)) {
      res.status(403).json({ error: 'Нельзя выдать права шире своих' }); return;
    }
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    const insert = rows
      .filter(rr => rr.perm_key && ['view', 'edit'].includes(rr.level))
      .map(rr => ({ user_id: id, perm_key: rr.perm_key, level: rr.level, see_all: Boolean(rr.see_all) }));
    if (insert.length > 0) {
      const { error } = await supabase.from('app_user_permissions').insert(insert);
      if (error) { res.status(500).json({ error: 'Не удалось сохранить права' }); return; }
    }
    // Enable custom_permissions
    await supabase.from('app_users').update({ custom_permissions: true, updated_at: new Date().toISOString() }).eq('id', id);
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // DELETE /api/staff/:id/permissions — remove custom perms (revert to position)
  app.delete('/api/staff/:id/permissions', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    await supabase.from('app_users').update({ custom_permissions: false, updated_at: new Date().toISOString() }).eq('id', id);
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/permissions/copy-from-position — copy position perms to user
  app.post('/api/staff/:id/permissions/copy-from-position', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    const { data: user } = await supabase.from('app_users').select('position_id').eq('id', id).maybeSingle();
    if (!user?.position_id) { res.status(400).json({ error: 'У сотрудника нет должности' }); return; }
    const { data: posPerms } = await supabase
      .from('app_position_permissions').select('perm_key, level, see_all').eq('position_id', user.position_id);
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    if ((posPerms || []).length > 0) {
      await supabase.from('app_user_permissions').insert(
        (posPerms || []).map(p => ({ user_id: id, perm_key: p.perm_key, level: p.level, see_all: p.see_all })),
      );
    }
    await supabase.from('app_users').update({ custom_permissions: true, updated_at: new Date().toISOString() }).eq('id', id);
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/permissions/copy — copy from another user
  app.post('/api/staff/:id/permissions/copy', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    const { from_user_id } = req.body as Record<string, string>;
    if (!from_user_id) { res.status(400).json({ error: 'from_user_id обязателен' }); return; }
    const { data: srcPerms } = await supabase
      .from('app_user_permissions').select('perm_key, level, see_all').eq('user_id', from_user_id);
    if (!r.isAdmin && !permsNotWider(r.session.perms, srcPerms as any || [])) {
      res.status(403).json({ error: 'Нельзя выдать права шире своих' }); return;
    }
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    if ((srcPerms || []).length > 0) {
      await supabase.from('app_user_permissions').insert(
        (srcPerms || []).map(p => ({ user_id: id, perm_key: p.perm_key, level: p.level, see_all: p.see_all })),
      );
    }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/fire
  app.post('/api/staff/:id/fire', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    // Can't remove last admin
    const { data: target } = await supabase.from('app_users').select('role, auth_version').eq('id', id).maybeSingle();
    if (!target) { res.status(404).json({ error: 'Не найден' }); return; }
    if (target.role === 'admin') {
      const { count } = await supabase.from('app_users')
        .select('*', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
      if ((count ?? 0) <= 1) { res.status(409).json({ error: 'Нельзя уволить последнего администратора' }); return; }
    }
    const { error } = await supabase.from('app_users').update({
      is_active: false, fired_at: new Date().toISOString(),
      auth_version: (target.auth_version as number) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось уволить сотрудника' }); return; }
    invalidateUserCache(id);
    await auditLog(r.session.display_name, 'fire', id, {});
    res.json({ ok: true });
  });

  // DELETE /api/staff/:id/fire — restore
  app.delete('/api/staff/:id/fire', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    const { error } = await supabase.from('app_users').update({
      is_active: true, fired_at: null, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось восстановить сотрудника' }); return; }
    await auditLog(r.session.display_name, 'restore', id, {});
    res.json({ ok: true });
  });

  // DELETE /api/staff/:id — physical delete
  app.delete('/api/staff/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    // Check records across all relevant tables
    const checks = [
      supabase.from('app_login_log').select('*', { count: 'exact', head: true }).eq('user_id', id),
    ];
    // Also check by display_name in author tables
    const { data: user } = await supabase.from('app_users').select('display_name').eq('id', id).maybeSingle();
    const name = user?.display_name as string | undefined;
    let totalRecords = 0;
    for (const q of checks) {
      const { count } = await q;
      totalRecords += count ?? 0;
    }
    if (name) {
      // Check tables where display_name is author
      const nameTables = [
        supabase.from('crm_sales').select('*', { count: 'exact', head: true }).eq('cashier', name),
        supabase.from('cash_shifts').select('*', { count: 'exact', head: true }).eq('opened_by', name),
        supabase.from('qualify_sessions').select('*', { count: 'exact', head: true }).eq('consultant', name),
      ];
      for (const q of nameTables) {
        const { count } = await q;
        totalRecords += count ?? 0;
      }
    }
    if (totalRecords > 0) {
      res.status(409).json({ error: `Удалить нельзя: за сотрудником ${totalRecords} записей. Можно уволить.` }); return;
    }
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось удалить сотрудника' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/logout-all
  app.post('/api/staff/:id/logout-all', async (req, res) => {
    const r = await requireStaffAccess(req, res, 'edit');
    if (!r) return;
    const { id } = req.params;
    if (!r.isAdmin && id === r.session.id) {
      res.status(403).json({ error: 'Нельзя изменить свою учётную запись' }); return;
    }
    const { data: user } = await supabase.from('app_users').select('auth_version').eq('id', id).maybeSingle();
    if (!user) { res.status(404).json({ error: 'Сотрудник не найден' }); return; }
    const { error } = await supabase.from('app_users').update({
      auth_version: (user.auth_version as number) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось завершить сессии' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // GET /api/staff/:id/login-log — admin only
  app.get('/api/staff/:id/login-log', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_login_log')
      .select('id, ok, reason, ip, user_agent, created_at')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });
}
