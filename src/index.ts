import 'dotenv/config';
import express from 'express';
import { env }           from './config';
import { isInWorkWindow } from './core/window';
import { acquireLock, releaseLock } from './core/lock';
import { supabase }      from './db/supabase';
import { runTrial,        JOB_NAME as TRIAL_JOB }   from './jobs/trial';
import { runDailySummary, JOB_NAME as SUMMARY_JOB }  from './jobs/dailySummary';
import { runBudget }                                  from './jobs/budget';
import { runProbeLtv }                                from './jobs/probeLtv';

const app = express();

const JOBS: Record<string, () => Promise<unknown>> = {
  [TRIAL_JOB]:   runTrial,
  [SUMMARY_JOB]: runDailySummary,
  budget:        runBudget,
};

// Probe jobs bypass work-window check and lock
const PROBE_JOBS: Record<string, (params: Record<string, string>) => Promise<unknown>> = {
  'probe-ltv': (q) => runProbeLtv({
    funnelId: q.funnel_id ? Number(q.funnel_id) : undefined,
    limit:    q.limit     ? Number(q.limit)     : undefined,
  }),
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

async function handleProbe(req: express.Request, res: express.Response): Promise<void> {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  const jobName = req.params.job;
  const handler = PROBE_JOBS[jobName];
  if (!handler) {
    res.status(404).json({ error: `Unknown probe: ${jobName}` }); return;
  }
  res.status(202).json({ status: 'accepted', job: jobName });
  try {
    await handler(req.query as Record<string, string>);
  } catch (e) {
    console.error(`[probe/${jobName}] FATAL: ${(e as Error).message}`);
  }
}

app.get('/probe/:job',  handleProbe);
app.post('/probe/:job', handleProbe);

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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = env.PORT;
app.listen(PORT, () => console.log(`[server] port ${PORT}`));
