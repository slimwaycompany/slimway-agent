import { supabase } from '../db/supabase';
import { env } from '../config';
import { rawGet } from '../http/fitbase';

export const JOB_NAME = 'fitbase-ops';

const YEK_MS = 5 * 3600_000;

function yekDate(ts: number): string {
  const d = new Date(ts + YEK_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function classifyOpType(amount: number, itemType: string): 'sale' | 'refund' | 'deposit' | 'withdrawal' | 'other' {
  const t = itemType.toLowerCase();
  if (t.includes('внесени') || t.includes('deposit') || t.includes('приход')) return 'deposit';
  if (t.includes('изъяти') || t.includes('withdrawal') || t.includes('расход')) return 'withdrawal';
  if (amount < 0) return 'refund';
  if (amount > 0) return 'sale';
  return 'other';
}

interface TillStep {
  id: number;
  pay_date: number;
  amount: number;
  item_type: string;
  payment_type: string;
  payment_method: { system_name: string } | null;
  created_by_user: { full_name: string } | null;
  manager: { full_name: string } | null;
  client: { full_name: string } | null;
  item: { name: string } | null;
  comment: string | null;
}

interface FitbaseOpsRow {
  fitbase_id: number;
  op_type: string;
  op_at: string;
  op_date: string;
  amount: number;
  pay_method: string | null;
  client_name: string | null;
  cashier: string | null;
  manager: string | null;
  item: string | null;
  comment: string | null;
  raw: Record<string, unknown>;
}

// Probe Fitbase for deposits/withdrawals (might not exist in API v2)
async function probeTillExtra(endpoint: string): Promise<TillStep[]> {
  try {
    const resp = await rawGet(`/${endpoint}?page_size=100&page=1`);
    const items = ((resp.items || resp.data || []) as TillStep[]);
    console.log(`[fitbase-ops] ${endpoint}: ${items.length} items on first page`);
    return items;
  } catch (e) {
    console.log(`[fitbase-ops] ${endpoint} not available: ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
}

async function fetchAllTillSteps(): Promise<TillStep[]> {
  const all: TillStep[] = [];
  let page = 1;
  while (true) {
    if (page > 1) await sleep(300);
    const resp = await rawGet(`/till-order-steps?page_size=100&page=${page}`);
    const items = (resp.items || []) as TillStep[];
    all.push(...items);
    const total = Number(resp.total_count ?? resp.total ?? 0);
    console.log(`[fitbase-ops] till-order-steps page ${page}: ${items.length} items (total so far: ${all.length}/${total})`);
    if (items.length === 0 || items.length < 100) break;
    if (total > 0 && all.length >= total) break;
    if (page > 50) break; // safety cap
    page++;
  }
  return all;
}

function mapStep(s: TillStep): FitbaseOpsRow {
  const opAt = new Date(s.pay_date * 1000).toISOString();
  const opDate = yekDate(s.pay_date * 1000);
  const amount = Math.abs(Number(s.amount ?? 0));
  const rawAmount = Number(s.amount ?? 0);
  const itemType = String(s.item_type ?? '');
  return {
    fitbase_id: s.id,
    op_type: classifyOpType(rawAmount, itemType),
    op_at: opAt,
    op_date: opDate,
    amount,
    pay_method: s.payment_method?.system_name ?? s.payment_type ?? null,
    client_name: s.client?.full_name ?? null,
    cashier: s.created_by_user?.full_name ?? null,
    manager: s.manager?.full_name ?? null,
    item: (s.item?.name ?? itemType) || null,
    comment: s.comment ?? null,
    raw: s as unknown as Record<string, unknown>,
  };
}

export async function runFitbaseOps(): Promise<Record<string, unknown>> {
  // Cursor: max op_at in DB, or FITBASE_OPS_SINCE for first run
  const { data: cursorRow } = await supabase
    .from('fitbase_operations')
    .select('op_at')
    .order('op_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const isFirstRun = !cursorRow;
  const cursorDate = cursorRow
    ? new Date(new Date(cursorRow.op_at).getTime() - 2 * 86400_000).toISOString().slice(0, 10) // re-fetch last 2 days
    : env.FITBASE_OPS_SINCE;

  console.log(`[fitbase-ops] cursor=${cursorDate} first=${isFirstRun}`);

  // Fetch all steps (Fitbase ignores date filter, so we fetch all and filter locally)
  const steps = await fetchAllTillSteps();

  // Also probe for deposits/withdrawals endpoints (fire-and-forget on 404)
  const [incomeItems, outcomeItems] = await Promise.all([
    probeTillExtra('till-income'),
    probeTillExtra('till-outcome'),
  ]);

  const allItems = [
    ...steps,
    ...incomeItems.map(s => ({ ...s, item_type: s.item_type || 'Внесение' })),
    ...outcomeItems.map(s => ({ ...s, item_type: s.item_type || 'Изъятие' })),
  ];

  // Filter to only items on or after cursor date (op_date comparison)
  const rows: FitbaseOpsRow[] = allItems
    .filter(s => {
      const d = yekDate(s.pay_date * 1000);
      return d >= cursorDate;
    })
    .map(mapStep);

  if (rows.length === 0) {
    console.log(`[fitbase-ops] no new rows after ${cursorDate}`);
    return { inserted: 0, total_fetched: allItems.length };
  }

  // Upsert in chunks of 100
  let inserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('fitbase_operations')
      .upsert(chunk, { onConflict: 'fitbase_id', ignoreDuplicates: false })
      .select('fitbase_id');
    if (error) throw new Error(`[fitbase-ops] upsert error: ${error.message}`);
    inserted += (data || []).length;
  }

  console.log(`[fitbase-ops] done: total=${allItems.length}, filtered=${rows.length}, upserted=${inserted}`);
  return { inserted, total_fetched: allItems.length, filtered: rows.length, cursor: cursorDate };
}
