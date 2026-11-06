import { supabase } from '../db/supabase';

const BASE = 'https://chat_api.easychat.ru/v1';
const SLEEP_MS = 300;

export const DRY = () => (process.env.EASYCHAT_DRY_RUN ?? 'true') === 'true';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export interface EasyDialogue {
  dialogue_id: number;
  name: string;
  crm_client_id: number | null;
  unread_count: number;
  last_message: { message: string; operator_id: number | null; created_at: string } | null;
}

export interface EasyDelayed {
  delayed_message_id: number;
  dialogue_id: number;
  message_text: string;
  send_at: number;
  status: number;
}

// ── Token ──────────────────────────────────────────────────────────────────

export async function getEasyChatToken(): Promise<string | null> {
  const { data } = await supabase.from('script_settings').select('value').eq('key', 'easychat_token').maybeSingle();
  return (data?.value as string | null) ?? null;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function req(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  await sleep(SLEEP_MS);
  const headers: Record<string, string> = { Authorization: token };
  const opts: RequestInit = { method, headers };
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const resp = await fetch(BASE + path, opts);
  if (resp.status === 401 || resp.status === 403) throw new Error(`[EasyChat] auth error ${resp.status} on ${path}`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`[EasyChat] ${method} ${path} → ${resp.status} ${text.slice(0, 200)}`);
  }
  return resp.json().catch(() => ({}));
}

// ── Dialogues ──────────────────────────────────────────────────────────────

export async function listDialogues(token: string, page = 1, pageSize = 50): Promise<EasyDialogue[]> {
  const r = await req(token, 'GET', `/dialogue?page=${page}&pageSize=${pageSize}`) as Record<string, unknown>;
  return ((r.data ?? r.items ?? []) as EasyDialogue[]);
}

// Finds dialogue by Fitbase client_id. Paginates up to 10 pages.
export async function findDialogueByFitbaseClient(token: string, fitbaseClientId: number): Promise<EasyDialogue | null> {
  for (let page = 1; page <= 10; page++) {
    const rows = await listDialogues(token, page, 50);
    if (!rows.length) break;
    const found = rows.find(d => d.crm_client_id === fitbaseClientId);
    if (found) return found;
    if (rows.length < 50) break;
  }
  return null;
}

// ── Delayed messages ───────────────────────────────────────────────────────

export async function scheduleMessage(
  token: string,
  dialogueId: number,
  text: string,
  sendAt: number,   // unix seconds
  fileUrl?: string,
): Promise<number> {
  if (DRY()) {
    const dt = new Date(sendAt * 1000).toISOString();
    console.log(`[EasyChat DRY] scheduleMessage dialogue=${dialogueId} at=${dt}: ${text.slice(0, 80)}`);
    return 0;
  }
  const body: Record<string, unknown> = { message_text: text, send_at: sendAt, dialogue_id: dialogueId };
  if (fileUrl) body.file_url = fileUrl;
  const r = await req(token, 'POST', '/delayed_message', body) as Record<string, unknown>;
  const data = (r.data ?? {}) as Record<string, unknown>;
  return Number(data.delayed_message_id ?? 0);
}

export async function listDelayed(token: string, dialogueId: number): Promise<EasyDelayed[]> {
  const r = await req(token, 'GET', `/delayed_message?dialogue_id=${dialogueId}`) as Record<string, unknown>;
  return ((r.data ?? []) as EasyDelayed[]);
}

export async function deleteDelayed(token: string, delayedId: number): Promise<void> {
  if (DRY()) { console.log(`[EasyChat DRY] deleteDelayed id=${delayedId}`); return; }
  await req(token, 'DELETE', `/delayed_message/${delayedId}`);
}

// ── Comments ───────────────────────────────────────────────────────────────

export async function addComment(token: string, dialogueId: number, text: string, isPinned = false): Promise<number> {
  if (DRY()) { console.log(`[EasyChat DRY] addComment dialogue=${dialogueId}: ${text.slice(0, 80)}`); return 0; }
  const r = await req(token, 'POST', `/dialogue/${dialogueId}/comment`, { text, is_pinned: isPinned ? 1 : 0 }) as Record<string, unknown>;
  const data = (r.data ?? {}) as Record<string, unknown>;
  return Number(data.dialogue_comment_id ?? 0);
}

export async function deleteComment(token: string, commentId: number): Promise<void> {
  if (DRY()) { console.log(`[EasyChat DRY] deleteComment id=${commentId}`); return; }
  await req(token, 'DELETE', `/comment/${commentId}`);
}

// List comments for a dialogue
export async function listComments(token: string, dialogueId: number): Promise<Record<string, unknown>[]> {
  const r = await req(token, 'GET', `/dialogue/${dialogueId}/comment?page=1&pageSize=20`) as Record<string, unknown>;
  return ((r.data ?? []) as Record<string, unknown>[]);
}

// ── File upload ────────────────────────────────────────────────────────────

export async function uploadFile(
  token: string,
  dialogueId: number,
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
): Promise<{ file_id: number; file_url: string }> {
  if (DRY()) {
    console.log(`[EasyChat DRY] uploadFile dialogue=${dialogueId} filename=${filename}`);
    return { file_id: 0, file_url: '' };
  }
  const form = new FormData();
  form.append('dialogue_id', String(dialogueId));
  form.append('file', new Blob([fileBuffer.buffer as ArrayBuffer], { type: contentType }), filename);
  const r = await req(token, 'POST', '/file', form) as Record<string, unknown>;
  const data = (r.data ?? {}) as Record<string, unknown>;
  return { file_id: Number(data.file_id ?? 0), file_url: String(data.file_url ?? '') };
}
