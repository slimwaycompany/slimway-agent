import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import LeadDrawer from './LeadDrawer';
import StagePopup, { type PopupStage } from './StagePopup';
import { useRole } from '../../lib/permContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StageItem {
  key: string; block: string; type: 'question' | 'check' | 'text' | 'comment';
  label: string; hint?: string; required: boolean; options?: string[];
  who: 'human' | 'auto'; rule?: string | null;
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

interface Lead {
  id: string; title: string | null; name: string | null; surname: string | null;
  phone: string | null; stage_id: string | null; funnel_id: string | null;
  budget: string | null; fb_created_at: string | null; fb_updated_at: string | null;
  is_archived: boolean; is_overdue: boolean; is_duplicate: boolean;
  tags: string[]; fitbase_manager_name: string | null; manager_user_id: string | null;
  description: string | null;
}

interface LostReason { id: string; name: string; }

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

function leadTitle(l: Lead) {
  if (l.title) return l.title;
  const parts = [l.name, l.surname].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (l.phone) return l.phone;
  return 'Без имени';
}

// ── Drag & Drop card ───────────────────────────────────────────────────────────

function DraggableCard({ lead, onClick, isDragging }: { lead: Lead; onClick: () => void; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: lead.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadCard lead={lead} onClick={onClick} />
    </div>
  );
}

function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const bg = lead.is_overdue ? 'var(--danger-soft)' : 'var(--surface)';
  return (
    <div
      style={{ background: bg, borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', cursor: 'pointer', border: '1px solid var(--border)', userSelect: 'none' }}
      onClick={onClick}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4, lineHeight: 1.3 }}>{leadTitle(lead)}</div>
      {lead.budget && Number(lead.budget) > 0 && <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginBottom: 4 }}>{Number(lead.budget).toLocaleString('ru-RU')} ₸</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {lead.fb_created_at && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(lead.fb_created_at)}</span>}
        {lead.fitbase_manager_name && <span style={{ fontSize: 11, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 5px' }}>{lead.fitbase_manager_name.split(' ')[0]}</span>}
        {lead.is_overdue && <span style={{ fontSize: 11, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>просрочено</span>}
        {lead.is_duplicate && <span style={{ fontSize: 11, background: 'var(--warning-soft)', color: '#b45309', borderRadius: 4, padding: '1px 5px' }}>дубль</span>}
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

function StageColumn({ stage, leads, onCardClick }: { stage: Stage; leads: Lead[]; onCardClick: (l: Lead) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });
  const colBg = isOver ? 'rgba(2,189,182,0.06)' : 'transparent';
  return (
    <div
      ref={setNodeRef}
      style={{ minWidth: 220, maxWidth: 280, flex: '0 0 240px', display: 'flex', flexDirection: 'column', background: colBg, borderRadius: 12, transition: 'background 0.15s', height: '100%' }}
    >
      <div style={{ padding: '10px 10px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {stage.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0, display: 'inline-block' }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', flex: 1 }}>{stage.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--surface-2)', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>{leads.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', minHeight: 60 }}>
        {leads.map(l => (
          <DraggableCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
        ))}
        {leads.length === 0 && <div style={{ color: 'var(--border)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>пусто</div>}
      </div>
    </div>
  );
}

// ── Create lead modal ──────────────────────────────────────────────────────────

function CreateLeadModal({ onCreated, onClose }: { onCreated: (lead: Lead) => void; onClose: () => void }) {
  const [name, setName]       = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [dupId, setDupId]     = useState<string | null>(null);

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
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7..." type="tel" style={{ width: '100%', padding: '8px 10px', marginTop: 4, border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }} />
        </div>
        {error && (
          <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>
            {error}
            {dupId && (
              <>
                {' '}
                <button type="button" onClick={() => { onClose(); /* parent will handle open */ window.dispatchEvent(new CustomEvent('crm-open-lead', { detail: dupId })); }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>Открыть</button>
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
  const [syncEnabled, setSyncEnabled]   = useState(true);
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncMsg, setSyncMsg]           = useState('');
  const [dragging, setDragging]         = useState<Lead | null>(null);
  const [openLead, setOpenLead]         = useState<Lead | null>(null);
  const [pendingMove, setPendingMove]   = useState<{ lead: Lead; stage: Stage } | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  // Load funnels + stages + sync status + lost reasons on mount
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
    api('GET', '/kviz/api/crm/leads-sync').then(({ ok, data }) => {
      if (ok) setSyncEnabled((data as Record<string, unknown>).enabled !== false);
    });
    api('GET', '/kviz/api/crm/lost-reasons').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setLostReasons(data as LostReason[]);
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
    const params = new URLSearchParams({ funnel_id: selFunnelId });
    if (search) params.set('search', search);
    if (showArchived) params.set('is_archived', '1');
    api('GET', `/kviz/api/crm/leads?${params}`).then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setLeads(data as Lead[]);
      setLoading(false);
    });
  }, [selFunnelId, search, showArchived]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // Auto-refresh every 60s when no popup/drag
  useEffect(() => {
    if (pendingMove || dragging || openLead || showCreate) {
      if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; }
      return;
    }
    autoRefreshRef.current = setInterval(() => {
      if (!document.hidden) loadLeads();
    }, 60_000);
    return () => { if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; } };
  }, [pendingMove, dragging, openLead, showCreate, loadLeads]);

  function selectFunnel(id: string) {
    setSelFunnelId(id);
    try { sessionStorage.setItem('crm-funnel-id', id); } catch {}
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('Запущена...');
    try {
      await api('POST', '/kviz/api/crm/leads-sync');
      let attempts = 0;
      const poll = async () => {
        const { ok, data } = await api('GET', '/kviz/api/crm/leads-sync');
        if (ok) setSyncMsg((data as Record<string, unknown>).status === 'running' ? `Синхронизация...` : `Готово`);
        if ((data as Record<string, unknown>).status === 'running' && attempts++ < 30) setTimeout(poll, 1000);
        else { setSyncing(false); loadLeads(); }
      };
      setTimeout(poll, 1500);
    } catch { setSyncing(false); setSyncMsg('Ошибка'); }
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
  }

  const funnel = funnels.find(f => f.id === selFunnelId);
  // inbox first, then normal by sort, fail/success last (always visible even when empty)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: "'Manrope',system-ui,sans-serif", background: 'var(--surface-2)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={selFunnelId} onChange={e => selectFunnel(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer', outline: 'none' }}
        >
          {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          type="text" placeholder="Поиск..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 140, padding: '7px 12px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
        />
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
        {syncEnabled && (
          <button
            onClick={handleSync} disabled={syncing}
            style={{ padding: '7px 14px', background: syncing ? 'var(--text-3)' : 'var(--accent)', color: 'var(--surface)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            {syncing ? '⟳ Синхр...' : '↓ Синхр. FB'}
          </button>
        )}
        {syncMsg && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{syncMsg}</span>}
        {loading && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Загрузка...</span>}
      </div>

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 10, padding: '12px 16px', alignItems: 'stretch' }}>
          {stages.map(stage => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={getStageLeads(stage.id)}
              onCardClick={l => setOpenLead(l)}
            />
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
