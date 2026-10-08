import { rawGet, paginateGet } from '../http/fitbase';
import { TRIAL_TRAINING_ID }   from '../config';

export async function runProbeContracts(): Promise<Record<string, unknown>> {
  // 1. Sample 5 clients from funnel 2
  const allLeads = await paginateGet('/lead', { page_size: 100 });
  const f2Leads  = allLeads.filter(l => {
    const step = l.funnel_step as Record<string, unknown> | undefined;
    const pf   = step?.purchase_funnel as Record<string, unknown> | null | undefined;
    return Number(pf?.id ?? 0) === 2;
  });

  const clientIds: number[] = [];
  const seen = new Set<number>();
  for (const lead of f2Leads) {
    const cid = Number(lead.client_id ?? 0);
    if (cid && !seen.has(cid)) { seen.add(cid); clientIds.push(cid); }
    if (clientIds.length >= 5) break;
  }

  // 2. Raw contracts for each client
  const contractsByClient: Record<number, unknown[]> = {};
  const unlimitedExamples: unknown[]                 = [];

  for (const cid of clientIds) {
    const resp  = await rawGet(`/client-contract?client_id=${cid}`);
    const items = (resp.items || []) as Record<string, unknown>[];

    contractsByClient[cid] = items.map(c => {
      const ticket = c.ticket as Record<string, unknown> | null;
      return {
        id:              c.id,
        ticket: ticket ? {
          visits:          ticket.visits,
          duration_type:   ticket.duration_type,
          contract_item:   (ticket.contract_item as Record<string, unknown> | null)?.name,
        } : null,
        price:           c.price,
        price_full:      c.price_full,
        payment:         c.payment,
        payment_date:    c.payment_date,
        closed:          c.closed,
        begin_date:      c.begin_date,
        activation_date: c.activation_date,
        end_date:        c.end_date,
        visits_left:     c.visits_left,
        created_at:      c.created_at,
        deleted_at:      c.deleted_at,
      };
    });

    if (unlimitedExamples.length < 2) {
      for (const c of items) {
        const ticket = c.ticket as Record<string, unknown> | null;
        const visits = ticket?.visits;
        if (visits === null || visits === undefined || Number(visits) === 0) {
          unlimitedExamples.push({
            client_id:     cid,
            contract_id:   c.id,
            ticket_visits: visits,
            duration_type: ticket?.duration_type,
            price_full:    c.price_full,
            why: `ticket.visits=${JSON.stringify(visits)}, duration_type=${ticket?.duration_type}`,
          });
          if (unlimitedExamples.length >= 2) break;
        }
      }
    }
  }

  // 3. Frozen clients (status=4) — 2 examples with contracts
  const frozenResp  = await rawGet('/client?status[]=4&page_size=5');
  const frozenItems = (frozenResp.items || []) as Record<string, unknown>[];
  const frozenExamples: unknown[] = [];

  for (const fc of frozenItems.slice(0, 2)) {
    const cid     = Number(fc.id);
    const cResp   = await rawGet(`/client-contract?client_id=${cid}`);
    const cContracts = ((cResp.items || []) as Record<string, unknown>[]).map(c => {
      const ticket = c.ticket as Record<string, unknown> | null;
      return {
        id:           c.id,
        ticket_visits: ticket?.visits,
        duration_type: ticket?.duration_type,
        price_full:   c.price_full,
        closed:       c.closed,
        visits_left:  c.visits_left,
        begin_date:   c.begin_date,
        end_date:     c.end_date,
        deleted_at:   c.deleted_at,
      };
    });
    frozenExamples.push({
      client:    { id: fc.id, name: fc.name, status: fc.status },
      contracts: cContracts,
    });
  }

  // 4. Three visit examples (status=3, non-trial) to understand last-visit date format
  const visitExamples: unknown[] = [];

  for (const cid of clientIds) {
    if (visitExamples.length >= 3) break;
    const resp = await rawGet(`/schedule-registration?client_id=${cid}`);
    const regs = (resp.items || []) as Record<string, unknown>[];
    for (const r of regs) {
      if (visitExamples.length >= 3) break;
      if (String(r.status) !== '3') continue;
      const ev       = (r.event || {}) as Record<string, unknown>;
      const training = (ev.training || {}) as Record<string, unknown>;
      if (Number(training.id) === TRIAL_TRAINING_ID) continue;
      visitExamples.push({
        client_id:        cid,
        reg_id:           r.id,
        status:           r.status,
        event_date:       ev.date,
        event_time_start: ev.time_start,
        training_id:      training.id,
        training_name:    training.name,
      });
    }
  }

  return {
    funnel2_clients_sampled: clientIds.length,
    contracts_by_client:     contractsByClient,
    unlimited_examples:      unlimitedExamples,
    frozen_examples:         frozenExamples,
    visit_status3_examples:  visitExamples,
  };
}
