import { Router } from 'express';
import type { Request, Response } from 'express';
import express from 'express';
import { supabase } from '../db/supabase';
import { getSession, requireAdmin } from './auth';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '7' + digits.slice(1);
  }
  if (digits.length === 10) return '7' + digits;
  return digits.length >= 10 ? digits : null;
}

// Parse call direction and status from OnlinePBX event fields
function parseDirection(payload: Record<string, unknown>): 'inbound' | 'outbound' | 'internal' {
  const dir = String(payload.direction ?? payload.call_type ?? '').toLowerCase();
  if (dir.includes('in') || dir === '1') return 'inbound';
  if (dir.includes('out') || dir === '2') return 'outbound';
  return 'internal';
}

function parseStatus(event: string): 'ringing' | 'answered' | 'missed' | 'ended' {
  const e = event.toLowerCase();
  if (e.includes('missed') || e.includes('пропущен')) return 'missed';
  if (e.includes('answer') || e.includes('ответ')) return 'answered';
  if (e.includes('end') || e.includes('hangup') || e.includes('завершен')) return 'ended';
  return 'ringing';
}

function parseTimestamp(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'number') return new Date(v * 1000).toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

async function processPbxEvent(eventId: string, event: string, callUuid: string, payload: Record<string, unknown>): Promise<void> {
  // Look up extension → user
  const extension = String(
    payload.gateway_id ?? payload.extension ?? payload.internal ?? payload.operator_ext ?? '',
  ).trim();

  let userName: string | null = null;
  if (extension) {
    const { data: ext } = await supabase
      .from('pbx_extensions')
      .select('user_name')
      .eq('branch_id', BRANCH_ID)
      .eq('extension', extension)
      .maybeSingle();
    userName = ext?.user_name ? String(ext.user_name) : null;
  }

  // Determine client phone
  const rawPhone = String(
    payload.caller ?? payload.number ?? payload.caller_id ?? payload.dst ?? '',
  ).trim();
  const phoneParsed = normalizePhone(rawPhone);

  // Look up lead/client
  let leadId: string | null = null;
  let fitbaseClientId: number | null = null;

  if (phoneParsed) {
    const { data: lead } = await supabase
      .from('crm_leads')
      .select('id,fitbase_client_id')
      .eq('branch_id', BRANCH_ID)
      .eq('phone_digits', phoneParsed)
      .not('stage_kind', 'eq', 'lost')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead) {
      leadId = String(lead.id);
      fitbaseClientId = lead.fitbase_client_id ? Number(lead.fitbase_client_id) : null;
    }
    if (!fitbaseClientId) {
      const { data: fc } = await supabase
        .from('fitbase_clients_cache')
        .select('fitbase_id')
        .eq('phone_digits', phoneParsed)
        .limit(1)
        .maybeSingle();
      if (fc) fitbaseClientId = Number(fc.fitbase_id);
    }
  }

  // Parse times
  const startedAt  = parseTimestamp(payload.date ?? payload.created_at ?? payload.start_time);
  const answeredAt = parseTimestamp(payload.answer_time ?? payload.answered_at);
  const endedAt    = parseTimestamp(payload.end_time ?? payload.ended_at ?? payload.hangup_time);
  const talkSec    = payload.talk_duration ? Number(payload.talk_duration) : null;
  const recordUrl  = payload.record_url ? String(payload.record_url) : null;

  const direction = parseDirection(payload);
  const status    = parseStatus(event);

  const { error } = await supabase.from('pbx_calls').upsert({
    call_uuid: callUuid, branch_id: BRANCH_ID,
    direction, status,
    client_phone: rawPhone || null,
    phone_digits: phoneParsed,
    extension:    extension || null,
    user_name:    userName,
    started_at:   startedAt,
    answered_at:  answeredAt,
    ended_at:     endedAt,
    talk_seconds: talkSec,
    record_url:   recordUrl,
    lead_id:      leadId,
    fitbase_client_id: fitbaseClientId,
    raw_last:     payload,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'call_uuid' });

  if (error) {
    await supabase.from('pbx_events').update({ processed: false, error: error.message }).eq('id', eventId);
    console.error('[pbx] upsert pbx_calls error:', error.message);
  } else {
    await supabase.from('pbx_events').update({ processed: true }).eq('id', eventId);
  }
}

