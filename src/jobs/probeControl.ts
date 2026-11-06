import { supabase } from '../db/supabase';
import { rawGet, paginateGet } from '../http/fitbase';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Probe Fitbase API for control module needs ────────────────────────────────
// Questions:
//  1. Does /client-contract have visits_left?
//  2. Does /schedule-registration have who/when changed status?
//  3. Does /client/:id return DOB, name, phone?
//  4. Do /note entries and crm_lead_activity/crm_lead_tasks have author + time?

export async function runProbeControl(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  // ── Step 1: sample 3 clients from fitbase_contracts ──────────────────────
  const { data: contracts } = await supabase
    .from('fitbase_contracts')
    .select('client_fitbase_id,raw')
    .not('client_fitbase_id', 'is', null)
    .limit(5);

  const clientIds: number[] = [];
  for (const c of contracts ?? []) {
    const cid = Number(c.client_fitbase_id);
    if (cid && !clientIds.includes(cid)) clientIds.push(cid);
    if (clientIds.length >= 3) break;
  }
  result.sampled_client_ids = clientIds;

  // ── Q1: visits_left in /client-contract ──────────────────────────────────
  const contractSamples: unknown[] = [];
  for (const cid of clientIds.slice(0, 2)) {
    await sleep(400);
    const resp = await rawGet(`/client-contract?client_id=${cid}&page_size=3`);
    const items = ((resp.items || []) as Record<string, unknown>[]).slice(0, 2);
    contractSamples.push({
      client_id: cid,
      items: items.map(c => ({
        id: c.id,
        visits_left: c.visits_left,       // key field
        visits_used: c.visits_used,
        ticket_visits: (c.ticket as Record<string,unknown>|null)?.visits,
        begin_date: c.begin_date,
        end_date: c.end_date,
        closed: c.closed,
        price: c.price,
      })),
    });
  }
  result.q1_visits_left = {
    question: 'Does /client-contract have visits_left field?',
    answer: contractSamples.length > 0 && (contractSamples[0] as Record<string,unknown[]>).items?.length > 0
      ? `visits_left is ${JSON.stringify(((contractSamples[0] as Record<string,unknown[]>).items[0] as Record<string,unknown>).visits_left)} (null=не используется, number=есть)`
      : 'no samples',
    samples: contractSamples,
  };

  // ── Q2: status history in /schedule-registration ─────────────────────────
  const regSamples: unknown[] = [];
  for (const cid of clientIds.slice(0, 2)) {
    await sleep(400);
    const resp = await rawGet(`/schedule-registration?client_id=${cid}&page_size=3`);
    const items = ((resp.items || []) as Record<string, unknown>[]).slice(0, 2);
    regSamples.push({
      client_id: cid,
      items: items.map(r => {
        const ev = (r.event || {}) as Record<string,unknown>;
        return {
          id: r.id,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          created_by: r.created_by,         // who created
          updated_by: r.updated_by,         // who last updated
          status_set_by: r.status_set_by,   // hypothetical
          history: r.history,               // hypothetical
          all_top_keys: Object.keys(r).join(','),
          event_date: ev.date,
          event_time: ev.time_start,
        };
      }),
    });
  }
  const sampleKeys = regSamples.length > 0
    ? (regSamples[0] as Record<string, unknown[]>).items?.[0] as Record<string,unknown>
    : {};
  result.q2_status_history = {
    question: 'Does /schedule-registration show who changed status?',
    answer: sampleKeys?.updated_by || sampleKeys?.created_by
      ? 'YES — has updated_by/created_by fields'
      : 'NO — standard fields only (created_at/updated_at without user)',
    all_top_level_keys: sampleKeys?.all_top_keys,
    samples: regSamples,
  };

  // ── Q3: DOB, name, phone in /client/:id ──────────────────────────────────
  const clientSamples: unknown[] = [];
  for (const cid of clientIds.slice(0, 2)) {
    await sleep(400);
    const resp = await rawGet(`/client/${cid}`);
    const c = ((resp.item ?? resp) as Record<string,unknown>);
    clientSamples.push({
      id: cid,
      name: c.name,
      surname: c.surname,
      patronymic: c.patronymic,
      phone: c.phone ?? c.mobile,
      birth_date: c.birth_date,     // key field
      birthdate: c.birthdate,       // alternative
      dob: c.dob,                   // alternative
      all_top_keys: Object.keys(c).join(','),
    });
  }
  result.q3_client_dob = {
    question: 'Does /client/:id return birth_date/DOB, full name, phone?',
    answer: clientSamples.length > 0
      ? `birth_date=${JSON.stringify((clientSamples[0] as Record<string,unknown>).birth_date)}, phone=${JSON.stringify((clientSamples[0] as Record<string,unknown>).phone)}`
      : 'no samples',
    all_top_level_keys: clientSamples[0] ? (clientSamples[0] as Record<string,unknown>).all_top_keys : null,
    samples: clientSamples,
  };

  // ── Q4a: /note — author and time ─────────────────────────────────────────
  const noteSamples: unknown[] = [];
  for (const cid of clientIds.slice(0, 1)) {
    await sleep(400);
    const resp = await rawGet(`/note?client_id=${cid}&page_size=3`);
    const items = ((resp.items || []) as Record<string,unknown>[]).slice(0, 3);
    noteSamples.push(...items.map(n => ({
      id: n.id,
      text: String(n.text || '').slice(0, 50),
      created_at: n.created_at,
      author: n.author,
      manager: n.manager,
      user: n.user,
      created_by: n.created_by,
      all_top_keys: Object.keys(n).join(','),
    })));
  }
  result.q4a_note_author = {
    question: 'Does /note have author and exact time?',
    answer: noteSamples.length > 0
      ? `author=${JSON.stringify((noteSamples[0] as Record<string,unknown>).author)}, created_at=${JSON.stringify((noteSamples[0] as Record<string,unknown>).created_at)}`
      : 'no samples',
    all_top_level_keys: noteSamples[0] ? (noteSamples[0] as Record<string,unknown>).all_top_keys : null,
    samples: noteSamples,
  };

  // ── Q4b: crm_lead_activity author field ──────────────────────────────────
  const { data: activities } = await supabase
    .from('crm_lead_activity')
    .select('id,kind,text,author,meta,created_at')
    .order('created_at', { ascending: false })
    .limit(3);
  result.q4b_lead_activity = {
    question: 'Does crm_lead_activity have author + created_at?',
    answer: activities?.[0] ? `author="${activities[0].author}", created_at="${activities[0].created_at}"` : 'empty',
    samples: activities?.slice(0, 2),
  };

  // ── Q4c: crm_lead_tasks created_by field ─────────────────────────────────
  const { data: tasks } = await supabase
    .from('crm_lead_tasks')
    .select('id,description,responsible_user_id,created_by,due_at,created_at')
    .order('created_at', { ascending: false })
    .limit(3);
  result.q4c_lead_tasks = {
    question: 'Does crm_lead_tasks have created_by + created_at?',
    answer: tasks?.[0] ? `created_by="${tasks[0].created_by}", created_at="${tasks[0].created_at}"` : 'empty',
    samples: tasks?.slice(0, 2),
  };

  // ── Q5: script_events structure for quality check ─────────────────────────
  const { data: sEvents } = await supabase
    .from('script_events')
    .select('id,client_id,event_type,node_id,fact_key,fact_value,manager,created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  result.q5_script_events = {
    question: 'script_events structure for s2 quality checks',
    sample_event_types: [...new Set((sEvents || []).map(e => e.event_type))],
    samples: sEvents?.slice(0, 3),
  };

  // ── Q6: script_clients facts structure ────────────────────────────────────
  const { data: sClients } = await supabase
    .from('script_clients')
    .select('id,client_key,facts,vars,status,last_manager,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(3);
  result.q6_script_clients = {
    question: 'script_clients facts structure for s2 quality checks',
    samples: sClients?.slice(0, 2)?.map(c => ({
      client_key: c.client_key,
      status: c.status,
      facts_keys: c.facts ? Object.keys(c.facts) : [],
      last_manager: c.last_manager,
    })),
  };

  return result;
}
