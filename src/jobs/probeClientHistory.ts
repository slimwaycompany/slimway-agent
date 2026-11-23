import { rawGet, getTillOrderSteps, paginateGet } from '../http/fitbase';
import { supabase } from '../db/supabase';

// Mask personal data for the report (keep first char + last 4 of phone, first char of name)
function maskName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/);
  return parts.map(p => p[0] + '***').join(' ');
}
function maskPhone(phone: unknown): string {
  const s = String(phone ?? '').replace(/\D/g, '');
  if (s.length < 5) return '***';
  return s.slice(0, 1) + '***' + s.slice(-4);
}

// Summarise a contract for the report (all interesting fields)
function summariseContract(c: Record<string, unknown>) {
  const ticket  = (c.ticket  as Record<string, unknown> | null) ?? {};
  const manager = (c.manager as Record<string, unknown> | null) ?? {};
  const freezes = (c.freezes as unknown[]) ?? [];
  return {
    id:              c.id,
    name:            (ticket.contract_item as Record<string, unknown> | null)?.name ?? ticket.name,
    ticket_visits:   ticket.visits,          // total sessions; null = unlimited
    visits_left:     c.visits_left,
    duration_type:   ticket.duration_type,   // "month" / "day" / "visit"
    price:           c.price,
    price_full:      c.price_full,
    payment:         c.payment,
    payment_date:    c.payment_date,
    begin_date:      c.begin_date,
    activation_date: c.activation_date,
    end_date:        c.end_date,
    closed:          c.closed,
    deleted_at:      c.deleted_at,
    manager_id:      manager.id,
    // freeze-related
    freezes_count:   freezes.length,
    freeze_sample:   freezes[0] ?? null,     // show all keys on first freeze
    // other top-level keys we haven't mapped yet
    extra_keys:      Object.keys(c).filter(k =>
      !['id','ticket','manager','freezes','visits_left','price','price_full',
        'payment','payment_date','begin_date','activation_date','end_date',
        'closed','deleted_at','client_id'].includes(k)
    ),
  };
}

// Summarise a till-order-step
function summariseStep(s: Record<string, unknown>) {
  return {
    id:             s.id,
    amount:         s.amount,          // negative = refund
    item_type:      s.item_type,       // contract / product / deposit / service
    operation_type: s.operation_type,  // purchase / refund / correction
    payment_type:   (s.payment_type as Record<string, unknown> | null)?.name ?? s.payment_type,
    cashier:        (s.cashier  as Record<string, unknown> | null)?.name,
    manager:        (s.manager  as Record<string, unknown> | null)?.name,
    contract_id:    s.contract_id,     // link to contract (if present)
    created_at:     s.created_at,
    item_name:      (s.item as Record<string, unknown> | null)?.name ?? null,
    extra_keys:     Object.keys(s).filter(k =>
      !['id','amount','item_type','operation_type','payment_type',
        'cashier','manager','contract_id','created_at','item','client_id'].includes(k)
    ),
  };
}

// Summarise a schedule-registration
function summariseReg(r: Record<string, unknown>) {
  const ev  = (r.event    as Record<string, unknown>) ?? {};
  const tr  = (ev.training as Record<string, unknown>) ?? {};
  return {
    id:          r.id,
    status:      r.status,          // 1=registered,2=cancelled,3=visited,4=no-show
    contract_id: r.contract_id,     // link to contract (is it present in visit records?)
    event_date:  ev.date,
    training:    tr.name,
    extra_keys:  Object.keys(r).filter(k =>
      !['id','status','contract_id','event','client_id'].includes(k)
    ),
  };
}

