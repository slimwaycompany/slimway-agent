import crypto from 'crypto';
import express from 'express';
import { supabase } from '../db/supabase';
import { env } from '../config';

export const COOKIE_NAME  = 'swtoken';
export const COOKIE_MAX_S = 30 * 86400;

export interface TokenPayload {
  exp: number;
  id: string;
  login: string;
  display_name: string;
  role: string;
  v: number; // auth_version — tokens without v are invalid
}

export interface PermEntry { level: 'view' | 'edit'; see_all: boolean }

export interface ExtendedSession extends TokenPayload {
  perms: Record<string, PermEntry>; // empty for admin (can() handles admin shortcut)
  branch_id: string | null;
  all_branches: boolean;
}

function windowSecret(): string {
  return env.WINDOW_SECRET || env.CRON_SECRET;
}

export function makeToken(user: Omit<TokenPayload, 'exp'>): string {
  const exp     = Math.floor(Date.now() / 1000) + COOKIE_MAX_S;
  const payload = Buffer.from(JSON.stringify({ exp, ...user })).toString('base64url');
  const sig     = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function parseToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  try {
    const eSig = Buffer.from(expected, 'base64url');
    const gSig = Buffer.from(sig,      'base64url');
    if (eSig.length !== gSig.length) return null;
    if (!crypto.timingSafeEqual(eSig, gSig)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenPayload;
    if (data.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!data.id || !data.login) return null;
    if (data.v === undefined || data.v === null) return null; // reject old tokens without auth_version
    return data;
  } catch { return null; }
}

export function getSession(req: express.Request): TokenPayload | null {
  const header = req.headers.cookie || '';
  const part   = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  const cookieToken = part ? part.slice(COOKIE_NAME.length + 1) : null;
  if (cookieToken) { const s = parseToken(cookieToken); if (s) return s; }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return parseToken(auth.slice(7));
  return null;
}

// ── Permission cache (30 s TTL) ───────────────────────────────────────────────

interface CacheEntry { session: ExtendedSession; exp: number }
const permCache = new Map<string, CacheEntry>();

export async function getSessionWithPerms(req: express.Request): Promise<ExtendedSession | null> {
  const base = getSession(req);
  if (!base) return null;

  const cached = permCache.get(base.id);
  if (cached && Date.now() < cached.exp && cached.session.v === base.v) {
    return cached.session;
  }

  const { data: user } = await supabase
    .from('app_users')
    .select('auth_version, is_active, fired_at, position_id, custom_permissions, branch_id, all_branches')
    .eq('id', base.id)
    .maybeSingle();

  if (!user || !user.is_active || user.fired_at || user.auth_version !== base.v) return null;

  let perms: Record<string, PermEntry> = {};
  if (base.role !== 'admin') {
    let rows: Array<{ perm_key: string; level: string; see_all: boolean }> | null = null;
    if (user.custom_permissions && user.position_id == null) {
      // custom perms only, no position
      const { data } = await supabase
        .from('app_user_permissions')
        .select('perm_key, level, see_all')
        .eq('user_id', base.id);
      rows = data;
    } else if (user.custom_permissions) {
      // custom perms (copied from position + edited)
      const { data } = await supabase
        .from('app_user_permissions')
        .select('perm_key, level, see_all')
        .eq('user_id', base.id);
      rows = data;
    } else if (user.position_id) {
      // use position perms
      const { data } = await supabase
        .from('app_position_permissions')
        .select('perm_key, level, see_all')
        .eq('position_id', user.position_id);
      rows = data;
    }
    for (const r of rows || []) {
      perms[r.perm_key] = { level: r.level as 'view' | 'edit', see_all: Boolean(r.see_all) };
    }
  }

  const extended: ExtendedSession = {
    ...base,
    perms,
    branch_id: (user.branch_id as string | null) ?? null,
    all_branches: Boolean(user.all_branches),
  };
  permCache.set(base.id, { session: extended, exp: Date.now() + 30_000 });
  return extended;
}

export function invalidateUserCache(userId: string): void {
  permCache.delete(userId);
}

export async function invalidatePositionCache(positionId: string): Promise<void> {
  const { data } = await supabase
    .from('app_users')
    .select('id')
    .eq('position_id', positionId)
    .eq('custom_permissions', false);
  for (const u of data || []) permCache.delete(u.id as string);
}

export function requirePerm(
  req: express.Request, res: express.Response,
  key: string, level: 'view' | 'edit' = 'view',
  session: ExtendedSession | null,
): session is ExtendedSession {
  if (!session) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (can(session, key, level)) return true;
  res.status(403).json({ error: 'Нет доступа' });
  return false;
}

export function can(session: ExtendedSession | null, permKey: string, level: 'view' | 'edit' = 'view'): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  const p = session.perms[permKey];
  if (!p) return false;
  return level === 'view' ? true : p.level === 'edit';
}

export function seeAll(session: ExtendedSession | null, permKey: string): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return Boolean(session.perms[permKey]?.see_all);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function requireAuth(req: express.Request, res: express.Response): boolean {
  if (getSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

export function requireAdmin(req: express.Request, res: express.Response): boolean {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (session.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return false; }
  return true;
}

// ── Login log ─────────────────────────────────────────────────────────────────

export async function writeLoginLog(
  userId: string | null,
  login: string,
  ok: boolean,
  reason: string | null,
  ip: string,
  ua: string,
): Promise<void> {
  try {
    await supabase.from('app_login_log').insert({
      user_id: userId,
      login,
      ok,
      reason,
      ip,
      user_agent: ua,
    });
  } catch (e) {
    console.error('[writeLoginLog]', e);
  }
}

// ── DB-based rate limiter (replaces in-memory failMap) ────────────────────────

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX       = 10;

export async function checkLoginRate(login: string, ip: string): Promise<{ ok: boolean; waitMin: number }> {
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await supabase
      .from('app_login_log')
      .select('*', { count: 'exact', head: true })
      .eq('login', login)
      .eq('ip', ip)
      .eq('ok', false)
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_MAX) return { ok: false, waitMin: 15 };
    return { ok: true, waitMin: 0 };
  } catch {
    return { ok: true, waitMin: 0 }; // fail open if DB is unavailable
  }
}

// ── Legacy helpers — kept for callers not yet updated ─────────────────────────

export function getToken(req: express.Request): string | null {
  const header = req.headers.cookie || '';
  const part   = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  return part ? part.slice(COOKIE_NAME.length + 1) : null;
}

export function verifyToken(token: string): boolean {
  return parseToken(token) !== null;
}
