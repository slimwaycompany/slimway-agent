import { supabase }            from '../db/supabase';
import { isDry, env }          from '../config';
import { sendDailySummary }    from '../core/mail';
import { STAGE_NOSHOW }        from '../config';
import { paginateGet }         from '../http/fitbase';

export const JOB_NAME = 'daily-summary';

// Returns "YYYY-MM-DD" in Almaty time (UTC+5)
function almatyToday(): string {
  const a   = new Date(Date.now() + 5 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${a.getUTCFullYear()}-${pad(a.getUTCMonth() + 1)}-${pad(a.getUTCDate())}`;
}

export async function runDailySummary(): Promise<void> {
  const today      = almatyToday();
  const trialDry   = isDry('trial');
  const budgetDry  = isDry('budget');

  // Day boundaries in UTC (Almaty midnight = UTC+5)
  const dayStart = new Date(`${today}T00:00:00+05:00`).toISOString();
  const dayEnd   = new Date(`${today}T23:59:59+05:00`).toISOString();

  // ── Trial events ──────────────────────────────────────────────────────────────
  const { data: trialEvents } = await supabase
    .from('agent_events')
    .select('*')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .eq('job', 'trial')
    .eq('dry', trialDry);

  const { data: runs } = await supabase
    .from('job_runs')
    .select('duration_ms, status')
    .eq('job', 'trial')
    .gte('started_at', dayStart)
    .lte('started_at', dayEnd);

  const moves: Record<string, number> = {
    '3→52': 0, '3→50': 0, '3→55': 0, '52→50': 0, '52→55': 0,
  };
  const taskCounts: Record<string, number> = {};
  let trialErrors = 0;
  const noshowNames: string[] = [];
  const noClientMap: Record<number, { name: string; stage: string }> = {};

  for (const ev of (trialEvents || [])) {
    if (ev.type === 'lead_moved' && ev.meta) {
      const from = ev.meta.from as number;
      const to   = ev.meta.to   as number;
      const key  = `${from}→${to}`;
      if (key in moves) moves[key]++;
      if (to === STAGE_NOSHOW && ev.short_name) noshowNames.push(ev.short_name as string);
    }
    if (ev.type === 'task_created' && ev.meta?.task_type) {
      const tt = ev.meta.task_type as string;
      taskCounts[tt] = (taskCounts[tt] || 0) + 1;
    }
    if (ev.type === 'error') trialErrors++;
    if (ev.type === 'skipped_no_client' && ev.lead_id) {
      noClientMap[ev.lead_id as number] = {
        name:  ev.short_name as string || '',
        stage: String(ev.meta?.stage  ?? ''),
      };
    }
  }

  // ── Budget events ─────────────────────────────────────────────────────────────
  const { data: budgetEvents } = await supabase
    .from('agent_events')
    .select('*')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .eq('job', 'budget')
    .eq('dry', budgetDry);

  let budgetUpdated = 0;
  let budgetErrors  = 0;
  for (const ev of (budgetEvents || [])) {
    if (ev.type === 'budget_updated') budgetUpdated++;
    if (ev.type === 'error')          budgetErrors++;
  }

  // ── TikTok block — leads with tiktok tag created today ────────────────────────
  let tiktokNew = 0;
  try {
    const tiktokLeads = await paginateGet('/lead', { tag: 'tiktok', per_page: 100 });
    tiktokNew = tiktokLeads.filter(l => {
      const createdAt = String(l.created_at || '');
      return createdAt.startsWith(today);
    }).length;
  } catch { /* non-fatal — skip block if Fitbase unreachable */ }

  // ── Compose email ─────────────────────────────────────────────────────────────
  const totalDurationMs = (runs || []).reduce((s, r) => s + (r.duration_ms || 0), 0);
  const totalRuns       = (runs || []).length;
  const ddmmyyyy        = today.split('-').reverse().join('.');
  const anyDry          = trialDry || budgetDry;

  const subject = `${anyDry ? '[DRY] ' : ''}[SlimWay] Сводка агента ${ddmmyyyy}`;
  let body = `Сводка за ${ddmmyyyy}\n\n`;

  body += `== Переходы (trial${trialDry ? ', DRY' : ''}) ==\n`;
  for (const [k, v] of Object.entries(moves)) body += `${k}: ${v}\n`;

  body += `\n== Задачи (trial) ==\n`;
  const tkeys = Object.keys(taskCounts);
  if (tkeys.length === 0) body += `Нет\n`;
  else for (const k of tkeys) body += `${k}: ${taskCounts[k]}\n`;

  body += `\n== Ошибки trial: ${trialErrors} ==\n`;

  if (noshowNames.length > 0) {
    body += `\n== Не пришли на пробное ==\n${noshowNames.join('\n')}\n`;
  }

  body += `\n== Запуски trial: ${totalRuns}, суммарно ${Math.round(totalDurationMs / 1000)} сек ==\n`;

  const noClientArr = Object.entries(noClientMap);
  if (noClientArr.length > 0) {
    body += `\n== Карточки без клиента — создайте КК ==\n`;
    for (const [leadId, l] of noClientArr) {
      body += `${l.name || '(без имени)'} | этап ${l.stage} | id ${leadId}\n`;
    }
  }

  body += `\n== Бюджет (${budgetDry ? 'DRY' : 'live'}) ==\n`;
  body += `Обновлено лидов: ${budgetUpdated}\n`;
  body += `Ошибок: ${budgetErrors}\n`;

  body += `\n== TikTok — новые заявки сегодня: ${tiktokNew} ==\n`;
  body += `(запись за ${ddmmyyyy} по Алма-Ате)\n`;

  await sendDailySummary(subject, body);
  console.log('[daily-summary] sent:', subject);
}
