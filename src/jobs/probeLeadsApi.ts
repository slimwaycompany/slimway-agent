import { rawGet, paginateGet } from '../http/fitbase';

// PII masking helpers
function maskPhone(v: unknown): string | null {
  if (v == null) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length < 11) return '•••';
  return `+7 7•• ••• ••${d.slice(-2)}`;
}

function maskName(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s[0] + '•••';
}

function maskLead(l: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(l)) {
    if (k === 'iin' || k === 'inn') continue;
    if (k === 'name' || k === 'surname') r[k] = maskName(val);
    else if (k === 'phone') r[k] = maskPhone(val);
    else if (k === 'client' && val && typeof val === 'object') {
      const c = val as Record<string, unknown>;
      r[k] = { ...c, name: maskName(c.name), surname: maskName(c.surname), phone: maskPhone(c.phone), iin: undefined };
    } else if (k === 'manager' && val && typeof val === 'object') {
      const m = val as Record<string, unknown>;
      r[k] = { ...m, name: maskName(m.name), surname: maskName(m.surname), full_name: maskName(m.full_name) };
    } else {
      r[k] = val;
    }
  }
  return r;
}

function tryInt(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

// Probe a single endpoint, return {works, error?, total?, items?, fields?, example?}
async function probeEndpoint(
  path: string,
  transform?: (item: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const resp = await rawGet(path);
    const items = (resp.items ?? []) as Record<string, unknown>[];
    const item0 = items[0];
    return {
      works: true,
      total: tryInt(resp.total_count ?? resp.total),
      count: items.length,
      fields: item0 ? Object.keys(item0) : [],
      example: item0 ? (transform ? transform(item0) : item0) : null,
      meta_keys: Object.keys(resp).filter(k => k !== 'items'),
    };
  } catch (e) {
    return { works: false, error: (e as Error).message };
  }
}

export async function runProbeLeadsApi(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  // ── 1. Funnels and steps ───────────────────────────────────────────────────
  try {
    const stepsResp = await rawGet('/purchase-funnel-step?page_size=100');
    const steps = (stepsResp.items ?? []) as Record<string, unknown>[];

    // Try separate funnels list endpoint
    let funnelsList: unknown = null;
    try {
      const fr = await rawGet('/purchase-funnel?page_size=100');
      const fItems = (fr.items ?? []) as Record<string, unknown>[];
      funnelsList = { works: true, count: fItems.length, items: fItems.map(f => ({ id: f.id, name: f.name, sort: f.sort })) };
    } catch (e2) {
      funnelsList = { works: false, error: (e2 as Error).message };
    }

    // Extract unique funnels from steps
    const funnelMap = new Map<string, { id: unknown; name: unknown }>();
    for (const s of steps) {
      const pf = s.purchase_funnel as Record<string, unknown> | null;
      if (pf?.id != null) funnelMap.set(String(pf.id), { id: pf.id, name: pf.name });
    }

    result.funnels_steps = {
      endpoint_steps: '/purchase-funnel-step?page_size=100',
      endpoint_funnels: '/purchase-funnel (see funnels_list)',
      funnels_list: funnelsList,
      funnels_from_steps: [...funnelMap.values()],
      steps_total: steps.length,
      steps_fields: steps[0] ? Object.keys(steps[0]) : [],
      steps: steps.map(s => {
        const pf = s.purchase_funnel as Record<string, unknown> | null;
        return {
          id: s.id,
          name: s.name,
          sort: s.sort,
          funnel_id: pf?.id ?? null,
          funnel_name: pf?.name ?? null,
          color: s.color ?? null,
          type: s.type ?? null,
          is_system: s.is_system ?? null,
          additional_keys: Object.keys(s).filter(k => !['id','name','sort','purchase_funnel','color','type','is_system'].includes(k)),
        };
      }),
    };
  } catch (e) {
    result.funnels_steps = { error: (e as Error).message };
  }

  // ── 2. Leads list ─────────────────────────────────────────────────────────
  try {
    const listResp = await rawGet('/lead?page_size=5');
    const items = (listResp.items ?? []) as Record<string, unknown>[];
    const item0 = items[0];
    const totalCount = listResp.total_count ?? listResp.total ?? 0;

    // Filter experiments: archived
    const archiveTests: Record<string, unknown> = {};
    for (const p of ['is_archive=1', 'archived=1', 'is_archived=1', 'archive=1', 'deleted=1']) {
      try {
        const r = await rawGet(`/lead?${p}&page_size=1`);
        archiveTests[p] = { total: r.total_count ?? r.total ?? 0 };
      } catch (e2) {
        archiveTests[p] = { error: (e2 as Error).message };
      }
    }

    // Filter experiments: updated_from
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const updTests: Record<string, unknown> = {};
    for (const p of [`updated_from=${weekAgo}`, `updated_at_from=${weekAgo}`, `updated_since=${weekAgo}`, `date_from=${weekAgo}`]) {
      try {
        const r = await rawGet(`/lead?${p}&page_size=1`);
        updTests[p] = { total: r.total_count ?? r.total ?? 0 };
      } catch (e2) {
        updTests[p] = { error: (e2 as Error).message };
      }
    }

    // Filter by funnel
    const funnelTests: Record<string, unknown> = {};
    for (const p of ['funnels_id=1', 'funnel_id=1', 'purchase_funnel_id=1', 'funnels_id=2', 'funnels_id=3', 'funnels_id=4']) {
      try {
        const r = await rawGet(`/lead?${p}&page_size=1`);
        funnelTests[p] = { total: r.total_count ?? r.total ?? 0 };
      } catch (e2) {
        funnelTests[p] = { error: (e2 as Error).message };
      }
    }

    // Check tags in first 10 leads
    const withTags = items.find(l => Array.isArray(l.tags) && (l.tags as unknown[]).length > 0);

    result.leads_list = {
      endpoint: '/lead',
      total_count: totalCount,
      fields: item0 ? Object.keys(item0) : [],
      response_meta_keys: Object.keys(listResp).filter(k => k !== 'items'),
      example: item0 ? maskLead(item0) : null,
      tags_in_lead_example: withTags ? (withTags.tags as unknown[]).slice(0, 5) : 'not found in first 5 leads',
      archive_filter_tests: archiveTests,
      updated_from_filter_tests: updTests,
      funnel_filter_tests: funnelTests,
    };
  } catch (e) {
    result.leads_list = { error: (e as Error).message };
  }

  // ── 3. Lead detail ────────────────────────────────────────────────────────
  try {
    const listResp = await rawGet('/lead?page_size=1');
    const items = (listResp.items ?? []) as Record<string, unknown>[];
    if (items[0]) {
      const id = items[0].id;
      const detailResp = await rawGet(`/lead/${id}`);
      const detail = (detailResp.item ?? detailResp) as Record<string, unknown>;
      const listKeys = new Set(Object.keys(items[0]));
      const detailKeys = Object.keys(detail);
      result.lead_detail = {
        endpoint: '/lead/:id',
        all_fields: detailKeys,
        extra_vs_list: detailKeys.filter(k => !listKeys.has(k)),
        example: maskLead(detail),
      };
    } else {
      result.lead_detail = { info: 'no leads found' };
    }
  } catch (e) {
    result.lead_detail = { error: (e as Error).message };
  }

  // ── 4. Tags ───────────────────────────────────────────────────────────────
  try {
    const tagEndpoints: Record<string, unknown> = {};
    for (const ep of ['/tag', '/lead-tag', '/tags', '/label']) {
      try {
        const r = await rawGet(`${ep}?page_size=100`);
        const tItems = (r.items ?? []) as Record<string, unknown>[];
        tagEndpoints[ep] = {
          works: true,
          count: tItems.length,
          sample: tItems.slice(0, 10).map(t => ({ id: t.id, name: t.name, slug: t.slug })),
        };
        break;
      } catch (e2) {
        tagEndpoints[ep] = { error: (e2 as Error).message };
      }
    }

    // Check known tags (tiktok, manual_import, no_phone) in leads
    const leads10 = await rawGet('/lead?page_size=10');
    const l10 = (leads10.items ?? []) as Record<string, unknown>[];
    const knownTagSlugs = new Set<string>();
    for (const l of l10) {
      if (Array.isArray(l.tags)) {
        for (const t of l.tags as Record<string, unknown>[]) {
          const slug = String(t.slug ?? t.name ?? '').toLowerCase();
          if (slug) knownTagSlugs.add(slug);
        }
      }
    }

    result.tags = {
      tag_endpoints: tagEndpoints,
      tag_field_in_lead: 'tags (array)',
      tag_format_in_lead: l10.find(l => Array.isArray(l.tags) && (l.tags as unknown[]).length > 0)
        ? (l10.find(l => Array.isArray(l.tags) && (l.tags as unknown[]).length > 0)!.tags as unknown[])[0]
        : 'no tagged leads in first 10',
      known_slugs_in_first_10: [...knownTagSlugs],
      has_tiktok: knownTagSlugs.has('tiktok'),
      has_manual_import: knownTagSlugs.has('manual_import'),
      has_no_phone: knownTagSlugs.has('no_phone'),
    };
  } catch (e) {
    result.tags = { error: (e as Error).message };
  }

  // ── 5. Tasks ──────────────────────────────────────────────────────────────
  try {
    const taskResp = await rawGet('/task?page_size=5');
    const taskItems = (taskResp.items ?? []) as Record<string, unknown>[];
    const t0 = taskItems[0];

    // Test lead_id filter using first lead that has client_id
    const leadResp = await rawGet('/lead?page_size=10');
    const leadItems = (leadResp.items ?? []) as Record<string, unknown>[];
    let leadFilter: unknown = null;
    let clientFilter: unknown = null;
    if (leadItems[0]) {
      const lid = leadItems[0].id;
      try {
        const r = await rawGet(`/task?lead_id=${lid}&page_size=10`);
        leadFilter = { total: r.total_count ?? r.total ?? (r.items as unknown[] | undefined)?.length ?? 0, fields: (r.items as Record<string, unknown>[] | undefined)?.[0] ? Object.keys((r.items as Record<string, unknown>[])[0]) : [] };
      } catch (e2) {
        leadFilter = { error: (e2 as Error).message };
      }
      // Try client_id filter
      const withClient = leadItems.find(l => l.client_id != null && Number(l.client_id) > 0);
      if (withClient) {
        try {
          const r = await rawGet(`/task?client_id=${withClient.client_id}&page_size=10`);
          clientFilter = { total: r.total_count ?? r.total ?? (r.items as unknown[] | undefined)?.length ?? 0 };
        } catch (e2) {
          clientFilter = { error: (e2 as Error).message };
        }
      }
    }

    // Category endpoints
    let categories: unknown = null;
    for (const ep of ['/task-category', '/task/category', '/category', '/task-type']) {
      try {
        const r = await rawGet(`${ep}?page_size=100`);
        const cItems = (r.items ?? []) as Record<string, unknown>[];
        categories = { endpoint: ep, works: true, items: cItems.map(c => ({ id: c.id, name: c.name })) };
        break;
      } catch {
        categories = `${ep}: 404`;
      }
    }

    // Urgency/overdue detection: check available_to vs now
    const now = Math.floor(Date.now() / 1000);
    const overdueTask = taskItems.find(t => t.available_to != null && Number(t.available_to) < now && t.status !== '2');

    result.tasks = {
      endpoint: '/task',
      total_count: taskResp.total_count ?? taskResp.total ?? taskItems.length,
      fields: t0 ? Object.keys(t0) : [],
      overdue_detection: overdueTask
        ? { method: 'available_to (unix timestamp) < now AND status != 2', example_available_to: overdueTask.available_to, example_status: overdueTask.status }
        : { method: 'available_to < now — no overdue in first 5, check manually' },
      example: t0 ? { ...t0, description: t0.description ? '•••' : null } : null,
      lead_id_filter: leadFilter,
      client_id_filter: clientFilter,
      categories_endpoint: categories,
    };
  } catch (e) {
    result.tasks = { error: (e as Error).message };
  }

  // ── 6. Notes ──────────────────────────────────────────────────────────────
  try {
    // Find first lead to query notes by lead_id
    const leadResp = await rawGet('/lead?page_size=5');
    const leadItems = (leadResp.items ?? []) as Record<string, unknown>[];
    let noteResult: unknown = null;
    for (const lead of leadItems) {
      try {
        const r = await rawGet(`/note?lead_id=${lead.id}&page_size=10`);
        const nItems = (r.items ?? []) as Record<string, unknown>[];
        if (nItems.length > 0) {
          const n0 = nItems[0];
          noteResult = {
            endpoint: '/note?lead_id=:id',
            total: r.total_count ?? r.total ?? nItems.length,
            fields: Object.keys(n0),
            type_values: [...new Set(nItems.map(n => n.type ?? n.note_type ?? 'unknown'))],
            example: { ...n0, note: '•••', manager: n0.manager ? maskName((n0.manager as Record<string, unknown>)?.full_name) : null },
          };
          break;
        }
      } catch {}
    }
    if (!noteResult) {
      // Try without filter to see the endpoint works
      try {
        const r = await rawGet('/note?page_size=3');
        const nItems = (r.items ?? []) as Record<string, unknown>[];
        noteResult = {
          endpoint: '/note',
          total: r.total_count ?? r.total ?? nItems.length,
          fields: nItems[0] ? Object.keys(nItems[0]) : [],
          info: 'no notes found for first 5 leads',
        };
      } catch (e2) {
        noteResult = { error: (e2 as Error).message };
      }
    }
    result.notes = noteResult;
  } catch (e) {
    result.notes = { error: (e as Error).message };
  }

  // ── 7. Client status ──────────────────────────────────────────────────────
  try {
    const leadResp = await rawGet('/lead?page_size=20');
    const leadItems = (leadResp.items ?? []) as Record<string, unknown>[];
    const withClient = leadItems.find(l => l.client_id != null && Number(l.client_id) > 0);
    if (withClient) {
      const clientId = Number(withClient.client_id);
      const r = await rawGet(`/client/${clientId}`);
      const c = (r.item ?? r) as Record<string, unknown>;
      const statusRelated = Object.fromEntries(
        Object.entries(c).filter(([k]) => k.toLowerCase().includes('status') || k === 'type' || k === 'color')
      );
      result.client_detail = {
        endpoint: '/client/:id',
        all_fields: Object.keys(c),
        status_related_fields: statusRelated,
        example: {
          id: c.id,
          name: maskName(c.name),
          surname: maskName(c.surname),
          phone: maskPhone(c.phone),
          status: c.status,
          status_id: c.status_id,
          client_type: c.type ?? c.client_type,
          color: c.color,
        },
      };
    } else {
      result.client_detail = { info: 'no lead with client_id in first 20 leads' };
    }
  } catch (e) {
    result.client_detail = { error: (e as Error).message };
  }

  // ── 8. Managers/users directory ───────────────────────────────────────────
  try {
    const userTests: Record<string, unknown> = {};
    let found = false;
    for (const ep of ['/user', '/manager', '/employee', '/staff', '/club-user']) {
      try {
        const r = await rawGet(`${ep}?page_size=100`);
        const uItems = (r.items ?? []) as Record<string, unknown>[];
        userTests[ep] = {
          works: true,
          count: uItems.length,
          fields: uItems[0] ? Object.keys(uItems[0]) : [],
          sample: uItems.slice(0, 5).map(u => ({
            id: u.id,
            name: maskName(u.name),
            surname: maskName(u.surname),
            full_name: maskName(u.full_name),
            role: u.role ?? u.position,
          })),
        };
        found = true;
        break;
      } catch (e2) {
        userTests[ep] = { works: false, error: (e2 as Error).message };
      }
    }
    if (!found) {
      // Try get from /user without items wrapping
      try {
        const r = await rawGet('/user');
        userTests['/user (raw)'] = { works: true, raw_keys: Object.keys(r) };
      } catch {}
    }
    result.managers = userTests;
  } catch (e) {
    result.managers = { error: (e as Error).message };
  }

  // ── 9. Ad sources directory ───────────────────────────────────────────────
  try {
    const srcTests: Record<string, unknown> = {};
    for (const ep of ['/advertising-source', '/ad-source', '/source', '/lead-source', '/client-source']) {
      try {
        const r = await rawGet(`${ep}?page_size=100`);
        const sItems = (r.items ?? []) as Record<string, unknown>[];
        srcTests[ep] = {
          works: true,
          count: sItems.length,
          items: sItems.map(s => ({ id: s.id, name: s.name, slug: s.slug })),
        };
        break;
      } catch (e2) {
        srcTests[ep] = { works: false, error: (e2 as Error).message };
      }
    }
    result.ad_sources = srcTests;
  } catch (e) {
    result.ad_sources = { error: (e as Error).message };
  }

  // ── 10. Performance: full scan ────────────────────────────────────────────
  try {
    const t0 = Date.now();
    const allLeads = await paginateGet('/lead', { page_size: 100 }, 'probe-leads-api-perf');
    const leadsMs = Date.now() - t0;

    // Count by funnel/stage
    const byFunnel: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    for (const l of allLeads) {
      const step = l.funnel_step as Record<string, unknown> | null;
      const fn = String((step?.purchase_funnel as Record<string, unknown> | null)?.name ?? 'unknown');
      const st = String(step?.name ?? 'unknown');
      byFunnel[fn] = (byFunnel[fn] ?? 0) + 1;
      byStage[st] = (byStage[st] ?? 0) + 1;
    }

    // Full tasks scan
    const t1 = Date.now();
    const allTasks = await paginateGet('/task', { page_size: 100 }, 'probe-tasks-api-perf');
    const tasksMs = Date.now() - t1;

    const totalMs = leadsMs + tasksMs;
    result.performance = {
      leads_total: allLeads.length,
      leads_elapsed_ms: leadsMs,
      tasks_total: allTasks.length,
      tasks_elapsed_ms: tasksMs,
      total_elapsed_ms: totalMs,
      per_5min_feasible: totalMs < 4 * 60 * 1000,
      by_funnel: byFunnel,
      leads_by_stage: byStage,
    };
  } catch (e) {
    result.performance = { error: (e as Error).message };
  }

  return result;
}
