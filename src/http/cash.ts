import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { getSession } from './auth';
import { runFitbaseOps } from '../jobs/fitbaseOps';
import { acquireLock, releaseLock } from '../core/lock';
import path from 'path';
import fs from 'fs';

const YEK_MS = 5 * 3600_000;
function yekToday() { return new Date(Date.now() + YEK_MS).toISOString().slice(0, 10); }

// Default shift end: weekday 22:00, weekend 20:00 (Asia/Yekaterinburg)
function defaultShiftEnd(today: string): string {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0=Sun, 6=Sat
  const endHour = (dow === 0 || dow === 6) ? 20 : 22;
  return `${today}T${String(endHour).padStart(2,'0')}:00:00+05:00`;
}

export function buildCashRouter(): Router {
  const r = Router();

  r.use('/kviz/api/cash', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // POST /kviz/api/cash/sync — trigger Fitbase ops sync (admin only)
  r.post('/kviz/api/cash/sync', async (_req, res) => {
    const session = getSession(_req);
    if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    try {
      const locked = await acquireLock('fitbase-ops', 10 * 60);
      if (!locked) { res.json({ status: 'already_running' }); return; }
      const stats = await runFitbaseOps();
      await releaseLock('fitbase-ops');
      // Save sync time to DB
      supabase.from('sync_state').upsert({ key: 'fitbase_ops_synced_at', value: new Date().toISOString() }, { onConflict: 'key' });
      res.json({ ok: true, ...stats, synced_at: new Date().toISOString() });
    } catch (e) {
      await releaseLock('fitbase-ops').catch(() => {});
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /kviz/api/cash/sync-time — last sync time
  r.get('/kviz/api/cash/sync-time', async (_req, res) => {
    try {
      const { data } = await supabase.from('sync_state').select('value').eq('key', 'fitbase_ops_synced_at').maybeSingle();
      res.json({ synced_at: data?.value ?? null });
    } catch { res.json({ synced_at: null }); }
  });

  // GET today's ops from Supabase + shift times + last closing
  r.get('/kviz/api/cash/today', async (_req, res) => {
    const today = yekToday();
    try {
      // Ops from fitbase_operations
      const { data: opsData, error: opsErr } = await supabase
        .from('fitbase_operations')
        .select('fitbase_id,op_type,op_at,amount,pay_method,client_name,cashier,item')
        .eq('op_date', today)
        .order('op_at', { ascending: true });
      if (opsErr) throw new Error(opsErr.message);

      const ops = (opsData || []);
      let cash_in = 0, card_in = 0, cash_refund = 0, card_refund = 0, deposits = 0, withdrawals = 0;
      for (const op of ops) {
        const isCash = op.pay_method === 'cash';
        const amt = Number(op.amount ?? 0);
        if (op.op_type === 'sale')       { isCash ? (cash_in += amt) : (card_in += amt); }
        if (op.op_type === 'refund')     { isCash ? (cash_refund += amt) : (card_refund += amt); }
        if (op.op_type === 'deposit')    { deposits += amt; }
        if (op.op_type === 'withdrawal') { withdrawals += amt; }
      }

      const mappedOps = ops.map(op => ({
        id: op.fitbase_id,
        pay_ts: op.op_at,
        amount: Number(op.amount ?? 0),
        is_refund: op.op_type === 'refund',
        op_type: op.op_type,
        pay_method: op.pay_method ?? '',
        payment_type: op.pay_method ?? '',
        item_type: op.item ?? '',
        cashier: op.cashier ?? '',
        client: op.client_name ?? '',
      }));

      // Shift times: from staff_shifts or defaults
      const { data: shifts } = await supabase
        .from('staff_shifts')
        .select('started_at, ended_at')
        .gte('started_at', today + 'T00:00:00+05:00')
        .lt('started_at', today + 'T23:59:59+05:00')
        .order('started_at', { ascending: true });

      const shiftStart = (shifts ?? []).length > 0 ? shifts![0].started_at : `${today}T08:00:00+05:00`;
      const shiftEnds  = (shifts ?? []).filter(s => s.ended_at).map(s => s.ended_at!);
      const shiftEnd   = shiftEnds.length > 0 ? shiftEnds[shiftEnds.length - 1] : defaultShiftEnd(today);

      // Last closing (before today) + today's closing
      const [{ data: last }, { data: todayRec }, { data: syncState }] = await Promise.all([
        supabase.from('cash_closings').select('counted_cash,shift_date').lt('shift_date', today).order('shift_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cash_closings').select('*').eq('shift_date', today).maybeSingle(),
        supabase.from('sync_state').select('value').eq('key', 'fitbase_ops_synced_at').maybeSingle(),
      ]);

      res.json({
        today,
        totals: { cash_in, card_in, cash_refund, card_refund, deposits, withdrawals },
        ops: mappedOps,
        opening_from_last: last?.counted_cash ?? null,
        last_closing_date: last?.shift_date ?? null,
        today_closing: todayRec ?? null,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        synced_at: syncState?.value ?? null,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET sales report from Supabase for a date range (admin only)
  r.get('/kviz/api/reports/sales', async (req, res) => {
    const session = getSession(req)!;
    if (session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    const from = String(req.query.from || yekToday());
    const to   = String(req.query.to   || yekToday());
    try {
      const { data: opsData, error } = await supabase
        .from('fitbase_operations')
        .select('fitbase_id,op_type,op_at,amount,pay_method,client_name,cashier,manager,item,comment')
        .gte('op_date', from)
        .lte('op_date', to)
        .order('op_at', { ascending: true });
      if (error) throw new Error(error.message);

      const ops = opsData || [];
      let cash_sale = 0, card_sale = 0, cash_refund = 0, card_refund = 0;
      const byManager: Record<string, number> = {};
      const byCashier: Record<string, number> = {};
      const byPayMethod: Record<string, number> = {};
      const byOpType: Record<string, number> = {};

      const mapped = ops.map(op => {
        const isCash = op.pay_method === 'cash';
        const amt = Number(op.amount ?? 0);
        if (op.op_type === 'sale')   { isCash ? (cash_sale += amt) : (card_sale += amt); }
        if (op.op_type === 'refund') { isCash ? (cash_refund += amt) : (card_refund += amt); }
        if (op.op_type === 'sale') {
          const mgr = op.manager ?? '—';
          const csh = op.cashier ?? '—';
          const pm  = op.pay_method ?? 'other';
          byManager[mgr] = (byManager[mgr] || 0) + amt;
          byCashier[csh] = (byCashier[csh] || 0) + amt;
          byPayMethod[pm] = (byPayMethod[pm] || 0) + amt;
        }
        byOpType[op.op_type] = (byOpType[op.op_type] || 0) + amt;
        return {
          id: op.fitbase_id, pay_ts: op.op_at,
          amount: amt, is_refund: op.op_type === 'refund', op_type: op.op_type,
          payment_type: op.pay_method ?? '', item_type: op.item ?? '',
          cashier: op.cashier ?? '—', manager: op.manager ?? '—',
          client: op.client_name ?? '',
        };
      });

      res.json({
        from, to,
        totals: { cash_sale, card_sale, cash_refund, card_refund },
        by_manager: Object.entries(byManager).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        by_cashier: Object.entries(byCashier).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        by_pay_method: Object.entries(byPayMethod).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        by_op_type: Object.entries(byOpType).map(([name, amount]) => ({ name, amount })),
        ops: mapped,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET occupancy report from fitbase_visits (admin only)
  r.get('/kviz/api/reports/occupancy', async (req, res) => {
    const session = getSession(req)!;
    if (session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    const from = String(req.query.from || yekToday());
    const to   = String(req.query.to   || yekToday());
    try {
      let q = supabase
        .from('fitbase_visits')
        .select('fitbase_id,client_fitbase_id,client_name,client_phone,status,visit_at,visit_date,service,resource,abonement,is_trial')
        .gte('visit_date', from)
        .lte('visit_date', to)
        .order('visit_at', { ascending: true });
      if (req.query.resource) q = q.eq('resource', req.query.resource as string);
      if (req.query.abonement) q = q.eq('abonement', req.query.abonement as string);
      if (req.query.status !== undefined && req.query.status !== '') q = q.eq('status', Number(req.query.status));

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const visits = data || [];

      const resources  = [...new Set(visits.map(v => v.resource).filter(Boolean))] as string[];
      const abonements = [...new Set(visits.map(v => v.abonement).filter(Boolean))] as string[];
      const statuses   = [...new Set(visits.map(v => String(v.status ?? '')).filter(s => s !== ''))].sort();
      const total = visits.length;
      const uniqueClients = new Set(visits.map(v => v.client_fitbase_id).filter(Boolean)).size;

      res.json({ visits, resources, abonements, statuses, total, unique_clients: uniqueClients, from, to });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET closing Excel template (binary xlsx)
  r.get('/kviz/api/cash/closing-template', (_req, res) => {
    if (!getSession(_req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const tplPath = path.resolve('templates', 'zakrytie-smeny.xlsx');
    if (!fs.existsSync(tplPath)) { res.status(404).json({ error: 'Шаблон не найден' }); return; }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zakrytie-smeny-template.xlsx"');
    res.sendFile(tplPath);
  });

  // POST upsert today's closing (one per day)
  r.post('/kviz/api/cash/closing', async (req, res) => {
    const session = getSession(req)!;
    const today = yekToday();
    const b = req.body as Record<string, unknown>;

    const row: Record<string, unknown> = {
      shift_date:             today,
      closed_by:              session.display_name,
      closed_at:              new Date().toISOString(),
      opening_cash:           Number(b.opening_cash      ?? 0),
      cash_in:                Number(b.cash_in           ?? 0),
      noncash_in:             Number(b.noncash_in        ?? 0),
      noncash_out:            Number(b.noncash_out       ?? 0),
      refunds:                Number(b.refunds           ?? 0),
      deposits:               Number(b.deposits          ?? 0),
      withdrawals:            Number(b.withdrawals       ?? 0),
      expenses:               b.expenses                 ?? [],
      cash_count:             b.cash_count               ?? {},
      counted_cash:           b.counted_cash  != null ? Number(b.counted_cash)  : null,
      expected_cash:          b.expected_cash != null ? Number(b.expected_cash) : null,
      discrepancy:            b.discrepancy   != null ? Number(b.discrepancy)   : null,
      crm_discrepancy_note:   b.crm_discrepancy_note     ?? null,
      other_discrepancy_note: b.other_discrepancy_note   ?? null,
      remarks:                b.remarks                  ?? null,
      shift_start:            b.shift_start              ?? null,
      shift_end:              b.shift_end                ?? null,
      fitbase_ops:            b.fitbase_ops              ?? [],
    };

    const { data, error } = await supabase
      .from('cash_closings')
      .upsert(row, { onConflict: 'shift_date' })
      .select('*').single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  return r;
}
