import { env, getResponsibleIds, TASK_STATUS_OPEN, TASK_CATEGORY_CALL_ID } from '../config';
import { paginateGet, rawGet, rawPost, rawPatch, rawDelete } from '../http/fitbase';

// Probe: discover cashier field, test task without lead_id, find urgency field.
export async function runProbeTasks(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // 1. Last 3 contract purchases — expose all user-related fields
  const steps = await paginateGet('/till-order-steps', {
    item_type:      'contract',
    operation_type: 'purchase',
    page_size:      100,
  });
  const last3 = steps.slice(-3);
  results.purchases_raw = last3.map(p => ({
    id:                  p.id,
    item_type:           p.item_type,
    operation_type:      p.operation_type,
    price_full:          p.price_full,
    client_id:           p.client_id,
    client_contract_id:  p.client_contract_id,
    contract_id:         p.contract_id,
    // All user-like fields — one of these is the cashier
    user:                p.user,
    user_id:             p.user_id,
    manager:             p.manager,
    manager_id:          p.manager_id,
    created_by:          p.created_by,
    cashier:             p.cashier,
    cashier_id:          p.cashier_id,
    employee:            p.employee,
    employee_id:         p.employee_id,
    responsible:         p.responsible,
    responsible_id:      p.responsible_id,
    // Nested contract reference to confirm linkage
    contract:            p.contract,
    created_at:          p.created_at,
  }));

  // 2. Try POST /task without lead_id or client_id
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const respIds  = getResponsibleIds();
  let taskId: number | null = null;

  try {
    const resp = await rawPost('/task', {
      description:      'ТЕСТ агента — удалить',
      available_to:     deadline,
      is_allday:        0,
      status:           TASK_STATUS_OPEN,
      category_id:      TASK_CATEGORY_CALL_ID,
      'responsible_id[]': respIds.length ? respIds : [String(env.AGENT_USER_ID)],
    });
    const item = resp.item as Record<string, unknown> | undefined;
    taskId = Number(item?.id ?? 0) || null;
    results.task_no_lead = { ok: true, task_id: taskId, response: resp };
  } catch (e) {
    results.task_no_lead = { ok: false, error: (e as Error).message };
  }

  // 3. Find urgency field — try is_important, then get the task to see available fields
  if (taskId) {
    try {
      const patchResp = await rawPatch(`/task/${taskId}`, { is_important: 1 });
      results.urgency_patch_is_important = { ok: true, response: patchResp };
    } catch (e) {
      results.urgency_patch_is_important = { ok: false, error: (e as Error).message };
    }

    try {
      const getResp = await rawGet(`/task/${taskId}`);
      const item    = (getResp.item ?? getResp) as Record<string, unknown>;
      results.task_get = {
        all_keys:    Object.keys(item),
        is_important: item.is_important,
        urgent:       item.urgent,
        priority:     item.priority,
        status:       item.status,
      };
    } catch (e) {
      results.task_get = { error: (e as Error).message };
    }

    // 4. Delete the test task
    try {
      const delResp = await rawDelete(`/task/${taskId}`);
      results.task_delete = { ok: true, response: delResp };
    } catch (e) {
      results.task_delete = { ok: false, error: (e as Error).message };
    }
  }

  // Human-readable conclusions (fill in after reading the raw data above)
  const noLead = results.task_no_lead as Record<string, unknown> | undefined;
  const urgPatch = results.urgency_patch_is_important as Record<string, unknown> | undefined;
  results.conclusions = {
    cashier_field:       'see purchases_raw — check user / manager / created_by / employee fields',
    task_without_lead:   noLead?.ok === true ? 'можно' : `нельзя — ${noLead?.error}`,
    urgency_is_important: urgPatch?.ok === true ? 'is_important=1 принято' : `не принято — ${urgPatch?.error}`,
    urgency_other:       'see task_get.all_keys for urgent / priority fields',
  };

  return results;
}
