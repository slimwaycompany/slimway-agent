import { logEvent }                            from '../core/events';
import { paginateGet, getClientPurchases, getClientTillSteps, unwrapItem, rawGet } from '../http/fitbase';

const DEPOSIT_ITEM_IDS = new Set<number>(); // extend if known deposit SKU IDs

function calcLtvTillSteps(steps: Record<string, unknown>[]): number {
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

function calcLtvPurchases(purchases: Record<string, unknown>[]): number {
  return purchases.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
}

export async function runProbeLtv(params: {
  funnelId?: number;
  limit?: number;
}): Promise<void> {
  const funnelId = params.funnelId ?? 2;
  const limit    = params.limit    ?? 20;

  await logEvent({ job: 'probe-ltv', type: 'run_started', text: `probe funnelId=${funnelId} limit=${limit}`, dry: false });

  const leads = await paginateGet('/lead', { funnel_id: funnelId, per_page: 100 });
  const sample = leads.slice(0, limit);

  const rows: Record<string, unknown>[] = [];
  for (const lead of sample) {
    const clientId = Number(lead.client_id ?? 0);
    if (!clientId) continue;
    try {
      const clientResp = await rawGet(`/client/${clientId}`);
      const client     = unwrapItem(clientResp);
      const [purchases, tillSteps] = await Promise.all([
        getClientPurchases(clientId),
        getClientTillSteps(clientId),
      ]);
      const ltvPurchase = calcLtvPurchases(purchases);
      const ltvTill     = calcLtvTillSteps(tillSteps);
      rows.push({
        lead_id:      lead.id,
        client_id:    clientId,
        name:         String(client.name ?? ''),
        ltv_purchase: ltvPurchase,
        ltv_till:     ltvTill,
        purchases_n:  purchases.length,
        till_steps_n: tillSteps.length,
      });
      await logEvent({
        job:     'probe-ltv',
        type:    'probe',
        lead_id: Number(lead.id),
        text:    `ltv_purchase=${ltvPurchase} ltv_till=${ltvTill} purchases_n=${purchases.length} till_n=${tillSteps.length}`,
        dry:     false,
        meta:    { ltv_purchase: ltvPurchase, ltv_till: ltvTill },
      });
    } catch (e) {
      await logEvent({ job: 'probe-ltv', type: 'error', lead_id: Number(lead.id), text: String(e), dry: false });
    }
  }

  await logEvent({
    job:  'probe-ltv',
    type: 'run_finished',
    text: `sampled ${rows.length}/${sample.length} leads in funnel ${funnelId}`,
    dry:  false,
    meta: { rows },
  });
}
