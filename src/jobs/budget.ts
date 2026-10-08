/**
 * Budget module — sets lead.budget for active leads in funnels 1,2,3,4.
 *
 * Funnel is read from lead.funnel_step.purchase_funnel.id — NOT from query param.
 * Leads with funnel_step.id = -1/-2 or purchase_funnel = null are skipped.
 *
 * Funnels 1 & 4: BUDGET_DEFAULT — only if budget is currently empty/null/0.
 *                Never overwrites a manually set value.
 * Funnels 2 & 3: LTV = client.purchase_amount from GET /client/{id}.
 *                Skips lead if purchase_amount is absent or zero.
 *
 * Emits at most 2 aggregate budget_updated events, or run_finished if nothing changed.
 */

import { isDry, env }          from '../config';
import { logEvent }             from '../core/events';
import { shortName }            from '../core/names';
import { alertError }           from '../core/mail';
import {
  rawGet, unwrapItem, paginateGet, patchLeadBudget,
}                               from '../http/fitbase';

const LTV_FUNNELS    = new Set([2, 3]);
const DEFAULT_FUNNELS = new Set([1, 4]);
const BUDGET_FUNNELS  = new Set([1, 2, 3, 4]);
const SKIP_STAGE_IDS  = new Set([-1, -2]);

const FUNNEL_NAME: Record<number, string> = {
  1: 'Новые заявки', 2: 'Новички', 3: 'Постоянные клиенты', 4: 'Реактивация',
};

interface BudgetChange {
  lead_id:    number;
  short_name: string;
  old:        number | null;
  new:        number;
}

function getFunnelId(lead: Record<string, unknown>): number | null {
  const step = lead.funnel_step as Record<string, unknown> | undefined;
  if (!step) return null;
  const pf = step.purchase_funnel as Record<string, unknown> | null | undefined;
  if (!pf) return null;
  const id = Number(pf.id ?? 0);
  return id || null;
}

function getStepId(lead: Record<string, unknown>): number {
  const step = lead.funnel_step as Record<string, unknown> | undefined;
  return Number(step?.id ?? 0);
}

export async function runBudget(): Promise<Record<string, unknown>> {
  const dryRun = isDry('budget');

  const defaultChanges: Record<number, BudgetChange[]> = { 1: [], 4: [] };
  const ltvChanges: Record<number, BudgetChange[]>     = { 2: [], 3: [] };
  const ltvErrors: string[] = [];
  const funnelCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  let allLeads: Record<string, unknown>[];
  try {
    allLeads = await paginateGet('/lead', { page_size: 100 }, 'budget');
  } catch (e) {
    const msg = String(e);
    await logEvent({ job: 'budget', type: 'error', text: `Не удалось получить лиды: ${msg}`, dry: dryRun });
    try { await alertError('budget_leads_fetch', msg); } catch { /* silent */ }
    throw e; // mark job_run as error
  }

  for (const lead of allLeads) {
    const stepId   = getStepId(lead);
    const funnelId = getFunnelId(lead);

    if (SKIP_STAGE_IDS.has(stepId)) continue;
    if (!funnelId || !BUDGET_FUNNELS.has(funnelId)) continue;

    funnelCounts[funnelId] = (funnelCounts[funnelId] || 0) + 1;

    const leadId    = Number(lead.id);
    const rawBudget = lead.budget;
    const currentBudget = (rawBudget === null || rawBudget === undefined || rawBudget === '')
      ? null
      : Number(rawBudget);

    if (LTV_FUNNELS.has(funnelId)) {
      // ── Funnels 2, 3 — LTV via GET /client ───────────────────────────────
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
    } else if (DEFAULT_FUNNELS.has(funnelId)) {
      // ── Funnels 1, 4 — fixed default, only when budget is empty/zero ─────
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

  // ── Console log for Render ───────────────────────────────────────────────
  const countsLog = [1, 2, 3, 4].map(f => `${f}:${funnelCounts[f]}`).join(' ');
  console.log(`[budget] leads=${allLeads.length} funnels: ${countsLog} dry=${dryRun}`);

  // ── Emit summary events ───────────────────────────────────────────────────
  const defaultAll = [...defaultChanges[1], ...defaultChanges[4]];
  const ltvAll     = [...ltvChanges[2], ...ltvChanges[3]];

  const countsSummary = Object.entries(funnelCounts)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `воронка ${id}: ${n}`)
    .join(', ');

  const stats: Record<string, unknown> = {
    total_leads:     allLeads.length,
    funnel_counts:   funnelCounts,
    default_updated: defaultAll.length,
    ltv_updated:     ltvAll.length,
    errors:          ltvErrors.length,
    dry:             dryRun,
  };

  if (defaultAll.length === 0 && ltvAll.length === 0 && ltvErrors.length === 0) {
    await logEvent({
      job: 'budget', type: 'run_finished',
      text: `Бюджет: изменений нет (${countsSummary || 'лидов нет'})`,
      dry: dryRun,
      meta: { funnel_counts: funnelCounts },
    });
    return stats;
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
      meta: { changes: defaultAll, funnel_counts: funnelCounts },
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
      meta: { changes: ltvAll, errors: ltvErrors, funnel_counts: funnelCounts },
    });
  }

  return stats;
}
