import 'dotenv/config';
import path from 'path';
import express from 'express';
import { env, isDry }    from './config';
import { isInWorkWindow, isInWatchWindow } from './core/window';
import { acquireLock, releaseLock } from './core/lock';
import { supabase }      from './db/supabase';
import { runTrial,        JOB_NAME as TRIAL_JOB }   from './jobs/trial';
import { runDailySummary, JOB_NAME as SUMMARY_JOB }  from './jobs/dailySummary';
import { runBudget }                                  from './jobs/budget';
import { runProbeLtv }                                from './jobs/probeLtv';
import { runProbeContracts }                          from './jobs/probeContracts';
import { runProbeUnsorted }                           from './jobs/probeUnsorted';
import { runLifecyclePlan }                           from './jobs/lifecyclePlan';
import { runWatch,      JOB_NAME as WATCH_JOB }      from './jobs/watch';
import { runNewLeads,  JOB_NAME as NEW_LEADS_JOB }   from './jobs/newLeads';
import { runWatchBrief, JOB_NAME as BRIEF_JOB }      from './jobs/watchBrief';
import { runProbeTasks }                              from './jobs/probeTasks';
import { runProbeLeadsApi }                           from './jobs/probeLeadsApi';
import { runInactive,  JOB_NAME as INACTIVE_JOB }    from './jobs/inactive';
import { mountWindowRoutes }                          from './http/window';
import { mountKvizRoutes }                            from './http/kviz';
import { mountShellRoutes }                           from './http/shell';
import { buildClientsSyncRoute }                      from './http/measure';
import { buildShiftsAutocloseRoute }                  from './http/shifts';
import { runFitbaseOps, JOB_NAME as FITBASE_OPS_JOB } from './jobs/fitbaseOps';
import { runFitbaseCrmSync } from './jobs/fitbaseCrmSync';
import { mountScriptologRoutes } from './http/scriptolog';
import { mountStaffRoutes } from './http/staff';
import { buildTvRouter } from './http/tv';
import { runCrmLifecycle } from './http/crm';
import { runCrmLeadsSync } from './jobs/crmLeadsSync';
import { runScriptologReminders, JOB_NAME as REMINDERS_JOB } from './jobs/scriptologReminders';
import { runControl, runControlRange } from './jobs/control';
import { syncControlSheet, shouldSyncSheet } from './jobs/controlSheetSync';
import { runProbeControl } from './jobs/probeControl';
import { runProbeClientHistory } from './jobs/probeClientHistory';
import { runFitbaseHistoryImport, startHistoryImport, getHistoryImportJob } from './jobs/fitbaseHistoryImport';
import { POSITION_PRESETS } from './core/permissions';
import { mountTelegramRoute } from './http/telegram';
import { buildCheckinRouter } from './http/checkin';
import { buildPbxRouter, runPbxSync } from './http/pbx';
import { buildControl2Router } from './http/control2';
import { runControl2, runControl2Range } from './jobs/control2';
import { seedDefaultVersions } from './control/lineVersions';

const PROCESS_STARTED_AT = new Date().toISOString();

const app = express();

const JOBS: Record<string, () => Promise<unknown>> = {
  [TRIAL_JOB]:   runTrial,
  [SUMMARY_JOB]: runDailySummary,
  budget:        runBudget,
};

