import { Application } from 'express';
import { supabase } from '../db/supabase';
import { requireAdmin, invalidateUserCache } from './auth';
import { PERM_CATALOG } from '../core/permissions';

export function mountStaffRoutes(app: Application): void {

  // GET /api/permissions/catalog — public to authed users (for the React client)
  app.get('/api/permissions/catalog', (req, res) => {
    if (!requireAdmin(req, res)) return; // staff management is admin-only
    res.json(PERM_CATALOG);
  });

  // GET /api/staff
  app.get('/api/staff', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_users')
      .select('id, login, display_name, role, phone, is_active, fired_at, last_login_at, created_at')
      .order('created_at', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });

  // POST /api/staff
  app.post('/api/staff', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { login, display_name, role, phone, password } = req.body as Record<string, string>;
    if (!login || !display_name || !role || !password) {
      res.status(400).json({ error: 'login, display_name, role, password обязательны' }); return;
    }
    if (!['admin', 'manager'].includes(role)) {
      res.status(400).json({ error: 'role должен быть admin или manager' }); return;
    }
    const { data, error } = await supabase.rpc('app_create_user', {
      p_login: login.trim().toLowerCase(),
      p_display_name: display_name.trim(),
      p_role: role,
      p_phone: phone?.trim() || null,
      p_password: password,
    });
    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        res.status(409).json({ error: 'Логин уже занят' }); return;
      }
      res.status(500).json({ error: 'Не удалось создать сотрудника' }); return;
    }
    res.status(201).json({ id: data });
  });

  // PATCH /api/staff/:id
  app.patch('/api/staff/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { display_name, phone, login, role } = req.body as Record<string, string>;
    const patch: Record<string, unknown> = {};
    if (display_name !== undefined) patch.display_name = display_name.trim();
    if (phone !== undefined) patch.phone = phone?.trim() || null;
    if (login !== undefined) patch.login = login.trim().toLowerCase();
    if (role !== undefined) {
      if (!['admin', 'manager'].includes(role)) {
        res.status(400).json({ error: 'role должен быть admin или manager' }); return;
      }
      patch.role = role;
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Нет полей для обновления' }); return; }
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('app_users').update(patch).eq('id', id);
    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        res.status(409).json({ error: 'Логин уже занят' }); return;
      }
      res.status(500).json({ error: 'Не удалось обновить сотрудника' }); return;
    }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/password
  app.post('/api/staff/:id/password', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { password } = req.body as Record<string, string>;
    if (!password || password.length < 4) {
      res.status(400).json({ error: 'Пароль минимум 4 символа' }); return;
    }
    const { error } = await supabase.rpc('app_set_password', { p_user_id: id, p_password: password });
    if (error) { res.status(500).json({ error: 'Не удалось сменить пароль' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // GET /api/staff/:id/permissions
  app.get('/api/staff/:id/permissions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_user_permissions')
      .select('perm_key, level, see_all')
      .eq('user_id', req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });

  // PUT /api/staff/:id/permissions — replace all permissions
  app.put('/api/staff/:id/permissions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const rows = req.body as Array<{ perm_key: string; level: string; see_all?: boolean }>;
    if (!Array.isArray(rows)) { res.status(400).json({ error: 'Ожидается массив' }); return; }

    // Delete all current permissions, then insert new ones
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    if (rows.length > 0) {
      const insert = rows
        .filter(r => r.perm_key && ['view', 'edit'].includes(r.level))
        .map(r => ({ user_id: id, perm_key: r.perm_key, level: r.level, see_all: Boolean(r.see_all) }));
      if (insert.length > 0) {
        const { error } = await supabase.from('app_user_permissions').insert(insert);
        if (error) { res.status(500).json({ error: 'Не удалось сохранить права' }); return; }
      }
    }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/permissions/copy
  app.post('/api/staff/:id/permissions/copy', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { from_user_id } = req.body as Record<string, string>;
    if (!from_user_id) { res.status(400).json({ error: 'from_user_id обязателен' }); return; }

    const { data: srcPerms, error: srcErr } = await supabase
      .from('app_user_permissions')
      .select('perm_key, level, see_all')
      .eq('user_id', from_user_id);
    if (srcErr) { res.status(500).json({ error: 'Не удалось загрузить права источника' }); return; }

    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    if ((srcPerms || []).length > 0) {
      const insert = (srcPerms || []).map(r => ({ user_id: id, perm_key: r.perm_key, level: r.level, see_all: r.see_all }));
      await supabase.from('app_user_permissions').insert(insert);
    }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/fire
  app.post('/api/staff/:id/fire', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { error } = await supabase.from('app_users').update({
      is_active: false,
      fired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось уволить сотрудника' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // DELETE /api/staff/:id/fire — restore
  app.delete('/api/staff/:id/fire', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { error } = await supabase.from('app_users').update({
      is_active: true,
      fired_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось восстановить сотрудника' }); return; }
    res.json({ ok: true });
  });

  // DELETE /api/staff/:id — physical delete (only if no records)
  app.delete('/api/staff/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    // Check for records in login_log
    const { count: logCount } = await supabase
      .from('app_login_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);
    if ((logCount ?? 0) > 0) {
      res.status(409).json({ error: 'У сотрудника есть записи в журнале входов. Используйте «Уволить».' }); return;
    }
    await supabase.from('app_user_permissions').delete().eq('user_id', id);
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось удалить сотрудника' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // POST /api/staff/:id/logout-all — invalidate all sessions by bumping auth_version
  app.post('/api/staff/:id/logout-all', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { data: user } = await supabase
      .from('app_users')
      .select('auth_version')
      .eq('id', id)
      .maybeSingle();
    if (!user) { res.status(404).json({ error: 'Сотрудник не найден' }); return; }
    const { error } = await supabase.from('app_users').update({
      auth_version: (user.auth_version as number) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { res.status(500).json({ error: 'Не удалось завершить сессии' }); return; }
    invalidateUserCache(id);
    res.json({ ok: true });
  });

  // GET /api/staff/:id/login-log
  app.get('/api/staff/:id/login-log', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase
      .from('app_login_log')
      .select('id, ok, reason, ip, user_agent, created_at')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  });
}
