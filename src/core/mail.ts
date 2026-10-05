import nodemailer from 'nodemailer';
import { env } from '../config';
import { supabase } from '../db/supabase';

const COOLDOWN_MS  = 2 * 3600 * 1000; // 1 alert per error-key per 2 hours
const META_PREFIX  = 'mail_sent_';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

async function canSend(key: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_meta')
    .select('value')
    .eq('key', META_PREFIX + key)
    .maybeSingle();
  if (!data) return true;
  return Date.now() - new Date(data.value as string).getTime() > COOLDOWN_MS;
}

async function markSent(key: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('agent_meta').upsert(
    { key: META_PREFIX + key, value: now, updated_at: now },
    { onConflict: 'key' },
  );
}

async function send(subject: string, body: string): Promise<void> {
  if (!env.ALERT_EMAIL) return;
  try {
    await transporter.sendMail({
      from: env.SMTP_USER,
      to:   env.ALERT_EMAIL,
      subject,
      text: body,
    });
    console.log('[mail] sent:', subject);
  } catch (e) {
    console.error('[mail] sendMail error:', (e as Error).message);
  }
}

export async function alertError(errorKey: string, message: string): Promise<void> {
  if (!(await canSend(errorKey))) return;
  await markSent(errorKey);
  const tag = env.TRIAL_AGENT_DRY_RUN ? '[DRY] ' : '';
  await send(
    `${tag}[SlimWay Agent] Ошибка: ${errorKey}`,
    String(message).substring(0, 2000),
  );
}

export async function alertAuthError(): Promise<void> {
  const key = 'AUTH_ERROR';
  if (!(await canSend(key))) return;
  await markSent(key);
  await send(
    '[SlimWay Agent] Ошибка авторизации Fitbase',
    'Fitbase вернул 401/403. Проверить FITBASE_TOKEN.',
  );
}

export async function sendDailySummary(subject: string, body: string): Promise<void> {
  await send(subject, body);
}
