import { supabase } from '../db/supabase';
import { rawGet, getTillOrderSteps, paginateGet } from '../http/fitbase';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const YEK_MS    = 5 * 3600_000;

// Fitbase item_type → crm_sale_items.item_type
const ITEM_TYPE_MAP: Record<string, 'plan' | 'product' | 'deposit'> = {
  contract:     'plan',
  subscription: 'plan',
  service:      'plan',
  ticket:       'plan',
  product:      'product',
  item:         'product',
  товар:        'product',
  deposit:      'deposit',
  prepayment:   'deposit',
};

// Fitbase payment name synonyms → lowercase CRM name
// CRM: Наличные(1/cash), Карта(2/cashless), Kaspi QR(4), Рассрочка Kaspi 0-0-12(5), Рассрочка Halyk(6), С депозита(7/deposit), Бонусами(8/bonus)
const PM_SYNONYMS: Record<string, string> = {
  'нал':                    'наличные',
  'наличными':              'наличные',
  'наличный':               'наличные',
  'cash':                   'наличные',
  'картой':                 'карта',
  'карточкой':              'карта',
  'безнал':                 'карта',
  'безналичные':            'карта',
  'безналичный':            'карта',
  'терминал':               'карта',
  'terminal':               'карта',
  'card':                   'карта',
  'каспи':                  'kaspi qr',
  'kaspi':                  'kaspi qr',
  'каспи qr':               'kaspi qr',
  'kaspi qr':               'kaspi qr',
  'kaspi рассрочка':        'рассрочка kaspi 0-0-12',
  'рассрочка kaspi':        'рассрочка kaspi 0-0-12',
  'рассрочка каспи':        'рассрочка kaspi 0-0-12',
  'halyk':                  'рассрочка halyk',
  'халык':                  'рассрочка halyk',
  'депозит':                'с депозита',
  'deposit':                'с депозита',
  'с баланса':              'с депозита',
  'баланс':                 'с депозита',
  'бонус':                  'бонусами',
  'bonus':                  'бонусами',
  'бонусные':               'бонусами',
};

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
  done_clients: number;
  stats: { plans_upserted: number; sales_upserted: number; refunds_upserted: number; visits_upserted: number };
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
    total_clients: 0, done_clients: 0,
    stats: { plans_upserted: 0, sales_upserted: 0, refunds_upserted: 0, visits_upserted: 0 },
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