export async function runProbeClientHistory(
  params: { client_ids?: string; phone?: string } = {},
): Promise<Record<string, unknown>> {

  // ── 1. Resolve client list ────────────────────────────────────────────────
  let clientIds: number[] = [];

  if (params.client_ids) {
    clientIds = params.client_ids.split(',').map(s => Number(s.trim())).filter(Boolean);
  } else if (params.phone) {
    const digits = params.phone.replace(/\D/g, '').slice(-10);
    const { data } = await supabase
      .from('fitbase_clients_cache')
      .select('fitbase_id')
      .ilike('phone', `%${digits}`);
    clientIds = (data ?? []).map((r: Record<string, unknown>) => Number(r.fitbase_id)).filter(Boolean);
  } else {
    // Auto-select ~8 diverse clients
    // a) Phone 87767681579 from task spec
    const targetPhone = '87767681579';
    const { data: phoneRows } = await supabase
      .from('fitbase_clients_cache')
      .select('fitbase_id')
      .ilike('phone', `%${targetPhone.slice(-10)}`);
    for (const r of (phoneRows ?? []) as Record<string, unknown>[]) {
      const id = Number(r.fitbase_id);
      if (id) clientIds.push(id);
    }

    // b) Recent clients from fitbase_operations (various item_types)
    const { data: opRows } = await supabase
      .from('fitbase_operations')
      .select('client_fitbase_id, item_type, operation_type')
      .order('id', { ascending: false })
      .limit(200);
    const seen = new Set(clientIds);
    // Pick 1 with refund, 1 product, then fill up to 8 with any
    const pickOrder = ['refund', 'product', 'contract', 'deposit', 'service'];
    const byType: Record<string, number> = {};
    for (const op of (opRows ?? []) as Record<string, unknown>[]) {
      const id  = Number(op.client_fitbase_id);
      const key = op.operation_type === 'refund' ? 'refund' : String(op.item_type);
      if (!id || seen.has(id)) continue;
      if (!byType[key]) {
        byType[key] = id;
        seen.add(id);
        clientIds.push(id);
      }
      if (clientIds.length >= 8) break;
    }
    // Fill remaining slots from recent operations if still < 8
    if (clientIds.length < 8) {
      for (const op of (opRows ?? []) as Record<string, unknown>[]) {
        const id = Number(op.client_fitbase_id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        clientIds.push(id);
        if (clientIds.length >= 8) break;
      }
    }
  }

  // ── 2. Global totals (page_size=1 → total_count header) ──────────────────
  const [clientsHead, contractsHead] = await Promise.all([
    rawGet('/client?page_size=1'),
    rawGet('/client-contract?page_size=1'),
  ]);
  const totalFbClients   = Number(clientsHead.total_count   ?? clientsHead.total   ?? 0);
  const totalFbContracts = Number(contractsHead.total_count ?? contractsHead.total ?? 0);

  // ── 3. Per-client probe ───────────────────────────────────────────────────
  const dateFrom = '2020-01-01';
  const dateTo   = new Date().toISOString().slice(0, 10);

  const clientData: Record<string, unknown>[] = [];

  for (const cid of clientIds) {
    // Client info
    const clientResp = await rawGet(`/client/${cid}`);
    const client = (clientResp.item ?? clientResp) as Record<string, unknown>;

    // Contracts
    const contractsResp = await rawGet(`/client-contract?client_id=${cid}`);
    const contracts = ((contractsResp.items ?? []) as Record<string, unknown>[]).map(summariseContract);

    // Payments
    const steps = await getTillOrderSteps({ client_id: cid });
    const payments    = steps.filter(s => Number(s.amount) > 0).map(summariseStep);
    const refunds     = steps.filter(s => Number(s.amount) < 0).map(summariseStep);
    const productBuys = steps.filter(s => s.item_type === 'product').map(summariseStep);

    // Visits
    const visitsResp = await rawGet(
      `/schedule-registration?client_id=${cid}&date_from=${dateFrom}&date_to=${dateTo}`,
    );
    const visits = ((visitsResp.items ?? []) as Record<string, unknown>[]).map(summariseReg);

    clientData.push({
      fitbase_id:     cid,
      name:           maskName(client.name),
      phone:          maskPhone(client.phone),
      status:         client.status,
      purchase_amount: client.purchase_amount,
      contracts_count: contracts.length,
      contracts,
      payments_count:  payments.length,
      refunds_count:   refunds.length,
      product_buys_count: productBuys.length,
      product_buys:    productBuys.slice(0, 3),
      payments_sample: payments.slice(0, 3),
      refunds_sample:  refunds.slice(0, 2),
      visits_count:    visits.length,
      visits_sample:   visits.slice(0, 3),
      // Raw keys on /client for field discovery
      client_keys:     Object.keys(client),
    });
  }

  // ── 4. Supabase cross-match counts (read-only SELECTs) ────────────────────
  const { count: crmTotal } = await supabase
    .from('crm_clients')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false);

  // body_clients: get id + phone for matching (phone stored as 7XXXXXXXXXX or +7XXXXXXXXXX)
  const { data: bodyRows } = await supabase
    .from('body_clients')
    .select('id, phone, fitbase_client_id');
  const bodyClients = (bodyRows ?? []) as Array<{ id: number; phone: string | null; fitbase_client_id: number | null }>;

  // Sample to understand phone format
  const phoneSample = bodyClients.slice(0, 3).map(r => ({
    id:                r.id,
    phone_raw:         r.phone,
    phone_digits_len:  r.phone ? r.phone.replace(/\D/g, '').length : 0,
    has_fitbase_id:    r.fitbase_client_id !== null,
  }));

  // Cross-match crm_clients ↔ body_clients by last 10 phone digits
  const { data: crmRows } = await supabase
    .from('crm_clients')
    .select('id, phone')
    .eq('is_deleted', false);
  const crmClients = (crmRows ?? []) as Array<{ id: number; phone: string | null }>;

  // Build maps: last-10-digits → list of ids
  const crmByDigits = new Map<string, number[]>();
  for (const r of crmClients) {
    const d = (r.phone ?? '').replace(/\D/g, '').slice(-10);
    if (d.length === 10) {
      if (!crmByDigits.has(d)) crmByDigits.set(d, []);
      crmByDigits.get(d)!.push(r.id);
    }
  }

  const bodyByDigits = new Map<string, number[]>();
  for (const r of bodyClients) {
    const d = (r.phone ?? '').replace(/\D/g, '').slice(-10);
    if (d.length === 10) {
      if (!bodyByDigits.has(d)) bodyByDigits.set(d, []);
      bodyByDigits.get(d)!.push(r.id);
    }
  }

  let matchCount       = 0; // crm_clients with matching body_client
  let crmDupPhones     = 0; // phone appears in crm_clients >1 time
  let crmOnlyCount     = 0; // crm with phone but no body match
  for (const [digits, ids] of crmByDigits) {
    if (ids.length > 1) crmDupPhones += ids.length;
    if (bodyByDigits.has(digits)) matchCount++;
    else crmOnlyCount++;
  }

  const bodyWithoutCrm = [...bodyByDigits.keys()].filter(d => !crmByDigits.has(d)).length;

  // inbody_tests without body_clients
  const { count: inbodyTotal } = await supabase
    .from('inbody_tests')
    .select('*', { count: 'exact', head: true });
  const { data: inbodyOrphans } = await supabase
    .from('inbody_tests')
    .select('id')
    .is('body_client_id', null)
    .limit(5);

  // fitbase_client_id populated in body_clients
  const bodyWithFbId = bodyClients.filter(r => r.fitbase_client_id !== null).length;

  return {
    fitbase_totals: {
      clients:   totalFbClients,
      contracts: totalFbContracts,
    },
    probe_clients_count: clientIds.length,
    client_data:         clientData,
    supabase_counts: {
      crm_clients_active:   crmTotal ?? 0,
      body_clients_total:   bodyClients.length,
      body_with_fitbase_id: bodyWithFbId,
      crm_body_matches:     matchCount,
      crm_only_no_body:     crmOnlyCount,
      body_only_no_crm:     bodyWithoutCrm,
      crm_dup_phone_clients: crmDupPhones,
      inbody_tests_total:   inbodyTotal ?? 0,
      inbody_no_body_client: (inbodyOrphans ?? []).length,
    },
    body_clients_phone_sample: phoneSample,
  };
}
