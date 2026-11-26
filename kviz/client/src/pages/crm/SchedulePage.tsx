import { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { CalendarPlus, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PermContext, usePerm } from '../../lib/permContext';
import { toast } from '../../lib/toast';
import { showConfirm } from '../../lib/confirm';
import { itemLabel } from '../../utils/planItemLabel';
import { planMatchesSlot } from '../../lib/planRestriction';
import { ClientPopup } from './ClientsPage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdSource { id: string; name: string; requires_referrer: boolean; is_active: boolean }
interface DeviceInfo { id: string; number: string; status: string; session_minutes: number | null }
interface VirtualDevice { id: string; number: string }
interface DayBlock {
  type_code: string; name: string; grid_step_minutes: number;
  devices: DeviceInfo[];
  virtual_devices?: VirtualDevice[];
}
interface BookingLabel { id: number; name: string; color: string; sort: number; short_name?: string | null }
interface AutoLabelData { code: string; name: string; short_name: string; color: string; sort: number }
interface ClientTagData { id: string; name: string; color: string }
interface BookingData {
  id: string; group_id: string; booking_date: string;
  starts_at: string; ends_at: string;
  device_id: string; device_type_code: string;
  client_id: string; kind: string;
  client_plan_id: string | null; client_plan_item_id: string | null;
  plan_id: string | null; phase: string | null; status: string;
  session_burned: boolean; note: string | null; trainer: string | null;
  cancel_reason: string | null;
  client: { full_name: string; phone: string | null } | null;
  plan_name: string | null;
  sessions_left: number | null; sessions_total: number | null;
  labels: BookingLabel[];
  auto_labels: AutoLabelData[];
  client_tags: ClientTagData[];
}
interface NearbyBooking {
  id: string; booking_date: string; starts_at: string;
  device_type_code: string; status: string;
  client: { full_name: string; phone: string | null } | null;
}
interface DayData {
  date: string; day_start: string; day_end: string; now: string;
  blocks: DayBlock[]; bookings: BookingData[]; is_open?: boolean;
  special_day?: { is_open: boolean; note: string | null } | null;
}
interface DayNote { id: string; text: string; author: string; author_user_id: string; created_at: string; edited: boolean; can_edit: boolean }
interface ClientOption {
  id: string; plan_id: string; status: string;
  valid_until: string | null; extra_until: string | null;
  allowed_weekdays?: number[] | null; time_from?: string | null; time_to?: string | null;
  crm_plans: { id: string; name: string } | null;
  items: { id: string; device_type_code: string | null; device_type_codes?: string[] | null; phase: string; sessions_left: number | null; sessions_total: number | null; is_unlimited?: boolean; daily_limit?: number | null; booked_ahead: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string { return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); }
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function minsToStr(m: number): string { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
function strToMins(s: string): number { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function getSlots(start: string, end: string, step: number): string[] {
  const s = strToMins(start), e = strToMins(end);
  const r: string[] = [];
  for (let t = s; t + step <= e; t += step) r.push(minsToStr(t));
  return r;
}
function bookingSlotTime(startsAt: string): string {
  const d = new Date(new Date(startsAt).getTime() + 5 * 3600_000);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
function bookingTimeMins(isoStr: string): number {
  const d = new Date(new Date(isoStr).getTime() + 5 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function bookingDurationMins(b: BookingData): number {
  return Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000);
}
function nowLineOffset(dayStart: string): number | null {
  const d = new Date(Date.now() + 5 * 3600_000);
  const nowMins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const startMins = strToMins(dayStart);
  if (nowMins < startMins) return null;
  return (nowMins - startMins) * PX_PER_MIN;
}
function cardBgColor(b: BookingData): string | null {
  return b.labels[0]?.color ?? b.auto_labels[0]?.color ?? null;
}
function textOnHex(hex: string | null): string {
  if (!hex) return 'var(--text)';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255) > 0.4 ? '#1a202c' : '#ffffff';
}
function fmtWeekday(iso: string): string {
  const d = new Date(iso + 'T12:00:00+05:00');
  const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()];
}
async function apiJ(method: string, url: string, body?: unknown) {
  const o: RequestInit = { method, credentials: 'include' };
  if (body) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body); }
  const r = await fetch(url, o);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

const STATUS_ICON: Record<string, string> = {
  booked: '?', confirmed: '✓', attended: '✓✓', no_show: '×', late_cancel: '×', cancelled: '×',
};
const STATUS_LABEL: Record<string, string> = {
  booked: 'Записан', confirmed: 'Подтверждено', attended: 'Пришёл',
  no_show: 'Не пришёл', late_cancel: 'Поздняя отмена', cancelled: 'Отменена',
};
const STATUS_RU: Record<string, string> = { active: 'активен', not_activated: 'не активирован' };

// ── Layout constants ──────────────────────────────────────────────────────────

const PX_PER_MIN = 1.9;
const TIME_W = 44;
const DEV_W  = 96;
const HDR_H  = 26;
const BLK_H  = 32;

// ── LabelBadge ───────────────────────────────────────────────────────────────

function LabelBadge({ label, onCard }: { label: BookingLabel; onCard: boolean }) {
  const fg = textOnHex(label.color);
  const border = onCard ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(0,0,0,0.15)';
  return (
    <span title={label.name} style={{
      display: 'inline-block', background: label.color, color: fg,
      height: 14, padding: '0 4px', borderRadius: 3,
      fontWeight: 700, fontSize: 9, lineHeight: '14px',
      border, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {label.short_name ?? label.name.slice(0, 4)}
    </span>
  );
}

// ── BookingCard ───────────────────────────────────────────────────────────────

function BookingCard({ b, showTime }: { b: BookingData; showTime?: boolean }) {
  const bg = cardBgColor(b);
  const isRed = ['no_show', 'late_cancel', 'cancelled'].includes(b.status);
  const cardBg = isRed ? '#7f1d1d' : (bg ?? 'var(--surface)');
  const cardFg = isRed ? '#ffffff' : textOnHex(bg);
  const hasColorBg = isRed || !!bg;

  // All chips: booking labels → client tags → auto labels; show max 3, "+N" for overflow
  const allChips = [
    ...b.labels.map(l => ({ key: `l${l.id}`, name: l.name, short: l.short_name ?? l.name.slice(0, 4), color: l.color })),
    ...(b.client_tags || []).map(t => ({ key: `t${t.id}`, name: t.name, short: t.name.slice(0, 2), color: t.color })),
    ...(b.auto_labels || []).map(a => ({ key: `a${a.code}`, name: a.name, short: a.short_name, color: a.color })),
  ];
  const shown = allChips.slice(0, 3);
  const overflow = allChips.length > 3 ? allChips.length - 3 : 0;
  const overflowTitle = overflow > 0 ? allChips.slice(3).map(c => c.name).join(', ') : '';

  return (
    <div style={{ background: cardBg, borderRadius: 4, padding: '2px 4px', height: '100%', boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer' }}>
      <div style={{ fontWeight: 700, fontSize: 11, color: cardFg, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3 }}>
        {b.client?.full_name ?? '—'}
      </div>
      {b.note && <div style={{ fontSize: 10, color: cardFg, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.note}</div>}
      <div style={{ fontSize: 10, color: cardFg, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {b.plan_name ?? (b.kind === 'free' ? '⚡ Бесплатно' : '—')}
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: cardFg, opacity: 0.9 }} title={STATUS_LABEL[b.status]}>{STATUS_ICON[b.status]}</span>
          {shown.map(c => (
            <span key={c.key} title={c.name} style={{
              display: 'inline-block', background: c.color, color: textOnHex(c.color),
              height: 14, padding: '0 4px', borderRadius: 3,
              fontWeight: 700, fontSize: 9, lineHeight: '14px',
              border: hasColorBg ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>{c.short}</span>
          ))}
          {overflow > 0 && (
            <span title={overflowTitle} style={{
              display: 'inline-block', background: 'rgba(0,0,0,0.25)', color: cardFg,
              height: 14, padding: '0 4px', borderRadius: 3,
              fontWeight: 700, fontSize: 9, lineHeight: '14px', flexShrink: 0,
            }}>+{overflow}</span>
          )}
        </div>
        {showTime && (
          <span style={{ fontSize: 9, color: cardFg, opacity: 0.7, flexShrink: 0 }}>{bookingSlotTime(b.starts_at)}</span>
        )}
      </div>
    </div>
  );
}

// ── BookingFormPanel ──────────────────────────────────────────────────────────

function BookingFormPanel({
  ctx, date, dayData, displayName, onClose, onDone,
}: {
  ctx: { type_code: string; slot?: string; device_id?: string; freeTime?: boolean; isVirtualDevice?: boolean };
  date: string; dayData: DayData; displayName: string;
  onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode]           = useState<'plan' | 'free'>('plan');
  const [clientQ, setClientQ]     = useState('');
  const [clients, setClients]     = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  const [selClient, setSelClient] = useState<{ id: string; full_name: string } | null>(null);
  const [options, setOptions]     = useState<{ plans: ClientOption[]; free_services: { id: string; name: string }[] } | null>(null);
  const [planId, setPlanId]       = useState('');
  const [serviceId, setServiceId] = useState('');
  const [slot, setSlot]           = useState(ctx.slot ?? '');
  const [deviceTypeCode, setDeviceTypeCode] = useState(ctx.type_code);
  const [device, setDevice]       = useState(ctx.device_id ?? '');
  const [finDeviceTypeCode, setFinDeviceTypeCode] = useState('');
  const [note, setNote]           = useState('');
  const [trainer, setTrainer]     = useState(displayName);
  const [users, setUsers]         = useState<{ display_name: string }[]>([]);
  const [withFin, setWithFin]     = useState(true);
  const [suggestions, setSuggestions] = useState<{ date: string; time: string }[]>([]);
  const [saving, setSaving]       = useState(false);
  const qRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const block = dayData.blocks.find(b => b.type_code === ctx.type_code)!;
  const slots = block ? getSlots(dayData.day_start, dayData.day_end, block.grid_step_minutes) : [];
  const freeTime = !!ctx.freeTime;

  useEffect(() => { fetch('/kviz/api/crm/users', { credentials: 'include' }).then(r => r.json()).then(setUsers).catch(() => {}); }, []);

  useEffect(() => {
    if (!selClient) { setOptions(null); setPlanId(''); return; }
    apiJ('GET', `/kviz/api/crm/schedule/client-options?client_id=${selClient.id}`)
      .then(({ ok, data }) => { if (ok) setOptions(data as typeof options); });
  }, [selClient]);

  useEffect(() => {
    if (!options) return;
    const mp = options.plans.filter(p =>
      p.items.some(it =>
        it.device_type_code === ctx.type_code ||
        (Array.isArray(it.device_type_codes) && it.device_type_codes.includes(ctx.type_code))
      )
    );
    if (mp.length === 1) setPlanId(mp[0].id);
  }, [options]);

  function searchClients(q: string) {
    if (qRef.current) clearTimeout(qRef.current);
    if (!q.trim()) { setClients([]); return; }
    qRef.current = setTimeout(async () => {
      const { ok, data } = await apiJ('GET', `/kviz/api/crm/clients?search=${encodeURIComponent(q)}&limit=8`);
      if (ok) setClients((data as { items: typeof clients }).items ?? []);
    }, 300);
  }

  const dtNameMap = Object.fromEntries(dayData.blocks.map(b => [b.type_code, b.name]));
  const selPlan = options?.plans.find(p => p.id === planId);
  const matchItem = selPlan?.items.find(it =>
    it.device_type_code === deviceTypeCode ||
    (Array.isArray(it.device_type_codes) && it.device_type_codes.includes(deviceTypeCode)));
  const isCrossPool = !!matchItem && Array.isArray(matchItem.device_type_codes) && matchItem.device_type_codes.length > 0;
  const poolTypes = isCrossPool ? (matchItem?.device_type_codes ?? []) as string[] : [];
  const finishingItem = selPlan?.items.find(it => it.phase === 'finishing' && ((it.sessions_left ?? 0) > 0 || it.is_unlimited));
  const hasFinishing = !!finishingItem;
  const hasFinishingPool = hasFinishing && Array.isArray(finishingItem?.device_type_codes) && (finishingItem?.device_type_codes?.length ?? 0) > 0;
  const finPoolTypes = hasFinishingPool ? (finishingItem!.device_type_codes as string[]) : [];
  const matchingPlans = (options?.plans ?? []).filter(p =>
    p.items.some(it =>
      it.device_type_code === ctx.type_code ||
      (Array.isArray(it.device_type_codes) && it.device_type_codes.includes(ctx.type_code))
    )
  );

  // All device options for selector (real + virtual for this block type)
  const realDevices = (dayData.blocks.find(b => b.type_code === deviceTypeCode)?.devices ?? []).filter(d => d.status === 'working');
  const virtDevices = (dayData.blocks.find(b => b.type_code === ctx.type_code)?.virtual_devices ?? []);

  async function submit() {
    if (!selClient) { toast.error('Выберите клиента'); return; }
    if (!slot) { toast.error('Выберите время'); return; }
    if (mode === 'plan' && !planId) { toast.error('Выберите абонемент'); return; }
    if (mode === 'free' && !serviceId) { toast.error('Выберите услугу'); return; }

    // Validate free-time bounds
    if (freeTime) {
      const slotMins = strToMins(slot);
      const dayStartMins = strToMins(dayData.day_start);
      const dayEndMins = strToMins(dayData.day_end);
      const step = block?.grid_step_minutes ?? 40;
      if (slotMins < dayStartMins || slotMins + step > dayEndMins) {
        toast.error('Время вне рабочих часов');
        return;
      }
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      client_id: selClient.id,
      kind: mode,
      device_type_code: deviceTypeCode,
      date,
      time: slot,
      with_finishing: withFin,
      note: note || null,
      trainer: trainer || null,
    };
    if (device) payload.device_id = device;
    if (matchItem) payload.client_plan_item_id = matchItem.id;
    if (finDeviceTypeCode) payload.finishing_device_type_code = finDeviceTypeCode;
    if (mode === 'plan') { payload.client_plan_id = planId; }
    else { payload.plan_id = serviceId; }
    const { ok, data } = await apiJ('POST', '/kviz/api/crm/schedule/bookings', payload);
    setSaving(false);
    if (ok) { toast.success('Запись создана'); onDone(); }
    else {
      const errMsg = (data as { error: string }).error;
      if (ctx.isVirtualDevice && errMsg?.includes('NO_FINISHING_SLOT')) {
        toast.error('Все реальные аппараты завершающей заняты — поставьте галочку "Без завершающей" и запишите завершающую отдельно (можно на доп. колонку)');
      } else {
        toast.error(errMsg);
      }
      if ((data as { needs_suggest?: boolean }).needs_suggest) {
        const sq = await apiJ('GET', `/kviz/api/crm/schedule/suggest?client_plan_id=${planId}&type=${ctx.type_code}&date=${date}&time=${slot}`);
        if (sq.ok) setSuggestions(sq.data as typeof suggestions);
      }
    }
  }

  return (
    <div style={SS.panelOverlay} onClick={onClose}>
      <div className="sched-panel" style={SS.panel} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            {freeTime ? '📅+ Запись · ' : 'Новая запись · '}{block?.name}
          </h3>
          <button style={SS.iconBtn} onClick={onClose}>✕</button>
        </div>

        {/* Client search */}
        <label style={SS.lbl}>Клиент</label>
        {selClient
          ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{selClient.full_name}</span>
              <button style={SS.smallBtn} onClick={() => { setSelClient(null); setOptions(null); setPlanId(''); }}>Сменить</button>
            </div>
          : <div style={{ marginBottom: 10 }}>
              <input style={SS.inp} placeholder="Поиск по имени или телефону…" value={clientQ}
                onChange={e => { setClientQ(e.target.value); searchClients(e.target.value); }} />
              {clients.length > 0 && (
                <div style={SS.dropdown}>
                  {clients.map(c => (
                    <div key={c.id} style={SS.dropItem} onClick={() => { setSelClient(c); setClientQ(''); setClients([]); }}>
                      {c.full_name} {c.phone ? <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{c.phone}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
        }

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button style={{ ...SS.tabBtn, ...(mode === 'plan' ? SS.tabBtnActive : {}) }} onClick={() => setMode('plan')}>По абонементу</button>
          <button style={{ ...SS.tabBtn, ...(mode === 'free' ? SS.tabBtnActive : {}) }} onClick={() => setMode('free')}>Бесплатно</button>
        </div>

        {/* Plan selection */}
        {mode === 'plan' && options && (
          <>
            {matchingPlans.length === 0
              ? <div style={SS.warn}>Нет абонемента с этим аппаратом. <a href="#" onClick={(e) => { e.preventDefault(); window.location.href = '/kviz/crm/cashier'; }}>Открыть Кассу</a></div>
              : <div style={{ marginBottom: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                  {matchingPlans.map(p => {
                    const pItem = p.items.find(it =>
                      it.device_type_code === ctx.type_code ||
                      (Array.isArray(it.device_type_codes) && it.device_type_codes.includes(ctx.type_code)));
                    const sessInfo = pItem
                      ? (pItem.is_unlimited ? '∞' : `${pItem.sessions_left ?? '?'} из ${pItem.sessions_total ?? '?'}`)
                      : '';
                    const reason = planMatchesSlot(p, date, slot);
                    const isSel  = planId === p.id;
                    return (
                      <div key={p.id} onClick={() => setPlanId(p.id)}
                        style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          background: isSel ? 'var(--primary-soft)' : 'transparent',
                          opacity: reason ? 0.5 : 1 }}>
                        <div style={{ fontSize: 13, fontWeight: isSel ? 600 : 400 }}>
                          {p.crm_plans?.name} · {STATUS_RU[p.status] ?? p.status} · {sessInfo}
                        </div>
                        {reason && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{reason}</div>}
                      </div>
                    );
                  })}
                </div>
            }
            {slot && matchingPlans.length > 0 && matchingPlans.every(p => !!planMatchesSlot(p, date, slot)) && (
              <div style={SS.warn}>На это время у клиента нет подходящего абонемента</div>
            )}
            {hasFinishing && (
              <label style={SS.checkLabel}>
                <input type="checkbox" checked={withFin} onChange={e => setWithFin(e.target.checked)} />
                + завершающая (аппарат подберётся сам)
              </label>
            )}
          </>
        )}
        {mode === 'free' && options && (
          <select style={SS.inp} value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">— выберите услугу —</option>
            {options.free_services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {/* Time */}
        <label style={SS.lbl}>Время</label>
        {freeTime
          ? <input type="time" step={60} style={SS.inp} value={slot} onChange={e => setSlot(e.target.value)} />
          : <select style={SS.inp} value={slot} onChange={e => setSlot(e.target.value)}>
              <option value="">— время —</option>
              {slots.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
        }

        {/* Вид аппарата (Cross pool) */}
        {mode === 'plan' && isCrossPool && (
          <>
            <label style={SS.lbl}>Вид аппарата</label>
            <select style={SS.inp} value={deviceTypeCode} onChange={e => { setDeviceTypeCode(e.target.value); setDevice(''); }}>
              {poolTypes.map(tc => (
                <option key={tc} value={tc}>{dtNameMap[tc] ?? tc}</option>
              ))}
            </select>
          </>
        )}
        {/* Аппарат */}
        <label style={SS.lbl}>Аппарат (необязательно)</label>
        <select style={SS.inp} value={device} onChange={e => setDevice(e.target.value)}>
          <option value="">Автоматически</option>
          {realDevices.map(d => (
            <option key={d.id} value={d.id}>{dtNameMap[deviceTypeCode] ?? deviceTypeCode} {d.number}</option>
          ))}
          {virtDevices.map(d => (
            <option key={d.id} value={d.id}>Доп. {d.number} (сверх)</option>
          ))}
        </select>
        {/* Аппарат завершающей фазы */}
        {mode === 'plan' && hasFinishingPool && (
          <>
            <label style={SS.lbl}>Аппарат завершающей фазы</label>
            <select style={SS.inp} value={finDeviceTypeCode} onChange={e => setFinDeviceTypeCode(e.target.value)}>
              <option value="">Автоматически</option>
              {finPoolTypes.map(tc => (
                <option key={tc} value={tc}>{dtNameMap[tc] ?? tc}</option>
              ))}
            </select>
          </>
        )}

        {/* Trainer + Note */}
        <label style={SS.lbl}>Тренер</label>
        <select style={SS.inp} value={trainer} onChange={e => setTrainer(e.target.value)}>
          {users.map(u => <option key={u.display_name} value={u.display_name}>{u.display_name}</option>)}
        </select>
        <label style={SS.lbl}>Заметка</label>
        <input style={SS.inp} value={note} onChange={e => setNote(e.target.value)} placeholder="Необязательно" />

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Ближайшие свободные слоты:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {suggestions.map(s => (
                <button key={s.date+s.time} style={SS.smallBtn} onClick={() => { setSlot(s.time); setSuggestions([]); }}>
                  {s.date !== date ? s.date + ' ' : ''}{s.time}
                </button>
              ))}
            </div>
          </div>
        )}

        <button style={{ ...SS.submitBtn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={submit}>
          {saving ? 'Создаём…' : 'Записать'}
        </button>
      </div>
    </div>
  );
}

// ── BookingDetailModal ────────────────────────────────────────────────────────

function BookingDetailModal({
  booking, allBookings, canBook, canAttend, canRescheduleFuture, isAdmin,
  onClose, onDone, onRefresh, onClientPopup,
}: {
  booking: BookingData; allBookings: BookingData[];
  canBook: boolean; canAttend: boolean; canRescheduleFuture: boolean; isAdmin: boolean;
  onClose: () => void; onDone: (changed: boolean) => void; onRefresh: () => void;
  onClientPopup: () => void;
}) {
  const [labels, setLabels]       = useState<{ id: number; name: string; color: string; short_name?: string | null; sort: number; is_active: boolean }[]>([]);
  const [selLabels, setSelLabels] = useState(new Set(booking.labels.map(l => l.id)));
  const [note, setNote]           = useState(booking.note ?? '');
  const [trainer, setTrainer]     = useState(booking.trainer ?? '');
  const [users, setUsers]         = useState<{ display_name: string }[]>([]);
  const [busy, setBusy]           = useState<string | null>(null);
  const [onlyThis, setOnlyThis]   = useState(false);
  const [showMove, setShowMove]   = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [moveDate, setMoveDate]   = useState(booking.booking_date);
  const [moveTime, setMoveTime]   = useState(bookingSlotTime(booking.starts_at));
  const [cancelReason, setCancelReason] = useState('');
  const [forceEarly, setForceEarly]     = useState(false);

  const group = allBookings.filter(b => b.group_id === booking.group_id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  useEffect(() => {
    apiJ('GET', '/kviz/api/crm/booking-labels').then(({ ok, data }) => { if (ok) setLabels(data as typeof labels); });
    fetch('/kviz/api/crm/users', { credentials: 'include' }).then(r => r.json()).then(setUsers).catch(() => {});
  }, []);

  async function setStatus(status: string) {
    setBusy(status);
    const { ok, data } = await apiJ('POST', `/kviz/api/crm/schedule/bookings/${booking.id}/status`, { status, only_this: onlyThis });
    setBusy(null);
    if (ok) { toast.success('Статус обновлён'); onDone(true); }
    else toast.error((data as { error: string }).error);
  }

  async function saveLabels() {
    const { ok, data } = await apiJ('PUT', `/kviz/api/crm/schedule/bookings/${booking.id}/labels`, { label_ids: [...selLabels] });
    if (!ok) toast.error((data as { error: string }).error);
  }

  async function saveNote() {
    const { ok, data } = await apiJ('PATCH', `/kviz/api/crm/schedule/bookings/${booking.id}`, { note, trainer });
    if (ok) { toast.success('Сохранено'); onRefresh(); }
    else toast.error((data as { error: string }).error);
  }

  async function doMove() {
    setBusy('move');
    const { ok, data } = await apiJ('POST', `/kviz/api/crm/schedule/bookings/${booking.id}/move`, { date: moveDate, time: moveTime });
    setBusy(null);
    if (ok) { toast.success('Запись перенесена'); onDone(true); }
    else toast.error((data as { error: string }).error);
  }

  async function doCancel() {
    if (!cancelReason.trim()) { toast.error('Укажите причину отмены'); return; }
    const confirmed = await showConfirm(`Отменить запись?${cancelReason ? `\nПричина: ${cancelReason}` : ''}`);
    if (!confirmed) return;
    setBusy('cancel');
    const { ok, data } = await apiJ('POST', `/kviz/api/crm/schedule/bookings/${booking.id}/cancel`, { reason: cancelReason, force_early: forceEarly });
    setBusy(null);
    if (ok) { toast.success('Запись отменена'); onDone(true); }
    else toast.error((data as { error: string }).error);
  }

  const isCancelled = ['cancelled', 'late_cancel'].includes(booking.status);
  const isAttended  = ['attended', 'no_show'].includes(booking.status);

  return (
    <div style={SS.overlay} onClick={onClose}>
      <div style={{ ...SS.modal, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{booking.client?.full_name ?? '—'}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...SS.smallBtn, fontSize: 11 }} onClick={onClientPopup}>Карточка клиента</button>
            <button style={SS.iconBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Group bookings */}
        <div style={{ marginBottom: 12 }}>
          {group.map(b => (
            <div key={b.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-2)', minWidth: 48 }}>{bookingSlotTime(b.starts_at)}</span>
              <span style={{ flex: 1 }}>{b.device_type_code} · {b.phase === 'active' ? 'А' : b.phase === 'finishing' ? 'З' : '—'}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{STATUS_LABEL[b.status]}</span>
            </div>
          ))}
        </div>

        {/* Plan/sessions info */}
        {booking.plan_name && (
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
            {booking.plan_name}
            {booking.sessions_left !== null && <> · осталось: {booking.sessions_left}/{booking.sessions_total}</>}
          </div>
        )}

        {/* Status buttons */}
        {canAttend && !isCancelled && group.length >= 2 && (
          <label style={SS.checkLabel}>
            <input type="checkbox" checked={onlyThis} onChange={e => setOnlyThis(e.target.checked)} />
            Только эта запись
          </label>
        )}
        {canAttend && !isCancelled && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {!isAttended && booking.status !== 'confirmed' && (
              <button style={SS.smallBtn} disabled={!!busy} onClick={() => setStatus('confirmed')}>Подтверждено</button>
            )}
            {!isAttended && (
              <button style={{ ...SS.smallBtn, background: 'var(--success)', color: '#fff' }} disabled={!!busy} onClick={() => setStatus('attended')}>Пришёл</button>
            )}
            {!isAttended && (
              <button style={{ ...SS.smallBtn, background: 'var(--danger)', color: '#fff' }} disabled={!!busy} onClick={() => setStatus('no_show')}>Не пришёл</button>
            )}
            {isAttended && (
              <button style={SS.smallBtn} disabled={!!busy} onClick={() => setStatus('booked')}>Вернуть в «Записан»</button>
            )}
          </div>
        )}

        {/* Move */}
        {canBook && !isCancelled && !isAttended && (
          <div style={{ marginBottom: 10 }}>
            <button style={SS.smallBtn} onClick={() => setShowMove(!showMove)}>Перенести</button>
            {showMove && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={SS.lbl}>Дата</label>
                  <input type="date" style={SS.inp} value={moveDate} onChange={e => setMoveDate(e.target.value)}
                    {...(!canRescheduleFuture ? { min: todayISO(), max: todayISO() } : {})} />
                </div>
                <div>
                  <label style={SS.lbl}>Время</label>
                  <input type="time" step={60} style={SS.inp} value={moveTime} onChange={e => setMoveTime(e.target.value)} />
                </div>
                <button style={{ ...SS.smallBtn, background: 'var(--primary)', color: '#fff' }} disabled={busy === 'move'} onClick={doMove}>
                  {busy === 'move' ? '…' : 'Перенести'}
                </button>
                {!canRescheduleFuture && <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>Перенос только на сегодня</span>}
              </div>
            )}
          </div>
        )}

        {/* Cancel */}
        {canBook && !isCancelled && (
          <div style={{ marginBottom: 12 }}>
            <button style={{ ...SS.smallBtn, color: 'var(--danger)' }} onClick={() => setShowCancel(!showCancel)}>Отменить…</button>
            {showCancel && (
              <div style={{ marginTop: 8 }}>
                <input style={SS.inp} placeholder="Причина отмены (обязательно)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                {isAdmin && (
                  <label style={SS.checkLabel}>
                    <input type="checkbox" checked={forceEarly} onChange={e => setForceEarly(e.target.checked)} />
                    Считать ранней отменой
                  </label>
                )}
                <button style={{ ...SS.smallBtn, background: 'var(--danger)', color: '#fff', marginTop: 6 }}
                  disabled={busy === 'cancel'} onClick={doCancel}>
                  {busy === 'cancel' ? '…' : 'Подтвердить отмену'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Client auto-labels + tags */}
        {((booking.auto_labels?.length ?? 0) > 0 || (booking.client_tags?.length ?? 0) > 0) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Метки клиента</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(booking.auto_labels || []).map(al => (
                <span key={al.code} style={{ display: 'inline-flex', alignItems: 'center', background: al.color + '22', color: al.color, padding: '2px 8px', borderRadius: 6, border: `1px solid ${al.color}44`, fontSize: 12, fontWeight: 600 }}>
                  {al.name}
                </span>
              ))}
              {(booking.client_tags || []).map(t => (
                <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', background: t.color + '22', color: t.color, padding: '2px 8px', borderRadius: 6, border: `1px solid ${t.color}44`, fontSize: 12, fontWeight: 600 }}>
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Labels */}
        {canBook && labels.filter(l => l.is_active).length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>
              Этикетки{group.length >= 2 ? ' — для обеих записей' : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {labels.filter(l => l.is_active).map(l => (
                <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selLabels.has(l.id)} onChange={e => {
                    setSelLabels(prev => { const s = new Set(prev); e.target.checked ? s.add(l.id) : s.delete(l.id); return s; });
                  }} />
                  <LabelBadge label={l} onCard={false} />
                  {l.name}
                </label>
              ))}
            </div>
            <button style={{ ...SS.smallBtn, marginTop: 6 }} onClick={saveLabels}>Сохранить этикетки</button>
          </div>
        )}

        {/* Note + Trainer */}
        {canBook && (
          <div style={{ marginBottom: 10 }}>
            <label style={SS.lbl}>Заметка</label>
            <input style={SS.inp} value={note} onChange={e => setNote(e.target.value)} />
            <label style={SS.lbl}>Тренер</label>
            <select style={SS.inp} value={trainer} onChange={e => setTrainer(e.target.value)}>
              <option value="">—</option>
              {users.map(u => <option key={u.display_name} value={u.display_name}>{u.display_name}</option>)}
            </select>
            <button style={{ ...SS.smallBtn, marginTop: 4 }} onClick={saveNote}>Сохранить</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SmsDialog ─────────────────────────────────────────────────────────────────

function SmsDialog({ type_code, bookings, onClose }: { type_code: string; bookings: BookingData[]; onClose: () => void }) {
  return (
    <div style={SS.overlay} onClick={onClose}>
      <div style={SS.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Клиенты блока {type_code.toUpperCase()}</h3>
          <button style={SS.iconBtn} onClick={onClose}>✕</button>
        </div>
        {bookings.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Нет записей</div>
          : bookings.map(b => (
            <div key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1 }}>{bookingSlotTime(b.starts_at)} · {b.client?.full_name}</span>
              {b.client?.phone && (
                <a href={`https://wa.me/${b.client.phone}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: '#25D366', textDecoration: 'none', background: '#d1fae5', padding: '2px 8px', borderRadius: 4 }}>
                  WhatsApp
                </a>
              )}
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── NotesPanel ────────────────────────────────────────────────────────────────

function NotesPanel({ date, panelRef, onCountChange }: {
  date: string;
  panelRef: React.RefObject<HTMLDivElement>; onCountChange: (n: number) => void;
}) {
  const [notes, setNotes]       = useState<DayNote[]>([]);
  const [text, setText]         = useState('');
  const [editId, setEditId]     = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving]     = useState(false);
  const listRef                 = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { ok, data } = await apiJ('GET', `/kviz/api/crm/schedule/notes?date=${date}`);
    if (ok) { const ns = data as DayNote[]; setNotes(ns); onCountChange(ns.length); }
  }, [date, onCountChange]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function send() {
    if (!text.trim() || saving) return;
    setSaving(true);
    const { ok, data } = await apiJ('POST', '/kviz/api/crm/schedule/notes', { date, text: text.trim() });
    setSaving(false);
    if (!ok) { toast.error((data as { error: string }).error || 'Ошибка'); return; }
    setText('');
    await load();
    setTimeout(() => listRef.current?.scrollTo(0, listRef.current.scrollHeight), 50);
  }

  async function saveEdit(id: string) {
    if (!editText.trim() || saving) return;
    setSaving(true);
    const { ok, data } = await apiJ('PATCH', `/kviz/api/crm/schedule/notes/${id}`, { text: editText });
    setSaving(false);
    if (!ok) { toast.error((data as { error: string }).error || 'Ошибка'); return; }
    setEditId(null);
    await load();
  }

  async function del(id: string) {
    if (!await showConfirm('Удалить заметку?')) return;
    const { ok, data } = await apiJ('DELETE', `/kviz/api/crm/schedule/notes/${id}`);
    if (!ok) { toast.error((data as { error: string }).error || 'Ошибка'); return; }
    await load();
  }

  const dateLabel = (() => { const s = fmtWeekday(date); return s.charAt(0).toUpperCase() + s.slice(1); })();

  return (
    <div ref={panelRef} className="sched-notes" style={SS.notesBlock}>
      <div style={SS.notesHdr}>💬 Заметки на {dateLabel}</div>
      <div ref={listRef} style={SS.notesList}>
        {notes.length === 0 && (
          <div style={{ color: 'var(--text-3,#94a3b8)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>Заметок на этот день пока нет</div>
        )}
        {notes.map(n => {
          const mine = n.can_edit;
          const time = new Date(n.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
          return (
            <div key={n.id} style={{ ...SS.noteMsg, background: mine ? 'var(--primary-soft,#e0faf9)' : 'var(--surface-2,#f8fafc)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 11 }}>{n.author}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3,#94a3b8)' }}>{time}</span>
                {n.edited && <span style={{ fontSize: 9, color: 'var(--text-3,#94a3b8)', fontStyle: 'italic' }}>изменено</span>}
                {mine && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                    <button style={SS.iconBtn} title="Редактировать" onClick={() => { setEditId(n.id); setEditText(n.text); }}>✏️</button>
                    <button style={SS.iconBtn} title="Удалить" onClick={() => del(n.id)}>🗑️</button>
                  </div>
                )}
              </div>
              {editId === n.id ? (
                <div>
                  <textarea style={{ ...SS.noteTextarea, marginBottom: 4 }} value={editText}
                    rows={3} onChange={e => setEditText(e.target.value)} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={{ ...SS.smallBtn, background: 'var(--primary,#02BDB6)', color: '#fff' }}
                      onClick={() => saveEdit(n.id)} disabled={saving}>Сохранить</button>
                    <button style={SS.smallBtn} onClick={() => setEditId(null)}>Отмена</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border,#e2e8f0)' }}>
        <textarea style={{ ...SS.noteTextarea, marginBottom: 4 }} value={text} placeholder="Написать заметку…" rows={2}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: text.length > 950 ? 'var(--error,#ef4444)' : 'var(--text-3,#94a3b8)' }}>{text.length}/1000</span>
          <button style={{ ...SS.smallBtn, background: 'var(--primary,#02BDB6)', color: '#fff', minHeight: 40, padding: '0 16px' }}
            onClick={() => void send()} disabled={saving || !text.trim()}>Отправить</button>
        </div>
      </div>
    </div>
  );
}
// ── Main ──────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { display_name, role } = useContext(PermContext);
  const navigate    = useNavigate();
  const canBook              = usePerm('schedule.book', 'edit');
  const canAttend            = usePerm('schedule.attend', 'edit');
  const canRescheduleFuture  = usePerm('schedule.reschedule_future', 'edit');
  const isAdmin              = role === 'admin';

  const [date, setDate]           = useState(todayISO);
  const [dayData, setDayData]     = useState<DayData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [nowTick, setNowTick]     = useState(0);
  const [adSources, setAdSources] = useState<AdSource[]>([]);
  const [clientPopupId, setClientPopupId] = useState<string | null>(null);
  const [notesCount, setNotesCount] = useState(0);
  const notesRef = useRef<HTMLDivElement>(null);
  const [blockCfg, setBlockCfg]   = useState<Record<string, { showCancelled: boolean; showRepair: boolean; extraVirtual: 0 | 1 | 2 | 3 }>>(() => {
    try { return JSON.parse(localStorage.getItem('sched-block-cfg') || '{}'); } catch { return {}; }
  });
  const [cfgOpen, setCfgOpen]     = useState<string | null>(null);
  const [smsBlock, setSmsBlock]   = useState<string | null>(null);
  const [formCtx, setFormCtx]     = useState<{ type_code: string; slot?: string; device_id?: string; freeTime?: boolean; isVirtualDevice?: boolean } | null>(null);
  const [detail, setDetail]       = useState<BookingData | null>(null);
  const [searchQ, setSearchQ]         = useState('');
  const [labelFilter, setLabelFilter] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('sched-label-filter'); return s ? new Set(JSON.parse(s) as string[]) : new Set(); } catch { return new Set(); }
  });
  const [searchIdx, setSearchIdx]     = useState(0);
  const [nearbyBkgs, setNearbyBkgs]   = useState<NearbyBooking[]>([]);
  const [nearbyOpen, setNearbyOpen]   = useState(false);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const nearbyTimer = useRef<number | null>(null);

  const allAutoLabels = useMemo(() => {
    const m = new Map<string, AutoLabelData>();
    for (const b of dayData?.bookings ?? []) for (const al of b.auto_labels) m.set(al.code, al);
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  }, [dayData]);

  const allClientTags = useMemo(() => {
    const m = new Map<string, ClientTagData>();
    for (const b of dayData?.bookings ?? []) for (const ct of b.client_tags) m.set(ct.id, ct);
    return [...m.values()];
  }, [dayData]);

  const allBookingLabels = useMemo(() => {
    const m = new Map<number, BookingLabel>();
    for (const b of dayData?.bookings ?? []) for (const bl of b.labels) m.set(bl.id, bl);
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  }, [dayData]);

  const matchedBids = useMemo(() => {
    if (!dayData || (searchQ.length < 2 && labelFilter.size === 0)) return null;
    const q = searchQ.toLowerCase();
    const qd = searchQ.replace(/\D/g, '');
    const matched = new Set<string>();
    for (const b of dayData.bookings) {
      const name = (b.client?.full_name ?? '').toLowerCase();
      const ph   = (b.client?.phone ?? '').replace(/\D/g, '');
      const ms = searchQ.length < 2 || name.includes(q) || (qd.length >= 2 && ph.includes(qd));
      const ml = labelFilter.size === 0 ||
        b.auto_labels.some(al => labelFilter.has(`al:${al.code}`)) ||
        b.client_tags.some(ct => labelFilter.has(`ct:${ct.id}`)) ||
        b.labels.some(bl => labelFilter.has(`bl:${bl.id}`));
      if (ms && ml) matched.add(b.id);
    }
    return matched;
  }, [dayData, searchQ, labelFilter]);

  const matchedList = useMemo(() => {
    if (!matchedBids) return [];
    return dayData?.bookings.filter(b => matchedBids.has(b.id))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()) ?? [];
  }, [matchedBids, dayData]);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    const { ok, data } = await apiJ('GET', `/kviz/api/crm/schedule/day?date=${d}`);
    setLoading(false);
    if (ok) setDayData(data as DayData);
    else toast.error((data as { error: string }).error || 'Не удалось загрузить расписание');
  }, []);

  useEffect(() => { loadDay(date); setNotesCount(0); }, [date, loadDay]);
  useEffect(() => { const t = setInterval(() => setNowTick(n => n + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    fetch('/kviz/api/crm/ad-sources', { credentials: 'include' }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAdSources(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSearchQ(''); setNearbyOpen(false); setLabelMenuOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (searchQ.length < 2) { setNearbyBkgs([]); setNearbyOpen(false); return; }
    if (nearbyTimer.current) clearTimeout(nearbyTimer.current);
    nearbyTimer.current = window.setTimeout(async () => {
      const r = await fetch(`/kviz/api/crm/schedule/client-bookings?search=${encodeURIComponent(searchQ)}`, { credentials: 'include' });
      if (r.ok) { const d = await r.json() as NearbyBooking[]; setNearbyBkgs(d); setNearbyOpen(d.length > 0); }
    }, 250);
    return () => { if (nearbyTimer.current) clearTimeout(nearbyTimer.current); };
  }, [searchQ]);

  function saveLabelFilter(next: Set<string>) {
    setLabelFilter(next);
    try { localStorage.setItem('sched-label-filter', JSON.stringify([...next])); } catch {}
  }

  function goMatch(dir: 1 | -1) {
    if (!matchedList.length) return;
    const idx = (searchIdx + dir + matchedList.length) % matchedList.length;
    setSearchIdx(idx);
    document.querySelector<HTMLElement>(`[data-bid="${matchedList[idx]!.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function saveBlockCfg(tc: string, cfg: Partial<{ showCancelled: boolean; showRepair: boolean; extraVirtual: 0 | 1 | 2 | 3 }>) {
    setBlockCfg(prev => {
      const defaults = { showCancelled: false, showRepair: false, extraVirtual: 0 as const };
      const next = { ...prev, [tc]: { ...defaults, ...prev[tc], ...cfg } };
      try { localStorage.setItem('sched-block-cfg', JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const today = todayISO();
  const isPast = date < today;

  return (
    <div style={SS.page} onClick={() => { if (cfgOpen) setCfgOpen(null); if (labelMenuOpen) setLabelMenuOpen(false); }}>
      {/* Date navigation */}
      <div style={SS.dateNav}>
        <button style={SS.navBtn} onClick={() => setDate(d => { const n = new Date(d); n.setDate(n.getDate()-1); return n.toISOString().slice(0,10); })}>← Вчера</button>
        <button style={{ ...SS.navBtn, ...(date === today ? SS.navBtnActive : {}) }} onClick={() => setDate(today)}>Сегодня</button>
        <button style={SS.navBtn} onClick={() => setDate(d => { const n = new Date(d); n.setDate(n.getDate()+1); return n.toISOString().slice(0,10); })}>Завтра →</button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={SS.dateInput} />
        <span style={SS.dateLabel}>{(() => { const s = fmtWeekday(date); return s.charAt(0).toUpperCase() + s.slice(1); })()}</span>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 8 }}>загрузка…</span>}
        {/* Client search */}
        <div style={{ position: 'relative' }}>
          <input
            type="search" placeholder="Поиск клиента…" value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setSearchIdx(0); }}
            onFocus={() => { if (nearbyBkgs.length > 0) setNearbyOpen(true); }}
            onBlur={() => window.setTimeout(() => setNearbyOpen(false), 200)}
            style={{ ...SS.dateInput, width: 170, paddingRight: searchQ ? 24 : 8 }}
          />
          {searchQ && (
            <button onClick={() => { setSearchQ(''); setNearbyOpen(false); }}
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2, fontSize: 14, lineHeight: 1 }}>
              ✕
            </button>
          )}
          {nearbyOpen && nearbyBkgs.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'var(--surface,#fff)', border: '1px solid var(--border,#e2e8f0)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 280, maxHeight: 320, overflowY: 'auto', marginTop: 4 }}>
              <div style={{ padding: '5px 12px', fontSize: 11, color: 'var(--text-3,#94a3b8)', fontWeight: 700, borderBottom: '1px solid var(--border,#e2e8f0)', textTransform: 'uppercase' }}>Ближайшие записи</div>
              {nearbyBkgs.map(b => (
                <div key={b.id}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border,#e2e8f0)', fontSize: 13 }}
                  onMouseDown={() => { setDate(b.booking_date); setNearbyOpen(false); setSearchQ(b.client?.full_name ?? searchQ); }}>
                  <div style={{ fontWeight: 600 }}>{b.client?.full_name}</div>
                  <div style={{ color: 'var(--text-2,#64748b)', fontSize: 12 }}>{b.booking_date} · {b.device_type_code}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {matchedBids !== null && matchedList.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2,#64748b)' }}>
            <span>{Math.min(searchIdx + 1, matchedList.length)} из {matchedList.length}</span>
            <button style={SS.navBtn} title="Предыдущее" onClick={() => goMatch(-1)}>↑</button>
            <button style={SS.navBtn} title="Следующее" onClick={() => goMatch(1)}>↓</button>
          </div>
        )}
        {/* Label filter */}
        <div style={{ position: 'relative' }}>
          <button
            style={{ ...SS.navBtn, ...(labelFilter.size > 0 ? SS.navBtnActive : {}) }}
            onClick={e => { e.stopPropagation(); setLabelMenuOpen(o => !o); }}>
            Метки{labelFilter.size > 0 ? ` (${labelFilter.size})` : ' ▾'}
          </button>
          {labelMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 100, background: 'var(--surface,#fff)', border: '1px solid var(--border,#e2e8f0)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 220, maxHeight: 400, overflowY: 'auto', marginTop: 4, padding: 8 }}
              onClick={e => e.stopPropagation()}>
              {allAutoLabels.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text-3,#94a3b8)', fontWeight: 700, padding: '2px 4px 4px', textTransform: 'uppercase' }}>Автометки</div>
                  {allAutoLabels.map(al => {
                    const key = `al:${al.code}`;
                    return (
                      <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={labelFilter.has(key)} onChange={e => { const n = new Set(labelFilter); e.target.checked ? n.add(key) : n.delete(key); saveLabelFilter(n); }} />
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: al.color, flexShrink: 0 }} />
                        {al.name}
                      </label>
                    );
                  })}
                </>
              )}
              {allClientTags.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text-3,#94a3b8)', fontWeight: 700, padding: '6px 4px 4px', textTransform: 'uppercase' }}>Теги клиентов</div>
                  {allClientTags.map(ct => {
                    const key = `ct:${ct.id}`;
                    return (
                      <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={labelFilter.has(key)} onChange={e => { const n = new Set(labelFilter); e.target.checked ? n.add(key) : n.delete(key); saveLabelFilter(n); }} />
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: ct.color, flexShrink: 0 }} />
                        {ct.name}
                      </label>
                    );
                  })}
                </>
              )}
              {allBookingLabels.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text-3,#94a3b8)', fontWeight: 700, padding: '6px 4px 4px', textTransform: 'uppercase' }}>Этикетки записи</div>
                  {allBookingLabels.map(bl => {
                    const key = `bl:${bl.id}`;
                    return (
                      <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={labelFilter.has(key)} onChange={e => { const n = new Set(labelFilter); e.target.checked ? n.add(key) : n.delete(key); saveLabelFilter(n); }} />
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: bl.color, flexShrink: 0 }} />
                        {bl.name}
                      </label>
                    );
                  })}
                </>
              )}
              {labelFilter.size > 0 && (
                <button style={{ ...SS.smallBtn, width: '100%', marginTop: 8 }} onClick={() => saveLabelFilter(new Set())}>Сбросить фильтр</button>
              )}
            </div>
          )}
        </div>
        <button style={{ ...SS.navBtn, marginLeft: 'auto' }}
          onClick={() => notesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          💬 Заметки{notesCount > 0 ? ` (${notesCount})` : ''}
        </button>
      </div>

      {/* Special day note (open but with note) */}
      {dayData && dayData.is_open !== false && dayData.special_day?.note && (
        <div style={{ padding: '5px 16px', background: 'var(--warning-soft,#fef9c3)', borderBottom: '1px solid var(--warning,#fbbf24)', fontSize: 13, color: 'var(--text,#1a202c)', flexShrink: 0 }}>
          {dayData.special_day.note}
        </div>
      )}
      {/* Closed day */}
      {dayData && dayData.is_open === false && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 15, color: 'var(--text-2,#64748b)' }}>
          <span>Филиал в этот день не работает</span>
          {dayData.special_day?.note && <span style={{ fontSize: 13, color: 'var(--text-3,#94a3b8)' }}>{dayData.special_day.note}</span>}
        </div>
      )}

      {/* Blocks + Notes */}
      {dayData && dayData.is_open !== false && (
        <div className="sched-scroll" style={SS.blocksWrap}>
          <div className="sched-blocks" style={SS.blocksRow}>
          {dayData.blocks.map(block => {
            const cfg = blockCfg[block.type_code] || { showCancelled: false, showRepair: false, extraVirtual: 0 };
            const slots = getSlots(dayData.day_start, dayData.day_end, block.grid_step_minutes);
            const dayStartMins = strToMins(dayData.day_start);
            const dayEndMins   = strToMins(dayData.day_end);
            const bodyH = (dayEndMins - dayStartMins) * PX_PER_MIN;
            const lastSlotEndMins = dayStartMins + slots.length * block.grid_step_minutes;
            const grayH = Math.max(0, (dayEndMins - lastSlotEndMins) * PX_PER_MIN);
            const rowH  = block.grid_step_minutes * PX_PER_MIN;
            const nowTop = date === today ? nowLineOffset(dayData.day_start) : null;
            void nowTick;

            const realDevices = block.devices.filter(d => d.status === 'working' || (cfg.showRepair && d.status !== 'disabled'));
            const virtDevices = block.virtual_devices ?? [];

            // Virtual columns: show extraVirtual, plus always show if has booking today
            const extraCount = cfg.extraVirtual as number;
            const hasBookingOnVirt = (vd: VirtualDevice) => dayData.bookings.some(b => b.device_id === vd.id);
            const shownVirtual = virtDevices.filter((vd, idx) => idx < extraCount || hasBookingOnVirt(vd));

            const bkgs = dayData.bookings.filter(b =>
              b.device_type_code === block.type_code &&
              (cfg.showCancelled || !['cancelled', 'late_cancel'].includes(b.status))
            );

            const totalCols = realDevices.length + shownVirtual.length;
            const blockMinW = TIME_W + totalCols * DEV_W;

            return (
              <div key={block.type_code} className="sched-block"
                style={{ ...SS.block, flex: `${totalCols} 1 0`, minWidth: blockMinW }}>
                {/* Header */}
                <div style={SS.blockHdr}>
                  <span style={{ ...SS.blockTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.name.toUpperCase()}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    {/* Calendar+ for free-time booking */}
                    <button
                      style={{ ...SS.hdrBtn, opacity: (!canBook || isPast) ? 0.4 : 1, cursor: (!canBook || isPast) ? 'default' : 'pointer' }}
                      title={!canBook ? 'Нет права записи' : isPast ? 'Запись на прошедший день недоступна' : 'Запись на любое время'}
                      disabled={!canBook || isPast}
                      onClick={e => { e.stopPropagation(); if (canBook && !isPast) setFormCtx({ type_code: block.type_code, freeTime: true }); }}
                    >
                      <CalendarPlus size={14} />
                    </button>
                    {/* Settings */}
                    <div style={{ position: 'relative' }}>
                      <button style={SS.hdrBtn} title="Настройки блока" onClick={e => { e.stopPropagation(); setCfgOpen(cfgOpen === block.type_code ? null : block.type_code); }}>
                        <SlidersHorizontal size={14} />
                      </button>
                      {cfgOpen === block.type_code && (
                        <div style={SS.popover} onClick={e => e.stopPropagation()}>
                          {/* Virtual device columns */}
                          {virtDevices.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4, fontWeight: 600 }}>Доп. аппараты:</div>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {([1, 2, 3] as const).filter(n => n <= virtDevices.length).map(n => (
                                  <button key={n} style={{ ...SS.smallBtn, ...(extraCount === n ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : {}) }}
                                    onClick={() => saveBlockCfg(block.type_code, { extraVirtual: n })}>+{n}</button>
                                ))}
                                <button style={{ ...SS.smallBtn, ...(extraCount === 0 ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : {}) }}
                                  onClick={() => saveBlockCfg(block.type_code, { extraVirtual: 0 })}>Скрыть</button>
                              </div>
                            </div>
                          )}
                          <label style={SS.checkLabel}>
                            <input type="checkbox" checked={cfg.showCancelled} onChange={e => saveBlockCfg(block.type_code, { showCancelled: e.target.checked })} />
                            Показывать отменённые
                          </label>
                          <label style={SS.checkLabel}>
                            <input type="checkbox" checked={cfg.showRepair} onChange={e => saveBlockCfg(block.type_code, { showRepair: e.target.checked })} />
                            Аппараты в ремонте
                          </label>
                        </div>
                      )}
                    </div>
                    <button style={{ ...SS.hdrBtn, background: '#ef4444', color: '#fff', fontWeight: 700 }} title="Список клиентов" onClick={e => { e.stopPropagation(); setSmsBlock(block.type_code); }}>SMS</button>
                  </div>
                </div>

                {/* Grid — flex layout: time column + device columns */}
                <div style={{ overflow: 'visible' }}>
                  <div style={{ display: 'flex', minWidth: blockMinW, position: 'relative' }}>

                    {/* Time column */}
                    <div style={{ width: TIME_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--surface,#fff)' }}>
                      {/* Column header */}
                      <div style={{ ...SS.cellHdr, background: 'var(--surface-2,#f8fafc)', borderRight: '1px solid var(--border,#e2e8f0)', borderBottom: '1px solid var(--border,#e2e8f0)' }}>Время</div>
                      {/* Slot rows */}
                      {slots.map(s => (
                        <div key={s} style={{ height: rowH, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 2, paddingLeft: 4, boxSizing: 'border-box', borderBottom: '1px solid var(--border,#e2e8f0)', borderRight: '1px solid var(--border,#e2e8f0)', fontSize: 10, color: 'var(--text-2,#64748b)', fontWeight: 600, background: 'var(--surface,#fff)' }}>
                          {s}
                        </div>
                      ))}
                      {/* Gray strip */}
                      {grayH > 0 && (
                        <div style={{ height: grayH, borderRight: '1px solid var(--border,#e2e8f0)', background: 'var(--surface,#fff)' }} />
                      )}
                      {/* Closing time label */}
                      <div style={{ height: HDR_H, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 4, boxSizing: 'border-box', borderTop: '2px solid var(--border,#e2e8f0)', borderRight: '1px solid var(--border,#e2e8f0)', fontSize: 10, color: 'var(--text-2,#64748b)', fontWeight: 700, background: 'var(--surface,#fff)' }}>
                        {dayData.day_end}
                      </div>
                    </div>

                    {/* Device columns (real + virtual) */}
                    {[
                      ...realDevices.map(d => ({ ...d, isVirtual: false })),
                      ...shownVirtual.map(d => ({ ...d, status: 'working' as const, session_minutes: null, isVirtual: true })),
                    ].map((dev, _devIdx) => {
                      const isVirt = dev.isVirtual;
                      const isRepair = !isVirt && dev.status !== 'working';
                      const devBookings = bkgs.filter(b => b.device_id === dev.id);
                      const colBg = isVirt
                        ? 'repeating-linear-gradient(45deg, var(--surface,#fff) 0px, var(--surface,#fff) 6px, var(--surface-muted,#f1f5f9) 6px, var(--surface-muted,#f1f5f9) 12px)'
                        : isRepair ? 'var(--surface-muted,#f1f5f9)' : 'var(--surface,#fff)';
                      const cellBorder = isVirt ? '1px dashed var(--border,#e2e8f0)' : '1px solid var(--border,#e2e8f0)';

                      return (
                        <div key={dev.id} style={{ flex: `1 1 ${DEV_W}px`, minWidth: DEV_W, position: 'relative' }}>
                          {/* Column header */}
                          <div style={{
                            ...SS.cellHdr,
                            background: (isRepair || isVirt) ? 'var(--surface-muted,#f1f5f9)' : 'var(--surface-2,#f8fafc)',
                            color: isRepair ? 'var(--text-3)' : 'var(--text)',
                            borderRight: cellBorder,
                            borderBottom: '1px solid var(--border,#e2e8f0)',
                            flexDirection: 'column', gap: 1,
                          }}>
                            {isVirt
                              ? <><span style={{ fontWeight: 700 }}>Доп. {dev.number}</span><span style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-3)' }}>сверх</span></>
                              : <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={`${block.name} ${dev.number}`}>{block.name} {dev.number}</span>
                                  {isRepair && <span style={{ fontSize: 9, fontWeight: 400 }}>Ремонт</span>}</>
                            }
                          </div>

                          {/* Slot click rows */}
                          {slots.map(s => (
                            <div key={s}
                              style={{ height: rowH, background: colBg, borderBottom: cellBorder, borderRight: cellBorder, boxSizing: 'border-box', cursor: (!isRepair && canBook && !isPast) ? 'pointer' : 'default' }}
                              onClick={() => {
                                if (!isRepair && canBook && !isPast) {
                                  setFormCtx({ type_code: block.type_code, slot: s, device_id: dev.id, isVirtualDevice: isVirt });
                                }
                              }}
                            />
                          ))}

                          {/* Gray strip (non-clickable) */}
                          {grayH > 0 && (
                            <div style={{ height: grayH, background: 'var(--surface-muted,#f1f5f9)', borderBottom: cellBorder, borderRight: cellBorder, boxSizing: 'border-box' }} />
                          )}

                          {/* Closing line */}
                          <div style={{ height: HDR_H, background: 'var(--surface-2,#f8fafc)', borderTop: '2px solid var(--border,#e2e8f0)', borderRight: cellBorder, boxSizing: 'border-box' }} />

                          {/* Booking overlay — absolute, starts right after column header */}
                          <div style={{ position: 'absolute', top: HDR_H, left: 0, right: 0, height: bodyH, pointerEvents: 'none', zIndex: 2 }}>
                            {devBookings.map(b => {
                              const startMins = bookingTimeMins(b.starts_at);
                              const dur = bookingDurationMins(b);
                              const top = (startMins - dayStartMins) * PX_PER_MIN;
                              const height = Math.max(18, dur * PX_PER_MIN - 1);
                              const isNonSlot = !slots.includes(minsToStr(startMins));
                              return (
                                <div key={b.id}
                                  data-bid={b.id}
                                  style={{ position: 'absolute', top, left: 2, right: 2, height, zIndex: 1, pointerEvents: 'auto', cursor: 'pointer',
                                    ...(matchedBids !== null ? { opacity: matchedBids.has(b.id) ? 1 : 0.2, outline: matchedBids.has(b.id) ? '2px solid var(--primary,#02BDB6)' : 'none', borderRadius: 4 } : {}),
                                  }}
                                  title="ЛКМ — запись, ПКМ — карточка клиента"
                                  onClick={e => { e.stopPropagation(); setDetail(b); }}
                                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setClientPopupId(b.client_id); }}
                                >
                                  <BookingCard b={b} showTime={isNonSlot} />
                                </div>
                              );
                            })}
                          </div>

                          {/* Now line */}
                          {nowTop !== null && nowTop >= 0 && nowTop <= bodyH && (
                            <div style={{ position: 'absolute', left: 0, right: 0, top: HDR_H + nowTop, height: 2, background: 'var(--primary,#02BDB6)', zIndex: 10, pointerEvents: 'none' }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          <NotesPanel date={date} panelRef={notesRef} onCountChange={setNotesCount} />
        </div>
      )}

      {/* Panels / modals */}
      {formCtx && canBook && dayData && (
        <BookingFormPanel ctx={formCtx} date={date} dayData={dayData} displayName={display_name}
          onClose={() => setFormCtx(null)} onDone={() => { setFormCtx(null); loadDay(date); }} />
      )}
      {detail && dayData && (
        <BookingDetailModal booking={detail} allBookings={dayData.bookings}
          canBook={canBook} canAttend={canAttend} canRescheduleFuture={canRescheduleFuture} isAdmin={isAdmin}
          onClose={() => setDetail(null)}
          onDone={(ch) => { if (ch) loadDay(date); setDetail(null); }}
          onRefresh={() => loadDay(date)}
          onClientPopup={() => { setClientPopupId(detail.client_id); setDetail(null); }} />
      )}
      {smsBlock && dayData && (
        <SmsDialog type_code={smsBlock}
          bookings={dayData.bookings.filter(b => b.device_type_code === smsBlock && ['booked','confirmed','attended'].includes(b.status))}
          onClose={() => setSmsBlock(null)} />
      )}

      {/* Client popup (RMB or button) */}
      {clientPopupId && (
        <div style={SS.overlay} onClick={() => setClientPopupId(null)}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto', borderRadius: 12 }}>
            <ClientPopup
              clientId={clientPopupId}
              adSources={adSources}
              role={role}
              onClose={() => setClientPopupId(null)}
              onEdit={() => { setClientPopupId(null); navigate(`/crm/clients#client=${clientPopupId}`); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SS: Record<string, React.CSSProperties> = {
  page:    { height: '100dvh' as unknown as React.CSSProperties['height'], display: 'flex', flexDirection: 'column', fontFamily: "'Manrope',system-ui,sans-serif", background: 'var(--bg,#f8fafc)', overflow: 'hidden' },
  dateNav: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface,#fff)', borderBottom: '1px solid var(--border,#e2e8f0)', flexShrink: 0, flexWrap: 'wrap' },
  navBtn:  { padding: '5px 12px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, background: 'var(--surface,#fff)', color: 'var(--text,#1a202c)', cursor: 'pointer', fontSize: 13 },
  navBtnActive: { background: 'var(--primary,#02BDB6)', color: '#fff', borderColor: 'var(--primary,#02BDB6)' },
  dateInput: { border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: 'var(--surface,#fff)', color: 'var(--text,#1a202c)' },
  dateLabel: { fontSize: 14, fontWeight: 600, color: 'var(--text,#1a202c)' },
  blocksWrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '0 12px 12px', overflowX: 'auto', overflowY: 'auto' },
  blocksRow: { display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0, minWidth: 'max-content' },
  block:   { border: '1px solid var(--border,#e2e8f0)', borderRadius: 10, background: 'var(--surface,#fff)', display: 'flex', flexDirection: 'column' },
  blockHdr: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 10px', height: BLK_H, borderBottom: '1px solid var(--border,#e2e8f0)', background: 'var(--surface-2,#f8fafc)', position: 'sticky', top: 0, zIndex: 4, borderRadius: '10px 10px 0 0', boxSizing: 'border-box', flexShrink: 0 },
  blockTitle: { fontWeight: 800, fontSize: 12, color: 'var(--text,#1a202c)', letterSpacing: 0.5 },
  hdrBtn:  { padding: '0 6px', height: 24, border: '1px solid var(--border,#e2e8f0)', borderRadius: 5, background: 'var(--surface,#fff)', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 },
  popover: { position: 'absolute', right: 0, top: '100%', zIndex: 20, background: 'var(--surface,#fff)', border: '1px solid var(--border,#e2e8f0)', borderRadius: 8, padding: 10, minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,.1)' },
  checkLabel: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', marginBottom: 6 },
  cellHdr: { height: HDR_H, background: 'var(--surface-2,#f8fafc)', fontWeight: 700, fontSize: 10, position: 'sticky', top: BLK_H, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' },
  loading: { padding: 40, textAlign: 'center', color: 'var(--text-3,#94a3b8)', fontSize: 14 },
  // Form panel
  panelOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' },
  panel:   { width: 360, maxWidth: '100vw', background: 'var(--surface,#fff)', height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box', borderLeft: '1px solid var(--border,#e2e8f0)' },
  inp:     { width: '100%', padding: '7px 10px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, fontSize: 14, background: 'var(--surface,#fff)', color: 'var(--text,#1a202c)', boxSizing: 'border-box', marginBottom: 6 },
  lbl:     { display: 'block', fontSize: 12, color: 'var(--text-2,#64748b)', marginBottom: 2, fontWeight: 600 },
  dropdown: { border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, background: 'var(--surface,#fff)', boxShadow: '0 4px 12px rgba(0,0,0,.08)', maxHeight: 200, overflowY: 'auto', marginBottom: 6 },
  dropItem: { padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border,#e2e8f0)' },
  warn:    { fontSize: 12, color: 'var(--warning,#f59e0b)', background: 'var(--warning-soft,#fef3c7)', padding: '6px 10px', borderRadius: 6, marginBottom: 6 },
  tabBtn:  { padding: '5px 12px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, background: 'var(--surface,#fff)', cursor: 'pointer', fontSize: 12 },
  tabBtnActive: { background: 'var(--primary,#02BDB6)', color: '#fff', borderColor: 'var(--primary,#02BDB6)' },
  submitBtn: { width: '100%', padding: '10px', background: 'var(--primary,#02BDB6)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8 },
  smallBtn: { padding: '4px 10px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 5, background: 'var(--surface,#fff)', cursor: 'pointer', fontSize: 12 },
  iconBtn: { padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--text-2,#64748b)' },
  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal:   { background: 'var(--surface,#fff)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.2)', boxSizing: 'border-box' },
  // Notes
  notesBlock: { border: '1px solid var(--border,#e2e8f0)', borderRadius: 10, background: 'var(--surface,#fff)', flexShrink: 0, minWidth: 'calc(100vw - 24px)' },
  notesHdr:   { padding: '8px 12px', borderBottom: '1px solid var(--border,#e2e8f0)', fontWeight: 700, fontSize: 13, background: 'var(--surface-2,#f8fafc)', borderRadius: '10px 10px 0 0' },
  notesList:  { padding: '8px 12px', maxHeight: 320, overflowY: 'auto' as const },
  noteMsg:    { borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  noteTextarea: { width: '100%', border: '1px solid var(--border,#e2e8f0)', borderRadius: 6, padding: '7px 10px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const, minHeight: 54, background: 'var(--surface,#fff)', color: 'var(--text,#1a202c)' },
};