export function buildPbxRouter(): Router {
  const r = Router();

  // ── Webhook receiver ──────────────────────────────────────────────────────

  // GET — availability check
  r.get('/hooks/onlinepbx', (req, res) => {
    const secret = process.env.PBX_WEBHOOK_SECRET;
    if (!secret) { res.status(503).json({ ok: false, error: 'PBX_WEBHOOK_SECRET not configured' }); return; }
    if (req.query.key !== secret) { res.status(401).json({ ok: false }); return; }
    res.json({ ok: true, service: 'onlinepbx' });
  });

  r.post(
    '/hooks/onlinepbx',
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const secret = process.env.PBX_WEBHOOK_SECRET;
      if (!secret) { res.status(503).json({ ok: false, error: 'PBX_WEBHOOK_SECRET not configured' }); return; }
      if (req.query.key !== secret) { res.status(401).json({ ok: false }); return; }

      // Respond 200 immediately
      res.json({ ok: true });

      // Process after response
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const event    = String(body.event ?? body.type ?? 'unknown');
        const callUuid = String(body.uuid ?? body.call_uuid ?? body.id ?? Date.now());

        // Store raw event first — never lose data
        const { data: evRow, error: evErr } = await supabase
          .from('pbx_events')
          .insert({
            branch_id: BRANCH_ID, event, call_uuid: callUuid,
            payload: body, processed: false,
          })
          .select('id')
          .single();

        if (evErr) { console.error('[pbx] insert pbx_events error:', evErr.message); return; }

        // Parse into pbx_calls
        await processPbxEvent(String(evRow.id), event, callUuid, body);
      } catch (e) {
        console.error('[pbx] webhook processing error:', (e as Error).message);
      }
    },
  );

  // ── PBX settings API (settings.pbx) ──────────────────────────────────────

  r.use('/kviz/api/pbx', (req, res, next) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  });

  // GET settings + webhook URL
  r.get('/kviz/api/pbx/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const secret = process.env.PBX_WEBHOOK_SECRET ?? '';
    const baseUrl = process.env.RENDER_EXTERNAL_URL ?? `https://slimway-agent.onrender.com`;
    const webhookUrl = secret
      ? `${baseUrl}/hooks/onlinepbx?key=${encodeURIComponent(secret)}`
      : null;
    try {
      const { data: exts } = await supabase
        .from('pbx_extensions')
        .select('extension,user_name,updated_at')
        .eq('branch_id', BRANCH_ID)
        .order('extension');
      res.json({ webhook_url: webhookUrl, configured: !!secret, extensions: exts ?? [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Add/update extension
  r.post('/kviz/api/pbx/extensions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body as Record<string, unknown>;
    const extension = String(b.extension ?? '').trim();
    const userName  = String(b.user_name  ?? '').trim();
    if (!extension || !userName) {
      res.status(400).json({ error: 'Укажите номер и сотрудника' }); return;
    }
    try {
      const { error } = await supabase.from('pbx_extensions').upsert({
        branch_id: BRANCH_ID, extension, user_name: userName, updated_at: new Date().toISOString(),
      }, { onConflict: 'branch_id,extension' });
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Remove extension
  r.delete('/kviz/api/pbx/extensions/:ext', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase
        .from('pbx_extensions')
        .delete()
        .eq('branch_id', BRANCH_ID)
        .eq('extension', req.params.ext);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Last 30 events
  r.get('/kviz/api/pbx/events', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('pbx_events')
        .select('id,received_at,event,call_uuid,processed,error')
        .eq('branch_id', BRANCH_ID)
        .order('received_at', { ascending: false })
        .limit(30);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Last 30 calls
  r.get('/kviz/api/pbx/calls', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('pbx_calls')
        .select('call_uuid,direction,status,client_phone,extension,user_name,started_at,talk_seconds,lead_id')
        .eq('branch_id', BRANCH_ID)
        .order('started_at', { ascending: false })
        .limit(30);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json(data ?? []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}

// Optional sync job: pulls last 2 hours from OnlinePBX API
export async function runPbxSync(): Promise<{ synced: number; skipped: boolean }> {
  const domain = process.env.ONLINEPBX_DOMAIN;
  const apiKey = process.env.ONLINEPBX_API_KEY;
  if (!domain || !apiKey) {
    console.log('[pbx-sync] ONLINEPBX_DOMAIN/API_KEY not set, skipping');
    return { synced: 0, skipped: true };
  }

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 2 * 3600_000);
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

  let synced = 0;
  try {
    const url = `https://${domain}/api/v1/history?from=${encodeURIComponent(fmt(fromDate))}&to=${encodeURIComponent(fmt(toDate))}`;
    const resp = await fetch(url, {
      headers: { 'x-pbx-authentication': apiKey, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      console.error('[pbx-sync] API error:', resp.status, await resp.text().catch(() => ''));
      return { synced: 0, skipped: false };
    }
    const json = await resp.json() as { data?: unknown[] };
    const calls = Array.isArray(json.data) ? json.data : [];
    for (const call of calls) {
      const c = call as Record<string, unknown>;
      const callUuid = String(c.uuid ?? c.id ?? '');
      if (!callUuid) continue;

      // Insert event record
      const { data: evRow } = await supabase
        .from('pbx_events')
        .insert({
          branch_id: BRANCH_ID, event: 'api_history', call_uuid: callUuid,
          payload: c, processed: false,
        })
        .select('id')
        .maybeSingle();
      if (evRow) {
        await processPbxEvent(String(evRow.id), 'api_history', callUuid, c);
        synced++;
      }
    }
  } catch (e) {
    console.error('[pbx-sync] error:', (e as Error).message);
  }
  return { synced, skipped: false };
}
