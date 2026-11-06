import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, runControl } from '../jobs/control';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function requireAdmin(req: Request, res: Response): boolean {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (s.role !== 'admin') { res.status(403).json({ error: 'Только для администратора' }); return false; }
  return true;
}

function n(v: unknown, def = 0): number {
  const x = Number(v);
  return isNaN(x) ? def : x;
}

function b(v: unknown, def = false): boolean {
  if (v === undefined || v === null) return def;
  if (typeof v === 'boolean') return v;
  return String(v) === 'true';
}

function str(v: unknown, def = ''): string {
  if (v === undefined || v === null) return def;
  return String(v);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function buildControlRouter(): Router {
  const r = Router();

  // ── Settings ─────────────────────────────────────────────────────────────

  r.get('/kviz/api/control/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const cfg = await loadSettings();
      res.json(cfg);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.put('/kviz/api/control/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const s = getSession(req)!;
    const body = req.body as Record<string, unknown>;
    // Validate types
    const errors: string[] = [];
    const patch: Record<string, unknown> = {};

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const timeFields = ['open_time', 'close_time_weekday', 'close_time_weekend', 'fix_deadline_time'];
    for (const f of timeFields) {
      if (f in body) {
        const v = str(body[f]);
        if (!timeRe.test(v)) { errors.push(`${f}: нужен формат ЧЧ:ММ`); }
        else patch[f] = v;
      }
    }

    const numFields: Array<[string, number, number]> = [
      ['fix_rate', 0, 1_000_000], ['standard_price', 0, 100_000],
      ['s1_contact_minutes', 1, 240], ['s1_grace_count', 0, 10], ['s1_grace_max_minutes', 1, 240],
      ['s2_random_per_shift', 0, 20],
      ['s3_task_max_days', 1, 30],
      ['s4_sessions_left', 1, 20], ['s4_ended_contact_days', 1, 30],
      ['s4_no_visit_days', 1, 60], ['s4_retry_days', 1, 30],
      ['s5_mark_minutes', 5, 240],
    ];
    for (const [field, min, max] of numFields) {
      if (field in body) {
        const v = n(body[field]);
        if (v < min || v > max) errors.push(`${field}: значение от ${min} до ${max}`);
        else patch[field] = v;
      }
    }

    const boolFields = ['enabled','alerts_to_agent','show_to_managers',
      's1_enabled','s2_enabled','s2_unreviewed_counts',
      's3_enabled','s4_enabled','s5_enabled'];
    for (const f of boolFields) {
      if (f in body) patch[f] = b(body[f]);
    }

    const arrayFields = ['s3_booked_stage_ids', 's3_checks', 's4_checks', 's5_checks'];
    for (const f of arrayFields) {
      if (f in body) patch[f] = arr(body[f]);
    }

    if (errors.length) { res.status(400).json({ error: errors.join('; ') }); return; }

    try {
      await saveSettings(patch as Parameters<typeof saveSettings>[0], s.display_name);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Funnel stages (for booked stage selector) ─────────────────────────────

  r.get('/kviz/api/control/funnel-stages', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      // Look up UUID for "Новые заявки" (fitbase_id=1) first
      const { data: funnel } = await supabase
        .from('crm_funnels')
        .select('id')
        .eq('branch_id', BRANCH_ID)
        .eq('fitbase_id', 1)
        .maybeSingle();
      if (!funnel?.id) { res.json([]); return; }
      const { data, error } = await supabase
        .from('crm_funnel_stages')
        .select('id,name,kind,funnel_id,fitbase_id')
        .eq('funnel_id', funnel.id)
        .eq('is_archived', false)
        .order('sort');
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  r.get('/kviz/api/control/summary', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const from = str(req.query.from) || new Date(Date.now() + 5*3600_000).toISOString().slice(0, 10);
    const to   = str(req.query.to)   || from;
    try {
      const { data: scores, error } = await supabase
        .from('control_shift_scores')
        .select('shift_date,owner_name,standard_num,result,violations_count,amount,is_final')
        .eq('branch_id', BRANCH_ID)
        .gte('shift_date', from)
        .lte('shift_date', to)
        .order('shift_date')
        .order('owner_name')
        .order('standard_num');
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Load shift marks for the period (for UI display)
      const { data: shiftMarks } = await supabase
        .from('control_shift_marks')
        .select('shift_date,user_name,source')
        .eq('branch_id', BRANCH_ID)
        .gte('shift_date', from)
        .lte('shift_date', to);
      const shiftByDate: Record<string, { names: string[]; source: string }> = {};
      for (const m of shiftMarks ?? []) {
        const k = String(m.shift_date);
        if (!shiftByDate[k]) shiftByDate[k] = { names: [], source: String(m.source ?? 'control_shift_marks') };
        shiftByDate[k].names.push(String(m.user_name));
      }

      const cfg = await loadSettings();

      // Build per-person per-day summary
      const personDayMap = new Map<string, Map<string, Record<string, unknown>>>();
      for (const s of scores ?? []) {
        const key = `${s.owner_name}:${s.shift_date}`;
        if (!personDayMap.has(s.owner_name)) personDayMap.set(s.owner_name, new Map());
        const dayMap = personDayMap.get(s.owner_name)!;
        if (!dayMap.has(s.shift_date)) {
          dayMap.set(s.shift_date, {
            date: s.shift_date, standards: {},
            earned: 0, earned_new: 0,
          });
        }
        const day = dayMap.get(s.shift_date)!;
        (day.standards as Record<string, unknown>)[String(s.standard_num)] = {
          result: s.result, violations: s.violations_count, amount: s.amount, is_final: s.is_final,
        };
        (day.earned as number); // calc below
      }

      // Compute totals
      const persons: unknown[] = [];
      for (const [person, days] of personDayMap) {
        let totalEarned = 0;
        let totalOld = 0;
        const daysArr: unknown[] = [];
        for (const [date, day] of days) {
          const stds = day.standards as Record<string, Record<string,unknown>>;
          let dayEarned = cfg.fix_rate; // fix
          for (const stdData of Object.values(stds)) {
            dayEarned += Number(stdData.amount ?? 0);
          }
          day.earned = dayEarned;
          totalEarned += dayEarned;
          totalOld += 15000;
          daysArr.push(day);
        }
        persons.push({ person, days: daysArr, total_earned: totalEarned, total_old: totalOld });
      }

      res.json({ from, to, persons, fix_rate: cfg.fix_rate, standard_price: cfg.standard_price, shift_info: shiftByDate });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Violations list for a cell ────────────────────────────────────────────

  r.get('/kviz/api/control/violations', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const date     = str(req.query.date);
    const owner    = str(req.query.owner);
    const stdNum   = req.query.standard ? n(req.query.standard) : undefined;
    try {
      let q = supabase
        .from('control_violations')
        .select('*')
        .eq('branch_id', BRANCH_ID)
        .order('created_at', { ascending: false });
      if (date)   q = q.eq('shift_date', date);
      if (owner)  q = q.or(`owner_name.eq.${owner},is_shared.eq.true`);
      if (stdNum) q = q.eq('standard_num', stdNum);
      const { data, error } = await q.limit(200);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Waive violation ───────────────────────────────────────────────────────

  r.post('/kviz/api/control/violations/:id/waive', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const s = getSession(req)!;
    const body = req.body as Record<string, unknown>;
    const reason = str(body.reason).trim();
    if (!reason) { res.status(400).json({ error: 'Причина снятия обязательна' }); return; }
    try {
      const { error } = await supabase
        .from('control_violations')
        .update({
          status: 'waived', waived_by: s.display_name,
          waived_reason: reason, updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }

      try { await supabase.from('crm_audit_log').insert({
        branch_id: BRANCH_ID, actor: s.display_name, action: 'control_waive',
        entity_type: 'control_violation', entity_id: req.params.id,
        details: { reason },
      }); } catch {}

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Quality reviews ───────────────────────────────────────────────────────

  r.get('/kviz/api/control/quality-reviews', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const date    = str(req.query.date);
    const manager = str(req.query.manager);
    try {
      let q = supabase
        .from('control_quality_reviews')
        .select('*')
        .eq('branch_id', BRANCH_ID)
        .order('updated_at', { ascending: false });
      if (date)    q = q.eq('shift_date', date);
      if (manager) q = q.eq('manager_name', manager);
      const { data, error } = await q.limit(100);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.post('/kviz/api/control/quality-reviews/:id/review', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const s = getSession(req)!;
    const body = req.body as Record<string, unknown>;
    const c1 = b(body.c1_needs);
    const c2 = b(body.c2_presented);
    const c3 = b(body.c3_objections);
    const c4 = b(body.c4_outcome);
    const comment = str(body.comment);
    try {
      const { data: review, error } = await supabase
        .from('control_quality_reviews')
        .update({
          c1_needs: c1, c2_presented: c2, c3_objections: c3, c4_outcome: c4,
          comment, reviewed_by: s.display_name, reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('branch_id', BRANCH_ID)
        .select()
        .single();
      if (error) { res.status(500).json({ error: error.message }); return; }

      // Create violation if any checklist item is 'no'
      if (!c1 || !c2 || !c3 || !c4) {
        const cfg = await loadSettings();
        const fixDeadline = new Date(
          Date.now() + 5*3600_000 + 86400_000
        ).toISOString().slice(0, 10) + 'T' + cfg.fix_deadline_time + ':00+05:00';

        const details = [
          !c1 && 'не выяснила потребность',
          !c2 && 'не презентовала',
          !c3 && 'не отработала возражения',
          !c4 && 'нет понятного итога',
        ].filter(Boolean).join(', ');

        await upsertControlViolation({
          dedup_key: `s2_flagged:${review.client_key}:${review.shift_date}`,
          shift_date: review.shift_date, standard_num: 2, check_code: 's2_flagged',
          owner_name: review.manager_name, is_shared: false,
          entity_id: String(review.client_key), entity_label: String(review.client_key),
          details: `Качество диалога: ${details}`,
          how_to_fix: 'Доработайте диалог по чек-листу',
          fix_deadline: fixDeadline,
        });
      }

      res.json({ ok: true, review });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Recompute a day — delete + rerun ─────────────────────────────────────

  r.post('/kviz/api/control/recompute', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const date = str(req.query.date || req.body?.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Нужен параметр date в формате YYYY-MM-DD' }); return;
    }
    try {
      // Delete violations (keep waived — human decisions)
      await supabase.from('control_violations').delete()
        .eq('branch_id', BRANCH_ID).eq('shift_date', date).neq('status', 'waived');
      // Delete scores
      await supabase.from('control_shift_scores').delete()
        .eq('branch_id', BRANCH_ID).eq('shift_date', date);
      // Delete unreviewed quality reviews
      await supabase.from('control_quality_reviews').delete()
        .eq('branch_id', BRANCH_ID).eq('shift_date', date).is('reviewed_at', null);

      res.json({ ok: true, message: `День ${date} очищен, пересчёт запущен` });
      // Fire-and-forget recompute (past date = finalize)
      runControl(true, date).catch(e => console.error('[control] recompute run:', (e as Error).message));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}

interface VInput {
  dedup_key: string; shift_date: string; standard_num: number; check_code: string;
  owner_name: string | null; is_shared: boolean; entity_id: string; entity_label: string;
  details: string; how_to_fix: string; fix_deadline: string;
}

async function upsertControlViolation(v: VInput): Promise<void> {
  await supabase.from('control_violations').upsert({
    ...v, branch_id: BRANCH_ID, updated_at: new Date().toISOString(),
  }, { onConflict: 'dedup_key', ignoreDuplicates: false });
}
