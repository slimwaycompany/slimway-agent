// Import trial agent state from Google Sheets CSV export.
// Place your export at ./import/trial_state.csv then run:
//   npm run import:trial-state
//
// Expected CSV columns (from Apps Script trial_state sheet):
//   lead_id, stage_id, first_seen_at, last_registration_id,
//   acted_reg_ids, open_task_types, ...
//
// acted_reg_ids format: "regId|timestamp,regId|timestamp,..."
// The script upserts into agent_state and agent_acted — safe to re-run.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs   from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase   = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const CSV_PATH   = path.join(process.cwd(), 'import', 'trial_state.csv');

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    // Basic CSV split (does not handle quoted commas, but Apps Script exports are plain)
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`File not found: ${CSV_PATH}`);
    console.error('Export the "trial_state" sheet from Google Sheets as CSV and place it at ./import/trial_state.csv');
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf-8'));
  console.log(`CSV rows: ${rows.length}`);

  let stateOk = 0, stateFail = 0, actedOk = 0, actedFail = 0;

  for (const row of rows) {
    const leadId = parseInt(row.lead_id, 10);
    if (!leadId) continue;

    const stageId    = parseInt(row.stage_id, 10) || 0;
    const firstSeen  = row.first_seen_at
      ? (() => { try { return new Date(row.first_seen_at).toISOString(); } catch { return new Date().toISOString(); } })()
      : new Date().toISOString();

    const { error: se } = await supabase.from('agent_state').upsert({
      lead_id:                 leadId,
      stage_id:                stageId,
      first_seen_at:           firstSeen,
      last_logged_fingerprint: '',
      open_task_types:         [],
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'lead_id' });

    if (se) { console.error(`  state upsert lead=${leadId}: ${se.message}`); stateFail++; continue; }
    stateOk++;

    // Import acted reg keys
    const actedRaw = row.acted_reg_ids || '';
    if (actedRaw) {
      const keys = actedRaw.split(',').map(s => s.trim()).filter(Boolean);
      for (const key of keys) {
        const { error: ae } = await supabase.from('agent_acted').upsert({
          lead_id:    leadId,
          action_key: key,
          action:     'IMPORTED',
          acted_at:   new Date().toISOString(),
        }, { onConflict: 'lead_id,action_key' });

        if (ae) { actedFail++; } else { actedOk++; }
      }
    }
  }

  console.log(`\nDone:`);
  console.log(`  agent_state : ${stateOk} upserted, ${stateFail} failed`);
  console.log(`  agent_acted : ${actedOk} upserted, ${actedFail} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
