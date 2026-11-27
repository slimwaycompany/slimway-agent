import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import LeadDrawer from './LeadDrawer';
import StagePopup, { type PopupStage } from './StagePopup';
import { useRole } from '../../lib/permContext';
import { useLive } from '../../lib/live';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StageItem {
  key: string; block: string;
  type: 'question' | 'check' | 'text' | 'comment' | 'multi' | 'number' | 'date';
  label: string; hint?: string; required: boolean; options?: string[];
  who: 'human' | 'auto'; rule?: string | null;
  allow_other?: boolean; none_option?: string | null; min?: number; max?: number;
  show_if?: { key: string; op: string; value: unknown };
}

interface StageHelper { manager?: string | null; transition?: string | null; important?: string | null; agent?: string | null; }

interface Stage {
  id: string; name: string; kind: string; sort: number;
  is_archived: boolean; color: string | null; background_color: string | null;
  memo: string | null; action_label: string;
  checklist: StageItem[];
  helper?: StageHelper | null;
  require_comment?: boolean;
}

interface Funnel { id: string; name: string; is_active: boolean; stages: Stage[] }

const TEMP_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  hot:      { label: '🔥 Горячий',   color: '#e65100', bg: 'rgba(230,81,0,0.1)' },
  warm:     { label: '🌤 Тёплый',    color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  cold:     { label: '❄️ Холодный',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  stop:     { label: '⛔ Стоп',      color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
  postpone: { label: '⏸ Отложить',  color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
};

interface Lead {
  id: string; title: string | null; name: string | null; surname: string | null;
  phone: string | null; stage_id: string | null; funnel_id: string | null;
  budget: string | null; fb_created_at: string | null; fb_updated_at: string | null;
  is_archived: boolean; is_overdue: boolean; is_duplicate: boolean;
  tags: string[]; fitbase_manager_name: string | null; manager_user_id: string | null;
  ad_source_id: string | null; description: string | null; qualify_temperature?: string | null;
}

interface LostReason { id: string; name: string; }
interface AppUser    { id: string; display_name: string; }
interface AdSource   { id: string; name: string; }
interface LeadTag    { id: string; name: string; color: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

function fmtDate(iso: string | null) {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function formatPhone(raw: string | null) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `+7 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`;
  return raw;
}

function leadTitle(l: Lead) {
  if (l.title) return l.title;
  const parts = [l.name, l.surname].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (l.phone) return l.phone;
  return 'Без имени';
}

function utc5Today(daysAgo = 0) {
  return new Date(Date.now() + 5 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
}

// ── Drag & Drop card ───────────────────────────────────────────────────────────

function DraggableCard({ lead, onClick, isDragging, onMoveClick }: { lead: Lead; onClick: () => void; isDragging?: boolean; onMoveClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: lead.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadCard lead={lead} onClick={onClick} onMoveClick={onMoveClick} />
    </div>
  );
}

function LeadCard({ lead, onClick, onMoveClick }: { lead: Lead; onClick: () => void; onMoveClick?: () => void }) {
  const bg = lead.is_overdue ? 'var(--danger-soft)' : 'var(--surface)';
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
  return (
    <div
      style={{ background: bg, borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', cursor: 'pointer', border: '1px solid var(--border)', userSelect: 'none' }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4, lineHeight: 1.3 }}>{leadTitle(lead)}</div>
        {isMobile && onMoveClick && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMoveClick(); }}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-2)', flexShrink: 0, fontFamily: 'inherit', lineHeight: 1.4 }}
          >
            Этап ▾
          </button>
        )}
      </div>
      {lead.budget && Number(lead.budget) > 0 && <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginBottom: 4 }}>{Number(lead.budget).toLocaleString('ru-RU')} ₸</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {lead.fb_created_at && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(lead.fb_created_at)}</span>}
        {lead.fitbase_manager_name && <span style={{ fontSize: 11, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 5px' }}>{lead.fitbase_manager_name.split(' ')[0]}</span>}
        {lead.is_overdue && <span style={{ fontSize: 11, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>просрочено</span>}
        {lead.is_duplicate && <span style={{ fontSize: 11, background: 'var(--warning-soft)', color: '#b45309', borderRadius: 4, padding: '1px 5px' }}>дубль</span>}
        {lead.qualify_temperature && TEMP_BADGE[lead.qualify_temperature] && (
          <span style={{ fontSize: 11, borderRadius: 4, padding: '1px 5px', fontWeight: 600, background: TEMP_BADGE[lead.qualify_temperature].bg, color: TEMP_BADGE[lead.qualify_temperature].color }}>
            {TEMP_BADGE[lead.qualify_temperature].label}
          </span>
        )}
      </div>
      {lead.tags && lead.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {(lead.tags as string[]).slice(0, 3).map((t, i) => (
            <span key={i} style={{ fontSize: 10, background: 'rgba(2,189,182,0.12)', color: 'var(--primary)', borderRadius: 4, padding: '1px 5px' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stage column ───────────────────────────────────────────────────────────────

function StageColumn({ stage, leads, onCardClick, onMoveClick }: { stage: Stage; leads: Lead[]; onCardClick: (l: Lead) => void; onMoveClick: (l: Lead) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });
  const colBg = isOver ? 'rgba(2,189,182,0.06)' : 'transparent';
  const budgetSum = leads.reduce((s, l) => s + (Number(l.budget) || 0), 0);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
  return (
    <div
      ref={setNodeRef}
      style={{ minWidth: isMobile ? 'calc(100vw - 32px)' : 220, maxWidth: isMobile ? 'calc(100vw - 32px)' : 280, flex: '0 0 240px', display: 'flex', flexDirection: 'column', background: colBg, borderRadius: 12, transition: 'background 0.15s', height: '100%', scrollSnapAlign: isMobile ? 'start' : undefined }}
    >
      <div style={{ padding: '10px 10px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {stage.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0, display: 'inline-block' }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', flex: 1 }}>{stage.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--surface-2)', borderRadius: 10, padding: '1px 7px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {leads.length}{budgetSum > 0 ? ` · ${budgetSum.toLocaleString('ru-RU')} ₸` : ''}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', minHeight: 60 }}>
        {leads.map(l => (
          <DraggableCard key={l.id} lead={l} onClick={() => onCardClick(l)} onMoveClick={() => onMoveClick(l)} />
        ))}
        {leads.length === 0 && <div style={{ color: 'var(--border)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>пусто</div>}
      </div>
    </div>
  );
}

// ── List mode table ────────────────────────────────────────────────────────────

function LeadTable({ leads, stages, adSources, onRowClick, onMoveClick }: {
  leads: Lead[]; stages: Stage[]; adSources: AdSource[];
  onRowClick: (l: Lead) => void; onMoveClick: (l: Lead) => void;
}) {
  const stageMap   = new Map(stages.map(s => [s.id, s]));
  const sourceMap  = new Map(adSources.map(s => [s.id, s.name]));
  const [sortKey, setSortKey]   = useState<string>('fb_created_at');
  const [sortAsc, setSortAsc]   = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sorted = [...leads].sort((a, b) => {
    const va = (a as Record<string, unknown>)[sortKey] ?? '';
    const vb = (b as Record<string, unknown>)[sortKey] ?? '';
    const cmp = String(va).localeCompare(String(vb), 'ru');
    return sortAsc ? cmp : -cmp;
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {sorted.map(l => <LeadCard key={l.id} lead={l} onClick={() => onRowClick(l)} onMoveClick={() => onMoveClick(l)} />)}
        {sorted.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32, fontSize: 14 }}>Нет заявок</div>}
      </div>
    );
  }

  const TH: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' };
  const TD: React.CSSProperties = { padding: '7px 10px', fontSize: 13, verticalAlign: 'middle', borderBottom: '1px solid var(--border)' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '12px 16px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Manrope',system-ui,sans-serif" }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 1 }}>
          <tr>
            {[['title','Имя'],['phone','Телефон'],['stage_id','Этап'],['manager','Менеджер'],['ad_source_id','Источник'],['tags','Теги'],['budget','Бюджет'],['fb_created_at','Создана']].map(([k, lbl]) => (
              <th key={k} style={TH} onClick={() => toggleSort(k)}>
                {lbl}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(l => {
            const stage = stageMap.get(l.stage_id ?? '');
            return (
              <tr key={l.id} onClick={() => onRowClick(l)} style={{ cursor: 'pointer', background: l.is_overdue ? 'var(--danger-soft)' : 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = l.is_overdue ? 'var(--danger-soft)' : 'transparent')}
              >
                <td style={TD}><b>{leadTitle(l)}</b>{l.is_duplicate && <span style={{ marginLeft: 5, fontSize: 10, background: 'var(--warning-soft)', color: '#b45309', borderRadius: 4, padding: '1px 5px' }}>дубль</span>}</td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>{formatPhone(l.phone)}</td>
                <td style={TD}>
                  {stage && <span style={{ background: stage.color ?? 'var(--surface-2)', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600, color: '#fff', textShadow: '0 0 3px rgba(0,0,0,0.5)' }}>{stage.name}</span>}
                </td>
                <td style={TD}>{l.fitbase_manager_name?.split(' ')[0] ?? '—'}</td>
                <td style={TD}>{l.ad_source_id ? (sourceMap.get(l.ad_source_id) ?? '—') : '—'}</td>
                <td style={TD}>
                  {l.tags?.slice(0, 2).map((t, i) => <span key={i} style={{ marginRight: 3, fontSize: 11, background: 'rgba(2,189,182,0.12)', color: 'var(--primary)', borderRadius: 4, padding: '1px 5px' }}>{t}</span>)}
                </td>
                <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--primary)', fontWeight: 700 }}>{l.budget && Number(l.budget) > 0 ? `${Number(l.budget).toLocaleString('ru-RU')} ₸` : ''}</td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtDate(l.fb_created_at)}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)', fontSize: 14 }}>Нет заявок</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Create lead modal ──────────────────────────────────────────────────────────

function CreateLeadModal({ funnels, onCreated, onClose }: { funnels: Funnel[]; onCreated: (lead: Lead) => void; onClose: () => void }) {
  const [name, setName]       = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [dupId, setDupId]     = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<{ leads: Lead[]; clients: { id: string; full_name: string }[] } | null>(null);
  const phoneCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handlePhoneChange(val: string) {
    setPhone(val);
    setDupWarning(null);
    if (phoneCheckRef.current) clearTimeout(phoneCheckRef.current);
    const digits = val.replace(/\D/g, '');
    if (digits.length < 11) return;
    phoneCheckRef.current = setTimeout(() => {
      fetch(`/kviz/api/crm/leads/check-phone?phone=${encodeURIComponent(val)}`, { credentials: 'include' })
        .then(r => r.json())
        .then((d: { leads: Lead[]; clients: { id: string; full_name: string }[] }) => {
          if ((d.leads?.length || 0) + (d.clients?.length || 0) > 0) setDupWarning(d);
        })
        .catch(() => {});
    }, 400);
  }

  async function submit(force?: boolean) {
    setError(''); setDupId(null);
    if (!name.trim()) { setError('Укажите имя'); return; }
    if (!phone.trim()) { setError('Укажите телефон'); return; }
    setLoading(true);
    const { ok, status, data } = await api('POST', '/kviz/api/crm/leads', { name: name.trim(), surname: surname.trim() || undefined, phone: phone.trim(), ...(force ? { force: true } : {}) });
    setLoading(false);
    if (ok) { onCreated(data as Lead); return; }
    if (status === 409 && (data as Record<string, unknown>).error === 'duplicate') {
      setDupId((data as Record<string, unknown>).lead_id as string);
      setError('Уже есть заявка с таким телефоном.');
      return;
    }
    if (status === 422 && (data as Record<string, unknown>).error === 'funnel_not_found') {
      setError('Не найдена активная воронка «Новые заявки»'); return;
    }
    setError((data as Record<string, unknown>).error as string || 'Ошибка');
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
  const allStages = funnels.flatMap(f => f.stages);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: isMobile ? '16px 16px 0 0' : 14, padding: '24px 20px 20px', width: isMobile ? '100%' : 380, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--text)' }}>Новая заявка</div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Имя *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя" style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Фамилия</label>
          <input value={surname} onChange={e => setSurname(e.target.value)} placeholder="Фамилия" style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Телефон *</label>
          <input value={phone} onChange={e => handlePhoneChange(e.target.value)} placeholder="+7..." type="tel" style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        {dupWarning && ((dupWarning.leads?.length ?? 0) + (dupWarning.clients?.length ?? 0) > 0) && (
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10, color: '#92400e' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Найдены совпадения по телефону:</div>
            {dupWarning.leads.map(l => {
              const st = allStages.find(s => s.id === l.stage_id);
              return (
                <div key={l.id} style={{ marginBottom: 3 }}>
                  Заявка: «{leadTitle(l)}»{st ? ` — этап «${st.name}»` : ''}{l.fitbase_manager_name ? ` (${l.fitbase_manager_name.split(' ')[0]})` : ''}
                  {' · '}
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('crm-open-lead', { detail: l.id })); }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>Открыть</button>
                </div>
              );
            })}
            {dupWarning.clients.map(c => (
              <div key={c.id} style={{ marginBottom: 3 }}>Клиент CRM: «{c.full_name}»</div>
            ))}
          </div>
        )}
        {error && (
          <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>
            {error}
            {dupId && (
              <>
                {' '}
                <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('crm-open-lead', { detail: dupId })); }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>Открыть</button>
                {' · '}
                <button type="button" onClick={() => submit(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>Создать всё равно</button>
              </>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
          <button type="button" onClick={() => submit()} disabled={loading} style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function FunnelPage() {
  const role = useRole();
  const isAdmin = role === 'admin';

  const [funnels, setFunnels]           = useState<Funnel[]>([]);
  const [selFunnelId, setSelFunnelId]   = useState<string>('');
  const [leads, setLeads]               = useState<Lead[]>([]);
  const [lostReasons, setLostReasons]   = useState<LostReason[]>([]);
  const [appUsers, setAppUsers]         = useState<AppUser[]>([]);
  const [adSources, setAdSources]       = useState<AdSource[]>([]);
  const [allTags, setAllTags]           = useState<LeadTag[]>([]);
  const [search, setSearch]             = useState('');
  const [dSearch, setDSearch]           = useState(''); // debounced search
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [dragging, setDragging]         = useState<Lead | null>(null);
  const [openLead, setOpenLead]         = useState<Lead | null>(null);
  const [pendingMove, setPendingMove]   = useState<{ lead: Lead; stage: Stage } | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [viewMode, setViewMode]         = useState<'board' | 'list'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('crm-funnel-view') : null;
    return (saved === 'list' || saved === 'board') ? saved as 'board' | 'list' : (typeof window !== 'undefined' && window.innerWidth <= 640 ? 'list' : 'board');
  });
  // Mobile move: pick stage first, then open StagePopup
  const [mobileMoveLead, setMobileMoveLead] = useState<Lead | null>(null);

  // Filters (persisted in localStorage)
  const [fManager,  setFManager]  = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-manager')  ?? '' : ''));
  const [fAdSource, setFAdSource] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-adsource') ?? '' : ''));
  const [fTag,      setFTag]      = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-tag')      ?? '' : ''));
  const [fDateFrom, setFDateFrom] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-from')     ?? '' : ''));
  const [fDateTo,   setFDateTo]   = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-to')       ?? '' : ''));
  const [fDatePreset, setFDatePreset] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('crm-filter-preset') ?? '' : ''));

  const autoRefreshRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchDebRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrl       = useRef<AbortController | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const activeFilterCount = [fManager, fAdSource, fTag, fDateFrom, fDateTo].filter(Boolean).length;

  // Persist filter changes
  useEffect(() => { localStorage.setItem('crm-filter-manager',  fManager);  }, [fManager]);
  useEffect(() => { localStorage.setItem('crm-filter-adsource', fAdSource); }, [fAdSource]);
  useEffect(() => { localStorage.setItem('crm-filter-tag',      fTag);      }, [fTag]);
  useEffect(() => { localStorage.setItem('crm-filter-from',     fDateFrom); }, [fDateFrom]);
  useEffect(() => { localStorage.setItem('crm-filter-to',       fDateTo);   }, [fDateTo]);
  useEffect(() => { localStorage.setItem('crm-filter-preset',   fDatePreset); }, [fDatePreset]);
  useEffect(() => { localStorage.setItem('crm-funnel-view',     viewMode);  }, [viewMode]);

  // Load reference data on mount
  useEffect(() => {
    api('GET', '/kviz/api/crm/funnels').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) {
        const active = (data as Funnel[]).filter(f => f.is_active);
        setFunnels(active);
        const saved = sessionStorage.getItem('crm-funnel-id');
        const first = active[0]?.id ?? '';
        setSelFunnelId(saved && active.find(f => f.id === saved) ? saved : first);
      }
    });
    api('GET', '/kviz/api/crm/lost-reasons').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setLostReasons(data as LostReason[]);
    });
    api('GET', '/kviz/api/crm/app-users').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setAppUsers(data as AppUser[]);
    });
    api('GET', '/kviz/api/crm/ad-sources').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setAdSources(data as AdSource[]);
    });
    api('GET', '/kviz/api/crm/lead-tags').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setAllTags(data as LeadTag[]);
    });
    // Open lead from duplicate link
    const handleOpenLead = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setOpenLead({ id } as Lead);
    };
    window.addEventListener('crm-open-lead', handleOpenLead);
    return () => window.removeEventListener('crm-open-lead', handleOpenLead);
  }, []);

  const loadLeads = useCallback(() => {
    if (!selFunnelId) return;
    setLoading(true);
    if (abortCtrl.current) abortCtrl.current.abort();
    abortCtrl.current = new AbortController();
    const params = new URLSearchParams({ funnel_id: selFunnelId });
    if (dSearch)    params.set('search',          dSearch);
    if (showArchived) params.set('is_archived',   '1');
    if (fManager)   params.set('manager_user_id', fManager);
    if (fAdSource)  params.set('ad_source_id',    fAdSource);
    if (fTag)       params.set('tag',             fTag);
    if (fDateFrom)  params.set('created_from',    fDateFrom);
    if (fDateTo)    params.set('created_to',      fDateTo);
    fetch(`/kviz/api/crm/leads?${params}`, { credentials: 'include', signal: abortCtrl.current.signal })
      .then(r => { if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); } return r.json(); })
      .then(data => { if (Array.isArray(data)) setLeads(data as Lead[]); setLoading(false); })
      .catch(e => { if ((e as Error).name !== 'AbortError') setLoading(false); });
  }, [selFunnelId, dSearch, showArchived, fManager, fAdSource, fTag, fDateFrom, fDateTo]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // SSE realtime refresh; 5-min fallback poll when no popup/drag
  const liveLoadLeads = useCallback(() => {
    if (!pendingMove && !dragging && !openLead && !showCreate && !mobileMoveLead && !document.hidden) loadLeads();
  }, [pendingMove, dragging, openLead, showCreate, mobileMoveLead, loadLeads]);
  useLive(['leads', 'funnels', 'lead_tasks'], liveLoadLeads);

  useEffect(() => {
    if (pendingMove || dragging || openLead || showCreate || mobileMoveLead) {
      if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; }
      return;
    }
    autoRefreshRef.current = setInterval(() => {
      if (!document.hidden) loadLeads();
    }, 5 * 60_000);
    return () => { if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; } };
  }, [pendingMove, dragging, openLead, showCreate, mobileMoveLead, loadLeads]);

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (val.length === 0 || val.length >= 2) {
      searchDebRef.current = setTimeout(() => setDSearch(val), 300);
    }
  }

  function applyDatePreset(preset: string) {
    setFDatePreset(preset);
    if (preset === 'today')     { setFDateFrom(utc5Today());    setFDateTo(utc5Today()); }
    else if (preset === 'yesterday') { setFDateFrom(utc5Today(1)); setFDateTo(utc5Today(1)); }
    else if (preset === '7d')   { setFDateFrom(utc5Today(7));   setFDateTo(''); }
    else if (preset === '30d')  { setFDateFrom(utc5Today(30));  setFDateTo(''); }
    else if (preset === '')     { setFDateFrom('');              setFDateTo(''); }
    // 'custom' — keep existing inputs
  }

  function resetFilters() {
    setFManager(''); setFAdSource(''); setFTag('');
    setFDateFrom(''); setFDateTo(''); setFDatePreset('');
  }

  function selectFunnel(id: string) {
    setSelFunnelId(id);
    try { sessionStorage.setItem('crm-funnel-id', id); } catch {}
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) { setDragging(null); return; }
    const lead = leads.find(l => l.id === active.id);
    if (!lead) { setDragging(null); return; }
    const targetStageId = over.id as string;
    if (lead.stage_id === targetStageId) { setDragging(null); return; }
    const funnel = funnels.find(f => f.id === selFunnelId);
    const targetStage = funnel?.stages.find(s => s.id === targetStageId);
    if (!targetStage) { setDragging(null); return; }
    setDragging(null);
    setPendingMove({ lead, stage: targetStage });
  }

  function handleDragStart(event: DragStartEvent) {
    const lead = leads.find(l => l.id === event.active.id);
    setDragging(lead ?? null);
  }

  async function confirmMove(params: { comment?: string; lost_reason_id?: string; answers?: unknown[] }) {
    if (!pendingMove) return;
    const { lead, stage } = pendingMove;
    setPendingMove(null);
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: stage.id } : l));
    const body: Record<string, unknown> = { stage_id: stage.id };
    if (params.comment)        body.comment        = params.comment;
    if (params.lost_reason_id) body.lost_reason_id = params.lost_reason_id;
    if (params.answers?.length) body.answers       = params.answers;
    const { ok } = await api('POST', `/kviz/api/crm/leads/${lead.id}/move`, body);
    if (!ok) setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: lead.stage_id } : l));
    else loadLeads(); // refresh to pick up auto-moves
  }

  const funnel = funnels.find(f => f.id === selFunnelId);
  const stages = (funnel?.stages ?? [])
    .filter(s => !s.is_archived)
    .sort((a, b) => {
      const rank = (s: Stage) => s.kind === 'inbox' ? -2 : s.kind === 'fail' ? 2 : s.kind === 'success' ? 1 : 0;
      const dr = rank(a) - rank(b);
      return dr !== 0 ? dr : a.sort - b.sort;
    });

  function getStageLeads(stageId: string) {
    return leads.filter(l => l.stage_id === stageId);
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: "'Manrope',system-ui,sans-serif", background: 'var(--surface-2)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={selFunnelId} onChange={e => selectFunnel(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', outline: 'none' }}
        >
          {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          type="text" placeholder="Поиск..." value={search}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ flex: 1, minWidth: 120, padding: '7px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', color: 'var(--text)' }}
        />
        {/* View toggle */}
        <div style={{ display: 'flex', border: '1.5px solid var(--input-border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          {(['board', 'list'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              style={{ padding: '5px 10px', border: 'none', background: viewMode === m ? 'var(--primary)' : 'var(--surface)', color: viewMode === m ? '#fff' : 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
              {m === 'board' ? '⊞' : '☰'}
            </button>
          ))}
        </div>
        {/* Filters button */}
        <button
          onClick={() => setShowFilterPanel(v => !v)}
          style={{ padding: '7px 14px', background: activeFilterCount > 0 ? 'var(--primary)' : 'var(--surface)', color: activeFilterCount > 0 ? '#fff' : 'var(--text-2)', border: '1.5px solid ' + (activeFilterCount > 0 ? 'var(--primary)' : 'var(--input-border)'), borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
        >
          Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Архив
        </label>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '7px 14px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
        >
          + Заявка
        </button>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Загрузка...</span>}
        <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{leads.length} заявок</span>
      </div>

      {/* Filter panel */}
      {showFilterPanel && (
        <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
          <select value={fManager} onChange={e => setFManager(e.target.value)}
            style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">Все менеджеры</option>
            {appUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <select value={fAdSource} onChange={e => setFAdSource(e.target.value)}
            style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">Все источники</option>
            {adSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={fTag} onChange={e => setFTag(e.target.value)}
            style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">Все теги</option>
            {allTags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <select value={fDatePreset} onChange={e => applyDatePreset(e.target.value)}
            style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">Любая дата</option>
            <option value="today">Сегодня</option>
            <option value="yesterday">Вчера</option>
            <option value="7d">7 дней</option>
            <option value="30d">30 дней</option>
            <option value="custom">Свой период</option>
          </select>
          {fDatePreset === 'custom' && (
            <>
              <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)}
                style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }} />
              <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)}
                style={{ padding: '5px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }} />
            </>
          )}
          {activeFilterCount > 0 && (
            <button onClick={resetFilters}
              style={{ padding: '5px 12px', border: '1.5px solid var(--border)', borderRadius: 7, background: 'transparent', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Stage names strip for mobile board scroll */}
      {viewMode === 'board' && isMobile && stages.length > 1 && (
        <div style={{ display: 'flex', overflowX: 'auto', gap: 6, padding: '6px 12px', flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {stages.map(s => (
            <button key={s.id} onClick={() => {
              document.getElementById('stage-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
            }} style={{ flexShrink: 0, padding: '3px 10px', border: 'none', borderRadius: 10, background: s.color ?? 'var(--surface-2)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Board */}
      {viewMode === 'board' ? (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 10, padding: '12px 16px', alignItems: 'stretch', scrollSnapType: isMobile ? 'x mandatory' : undefined }}>
            {stages.map(stage => (
              <div key={stage.id} id={'stage-' + stage.id} style={{ display: 'flex', flex: '0 0 auto' }}>
                <StageColumn
                  stage={stage}
                  leads={getStageLeads(stage.id)}
                  onCardClick={l => setOpenLead(l)}
                  onMoveClick={l => setMobileMoveLead(l)}
                />
              </div>
            ))}
            {stages.length === 0 && !loading && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>
                {funnel ? 'Нет этапов в этой воронке' : 'Выберите воронку'}
              </div>
            )}
          </div>
          <DragOverlay>
            {dragging ? <LeadCard lead={dragging} onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <LeadTable
          leads={leads}
          stages={stages}
          adSources={adSources}
          onRowClick={l => setOpenLead(l)}
          onMoveClick={l => setMobileMoveLead(l)}
        />
      )}

      {/* Mobile stage picker */}
      {mobileMoveLead && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={e => e.target === e.currentTarget && setMobileMoveLead(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: '16px 16px 0 0', width: '100%', maxHeight: '70vh', overflowY: 'auto', padding: '20px 16px 24px' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: 'var(--text)' }}>Выберите этап</div>
            {stages.map(s => (
              <button key={s.id} onClick={() => {
                const lead = mobileMoveLead;
                setMobileMoveLead(null);
                setPendingMove({ lead, stage: s });
              }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', marginBottom: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                {s.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />}
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{s.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>{getStageLeads(s.id).length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stage move confirmation popup */}
      {pendingMove && (
        <StagePopup
          mode="move"
          stage={pendingMove.stage as PopupStage}
          lostReasons={lostReasons}
          onConfirm={confirmMove}
          onCancel={() => setPendingMove(null)}
          leadId={pendingMove.lead.id}
        />
      )}

      {/* Create lead modal */}
      {showCreate && (
        <CreateLeadModal
          funnels={funnels}
          onCreated={lead => { setLeads(prev => [lead, ...prev]); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Lead Drawer */}
      {openLead && (
        <LeadDrawer
          leadId={openLead.id}
          funnels={funnels as unknown as Parameters<typeof LeadDrawer>[0]['funnels']}
          onClose={() => setOpenLead(null)}
          onSaved={updated => {
            setLeads(prev => prev.map(l => l.id === (updated as Lead).id ? { ...l, ...(updated as Lead) } : l));
            setOpenLead(null);
          }}
          onDeleted={id => {
            setLeads(prev => prev.filter(l => l.id !== id));
            setOpenLead(null);
          }}
        />
      )}
    </div>
  );
}
