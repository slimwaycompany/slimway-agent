import { lookupVisitsOverride } from '../config';

const TRIAL_RE = /пробн/i;

export interface VisitsResult {
  totalLeft:    number;
  totalVisits:  number;
  freeOnly:     boolean;  // all active entries have price_full = 0
  allFree:      boolean;  // all entries (incl. closed) have price_full = 0
  activeCount:  number;
  maxEndDateMs: number;
  anyCountable: boolean;
}

function parseEndDateMs(val: unknown): number {
  if (!val) return 0;
  const s = String(val);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const n = Number(s);
  return isNaN(n) ? 0 : (n > 1e10 ? n : n * 1000);
}

// Count remaining visits for a client across all non-trial countable contracts.
// Skips: deleted, trial (name matches /пробн/i), unlimited without VISITS_OVERRIDES.
// getRegs is called lazily only when an override contract is found.
export async function countClientVisits(
  clientContracts: Record<string, unknown>[],
  getRegs: () => Promise<Record<string, unknown>[]>,
): Promise<VisitsResult> {
  let regs: Record<string, unknown>[] | null = null;

  interface Entry { closed: boolean; visitsLeft: number; visitsTotal: number; priceFull: number; endDateMs: number; }
  const entries: Entry[] = [];

  for (const c of clientContracts) {
    if (String(c.deleted_at ?? '').trim()) continue;

    const ticket    = c.ticket as Record<string, unknown> | null;
    const rawVisits = ticket?.visits;
    const itemName  = String((ticket?.contract_item as Record<string, unknown> | null)?.name ?? '');

    if (TRIAL_RE.test(itemName)) continue;

    const isClosed  = Boolean(c.closed);
    const priceFull = Number(c.price_full ?? 0);
    const endDateMs = parseEndDateMs(c.end_date);

    if (rawVisits !== null && rawVisits !== undefined && Number(rawVisits) > 0) {
      entries.push({ closed: isClosed, visitsLeft: Number(c.visits_left ?? 0), visitsTotal: Number(rawVisits), priceFull, endDateMs });
    } else if (rawVisits === null) {
      const override = lookupVisitsOverride(itemName);
      if (override !== null) {
        if (!regs) regs = await getRegs();
        const contractId = Number(c.id);
        const used = regs.filter(r => {
          if (String(r.status) !== '3') return false;
          const cref = r.contract as Record<string, unknown> | null | undefined;
          return Number(cref?.id ?? r.contract_id ?? -1) === contractId;
        }).length;
        entries.push({ closed: isClosed, visitsLeft: Math.max(0, override - used), visitsTotal: override, priceFull, endDateMs });
      }
      // unlimited with no override: skip
    }
    // rawVisits === 0 or undefined: skip
  }

  const active = entries.filter(e => !e.closed && e.visitsLeft > 0);

  return {
    totalLeft:    active.reduce((s, e) => s + e.visitsLeft, 0),
    totalVisits:  active.reduce((s, e) => s + e.visitsTotal, 0),
    freeOnly:     active.length > 0 && active.every(e => e.priceFull === 0),
    allFree:      entries.length > 0 && entries.every(e => e.priceFull === 0),
    activeCount:  active.length,
    maxEndDateMs: entries.reduce((m, e) => e.endDateMs > m ? e.endDateMs : m, 0),
    anyCountable: entries.length > 0,
  };
}
