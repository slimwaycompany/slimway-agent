import { env } from '../config';

// Returns the funnel id for a lead:
//   - purchase_funnel.id for normal stages
//   - env.UNSORTED_DEFAULT_FUNNEL (default 1) for system step 0 (new/unassigned leads)
//   - null for terminal steps -1/-2
export function getLeadFunnel(lead: Record<string, unknown>): number | null {
  const step   = lead.funnel_step as Record<string, unknown> | undefined;
  const stepId = Number(step?.id ?? 0);

  if (stepId === -1 || stepId === -2) return null;

  const pf = step?.purchase_funnel as Record<string, unknown> | null | undefined;
  if (pf) {
    const id = Number(pf.id ?? 0);
    if (id > 0) return id;
  }

  if (stepId === 0) {
    for (const key of ['funnels_id', 'funnel_id', 'purchase_funnel_id']) {
      const id = Number((lead as Record<string, unknown>)[key] ?? 0);
      if (id > 0) return id;
    }
    return env.UNSORTED_DEFAULT_FUNNEL;
  }

  return null;
}
