import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  FITBASE_TOKEN: z.string().min(1),
  FITBASE_CLUB: z.string().default('slimway'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  AGENT_USER_ID: z.coerce.number().default(40),
  TASK_RESPONSIBLE_IDS: z.string().default('33,39,35'),
  // "true" or any non-"false" string → dry run on
  TRIAL_AGENT_DRY_RUN: z.string().transform(v => v !== 'false').default('true'),
  BUDGET_DRY_RUN:      z.string().transform(v => v !== 'false').default('true'),
  BUDGET_DEFAULT:      z.coerce.number().default(69000),
  LTV_SOURCE:          z.enum(['purchase_amount', 'till_steps']).default('purchase_amount'),
  ALERT_EMAIL: z.string().default('sergey.revnivcev@gmail.com'),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[Config] Missing or invalid env vars:');
  for (const [field, err] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${(err as string[]).join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;

type Module = 'trial' | 'budget';
const DRY_FLAGS: Record<Module, boolean> = {
  trial:  env.TRIAL_AGENT_DRY_RUN,
  budget: env.BUDGET_DRY_RUN,
};
export function isDry(module: Module): boolean {
  return DRY_FLAGS[module];
}

// ── Funnel & stage constants (from Apps Script Config.js defaults) ──────────
export const AGENT_FUNNEL_ID = 1;
export const STAGE_BOOKED    = 3;   // Записался на пробную
export const STAGE_CONFIRMED = 52;  // Визит подтвержден
export const STAGE_DECISION  = 50;  // Принимает решение (Дожим)
export const STAGE_NOSHOW    = 55;  // Не пришел на пробную

export const TRIAL_TRAINING_ID  = 16; // event.training.id для пробного занятия
export const TRIAL_CHECK_HOURS  = 2;  // проверяем визит через N часов от начала
export const AGENT_TASK_DUE_HOURS = 2;

export const TASK_STATUS_OPEN      = 'O';
export const TASK_CATEGORY_CALL_ID = 2; // Звонок
export const TASK_CATEGORY_TASK_ID = 5; // Задание

// Registration statuses (string values from Fitbase)
export const REG_STATUS_BOOKED    = ['0'];
export const REG_STATUS_CONFIRMED = ['1'];
export const REG_STATUS_VISITED   = ['3'];
export const REG_STATUS_CANCELLED = ['2'];
export const REG_STATUS_NOSHOW    = ['4'];

export function getResponsibleIds(): string[] {
  return env.TASK_RESPONSIBLE_IDS.split(',').map(s => s.trim()).filter(Boolean);
}
