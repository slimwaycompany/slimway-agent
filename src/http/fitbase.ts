import {
  env,
  AGENT_FUNNEL_ID,
  TASK_STATUS_OPEN,
  TASK_CATEGORY_CALL_ID,
  TASK_CATEGORY_TASK_ID,
  AGENT_TASK_DUE_HOURS,
  getResponsibleIds,
} from '../config';

const BASE = 'https://api.fitbase.io/api/v2';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Mirrors Http.js toFormUrlEncoded — arrays repeat the key, brackets stay literal
function toFormUrlEncoded(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === null || val === undefined || val === '') continue;
    if (Array.isArray(val)) {
      for (const v of val) {
        if (v === null || v === undefined || v === '') continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.join('&');
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.FITBASE_TOKEN}`,
    club:   env.FITBASE_CLUB,
    domain: env.FITBASE_CLUB,
  };
}

export class FitbaseAuthError extends Error {
  constructor(path: string, status: number) {
    super(`[Fitbase] auth error ${status} on ${path}`);
    this.name = 'FitbaseAuthError';
  }
}

// Core HTTP helper — 250 ms rate-limit + up to 3 retries on 429/5xx
async function request(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
): Promise<unknown> {
  const retryDelays = [1000, 2000, 4000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]);
    await sleep(250); // global rate-limit matching Apps Script

    try {
      const url     = BASE + path;
      const headers = getHeaders();
      let resp: Response;

      if (method === 'GET') {
        resp = await fetch(url, { method: 'GET', headers });
      } else {
        resp = await fetch(url, {
          method,
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: data ? toFormUrlEncoded(data) : '',
        });
      }

      const status = resp.status;

      if (status === 429 || (status >= 500 && status < 600)) {
        lastError = { status, body: await resp.text() };
        continue; // retry
      }

      if (status === 401 || status === 403) {
        throw new FitbaseAuthError(path, status);
      }

      const body = await resp.text();
      if (status < 200 || status >= 300) {
        throw new Error(`[Fitbase] ${method} ${path} → ${status} ${body.substring(0, 300)}`);
      }

      return JSON.parse(body);
    } catch (e) {
      if (e instanceof FitbaseAuthError) throw e;
      lastError = e;
    }
  }

  const lastStr = lastError instanceof Error
    ? lastError.message
    : JSON.stringify(lastError, Object.getOwnPropertyNames(lastError));
  throw new Error(`[Fitbase] failed after retries: ${method} ${path} — last: ${lastStr}`);
}

// Mirrors Fitbase.js unwrapItem: returns resp.item if present, else resp itself
export function unwrapItem(resp: unknown): Record<string, unknown> {
  const r = resp as Record<string, unknown>;
  if (r && typeof r.item === 'object' && r.item !== null) return r.item as Record<string, unknown>;
  return (r || {}) as Record<string, unknown>;
}

export async function rawGet(path: string): Promise<Record<string, unknown>> {
  return request('GET', path) as Promise<Record<string, unknown>>;
}

export async function rawPatch(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request('PATCH', path, data) as Promise<Record<string, unknown>>;
}

async function rawPost(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = (await request('POST', path, data)) as Record<string, unknown>;
  if (!result.success) {
    throw new Error(
      `[Fitbase] POST ${path} success=false: ${JSON.stringify(result).substring(0, 300)}`,
    );
  }
  return result;
}

export async function moveLead(leadId: number, toStep: number): Promise<void> {
  await rawPatch(`/lead/${leadId}`, {
    funnels_step_id: toStep,
    funnels_id:      AGENT_FUNNEL_ID,
  });
}

export type TaskType = 'NO_SHOW' | 'CANCELLED' | 'NO_REGISTRATION';

export async function createTask(
  params: { lead_id: number; description: string; client_id?: number; available_to?: number },
  type: TaskType,
): Promise<void> {
  const isCall  = type === 'NO_SHOW' || type === 'CANCELLED';
  const dueAt   = params.available_to ?? Math.floor(Date.now() / 1000) + AGENT_TASK_DUE_HOURS * 3600;
  const data: Record<string, unknown> = {
    lead_id:     params.lead_id,
    description: params.description,
    available_to: dueAt,
    is_allday:   0,
    status:      TASK_STATUS_OPEN,
    category_id: isCall ? TASK_CATEGORY_CALL_ID : TASK_CATEGORY_TASK_ID,
  };
  if (params.client_id) data.client_id = params.client_id;
  const ids = getResponsibleIds();
  // key already contains [] — array values repeat the key in form encoding
  if (ids.length > 0) data['responsible_id[]'] = ids;
  await rawPost('/task', data);
}

const TASK_DUP_KEYWORDS: Record<TaskType, string> = {
  NO_SHOW:          'не пришёл',
  CANCELLED:        'отменил',
  NO_REGISTRATION:  'нет записи',
};

// Returns the description of an existing open [АГЕНТ] task of the same type, or null.
// Used to prevent duplicate task creation when agent restarts with stale in-memory state.
export async function hasDuplicateTask(leadId: number, type: TaskType): Promise<string | null> {
  try {
    const resp = await rawGet(`/task?lead_id=${leadId}`);
    const tasks = (resp.items || []) as Record<string, unknown>[];
    const keyword = TASK_DUP_KEYWORDS[type];
    const found = tasks.find(t => {
      if (String(t.status || '') !== TASK_STATUS_OPEN) return false;
      const desc = String(t.description || '');
      return desc.startsWith('[АГЕНТ]') && desc.includes(keyword);
    });
    return found ? String(found.description || '').substring(0, 100) : null;
  } catch {
    return null; // on API error don't block task creation
  }
}

export async function addClientNote(clientId: number, note: string): Promise<void> {
  await rawPost('/note', {
    client_id:  clientId,
    manager_id: env.AGENT_USER_ID,
    note,
    pinned:     0,
  });
}

// Fetch all pages of a paginated GET endpoint, returning merged items array.
// Pass label to emit a console.log summary on completion.
export async function paginateGet(
  path: string,
  params: Record<string, string | number> = {},
  label?: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams(
      Object.entries({ ...params, page: String(page) }).map(([k, v]) => [k, String(v)]),
    ).toString();
    const resp  = await rawGet(`${path}?${qs}`);
    const items = (resp.items || []) as Record<string, unknown>[];
    all.push(...items);
    const total   = Number(resp.total_count ?? resp.total ?? 0);
    const perPage = Number(resp.page_size   ?? resp.per_page ?? (items.length || 1));
    if (items.length === 0 || (total > 0 && all.length >= total)) break;
    page++;
    if (page > Math.ceil(total / perPage) + 2) break; // safety
  }
  if (label) console.log(`[${label}] paginateGet ${path}: ${page} page(s), ${all.length} items`);
  return all;
}

export async function getClient(clientId: number): Promise<Record<string, unknown>> {
  const resp = await rawGet(`/client/${clientId}`);
  return unwrapItem(resp);
}

export async function patchLeadBudget(leadId: number, budget: number): Promise<void> {
  await rawPatch(`/lead/${leadId}`, { budget });
}

// Returns till-order-steps for a client or with arbitrary filter params (all pages).
export async function getTillOrderSteps(
  params: Record<string, string | number>,
): Promise<Record<string, unknown>[]> {
  return paginateGet('/till-order-steps', { page_size: 100, ...params });
}
