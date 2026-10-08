import { supabase }    from '../db/supabase';
import { alertError }  from './mail';

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

// Replace lone (unpaired) surrogates with U+FFFD so the string is valid JSON.
// Works without ES2024 toWellFormed() — handles Node 20+ and older alike.
function wellFormed(s: string): string {
  return s.replace(/[\uD800-\uDFFF]/g, (ch, offset: number, str: string) => {
    const code = ch.charCodeAt(0);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(offset + 1);
      return (next >= 0xDC00 && next <= 0xDFFF) ? ch : '�';
    }
    const prev = str.charCodeAt(offset - 1);
    return (prev >= 0xD800 && prev <= 0xDBFF) ? ch : '�';
  });
}

// Deep-sanitize a meta object: replace lone surrogates in all string values.
function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> | null {
  try {
    return JSON.parse(JSON.stringify(meta, (_k, v) =>
      typeof v === 'string' ? wellFormed(v) : v,
    )) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function logEvent(payload: EventPayload): Promise<void> {
  const row = {
    job:        payload.job,
    type:       payload.type,
    lead_id:    payload.lead_id                    ?? null,
    short_name: payload.short_name != null ? wellFormed(payload.short_name) : null,
    text:       wellFormed(payload.text),
    meta:       payload.meta != null ? sanitizeMeta(payload.meta) : null,
    dry:        payload.dry,
  };

  const { error } = await supabase.from('agent_events').insert(row);
  if (!error) return;

  console.error('[events] insert failed:', error.message, '| type:', payload.type, '| text:', payload.text.substring(0, 80));

  // Retry without large arrays that may contain bad strings
  if (row.meta) {
    const slim = Object.fromEntries(
      Object.entries(row.meta).filter(([k]) => k !== 'changes' && k !== 'errors' && k !== 'rows'),
    );
    const { error: e2 } = await supabase.from('agent_events').insert({ ...row, meta: slim });
    if (!e2) return;
    console.error('[events] retry without arrays also failed:', e2.message);
  }

  try {
    await alertError('events_insert', `type=${payload.type} ${error.message.substring(0, 100)}`);
  } catch { /* silent */ }
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
    String(fp.stage_from      ?? ''),
    String(fp.registration_id ?? ''),
    String(fp.event_start     ?? ''),
    String(fp.reg_status      ?? ''),
  ].join('|');
}
