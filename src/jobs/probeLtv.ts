import { rawGet, unwrapItem, getTillOrderSteps } from '../http/fitbase';

// ── Amount field names to include as "raw amount fields" from /client ────────
const AMOUNT_FIELDS = [
  'purchase_amount', 'balance', 'bonus', 'bonus_balance',
  'deposit', 'deposit_balance', 'total_amount', 'amount',
];

// ── LTV calculation variants ─────────────────────────────────────────────────

interface StepBreakdown {
  purchase: number;
  refund:   number;
  n:        number;
}

interface CalcResult {
  A: number; // purchase_amount from /client
  B: number; // all purchases − refunds
  C: number; // purchases − refunds, excluding item_type=deposit
  D: number; // C − priceBonus on non-deposit purchases
  byType:     Record<string, StepBreakdown>;
  byOp:       Record<string, number>;
  totalSteps: number;
  matchesA:   'B' | 'C' | 'D' | 'none';
}

function calcVariants(steps: Record<string, unknown>[], A: number): CalcResult {
  let B_purchase = 0, B_refund = 0;
  let C_purchase = 0, C_refund = 0;
  let bonusNonDeposit = 0;

  const byType: Record<string, StepBreakdown> = {};
  const byOp: Record<string, number> = {};

  for (const s of steps) {
    const price      = Number(s.price       ?? 0);
    const priceBonus = Number(s.price_bonus  ?? 0);
    const count      = Number(s.count       ?? 1);
    const itemType   = String(s.item_type   || 'unknown');
    const opType     = String(s.operation_type || 'purchase');
    const isRefund   = opType === 'refund';
    const isDeposit  = itemType === 'deposit';
    const amount     = price * count;

    if (!byType[itemType]) byType[itemType] = { purchase: 0, refund: 0, n: 0 };
    byType[itemType][isRefund ? 'refund' : 'purchase'] += amount;
    byType[itemType].n++;

    byOp[opType] = (byOp[opType] || 0) + amount;

    if (isRefund) {
      B_refund += amount;
      if (!isDeposit) C_refund += amount;
    } else {
      B_purchase += amount;
      if (!isDeposit) {
        C_purchase += amount;
        bonusNonDeposit += priceBonus * count;
      }
    }
  }

  const B = B_purchase - B_refund;
  const C = C_purchase - C_refund;
  const D = C - bonusNonDeposit;

  // Tolerance: within 1 unit (floating point)
  const near = (x: number) => Math.abs(x - A) < 1;
  const matchesA: CalcResult['matchesA'] =
    near(B) ? 'B' : near(C) ? 'C' : near(D) ? 'D' : 'none';

  return { A, B, C, D, byType, byOp, totalSteps: steps.length, matchesA };
}

// ── Main probe ────────────────────────────────────────────────────────────────

export interface ProbeLtvRow {
  client_id:    number;
  name:         string;
  rawAmounts:   Record<string, unknown>;
  A:            number;
  B:            number;
  C:            number;
  D:            number;
  matchesA:     string;
  byType:       Record<string, StepBreakdown>;
  byOp:         Record<string, number>;
  totalSteps:   number;
  error?:       string;
}

export async function runProbeLtv(params: { limit?: number } = {}): Promise<{
  rows:      ProbeLtvRow[];
  summary:   Record<string, number>;
  bestMatch: string;
}> {
  const limit   = params.limit ?? 15;
  const dateFr  = new Date(Date.now() - 90 * 24 * 3600 * 1000)
    .toISOString().slice(0, 10); // YYYY-MM-DD

  // 1. Get recent contract purchases to find real buyers
  const recentSteps = await getTillOrderSteps({
    item_type:      'contract',
    operation_type: 'purchase',
    date_from:      dateFr,
    page_size:      100,
  });

  // Unique client_ids in order of appearance
  const seen = new Set<number>();
  const clientIds: number[] = [];
  for (const s of recentSteps) {
    const cid = Number(s.client_id ?? 0);
    if (cid && !seen.has(cid)) { seen.add(cid); clientIds.push(cid); }
    if (clientIds.length >= limit) break;
  }

  // 2. For each client: fetch /client + all till-order-steps
  const rows: ProbeLtvRow[] = [];

  for (const clientId of clientIds) {
    try {
      const clientResp = await rawGet(`/client/${clientId}`);
      const client     = unwrapItem(clientResp);

      // Raw amount-related fields from /client response
      const rawAmounts: Record<string, unknown> = {};
      for (const f of AMOUNT_FIELDS) {
        if (client[f] !== undefined) rawAmounts[f] = client[f];
      }
      // Also include any field ending in _amount or _balance not already captured
      for (const [k, v] of Object.entries(client)) {
        if ((k.endsWith('_amount') || k.endsWith('_balance')) && !(k in rawAmounts)) {
          rawAmounts[k] = v;
        }
      }

      const A    = Number(client.purchase_amount ?? 0);
      const name = String(client.name ?? '');

      const allSteps = await getTillOrderSteps({ client_id: clientId, page_size: 100 });
      const calc     = calcVariants(allSteps, A);

      rows.push({
        client_id: clientId, name, rawAmounts,
        A: calc.A, B: calc.B, C: calc.C, D: calc.D,
        matchesA: calc.matchesA,
        byType: calc.byType, byOp: calc.byOp,
        totalSteps: calc.totalSteps,
      });
    } catch (e) {
      rows.push({
        client_id: clientId, name: '', rawAmounts: {},
        A: 0, B: 0, C: 0, D: 0,
        matchesA: 'none', byType: {}, byOp: {}, totalSteps: 0,
        error: String(e),
      });
    }
  }

  // 3. Summary: which variant matches A most often
  const tally: Record<string, number> = { B: 0, C: 0, D: 0, none: 0 };
  for (const r of rows) tally[r.matchesA] = (tally[r.matchesA] || 0) + 1;
  const bestMatch = (['B', 'C', 'D'] as const)
    .reduce((best, v) => tally[v] > tally[best] ? v : best, 'B' as string);

  return { rows, summary: tally, bestMatch };
}
