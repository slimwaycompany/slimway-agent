import 'dotenv/config';
import express from 'express';
import { env }           from './config';
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
import { mountWindowRoutes }                          from './http/window';

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

// lifecycle-plan: fire-and-forget, 30-min lock, manages its own job_runs entry via runId
async function handleLifecyclePlan(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
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

// ── Window page ───────────────────────────────────────────────────────────────

mountWindowRoutes(app);

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
app.listen(env.PORT, () => console.log(`[server] port ${env.PORT}`));
