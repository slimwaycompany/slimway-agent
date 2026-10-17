import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { env } from '../config';

// YEK = UTC+5
const YEK_MS = 5 * 3600_000;
function yekNow() { return new Date(Date.now() + YEK_MS); }
function yekHHMM(iso: string) {
  const d = new Date(new Date(iso).getTime() + YEK_MS);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function yekDateDDMMYYYY(iso: string) {
  const d = new Date(new Date(iso).getTime() + YEK_MS);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}
function yekToday() {
  const d = yekNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function calcHours(startIso: string, endIso: string): string {
  return ((new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000).toFixed(1);
}

// ── Google Sheets webhook ─────────────────────────────────────────────────────

async function postToSheet(payload: Record<string, unknown>): Promise<void> {
  const url = env.SHIFTS_SHEET_WEBHOOK_URL;
  if (!url) return; // unconfigured — silently skip
  const body = JSON.stringify({ secret: env.SHIFTS_SHEET_SECRET ?? '', ...payload });
  // Apps Script returns a 302 redirect; fetch follows it automatically
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'follow',
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Sheet ${resp.status}: ${text.slice(0, 200)}`);
  }
  let json: Record<string, unknown>;
  try { json = await resp.json(); } catch { return; } // empty / non-JSON body → ok
  if (json.ok === false) throw new Error(String(json.error ?? 'sheet error'));
}

// Retry unsynced shifts — called from watch.ts per run (up to 5 attempts)
export async function retrySheetSync(): Promise<void> {
  const { data: pending } = await supabase
    .from('staff_shifts')
    .select('*')
    .or('sheet_synced_start.eq.false,sheet_synced_end.eq.false')
    .lt('sheet_sync_attempts', 5);

  for (const s of (pending ?? []) as Record<string, unknown>[]) {
    let attempts = Number(s.sheet_sync_attempts ?? 0);
    const updates: Record<string, unknown> = {};

    if (!s.sheet_synced_start && s.started_at) {
      try {
        await postToSheet({
          action: 'start',
          id: String(s.id),
          date: yekDateDDMMYYYY(String(s.started_at)),
          name: String(s.user_name),
          login: String(s.user_login),
          start: yekHHMM(String(s.started_at)),
          replacing: s.replacing ?? '',
          comment: s.comment ?? '',
        });
        updates.sheet_synced_start = true;
      } catch (e) {
        console.warn('[shifts] retrySheetSync start:', (e as Error).message);
        attempts++;
      }
    }

    if (!s.sheet_synced_end && s.ended_at && s.started_at) {
      const statusLabel = s.status === 'auto_closed' ? 'закрыта автоматически' : 'закрыта';
      try {
        await postToSheet({
          action: 'end',
          id: String(s.id),
          end: yekHHMM(String(s.ended_at)),
          hours: calcHours(String(s.started_at), String(s.ended_at)),
          status: statusLabel,
          comment: String(s.comment_end ?? ''),
        });
        updates.sheet_synced_end = true;
      } catch (e) {
        console.warn('[shifts] retrySheetSync end:', (e as Error).message);
        attempts++;
      }
    }

    updates.sheet_sync_attempts = attempts;
    await supabase.from('staff_shifts').update(updates).eq('id', s.id);
  }
}

// Auto-close open shifts at 23:30 YEK — called from /run/shifts-autoclose
export async function autoCloseShifts(): Promise<{ closed: number }> {
  const { data: open } = await supabase
    .from('staff_shifts').select('*').eq('status', 'open');
  if (!open?.length) return { closed: 0 };

  const endedAt = new Date().toISOString();
  let closed = 0;

  for (const s of open as Record<string, unknown>[]) {
    const updates: Record<string, unknown> = {
      ended_at: endedAt,
      status: 'auto_closed',
    };
    try {
      await postToSheet({
        action: 'end',
        id: String(s.id),
        end: yekHHMM(endedAt),
        hours: calcHours(String(s.started_at), endedAt),
        status: 'закрыта автоматически',
        comment: '',
      });
      updates.sheet_synced_end = true;
    } catch {
      updates.sheet_synced_end = false;
    }
    await supabase.from('staff_shifts').update(updates).eq('id', s.id);
    closed++;
  }
  console.log(`[shifts-autoclose] closed ${closed} shifts`);
  return { closed };
}

// ── Autoclose cron router ─────────────────────────────────────────────────────

export function buildShiftsAutocloseRoute(): Router {
  const r = Router();
  r.get('/run/shifts-autoclose', handleAutoclose);
  r.post('/run/shifts-autoclose', handleAutoclose);
  return r;

  async function handleAutoclose(req: Request, res: Response) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers['x-cron-secret'] !== secret && req.query.key !== secret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const result = await autoCloseShifts();
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  }
}

// ── Shifts API router ─────────────────────────────────────────────────────────

export function buildShiftsRouter(): Router {
  const r = Router();

  r.use('/kviz/api/shifts', (req: Request, res: Response, next) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // GET /users — for replacement picker (exclude self)
  r.get('/kviz/api/shifts/users', async (req, res) => {
    const session = getSession(req)!;
    try {
      const { data, error } = await supabase
        .from('app_users').select('id, login, display_name').order('display_name');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json((data ?? []).filter((u: Record<string, unknown>) => String(u.id) !== session.id));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /current — my open shift + who's currently on shift
  r.get('/kviz/api/shifts/current', async (req, res) => {
    const session = getSession(req)!;
    try {
      const [myRes, allRes] = await Promise.all([
        supabase.from('staff_shifts').select('*').eq('user_id', session.id)
          .order('started_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('staff_shifts').select('user_id, user_name, started_at').eq('status', 'open'),
      ]);
      res.json({
        my_shift: myRes.data ?? null,
        on_shift: (allRes.data ?? []).filter((s: Record<string, unknown>) => String(s.user_id) !== session.id).map((s: Record<string, unknown>) => ({
          name: String(s.user_name),
          started_at: String(s.started_at),
        })),
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST /start
  r.post('/kviz/api/shifts/start', async (req, res) => {
    const session = getSession(req)!;
    try {
      const { data: existing } = await supabase.from('staff_shifts')
        .select('id').eq('user_id', session.id).eq('status', 'open').maybeSingle();
      if (existing) { res.status(409).json({ error: 'Смена уже открыта' }); return; }

      const b = req.body as Record<string, unknown>;
      const now   = new Date().toISOString();
      const today = yekToday();

      const { data: shift, error } = await supabase.from('staff_shifts')
        .insert({
          user_id: session.id,
          user_login: session.login,
          user_name: session.display_name,
          date: today,
          started_at: now,
          status: 'open',
          replacing: b.replacing || null,
          comment: b.comment || null,
          sheet_synced_start: false,
          sheet_synced_end: false,
          sheet_sync_attempts: 0,
        })
        .select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Auto-mark "Открыть смену" task if not yet done
      try {
        const { data: tpl } = await supabase.from('manager_task_templates')
          .select('id').ilike('title', '%открыт%смен%').eq('is_active', true).maybeSingle();
        if (tpl) {
          const { data: done } = await supabase.from('manager_task_done')
            .select('id').eq('template_id', tpl.id).eq('task_date', today).maybeSingle();
          if (!done) {
            await supabase.from('manager_task_done').insert({
              template_id: tpl.id,
              task_date: today,
              done_by: session.id,
              done_by_name: session.display_name,
              done_at: now,
            });
          }
        }
      } catch { /* non-fatal */ }

      let sheetOk = false;
      try {
        await postToSheet({
          action: 'start', id: String(shift.id),
          date: yekDateDDMMYYYY(now),
          name: session.display_name, login: session.login,
          start: yekHHMM(now),
          replacing: b.replacing ?? '',
          comment: b.comment ?? '',
        });
        sheetOk = true;
        await supabase.from('staff_shifts').update({ sheet_synced_start: true }).eq('id', shift.id);
      } catch { /* retry later */ }

      res.json({ ...shift, sheet_synced_start: sheetOk });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST /end
  r.post('/kviz/api/shifts/end', async (req, res) => {
    const session = getSession(req)!;
    try {
      const { data: shift } = await supabase.from('staff_shifts')
        .select('*').eq('user_id', session.id).eq('status', 'open').maybeSingle();
      if (!shift) { res.status(404).json({ error: 'Нет открытой смены' }); return; }

      const b   = req.body as Record<string, unknown>;
      const now = new Date().toISOString();
      const { data: updated, error } = await supabase.from('staff_shifts')
        .update({ ended_at: now, status: 'closed', comment_end: b.comment || null })
        .eq('id', shift.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      let sheetOk = false;
      try {
        await postToSheet({
          action: 'end', id: String(shift.id),
          end: yekHHMM(now),
          hours: calcHours(String(shift.started_at), now),
          status: 'закрыта',
          comment: b.comment ?? '',
        });
        sheetOk = true;
        await supabase.from('staff_shifts').update({ sheet_synced_end: true }).eq('id', shift.id);
      } catch { /* retry later */ }

      res.json({ ...updated, sheet_synced_end: sheetOk });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /shifts?from=&to= — admin only
  r.get('/kviz/api/shifts', async (req, res) => {
    if (getSession(req)!.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      let q = supabase.from('staff_shifts').select('*').order('started_at', { ascending: false }).limit(1000);
      if (req.query.from) q = q.gte('date', String(req.query.from));
      if (req.query.to)   q = q.lte('date', String(req.query.to));
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // PATCH /shifts/:id — admin only; re-sends end row to sheet
  r.patch('/kviz/api/shifts/:id', async (req, res) => {
    if (getSession(req)!.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      const b = req.body as Record<string, unknown>;
      const allowed: Record<string, unknown> = {};
      const timeEdited = b.started_at !== undefined || b.ended_at !== undefined;
      if (b.started_at  !== undefined) allowed.started_at  = b.started_at;
      if (b.ended_at    !== undefined) allowed.ended_at    = b.ended_at;
      if (b.status      !== undefined) allowed.status      = b.status;
      if (b.replacing   !== undefined) allowed.replacing   = b.replacing;
      if (b.comment     !== undefined) allowed.comment     = b.comment;
      if (b.comment_end !== undefined) allowed.comment_end = b.comment_end;
      if (timeEdited) { allowed.sheet_synced_end = false; allowed.sheet_sync_attempts = 0; }

      const { data, error } = await supabase.from('staff_shifts')
        .update(allowed).eq('id', req.params.id).select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      if (data?.ended_at && data?.started_at) {
        const statusLabel = data.status === 'auto_closed' ? 'закрыта автоматически' : 'закрыта';
        try {
          await postToSheet({
            action: 'end', id: String(data.id),
            end: yekHHMM(String(data.ended_at)),
            hours: calcHours(String(data.started_at), String(data.ended_at)),
            status: statusLabel,
            comment: String(data.comment_end ?? ''),
          });
          await supabase.from('staff_shifts').update({ sheet_synced_end: true }).eq('id', data.id);
          data.sheet_synced_end = true;
        } catch { /* non-fatal — will retry via watch */ }
      }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
