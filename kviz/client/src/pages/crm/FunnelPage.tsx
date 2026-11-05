import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import LeadDrawer from './LeadDrawer';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stage {
  id: string; name: string; kind: string; sort: number;
  is_archived: boolean; color: string | null; background_color: string | null;
}
interface Funnel { id: string; name: string; stages: Stage[] }

interface Lead {
  id: string; title: string | null; name: string | null; surname: string | null;
  phone: string | null; stage_id: string | null; funnel_id: string | null;
  budget: string | null; fb_created_at: string | null; fb_updated_at: string | null;
  is_archived: boolean; is_overdue: boolean; is_duplicate: boolean;
  tags: string[]; fitbase_manager_name: string | null; manager_user_id: string | null;
  description: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
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
  const bg = lead.is_overdue ? '#fff0f4' : '#fff';
  return (
    <div
      style={{ background: bg, borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', cursor: 'pointer', border: '1px solid #e2e8f0', userSelect: 'none' }}
      onClick={onClick}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: '#1a202c', marginBottom: 4, lineHeight: 1.3 }}>{leadTitle(lead)}</div>
      {lead.budget && <div style={{ fontSize: 12, color: '#02BDB6', fontWeight: 700, marginBottom: 4 }}>{Number(lead.budget).toLocaleString('ru-RU')} ₸</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {lead.fb_created_at && <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtDate(lead.fb_created_at)}</span>}
        {lead.fitbase_manager_name && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>{lead.fitbase_manager_name.split(' ')[0]}</span>}
        {lead.is_overdue && <span style={{ fontSize: 11, background: '#fee2e2', color: '#ef4444', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>просрочено</span>}
        {lead.is_duplicate && <span style={{ fontSize: 11, background: '#fef3c7', color: '#b45309', borderRadius: 4, padding: '1px 5px' }}>дубль</span>}
      </div>
      {lead.tags && lead.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {(lead.tags as string[]).slice(0, 3).map((t, i) => (
            <span key={i} style={{ fontSize: 10, background: 'rgba(2,189,182,0.12)', color: '#02BDB6', borderRadius: 4, padding: '1px 5px' }}>{t}</span>
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
      style={{ minWidth: 220, maxWidth: 280, flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: 0, background: colBg, borderRadius: 12, transition: 'background 0.15s' }}
    >
      <div style={{ padding: '10px 10px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {stage.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0, display: 'inline-block' }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: '0.04em', flex: 1 }}>{stage.name}</span>
        <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>{leads.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', minHeight: 60 }}>
        {leads.map(l => (
          <DraggableCard key={l.id} lead={l} onClick={() => onCardClick(l)} />
        ))}
        {leads.length === 0 && <div style={{ color: '#cbd5e1', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>пусто</div>}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function FunnelPage() {
  const [funnels, setFunnels]           = useState<Funnel[]>([]);
  const [selFunnelId, setSelFunnelId]   = useState<string>('');
  const [leads, setLeads]               = useState<Lead[]>([]);
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncMsg, setSyncMsg]           = useState('');
  const [dragging, setDragging]         = useState<Lead | null>(null);
  const [openLead, setOpenLead]         = useState<Lead | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  // Load funnels + stages
  useEffect(() => {
    api('GET', '/kviz/api/crm/funnels').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) {
        setFunnels(data);
        const saved = sessionStorage.getItem('crm-funnel-id');
        const first = data[0]?.id ?? '';
        setSelFunnelId(saved && data.find((f: Funnel) => f.id === saved) ? saved : first);
      }
    });
  }, []);

  // Load leads when funnel or search changes
  const loadLeads = useCallback(() => {
    if (!selFunnelId) return;
    setLoading(true);
    const params = new URLSearchParams({ funnel_id: selFunnelId });
    if (search) params.set('search', search);
    if (showArchived) params.set('is_archived', '1');
    api('GET', `/kviz/api/crm/leads?${params}`).then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setLeads(data);
      setLoading(false);
    });
  }, [selFunnelId, search, showArchived]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  function handleSearchInput(v: string) {
    setSearch(v);
    if (searchRef.current) clearTimeout(searchRef.current);
  }

  function selectFunnel(id: string) {
    setSelFunnelId(id);
    try { sessionStorage.setItem('crm-funnel-id', id); } catch {}
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('Запущена...');
    try {
      await api('POST', '/kviz/api/crm/leads-sync');
      // poll status
      let attempts = 0;
      const poll = async () => {
        const { ok, data } = await api('GET', '/kviz/api/crm/leads-sync');
        if (ok) setSyncMsg(data.status === 'running' ? `Синхронизация... (${data.leads ?? '?'} лидов)` : `${data.leads ?? '?'} лидов, ${data.tasks ?? '?'} задач — ${data.ms ? Math.round(data.ms/1000)+'с' : ''}`);
        if (data.status === 'running' && attempts++ < 30) setTimeout(poll, 1000);
        else { setSyncing(false); loadLeads(); }
      };
      setTimeout(poll, 1500);
    } catch { setSyncing(false); setSyncMsg('Ошибка'); }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const lead = leads.find(l => l.id === active.id);
    if (!lead) return;
    const targetStageId = over.id as string;
    if (lead.stage_id === targetStageId) return;
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: targetStageId } : l));
    const { ok } = await api('PATCH', `/kviz/api/crm/leads/${lead.id}`, { stage_id: targetStageId });
    if (!ok) setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage_id: lead.stage_id } : l));
  }

  function handleDragStart(event: DragStartEvent) {
    const lead = leads.find(l => l.id === event.active.id);
    setDragging(lead ?? null);
  }

  const funnel = funnels.find(f => f.id === selFunnelId);
  const stages = (funnel?.stages ?? []).filter(s => !s.is_archived).sort((a, b) => a.sort - b.sort);

  function getStageLeads(stageId: string) {
    return leads.filter(l => l.stage_id === stageId);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={selFunnelId}
          onChange={e => selectFunnel(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', fontWeight: 600, color: '#1a202c', background: '#fff', cursor: 'pointer', outline: 'none' }}
        >
          {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          type="text" placeholder="Поиск..." value={search}
          onChange={e => handleSearchInput(e.target.value)}
          style={{ flex: 1, minWidth: 140, padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#64748b', cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Архив
        </label>
        <button
          onClick={handleSync} disabled={syncing}
          style={{ padding: '7px 14px', background: syncing ? '#94a3b8' : '#263CD9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
        >
          {syncing ? '⟳ Синхр...' : '↓ Синхр. FB'}
        </button>
        {syncMsg && <span style={{ fontSize: 12, color: '#64748b' }}>{syncMsg}</span>}
        {loading && <span style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка...</span>}
      </div>

      {/* Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 10, padding: '12px 16px', alignItems: 'flex-start' }}>
          {stages.map(stage => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={getStageLeads(stage.id)}
              onCardClick={l => setOpenLead(l)}
            />
          ))}
          {stages.length === 0 && !loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
              {funnel ? 'Нет этапов в этой воронке' : 'Выберите воронку'}
            </div>
          )}
        </div>
        <DragOverlay>
          {dragging ? <LeadCard lead={dragging} onClick={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Lead Drawer */}
      {openLead && (
        <LeadDrawer
          leadId={openLead.id}
          funnels={funnels}
          onClose={() => setOpenLead(null)}
          onSaved={updated => {
            setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
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
