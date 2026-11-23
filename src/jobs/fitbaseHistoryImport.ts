import { supabase } from '../db/supabase';
import { rawGet, getTillOrderSteps, paginateGet } from '../http/fitbase';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const YEK_MS    = 5 * 3600_000;

function yekDate(ts: number): string {
  const d = new Date(ts + YEK_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  return n > 0 ? yekDate(n * 1000) : null;
}

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  const n = Number(v);
  if (n > 0) return new Date(n * 1000).toISOString();
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}

function todayStr(): string { return yekDate(Date.now()); }

// ── Job state ─────────────────────────────────────────────────────────────────

export interface HistoryImportJob {
  status: 'running' | 'done' | 'error';
  kind: 'full' | 'nightly';
  run_id: string | null;
  total_clients: number;
  processed: number;
  plans_upserted: number;
  sales_upserted: number;
  refunds_upserted: number;
  visits_upserted: number;
  errors: string[];
  started_at: string;
  finished_at?: string;
}

let _job: HistoryImportJob | null = null;

export function getHistoryImportJob(): HistoryImportJob | null { return _job; }

export function startHistoryImport(kind: 'full' | 'nightly'): HistoryImportJob | null {
  if (_job?.status === 'running') return null; // already running
  _job = {
    status: 'running', kind, run_id: null,
    total_clients: 0, processed: 0,
    plans_upserted: 0, sales_upserted: 0, refunds_upserted: 0, visits_upserted: 0,
    errors: [], started_at: new Date().toISOString(),
  };
  return _job;
}

// ── linkBodyClients ───────────────────────────────────────────────────────────

export async function linkBodyClients(): Promise<{ linked_by_fb: number; linked_by_phone: number }> {
  // Load all body_clients that aren't manually linked
  const { data: bodyRows } = await supabase
    .from('body_clients')
    .select('id, fitbase_client_id, phone, crm_client_id, crm_link_method');
  if (!bodyRows?.length) return { linked_by_fb: 0, linked_by_phone: 0 };

  // Load all crm_clients with fitbase_client_id
  const { data: crmRows } = await supabase
    .from('crm_clients')
    .select('id, fitbase_client_id, phone')
    .eq('is_deleted', false);
  if (!crmRows?.length) return { linked_by_fb: 0, linked_by_phone: 0 };

  // Build lookup maps
  const crmByFbId   = new Map<number, string>();  // fitbase_client_id → crm_clients.id
  const crmByDigits = new Map<string, string[]>(); // last-10 digits → list of crm_clients.id
  for (const c of crmRows as Array<{ id: string; fitbase_client_id: number | null; phone: string | null }>) {
    if (c.fitbase_client_id) crmByFbId.set(c.fitbase_client_id, c.id);
    const d = (c.phone ?? '').replace(/\D/g, '').slice(-10);
    if (d.length === 10) {
      if (!crmByDigits.has(d)) crmByDigits.set(d, []);
      crmByDigits.get(d)!.push(c.id);
    }
  }

  let linked_by_fb = 0, linked_by_phone = 0;

  for (const b of bodyRows as Array<{ id: number; fitbase_client_id: number | null; phone: string | null; crm_client_id: string | null; crm_link_method: string | null }>) {
    if (b.crm_link_method === 'manual') continue; // never overwrite manual

    // 1. By fitbase_client_id
    if (b.fitbase_client_id) {
      const crmId = crmByFbId.get(b.fitbase_client_id);
      if (crmId && b.crm_client_id !== crmId) {
        await supabase.from('body_clients').update({ crm_client_id: crmId, crm_link_method: 'fitbase_id' }).eq('id', b.id);
        linked_by_fb++;
        continue;
      }
      if (crmId) continue; // already linked, skip phone match
    }

    // 2. By last 10 phone digits (single match only)
    const digits = (b.phone ?? '').replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const matches = crmByDigits.get(digits) ?? [];
      if (matches.length === 1 && b.crm_client_id !== matches[0]) {
        await supabase.from('body_clients').update({ crm_client_id: matches[0], crm_link_method: 'phone' }).eq('id', b.id);
        linked_by_phone++;
      }
    }
  }

  return { linked_by_fb, linked_by_phone };
}

