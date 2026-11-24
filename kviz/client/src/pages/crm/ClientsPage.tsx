import { useState, useEffect, useCallback, useRef, Component } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { showConfirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import { useBreakpoint } from '../../lib/useBreakpoint';
import { formatPlanRestriction } from '../../lib/planRestriction';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdSource { id: string; name: string; requires_referrer: boolean; is_active: boolean }

interface ClientRow {
  id: string; full_name: string; phone: string | null; birth_date: string | null;
  ad_source_id: string | null; profile_complete: boolean; status: string;
  fitbase_client_id: string | null; created_at: string;
  last_visit_at?: string | null; days_since_visit?: number | null;
  plan_name?: string | null; extra_plans_count?: number; sessions_summary?: string | null;
  system_tags?: string[]; personal_tags?: { id: string; name: string; color: string }[];
  ltv?: number; deposit?: number; source_name?: string | null;
}

interface ColDef {
  key: string; label: string; width: number; sortable: boolean; hideable: boolean;
}

const COLS: ColDef[] = [
  { key: 'name',       label: 'Имя',          width: 180, sortable: true,  hideable: false },
  { key: 'phone',      label: 'Телефон',       width: 130, sortable: false, hideable: true },
  { key: 'plan',       label: 'Абонемент',     width: 150, sortable: true,  hideable: true },
  { key: 'sessions',   label: 'Занятий',       width: 80,  sortable: true,  hideable: true },
  { key: 'last_visit', label: 'Визит',         width: 90,  sortable: true,  hideable: true },
  { key: 'days',       label: 'Дн. назад',     width: 80,  sortable: true,  hideable: true },
  { key: 'tags',       label: 'Метки',         width: 190, sortable: false, hideable: true },
  { key: 'source',     label: 'Источник',      width: 110, sortable: true,  hideable: true },
  { key: 'ltv',        label: 'LTV ₸',         width: 100, sortable: true,  hideable: true },
  { key: 'created',    label: 'Создан',        width: 90,  sortable: true,  hideable: true },
  { key: 'birth',      label: 'Дата рожд.',    width: 90,  sortable: true,  hideable: true },
  { key: 'profile',    label: 'Анкета',        width: 65,  sortable: true,  hideable: true },
  { key: 'deposit',    label: 'Депозит ₸',     width: 100, sortable: true,  hideable: true },
  { key: 'fitbase',    label: 'Fitbase ID',    width: 90,  sortable: true,  hideable: true },
];
const COL_BY_KEY = new Map(COLS.map(c => [c.key, c]));
const DEFAULT_VISIBLE = new Set(['name', 'phone', 'plan', 'sessions', 'last_visit', 'days', 'tags']);
const DEFAULT_ORDER = COLS.map(c => c.key);

interface TableSettings {
  order: string[];
  widths: Record<string,number>;
  visible: Record<string,boolean>;
  sortCol: string;
  sortDir: 'asc' | 'desc';
}

function defaultTableSettings(): TableSettings {
  return {
    order: DEFAULT_ORDER,
    widths: Object.fromEntries(COLS.map(c => [c.key, c.width])),
    visible: Object.fromEntries(COLS.map(c => [c.key, DEFAULT_VISIBLE.has(c.key)])),
    sortCol: 'last_visit',
    sortDir: 'desc',
  };
}

function loadTableSettings(login: string): TableSettings {
  try {
    const raw = localStorage.getItem(`crm.clients.table.${login}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TableSettings>;
      const def = defaultTableSettings();
      return { ...def, ...parsed };
    }
  } catch {}
  return defaultTableSettings();
}

function saveTableSettings(login: string, s: TableSettings) {
  try { localStorage.setItem(`crm.clients.table.${login}`, JSON.stringify(s)); } catch {}
}

interface ClientFull extends ClientRow {
  iin: string | null; referrer_client_id: string | null;
  id_issued_by: string | null; id_valid_until: string | null;
  photo_path: string | null; contraindications: string | null; notes: string | null;
  source: string; branch_id: string; is_deleted: boolean;
  gender: string | null; address: string | null;
  important_note: string | null; skirt_size: string | null;
  device_settings: Record<string, { vacu?: number; ik?: number }> | null;
  instagram: string | null; tiktok: string | null; email: string | null;
}

interface DeviceType { code: string; name: string }

interface RefClient { id: string; full_name: string; phone: string | null }
interface ClientBalance { deposit: number; bonus: number }

interface ClientPlan {
  id: string; plan_id: string | null; source?: string; name?: string | null; status: string;
  purchased_at: string; activated_at: string | null; valid_until: string | null;
  sessions_total?: number | null; sessions_left?: number | null; needs_split?: boolean;
  freeze_days_used?: number | null;
  allowed_weekdays?: number[] | null; time_from?: string | null; time_to?: string | null;
  plan: { id: string; name: string; kind: string; freeze_days?: number | null } | null;
  crm_client_plan_items: { device_type_code: string | null; device_type_codes?: string[] | null; sessions_total: number; sessions_left: number; phase: string; is_unlimited?: boolean; daily_limit?: number | null }[];
}

interface ClientSummary {
  ltv: number;
  active_plan: ClientPlan | null;
  visits_attended_total: number;
  last_visit_at: string | null;
  inbody_last: string | null;
  inbody_latest: Record<string, unknown> | null;
  inbody_prev: Record<string, unknown> | null;
  inbody_count: number;
  inbody_first: string | null;
  measure_last: string | null;
  measure_latest: Record<string, unknown> | null;
  measure_first: Record<string, unknown> | null;
  measure_count: number;
  measure_points: { measured_at: string; total_cm: number }[];
  body_client_id: string | null;
  system_tags: string[];
  personal_tags: { id: string; name: string; color: string }[];
}

interface FeedItem {
  id: string; kind: string; at: string; text: string; author: string;
  extra?: { status?: string; due_at?: string | null };
}

interface ClientTag { id: string; name: string; color: string; is_system?: boolean }
interface SaleRow {
  id: string; number: number | null; total: number; status: string;
  created_at: string; cashier: string | null; discount_kind: string | null; source?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('.');
}
function fmtDT(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function iinToDob(iin: string): string {
  if (iin.length < 7) return '';
  const yy = iin.slice(0, 2), mm = iin.slice(2, 4), dd = iin.slice(4, 6);
  const c = parseInt(iin[6]);
  // RK IIN: 7th digit 1-2=1800s, 3-4=1900s, 5-6=2000s
  const century = c <= 2 ? '18' : c <= 4 ? '19' : '20';
  if (parseInt(mm) < 1 || parseInt(mm) > 12 || parseInt(dd) < 1 || parseInt(dd) > 31) return '';
  return `${century}${yy}-${mm}-${dd}`;
}

async function apiJSON(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d, status: r.status };
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

function ageFromDate(bd: string | null): string {
  if (!bd) return '';
  const birth = new Date(bd);
  const now = new Date();
  if (birth > now) { console.warn('[ageFromDate] future birth date:', bd); return ''; }
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  if (age < 0) return '';
  return `${age} л.`;
}

function fmtPhone(p: string | null): string {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `+${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7,9)} ${d.slice(9)}`;
  return '+' + d;
}

function timerLabel(lastIso: string | null): { label: string; cls: string; pct: number } | null {
  if (!lastIso) return null;
  // Use date-only comparison in UTC+5 (Asia/Yekaterinburg) to avoid off-by-one from timestamp math
  const lastDateMs = new Date(lastIso.slice(0, 10)).getTime(); // midnight UTC of last date
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Yekaterinburg' }); // "YYYY-MM-DD"
  const todayMs = new Date(todayStr).getTime();
  const d = Math.round((todayMs - lastDateMs) / 86400000);
  const nextDate = new Date(lastDateMs + 7 * 86400000);
  const nf = `${String(nextDate.getUTCDate()).padStart(2,'0')}.${String(nextDate.getUTCMonth()+1).padStart(2,'0')}`;
  const pct = Math.min(Math.round((d / 7) * 100), 100);
  const nextIn = 7 - d;
  if (nextIn > 2) return { label: `Следующий через ${nextIn} дн. (${nf})`, cls: 'cp-timer--ok', pct };
  if (nextIn > 0) return { label: `Скоро · через ${nextIn} дн. (${nf})`, cls: 'cp-timer--warn', pct };
  if (nextIn === 0) return { label: 'Сегодня', cls: 'cp-timer--warn', pct: 100 };
  return { label: `Просрочено на ${-nextIn} дн.`, cls: 'cp-timer--over', pct: 100 };
}

const ZONE_LABELS: Record<string, string> = {
  neck: 'Шея', chest: 'Грудь', arm_l: 'Л.рука', arm_r: 'П.рука',
  waist: 'Талия', belly: 'Живот', glutes: 'Ягодицы',
  thigh_l: 'Л.бедро', thigh_r: 'П.бедро', shin_l: 'Л.голень', shin_r: 'П.голень',
};

function Sparkline({ pts }: { pts: { x: number; y: number }[] }) {
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 150, H = 32, pad = 3;
  const rx = maxX - minX || 1, ry = maxY - minY || 1;
  const sx = (x: number) => pad + ((x - minX) / rx) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - minY) / ry) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  return <svg width={W} height={H} style={{ display: 'block', marginBottom: 6 }}><path d={d} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

const SYSTEM_TAG_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  new_client:           { label: 'Новый клиент',            color: '#fff', bg: '#6366f1' },
  incomplete_profile:   { label: 'Анкета неполная',         color: '#92400e', bg: '#fef3c7' },
  subscription_ending:  { label: 'Абонемент заканчивается', color: '#fff', bg: '#ef4444' },
  measure_soon:         { label: 'Замер скоро',             color: '#064e3b', bg: '#d1fae5' },
  measure_overdue:      { label: 'Замер просрочен',         color: '#fff', bg: '#dc2626' },
  birthday:             { label: 'День рождения',           color: '#831843', bg: '#fce7f3' },
};

const PLAN_STATUS: Record<string, { text: string; color: string; bg: string }> = {
  not_activated: { text: 'Не активирован', color: '#92400e', bg: '#fef3c7' },
  active:        { text: 'Активен',         color: '#064e3b', bg: '#d1fae5' },
  frozen:        { text: 'Заморожен',        color: '#fff',    bg: '#6366f1' },
  expired:       { text: 'Истёк',            color: '#fff',    bg: '#ef4444' },
  refunded:      { text: 'Возвращён',        color: '#6b7280', bg: '#f3f4f6' },
  cancelled:     { text: 'Отменён',          color: '#6b7280', bg: '#f3f4f6' },
};

// ── ClientForm ─────────────────────────────────────────────────────────────────

function ClientForm({ client, adSources, onSave, onCancel }: {
  client: ClientFull | null; adSources: AdSource[];
  onSave: (data: ClientFull) => void; onCancel: () => void;
}) {
  const isNew = !client;
  const [form, setForm] = useState({
    full_name: client?.full_name ?? '',
    phone: client?.phone ?? '',
    iin: client?.iin?.replace(/\*+.*/, '') ?? '',
    birth_date: client?.birth_date?.slice(0, 10) ?? '',
    ad_source_id: client?.ad_source_id ?? '',
    referrer_client_id: client?.referrer_client_id ?? '',
    id_issued_by: client?.id_issued_by ?? '',
    id_valid_until: client?.id_valid_until?.slice(0, 10) ?? '',
    contraindications: client?.contraindications ?? '',
    notes: client?.notes ?? '',
    gender: client?.gender ?? '',
    address: client?.address ?? '',
    instagram: client?.instagram ?? '',
    tiktok: client?.tiktok ?? '',
    email: client?.email ?? '',
    profile_complete: client?.profile_complete ?? false,
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl]   = useState<string | null>(null);
  const [referrerSearch, setReferrerSearch] = useState('');
  const [referrerResults, setReferrerResults] = useState<RefClient[]>([]);
  const [referrerName, setReferrerName] = useState('');
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedSource = adSources.find(s => s.id === form.ad_source_id);

  useEffect(() => {
    if (client?.photo_path) {
      fetch(`/kviz/api/crm/clients/${client.id}/photo-url`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.url) setPhotoUrl(d.url); }).catch(() => {});
    }
    if (client?.referrer_client_id) {
      fetch(`/kviz/api/crm/clients/${client.referrer_client_id}`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.full_name) setReferrerName(d.full_name); }).catch(() => {});
    }
  }, [client]);

  async function searchReferrer(q: string) {
    if (q.length < 2) { setReferrerResults([]); return; }
    const r = await fetch(`/kviz/api/crm/clients?search=${encodeURIComponent(q)}&limit=10`, { credentials: 'include' });
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d?.items ?? []);
    setReferrerResults(list.filter((c: ClientRow) => c.id !== client?.id));
  }

  function onIinChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 12);
    setForm(f => {
      const upd = { ...f, iin: digits };
      if (digits.length === 12) { const dob = iinToDob(digits); if (dob && !f.birth_date) upd.birth_date = dob; }
      return upd;
    });
  }

  function onPhoneChange(v: string) {
    let digits = v.replace(/\D/g, '');
    if (digits.startsWith('8') && digits.length > 1) digits = '7' + digits.slice(1);
    if (digits.startsWith('77') || (digits.startsWith('7') && digits.length === 1)) setForm(f => ({ ...f, phone: '+' + digits }));
    else setForm(f => ({ ...f, phone: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    const body: Record<string, unknown> = {
      full_name: form.full_name.trim(), phone: form.phone || null, iin: form.iin || null,
      birth_date: form.birth_date || null, ad_source_id: form.ad_source_id || null,
      referrer_client_id: form.referrer_client_id || null,
      id_issued_by: form.id_issued_by || null, id_valid_until: form.id_valid_until || null,
      contraindications: form.contraindications || null, notes: form.notes || null,
      gender: form.gender || null, address: form.address || null,
      instagram: form.instagram || null, tiktok: form.tiktok || null, email: form.email || null,
      profile_complete: form.profile_complete,
    };
    const url = isNew ? '/kviz/api/crm/clients' : `/kviz/api/crm/clients/${client!.id}`;
    const { ok, data } = await apiJSON(isNew ? 'POST' : 'PATCH', url, body);
    if (!ok) { setErr(data.error || 'Ошибка'); setLoading(false); return; }
    const saved = data as ClientFull;
    if (photoFile) {
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = String(reader.result).split(',')[1];
        await apiJSON('POST', `/kviz/api/crm/clients/${saved.id}/photo`, { data: b64, mime: photoFile.type });
        setLoading(false); onSave(saved);
      };
      reader.onerror = () => { setLoading(false); onSave(saved); };
      reader.readAsDataURL(photoFile);
    } else { setLoading(false); onSave(saved); }
  }

  return (
    <form onSubmit={handleSubmit} style={{ height: '100%', overflow: 'auto', padding: '16px 20px 40px' }}>
      <div style={SF.header}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{isNew ? 'Новый клиент' : 'Редактировать клиента'}</h2>
        <button type="button" style={SF.iconBtn} onClick={onCancel}>✕</button>
      </div>
      {err && <div style={SF.errBox}>{err}</div>}
      <div className="client-form-grid" style={SF.grid}>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>ФИО *</label>
          <input style={SF.inp} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required placeholder="Иванова Анна Ивановна" />
        </div>
        <div>
          <label style={SF.label}>Телефон (+7...)</label>
          <input style={SF.inp} value={form.phone} onChange={e => onPhoneChange(e.target.value)} placeholder="+7 777 000 00 00" />
        </div>
        <div>
          <label style={SF.label}>ИИН (12 цифр)</label>
          <input style={SF.inp} value={form.iin} onChange={e => onIinChange(e.target.value)} maxLength={12} placeholder="000000000000" />
          {form.iin.length > 0 && form.iin.length < 12 && <span style={{ fontSize: 11, color: 'var(--warning)' }}>Введено {form.iin.length}/12</span>}
        </div>
        <div>
          <label style={SF.label}>Дата рождения</label>
          <input style={SF.inp} type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
        </div>
        <div>
          <label style={SF.label}>Пол</label>
          <select style={SF.inp} value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
            <option value="">— не указан —</option>
            <option value="female">Женский</option>
            <option value="male">Мужской</option>
          </select>
        </div>
        <div>
          <label style={SF.label}>Рекламный источник</label>
          <select style={SF.inp} value={form.ad_source_id} onChange={e => setForm(f => ({ ...f, ad_source_id: e.target.value, referrer_client_id: '' }))}>
            <option value="">— не указан —</option>
            {adSources.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {selectedSource?.requires_referrer && (
          <div style={{ gridColumn: '1/-1' }}>
            <label style={SF.label}>Реферер (кто привёл)</label>
            <div style={{ position: 'relative' }}>
              <input style={SF.inp} value={form.referrer_client_id ? referrerName : referrerSearch}
                onChange={e => { if (form.referrer_client_id) { setForm(f => ({ ...f, referrer_client_id: '' })); setReferrerName(''); } setReferrerSearch(e.target.value); searchReferrer(e.target.value); }}
                placeholder="Поиск по имени или телефону" />
              {referrerResults.length > 0 && !form.referrer_client_id && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}>
                  {referrerResults.map(c => (
                    <div key={c.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                      onMouseDown={() => { setForm(f => ({ ...f, referrer_client_id: c.id })); setReferrerName(c.full_name); setReferrerSearch(''); setReferrerResults([]); }}>
                      {c.full_name} {c.phone && <span style={{ color: 'var(--text-2)' }}>{c.phone}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {form.referrer_client_id && <div style={{ fontSize: 12, color: 'var(--primary)', marginTop: 4 }}>✓ {referrerName}</div>}
          </div>
        )}
        <div>
          <label style={SF.label}>Кем выдан документ</label>
          <input style={SF.inp} value={form.id_issued_by} onChange={e => setForm(f => ({ ...f, id_issued_by: e.target.value }))} placeholder="МЮ РК" />
        </div>
        <div>
          <label style={SF.label}>Действителен до</label>
          <input style={SF.inp} type="date" value={form.id_valid_until} onChange={e => setForm(f => ({ ...f, id_valid_until: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Адрес</label>
          <input style={SF.inp} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="г. Астана, ул. ..." />
        </div>
        <div>
          <label style={SF.label}>Instagram</label>
          <input style={SF.inp} value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} placeholder="@username или ссылка" />
        </div>
        <div>
          <label style={SF.label}>TikTok</label>
          <input style={SF.inp} value={form.tiktok} onChange={e => setForm(f => ({ ...f, tiktok: e.target.value }))} placeholder="@username или ссылка" />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Email</label>
          <input style={SF.inp} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Фото</label>
          {photoUrl && <img src={photoUrl} alt="Фото" style={{ width: 80, height: 80, borderRadius: 40, objectFit: 'cover', display: 'block', marginBottom: 8 }} />}
          <button type="button" style={SF.outlineBtn} onClick={() => fileRef.current?.click()}>
            {photoFile ? `✓ ${photoFile.name}` : photoUrl ? 'Заменить фото' : 'Загрузить фото'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPhotoFile(e.target.files?.[0] ?? null)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Противопоказания</label>
          <textarea style={{ ...SF.inp, height: 70, resize: 'vertical' }} value={form.contraindications} onChange={e => setForm(f => ({ ...f, contraindications: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Заметки</label>
          <textarea style={{ ...SF.inp, height: 70, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.profile_complete} onChange={e => setForm(f => ({ ...f, profile_complete: e.target.checked }))} />
            Анкета заполнена
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" style={SF.cancelBtn} onClick={onCancel}>Отмена</button>
        <button type="submit" style={SF.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
      </div>
    </form>
  );
}

// ── FreezeDialog ───────────────────────────────────────────────────────────────

function FreezeDialog({ planId, maxDays, onDone, onClose }: {
  planId: string; maxDays: number; onDone: () => void; onClose: () => void;
}) {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setLoading(true); setErr('');
    const { ok, data } = await apiJSON('POST', `/kviz/api/crm/client-plans/${planId}/freeze`, { days });
    if (!ok) { setErr(data.error || 'Ошибка'); setLoading(false); return; }
    toast.success('Абонемент заморожен');
    onDone();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 320, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Заморозить абонемент</h3>
        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <label style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
          Дней заморозки {maxDays > 0 && <span style={{ color: 'var(--text-2)' }}>(лимит: {maxDays})</span>}
        </label>
        <input type="number" min={1} max={maxDays || 365} value={days} onChange={e => setDays(Number(e.target.value))}
          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button style={SL.outlineBtn} onClick={onClose}>Отмена</button>
          <button className="cp-btn cp-btn--primary" onClick={submit} disabled={loading}>{loading ? '…' : 'Заморозить'}</button>
        </div>
      </div>
    </div>
  );
}

// ── SplitDialog ────────────────────────────────────────────────────────────────

type SplitRow = { is_cross: boolean; device_type_code: string; device_type_codes: string[]; sessions: number };

function SplitDialog({ plan, onDone, onClose }: { plan: ClientPlan; onDone: () => void; onClose: () => void }) {
  const [deviceTypes, setDeviceTypes] = useState<{ code: string; name: string }[]>([]);
  const [items, setItems] = useState<SplitRow[]>([
    { is_cross: false, device_type_code: '', device_type_codes: [], sessions: plan.sessions_left ?? 0 }
  ]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/kviz/api/crm/device-types', { credentials: 'include' }).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setDeviceTypes(d); }).catch(() => {});
  }, []);

  const total = items.reduce((s, i) => s + Number(i.sessions ?? 0), 0);
  const left = plan.sessions_left ?? 0;

  function upd(idx: number, patch: Partial<SplitRow>) {
    setItems(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function toggleCrossCode(idx: number, code: string, checked: boolean) {
    setItems(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const codes = checked ? [...p.device_type_codes, code] : p.device_type_codes.filter(c => c !== code);
      return { ...p, device_type_codes: codes };
    }));
  }

  async function submit() {
    for (const it of items) {
      if (it.is_cross && it.device_type_codes.length < 2) { setErr('Пул Cross должен содержать ≥ 2 аппарата'); return; }
      if (!it.is_cross && !it.device_type_code) { setErr('Выберите тип аппарата для каждой строки'); return; }
    }
    if (total !== left) { setErr(`Сумма сеансов (${total}) должна равняться остатку (${left})`); return; }
    setLoading(true); setErr('');
    const payload = items.map(it => it.is_cross
      ? { is_pool: true, device_type_codes: it.device_type_codes, sessions: it.sessions }
      : { device_type_code: it.device_type_code, sessions: it.sessions }
    );
    const { ok, data } = await apiJSON('POST', `/kviz/api/crm/client-plans/${plan.id}/split`, { items: payload });
    if (!ok) { setErr(data.error || 'Ошибка'); setLoading(false); return; }
    toast.success('Сеансы распределены');
    onDone();
  }

  const inp: React.CSSProperties = { padding: '7px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 440, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Распределить сеансы</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-2)' }}>Остаток: {left} сеансов</p>
        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {items.map((it, idx) => (
          <div key={idx} style={{ marginBottom: 10, padding: 10, border: `1.5px solid ${it.is_cross ? 'var(--primary)' : 'var(--input-border)'}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: it.is_cross ? 8 : 0 }}>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={it.is_cross}
                  onChange={e => upd(idx, { is_cross: e.target.checked, device_type_code: '', device_type_codes: [] })} />
                Cross
              </label>
              {!it.is_cross && (
                <select value={it.device_type_code} onChange={e => upd(idx, { device_type_code: e.target.value })}
                  style={{ ...inp, flex: 1 }}>
                  <option value="">— аппарат —</option>
                  {deviceTypes.map(dt => <option key={dt.code} value={dt.code}>{dt.name ?? dt.code}</option>)}
                </select>
              )}
              <input type="number" min={1} value={it.sessions} onChange={e => upd(idx, { sessions: Number(e.target.value) })}
                style={{ ...inp, width: 72 }} />
              {items.length > 1 && <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--danger)' }}
                onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>✕</button>}
            </div>
            {it.is_cross && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {deviceTypes.map(dt => (
                  <label key={dt.code} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, cursor: 'pointer', background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 6 }}>
                    <input type="checkbox" checked={it.device_type_codes.includes(dt.code)}
                      onChange={e => toggleCrossCode(idx, dt.code, e.target.checked)} />
                    {dt.name ?? dt.code}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ fontSize: 12, color: total === left ? 'var(--success)' : 'var(--danger)', marginBottom: 12 }}>
          Итого: {total} / {left}
        </div>
        <button style={{ ...SL.outlineBtn, fontSize: 12, marginBottom: 16 }}
          onClick={() => setItems(prev => [...prev, { is_cross: false, device_type_code: '', device_type_codes: [], sessions: 0 }])}>+ Добавить строку</button>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={SL.outlineBtn} onClick={onClose}>Отмена</button>
          <button className="cp-btn cp-btn--primary" onClick={submit} disabled={loading}>{loading ? '…' : 'Распределить'}</button>
        </div>
      </div>
    </div>
  );
}

