/**
 * Версии линеек ролей (control_line_versions).
 * Версия выбирается по max(effective_from) ≤ date для данной роли.
 */
import { supabase } from '../db/supabase';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

export type Role = 'call_center' | 'consultant';
export type Formula = 'forgive_then_all' | 'per_point';
export type FinalizeWhen = 'next_morning' | 'after_review';

export interface CheckConfig {
  key: string;    // unique within point
  type: string;   // catalog check key
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface PointConfig {
  key: string;    // unique within version
  title: string;
  description: string;
  enabled: boolean;
  order: number;
  checks: CheckConfig[];
}

export interface LineConfig {
  fixed_pay: number;
  point_price: number;
  max_variable: number;
  formula: Formula;
  forgive_count: number;
  finalize: FinalizeWhen;
  review_auto_days: number;
  points: PointConfig[];
}

export interface LineVersion {
  id: string;
  role: Role;
  effective_from: string;
  config: LineConfig;
  created_by: string | null;
  created_at: string;
}

// ── Default configs ───────────────────────────────────────────────────────────

const DEFAULT_CC_CONFIG: LineConfig = {
  fixed_pay: 10000,
  point_price: 1000,
  max_variable: 5000,
  formula: 'forgive_then_all',
  forgive_count: 1,
  finalize: 'next_morning',
  review_auto_days: 7,
  points: [
    {
      key: 'cc_speed',
      title: 'Скорость ответа',
      description: 'Первый контакт с заявкой в отведённое время.',
      enabled: true, order: 1,
      checks: [{ key: 'c1', type: 'cc_speed_queue', params: { queue_minutes: 5, fixation_seconds: 30 }, enabled: true }],
    },
    {
      key: 'cc_bant',
      title: 'B.A.N.T.',
      description: 'Потребность (N) и сроки (T) зафиксированы в первом разговоре.',
      enabled: true, order: 2,
      checks: [{ key: 'c1', type: 'cc_bant_required', params: { min_call_seconds: 60, fixation_seconds: 30 }, enabled: true }],
    },
    {
      key: 'cc_booking',
      title: 'Запись сегодня-завтра',
      description: 'Запись на пробное только на ближайшие 2 дня.',
      enabled: true, order: 3,
      checks: [{ key: 'c1', type: 'cc_booking_window', params: {}, enabled: true }],
    },
    {
      key: 'cc_funnel',
      title: 'Работа с воронками',
      description: 'Исходы и задачи по всем заявкам закрыты корректно.',
      enabled: true, order: 4,
      checks: [
        { key: 'c1', type: 'cc_funnel_outcome', params: {}, enabled: true },
        { key: 'c2', type: 'cc_funnel_tasks', params: {}, enabled: true },
      ],
    },
    {
      key: 'cc_followup',
      title: 'Follow-up',
      description: 'Материалы, кружок и живое сообщение отправлены в срок.',
      enabled: true, order: 5,
      checks: [
        { key: 'c1', type: 'cc_followup_materials', params: { deadline_minutes: 60 }, enabled: true },
        { key: 'c2', type: 'cc_followup_circle', params: {}, enabled: true },
        { key: 'c3', type: 'cc_followup_live_message', params: {}, enabled: true },
      ],
    },
    {
      key: 'cc_lateness',
      title: 'Опоздание',
      description: 'Приход за 15 мин до начала смены, уход не раньше конца.',
      enabled: true, order: 6,
      checks: [
        { key: 'c1', type: 'lateness_arrival', params: { arrive_before_minutes: 15 }, enabled: true },
        { key: 'c2', type: 'lateness_leave', params: {}, enabled: true },
      ],
    },
  ],
};

const DEFAULT_CONSULTANT_CONFIG: LineConfig = {
  fixed_pay: 10000,
  point_price: 1000,
  max_variable: 5000,
  formula: 'per_point',
  forgive_count: 0,
  finalize: 'after_review',
  review_auto_days: 7,
  points: [
    {
      key: 'cons_measures',
      title: 'Замеры',
      description: 'InBody и замеры тела по всем нужным клиентам в срок.',
      enabled: true, order: 1,
      checks: [
        { key: 'c1', type: 'measure_inbody_trial', params: { deadline_minutes: 30 }, enabled: true },
        { key: 'c2', type: 'measure_first_visit', params: { deadline_minutes: 30 }, enabled: true },
        { key: 'c3', type: 'measure_last_visit', params: { deadline_minutes: 30 }, enabled: true },
        { key: 'c4', type: 'measure_inbody_weekly', params: { days: 7, deadline_minutes: 30 }, enabled: true },
        { key: 'c5', type: 'measure_body_monthly', params: { days: 30, min_abon_days: 31, deadline_minutes: 30 }, enabled: true },
      ],
    },
    {
      key: 'cons_docs',
      title: 'Анкета и рег. форма',
      description: 'Анкета на пробном и рег. форма при продаже получены.',
      enabled: true, order: 2,
      checks: [
        { key: 'c1', type: 'manual', params: { target_type: 'trial', label: 'Анкета получена?' }, enabled: true },
        { key: 'c2', type: 'manual', params: { target_type: 'sale', label: 'Рег. форма получена?' }, enabled: true },
      ],
    },
    {
      key: 'cons_schedule',
      title: 'Расписание',
      description: 'Статусы проставлены, аппарат и фазы верны, нет двойных записей.',
      enabled: true, order: 3,
      checks: [
        { key: 'c1', type: 'schedule_unmarked', params: { mark_minutes: 30 }, enabled: true },
        { key: 'c2', type: 'schedule_wrong_abonement', params: {}, enabled: true },
        { key: 'c3', type: 'schedule_double_booking', params: {}, enabled: true },
        { key: 'c4', type: 'manual', params: { target_type: 'session', label: 'Аппарат, время и фазы верны?' }, enabled: true },
      ],
    },
    {
      key: 'cons_uniform',
      title: 'Форма',
      description: 'На смене в форменной одежде студии.',
      enabled: true, order: 4,
      checks: [
        { key: 'c1', type: 'manual', params: { target_type: 'checkin_photo', label: 'Форма есть?' }, enabled: true },
      ],
    },
    {
      key: 'cons_lateness',
      title: 'Опоздание',
      description: 'Приход за 15 мин до начала смены, уход не раньше конца.',
      enabled: true, order: 5,
      checks: [
        { key: 'c1', type: 'lateness_arrival', params: { arrive_before_minutes: 15 }, enabled: true },
        { key: 'c2', type: 'lateness_leave', params: {}, enabled: true },
      ],
    },
  ],
};

// ── API ───────────────────────────────────────────────────────────────────────

export async function getLineVersion(role: Role, date: string): Promise<LineVersion | null> {
  const { data, error } = await supabase
    .from('control_line_versions')
    .select('*')
    .eq('branch_id', BRANCH_ID)
    .eq('role', role)
    .lte('effective_from', date)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[lineVersions] getLineVersion error:', error.message); return null; }
  return data as LineVersion | null;
}

export async function getAllVersions(role: Role): Promise<LineVersion[]> {
  const { data, error } = await supabase
    .from('control_line_versions')
    .select('*')
    .eq('branch_id', BRANCH_ID)
    .eq('role', role)
    .order('effective_from', { ascending: false });
  if (error) return [];
  return (data ?? []) as LineVersion[];
}

export async function createVersion(
  role: Role, effective_from: string, config: LineConfig, created_by: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  // Check if version on this date already exists
  const { data: existing } = await supabase
    .from('control_line_versions')
    .select('id')
    .eq('branch_id', BRANCH_ID)
    .eq('role', role)
    .eq('effective_from', effective_from)
    .maybeSingle();

  if (existing) {
    // Replace
    const { error } = await supabase
      .from('control_line_versions')
      .update({ config, created_by, created_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: String(existing.id) };
  }

  const { data, error } = await supabase
    .from('control_line_versions')
    .insert({ branch_id: BRANCH_ID, role, effective_from, config, created_by })
    .select('id').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: String(data.id) };
}

// Seed default versions if none exist for a role
export async function seedDefaultVersions(): Promise<void> {
  for (const role of ['call_center', 'consultant'] as Role[]) {
    const { data } = await supabase
      .from('control_line_versions')
      .select('id')
      .eq('branch_id', BRANCH_ID)
      .eq('role', role)
      .limit(1)
      .maybeSingle();
    if (!data) {
      const config = role === 'call_center' ? DEFAULT_CC_CONFIG : DEFAULT_CONSULTANT_CONFIG;
      const { error } = await supabase.from('control_line_versions').insert({
        branch_id: BRANCH_ID,
        role,
        effective_from: '2026-11-18',
        config,
        created_by: 'system',
      });
      if (error) console.error(`[lineVersions] seed ${role} error:`, error.message);
      else console.log(`[lineVersions] seeded default version for ${role}`);
    }
  }
}

// Calculate variable pay given violations count and config
export function calcVariablePay(config: LineConfig, violatedCount: number): number {
  const { max_variable, point_price, formula, forgive_count } = config;
  if (formula === 'forgive_then_all') {
    if (violatedCount <= forgive_count) return max_variable;
    return Math.max(0, max_variable - violatedCount * point_price);
  }
  // per_point
  return Math.max(0, max_variable - violatedCount * point_price);
}