export async function getLinkStats(): Promise<{
  linked: number;
  no_crm_pair: number;
  disputed: Array<{ body_id: number; phone: string | null; crm_ids: string[] }>;
}> {
  const { data: bodyRows } = await supabase.from('body_clients').select('id, phone, crm_client_id');
  if (!bodyRows) return { linked: 0, no_crm_pair: 0, disputed: [] };

  const { data: crmRows } = await supabase.from('crm_clients').select('id, phone').eq('is_deleted', false);
  const crmByDigits = new Map<string, string[]>();
  for (const c of (crmRows ?? []) as Array<{ id: string; phone: string | null }>) {
    const d = (c.phone ?? '').replace(/\D/g, '').slice(-10);
    if (d.length === 10) {
      if (!crmByDigits.has(d)) crmByDigits.set(d, []);
      crmByDigits.get(d)!.push(c.id);
    }
  }

  let linked = 0, no_crm_pair = 0;
  const disputed: Array<{ body_id: number; phone: string | null; crm_ids: string[] }> = [];

  for (const b of bodyRows as Array<{ id: number; phone: string | null; crm_client_id: string | null }>) {
    if (b.crm_client_id) { linked++; continue; }
    const digits = (b.phone ?? '').replace(/\D/g, '').slice(-10);
    const matches = digits.length === 10 ? (crmByDigits.get(digits) ?? []) : [];
    if (matches.length > 1) {
      disputed.push({ body_id: b.id, phone: b.phone, crm_ids: matches });
    } else if (matches.length === 0) {
      no_crm_pair++;
    }
  }

  return { linked, no_crm_pair, disputed };
}

// ── Contract status mapping ───────────────────────────────────────────────────

function mapContractStatus(c: Record<string, unknown>): string {
  if (c.deleted_at) return 'cancelled';
  const today = todayStr();
  const endDate = toDate(c.end_date);
  if (c.activation_date) {
    if (endDate && endDate < today) return 'expired';
    return 'active';
  }
  // Not activated yet
  if (c.closed) return 'expired';
  return 'not_activated';
}

// ── Visits with date windowing ────────────────────────────────────────────────

async function fetchVisitsForClient(clientId: number): Promise<Record<string, unknown>[]> {
  const dateFrom = '2020-01-01';
  const dateTo   = todayStr();
  try {
    return await paginateGet(
      '/schedule-registration',
      { page_size: 100, client_id: clientId, date_from: dateFrom, date_to: dateTo },
      'history-import-visits',
    );
  } catch (e) {
    if (!/→ 400 /.test((e as Error).message)) throw e;
    // Large range rejected — split into 90-day windows
    const items: Record<string, unknown>[] = [];
    const seen  = new Set<string>();
    const start = new Date('2020-01-01').getTime();
    const end   = Date.now();
    let cur = start;
    while (cur < end) {
      const winFrom = yekDate(cur);
      const winTo   = yekDate(Math.min(cur + 90 * 86400_000, end));
      const chunk   = await paginateGet(
        '/schedule-registration',
        { page_size: 100, client_id: clientId, date_from: winFrom, date_to: winTo },
        'history-import-visits',
      );
      for (const item of chunk) {
        const id = String((item as Record<string, unknown>).id);
        if (!seen.has(id)) { seen.add(id); items.push(item); }
      }
      cur += 90 * 86400_000;
      await sleep(400);
    }
    return items;
  }
}

// ── Main import ───────────────────────────────────────────────────────────────

