/**
 * Budget module — sets lead.budget for every active lead in funnels 1,2,3,4.
 *
 * Funnels 1 & 4 (Новые заявки / Реактивация): fixed BUDGET_DEFAULT.
 * Funnels 2 & 3 (Новички / Постоянные):        LTV from Fitbase (purchase_amount or till_steps).
 *
 * Skips leads already at system stages -1 (Успешно реализована) or -2 (Отказ).
 * Skips leads whose budget already matches the computed value (idempotent).
 */

import { isDry, env }                                         from '../config';
import { logEvent }                                            from '../core/events';
import {
  paginateGet,
  patchLeadBudget,
  getClientPurchases,
  getClientTillSteps,
}                                                              from '../http/fitbase';

const BUDGET_FUNNELS      = [1, 2, 3, 4];
const LTV_FUNNELS         = new Set([2, 3]);
const SKIP_STAGES         = new Set([-1, -2]);
const DEPOSIT_ITEM_IDS    = new Set<number>(); // extend if known deposit SKU IDs

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

async function computeLtv(clientId: number): Promise<number> {
  if (env.LTV_SOURCE === 'till_steps') {
    const steps = await getClientTillSteps(clientId);
    return Math.max(0, calcLtvTillSteps(steps));
  }
  // purchase_amount (default)
  const purchases = await getClientPurchases(clientId);
  return purchases.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
}

export async function runBudget(): Promise<void> {
  const dryRun = isDry('budget');
  await logEvent({ job: 'budget', type: 'run_started', text: `dry=${dryRun}`, dry: dryRun });

  let updated = 0;
  let skipped = 0;
  let errors  = 0;

  for (const funnelId of BUDGET_FUNNELS) {
    let leads: Record<string, unknown>[];
    try {
      leads = await paginateGet('/lead', { funnel_id: funnelId, per_page: 100 });
    } catch (e) {
      await logEvent({ job: 'budget', type: 'error', text: `funnel ${funnelId} fetch failed: ${e}`, dry: dryRun });
      errors++;
      continue;
    }

    for (const lead of leads) {
      const leadId  = Number(lead.id);
      const stageId = Number(lead.funnels_step_id ?? 0);
      if (SKIP_STAGES.has(stageId)) { skipped++; continue; }

      let budget: number;
      if (LTV_FUNNELS.has(funnelId)) {
        const clientId = Number(lead.client_id ?? 0);
        if (!clientId) { skipped++; continue; }
        try {
          budget = await computeLtv(clientId);
        } catch (e) {
          await logEvent({ job: 'budget', type: 'error', lead_id: leadId, text: `LTV fetch failed: ${e}`, dry: dryRun });
          errors++;
          continue;
        }
        if (budget === 0) budget = env.BUDGET_DEFAULT;
      } else {
        budget = env.BUDGET_DEFAULT;
      }

      const currentBudget = Number(lead.budget ?? null);
      if (currentBudget === budget) { skipped++; continue; }

      await logEvent({
        job:     'budget',
        type:    'budget_updated',
        lead_id: leadId,
        text:    `funnel=${funnelId} budget ${currentBudget}→${budget}`,
        dry:     dryRun,
        meta:    { funnel_id: funnelId, from: currentBudget, to: budget },
      });

      if (!dryRun) {
        try {
          await patchLeadBudget(leadId, budget);
          updated++;
        } catch (e) {
          await logEvent({ job: 'budget', type: 'error', lead_id: leadId, text: `PATCH failed: ${e}`, dry: dryRun });
          errors++;
        }
      } else {
        updated++; // count dry-run updates too
      }
    }
  }

  await logEvent({
    job:  'budget',
    type: 'run_finished',
    text: `updated=${updated} skipped=${skipped} errors=${errors} dry=${dryRun}`,
    dry:  dryRun,
    meta: { updated, skipped, errors },
  });
}
