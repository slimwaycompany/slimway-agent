import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../db/supabase';
import { getSession, getSessionWithPerms, requirePerm, requireAdmin } from './auth';
import { postToControlSheet } from '../jobs/controlSheetSync';

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const COOKIE_NAME = 'sw_device';
const TZ_MS = 5 * 3600_000;

function yekNow() { return new Date(Date.now() + TZ_MS); }
function yekToday() {
  const d = yekNow();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function yekHHMM(isoOrDate: string | Date) {
  const d = typeof isoOrDate === 'string' ? new Date(new Date(isoOrDate).getTime() + TZ_MS) : new Date(isoOrDate.getTime() + TZ_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function yekDateDDMMYYYY(isoOrDate: string | Date) {
  const d = typeof isoOrDate === 'string' ? new Date(new Date(isoOrDate).getTime() + TZ_MS) : new Date(isoOrDate.getTime() + TZ_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

function readCookieHeader(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || '';
  const part = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : undefined;
}

function getSecret(): string {
  return process.env.WINDOW_SECRET || process.env.CRON_SECRET || 'default';
}

function signDeviceId(id: string): string {
  return crypto.createHmac('sha256', getSecret()).update(id).digest('hex').slice(0, 16);
}

function setCookieValue(id: string): string {
  return `${id}.${signDeviceId(id)}`;
}

function parseDeviceCookie(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf('.');
  if (dot < 1) return null;
  const id  = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (sig !== signDeviceId(id)) return null;
  return id;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Look up trusted device by cookie, return device row or null
async function getTrustedDevice(req: Request): Promise<Record<string, unknown> | null> {
  const raw = readCookieHeader(req, COOKIE_NAME) ?? req.headers['x-sw-device'];
  const deviceId = parseDeviceCookie(typeof raw === 'string' ? raw : undefined);
  if (!deviceId) return null;

  const { data } = await supabase
    .from('control_trusted_devices')
    .select('*')
    .eq('id', deviceId)
    .eq('branch_id', BRANCH_ID)
    .eq('is_active', true)
    .maybeSingle();
  return data ?? null;
}

// Get today's schedule for a user (fact preferred over plan)
async function getTodaySchedule(userName: string): Promise<{
  start: string | null; end: string | null; role: 'call_center' | 'consultant' | null
} | null> {
  const today = yekToday();
  const { data } = await supabase
    .from('control_shift_schedule')
    .select('plan_start,plan_end,fact_start,fact_end,role')
    .eq('branch_id', BRANCH_ID)
    .eq('shift_date', today)
    .eq('user_name', userName)
    .maybeSingle();
  if (!data) return null;
  const start = (data.fact_start || data.plan_start) as string | null;
  const end   = (data.fact_end   || data.plan_end)   as string | null;
  const role  = (data.role as 'call_center' | 'consultant' | null) ?? null;
  return { start, end, role };
}

// Get arrive_before_minutes setting
async function getArriveBeforeMinutes(): Promise<number> {
  const { data } = await supabase
    .from('control_settings')
    .select('value')
    .eq('branch_id', BRANCH_ID)
    .eq('key', 'arrive_before_minutes')
    .maybeSingle();
  return Number((data?.value as number) ?? 15);
}

// Get display_names of staff that have certain positions
async function getCheckinHiddenPositions(): Promise<string[]> {
  const { data: setting } = await supabase
    .from('control_settings')
    .select('value')
    .eq('branch_id', BRANCH_ID)
    .eq('key', 'checkin_mobile_hidden_positions')
    .maybeSingle();
  const posIds: string[] = Array.isArray(setting?.value) ? (setting!.value as string[]) : [];
  if (!posIds.length) return [];

  const { data: positions } = await supabase
    .from('app_positions')
    .select('id,name')
    .in('id', posIds);
  return (positions ?? []).map(p => String(p.name));
}

// Upload base64 JPEG to shift-photos bucket
async function uploadPhoto(base64: string, userId: string, type: 'in' | 'out'): Promise<string> {
  const buf = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buf.byteLength > 500_000) throw new Error('Фото слишком большое (макс. 500 КБ)');

  const today = yekToday();
  const hhmm  = yekHHMM(new Date());
  const timeStr = hhmm.replace(':', '');
  const path = `${today}/${userId}_${type}_${timeStr}.jpg`;

  const { error } = await supabase.storage
    .from('shift-photos')
    .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`Ошибка загрузки фото: ${error.message}`);
  return path;
}

// Get short-lived signed URL for a photo path
async function getPhotoUrl(path: string, seconds = 7 * 24 * 3600): Promise<string> {
  const { data } = await supabase.storage.from('shift-photos').createSignedUrl(path, seconds);
  return data?.signedUrl ?? '';
}

export function buildCheckinRouter(): Router {
  const r = Router();

  // ── Trusted devices (admin only) ──────────────────────────────────────────

  r.get('/kviz/api/checkin/devices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('control_trusted_devices')
        .select('id,name,is_active,created_by,created_at,last_seen_at')
        .eq('branch_id', BRANCH_ID)
        .order('created_at');
      if (error) { res.status(500).json({ error: error.message }); return; }
      // Mark which is current
      const rawCookie = readCookieHeader(req, COOKIE_NAME);
      const currentDeviceId = parseDeviceCookie(rawCookie);
      res.json((data ?? []).map(d => ({
        ...d, is_current: String(d.id) === currentDeviceId,
      })));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Register this computer as trusted (admin only, sets cookie)
  r.post('/kviz/api/checkin/register', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const s = getSession(req)!;
    const name = String((req.body as Record<string, unknown>).name ?? '').trim();
    if (!name) { res.status(400).json({ error: 'Введите название компьютера' }); return; }

    try {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);

      const { data, error } = await supabase
        .from('control_trusted_devices')
        .insert({
          branch_id: BRANCH_ID, name, token_hash: tokenHash,
          is_active: true, created_by: s.display_name,
        })
        .select('id')
        .single();
      if (error || !data) { res.status(500).json({ error: error?.message ?? 'Ошибка' }); return; }

      const cookieValue = setCookieValue(String(data.id));
      const maxAge = 2 * 365 * 24 * 3600; // 2 years
      res.setHeader('Set-Cookie', [
        `${COOKIE_NAME}=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      ]);
      res.json({ ok: true, id: data.id, name });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Deactivate device (admin only)
  r.delete('/kviz/api/checkin/devices/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { error } = await supabase
        .from('control_trusted_devices')
        .update({ is_active: false })
        .eq('id', req.params.id)
        .eq('branch_id', BRANCH_ID);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Check if this computer is trusted (for UI)
  r.get('/kviz/api/checkin/device-status', async (req, res) => {
    if (!getSession(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const s = getSession(req)!;
    try {
      const device = await getTrustedDevice(req);
      const hiddenPositions = await getCheckinHiddenPositions();

      // Get user's position name
      const { data: user } = await supabase
        .from('app_users')
        .select('position_id, app_positions(name)')
        .eq('id', s.id)
        .maybeSingle();
      const posName: string = (user as Record<string, unknown> | null)?.['app_positions']
        ? String(((user as Record<string, unknown>)['app_positions'] as Record<string,unknown>).name)
        : '';

      const hideOnMobile = hiddenPositions.includes(posName);

      res.json({
        trusted: !!device,
        device_name: device ? String(device.name) : null,
        hide_on_mobile: hideOnMobile,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── Check-in mark (Пришла / Ушла) ─────────────────────────────────────────

  r.post('/kviz/api/checkin/mark', async (req, res) => {
    const s = getSession(req);
    if (!s) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const body = req.body as Record<string, unknown>;
    const type = String(body.type ?? '');
    if (type !== 'in' && type !== 'out') {
      res.status(400).json({ error: 'type должен быть in или out' }); return;
    }

    const device = await getTrustedDevice(req);
    if (!device) {
      res.status(403).json({ error: 'Отметиться можно только с компьютера студии' }); return;
    }

    const photoBase64 = String(body.photo ?? '');
    if (!photoBase64) {
      res.status(400).json({ error: 'Фото обязательно' }); return;
    }

    try {
      const now = new Date().toISOString();
      const today = yekToday();

      // Get or create today's shift for this user
      const { data: existingShift } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('user_id', s.id)
        .eq('shift_date', today)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Upload photo
      const photoPath = await uploadPhoto(photoBase64, String(s.id), type);

      // Get schedule for role + late/early calculation
      const schedule = await getTodaySchedule(s.display_name);
      const arriveBeforeMin = await getArriveBeforeMinutes();

      // Determine role
      let role: 'call_center' | 'consultant' | null = schedule?.role ?? null;
      if (!role && body.role) {
        const r = String(body.role);
        if (r === 'call_center' || r === 'consultant') role = r;
      }
      if (!role && type === 'in') {
        // Role not in schedule and not provided — UI should require it
        res.status(400).json({ error: 'Укажите роль (call center или консультант)', require_role: true }); return;
      }

      // Calculate late/early minutes
      let lateMinutes: number | null = null;
      let leftEarlyMinutes: number | null = null;

      if (type === 'in' && schedule?.start) {
        // Late = actual arrival - (scheduled start - arrive_before_min)
        const scheduledStart = new Date(`${today}T${schedule.start}:00+05:00`).getTime();
        const dueAt = scheduledStart - arriveBeforeMin * 60_000;
        const arrivedAt = new Date(now).getTime();
        lateMinutes = arrivedAt > dueAt ? Math.round((arrivedAt - dueAt) / 60_000) : 0;
      }
      if (type === 'out' && schedule?.end) {
        const scheduledEnd = new Date(`${today}T${schedule.end}:00+05:00`).getTime();
        const leftAt = new Date(now).getTime();
        leftEarlyMinutes = leftAt < scheduledEnd ? Math.round((scheduledEnd - leftAt) / 60_000) : 0;
      }

      // Update or create shift
      const ip = req.ip ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? null;
      let shiftId: string | null = null;

      if (type === 'in') {
        if (existingShift && existingShift.status === 'open') {
          // Already open — update with photo and check-in details
          const { data: updated, error } = await supabase
            .from('staff_shifts')
            .update({
              photo_in_path: photoPath, role, device_id: String(device.id),
              late_minutes: lateMinutes, ip,
            })
            .eq('id', existingShift.id)
            .select('id').single();
          if (error) { res.status(500).json({ error: error.message }); return; }
          shiftId = String(updated.id);
        } else {
          // Create new shift
          const { data: newShift, error } = await supabase
            .from('staff_shifts')
            .insert({
              user_id: s.id, user_name: s.display_name, shift_date: today,
              started_at: now, status: 'open', role, device_id: String(device.id),
              photo_in_path: photoPath, late_minutes: lateMinutes, ip,
              sheet_synced_start: false, sheet_synced_end: false,
            })
            .select('id').single();
          if (error) { res.status(500).json({ error: error.message }); return; }
          shiftId = String(newShift.id);
        }
      } else {
        // out
        if (!existingShift || existingShift.status !== 'open') {
          res.status(409).json({ error: 'Нет открытой смены — сначала нажмите «Пришла»' }); return;
        }
        const { error } = await supabase
          .from('staff_shifts')
          .update({
            ended_at: now, status: 'closed',
            photo_out_path: photoPath, left_early_minutes: leftEarlyMinutes,
          })
          .eq('id', existingShift.id);
        if (error) { res.status(500).json({ error: error.message }); return; }
        shiftId = String(existingShift.id);
      }

      // Update device last_seen_at
      await supabase.from('control_trusted_devices')
        .update({ last_seen_at: now })
        .eq('id', String(device.id));

      // Write to control_shift_marks
      const markData = {
        branch_id: BRANCH_ID, shift_date: today, user_name: s.display_name,
        marked_at: now, source: 'staff_shifts',
      };
      await supabase.from('control_shift_marks').upsert(markData, { onConflict: 'branch_id,shift_date,user_name', ignoreDuplicates: false });

      // Get photo signed URL for Google Sheet
      let photoUrl = '';
      try {
        photoUrl = await getPhotoUrl(photoPath);
      } catch { /* non-fatal */ }

      // Get staff_name_map for full name
      const { data: nameMapCfg } = await supabase
        .from('control_settings')
        .select('value')
        .eq('branch_id', BRANCH_ID)
        .eq('key', 'staff_name_map')
        .maybeSingle();
      const nameMap = (nameMapCfg?.value ?? {}) as Record<string, string>;
      // Reverse map: display_name → full name for Google
      const fullName = Object.entries(nameMap).find(([, v]) => v === s.display_name)?.[0] ?? s.display_name;

      const roleLabel = role === 'call_center' ? 'КЦ' : role === 'consultant' ? 'КОНС' : '';
      const typeLabel = type === 'in' ? 'Приход' : 'Уход';

      try {
        await postToControlSheet({
          action: 'mark',
          date: yekDateDDMMYYYY(now),
          time: yekHHMM(now),
          branch: 'Казына',
          name: fullName,
          photo: photoUrl,
          type: typeLabel,
          role: roleLabel,
          shift_id: shiftId ?? '',
        });
      } catch (e) {
        console.warn('[checkin] postToControlSheet mark failed:', (e as Error).message);
        // Mark sheet as unsynced on the shift
        if (shiftId) {
          const unsynced: Record<string, boolean> = {};
          if (type === 'in')  unsynced.sheet_synced_start = false;
          if (type === 'out') unsynced.sheet_synced_end   = false;
          await supabase.from('staff_shifts').update(unsynced).eq('id', shiftId);
        }
      }

      res.json({
        ok: true, type, role, late_minutes: lateMinutes, left_early_minutes: leftEarlyMinutes,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