export async function runFitbaseHistoryImport(kind: 'full' | 'nightly', clientIds?: number[]): Promise<void> {
  if (!_job) return; // must be started via startHistoryImport first

  // 1. Create run record in DB
  const { data: runRow } = await supabase
    .from('crm_fitbase_import_runs')
    .insert({ kind, status: 'running' })
    .select('id').single();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  const job = _job;
  job.run_id = runId;

  let lastFid = 0;

  async function checkpoint() {
    if (!runId) return;
    await supabase.from('crm_fitbase_import_runs').update({
      processed:               job.processed,
      plans_upserted:          job.plans_upserted,
      sales_upserted:          job.sales_upserted,
      refunds_upserted:        job.refunds_upserted,
      visits_upserted:         job.visits_upserted,
      errors:                  job.errors.slice(-50),
      last_client_fitbase_id:  lastFid || null,
    }).eq('id', runId);
  }

  try {
    // 2. Load clients to process
    let clients: Array<{ id: string; fitbase_client_id: number }>;
    if (kind === 'nightly') {
      // Nightly: only clients with active/not_activated/frozen fitbase plans OR recent visits
      const ninetyDaysAgo = yekDate(Date.now() - 90 * 86400_000);
      const { data: activePlanClients } = await supabase
        .from('crm_client_plans')
        .select('client_id')
        .eq('source', 'fitbase')
        .in('status', ['active', 'not_activated', 'frozen']);
      const { data: recentVisitClients } = await supabase
        .from('crm_visit_history')
        .select('client_id')
        .gte('visit_date', ninetyDaysAgo);

      const activeIds = new Set([
        ...(activePlanClients ?? []).map((r: Record<string,unknown>) => r.client_id as string),
        ...(recentVisitClients ?? []).map((r: Record<string,unknown>) => r.client_id as string),
      ]);

      const { data: allWithFb } = await supabase
        .from('crm_clients')
        .select('id, fitbase_client_id')
        .not('fitbase_client_id', 'is', null)
        .eq('is_deleted', false);
      clients = (allWithFb ?? [])
        .filter((c: Record<string,unknown>) => activeIds.has(c.id as string))
        .map((c: Record<string,unknown>) => ({ id: c.id as string, fitbase_client_id: Number(c.fitbase_client_id) }));
    } else {
      const { data: allWithFb } = await supabase
        .from('crm_clients')
        .select('id, fitbase_client_id')
        .not('fitbase_client_id', 'is', null)
        .eq('is_deleted', false);
      clients = (allWithFb ?? []).map((c: Record<string,unknown>) => ({
        id: c.id as string,
        fitbase_client_id: Number(c.fitbase_client_id),
      }));
    }

    if (clientIds?.length) clients = clients.filter(c => clientIds.includes(c.fitbase_client_id));

    job.total_clients = clients.length;
    if (runId) {
      await supabase.from('crm_fitbase_import_runs').update({ total_clients: clients.length }).eq('id', runId);
    }

    // 3. Preload lookup tables
    const { data: plansData } = await supabase
      .from('crm_plans')
      .select('id, name, crm_plan_items(device_type_code)');
    const plansByName = new Map<string, { id: string; deviceCount: number }>();
    for (const p of (plansData ?? []) as Array<{ id: string; name: string; crm_plan_items: Array<{ device_type_code: string }> }>) {
      plansByName.set(p.name.toLowerCase().trim(), { id: p.id, deviceCount: p.crm_plan_items.length });
    }

    const { data: pmData } = await supabase.from('crm_payment_methods').select('id, name, kind');
    const pmByName = new Map<string, number>();
    let depositPmId: number | null = null;
    let bonusPmId:   number | null = null;
    for (const pm of (pmData ?? []) as Array<{ id: number; name: string; kind: string }>) {
      pmByName.set(pm.name.toLowerCase().trim(), pm.id);
      if (pm.kind === 'deposit') depositPmId = pm.id;
      if (pm.kind === 'bonus')   bonusPmId   = pm.id;
    }

    // 4. Per-client loop
    for (let i = 0; i < clients.length; i++) {
      const { id: clientId, fitbase_client_id: fid } = clients[i];

      try {
        lastFid = fid;
        await sleep(100); // small pause before each client

        // ── 4.1 Contracts ─────────────────────────────────────────────────────
        const contractsResp = await rawGet(`/client-contract?client_id=${fid}`);
        await sleep(300 + Math.random() * 200);
        const contracts = (contractsResp.items ?? []) as Record<string, unknown>[];

        for (const contract of contracts) {
          const ticket = contract.ticket as Record<string, unknown> | null;
          const ci     = ticket?.contract_item as Record<string, unknown> | null;
          const planName = (ci?.name ?? ticket?.name ?? contract.contract_name ?? '') as string;
          const planKey  = planName.toLowerCase().trim();
          const matched  = plansByName.get(planKey) ?? null;

          const sessionsTotal = ticket?.visits != null ? Number(ticket.visits) : null;
          const sessionsLeft  = contract.visits_left != null ? Number(contract.visits_left) : null;
          const status        = mapContractStatus(contract);
          const needsSplit    = matched !== null
            && matched.deviceCount > 1
            && (status === 'active' || status === 'not_activated');

          const activatedAt    = toDate(contract.activation_date);
          const planStartDate  = toDate(contract.begin_date);
          const validUntil     = toDate(contract.end_date);

          const { error: planErr } = await supabase.from('crm_client_plans').upsert({
            client_id:            clientId,
            branch_id:            BRANCH_ID,
            fitbase_contract_id:  Number(contract.id),
            source:               'fitbase',
            name:                 planName || null,
            plan_id:              matched?.id ?? null,
            status,
            sessions_total:       sessionsTotal,
            sessions_left:        sessionsLeft,
            purchased_at:         toDate(contract.payment_date),
            planned_start_date:   planStartDate,
            activated_at:         activatedAt,
            valid_until:          validUntil,
            needs_split:          needsSplit,
          }, { onConflict: 'fitbase_contract_id' });

          if (planErr) { job.errors.push(`client ${fid} contract ${contract.id}: ${planErr.message}`); }
          else job.plans_upserted++;
        }

        // ── 4.2 & 4.3 Sales + Refunds ─────────────────────────────────────────
        await sleep(300 + Math.random() * 200);
        const steps = await getTillOrderSteps({ client_id: fid });
        await sleep(300 + Math.random() * 200);

        // Group by order_id; null order_id → each step is its own order
        const orderMap = new Map<string, Record<string, unknown>[]>();
        for (const step of steps) {
          const s = step as Record<string, unknown>;
          if (Number(s.amount) < 0 || s.operation_type === 'refund') continue; // handle as refund
          const key = s.order_id != null ? String(s.order_id) : `step_${s.id}`;
          if (!orderMap.has(key)) orderMap.set(key, []);
          orderMap.get(key)!.push(s);
        }

        for (const [orderKey, orderSteps] of orderMap) {
          const orderId = orderSteps[0]?.order_id != null ? Number(orderSteps[0].order_id) : null;

          // Skip if already imported
          if (orderId !== null) {
            const { data: existing } = await supabase
              .from('crm_sales')
              .select('id')
              .eq('fitbase_order_id', orderId)
              .maybeSingle();
            if (existing) { job.sales_upserted++; continue; }
          } else {
            // No order_id — skip; can't do idempotency without fitbase_step_id in crm_sale_items
            job.errors.push(`client ${fid}: step ${orderSteps[0].id} has no order_id, skipped`);
            continue;
          }

          const total   = orderSteps.reduce((s, step) => s + Number(step.amount), 0);
          const cashier = ((orderSteps[0].created_by_user as Record<string,unknown> | null)?.name ?? null) as string | null;
          const manager = ((orderSteps[0].manager as Record<string,unknown> | null)?.name ?? null) as string | null;
          const paidAt  = tsToIso(orderSteps[0].pay_date ?? orderSteps[0].created_at);

          const { data: saleRow, error: saleErr } = await supabase
            .from('crm_sales')
            .insert({
              branch_id:        BRANCH_ID,
              client_id:        clientId,
              cashier:          cashier,
              manager:          manager,
              subtotal:         total,
              total:            total,
              discount_kind:    'none',
              status:           'completed',
              source:           'fitbase',
              fitbase_order_id: orderId,
              paid_at:          paidAt,
              shift_id:         null,
            })
            .select('id').single();

          if (saleErr || !saleRow) {
            job.errors.push(`client ${fid} order ${orderKey}: sale insert error: ${saleErr?.message}`);
            continue;
          }

          const saleId = (saleRow as { id: string }).id;

          // Insert items + payments for each step
          const itemInserts: Record<string, unknown>[] = [];
          const payInserts:  Record<string, unknown>[] = [];

          for (const step of orderSteps) {
            const s = step as Record<string, unknown>;
            const fbItemType = String(s.item_type ?? 'product');
            const crmItemType = fbItemType === 'contract' ? 'plan' : fbItemType;
            const itemName  = (s.item as Record<string,unknown> | null)?.name as string ?? null;
            const stepAmt   = Number(s.amount);
            const pmName    = ((s.payment_type as Record<string,unknown> | null)?.name as string ?? '').toLowerCase().trim();
            const pmId      = pmByName.get(pmName) ?? null;

            itemInserts.push({
              sale_id:    saleId,
              item_type:  crmItemType,
              name:       itemName,
              qty:        1,
              unit_price: stepAmt,
              total:      stepAmt,
            });

            if (stepAmt > 0) {
              const priceDeposit = Number((s.priceDeposit ?? 0));
              const priceBonus   = Number((s.priceBonus   ?? 0));
              const cashAmt      = stepAmt - priceDeposit - priceBonus;

              if (cashAmt > 0) {
                if (pmId === null) job.errors.push(`client ${fid} order ${orderKey}: step ${s.id} payment method "${pmName}" not found in CRM, inserted with null`);
                payInserts.push({ sale_id: saleId, payment_method_id: pmId, amount: cashAmt, fitbase_step_id: Number(s.id) });
              }
              if (priceDeposit > 0 && depositPmId !== null) {
                payInserts.push({ sale_id: saleId, payment_method_id: depositPmId, amount: priceDeposit });
              }
              if (priceBonus > 0 && bonusPmId !== null) {
                payInserts.push({ sale_id: saleId, payment_method_id: bonusPmId, amount: priceBonus });
              }

              // Deposit top-up → crm_balance_ops
              if (fbItemType === 'deposit') {
                const { error: balErr } = await supabase.from('crm_balance_ops').insert({
                  client_id: clientId,
                  wallet:    'deposit',
                  amount:    stepAmt,
                  reason:    'Пополнение депозита (Fitbase)',
                  created_by: 'fitbase_import',
                  created_at: tsToIso(s.created_at),
                });
                if (balErr) job.errors.push(`client ${fid} order ${orderKey}: balance_ops: ${balErr.message}`);
              }
            }
          }

          if (itemInserts.length) {
            const { error: itemErr } = await supabase.from('crm_sale_items').insert(itemInserts);
            if (itemErr) job.errors.push(`client ${fid} order ${orderKey}: items: ${itemErr.message}`);
          }
          if (payInserts.length) {
            const { error: payErr } = await supabase.from('crm_sale_payments').insert(payInserts);
            if (payErr) job.errors.push(`client ${fid} order ${orderKey}: payments: ${payErr.message}`);
          }

          job.sales_upserted++;
        }

        // Refunds
        const refundSteps = steps.filter(s => {
          const st = s as Record<string, unknown>;
          return Number(st.amount) < 0 || st.operation_type === 'refund';
        });

        for (const step of refundSteps) {
          const s = step as Record<string, unknown>;
          const stepId = Number(s.id);
          const amount = Math.abs(Number(s.amount));
          if (amount <= 0) continue;

          // Try to find matching crm_sale by order_id
          let saleId: string | null = null;
          if (s.order_id != null) {
            const { data: matchSale } = await supabase
              .from('crm_sales')
              .select('id')
              .eq('fitbase_order_id', Number(s.order_id))
              .maybeSingle();
            saleId = (matchSale as { id: string } | null)?.id ?? null;
          }

          const { error: refErr } = await supabase.from('crm_refunds').upsert({
            client_id:        clientId,
            source:           'fitbase',
            fitbase_step_id:  stepId,
            sale_id:          saleId,
            shift_id:         null,
            amount,
            reason:           'Возврат из Fitbase',
            created_by:       ((s.created_by_user as Record<string,unknown> | null)?.name as string ?? 'fitbase_import'),
            status:           'completed',
            created_at:       tsToIso(s.created_at),
          }, { onConflict: 'fitbase_step_id' });

          if (refErr) job.errors.push(`client ${fid} refund step ${stepId}: ${refErr.message}`);
          else job.refunds_upserted++;
        }

        // ── 4.4 Visits ───────────────────────────────────────────────────────
        const visits = await fetchVisitsForClient(fid);
        await sleep(200);

        const visitRows: Record<string, unknown>[] = [];
        for (const v of visits) {
          const vis = v as Record<string, unknown>;
          const ev  = vis.event as Record<string, unknown> | null ?? {};
          const tr  = ev.training as Record<string, unknown> | null ?? {};
          const cc  = vis.client_contract as Record<string, unknown> | null;
          visitRows.push({
            client_id:            clientId,
            fitbase_reg_id:       Number(vis.id),
            fitbase_contract_id:  cc?.id != null ? Number(cc.id) : null,
            status:               vis.status != null ? Number(vis.status) : 0,
            visit_at:             tsToIso(ev.date ?? null),
            training_name:        tr.name as string | null ?? null,
          });
        }

        if (visitRows.length) {
          // Upsert in chunks of 100
          for (let vi = 0; vi < visitRows.length; vi += 100) {
            const { error: visErr } = await supabase.from('crm_visit_history')
              .upsert(visitRows.slice(vi, vi + 100), { onConflict: 'fitbase_reg_id' });
            if (visErr) job.errors.push(`client ${fid} visits: ${visErr.message}`);
            else job.visits_upserted += visitRows.slice(vi, vi + 100).length;
          }
        }

      } catch (e) {
        const msg = `client ${fid}: ${(e as Error).message ?? String(e)}`;
        console.error('[history-import]', msg);
        job.errors.push(msg);
      }

      job.processed++;
      await checkpoint();
    }

    // Nightly: also run linkBodyClients
    if (kind === 'nightly') await linkBodyClients();

    job.status = 'done';
    job.finished_at = new Date().toISOString();

  } catch (e) {
    job.status = 'error';
    job.finished_at = new Date().toISOString();
    job.errors.push(`fatal: ${(e as Error).message ?? String(e)}`);
  } finally {
    if (runId) {
      await supabase.from('crm_fitbase_import_runs').update({
        status:           job.status,
        finished_at:      job.finished_at,
        processed:        job.processed,
        plans_upserted:   job.plans_upserted,
        sales_upserted:   job.sales_upserted,
        refunds_upserted: job.refunds_upserted,
        visits_upserted:  job.visits_upserted,
        errors:           job.errors.slice(-50),
      }).eq('id', runId);
    }
  }
}
