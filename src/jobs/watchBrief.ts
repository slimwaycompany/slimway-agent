import { supabase }     from '../db/supabase';
import { paginateGet }  from '../http/fitbase';
import { TRIAL_TRAINING_ID } from '../config';

export const JOB_NAME = 'watch-brief';

const ALMATY_MS = 5 * 3600 * 1000;

function almatyDate(ms: number): string {
  return new Date(ms + ALMATY_MS).toISOString().slice(0, 10);
}

function yestEndAlmaty(): string {
  // End-of-work yesterday (22:30 approximated as 22:00 UTC+5 → 17:00 UTC)
  // Use midnight Almaty of today as cutoff — catches leads from 21:00–midnight
  const todayStart = new Date(new Date(Date.now() + ALMATY_MS).toISOString().slice(0, 10) + 'T00:00:00+05:00');
  return new Date(todayStart.getTime() - 12 * 3600_000).toISOString();
}

export async function runWatchBrief(): Promise<Record<string, unknown>> {
  const today    = almatyDate(Date.now());
  const briefKey = `BRIEF:date:${today}`;

  // Skip if today's brief already exists
  const { data: existing } = await supabase
    .from('watch_alerts')
    .select('id')
    .eq('alert_key', briefKey)
    .maybeSingle();
  if (existing) {
    console.log('[watch-brief] already created for', today);
    return { status: 'already_created' };
  }

  // Count open alerts by rule
  const { data: openAlerts } = await supabase
    .from('watch_alerts')
    .select('rule')
    .is('resolved_at', null)
    .neq('rule', 'BRIEF');

  const counts: Record<string, number> = {};
  for (const a of (openAlerts ?? [])) {
    const r = a.rule as string;
    counts[r] = (counts[r] ?? 0) + 1;
  }

  // Today's trial registrations
  const todayRegs   = await paginateGet('/schedule-registration', { date: today, page_size: 100 });
  const trials      = todayRegs.filter(r => {
    const ev       = r.event as Record<string, unknown> | undefined;
    const training = ev?.training as Record<string, unknown> | undefined;
    return Number(training?.id ?? 0) === TRIAL_TRAINING_ID;
  });
  const unconfirmed = trials.filter(r => String(r.status ?? '') === '0');

  // New leads since last 12 hours (overnight): count NEW_LEAD alerts created after midnight Almaty
  const since = yestEndAlmaty();
  const { count: newLeadsCount } = await supabase
    .from('watch_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('rule', 'NEW_LEAD')
    .gte('created_at', since);

  const lines = [
    `Пробных сегодня: ${trials.length}`,
    `Не подтверждено: ${unconfirmed.length}`,
    `Карточек без задачи: ${counts['NO_TASK'] ?? 0}`,
    `Просроченных задач: ${counts['TASK_OVERDUE'] ?? 0}`,
    `Свободных карточек: ${counts['CARD_FREE'] ?? 0}`,
    `Новых лидов за ночь: ${newLeadsCount ?? 0}`,
  ];

  const { error } = await supabase.from('watch_alerts').upsert({
    alert_key:       briefKey,
    rule:            'BRIEF',
    level:           'info',
    lead_id:         null,
    client_id:       null,
    registration_id: null,
    manager_name:    null,
    short_name:      null,
    title:           'Утренний брифинг',
    body:            lines.join('\n'),
    action_hint:     null,
    link:            null,
    meta:            { date: today, trials: trials.length, unconfirmed: unconfirmed.length },
  }, { onConflict: 'alert_key', ignoreDuplicates: true });

  if (error) {
    console.error('[watch-brief] upsert error:', error.message);
    throw new Error(error.message);
  }

  console.log('[watch-brief] created for', today, '—', lines.join('; '));
  return {
    status:      'created',
    date:        today,
    trials:      trials.length,
    unconfirmed: unconfirmed.length,
    no_task:     counts['NO_TASK'] ?? 0,
  };
}