// ── ErrorBoundary ──────────────────────────────────────────────────────────────

class PopupErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { hasError: boolean }> {
  constructor(props: { onClose: () => void; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div className="cp-overlay" onClick={this.props.onClose}>
        <div className="cp-popup" style={{ maxHeight: 180, justifyContent: 'center', alignItems: 'center', gap: 16 }} onClick={e => e.stopPropagation()}>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>Не удалось открыть карточку</p>
          <button className="cp-btn cp-btn--primary" onClick={this.props.onClose}>Закрыть</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ── ClientPopup ────────────────────────────────────────────────────────────────

function ClientPopup({ clientId, adSources, role, onClose, onEdit }: {
  clientId: string; adSources: AdSource[]; role: string;
  onClose: () => void; onEdit: () => void;
}) {
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientFull | null>(null);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [plans, setPlans] = useState<ClientPlan[] | null>(null);
  const [planFilter, setPlanFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedTab, setFeedTab] = useState<'all' | 'comments' | 'tasks' | 'log'>('all');
  const [loading, setLoading] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [balance, setBalance] = useState<ClientBalance | null>(null);
  const [newComment, setNewComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [freezeId, setFreezeId] = useState<string | null>(null);
  const [splitPlan, setSplitPlan] = useState<ClientPlan | null>(null);
  const [allTags, setAllTags] = useState<ClientTag[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [importantEdit, setImportantEdit] = useState(false);
  const [importantForm, setImportantForm] = useState<{ skirt_size: string; device_settings: Record<string, { vacu: string; ik: string }>; contraindications: string }>({ skirt_size: '', device_settings: {}, contraindications: '' });
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  const canEdit = role === 'admin' || role === 'manager';

  const loadSummary = useCallback(() => {
    fetch(`/kviz/api/crm/clients/${clientId}/summary`, { credentials: 'include' })
      .then(r => r.json()).then(d => setSummary(d)).catch(() => {});
  }, [clientId]);

  const loadFeed = useCallback(async () => {
    const r = await fetch(`/kviz/api/crm/clients/${clientId}/feed?kind=${feedTab}`, { credentials: 'include' });
    const d = await r.json().catch(() => []);
    setFeedItems(Array.isArray(d) ? d : []);
  }, [clientId, feedTab]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/kviz/api/crm/clients/${clientId}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/kviz/api/crm/clients/${clientId}/balance`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([cd, bd]) => {
      setClient(cd as ClientFull);
      setBalance(bd as ClientBalance);
      if ((cd as ClientFull).photo_path) {
        fetch(`/kviz/api/crm/clients/${clientId}/photo-url`, { credentials: 'include' })
          .then(r => r.json()).then(d => { if (d.url) setPhotoUrl(d.url); }).catch(() => {});
      }
      if ((cd as ClientFull).referrer_client_id) {
        fetch(`/kviz/api/crm/clients/${(cd as ClientFull).referrer_client_id}`, { credentials: 'include' })
          .then(r => r.json()).then(d => { if (d.full_name) setReferrerName(d.full_name); }).catch(() => {});
      }
      const rawDs = (cd as ClientFull).device_settings;
      const dsForm: Record<string, { vacu: string; ik: string }> = {};
      if (rawDs && typeof rawDs === 'object') {
        for (const [k, v] of Object.entries(rawDs)) {
          if (v && typeof v === 'object') {
            dsForm[k] = { vacu: v.vacu != null ? String(v.vacu) : '', ik: v.ik != null ? String(v.ik) : '' };
          } else {
            dsForm[k] = { vacu: '', ik: '' }; // old text value → empty structured
          }
        }
      }
      setImportantForm({
        skirt_size: (cd as ClientFull).skirt_size ?? '',
        device_settings: dsForm,
        contraindications: (cd as ClientFull).contraindications ?? '',
      });
      setLoading(false);
    }).catch(() => setLoading(false));
    loadSummary();
    fetch(`/kviz/api/crm/clients/${clientId}/plans`, { credentials: 'include' })
      .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => setPlans([]));
    fetch('/kviz/api/crm/client-tags', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setAllTags(d); }).catch(() => {});
    fetch('/kviz/api/crm/device-types', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setDeviceTypes(d); }).catch(() => {});
  }, [clientId, loadSummary]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function saveImportant() {
    const dsClean: Record<string, { vacu?: number; ik?: number }> = {};
    for (const [k, v] of Object.entries(importantForm.device_settings)) {
      const vacu = v.vacu.trim() ? Number(v.vacu) : undefined;
      const ik = v.ik.trim() ? Number(v.ik) : undefined;
      if (vacu != null || ik != null) dsClean[k] = { ...(vacu != null ? { vacu } : {}), ...(ik != null ? { ik } : {}) };
    }
    const { ok, data } = await apiJSON('PATCH', `/kviz/api/crm/clients/${clientId}`, {
      skirt_size: importantForm.skirt_size || null,
      device_settings: Object.keys(dsClean).length ? dsClean : {},
      contraindications: importantForm.contraindications || null,
    });
    if (!ok) { toast.error(data.error || 'Ошибка'); return; }
    setClient(prev => prev ? { ...prev, skirt_size: importantForm.skirt_size || null, device_settings: Object.keys(dsClean).length ? dsClean : {}, contraindications: importantForm.contraindications || null } : prev);
    setImportantEdit(false);
    toast.success('Сохранено');
  }

  async function addComment() {
    if (!newComment.trim()) return;
    setSavingComment(true);
    const { ok, data } = await apiJSON('POST', `/kviz/api/crm/clients/${clientId}/comments`, { text: newComment.trim() });
    if (!ok) { toast.error(data.error || 'Ошибка'); setSavingComment(false); return; }
    setNewComment('');
    setSavingComment(false);
    loadFeed();
  }

  async function addTag(tagId: string) {
    const { ok, data } = await apiJSON('POST', `/kviz/api/crm/clients/${clientId}/tags`, { tag_id: tagId });
    if (!ok) { toast.error(data.error || 'Ошибка'); return; }
    loadSummary();
    setTagPickerOpen(false);
  }

  async function removeTag(tagId: string) {
    const { ok, data } = await apiJSON('DELETE', `/kviz/api/crm/clients/${clientId}/tags/${tagId}`);
    if (!ok) { toast.error(data.error || 'Ошибка'); return; }
    loadSummary();
  }

  async function unfreeze(planId: string) {
    if (!await showConfirm('Разморозить абонемент?')) return;
    const { ok, data } = await apiJSON('POST', `/kviz/api/crm/client-plans/${planId}/unfreeze`, {});
    if (!ok) { toast.error(data.error || 'Ошибка'); return; }
    toast.success('Абонемент разморожен');
    setPlans(null);
    fetch(`/kviz/api/crm/clients/${clientId}/plans`, { credentials: 'include' })
      .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => setPlans([]));
  }

  if (loading) return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-popup" style={{ alignItems: 'center', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Загрузка…</div>
      </div>
    </div>
  );
  if (!client) return null;

  const source = adSources.find(s => s.id === client.ad_source_id);
  const dtNameMap = Object.fromEntries(deviceTypes.map(dt => [dt.code, dt.name ?? dt.code]));

  // Plan list filter
  const filteredPlans = (plans ?? []).filter(cp => {
    if (planFilter === 'active') return ['active', 'not_activated', 'frozen'].includes(cp.status);
    if (planFilter === 'closed') return ['expired', 'refunded', 'cancelled'].includes(cp.status);
    return true;
  });

  // Active plans for left column display
  const activePlans = (plans ?? [])
    .filter(p => ['active', 'not_activated', 'frozen'].includes(p.status))
    .sort((a, b) => {
      if (!a.valid_until) return 1;
      if (!b.valid_until) return -1;
      return a.valid_until < b.valid_until ? -1 : 1;
    });
  const displayPlan = activePlans[0] ?? null;
  const extraPlansCount = activePlans.length - 1;

  // Personal tags that are not already on the client
  const personalTagIds = new Set((summary?.personal_tags ?? []).map(t => t.id));
  const unassignedPersonalTags = allTags.filter(t => !t.is_system && !personalTagIds.has(t.id));

  return (
    <>
      <div className="cp-overlay" onClick={onClose}>
        <div className="cp-popup" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">

          {/* Close button — absolute top-right of popup */}
          <button className="cp-close-btn" onClick={onClose} aria-label="Закрыть">✕</button>

          {/* Body: 3 columns */}
          <div className="cp-body" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>

            {/* ── Left column ── */}
            <div className="cp-col cp-col-left">

              {/* Identity block — no avatar, name directly */}
              <div style={{ marginBottom: 8, paddingRight: 28 }}>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: '1.25', wordBreak: 'break-word' }}>{client.full_name}</div>
              </div>

              {/* Phone row */}
              {client.phone && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5 }}>{fmtPhone(client.phone)}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="cp-btn" style={{ fontSize: 11 }}
                      onClick={() => navigator.clipboard.writeText(fmtPhone(client.phone!)).then(() => toast.info('Телефон скопирован'))}>
                      ⎘ Копировать
                    </button>
                    <a href={`https://wa.me/${client.phone}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#25D366', color: '#fff', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
                      WhatsApp
                    </a>
                    <a href={`tel:+${client.phone}`}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--primary)', color: '#fff', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
                      Позвонить
                    </a>
                  </div>
                </div>
              )}

              {/* Birth date + age */}
              {(() => {
                const bd = client.birth_date || (client.iin && client.iin.length >= 7 ? iinToDob(client.iin) : null);
                return (
                  <div style={{ fontSize: 13, marginBottom: 8, color: bd ? 'var(--text)' : 'var(--text-3)' }}>
                    {bd ? `${fmtDate(bd)} · ${ageFromDate(bd)}` : 'Дата рождения не указана'}
                  </div>
                );
              })()}

              {/* Social links */}
              {(client.instagram || client.tiktok || client.email) && (
                <div style={{ fontSize: 12, marginBottom: 8, lineHeight: '1.7', color: 'var(--text-2)' }}>
                  {client.instagram && <div>Instagram @{client.instagram}</div>}
                  {client.tiktok && <div>TikTok @{client.tiktok}</div>}
                  {client.email && <div>{client.email}</div>}
                </div>
              )}

              {/* Fitbase badge + Edit btn */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                {client.fitbase_client_id && (
                  <span style={{ fontSize: 11, background: 'var(--accent-soft, #ede9fe)', color: 'var(--accent)', padding: '1px 7px', borderRadius: 4 }}>Fitbase #{client.fitbase_client_id}</span>
                )}
                {canEdit && <button className="cp-btn" style={{ fontSize: 11 }} onClick={onEdit}>✎ Редактировать</button>}
              </div>

              {/* Tags row */}
              <div className="cp-tags" style={{ marginBottom: 10 }}>
                {(summary?.system_tags ?? []).map(sk => {
                  const def = SYSTEM_TAG_LABELS[sk];
                  if (!def) return null;
                  return <span key={sk} className="cp-tag" style={{ background: def.bg, color: def.color }}>{def.label}</span>;
                })}
                {(summary?.personal_tags ?? []).map(pt => (
                  <span key={pt.id} className="cp-tag cp-tag--personal"
                    style={{ background: pt.color + '22', color: pt.color, border: `1px solid ${pt.color}44` }}>
                    {pt.name}
                    {canEdit && <span style={{ marginLeft: 4, opacity: .7, fontSize: 10, cursor: 'pointer' }} onClick={() => removeTag(pt.id)}>✕</span>}
                  </span>
                ))}
                {canEdit && (
                  <div style={{ position: 'relative' }}>
                    <button className="cp-btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setTagPickerOpen(v => !v)}>+ Метка</button>
                    {tagPickerOpen && unassignedPersonalTags.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 10, minWidth: 160, padding: 4 }}>
                        {unassignedPersonalTags.map(t => (
                          <div key={t.id} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 6 }}
                            onClick={() => addTag(t.id)}>
                            <div style={{ width: 8, height: 8, borderRadius: 4, background: t.color }} />
                            {t.name}
                          </div>
                        ))}
                      </div>
                    )}
                    {tagPickerOpen && unassignedPersonalTags.length === 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: 'var(--text-3)', zIndex: 10, minWidth: 180 }}>
                        Все метки уже назначены
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Info rows */}
              <div style={{ fontSize: 14, lineHeight: '1.6', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {source && (
                  <div className="cp-row"><span className="cp-row-key">Источник</span><span className="cp-row-val">{source.name}{referrerName ? ` / ${referrerName}` : ''}</span></div>
                )}
                <div className="cp-row"><span className="cp-row-key">Клиент с</span><span className="cp-row-val">{fmtDate(client.created_at)}</span></div>
                <div className="cp-row">
                  <span className="cp-row-key">LTV</span>
                  <span className="cp-row-val" style={{ color: 'var(--primary)', fontWeight: 700 }}>{summary ? summary.ltv.toLocaleString('ru-RU') + ' ₸' : '…'}</span>
                </div>
                <div className="cp-row">
                  <span className="cp-row-key">Визитов</span>
                  <span className="cp-row-val">{summary?.visits_attended_total ?? '…'}</span>
                </div>
                {summary?.last_visit_at && (
                  <div className="cp-row"><span className="cp-row-key">Последний визит</span><span className="cp-row-val">{fmtDate(summary.last_visit_at)}</span></div>
                )}
                {balance && balance.deposit > 0 && (
                  <div className="cp-row"><span className="cp-row-key">Депозит</span><span className="cp-row-val" style={{ color: 'var(--success)' }}>{balance.deposit.toLocaleString('ru-RU')} ₸</span></div>
                )}
                {balance && balance.bonus > 0 && (
                  <div className="cp-row"><span className="cp-row-key">Бонусы</span><span className="cp-row-val">{balance.bonus} б.</span></div>
                )}
              </div>

              {/* Active plan */}
              {displayPlan && (
                <div className="cp-window" style={{ marginTop: 12 }}>
                  <div className="cp-window-hdr">
                    Активный абонемент
                    {extraPlansCount > 0 && <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 400 }}>+ещё {extraPlansCount}</span>}
                  </div>
                  <div className="cp-window-body">
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{displayPlan.plan?.name ?? displayPlan.name ?? 'Без названия'}</div>
                    {displayPlan.valid_until && (
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>До: {fmtDate(displayPlan.valid_until)}</div>
                    )}
                    {displayPlan.crm_client_plan_items.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
                        {displayPlan.crm_client_plan_items.map((it, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                            {!it.device_type_code && it.device_type_codes?.length
                              ? `${it.device_type_codes.map(c => dtNameMap[c] ?? c).join(' / ')}: ${it.is_unlimited ? (it.daily_limit ? '1 в день' : '∞') : `${it.sessions_left}/${it.sessions_total}`}`
                              : it.is_unlimited
                                ? `${it.device_type_code ? (dtNameMap[it.device_type_code] ?? it.device_type_code) : '?'}: без лимита${it.daily_limit ? ' · 1 в день' : ''}`
                                : `${it.device_type_code ? (dtNameMap[it.device_type_code] ?? it.device_type_code) : '?'}: ${it.sessions_left}/${it.sessions_total}`
                            }
                          </div>
                        ))}
                      </div>
                    )}
                    {displayPlan.crm_client_plan_items.length === 0 && displayPlan.sessions_left != null && (
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Остаток: {displayPlan.sessions_left}{displayPlan.sessions_total != null ? `/${displayPlan.sessions_total}` : ''} сеансов</div>
                    )}
                    {(() => {
                      const st = PLAN_STATUS[displayPlan.status] ?? { text: displayPlan.status, color: 'var(--text-2)', bg: 'var(--surface-2)' };
                      return <span className="cp-plan-status" style={{ background: st.bg, color: st.color }}>{st.text}</span>;
                    })()}
                    {displayPlan.status === 'active' && canEdit && (
                      <button className="cp-btn" style={{ fontSize: 11, marginTop: 6 }} onClick={() => setFreezeId(displayPlan.id)}>❄ Заморозить</button>
                    )}
                  </div>
                </div>
              )}

              {/* Details accordion */}
              <button className="cp-accord-btn" onClick={() => setInfoOpen(v => !v)}>
                {infoOpen ? '▴' : '▾'} Подробнее
              </button>
              {infoOpen && (
                <div style={{ fontSize: 13, lineHeight: '1.7', paddingTop: 4 }}>
                  {client.iin && <div className="cp-row"><span className="cp-row-key">ИИН</span><span className="cp-row-val">{role === 'admin' ? client.iin : client.iin.slice(0, 6) + '******'}</span></div>}
                  {client.id_issued_by && <div className="cp-row"><span className="cp-row-key">Документ</span><span className="cp-row-val">{client.id_issued_by}</span></div>}
                  {client.id_valid_until && <div className="cp-row"><span className="cp-row-key">Действует до</span><span className="cp-row-val">{fmtDate(client.id_valid_until)}</span></div>}
                  {client.address && <div className="cp-row"><span className="cp-row-key">Адрес</span><span className="cp-row-val">{client.address}</span></div>}
                  {client.gender && <div className="cp-row"><span className="cp-row-key">Пол</span><span className="cp-row-val">{client.gender === 'female' ? 'Женский' : 'Мужской'}</span></div>}
                  {client.notes && <div className="cp-row"><span className="cp-row-key">Заметки</span><span className="cp-row-val">{client.notes}</span></div>}
                </div>
              )}
            </div>

            {/* ── Center column ── */}
            <div className="cp-col cp-col-center">

              {/* Важное */}
              <div className="cp-window">
                <div className="cp-window-hdr">
                  Важное
                  {canEdit && !importantEdit && <button className="cp-btn" style={{ fontSize: 11 }} onClick={() => setImportantEdit(true)}>✎</button>}
                  {importantEdit && <div style={{ display: 'flex', gap: 4 }}><button className="cp-btn cp-btn--primary" style={{ fontSize: 11 }} onClick={saveImportant}>Сохранить</button><button className="cp-btn" style={{ fontSize: 11 }} onClick={() => setImportantEdit(false)}>Отмена</button></div>}
                </div>
                <div className="cp-window-body">
                  {importantEdit ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 2 }}>Размер юбки</label>
                        <select value={importantForm.skirt_size} onChange={e => setImportantForm(f => ({ ...f, skirt_size: e.target.value }))}
                          style={{ width: '100%', padding: '6px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }}>
                          <option value="">— не указан —</option>
                          {['XS','S','M','L','XL','XXL','XXXL'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {deviceTypes.filter(dt => ['vacuactiv', 'infrashape'].includes(dt.code)).map(dt => {
                          const dv = importantForm.device_settings[dt.code] ?? { vacu: '', ik: '' };
                          return (
                            <div key={dt.code} style={{ flex: '1 1 140px', minWidth: 140 }}>
                              <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{dt.name ?? dt.code}</label>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>Vacu</div>
                                  <input type="number" inputMode="numeric" min={0} max={99} value={dv.vacu}
                                    onChange={e => setImportantForm(f => ({ ...f, device_settings: { ...f.device_settings, [dt.code]: { ...dv, vacu: e.target.value } } }))}
                                    style={{ width: '100%', padding: '5px 8px', border: '1.5px solid var(--input-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>ИК</div>
                                  <input type="number" inputMode="numeric" min={0} max={99} value={dv.ik}
                                    onChange={e => setImportantForm(f => ({ ...f, device_settings: { ...f.device_settings, [dt.code]: { ...dv, ik: e.target.value } } }))}
                                    style={{ width: '100%', padding: '5px 8px', border: '1.5px solid var(--input-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 2 }}>Противопоказания</label>
                        <textarea value={importantForm.contraindications} onChange={e => setImportantForm(f => ({ ...f, contraindications: e.target.value }))}
                          style={{ width: '100%', padding: '6px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 48, boxSizing: 'border-box' as const }} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13 }}>
                      {client.skirt_size && <div className="cp-row"><span className="cp-row-key">Юбка</span><span className="cp-row-val">{client.skirt_size}</span></div>}
                      {deviceTypes.filter(dt => ['vacuactiv', 'infrashape'].includes(dt.code)).map(dt => {
                        const val = client.device_settings?.[dt.code];
                        if (!val || typeof val !== 'object') return null;
                        const parts: string[] = [];
                        if (val.vacu != null) parts.push(`Vacu ${val.vacu}`);
                        if (val.ik != null) parts.push(`ИК ${val.ik}`);
                        return parts.length ? <div key={dt.code} style={{ padding: '2px 0', fontSize: 13 }}>{dt.name ?? dt.code} — {parts.join(' · ')}</div> : null;
                      })}
                      {client.contraindications && <div style={{ padding: '4px 0', color: 'var(--danger)', fontSize: 13 }}>Противопоказания: {client.contraindications}</div>}
                      {!client.skirt_size && !Object.values(client.device_settings ?? {}).some(v => v && typeof v === 'object' && (v.vacu != null || v.ik != null)) && !client.contraindications && (
                        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Нет данных</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Пакеты */}
              <div className="cp-window">
                <div className="cp-window-hdr">
                  Пакеты
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['all', 'active', 'closed'] as const).map(f => (
                      <button key={f} className={`cp-btn${planFilter === f ? ' cp-btn--primary' : ''}`} style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setPlanFilter(f)}>
                        {f === 'all' ? 'Все' : f === 'active' ? 'Активные' : 'Закрытые'}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {plans === null && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-3)' }}>Загрузка…</div>}
                  {plans !== null && filteredPlans.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-3)' }}>Пакеты не найдены</div>}
                  {filteredPlans.map(cp => {
                    const st = PLAN_STATUS[cp.status] ?? { text: cp.status, color: 'var(--text-2)', bg: 'var(--surface-2)' };
                    const planName = (cp.plan?.name ?? cp.name ?? cp.plan_id ?? '—') as string;
                    const freezeDays = (cp.plan?.freeze_days ?? 0) as number;
                    const usedDays = (cp.freeze_days_used ?? 0) as number;
                    return (
                      <div key={cp.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{planName}</span>
                          <span className="cp-plan-status" style={{ background: st.bg, color: st.color, flexShrink: 0 }}>{st.text}</span>
                        </div>
                        <div style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 2 }}>
                          {cp.activated_at && <span>Активирован: {fmtDate(cp.activated_at)}</span>}
                          {cp.valid_until && <span style={{ marginLeft: 8 }}>До: {fmtDate(cp.valid_until)}</span>}
                          {cp.source === 'fitbase' && <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: 11 }}>Fitbase</span>}
                        </div>
                        {cp.crm_client_plan_items.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {cp.crm_client_plan_items.map((it, i) => (
                              <span key={i} style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 4 }}>
                                {!it.device_type_code && it.device_type_codes?.length
                                  ? `${it.device_type_codes.map(c => dtNameMap[c] ?? c).join('/')}: ${it.is_unlimited ? (it.daily_limit ? '1/д' : '∞') : `${it.sessions_left}/${it.sessions_total}`}`
                                  : it.is_unlimited
                                    ? `${it.device_type_code ? (dtNameMap[it.device_type_code] ?? it.device_type_code) : '?'}: без лимита`
                                    : `${it.device_type_code ? (dtNameMap[it.device_type_code] ?? it.device_type_code) : '?'}: ${it.sessions_left}/${it.sessions_total}`
                                }
                              </span>
                            ))}
                          </div>
                        )}
                        {cp.source === 'fitbase' && cp.sessions_left != null && cp.crm_client_plan_items.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                            Остаток: {cp.sessions_left}{cp.sessions_total != null ? `/${cp.sessions_total}` : ''} сеансов
                          </div>
                        )}
                        {formatPlanRestriction(cp) && (
                          <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>{formatPlanRestriction(cp)}</div>
                        )}
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                            {cp.status === 'active' && (
                              <button className="cp-btn" style={{ fontSize: 11 }} onClick={() => setFreezeId(cp.id)}>❄ Заморозить</button>
                            )}
                            {cp.status === 'frozen' && (
                              <button className="cp-btn" style={{ fontSize: 11 }} onClick={() => unfreeze(cp.id)}>▶ Разморозить</button>
                            )}
                            {cp.needs_split && (
                              <button className="cp-btn" style={{ fontSize: 11, color: 'var(--warning)' }} onClick={() => setSplitPlan(cp)}>⚡ Распределить</button>
                            )}
                            {freezeDays > 0 && cp.status === 'active' && (
                              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>❄ {freezeDays - usedDays} д. осталось</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Лента */}
              <div className="cp-window">
                <div className="cp-window-hdr">Лента</div>
                <div className="cp-feed-tabs">
                  {(['all', 'comments', 'tasks', 'log'] as const).map(t => (
                    <button key={t} className={`cp-feed-tab${feedTab === t ? ' cp-feed-tab--active' : ''}`} onClick={() => setFeedTab(t)}>
                      {t === 'all' ? 'Всё' : t === 'comments' ? 'Комментарии' : t === 'tasks' ? 'Задачи' : 'Лог'}
                    </button>
                  ))}
                </div>
                {(feedTab === 'all' || feedTab === 'comments') && canEdit && (
                  <div style={{ padding: '8px 14px', display: 'flex', gap: 6 }}>
                    <input value={newComment} onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addComment()}
                      placeholder="Добавить комментарий…"
                      style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                    <button className="cp-btn cp-btn--primary" style={{ fontSize: 12 }} onClick={addComment} disabled={savingComment}>+</button>
                  </div>
                )}
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {feedItems.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-3)' }}>Нет записей</div>}
                  {feedItems.map(item => (
                    <div key={item.id} className="cp-feed-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: item.kind === 'comment' ? 'var(--primary)' : item.kind === 'task' ? 'var(--accent)' : 'var(--text-3)' }}>
                          {item.kind === 'comment' ? '💬' : item.kind === 'task' ? '✓' : '·'} {item.author}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{fmtDT(item.at)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>{item.text}</div>
                      {item.extra?.status && (
                        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
                          Статус: {item.extra.status}{item.extra.due_at ? ` · до ${fmtDate(item.extra.due_at)}` : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Right column ── */}
            <div className="cp-col cp-col-right">

              {/* InBody */}
              <div className="cp-window">
                <div className="cp-window-hdr">
                  InBody
                  {(summary?.inbody_count ?? 0) > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-2)' }}>
                      Тестов: {summary!.inbody_count}, первый {fmtDate(summary!.inbody_first)}
                    </span>
                  )}
                </div>
                <div className="cp-window-body">
                  {summary?.inbody_last ? (
                    <>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDate(summary.inbody_last)}</span>
                          {(() => {
                            const lbl = timerLabel(summary.inbody_last);
                            return lbl ? <span className={`cp-timer ${lbl.cls}`}>{lbl.label}</span> : null;
                          })()}
                        </div>
                        {(() => {
                          const lbl = timerLabel(summary.inbody_last);
                          if (!lbl) return null;
                          const color = lbl.cls === 'cp-timer--ok' ? 'var(--primary)' : lbl.cls === 'cp-timer--warn' ? 'var(--warning,#f59e0b)' : 'var(--danger)';
                          return <div style={{ background: 'var(--border)', borderRadius: 2, height: 3 }}><div style={{ background: color, height: '100%', width: `${lbl.pct}%`, borderRadius: 2 }} /></div>;
                        })()}
                      </div>
                      {summary.inbody_latest && (
                        <div style={{ fontSize: 13 }}>
                          {summary.inbody_latest.weight != null && (
                            <div className="cp-row">
                              <span className="cp-row-key">Вес</span>
                              <span className="cp-row-val">
                                {String(summary.inbody_latest.weight)} кг
                                {summary.inbody_prev?.weight != null && (() => {
                                  const d = Number(summary.inbody_latest!.weight) - Number(summary.inbody_prev!.weight);
                                  if (d === 0) return null;
                                  return <span className={d < 0 ? 'cp-delta-pos' : 'cp-delta-neg'}> {d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
                                })()}
                              </span>
                            </div>
                          )}
                          {summary.inbody_latest.pbf != null && (
                            <div className="cp-row">
                              <span className="cp-row-key">% жира</span>
                              <span className="cp-row-val">
                                {String(summary.inbody_latest.pbf)}%
                                {summary.inbody_prev?.pbf != null && (() => {
                                  const d = Number(summary.inbody_latest!.pbf) - Number(summary.inbody_prev!.pbf);
                                  if (d === 0) return null;
                                  return <span className={d < 0 ? 'cp-delta-pos' : 'cp-delta-neg'}> {d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
                                })()}
                              </span>
                            </div>
                          )}
                          {summary.inbody_latest.weight != null && summary.inbody_latest.ffm != null && (
                            <div className="cp-row">
                              <span className="cp-row-key">Жир кг</span>
                              <span className="cp-row-val">
                                {(Number(summary.inbody_latest.weight) - Number(summary.inbody_latest.ffm)).toFixed(1)} кг
                                {summary.inbody_prev?.weight != null && summary.inbody_prev?.ffm != null && (() => {
                                  const cur = Number(summary.inbody_latest!.weight) - Number(summary.inbody_latest!.ffm);
                                  const prv = Number(summary.inbody_prev!.weight) - Number(summary.inbody_prev!.ffm);
                                  const d = cur - prv;
                                  if (d === 0) return null;
                                  return <span className={d < 0 ? 'cp-delta-pos' : 'cp-delta-neg'}> {d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
                                })()}
                              </span>
                            </div>
                          )}
                          {summary.inbody_latest.smm != null && (
                            <div className="cp-row">
                              <span className="cp-row-key">Мышцы</span>
                              <span className="cp-row-val">
                                {String(summary.inbody_latest.smm)} кг
                                {summary.inbody_prev?.smm != null && (() => {
                                  const d = Number(summary.inbody_latest!.smm) - Number(summary.inbody_prev!.smm);
                                  if (d === 0) return null;
                                  return <span className={d > 0 ? 'cp-delta-pos' : 'cp-delta-neg'}> {d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
                                })()}
                              </span>
                            </div>
                          )}
                          {summary.inbody_latest.bfm != null && (
                            <div className="cp-row"><span className="cp-row-key">BFM</span><span className="cp-row-val">{String(summary.inbody_latest.bfm)} кг</span></div>
                          )}
                          {summary.inbody_latest.bmi != null && (
                            <div className="cp-row"><span className="cp-row-key">ИМТ</span><span className="cp-row-val">{String(summary.inbody_latest.bmi)}</span></div>
                          )}
                          {summary.inbody_latest.bmr != null && (
                            <div className="cp-row"><span className="cp-row-key">BMR</span><span className="cp-row-val">{String(summary.inbody_latest.bmr)} ккал</span></div>
                          )}
                          {summary.inbody_latest.tbw != null && (
                            <div className="cp-row"><span className="cp-row-key">Вода</span><span className="cp-row-val">{String(summary.inbody_latest.tbw)} л</span></div>
                          )}
                          {summary.inbody_latest.inbody_score != null && (
                            <div className="cp-row"><span className="cp-row-key">Баллы</span><span className="cp-row-val">{String(summary.inbody_latest.inbody_score)}</span></div>
                          )}
                        </div>
                      )}
                      {summary.body_client_id && (
                        <button onClick={() => navigate(`/reports/client/${summary.body_client_id}`, { state: { fromCrmClientId: clientId } })}
                          style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                          → Открыть отчёт
                        </button>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Нет InBody</div>
                  )}
                </div>
              </div>

              {/* Замеры */}
              <div className="cp-window" style={{ cursor: summary?.body_client_id ? 'pointer' : undefined }}
                onClick={() => { if (summary?.body_client_id) navigate(`/reports/client/${summary.body_client_id}`, { state: { fromCrmClientId: clientId } }); }}>
                <div className="cp-window-hdr">
                  Замеры тела
                  {(summary?.measure_count ?? 0) > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-2)' }}>
                      Замеров: {summary!.measure_count}, первый {fmtDate(summary!.measure_first?.measured_at as string ?? summary!.measure_last!)}
                    </span>
                  )}
                </div>
                <div className="cp-window-body">
                  {summary?.measure_last ? (
                    <>
                      {/* Timer */}
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDate(summary.measure_last)}</span>
                          {(() => {
                            const lbl = timerLabel(summary.measure_last);
                            return lbl ? <span className={`cp-timer ${lbl.cls}`}>{lbl.label}</span> : null;
                          })()}
                        </div>
                        {(() => {
                          const lbl = timerLabel(summary.measure_last);
                          if (!lbl) return null;
                          const color = lbl.cls === 'cp-timer--ok' ? 'var(--primary)' : lbl.cls === 'cp-timer--warn' ? 'var(--warning,#f59e0b)' : 'var(--danger)';
                          return <div style={{ background: 'var(--border)', borderRadius: 2, height: 3 }}><div style={{ background: color, height: '100%', width: `${lbl.pct}%`, borderRadius: 2 }} /></div>;
                        })()}
                      </div>
                      {/* Total cm — big */}
                      {summary.measure_latest?.total_cm != null && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 20, fontWeight: 700 }}>{String(summary.measure_latest.total_cm)} см</span>
                          {summary.measure_first?.total_cm != null && summary.measure_first.total_cm !== summary.measure_latest.total_cm && (() => {
                            const d = Number(summary.measure_latest!.total_cm) - Number(summary.measure_first!.total_cm);
                            return <span className={d < 0 ? 'cp-delta-pos' : 'cp-delta-neg'} style={{ fontSize: 14, marginLeft: 6 }}>{d > 0 ? '+' : ''}{d} со старта</span>;
                          })()}
                        </div>
                      )}
                      {/* Sparkline */}
                      {(summary.measure_points?.length ?? 0) >= 2 && (
                        <Sparkline pts={(summary.measure_points!).map(p => ({ x: new Date(p.measured_at).getTime(), y: p.total_cm }))} />
                      )}
                      {/* Zone list */}
                      {summary.measure_latest && (
                        <div style={{ fontSize: 13 }}>
                          {summary.measure_latest.weight != null && (
                            <div className="cp-row"><span className="cp-row-key">Вес</span><span className="cp-row-val">{String(summary.measure_latest.weight)} кг</span></div>
                          )}
                          {Object.entries(ZONE_LABELS).map(([zk, zlabel]) => {
                            const cur = summary.measure_latest![zk];
                            if (cur == null) return null;
                            const first = summary.measure_first?.[zk];
                            const delta = first != null && first !== cur ? Number(cur) - Number(first) : null;
                            return (
                              <div key={zk} className="cp-row">
                                <span className="cp-row-key">{zlabel}</span>
                                <span className="cp-row-val">
                                  {String(cur)} см
                                  {delta != null && <span className={delta < 0 ? 'cp-delta-pos' : 'cp-delta-neg'}> {delta > 0 ? '+' : ''}{delta}</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Нет замеров</div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Freeze dialog */}
      {freezeId && (() => {
        const cp = (plans ?? []).find(p => p.id === freezeId);
        const freezeDays = (cp?.plan?.freeze_days ?? 0) as number;
        const usedDays = (cp?.freeze_days_used ?? 0) as number;
        return (
          <FreezeDialog
            planId={freezeId}
            maxDays={role === 'admin' ? 365 : freezeDays - usedDays}
            onDone={() => {
              setFreezeId(null);
              fetch(`/kviz/api/crm/clients/${clientId}/plans`, { credentials: 'include' })
                .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => {});
            }}
            onClose={() => setFreezeId(null)}
          />
        );
      })()}

      {/* Split dialog */}
      {splitPlan && (
        <SplitDialog
          plan={splitPlan}
          onDone={() => {
            setSplitPlan(null);
            fetch(`/kviz/api/crm/clients/${clientId}/plans`, { credentials: 'include' })
              .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => {});
          }}
          onClose={() => setSplitPlan(null)}
        />
      )}
    </>
  );
}

// ── Fitbase import ─────────────────────────────────────────────────────────────

interface ImportJobState {
  status: 'idle' | 'running' | 'done' | 'error';
  total?: number; processed?: number;
  added?: number; updated?: number; skipped?: number;
  errors?: string[];
}

function FitbaseImport({ onDone }: { onDone: () => void }) {
  const [job, setJob]   = useState<ImportJobState>({ status: 'idle' });
  const [error, setError] = useState('');
  const [fillLoading, setFillLoading] = useState(false);
  const [fillResult, setFillResult] = useState<{ updated: number; not_found_sources: string[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function pollStatus() {
    try {
      const r = await fetch('/kviz/api/crm/clients/fitbase-import/status', { credentials: 'include' });
      const d: ImportJobState = await r.json().catch(() => ({ status: 'error' as const }));
      setJob(d);
      if (d.status === 'done') { if (timerRef.current) clearInterval(timerRef.current); onDone(); }
      if (d.status === 'error') { if (timerRef.current) clearInterval(timerRef.current); setError(d.errors?.[0] || 'Ошибка импорта'); }
    } catch {}
  }

  async function run() {
    setError(''); setJob({ status: 'running', total: 0, processed: 0, added: 0, updated: 0, skipped: 0 });
    try {
      const r = await fetch('/kviz/api/crm/clients/fitbase-import', { method: 'POST', credentials: 'include' });
      const d = await r.json().catch(() => null);
      if (!r.ok && r.status !== 409) {
        setJob({ status: 'idle' }); setError(d?.error || `Сервер вернул ошибку (${r.status})`); return;
      }
    } catch { setJob({ status: 'idle' }); setError('Не удалось запустить импорт.'); return; }
    timerRef.current = setInterval(pollStatus, 2000);
    pollStatus();
  }

  async function fillData() {
    setFillLoading(true); setFillResult(null); setError('');
    try {
      const r = await fetch('/kviz/api/crm/clients/fill-fitbase-data', { method: 'POST', credentials: 'include' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error || `Ошибка (${r.status})`); } else { setFillResult(d); onDone(); }
    } catch { setError('Не удалось выполнить дозаполнение.'); }
    setFillLoading(false);
  }

  const running = job.status === 'running';
  const pct = (job.total || 0) > 0 ? Math.round(((job.processed || 0) / job.total!) * 100) : 0;

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Импорт из Fitbase</div>
      {error && <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '6px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {running && (
        <div style={{ marginBottom: 10 }}>
          {(job.total || 0) > 0 ? (
            <>
              <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ background: 'var(--primary)', height: '100%', width: `${pct}%`, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{job.processed} / {job.total} ({pct}%)</div>
            </>
          ) : <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Загрузка данных…</div>}
        </div>
      )}
      {job.status === 'done' && (
        <div style={{ background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
          Всего: {job.total} · Добавлено: <b>{job.added}</b> · Обновлено: {job.updated} · Пропущено: {job.skipped}
        </div>
      )}
      {fillResult && (
        <div style={{ background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
          Дозаполнено: <b>{fillResult.updated}</b>
          {fillResult.not_found_sources.length > 0 && <span style={{ color: 'var(--warning,#f59e0b)', marginLeft: 8 }}>Источники не найдены: {fillResult.not_found_sources.join(', ')}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={{ padding: '8px 16px', background: 'var(--accent)', color: 'var(--surface)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: running ? 'default' : 'pointer', fontFamily: 'inherit', opacity: running ? 0.7 : 1 }} onClick={run} disabled={running}>
          {running ? 'Импортируем…' : 'Запустить импорт'}
        </button>
        <button style={{ padding: '8px 16px', background: 'none', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, cursor: fillLoading ? 'default' : 'pointer', fontFamily: 'inherit', color: 'var(--text)', opacity: fillLoading ? 0.7 : 1 }} onClick={fillData} disabled={fillLoading || running}>
          {fillLoading ? 'Дозаполняем…' : 'Дозаполнить данные'}
        </button>
      </div>
    </div>
  );
}

// ── ClientsTable ───────────────────────────────────────────────────────────────

function ClientsTable({ cols, rows, sortCol, sortDir, activeId, onSort, onRowClick, onColResize, onColReorder }: {
  cols: (ColDef & { width: number })[];
  rows: ClientRow[];
  sortCol: string; sortDir: 'asc' | 'desc';
  activeId: string | null;
  onSort: (col: string, dir: 'asc' | 'desc') => void;
  onRowClick: (id: string) => void;
  onColResize: (key: string, w: number) => void;
  onColReorder: (newOrder: string[]) => void;
}) {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  function startResize(e: React.PointerEvent, key: string, currentW: number) {
    e.preventDefault(); e.stopPropagation();
    resizeRef.current = { key, startX: e.clientX, startW: currentW };
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      onColResize(resizeRef.current.key, Math.max(60, resizeRef.current.startW + ev.clientX - resizeRef.current.startX));
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleDragStart(e: React.DragEvent, key: string) {
    if (key === 'name') { e.preventDefault(); return; }
    setDraggedKey(key); e.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(e: React.DragEvent, targetKey: string) {
    if (!draggedKey || targetKey === draggedKey) return;
    e.preventDefault();
    const keys = cols.map(c => c.key);
    const from = keys.indexOf(draggedKey), to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const nk = [...keys]; nk.splice(from, 1); nk.splice(to, 0, draggedKey);
    const ni = nk.indexOf('name'); if (ni > 0) { nk.splice(ni, 1); nk.unshift('name'); }
    onColReorder(nk); setDraggedKey(null); setDropKey(null);
  }

  function renderCell(row: ClientRow, key: string): React.ReactNode {
    switch (key) {
      case 'name':       return <strong style={{ fontWeight: 600 }}>{row.full_name}</strong>;
      case 'phone':      return row.phone ?? '—';
      case 'plan':       return row.plan_name ? `${row.plan_name}${(row.extra_plans_count ?? 0) > 0 ? ` +${row.extra_plans_count}` : ''}` : '—';
      case 'sessions':   return row.sessions_summary ?? '—';
      case 'last_visit': return fmtDate(row.last_visit_at ?? null);
      case 'days': {
        const d = row.days_since_visit;
        if (d == null) return '—';
        const color = d >= 30 ? 'var(--danger)' : d >= 14 ? 'var(--warning,#f59e0b)' : 'inherit';
        return <span style={{ color }}>{d === 0 ? 'Сегодня' : d}</span>;
      }
      case 'tags': {
        const st = row.system_tags ?? [], pt = row.personal_tags ?? [];
        if (!st.length && !pt.length) return '—';
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {st.map(t => { const info = SYSTEM_TAG_LABELS[t]; return info ? <span key={t} style={{ padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: info.bg, color: info.color }}>{info.label}</span> : null; })}
            {pt.map(t => <span key={t.id} style={{ padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: t.color + '33', color: t.color }}>{t.name}</span>)}
          </div>
        );
      }
      case 'source':     return row.source_name ?? '—';
      case 'ltv':        return row.ltv ? row.ltv.toLocaleString('ru') + ' ₸' : '—';
      case 'created':    return fmtDate(row.created_at);
      case 'birth':      return fmtDate(row.birth_date);
      case 'profile':    return row.profile_complete ? '✓' : '—';
      case 'deposit':    return row.deposit ? row.deposit.toLocaleString('ru') + ' ₸' : '—';
      case 'fitbase':    return row.fitbase_client_id ?? '—';
      default:           return '—';
    }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13, minWidth: cols.reduce((s, c) => s + c.width, 0) }}>
        <colgroup>{cols.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
        <thead>
          <tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            {cols.map(c => (
              <th key={c.key}
                draggable={c.key !== 'name'}
                onDragStart={e => handleDragStart(e, c.key)}
                onDragOver={e => { if (draggedKey && draggedKey !== c.key) { e.preventDefault(); setDropKey(c.key); } }}
                onDrop={e => handleDrop(e, c.key)}
                onDragEnd={() => { setDraggedKey(null); setDropKey(null); }}
                onClick={() => { if (!c.sortable) return; onSort(c.key, sortCol === c.key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'); }}
                style={{
                  padding: '6px 8px 6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                  color: 'var(--text-2)', borderBottom: '2px solid var(--border)',
                  cursor: c.sortable ? 'pointer' : 'default', userSelect: 'none',
                  whiteSpace: 'nowrap', overflow: 'hidden', position: 'relative',
                  background: dropKey === c.key ? 'var(--surface-2)' : draggedKey === c.key ? 'rgba(2,189,182,0.08)' : 'var(--surface)',
                  boxShadow: sortCol === c.key ? 'inset 0 -2px 0 var(--primary)' : 'none',
                }}>
                {c.label}{c.sortable && sortCol === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                <div style={{ position: 'absolute', right: 0, top: 0, width: 5, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                  onPointerDown={e => startResize(e, c.key, c.width)}
                  onDoubleClick={e => { e.stopPropagation(); onColResize(c.key, COL_BY_KEY.get(c.key)?.width ?? 100); }}
                  onClick={e => e.stopPropagation()} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} onClick={() => onRowClick(row.id)}
              style={{ cursor: 'pointer', background: activeId === row.id ? 'rgba(2,189,182,0.06)' : 'var(--surface)' }}>
              {cols.map((c, ci) => (
                <td key={c.key} style={{
                  padding: '7px 8px', borderBottom: '1px solid var(--border)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  borderLeft: ci === 0 && activeId === row.id ? '3px solid var(--primary)' : ci === 0 ? '3px solid transparent' : undefined,
                }}>{renderCell(row, c.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ColumnsPanel ───────────────────────────────────────────────────────────────

function ColumnsPanel({ order, visibleKeys, onToggle, onReorder, onReset, onClose }: {
  order: string[]; visibleKeys: Set<string>;
  onToggle: (key: string) => void; onReorder: (newOrder: string[]) => void;
  onReset: () => void; onClose: () => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const ordered = order.map(k => COL_BY_KEY.get(k)).filter(Boolean) as ColDef[];
  return (
    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 8, minWidth: 210, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Колонки</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--text-3)', lineHeight: 1 }}>✕</button>
      </div>
      {ordered.map(c => (
        <div key={c.key} draggable
          onDragStart={() => setDragging(c.key)}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            if (!dragging || dragging === c.key) return;
            e.preventDefault();
            const nk = [...order]; const fi = nk.indexOf(dragging), ti = nk.indexOf(c.key);
            if (fi >= 0 && ti >= 0) { nk.splice(fi, 1); nk.splice(ti, 0, dragging); }
            const ni = nk.indexOf('name'); if (ni > 0) { nk.splice(ni, 1); nk.unshift('name'); }
            onReorder(nk); setDragging(null);
          }}
          onDragEnd={() => setDragging(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, cursor: 'grab', background: dragging === c.key ? 'var(--surface-2)' : 'transparent' }}>
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>⠿</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer' }}>
            <input type="checkbox" checked={visibleKeys.has(c.key)} disabled={!c.hideable}
              onChange={() => c.hideable && onToggle(c.key)} />
            <span style={{ fontSize: 13 }}>{c.label}</span>
          </label>
        </div>
      ))}
      <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        <button onClick={onReset} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', textDecoration: 'underline' }}>Сбросить вид</button>
      </div>
    </div>
  );
}

// ── Main ClientsPage ───────────────────────────────────────────────────────────

export default function ClientsPage() {
  const bp = useBreakpoint();
  const isMobile = bp === 'phone';

  const [clients, setClients]   = useState<ClientRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [offset, setOffset]     = useState(0);
  const [adSources, setAdSources] = useState<AdSource[]>([]);
  const [search, setSearch]     = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterComplete, setFilterComplete] = useState('');
  const [filterMinDays, setFilterMinDays] = useState('');
  const [loading, setLoading]   = useState(false);
  const [popupId, setPopupId]   = useState<string | null>(() => {
    const m = window.location.hash.match(/^#client=(.+)$/);
    return m ? m[1] : null;
  });
  const [editClient, setEditClient] = useState<ClientFull | null | 'new'>(null);
  const [role, setRole]         = useState('manager');
  const [showImport, setShowImport] = useState(false);
  const [showColPanel, setShowColPanel] = useState(false);
  const [junkReport, setJunkReport] = useState<{ total: number; no_activity: number; examples: { id: string; full_name: string; phone: string | null; created_at: string }[] } | null>(null);

  // Table settings (column order, widths, visibility, sort)
  const [login, setLogin]       = useState('');
  const [ts, setTs]             = useState<TableSettings>(defaultTableSettings);
  const [sortCol, setSortCol]   = useState('last_visit');
  const [sortDir, setSortDir]   = useState<'asc'|'desc'>('desc');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/kviz/api/crm/ad-sources', { credentials: 'include' }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAdSources(d); }).catch(() => {});
    fetch('/kviz/api/me', { credentials: 'include' }).then(r => r.json()).then(d => {
      if (d.role) setRole(d.role);
      if (d.login) {
        setLogin(d.login);
        const saved = loadTableSettings(d.login);
        setTs(saved);
        setSortCol(saved.sortCol);
        setSortDir(saved.sortDir);
      }
    }).catch(() => {});
  }, []);

  function updateTs(patch: Partial<TableSettings>) {
    setTs(prev => {
      const next = { ...prev, ...patch };
      if (login) saveTableSettings(login, next);
      return next;
    });
  }

  // Sync popup ID to URL hash
  useEffect(() => {
    if (popupId) history.replaceState(null, '', window.location.pathname + window.location.search + `#client=${popupId}`);
    else history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [popupId]);

  const load = useCallback(async () => {
    setLoading(true); setOffset(0);
    const params = new URLSearchParams({ limit: '100', offset: '0' });
    if (search) params.set('search', search);
    if (filterSource) params.set('ad_source_id', filterSource);
    if (filterComplete) params.set('profile_complete', filterComplete);
    params.set('sort', sortCol);
    params.set('dir', sortDir);
    if (filterMinDays) params.set('min_days', filterMinDays);
    const r = await fetch(`/kviz/api/crm/clients?${params}`, { credentials: 'include' });
    const d = await r.json();
    const items: ClientRow[] = d?.items ?? (Array.isArray(d) ? d : []);
    setClients(items); setTotal(d?.total ?? items.length); setOffset(items.length);
    setLoading(false);
  }, [search, filterSource, filterComplete, sortCol, sortDir, filterMinDays]);

  async function loadMore() {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100', offset: String(offset) });
    if (search) params.set('search', search);
    if (filterSource) params.set('ad_source_id', filterSource);
    if (filterComplete) params.set('profile_complete', filterComplete);
    params.set('sort', sortCol);
    params.set('dir', sortDir);
    if (filterMinDays) params.set('min_days', filterMinDays);
    const r = await fetch(`/kviz/api/crm/clients?${params}`, { credentials: 'include' });
    const d = await r.json();
    const items: ClientRow[] = d?.items ?? (Array.isArray(d) ? d : []);
    setClients(prev => [...prev, ...items]); setOffset(prev => prev + items.length);
    setLoading(false);
  }

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(load, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [load]);

  function handleSort(col: string, dir: 'asc'|'desc') {
    setSortCol(col); setSortDir(dir);
    updateTs({ sortCol: col, sortDir: dir });
  }

  function handleColResize(key: string, w: number) {
    updateTs({ widths: { ...ts.widths, [key]: w } });
  }

  function handleColReorder(newOrder: string[]) {
    updateTs({ order: newOrder });
  }

  function handleColToggle(key: string) {
    updateTs({ visible: { ...ts.visible, [key]: !ts.visible[key] } });
  }

  function handleReset() {
    const def = defaultTableSettings();
    setTs(def); setSortCol(def.sortCol); setSortDir(def.sortDir);
    if (login) saveTableSettings(login, def);
    setShowColPanel(false);
  }

  async function loadJunkReport() {
    const r = await fetch('/kviz/api/crm/clients/junk-report', { credentials: 'include' });
    const d = await r.json();
    setJunkReport(d);
  }

  async function openEdit(id: string) {
    const r = await fetch(`/kviz/api/crm/clients/${id}`, { credentials: 'include' });
    const d = await r.json();
    setEditClient(d as ClientFull);
    setPopupId(null);
  }

  function onSaved(data: ClientFull) {
    setEditClient(null);
    setPopupId(data.id);
    load();
  }

  // Visible ordered cols with current widths
  const visibleCols = ts.order
    .map(k => COL_BY_KEY.get(k))
    .filter((c): c is ColDef => !!c && ts.visible[c.key] !== false)
    .map(c => ({ ...c, width: ts.widths[c.key] ?? c.width }));

  const visibleKeys = new Set(Object.keys(ts.visible).filter(k => ts.visible[k] !== false));
  const sourceMap = new Map(adSources.map(s => [s.id, s.name]));

  if (editClient !== null) {
    return (
      <div style={{ height: '100vh', overflow: 'auto', background: 'var(--surface-2)', fontFamily: "'Manrope',system-ui,sans-serif" }}>
        <ClientForm
          client={editClient === 'new' ? null : editClient}
          adSources={adSources}
          onSave={onSaved}
          onCancel={() => setEditClient(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' as React.CSSProperties['height'], fontFamily: "'Manrope',system-ui,sans-serif", background: 'var(--surface-2)' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--surface)', flexShrink: 0 }}>
        <input style={SL.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или телефону" />
        <select style={SL.filter} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
          <option value="">Все источники</option>
          {adSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select style={SL.filter} value={filterComplete} onChange={e => setFilterComplete(e.target.value)}>
          <option value="">Все анкеты</option>
          <option value="true">Заполнена</option>
          <option value="false">Не заполнена</option>
        </select>
        <select style={SL.filter} value={filterMinDays} onChange={e => setFilterMinDays(e.target.value)}>
          <option value="">Все визиты</option>
          <option value="7">7+ дн. без визита</option>
          <option value="14">14+ дн.</option>
          <option value="30">30+ дн.</option>
        </select>
        {/* Mobile sort select */}
        {isMobile && (
          <select style={SL.filter} value={`${sortCol}_${sortDir}`} onChange={e => {
            const [col, dir] = e.target.value.split('_') as [string, 'asc'|'desc'];
            handleSort(col, dir);
          }}>
            <option value="last_visit_desc">Визит (новые)</option>
            <option value="last_visit_asc">Визит (старые)</option>
            <option value="days_desc">Дн. без визита ↓</option>
            <option value="name_asc">По имени А→Я</option>
            <option value="created_desc">Новые клиенты</option>
            <option value="ltv_desc">По LTV</option>
          </select>
        )}
        <button style={SL.addBtn} onClick={() => setEditClient('new')}>+ Клиент</button>
        {!isMobile && (
          <div style={{ position: 'relative' }}>
            <button style={SL.outlineBtn} onClick={() => setShowColPanel(v => !v)}>Колонки</button>
            {showColPanel && (
              <ColumnsPanel
                order={ts.order}
                visibleKeys={visibleKeys}
                onToggle={handleColToggle}
                onReorder={handleColReorder}
                onReset={handleReset}
                onClose={() => setShowColPanel(false)}
              />
            )}
          </div>
        )}
        {role === 'admin' && <button style={SL.outlineBtn} onClick={() => setShowImport(v => !v)}>↓ Fitbase</button>}
        {role === 'admin' && <button style={SL.outlineBtn} onClick={loadJunkReport}>Мусор</button>}
      </div>
      {showImport && role === 'admin' && <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}><FitbaseImport onDone={load} /></div>}
      {junkReport && role === 'admin' && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13 }}>
          <strong>Мусорные записи:</strong> всего {junkReport.total}, без активности {junkReport.no_activity}.
          {' '}Примеры: {junkReport.examples.map(e => e.full_name).join(', ')}.
          <button onClick={() => setJunkReport(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-3)' }}>✕</button>
        </div>
      )}

      {/* Table (desktop/tablet) or Cards (mobile) */}
      {loading && <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Загрузка…</div>}
      {!loading && !clients.length && <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>Клиенты не найдены</div>}

      {!isMobile ? (
        <ClientsTable
          cols={visibleCols}
          rows={clients}
          sortCol={sortCol}
          sortDir={sortDir}
          activeId={popupId}
          onSort={handleSort}
          onRowClick={id => setPopupId(id)}
          onColResize={handleColResize}
          onColReorder={handleColReorder}
        />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface)' }}>
          {clients.map(c => (
            <div key={c.id}
              style={{ ...SL.row, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: popupId === c.id ? 'rgba(2,189,182,0.06)' : 'var(--surface)', borderLeft: popupId === c.id ? '3px solid var(--primary)' : '3px solid transparent' }}
              onClick={() => setPopupId(c.id)}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                  {c.phone ?? '—'}
                  {c.birth_date && <span style={{ marginLeft: 8 }}>{fmtDate(c.birth_date)}</span>}
                </div>
                {(c.ad_source_id || c.profile_complete) && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {c.ad_source_id && <span style={SL.chip}>{sourceMap.get(c.ad_source_id) ?? '?'}</span>}
                    {c.profile_complete && <span style={{ ...SL.chip, background: 'var(--success-soft)', color: 'var(--success)' }}>✓</span>}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 12, minWidth: 100 }}>
                {c.plan_name && (
                  <div style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                    {c.plan_name}{(c.extra_plans_count ?? 0) > 0 ? ` +${c.extra_plans_count}` : ''}
                  </div>
                )}
                {c.sessions_summary && <div style={{ color: 'var(--text-2)', marginTop: 1 }}>{c.sessions_summary}</div>}
                {c.days_since_visit != null ? (
                  <div style={{ marginTop: 1, color: (c.days_since_visit ?? 0) >= 30 ? 'var(--danger)' : (c.days_since_visit ?? 0) >= 14 ? 'var(--warning,#f59e0b)' : 'var(--text-3)' }}>
                    {c.days_since_visit === 0 ? 'Сегодня' : `${c.days_since_visit} дн. назад`}
                  </div>
                ) : (
                  !c.plan_name && <div style={{ color: 'var(--text-3)', marginTop: 1 }}>нет визитов</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {clients.length < total && !loading && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <button style={{ ...SL.outlineBtn, width: '100%', fontSize: 12 }} onClick={loadMore}>
            Показать ещё ({total - clients.length})
          </button>
        </div>
      )}
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)', background: 'var(--surface)' }}>
        {clients.length} из {total} клиентов
      </div>

      {/* Popup */}
      {popupId && (
        <PopupErrorBoundary onClose={() => setPopupId(null)}>
          <ClientPopup
            clientId={popupId}
            adSources={adSources}
            role={role}
            onClose={() => setPopupId(null)}
            onEdit={() => openEdit(popupId)}
          />
        </PopupErrorBoundary>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const SF: Record<string, React.CSSProperties> = {
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  iconBtn:   { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-2)', padding: '2px 6px' },
  errBox:    { background: 'var(--danger-soft)', color: 'var(--danger)', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  grid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' },
  label:     { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4, marginTop: 12 },
  inp:       { width: '100%', padding: '9px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  outlineBtn: { padding: '8px 14px', background: 'none', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)', fontWeight: 500 },
  cancelBtn: { padding: '9px 18px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:   { padding: '9px 24px', background: 'var(--primary)', color: 'var(--surface)', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
};

const SL: Record<string, React.CSSProperties> = {
  search:  { flex: 1, minWidth: 160, padding: '7px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  filter:  { padding: '7px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  addBtn:  { padding: '7px 16px', background: 'var(--primary)', color: 'var(--surface)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  outlineBtn: { padding: '7px 12px', background: 'none', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' },
  row:     { padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' },
  chip:    { display: 'inline-block', padding: '1px 7px', borderRadius: 6, fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-2)', fontWeight: 500 },
};
