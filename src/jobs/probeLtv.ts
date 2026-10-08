import { rawGet, unwrapItem, paginateGet, getClientTillSteps } from '../http/fitbase';

const DEPOSIT_ITEM_IDS = new Set<number>(); // extend if known deposit SKU IDs

function calcTillSum(steps: Record<string, unknown>[]): number {
  let sum = 0;
  for (const s of steps) {
    const price      = Number(s.price      ?? 0);
    const priceBonus = Number(s.price_bonus ?? 0);
    const count      = Number(s.count      ?? 1);
    const itemId     = Number(s.item_id    ?? 0);
    const isRefund   = String(s.type || '') === 'refund';
    if (DEPOSIT_ITEM_IDS.has(itemId)) continue;
    const amount = (price - priceBonus) * count;
    sum += isRefund ? -amount : amount;
  }
  return sum;
}

export interface ProbeLtvRow {
  lead_id:         unknown;
  client_id:       number;
  funnel_id:       number;
  name:            string;
  purchase_amount: number;
  till_steps_sum:  number;
  diff:            number;
  till_steps_n:    number;
  error?:          string;
}

export async function runProbeLtv(params: { limit?: number } = {}): Promise<ProbeLtvRow[]> {
  const limit = params.limit ?? 15;
  const half  = Math.ceil(limit / 2);

  const [f2leads, f3leads] = await Promise.all([
    paginateGet('/lead', { funnel_id: 2, per_page: 100 }),
    paginateGet('/lead', { funnel_id: 3, per_page: 100 }),
  ]);

  const sample: Array<{ lead: Record<string, unknown>; funnelId: number }> = [
    ...f2leads.slice(0, half).map(l => ({ lead: l, funnelId: 2 })),
    ...f3leads.slice(0, limit - half).map(l => ({ lead: l, funnelId: 3 })),
  ];

  const rows: ProbeLtvRow[] = [];
  for (const { lead, funnelId } of sample) {
    const clientId = Number(lead.client_id ?? 0);
    if (!clientId) continue;
    try {
      const client         = unwrapItem(await rawGet(`/client/${clientId}`));
      const purchaseAmount = Number(client.purchase_amount ?? 0);
      const tillSteps      = await getClientTillSteps(clientId);
      const tillSum        = calcTillSum(tillSteps);
      rows.push({
        lead_id:         lead.id,
        client_id:       clientId,
        funnel_id:       funnelId,
        name:            String(client.name ?? ''),
        purchase_amount: purchaseAmount,
        till_steps_sum:  tillSum,
        diff:            purchaseAmount - tillSum,
        till_steps_n:    tillSteps.length,
      });
    } catch (e) {
      rows.push({
        lead_id:         lead.id,
        client_id:       clientId,
        funnel_id:       funnelId,
        name:            '',
        purchase_amount: 0,
        till_steps_sum:  0,
        diff:            0,
        till_steps_n:    0,
        error:           String(e),
      });
    }
  }

  return rows;
}
