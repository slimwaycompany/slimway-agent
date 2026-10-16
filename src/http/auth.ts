import crypto from 'crypto';
import express from 'express';
import { env } from '../config';

export const COOKIE_NAME  = 'swtoken';
export const COOKIE_MAX_S = 30 * 86400;

function windowSecret(): string {
  return env.WINDOW_SECRET || env.CRON_SECRET;
}

export function makeToken(): string {
  const exp     = Math.floor(Date.now() / 1000) + COOKIE_MAX_S;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig     = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  try {
    const eSig = Buffer.from(expected, 'base64url');
    const gSig = Buffer.from(sig,      'base64url');
    if (eSig.length !== gSig.length) return false;
    if (!crypto.timingSafeEqual(eSig, gSig)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number };
    return data.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function getToken(req: express.Request): string | null {
  const header = req.headers.cookie || '';
  const part   = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  return part ? part.slice(COOKIE_NAME.length + 1) : null;
}

export function requireAuth(req: express.Request, res: express.Response): boolean {
  const token = getToken(req);
  if (token && verifyToken(token)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// In-memory rate limiter: max 10 failures per IP per 15 minutes
const failMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX       = 10;

export function checkRate(ip: string): { ok: boolean; waitMin: number } {
  const now = Date.now();
  const rec = failMap.get(ip);
  if (!rec || now > rec.resetAt) return { ok: true, waitMin: 0 };
  if (rec.count >= RATE_MAX) return { ok: false, waitMin: Math.ceil((rec.resetAt - now) / 60000) };
  return { ok: true, waitMin: 0 };
}

export function recordFail(ip: string): void {
  const now = Date.now();
  const rec = failMap.get(ip);
  if (!rec || now > rec.resetAt) { failMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS }); }
  else rec.count++;
}

export function clearFails(ip: string): void {
  failMap.delete(ip);
}
