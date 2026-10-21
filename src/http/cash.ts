import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';
import { paginateGet } from './fitbase';
import { getSession } from './auth';

const YEK_MS = 5 * 3600_000;
function yekToday() { return new Date(Date.now() + YEK_MS).toISOString().slice(0, 10); }

interface TillStep {
  id: number;
  pay_date: number; // unix ts
  amount: number;
  item_type: string;
  payment_type: string;
  payment_method: { id: number; name: string; system_name: string } | null;
  created_by_user: { full_name: string } | null;
  client: { id: number; full_name: string } | null;
}

export function buildCashRouter(): Router {
  const r = Router();

  r.use('/kviz/api/cash', (req: Request, res: Response, next: NextFunction) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // GET today's Fitbase ops + last closing's opening cash
  r.get('/kviz/api/cash/today', async (_req, res) => {
    const today = yekToday();
    try {
      const rawSteps = await paginateGet('/till-order-steps', {
        page_size: 100,
        pay_date_from: today,
        pay_date_to: today,
      });

      const steps = rawSteps as unknown as TillStep[];
      let cash_in = 0, card_in = 0, cash_refund = 0, card_refund = 0;

      const ops = steps.map(s => {
        const amount   = Number(s.amount ?? 0);
        const pm       = s.payment_method?.system_name ?? '';
        const isCash   = pm === 'cash';
        const isRefund = amount < 0;
        const absAmt   = Math.abs(amount);
        if (isRefund) { if (isCash) cash_refund += absAmt; else card_refund += absAmt; }
        else          { if (isCash) cash_in += absAmt; else card_in += absAmt; }
        const payTs = typeof s.pay_date === 'number' ? new Date(s.pay_date * 1000).toISOString() : String(s.pay_date);
        return {
          id: s.id, pay_ts: payTs, amount: absAmt, is_refund: isRefund,
          payment_type: s.payment_type ?? pm,
          item_type: s.item_type,
          cashier: s.created_by_user?.full_name ?? '',
          client: s.client?.full_name ?? '',
        };
      });

      const [{ data: last }, { data: todayRec }] = await Promise.all([
        supabase.from('cash_closings').select('counted_cash,shift_date').lt('shift_date', today).order('shift_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cash_closings').select('*').eq('shift_date', today).maybeSingle(),
      ]);

      res.json({
        today,
        totals: { cash_in, card_in, cash_refund, card_refund },
        ops,
        opening_from_last: last?.counted_cash ?? null,
        last_closing_date: last?.shift_date ?? null,
        today_closing: todayRec ?? null,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // GET sales report from Fitbase for a date range (admin only)
  r.get('/kviz/api/reports/sales', async (req, res) => {
    const session = getSession(req)!;
    if (session.role !== 'admin') { res.status(403).json({ error: 'Только admin' }); return; }
    const from = String(req.query.from || yekToday());
    const to   = String(req.query.to   || yekToday());
    try {
      const rawSteps = await paginateGet('/till-order-steps', {
        page_size: 100, pay_date_from: from, pay_date_to: to,
      });
      const steps = rawSteps as unknown as TillStep[];

      let cash_sale = 0, card_sale = 0, cash_refund = 0, card_refund = 0;
      const byManager: Record<string, number> = {};
      const byCashier: Record<string, number> = {};

      const ops = steps.map(s => {
        const amount   = Number(s.amount ?? 0);
        const pm       = s.payment_method?.system_name ?? '';
        const isCash   = pm === 'cash';
        const isRefund = amount < 0;
        const absAmt   = Math.abs(amount);
        const managerName  = (s as unknown as Record<string, unknown>)['manager']
          ? ((s as unknown as Record<string, unknown>)['manager'] as Record<string, unknown>)['full_name'] as string ?? '—'
          : '—';
        const cashierName  = s.created_by_user?.full_name ?? '—';

        if (isRefund) { if (isCash) cash_refund += absAmt; else card_refund += absAmt; }
        else          {
          if (isCash) cash_sale += absAmt; else card_sale += absAmt;
          byManager[managerName] = (byManager[managerName] || 0) + absAmt;
          byCashier[cashierName] = (byCashier[cashierName] || 0) + absAmt;
        }
        const payTs = typeof s.pay_date === 'number' ? new Date(s.pay_date * 1000).toISOString() : String(s.pay_date);
        return {
          id: s.id, pay_ts: payTs, amount: absAmt, is_refund: isRefund,
          payment_type: s.payment_type ?? pm, item_type: s.item_type,
          cashier: cashierName, manager: managerName,
          client: s.client?.full_name ?? '',
        };
      });

      res.json({
        from, to,
        totals: { cash_sale, card_sale, cash_refund, card_refund },
        by_manager: Object.entries(byManager).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        by_cashier: Object.entries(byCashier).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        ops,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POST upsert today's closing (one per day)
  r.post('/kviz/api/cash/closing', async (req, res) => {
    const session = getSession(req)!;
    const today = yekToday();
    const b = req.body as Record<string, unknown>;

    const row = {
      shift_date:             today,
      closed_by:              session.display_name,
      closed_at:              new Date().toISOString(),
      opening_cash:           Number(b.opening_cash      ?? 0),
      cash_in:                Number(b.cash_in           ?? 0),
      noncash_in:             Number(b.noncash_in        ?? 0),
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
