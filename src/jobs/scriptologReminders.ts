import { supabase } from '../db/supabase';

export const JOB_NAME = 'scriptolog-reminders';

function almatyHour(): number {
  return new Date(Date.now() + 5 * 3600_000).getUTCHours();
}

export async function runScriptologReminders(): Promise<Record<string, unknown>> {
  const DRY = (process.env.SCRIPTOLOG_REMINDERS_DRY_RUN ?? 'true') === 'true';

  const h = almatyHour();
  if (h < 9 || h >= 22) return { status: 'skipped', reason: 'outside 09-22 Almaty' };

  const now = new Date().toISOString();
  const { data: reminders, error } = await supabase
    .from('script_reminders')
    .select('id, kind, text, text_kk, scheduled_at, client_id, script_clients(id, name, vars)')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .limit(50);

  if (error) throw new Error(`script_reminders: ${error.message}`);
  if (!reminders?.length) return { processed: 0, dry: DRY };

  let processed = 0;
  for (const rem of reminders as Record<string, unknown>[]) {
    const client = rem.script_clients as Record<string, unknown> | null;
    const vars = (client?.vars as Record<string, string>) ?? {};
    const text = String(rem.text ?? '').replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
    const clientName = String(client?.name ?? '?');

    if (DRY) {
      console.log(`[${JOB_NAME}] DRY: ${rem.kind} → ${clientName}: ${text.slice(0, 100)}`);
    } else {
      const { error: updErr } = await supabase
        .from('script_reminders')
        .update({ status: 'sent', sent_at: now })
        .eq('id', rem.id);
      if (updErr) {
        console.error(`[${JOB_NAME}] update error (id=${rem.id}): ${updErr.message}`);
      } else {
        console.log(`[${JOB_NAME}] sent: ${rem.kind} → ${clientName}`);
        processed++;
      }
    }
  }

  return { processed, total: reminders.length, dry: DRY };
}
