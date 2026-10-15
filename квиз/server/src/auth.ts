import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const COOKIE = 'swauth';
const RATE_MS = 15 * 60 * 1000;
const RATE_MAX = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function sign(val: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(val).digest('hex');
}
function makeToken(secret: string) {
  const v = 'authed';
  return `${v}.${sign(v, secret)}`;
}
function verifyToken(token: string, secret: string) {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const val = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(val, secret), 'hex'));
  } catch { return false; }
}
function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(p => { const [k, ...v] = p.trim().split('='); return [k, v.join('=')]; })
  );
}
function getIp(req: Request) {
  return ((req.headers['x-forwarded-for'] as string) ?? '').split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

export function verifyAuth(req: Request): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const cookies = parseCookies(req.headers.cookie);
  return !!(cookies[COOKIE] && verifyToken(cookies[COOKIE], secret));
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (verifyAuth(req)) { next(); return; }
  res.status(401).json({ error: 'Unauthorized' });
}

export function registerAuthRoutes(app: import('express').Express) {
  app.get('/api/me', (req, res) => {
    res.json({ authed: verifyAuth(req) });
  });

  app.post('/api/login', (req, res) => {
    const ip = getIp(req);
    const now = Date.now();
    let entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + RATE_MS };
      attempts.set(ip, entry);
    }
    if (entry.count >= RATE_MAX) {
      res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
      return;
    }
    const { password } = req.body;
    const appPwd = process.env.APP_PASSWORD;
    const secret = process.env.SESSION_SECRET;
    if (!appPwd || !secret) {
      res.status(500).json({ error: 'APP_PASSWORD or SESSION_SECRET not set' });
      return;
    }
    if (password !== appPwd) {
      entry.count++;
      res.status(401).json({ error: 'Неверный пароль' });
      return;
    }
    entry.count = 0;
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie',
      `${COOKIE}=${makeToken(secret)}; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${isProd ? '; Secure' : ''}`
    );
    res.json({ ok: true });
  });

  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });
}