async function rollbackSale(saleId: string): Promise<void> {
  await supabase.from('crm_sale_payments').delete().eq('sale_id', saleId);
  await supabase.from('crm_sale_items').delete().eq('sale_id', saleId);
  await supabase.from('crm_sales').delete().eq('id', saleId);
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
    try {
      const { error } = await supabase.from('crm_fitbase_import_runs').update({
        done_clients:            job.done_clients,
        stats:                   job.stats,
        errors:                  job.errors.slice(-50),
        last_client_fitbase_id:  lastFid || null,
      }).eq('id', runId);
      if (error) console.error('[history-import] checkpoint update error:', error.message);
    } catch (e) {
      console.error('[history-import] checkpoint exception:', String(e));
    }
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
        .gte('visit_at', ninetyDaysAgo);

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
    console.log(`[history-import] starting loop: ${clients.length} clients`);
    let pmDiagCount = 0; // log first few payment objects to diagnose pm name field

    for (let i = 0; i < clients.length; i++) {
      const { id: clientId, fitbase_client_id: fid } = clients[i];
      lastFid = fid;
      let cPlans = 0, cSales = 0, cPays = 0, cVisits = 0;

      // ── 4.1 Contracts ───────────────────────────────────────────────────────
      try {
        await sleep(100);
        const contractsResp = await rawGet(`/client-contract?client_id=${fid}`);
        await sleep(300 + Math.random() * 200);
        const contracts = (contractsResp.items ?? []) as Record<string, unknown>[];

        for (const contract of contracts) {
          const ticket   = contract.ticket as Record<string, unknown> | null;
          const ci       = ticket?.contract_item as Record<string, unknown> | null;
          const planName = (ci?.name ?? ticket?.name ?? contract.contract_name ?? '') as string;
          const planKey  = planName.toLowerCase().trim();
          const matched  = plansByName.get(planKey) ?? null;

          const sessionsTotal = ticket?.visits != null ? Number(ticket.visits) : null;
          const sessionsLeft  = contract.visits_left != null ? Number(contract.visits_left) : null;
          const status        = mapContractStatus(contract);
          const needsSplit    = matched !== null
            && matched.deviceCount > 1
            && (status === 'active' || status === 'not_activated');

          const { error: planErr } = await supabase.from('crm_client_plans').upsert({
            client_id:            clientId,
            fitbase_contract_id:  Number(contract.id),
            source:               'fitbase',
            kind:                 'abonement',
            name:                 planName || null,
            plan_id:              matched?.id ?? null,
            status,
            sessions_total:       sessionsTotal,
            sessions_left:        sessionsLeft,
            purchased_at:         toDate(contract.payment_date),
            planned_start_date:   toDate(contract.begin_date),
            activated_at:         toDate(contract.activation_date),
            valid_until:          toDate(contract.end_date),
            needs_split:          needsSplit,
          }, { onConflict: 'fitbase_contract_id' });

          if (planErr) {
            const msg = `client ${fid} contract ${contract.id}: ${planErr.message}`;
            console.error('[history-import]', msg);
            job.errors.push(msg);
          } else { job.stats.plans_upserted++; cPlans++; }
        }
      } catch (e) {
        const msg = `client ${fid} contracts: ${(e as Error).message ?? String(e)}`;
        console.error('[history-import]', msg);
        job.errors.push(msg);
      }

      // ── 4.2 & 4.3 Sales + Refunds ───────────────────────────────────────────
      try {
        await sleep(300 + Math.random() * 200);
        const steps = await getTillOrderSteps({ client_id: fid });
        await sleep(300 + Math.random() * 200);

        const refundSteps = (steps as Record<string, unknown>[]).filter(
          s => Number((s as Record<string,unknown>).amount) < 0 || (s as Record<string,unknown>).operation_type === 'refund',
        );

        const orderMap = new Map<string, Record<string, unknown>[]>();
        for (const step of steps as Record<string, unknown>[]) {
          if (Number(step.amount) < 0 || step.operation_type === 'refund') continue;
          if (step.order_id == null) {
            job.errors.push(`client ${fid}: step ${step.id} has no order_id, skipped`);
            continue;
          }
          const key = String(step.order_id);
          if (!orderMap.has(key)) orderMap.set(key, []);
          orderMap.get(key)!.push(step);
        }

        for (const [orderKey, orderSteps] of orderMap) {
          const orderId = Number(orderSteps[0].order_id);

          const { data: existing } = await supabase
            .from('crm_sales').select('id').eq('fitbase_order_id', orderId).maybeSingle();
          if (existing) { job.stats.sales_upserted++; continue; }

          // Validate item types and build inserts BEFORE touching the DB
          let orderValid = true;
          const itemInserts: Record<string, unknown>[] = [];
          const payInserts:  Record<string, unknown>[] = [];

          for (const step of orderSteps) {
            const s = step as Record<string, unknown>;
            const rawItemType = String(s.item_type ?? '').toLowerCase().trim();
            const crmItemType = ITEM_TYPE_MAP[rawItemType];

            console.log(`[history-import] client ${fid} order ${orderKey} step ${s.id} item_type="${rawItemType}"`);
            if (!crmItemType) {
              const msg = `client ${fid} order ${orderKey}: unknown item_type="${rawItemType}", order skipped`;
              console.error('[history-import]', msg);
              job.errors.push(msg);
              orderValid = false;
              break;
            }

            const itemName = (s.item as Record<string,unknown> | null)?.name as string ?? null;
            const stepAmt  = Number(s.amount);
            itemInserts.push({ sale_id: '', item_type: crmItemType, name: itemName, qty: 1, unit_price: stepAmt, total: stepAmt });

            if (stepAmt > 0) {
              const ptRaw = ((s.payment_type    as Record<string,unknown> | null)?.name as string ?? '').trim();
              const pmRaw = ((s.payment_method  as Record<string,unknown> | null)?.name as string ?? '').trim();
              const pcRaw = ((s.payment_channel as Record<string,unknown> | null)?.name as string ?? '').trim();
              const rawPmName  = (ptRaw || pmRaw || pcRaw).toLowerCase();

              if (pmDiagCount < 5) {
                console.log(`[history-import] PAYMENT_OBJECT client ${fid} step ${s.id}: payment_type=${JSON.stringify(s.payment_type)}, payment_method=${JSON.stringify(s.payment_method)}, payment_channel=${JSON.stringify(s.payment_channel)}, priceDeposit=${s.priceDeposit}, priceBonus=${s.priceBonus}`);
                pmDiagCount++;
              }

              const resolvedName = PM_SYNONYMS[rawPmName] ?? rawPmName;
              const priceDeposit = Number(s.priceDeposit ?? 0);
              const priceBonus   = Number(s.priceBonus   ?? 0);
              const cashAmt      = stepAmt - priceDeposit - priceBonus;

              if (cashAmt > 0) {
                const pmId = pmByName.get(resolvedName);
                if (pmId == null) {
                  const msg = `client ${fid} order ${orderKey}: step ${s.id} pm="${rawPmName}" resolved="${resolvedName}" not found, order skipped`;
                  console.error('[history-import]', msg);
                  job.errors.push(msg);
                  orderValid = false;
                  break;
                }
                payInserts.push({ sale_id: '', payment_method_id: pmId, amount: cashAmt, fitbase_step_id: Number(s.id) });
              }
              if (priceDeposit > 0 && depositPmId !== null)
                payInserts.push({ sale_id: '', payment_method_id: depositPmId, amount: priceDeposit });
              if (priceBonus > 0 && bonusPmId !== null)
                payInserts.push({ sale_id: '', payment_method_id: bonusPmId, amount: priceBonus });
            }
          }
          if (!orderValid) continue;

          const total   = orderSteps.reduce((acc, s) => acc + Number(s.amount), 0);
          const cashier = ((orderSteps[0].created_by_user as Record<string,unknown> | null)?.name ?? null) as string | null;
          const manager = ((orderSteps[0].manager as Record<string,unknown> | null)?.name ?? null) as string | null;
          const paidAt  = tsToIso(orderSteps[0].pay_date ?? orderSteps[0].created_at);

          const { data: saleRow, error: saleErr } = await supabase
            .from('crm_sales')
            .insert({
              branch_id: BRANCH_ID, client_id: clientId,
              cashier, manager, subtotal: total, total,
              discount_kind: 'none', status: 'completed',
              source: 'fitbase', fitbase_order_id: orderId,
              paid_at: paidAt, shift_id: null,
            })
            .select('id').single();

          if (saleErr || !saleRow) {
            const msg = `client ${fid} order ${orderKey}: sale insert: ${saleErr?.message}`;
            console.error('[history-import]', msg);
            job.errors.push(msg);
            continue;
          }

          const saleId = (saleRow as { id: string }).id;
          for (const item of itemInserts) item.sale_id = saleId;
          for (const pay  of payInserts)  pay.sale_id  = saleId;

          if (itemInserts.length) {
            const { error: itemErr } = await supabase.from('crm_sale_items').insert(itemInserts);
            if (itemErr) {
              const msg = `client ${fid} order ${orderKey}: items: ${itemErr.message}`;
              console.error('[history-import]', msg);
              job.errors.push(msg);
              await rollbackSale(saleId);
              continue;
            }
          }
          if (payInserts.length) {
            const { error: payErr } = await supabase.from('crm_sale_payments').insert(payInserts);
            if (payErr) {
              const msg = `client ${fid} order ${orderKey}: payments: ${payErr.message}`;
              console.error('[history-import]', msg);
              job.errors.push(msg);
              await rollbackSale(saleId);
              continue;
            }
          }

          // balance_ops for deposit top-ups
          for (const step of orderSteps) {
            const s = step as Record<string, unknown>;
            if (ITEM_TYPE_MAP[String(s.item_type ?? '').toLowerCase().trim()] === 'deposit' && Number(s.amount) > 0) {
              const { error: balErr } = await supabase.from('crm_balance_ops').insert({
                client_id: clientId, wallet: 'deposit', amount: Number(s.amount),
                reason: 'Пополнение депозита (Fitbase)', created_by: 'fitbase_import',
                created_at: tsToIso(s.created_at),
              });
              if (balErr) {
                const msg = `client ${fid} order ${orderKey}: balance_ops: ${balErr.message}`;
                console.error('[history-import]', msg);
                job.errors.push(msg);
              }
            }
          }

          cPays += payInserts.length;
          job.stats.sales_upserted++;
          cSales++;
        }

        // Refunds
        for (const step of refundSteps) {
          const s      = step as Record<string, unknown>;
          const stepId = Number(s.id);
          const amount = Math.abs(Number(s.amount));
          if (amount <= 0) continue;

          if (s.order_id == null) {
            job.errors.push(`client ${fid}: refund step ${stepId} has no order_id, skipped`);
            continue;
          }

          const { data: matchSale } = await supabase
            .from('crm_sales').select('id').eq('fitbase_order_id', Number(s.order_id)).maybeSingle();
          const saleId = (matchSale as { id: string } | null)?.id ?? null;
          if (!saleId) {
            job.errors.push(`client ${fid}: refund step ${stepId} order ${s.order_id} no matching sale, skipped`);
            continue;
          }

          const { error: refErr } = await supabase.from('crm_refunds').upsert({
            source: 'fitbase', fitbase_step_id: stepId,
            sale_id: saleId, shift_id: null, amount,
            reason: 'Возврат из Fitbase',
            created_by: ((s.created_by_user as Record<string,unknown> | null)?.name as string ?? 'fitbase_import'),
            created_at: tsToIso(s.created_at),
          }, { onConflict: 'fitbase_step_id' });

          if (refErr) {
            const msg = `client ${fid} refund step ${stepId}: ${refErr.message}`;
            console.error('[history-import]', msg);
            job.errors.push(msg);
          } else job.stats.refunds_upserted++;
        }
      } catch (e) {
        const msg = `client ${fid} sales/refunds: ${(e as Error).message ?? String(e)}`;
        console.error('[history-import]', msg);
        job.errors.push(msg);
      }

      // ── 4.4 Visits ──────────────────────────────────────────────────────────
      try {
        const visits = await fetchVisitsForClient(fid);
        await sleep(200);

        const visitRows: Record<string, unknown>[] = [];
        for (const v of visits) {
          const vis = v as Record<string, unknown>;
          const ev  = (vis.event as Record<string, unknown> | null) ?? {};
          const tr  = (ev.training as Record<string, unknown> | null) ?? {};
          const cc  = vis.client_contract as Record<string, unknown> | null;
          visitRows.push({
            client_id:            clientId,
            client_fitbase_id:    fid,
            fitbase_reg_id:       Number(vis.id),
            fitbase_contract_id:  cc?.id != null ? Number(cc.id) : null,
            status:               vis.status != null ? Number(vis.status) : 0,
            visit_at:             tsToIso(ev.date ?? null),
            training_name:        (tr.name as string | null) ?? null,
          });
        }

        for (let vi = 0; vi < visitRows.length; vi += 100) {
          const chunk = visitRows.slice(vi, vi + 100);
          const { error: visErr } = await supabase.from('crm_visit_history')
            .upsert(chunk, { onConflict: 'fitbase_reg_id' });
          if (visErr) {
            const msg = `client ${fid} visits chunk ${vi}: ${visErr.message}`;
            console.error('[history-import]', msg);
            job.errors.push(msg);
          } else { job.stats.visits_upserted += chunk.length; cVisits += chunk.length; }
        }
      } catch (e) {
        const msg = `client ${fid} visits: ${(e as Error).message ?? String(e)}`;
        console.error('[history-import]', msg);
        job.errors.push(msg);
      }

      console.log(`[history-import] client ${fid} (${i + 1}/${clients.length}): plans ${cPlans}, sales ${cSales}, payments ${cPays}, visits ${cVisits}`);

      job.done_clients++;
      if (job.done_clients % 10 === 0 || i === clients.length - 1) await checkpoint();
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
        status:       job.status,
        finished_at:  job.finished_at,
        done_clients: job.done_clients,
        stats:        job.stats,
        errors:       job.errors.slice(-50),
      }).eq('id', runId);
    }
  }
}