function checkSecret(req: express.Request): boolean {
  return (
    req.headers['x-cron-secret'] === env.CRON_SECRET ||
    req.query.key                 === env.CRON_SECRET
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// probe-ltv: synchronous, returns JSON directly (bypasses work-window + lock)
async function handleProbeLtv(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    const limit  = req.query.limit ? Number(req.query.limit) : 15;
    const result = await runProbeLtv({ limit });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

// Must be registered before the generic /run/:job route
app.get('/run/probe-ltv',  handleProbeLtv);
app.post('/run/probe-ltv', handleProbeLtv);

// probe-contracts: synchronous, returns JSON directly
async function handleProbeContracts(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    const result = await runProbeContracts();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

app.get('/run/probe-contracts',  handleProbeContracts);
app.post('/run/probe-contracts', handleProbeContracts);

// probe-unsorted: synchronous, returns JSON directly
async function handleProbeUnsorted(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    const result = await runProbeUnsorted();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

app.get('/run/probe-unsorted',  handleProbeUnsorted);
app.post('/run/probe-unsorted', handleProbeUnsorted);

// watch: checks work window (08:00-22:30 / 08:00-21:00), fire-and-forget with lock
async function handleWatch(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  if (!isInWatchWindow()) {
    await insertRun(WATCH_JOB, 'skipped', 0, null, null);
    res.json({ status: 'skipped', reason: 'outside watch window' }); return;
  }
  const locked = await acquireLock(WATCH_JOB, 4 * 60);
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }
  res.status(202).json({ status: 'accepted', job: WATCH_JOB });
  executeJob(WATCH_JOB, runWatch);
}

app.get('/run/watch',  handleWatch);
app.post('/run/watch', handleWatch);

// new-leads: lightweight job every minute — fast NEW_LEAD / NEW_LEAD_NO_TASK intake
async function handleNewLeads(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  if (!isInWatchWindow()) {
    await insertRun(NEW_LEADS_JOB, 'skipped', 0, null, null);
    res.json({ status: 'skipped', reason: 'outside watch window' }); return;
  }
  const locked = await acquireLock(NEW_LEADS_JOB, 2 * 60); // 2-min TTL
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }
  res.status(202).json({ status: 'accepted', job: NEW_LEADS_JOB });
  executeJob(NEW_LEADS_JOB, runNewLeads);
}

app.get('/run/new-leads',  handleNewLeads);
app.post('/run/new-leads', handleNewLeads);

// watch-brief: single run per day at 08:00
async function handleWatchBrief(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  const locked = await acquireLock(BRIEF_JOB, 5 * 60);
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }
  res.status(202).json({ status: 'accepted', job: BRIEF_JOB });
  executeJob(BRIEF_JOB, runWatchBrief);
}

app.get('/run/watch-brief',  handleWatchBrief);
app.post('/run/watch-brief', handleWatchBrief);

// probe-tasks: synchronous, returns JSON directly
async function handleProbeTasks(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    const result = await runProbeTasks();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

app.get('/run/probe-tasks',  handleProbeTasks);
app.post('/run/probe-tasks', handleProbeTasks);

// probe-leads-api: synchronous, read-only Fitbase exploration
async function handleProbeLeadsApi(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    const result = await runProbeLeadsApi();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

app.get('/run/probe-leads-api',  handleProbeLeadsApi);
app.post('/run/probe-leads-api', handleProbeLeadsApi);

// inactive: once per day at 09:00, fire-and-forget with lock
async function handleInactive(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  if (!isInWorkWindow()) {
    await insertRun(INACTIVE_JOB, 'skipped', 0, null, null);
    res.json({ status: 'skipped', reason: 'outside work window' }); return;
  }
  const locked = await acquireLock(INACTIVE_JOB, 10 * 60);
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }
  res.status(202).json({ status: 'accepted', job: INACTIVE_JOB });
  executeJob(INACTIVE_JOB, runInactive);
}

app.get('/run/inactive',  handleInactive);
app.post('/run/inactive', handleInactive);

// lifecycle-plan: fire-and-forget, 30-min lock, manages its own job_runs entry via runId
async function handleLifecyclePlan(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  if (isDry('lifecycle')) {
    res.json({ status: 'dry_run', message: 'LIFECYCLE_DRY_RUN=true — set to false in env to enable' }); return;
  }

  const locked = await acquireLock('lifecycle-plan', 30 * 60);
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }

  res.status(202).json({ status: 'accepted', job: 'lifecycle-plan' });
  executeLifecyclePlan(); // fire-and-forget
}

app.get('/run/lifecycle-plan',  handleLifecyclePlan);
app.post('/run/lifecycle-plan', handleLifecyclePlan);

// fitbase-ops sync: fire-and-forget with lock
async function handleFitbaseOps(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const locked = await acquireLock(FITBASE_OPS_JOB, 10 * 60);
  if (!locked) { res.json({ status: 'already_running' }); return; }
  res.status(202).json({ status: 'accepted', job: FITBASE_OPS_JOB });
  executeJob(FITBASE_OPS_JOB, runFitbaseOps);
}
app.get('/run/fitbase-ops',  handleFitbaseOps);
app.post('/run/fitbase-ops', handleFitbaseOps);

// fitbase-crm-sync: leads + visits
async function handleFitbaseCrmSync(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const locked = await acquireLock('fitbase-crm-sync', 10 * 60);
  if (!locked) { res.json({ status: 'already_running' }); return; }
  res.status(202).json({ status: 'accepted', job: 'fitbase-crm-sync' });
  executeJob('fitbase-crm-sync', runFitbaseCrmSync);
}
app.get('/run/fitbase-crm-sync',  handleFitbaseCrmSync);
app.post('/run/fitbase-crm-sync', handleFitbaseCrmSync);

// crm-leads-sync: sync funnels + leads + tasks from Fitbase, every 5 min
async function handleCrmLeadsSync(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const locked = await acquireLock('crm-leads-sync', 5 * 60);
  if (!locked) { res.json({ status: 'already_running' }); return; }
  res.status(202).json({ status: 'accepted', job: 'crm-leads-sync' });
  executeJob('crm-leads-sync', runCrmLeadsSync);
}
app.get('/run/crm-leads-sync',  handleCrmLeadsSync);
app.post('/run/crm-leads-sync', handleCrmLeadsSync);

// crm-lifecycle: plan activation/expiry, daily at 00:05 UTC+5
async function handleCrmLifecycle(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await runCrmLifecycle();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
app.get('/run/crm-lifecycle',  handleCrmLifecycle);
app.post('/run/crm-lifecycle', handleCrmLifecycle);

// crm-import-fix-prices: fix ~515 Fitbase sales imported with total=0
async function runCrmImportFixPrices(dry: boolean): Promise<Record<string, number>> {
  let checked = 0, updated = 0, skipped = 0;

  // Get crm_sales with fitbase_order_id and total=0
  const { data: zeroes, error: ze } = await supabase
    .from('crm_sales')
    .select('id, fitbase_order_id')
    .eq('total', 0)
    .not('fitbase_order_id', 'is', null)
    .limit(600);
  if (ze) throw new Error(ze.message);

  for (const sale of (zeroes || [])) {
    checked++;
    const orderId = Number(sale.fitbase_order_id);
    if (!orderId) { skipped++; continue; }

    // Find in fitbase_operations by raw->>'order_id'
    const { data: ops } = await supabase
      .from('fitbase_operations')
      .select('id, raw')
      .filter('raw->>order_id', 'eq', String(orderId))
      .limit(1);
    const op = ops?.[0] as Record<string, unknown> | undefined;
    if (!op) { skipped++; continue; }

    const raw = op.raw as Record<string, unknown>;
    const amount = Number(raw.amount ?? raw.total ?? 0);
    if (!amount) { skipped++; continue; }

    // Parse items and payments from raw
    const rawItems = Array.isArray(raw.items) ? raw.items as Record<string, unknown>[] : [];
    const rawPays  = Array.isArray(raw.payments) ? raw.payments as Record<string, unknown>[] : [];

    if (!dry) {
      await supabase.from('crm_sales').update({ total: amount }).eq('id', sale.id as string);
      // Update items if present
      for (const it of rawItems) {
        const itemAmt = Number(it.amount ?? it.price ?? 0);
        if (it.id && itemAmt) {
          await supabase.from('crm_sale_items')
            .update({ amount: itemAmt, unit_price: Number(it.unit_price ?? it.price ?? itemAmt) })
            .eq('sale_id', sale.id as string)
            .eq('id', it.id as string);
        }
      }
      // Update payments if present
      for (const p of rawPays) {
        const payAmt = Number(p.amount ?? 0);
        if (p.id && payAmt) {
          await supabase.from('crm_sale_payments')
            .update({ amount: payAmt })
            .eq('sale_id', sale.id as string)
            .eq('id', p.id as string);
        }
      }
    }
    updated++;
  }
  return { checked, updated, skipped, dry: dry ? 1 : 0 };
}

async function handleCrmImportFixPrices(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const dry = req.query.mode !== 'apply';
  try {
    const result = await runCrmImportFixPrices(dry);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
app.get('/run/crm-import-fix-prices',  handleCrmImportFixPrices);
app.post('/run/crm-import-fix-prices', handleCrmImportFixPrices);

// crm-fill-plan-prices: backfill price/sale_id/sold_by in crm_client_plans from crm_sale_items
async function runCrmFillPlanPrices(dry: boolean): Promise<Record<string, number>> {
  let checked = 0, updated = 0, skipped = 0;

  const { data: plans, error: pe } = await supabase
    .from('crm_client_plans')
    .select('id, client_id, plan_id, purchased_at')
    .is('price', null)
    .eq('source', 'fitbase')
    .limit(2000);
  if (pe) throw new Error(pe.message);

  for (const cp of (plans ?? []) as Record<string,unknown>[]) {
    checked++;
    if (!cp.plan_id) { skipped++; continue; }

    // Find sale item matching this client+plan closest by date
    const { data: items } = await supabase
      .from('crm_sale_items')
      .select('id, sale_id, unit_price, crm_sales!inner(id, client_id, cashier, source)')
      .eq('item_type', 'plan')
      .eq('plan_id', cp.plan_id as string)
      .eq('crm_sales.client_id', cp.client_id as string)
      .order('created_at', { ascending: false })
      .limit(5);

    const si = ((items ?? []) as Record<string,unknown>[])[0];
    if (!si || !si.unit_price || Number(si.unit_price) <= 0) { skipped++; continue; }

    const sale = (si.crm_sales as Record<string,unknown>[] | Record<string,unknown>);
    const saleRow = Array.isArray(sale) ? sale[0] : sale;
    if (!dry) {
      const { error: ue } = await supabase.from('crm_client_plans').update({
        price:   Number(si.unit_price),
        sale_id: si.sale_id as string,
        sold_by: (saleRow?.cashier as string) ?? null,
      }).eq('id', cp.id as string);
      if (ue) { console.error('[fill-plan-prices] update error', cp.id, ue.message); skipped++; continue; }
    }
    updated++;
  }
  return { checked, updated, skipped, dry: dry ? 1 : 0 };
}

async function handleCrmFillPlanPrices(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const dry = req.query.mode !== 'apply';
  try {
    const result = await runCrmFillPlanPrices(dry);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
app.get('/run/crm-fill-plan-prices',  handleCrmFillPlanPrices);
app.post('/run/crm-fill-plan-prices', handleCrmFillPlanPrices);

// scriptolog-reminders: every 15 min 09:00-22:00 Almaty (window checked inside job)
async function handleScriptologReminders(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const locked = await acquireLock(REMINDERS_JOB, 5 * 60);
  if (!locked) { res.json({ status: 'already_running' }); return; }
  res.status(202).json({ status: 'accepted', job: REMINDERS_JOB });
  executeJob(REMINDERS_JOB, runScriptologReminders);
}
app.get('/run/scriptolog-reminders',  handleScriptologReminders);
app.post('/run/scriptolog-reminders', handleScriptologReminders);

// control: 5-standard manager check, every 10 min 08:00-23:00 + finalize at 07:55
async function handleControl(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const finalize = req.query.finalize === '1';
  const date     = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  const qFrom    = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined;
  const qTo      = typeof req.query.to   === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)   ? req.query.to   : undefined;

  if (qFrom && qTo) {
    const locked = await acquireLock('control', 30 * 60);
    if (!locked) { res.json({ status: 'already_running' }); return; }
    res.status(202).json({ status: 'accepted', job: 'control-range', from: qFrom, to: qTo });
    executeJob('control', () => runControlRange(qFrom, qTo));
  } else {
    const locked = await acquireLock('control', 8 * 60);
    if (!locked) { res.json({ status: 'already_running' }); return; }
    res.status(202).json({ status: 'accepted', job: 'control', finalize, date });
    executeJob('control', async () => {
      if (await shouldSyncSheet()) await syncControlSheet();
      return runControl(finalize, date);
    });
  }
}
app.get('/run/control',  handleControl);
app.post('/run/control', handleControl);

async function handleControlSheetSync(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await syncControlSheet();
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
app.get('/run/control-sheet-sync',  handleControlSheetSync);
app.post('/run/control-sheet-sync', handleControlSheetSync);

// control2: v2 engine, once per day or range; supports ?date=, ?from=&to=
async function handleControl2(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const qDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  const qFrom = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : undefined;
  const qTo   = typeof req.query.to   === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)   ? req.query.to   : undefined;

  if (qFrom && qTo) {
    const locked = await acquireLock('control2', 30 * 60);
    if (!locked) { res.json({ status: 'already_running' }); return; }
    res.status(202).json({ status: 'accepted', job: 'control2-range', from: qFrom, to: qTo });
    executeJob('control2', () => runControl2Range(qFrom, qTo));
  } else {
    const locked = await acquireLock('control2', 10 * 60);
    if (!locked) { res.json({ status: 'already_running' }); return; }
    res.status(202).json({ status: 'accepted', job: 'control2', date: qDate });
    executeJob('control2', () => runControl2(qDate));
  }
}
app.get('/run/control2',  handleControl2);
app.post('/run/control2', handleControl2);

// probe-control: synchronous, read-only, Fitbase + Supabase exploration
async function handleProbeControl(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await runProbeControl();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
app.get('/run/probe-control',  handleProbeControl);
app.post('/run/probe-control', handleProbeControl);

// probe-client-history: synchronous, read-only Fitbase + Supabase exploration
async function handleProbeClientHistory(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const { client_ids, phone } = req.query as Record<string, string>;
    const result = await runProbeClientHistory({ client_ids, phone });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
app.get('/run/probe-client-history',  handleProbeClientHistory);
app.post('/run/probe-client-history', handleProbeClientHistory);

// pbx-sync: pull last 2h from OnlinePBX API
async function handlePbxSync(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const result = await runPbxSync();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
app.get('/run/pbx-sync',  handlePbxSync);
app.post('/run/pbx-sync', handlePbxSync);

// fitbase-history-import — start full or nightly history import
async function handleFitbaseHistoryImport(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const kind = (req.query.kind === 'nightly' ? 'nightly' : 'full') as 'full' | 'nightly';
  const job = startHistoryImport(kind);
  if (!job) { res.status(409).json({ error: 'Импорт уже идёт', ...getHistoryImportJob() }); return; }
  res.status(202).json({ status: 'accepted', kind });
  runFitbaseHistoryImport(kind).catch(e => {
    const j = getHistoryImportJob();
    if (j) { j.status = 'error'; j.errors.push(String(e)); }
  });
}

async function handleFitbaseHistoryStatus(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const job = getHistoryImportJob();
  if (!job) { res.json({ status: 'idle' }); return; }
  res.json(job);
}

app.get('/run/fitbase-history-import',         handleFitbaseHistoryImport);
app.post('/run/fitbase-history-import',        handleFitbaseHistoryImport);
app.get('/run/fitbase-history-import/status',  handleFitbaseHistoryStatus);
app.post('/run/fitbase-history-import/status', handleFitbaseHistoryStatus);

// shifts-autoclose — must be before generic /run/:job
app.use(buildShiftsAutocloseRoute());

// clients-sync and clients-debug — must be before generic /run/:job
app.use(buildClientsSyncRoute());

async function handleRun(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  const jobName = req.params.job;
  const handler = JOBS[jobName];
  if (!handler) {
    res.status(404).json({ error: `Unknown job: ${jobName}` }); return;
  }

  if (!isInWorkWindow()) {
    await insertRun(jobName, 'skipped', 0, null, null);
    res.json({ status: 'skipped', reason: 'outside work window' }); return;
  }

  const locked = await acquireLock(jobName);
  if (!locked) {
    res.json({ status: 'already_running' }); return;
  }

  // Respond immediately, then execute
  res.status(202).json({ status: 'accepted', job: jobName });
  executeJob(jobName, handler); // fire-and-forget
}

app.get('/run/:job',  handleRun);
app.post('/run/:job', handleRun);

// ── Lifecycle-plan runner (separate from JOBS map — uses runId) ──────────────

async function executeLifecyclePlan(): Promise<void> {
  const started = Date.now();
  let runId     = 0;
  try {
    runId = await startRun('lifecycle-plan');
    const stats = await runLifecyclePlan(runId);
    await finishRun(runId, 'ok', Date.now() - started, stats as Record<string, unknown>, null);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[lifecycle-plan] FATAL: ${msg}`);
    if (runId) await finishRun(runId, 'error', Date.now() - started, null, msg);
  } finally {
    await releaseLock('lifecycle-plan');
  }
}

// ── Job runner ───────────────────────────────────────────────────────────────

async function executeJob(jobName: string, handler: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  let runId = 0;
  try {
    runId = await startRun(jobName);
    const stats = await handler();
    await finishRun(runId, 'ok', Date.now() - started, stats as Record<string, unknown> | null, null);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[${jobName}] FATAL: ${msg}`);
    if (runId) await finishRun(runId, 'error', Date.now() - started, null, msg);
  } finally {
    await releaseLock(jobName);
  }
}

async function startRun(job: string): Promise<number> {
  const { data, error } = await supabase
    .from('job_runs')
    .insert({ job, started_at: new Date().toISOString(), status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`[startRun] insert failed (job=${job}): ${error.message}`);
  if (!data?.id) throw new Error(`[startRun] no id returned (job=${job})`);
  console.log(`[${job}] run started, runId=${data.id}`);
  return data.id as number;
}

async function finishRun(
  id: number,
  status: 'ok' | 'error',
  durationMs: number,
  stats: Record<string, unknown> | null,
  error: string | null,
): Promise<void> {
  const { error: updateErr } = await supabase.from('job_runs').update({
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    status,
    stats: stats ?? null,
    error: error ?? null,
  }).eq('id', id);
  if (updateErr) console.error(`[finishRun] update failed (id=${id}): ${updateErr.message}`);
  else console.log(`[finishRun] id=${id} status=${status} duration=${durationMs}ms`);
}

async function insertRun(
  job: string,
  status: 'skipped',
  durationMs: number,
  stats: Record<string, unknown> | null,
  error: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('job_runs').insert({
    job, started_at: now, finished_at: now, duration_ms: durationMs,
    status, stats: stats ?? null, error: error ?? null,
  });
}

// ── Shell, window, kviz, scriptolog ──────────────────────────────────────────

// Raise body limit only for InBody CSV endpoints — must come BEFORE global express.json()
app.use('/kviz/api/inbody/csv-preview', express.json({ limit: '2mb' }));
app.use('/kviz/api/inbody/csv-import',  express.json({ limit: '2mb' }));
// Raise limit for materials upload (base64 file content)
app.use('/api/scriptolog/settings/materials', express.json({ limit: '20mb' }));
// Raise limit for TV image uploads (base64, max ~11MB for 8MB binary)
app.use('/kviz/api/tv', express.json({ limit: '16mb' }));
app.use(express.json());
// Serve PWA manifest, icons and other public root assets
app.use(express.static(path.join(__dirname, '../public'), { index: false, maxAge: '1d' }));
mountShellRoutes(app);
mountStaffRoutes(app);
mountScriptologRoutes(app);
mountKvizRoutes(app);
mountWindowRoutes(app);
mountTelegramRoute(app);
app.use(buildCheckinRouter());
app.use(buildPbxRouter());
app.use(buildControl2Router());

// ── Startup: seed default permissions for managers without any ────────────────

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

// Ensure "ОКК" row exists in app_positions so seedPositionPresets can seed its perms
async function seedOkkPosition(): Promise<void> {
  try {
    const { data: pos } = await supabase
      .from('app_positions')
      .select('id')
      .eq('code', 'okk')
      .maybeSingle();
    if (!pos) {
      await supabase.from('app_positions').insert({ code: 'okk', name: 'ОКК', is_active: true });
      console.log('[startup] created app_position: okk');
    }
  } catch (e) {
    console.error('[startup] seedOkkPosition error:', (e as Error).message);
  }
}

// Seed app_position_permissions from POSITION_PRESETS if a position has no rows yet
async function seedPositionPresets(): Promise<void> {
  try {
    const { data: positions } = await supabase
      .from('app_positions')
      .select('id, code')
      .not('code', 'is', null);
    for (const pos of positions || []) {
      const code = pos.code as string;
      if (!POSITION_PRESETS[code]) continue;
      const { count } = await supabase
        .from('app_position_permissions')
        .select('*', { count: 'exact', head: true })
        .eq('position_id', pos.id);
      if (count) continue; // already seeded
      const rows = POSITION_PRESETS[code].map(p => ({ position_id: pos.id, ...p }));
      await supabase.from('app_position_permissions').insert(rows);
      console.log(`[startup] seeded ${rows.length} perms for position ${code}`);
    }
  } catch (e) {
    console.error('[startup] seedPositionPresets error:', (e as Error).message);
  }
}

// Remove legacy tab:* and cashier:* perm keys from app_user_permissions (one-time migration)
async function cleanLegacyPermKeys(): Promise<void> {
  try {
    const { count, error } = await supabase
      .from('app_user_permissions')
      .delete({ count: 'exact' })
      .or('perm_key.like.tab:%,perm_key.like.cashier:%');
    if (error) throw error;
    if (count) {
      console.log(`[startup] removed ${count} legacy perm keys (tab:*/cashier:*)`);
      await supabase.from('crm_audit_log').insert({
        entity: 'app_user_permissions',
        action: 'migrate',
        actor: 'system',
        note: `removed ${count} legacy perm keys (tab:*/cashier:*) — task-56 migration`,
      });
    }
  } catch (e) {
    console.error('[startup] cleanLegacyPermKeys error:', (e as Error).message);
  }
}

// ── Startup: clear stale locks and orphaned running job_runs ──────────────────

async function clearStaleLocks(): Promise<void> {
  try {
    const { count: lockCount } = await supabase
      .from('job_locks')
      .delete({ count: 'exact' })
      .neq('job', '');

    const { count: runCount } = await supabase
      .from('job_runs')
      .update(
        { status: 'error', error: 'прервано перезапуском сервера', finished_at: PROCESS_STARTED_AT },
        { count: 'exact' },
      )
      .eq('status', 'running')
      .lt('started_at', PROCESS_STARTED_AT);

    console.log(`[startup] cleared ${lockCount ?? 0} locks, closed ${runCount ?? 0} stale runs`);
  } catch (e) {
    console.error('[startup] clearStaleLocks error:', (e as Error).message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

clearStaleLocks().catch(() => {/* already logged inside */});
cleanLegacyPermKeys().catch(() => {/* already logged inside */});
seedOkkPosition().then(() => seedPositionPresets()).catch(() => {/* already logged inside */});
seedDefaultVersions().catch((e: Error) => console.error('[startup] seedDefaultVersions:', e.message));
app.listen(env.PORT, () => console.log(`[server] port ${env.PORT}`));
