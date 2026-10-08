import { supabase } from '../db/supabase';

export type EventType =
  | 'lead_moved'
  | 'task_created'
  | 'comment_added'
  | 'skipped_no_client'
  | 'skipped_duplicate_task'
  | 'error'
  | 'run_started'
  | 'run_finished'
  | 'probe'
  | 'budget_updated';

export interface EventPayload {
  job: string;
  type: EventType;
  lead_id?: number;
  short_name?: string;
  text: string;
  meta?: Record<string, unknown>;
  dry: boolean;
}

export async function logEvent(payload: EventPayload): Promise<void> {
  const { error } = await supabase.from('agent_events').insert({
    job:        payload.job,
    type:       payload.type,
    lead_id:    payload.lead_id    ?? null,
    short_name: payload.short_name ?? null,
    text:       payload.text,
    meta:       payload.meta       ?? null,
    dry:        payload.dry,
  });
  if (error) console.error('[events] insert failed:', error.message);
}

// Fingerprint used to suppress duplicate log entries (mirrors Apps Script logIfChanged logic)
export function computeFingerprint(fp: {
  action: string;
  stage_from?: number;
  registration_id?: number;
  event_start?: string;
  reg_status?: string;
}): string {
  return [
    fp.action,
    String(fp.stage_from    ?? ''),
    String(fp.registration_id ?? ''),
    String(fp.event_start   ?? ''),
    String(fp.reg_status    ?? ''),
  ].join('|');
}
