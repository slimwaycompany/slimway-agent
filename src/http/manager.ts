import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

const YEK_MS = 5 * 3600_000;

function yekNow() { return new Date(Date.now() + YEK_MS); }
function yekToday() { return yekNow().toISOString().slice(0, 10); }
function isWeekend() { const d = yekNow().getUTCDay(); return d === 0 || d === 6; }
function isoDowNow() { const d = yekNow().getUTCDay(); return d === 0 ? 7 : d; }
function slotMin(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function nowMin() { const d = yekNow(); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function hhmmOf(slot: string) { return slot.slice(0, 5); }

function taskStatus(sm: number, now: number, done: boolean): 'done' | 'current' | 'overdue' | 'pending' {
  if (done) return 'done';
  if (now < sm) return 'pending';
  if (now < sm + 30) return 'current';
  return 'overdue';
}

function weekdayOk(weekdays: unknown, dow: number): boolean {
  if (!weekdays) return true;
  return (weekdays as number[]).includes(dow);
}

function requireAdmin(req: Request, res: Response): boolean {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (s.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return false; }
  return true;
}

// Exported for watch.ts: returns today's overdue undone template IDs + titles
export async function getOverdueMissed(nowMs: number): Promise<{ templateId: string; title: string; slotHHMM: string }[]> {
  const YEK_MS_L = 5 * 3600_000;
  const today = new Date(nowMs + YEK_MS_L).toISOString().slice(0, 10);
  const d     = new Date(nowMs + YEK_MS_L);
  const now   = d.getUTCHours() * 60 + d.getUTCMinutes();
  const isWknd = (() => { const dd = d.getUTCDay(); return dd === 0 || dd === 6; })();
  const isoDow = (() => { const dd = d.getUTCDay(); return dd === 0 ? 7 : dd; })();

  const [tplRes, doneRes] = await Promise.all([
    supabase.from('manager_task_templates').select('id, title, slot_time, weekend_time, weekdays, scope').eq('is_active', true),
    supabase.from('manager_task_done').select('template_id').eq('task_date', today),
  ]);
  const doneIds = new Set((doneRes.data || []).map((d: Record<string, unknown>) => String(d.template_id)));
  return ((tplRes.data || []) as Record<string, unknown>[])
    .filter(t => (t.scope ?? 'shared') === 'shared') // personal tasks don't have a single overdue state
    .filter(t => weekdayOk(t.weekdays, isoDow))
    .filter(t => !doneIds.has(String(t.id)))
    .map(t => {
      const raw = isWknd && t.weekend_time ? String(t.weekend_time) : String(t.slot_time);
      const hhmm = raw.slice(0, 5);
      const sm = slotMin(hhmm);
      return { templateId: String(t.id), title: String(t.title), slotHHMM: hhmm, sm };
    })
    .filter(t => now >= t.sm + 30) // overdue = 30 min past slot
    .map(({ sm: _, ...rest }) => rest);
}

export function buildManagerRouter(): Router {
  const r = Router();

  r.use('/kviz/api/manager', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  r.use('/kviz/api/reports', (req: Request, res: Response, next: NextFunction) => {
    const s = getSession(req);
    if (!s) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (s.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    next();
  });

  // GET /today — full day data
  r.get('/kviz/api/manager/today', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today   = yekToday();
      const weekend = isWeekend();
      const now     = nowMin();
      const isoDow  = isoDowNow();

      const [tplRes, doneRes] = await Promise.all([
        supabase.from('manager_task_templates').select('*').eq('is_active', true).order('sort'),
        supabase.from('manager_task_done').select('*').eq('task_date', today),
      ]);
      const templates = ((tplRes.data || []) as Record<string, unknown>[])
        .filter(t => weekdayOk(t.weekdays, isoDow));
      const done      = (doneRes.data || []) as Record<string, unknown>[];
      // shared: first match by template_id; personal: match by template_id + current user
      const doneShared   = new Map(done.map(d => [String(d.template_id), d]));
      const donePersonal = new Map(
        done.filter(d => String(d.done_by) === session.id).map(d => [String(d.template_id), d]),
      );
      const doneMap = { shared: doneShared, personal: donePersonal };

      const storySlots = [...new Set(templates.filter(t => t.stories_slot).map(t => String(t.stories_slot)))];
      const ideasBySlot: Record<string, Record<string, unknown>[]> = {};
      if (storySlots.length > 0) {
        const { data: ideas } = await supabase.from('stories_ideas').select('*')
          .eq('is_active', true).in('slot', storySlots).order('sort');
        for (const idea of (ideas || []) as Record<string, unknown>[]) {
          const s = String(idea.slot);
          (ideasBySlot[s] ??= []).push(idea);
        }
      }

      // Day-of-year for round-robin stories (no same-day repeat)
      const d0      = yekNow();
      const dayOfYear = Math.floor((d0.getTime() - new Date(Date.UTC(d0.getUTCFullYear(), 0, 1)).getTime()) / 86400_000);

      const tasks = templates.map(t => {
        const rawSlot  = weekend && t.weekend_time ? String(t.weekend_time) : String(t.slot_time);
        const hhmm     = hhmmOf(rawSlot);
        const sm       = slotMin(hhmm);
        const scope    = (t.scope as string) ?? 'shared';
        const doneRec  = scope === 'personal' ? doneMap.personal.get(String(t.id)) : doneMap.shared.get(String(t.id));
        const status   = taskStatus(sm, now, !!doneRec);
        const task: Record<string, unknown> = {
          id: t.id, title: t.title, hint: t.hint, category: t.category,
          slot_time: hhmm, slot_min: sm, status, scope,
          done: doneRec ? { done_id: doneRec.id, done_by: doneRec.done_by, done_by_name: doneRec.done_by_name, done_at: doneRec.done_at } : null,
        };
        if (t.stories_slot) {
          const ideas = ideasBySlot[String(t.stories_slot)] || [];
          const offset = ideas.length > 0 ? dayOfYear % ideas.length : 0;
          task.stories_today = [ideas[offset % ideas.length], ideas[(offset + 1) % ideas.length]].filter(Boolean);
          task.stories_all   = ideas;
        }
        return task;
      });

      const DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
      res.json({
        date: today,
        day_of_week: DAYS[yekNow().getUTCDay()],
        is_weekend: weekend,
        user: { id: session.id, display_name: session.display_name, role: session.role },
        tasks,
        stats: {
          total: tasks.length,
          done: tasks.filter(t => t.status === 'done').length,
          overdue: tasks.filter(t => t.status === 'overdue').length,
        },
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /week-reels — this week's reel tasks with completion status
  r.get('/kviz/api/manager/week-reels', async (_req, res) => {
    try {
      const now     = yekNow();
      const today   = yekToday();
      const isoDow  = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
      // Monday of current week
      const mon = new Date(now);
      mon.setUTCDate(now.getUTCDate() - (isoDow - 1));
      const monday = mon.toISOString().slice(0, 10);
      const sunday = new Date(mon.getTime() + 6 * 86400_000).toISOString().slice(0, 10);

      const [tplRes, doneRes] = await Promise.all([
        supabase.from('manager_task_templates')
          .select('id, title, weekdays, stories_slot')
          .eq('is_active', true)
          .not('stories_slot', 'is', null),
        supabase.from('manager_task_done')
          .select('template_id, task_date')
          .gte('task_date', monday)
          .lte('task_date', sunday),
      ]);

      const doneSet = new Set(
        ((doneRes.data || []) as Record<string, unknown>[]).map(d => `${d.template_id}:${d.task_date}`),
      );
      const DAYS_RU = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

      const result = ((tplRes.data || []) as Record<string, unknown>[])
        .flatMap(t => {
          const days = (t.weekdays as number[] | null) ?? [];
          if (days.length === 0) return [];
          return days.map(dow => {
            const offset = dow - isoDow;
            const dObj = new Date(now);
            dObj.setUTCDate(now.getUTCDate() + offset);
            const date = dObj.toISOString().slice(0, 10);
            const isDone = doneSet.has(`${t.id}:${date}`);
            const isPast = date < today;
            return {
              id: t.id, title: t.title,
              day_iso: dow, day_name: DAYS_RU[dow] ?? String(dow),
              date,
              status: isDone ? 'done' : isPast ? 'overdue' : 'pending',
            };
          });
        })
        .sort((a, b) => a.day_iso - b.day_iso);

      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST /tasks/:id/done
  r.post('/kviz/api/manager/tasks/:id/done', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today = yekToday();
      const tid   = req.params.id;
      const { data: tpl } = await supabase.from('manager_task_templates').select('scope').eq('id', tid).maybeSingle();
      const scope = (tpl?.scope as string) ?? 'shared';
      // Use limit(1) — after constraint change multiple rows per template/date are possible for different users
      const baseQ = supabase.from('manager_task_done')
        .select('id, done_by_name, done_at').eq('template_id', tid).eq('task_date', today);
      const { data: exArr } = await (scope === 'personal' ? baseQ.eq('done_by', session.id) : baseQ).limit(1);
      const ex = (exArr as Record<string, unknown>[] | null)?.[0] ?? null;
      if (ex) {
        const message = scope === 'shared' && ex.done_by_name
          ? `уже сделал(а) ${ex.done_by_name} в ${new Date(String(ex.done_at)).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}`
          : null;
        res.json({ ok: true, already: true, message }); return;
      }
      const { data, error } = await supabase.from('manager_task_done')
        .insert({ template_id: tid, task_date: today, done_by: session.id, done_by_name: session.display_name, done_at: new Date().toISOString() })
        .select().single();
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, done: data });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // DELETE /tasks/:id/done
  r.delete('/kviz/api/manager/tasks/:id/done', async (req, res) => {
    const session = getSession(req)!;
    try {
      const today = yekToday();
      const tid   = req.params.id;
      const { data: tpl } = await supabase.from('manager_task_templates').select('scope').eq('id', tid).maybeSingle();
      const scope = (tpl?.scope as string) ?? 'shared';
      // Non-admin can only delete their own record; admin can delete any (first found)
      const delQ = supabase.from('manager_task_done')
        .select('id, done_by').eq('template_id', tid).eq('task_date', today);
      const { data: exArr } = await (session.role === 'admin' && scope === 'shared'
        ? delQ : delQ.eq('done_by', session.id)).limit(1);
      const ex = (exArr as Record<string, unknown>[] | null)?.[0] ?? null;
      if (!ex) { res.json({ ok: true, not_found: true }); return; }
      await supabase.from('manager_task_done').delete().eq('id', String(ex.id));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET /history
  r.get('/kviz/api/manager/history', async (req, res) => {
    try {
      let q = supabase.from('manager_task_done')
        .select('*, manager_task_templates!inner(title, slot_time, category)')
        .order('task_date', { ascending: false }).order('done_at', { ascending: true }).limit(300);
      if (req.query.from) q = q.gte('task_date', String(req.query.from));
      if (req.query.to)   q = q.lte('task_date', String(req.query.to));
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Admin: templates ─────────────────────────────────────────────────────────

  r.get('/kviz/api/manager/templates', async (_req, res) => {
    const { data, error } = await supabase.from('manager_task_templates').select('*').order('sort');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/manager/templates', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await supabase.from('manager_task_templates')
      .insert({ title: b.title, hint: b.hint || null, category: b.category || 'other',
                slot_time: b.slot_time, weekend_time: b.weekend_time || null,
                stories_slot: b.stories_slot || null, sort: b.sort ?? 99, is_active: b.is_active !== false,
                weekdays: b.weekdays ?? null })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.patch('/kviz/api/manager/templates/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase.from('manager_task_templates')
      .update(req.body as Record<string, unknown>).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  // ── Admin: ideas ─────────────────────────────────────────────────────────────

  r.get('/kviz/api/manager/ideas', async (req, res) => {
    let q = supabase.from('stories_ideas').select('*').order('slot').order('sort');
    if (req.query.slot) q = (q as any).eq('slot', String(req.query.slot));
    const { data, error } = await q;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.post('/kviz/api/manager/ideas', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const { data, error } = await supabase.from('stories_ideas')
      .insert({ slot: b.slot, idea: b.idea, caption: b.caption || null, sort: b.sort ?? 99, is_active: b.is_active !== false })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.patch('/kviz/api/manager/ideas/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { data, error } = await supabase.from('stories_ideas')
      .update(req.body as Record<string, unknown>).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  // ── Reports (admin only) ──────────────────────────────────────────────────────

  r.get('/kviz/api/reports/tasks', async (req, res) => {
    try {
      const session = getSession(req);
      let q = supabase.from('manager_task_done')
        .select('*, manager_task_templates!inner(title, slot_time, category, weekdays)')
        .order('task_date', { ascending: false }).order('done_at', { ascending: true }).limit(500);
      if (req.query.from) q = q.gte('task_date', String(req.query.from));
      if (req.query.to)   q = q.lte('task_date', String(req.query.to));
      // manager sees only own tasks; admin can filter by user or see all
      if (session?.role !== 'admin') {
        q = q.eq('done_by', session?.login ?? '');
      } else if (req.query.user) {
        q = q.eq('done_by_name', String(req.query.user));
      } else if (req.query.mine === '1') {
        q = q.eq('done_by', session?.login ?? '');
      }
      const { data, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/kviz/api/reports/studio', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('studio_results')
        .select('*, body_clients!inner(name, phone)')
        .order('sent_at', { ascending: false }).limit(500);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // InBody report: clients with tests, aggregated (groups by phone_digits)
  r.get('/kviz/api/reports/inbody', async (req, res) => {
    try {
      let q = supabase.from('inbody_tests')
        .select('id,inbody_id,tested_at,phone,phone_digits,weight,bfm,smm,pbf,inbody_score')
        .order('tested_at', { ascending: true });
      if (req.query.from) q = q.gte('tested_at', String(req.query.from));
      if (req.query.to)   q = q.lte('tested_at', String(req.query.to) + 'T23:59:59');
      const { data: tests, error } = await q;
      if (error) { res.status(500).json({ error: error.message }); return; }

      type IbTest = { id: string; inbody_id: string; tested_at: string; phone: string | null; phone_digits: string | null; weight: number | null; bfm: number | null; smm: number | null; pbf: number | null; inbody_score: number | null };
      const allTests = (tests ?? []) as IbTest[];

      // Group by phone_digits
      const byDigits = new Map<string, IbTest[]>();
      for (const t of allTests) {
        const d = t.phone_digits ?? (t.phone ?? '').replace(/\D/g,'').slice(-10);
        if (!d) continue;
        if (!byDigits.has(d)) byDigits.set(d, []);
        byDigits.get(d)!.push(t);
      }

      // Lookup names from body_clients via phone_digits
      const digits = [...byDigits.keys()];
      const { data: clients } = digits.length
        ? await supabase.from('body_clients').select('id,name,phone,phone_digits').in('phone_digits', digits)
        : { data: [] };
      type ClientRow = { id: string; name: string; phone: string | null; phone_digits: string };
      const clientByDigits = new Map((clients ?? [] as ClientRow[]).map((c: ClientRow) => [c.phone_digits, c]));

      const rows = [...byDigits.entries()].map(([d, ts]) => {
        const sorted = ts.sort((a, b) => a.tested_at.localeCompare(b.tested_at));
        const first = sorted[0], last = sorted[sorted.length - 1];
        const client = clientByDigits.get(d);
        return {
          phone_digits: d,
          client_id: client?.id ?? null,
          name: client?.name ?? first.inbody_id,
          phone: client?.phone ?? first.phone,
          count: sorted.length,
          first_date: first.tested_at?.slice(0,10),
          last_date:  last.tested_at?.slice(0,10),
          weight_delta: first.weight != null && last.weight != null ? Number(last.weight) - Number(first.weight) : null,
          bfm_delta:    first.bfm != null    && last.bfm != null    ? Number(last.bfm)   - Number(first.bfm)   : null,
          smm_delta:    first.smm != null    && last.smm != null    ? Number(last.smm)   - Number(first.smm)   : null,
          pbf_delta:    first.pbf != null    && last.pbf != null    ? Number(last.pbf)   - Number(first.pbf)   : null,
          score_first:  first.inbody_score,
          score_last:   last.inbody_score,
        };
      }).sort((a, b) => b.count - a.count);

      const totals = {
        tests: allTests.length,
        clients: rows.length,
        bfm_lost: rows.reduce((s, r) => s + (r.bfm_delta != null && r.bfm_delta < 0 ? -r.bfm_delta : 0), 0),
        smm_gained: rows.reduce((s, r) => s + (r.smm_delta != null && r.smm_delta > 0 ? r.smm_delta : 0), 0),
      };

      res.json({ rows, totals, from: req.query.from ?? null, to: req.query.to ?? null });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
