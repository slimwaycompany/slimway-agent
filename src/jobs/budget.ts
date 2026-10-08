/**
 * Budget module — sets lead.budget for active leads in funnels 1,2,3,4.
 *
 * Funnels 1 & 4: BUDGET_DEFAULT — only if budget is currently empty/null/0.
 *                Never overwrites a manually set value.
 * Funnels 2 & 3: LTV = client.purchase_amount from GET /client/{id}.
 *                Skips lead if purchase_amount is absent or zero.
 *
 * Emits at most 2 aggregate events (one per funnel group), or a single
 * run_finished if nothing changed.
 */

import { isDry, env }          from '../config';
import { logEvent }             from '../core/events';
import { shortName }            from '../core/names';
import {
  rawGet, unwrapItem, paginateGet, patchLeadBudget,
}                               from '../http/fitbase';

const BUDGET_FUNNELS = [1, 2, 3, 4];
const LTV_FUNNELS    = new Set([2, 3]);
const SKIP_STAGES    = new Set([-1, -2]);

const FUNNEL_NAME: Record<number, string> = {
  1: 'Новые заявки', 2: 'Новички', 3: 'Постоянные клиенты', 4: 'Реактивация',
};

interface BudgetChange {
  lead_id:    number;
  short_name: string;
  old:        number | null;
  new:        number;
}

export async function runBudget(): Promise<void> {
  const dryRun = isDry('budget');

  const defaultChanges: Record<number, BudgetChange[]> = { 1: [], 4: [] };
  const ltvChanges: Record<number, BudgetChange[]>     = { 2: [], 3: [] };
  const ltvErrors: string[] = [];

  for (const funnelId of BUDGET_FUNNELS) {
    let leads: Record<string, unknown>[];
    try {
      leads = await paginateGet('/lead', { funnel_id: funnelId, per_page: 100 });
    } catch (e) {
      ltvErrors.push(`funnel ${funnelId} fetch failed: ${String(e)}`);
      continue;
    }

    for (const lead of leads) {
      const leadId  = Number(lead.id);
      const stageId = Number(lead.funnels_step_id ?? 0);
      if (SKIP_STAGES.has(stageId)) continue;

      // Normalize current budget — treat null/undefined/empty-string as null
      const rawBudget     = lead.budget;
      const currentBudget = (rawBudget === null || rawBudget === undefined || rawBudget === '')
        ? null
        : Number(rawBudget);

      if (LTV_FUNNELS.has(funnelId)) {
        // ── Funnels 2, 3 — LTV via GET /client ─────────────────────────────
        const clientId = Number(lead.client_id ?? 0);
        if (!clientId) continue;

        let client: Record<string, unknown>;
        let ltv: number;
        try {
          client = unwrapItem(await rawGet(`/client/${clientId}`));
          const pa = client.purchase_amount;
          if (pa === null || pa === undefined || pa === '' || Number(pa) === 0) continue;
          ltv = Number(pa);
        } catch (e) {
          ltvErrors.push(`lead=${leadId} client=${clientId}: ${String(e)}`);
          continue;
        }

        if (currentBudget === ltv) continue;
        const name = shortName(lead, client);
        ltvChanges[funnelId].push({ lead_id: leadId, short_name: name, old: currentBudget, new: ltv });
        if (!dryRun) {
          try { await patchLeadBudget(leadId, ltv); }
          catch (e) { ltvErrors.push(`PATCH lead=${leadId}: ${String(e)}`); }
        }
      } else {
        // ── Funnels 1, 4 — fixed default, only when budget is empty/zero ───
        if (currentBudget !== null && currentBudget > 0) continue;

        const budget = env.BUDGET_DEFAULT;
        const name   = shortName(lead);
        defaultChanges[funnelId].push({ lead_id: leadId, short_name: name, old: currentBudget, new: budget });
        if (!dryRun) {
          try { await patchLeadBudget(leadId, budget); }
          catch (e) { ltvErrors.push(`PATCH lead=${leadId}: ${String(e)}`); }
        }
      }
    }
  }

  // ── Emit summary events ───────────────────────────────────────────────────
  const defaultAll = [...defaultChanges[1], ...defaultChanges[4]];
  const ltvAll     = [...ltvChanges[2], ...ltvChanges[3]];

  if (defaultAll.length === 0 && ltvAll.length === 0 && ltvErrors.length === 0) {
    await logEvent({ job: 'budget', type: 'run_finished', text: 'Бюджет: изменений нет', dry: dryRun });
    return;
  }

  if (defaultAll.length > 0) {
    const parts = ([1, 4] as const)
      .filter(id => defaultChanges[id].length > 0)
      .map(id => `${FUNNEL_NAME[id]}: ${defaultChanges[id].length}`)
      .join(', ');
    const verb = dryRun ? '[DRY] Проставил бы' : 'Проставил';
    await logEvent({
      job:  'budget',
      type: 'budget_updated',
      text: `${verb} бюджет ${env.BUDGET_DEFAULT} в ${defaultAll.length} карточках (${parts})`,
      dry:  dryRun,
      meta: { changes: defaultAll },
    });
  }

  if (ltvAll.length > 0 || ltvErrors.length > 0) {
    const parts = ([2, 3] as const)
      .filter(id => ltvChanges[id].length > 0)
      .map(id => `${FUNNEL_NAME[id]}: ${ltvChanges[id].length}`)
      .join(', ');
    const errPart = ltvErrors.length > 0 ? `, ошибок: ${ltvErrors.length}` : '';
    const verb = dryRun ? '[DRY] Обновил бы' : 'Обновил';
    await logEvent({
      job:  'budget',
      type: 'budget_updated',
      text: `${verb} LTV в ${ltvAll.length} карточках${parts ? ` (${parts})` : ''}${errPart}`,
      dry:  dryRun,
      meta: { changes: ltvAll, errors: ltvErrors },
    });
  }
}
