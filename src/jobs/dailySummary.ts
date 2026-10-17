import { supabase }            from '../db/supabase';
import { isDry, env, STAGE_NOSHOW } from '../config';
import { sendDailySummary }    from '../core/mail';
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

  // ── Inactive clients blocks ───────────────────────────────────────────────────
  try {
    const inactiveDry = isDry('inactive');

    // Stage-14 open episodes
    const { data: ep14 } = await supabase
      .from('inactive_episodes')
      .select('*')
      .is('closed_at', null)
      .not('stage14_at', 'is', null);

    if (ep14 && ep14.length > 0) {
      body += `\n== Не ходят 14+ дней (эскалация) ==\n`;
      for (const ep of ep14 as Record<string, unknown>[]) {
        body += `  client_id=${ep.client_id} | stage7=${ep.stage7_at ? String(ep.stage7_at).slice(0,10) : '—'} | stage10=${ep.stage10_at ? String(ep.stage10_at).slice(0,10) : '—'}\n`;
      }
    }

    // Today's inactive events
    const { data: inactiveEvents } = await supabase
      .from('agent_events')
      .select('*')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .eq('job', 'inactive')
      .eq('dry', inactiveDry);

    let s7 = 0, s10 = 0, s14 = 0;
    let returned = 0;
    for (const ev of (inactiveEvents ?? [])) {
      const meta = ev.meta as Record<string, unknown> | null;
      if (ev.type === 'task_created') {
        const stage = Number(meta?.stage ?? 0);
        if (stage === 7)  s7++;
        if (stage === 10) s10++;
        if (stage === 14) s14++;
      }
    }

    // Count returned (episode closed with Пришёл/Записался today)
    const { count: returnCount } = await supabase
      .from('inactive_episodes')
      .select('id', { count: 'exact', head: true })
      .gte('closed_at', dayStart)
      .lte('closed_at', dayEnd)
      .in('close_reason', ['Пришёл на занятие', 'Записался']);

    returned = returnCount ?? 0;

    body += `\n== Неактивные клиенты (inactive${inactiveDry ? ', DRY' : ''}) ==\n`;
    body += `Ступень 7 (${env.INACTIVE_DAYS_1}+ дн.): ${s7}\n`;
    body += `Ступень 10 (${env.INACTIVE_DAYS_2}+ дн.): ${s10}\n`;
    body += `Ступень 14 (${env.INACTIVE_DAYS_OWNER}+ дн.): ${s14}\n`;
    body += `Вернулись сегодня: ${returned}\n`;
  } catch (e) {
    body += `\n== Неактивные клиенты: ошибка — ${(e as Error).message} ==\n`;
  }

  // ── Manager tasks block ───────────────────────────────────────────────────────
  try {
    const { data: managerAll } = await supabase
      .from('manager_task_templates')
      .select('id, title, slot_time')
      .eq('is_active', true)
      .order('sort');

    if (managerAll && managerAll.length > 0) {
      const { data: managerDone } = await supabase
        .from('manager_task_done')
        .select('template_id, done_by_name, done_at')
        .eq('task_date', today);

      const doneMap = new Map(
        (managerDone ?? []).map((d: Record<string, unknown>) => [String(d.template_id), d]),
      );

      body += `\n== Задачи смены (${doneMap.size} из ${managerAll.length}) ==\n`;
      for (const t of managerAll as Record<string, unknown>[]) {
        const d = doneMap.get(String(t.id));
        const slotStr = String(t.slot_time).slice(0, 5);
        if (d) {
          const timeStr = new Date(d.done_at as string).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
          body += `  ✓ ${t.title} (${slotStr}) — ${d.done_by_name}, ${timeStr}\n`;
        } else {
          body += `  ✗ ${t.title} (${slotStr})\n`;
        }
      }
    }
  } catch (e) {
    body += `\n== Задачи смены: ошибка — ${(e as Error).message} ==\n`;
  }

  await sendDailySummary(subject, body);
  console.log('[daily-summary] sent:', subject);
}
