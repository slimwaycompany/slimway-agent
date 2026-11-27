import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { toast } from '../../lib/toast';
import { showConfirm } from '../../lib/confirm';
import { useLive } from '../../lib/live';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrmStage {
  id: string; name: string; kind: string; sort: number;
  is_archived: boolean; color: string | null; funnel_id: string | null;
  leads_count?: number;
}

interface CrmFunnel {
  id: string; name: string; sort: number; is_active: boolean;
  hidden_system_kinds: string[];
  stages: CrmStage[];
}

// ── API helper ─────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

// ── Color presets ──────────────────────────────────────────────────────────────

const COLORS = ['#02BDB6', '#263CD9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280', '#0ea5e9', '#84cc16'];

function ColorDot({ color, onClick }: { color: string | null; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color ?? 'var(--border)', border: '1.5px solid rgba(0,0,0,0.1)', cursor: onClick ? 'pointer' : 'default', flexShrink: 0 }}
    />
  );
}

function ColorPicker({ value, onChange, onClose }: { value: string | null; onChange: (c: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function outside(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: 'absolute', zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', display: 'flex', flexWrap: 'wrap', gap: 6, width: 148 }}>
      {COLORS.map(c => (
        <span key={c} onClick={() => { onChange(c); onClose(); }}
          style={{ width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', border: value === c ? '2.5px solid var(--text)' : '2px solid transparent', boxSizing: 'border-box' }} />
      ))}
      <span onClick={() => { onChange(null); onClose(); }}
        style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: !value ? '2.5px solid var(--text)' : '2px solid transparent', boxSizing: 'border-box' }}>✕</span>
    </div>
  );
}

// ── Drag handle ────────────────────────────────────────────────────────────────

function DragHandle({ dragRef, attrs, listeners }: { dragRef: (n: HTMLElement | null) => void; attrs: Record<string,unknown>; listeners: Record<string,unknown> | undefined }) {
  return (
    <span ref={dragRef as (n: HTMLSpanElement | null) => void} {...attrs} {...(listeners ?? {})}
      style={{ cursor: 'grab', color: 'var(--text-3)', fontSize: 14, padding: '0 4px', flexShrink: 0, touchAction: 'none', userSelect: 'none' }}
      title="Перетащить">⠿</span>
  );
}

// ── SortableItem (draggable + droppable on same id) ────────────────────────────

function SortableFunnelItem({ funnel, isSelected, activeId, onSelect, onRename, onToggleActive, onResetContent, onDelete, onReloadContent }: {
  funnel: CrmFunnel; isSelected: boolean; activeId: string | null;
  onSelect: () => void; onRename: (name: string) => void; onToggleActive: () => void;
  onResetContent: () => void; onDelete: () => void; onReloadContent: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(funnel.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({ id: funnel.id });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: funnel.id });

  const setRef = useCallback((node: HTMLDivElement | null) => { setDropRef(node); }, [setDropRef]);

  useEffect(() => {
    function outside(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    if (menuOpen) document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menuOpen]);

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
    opacity: activeId === funnel.id ? 0.4 : 1,
    background: isSelected ? 'rgba(2,189,182,0.08)' : isOver ? 'var(--surface-2)' : 'var(--surface)',
    borderRadius: 8,
    border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border)',
    padding: '8px 10px',
    marginBottom: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.1s',
    position: 'relative',
    zIndex: activeId === funnel.id ? 10 : undefined,
  };

  function commitRename() {
    const name = editName.trim();
    if (name && name !== funnel.name) onRename(name);
    setEditing(false);
  }

  return (
    <div ref={setRef} style={style} onClick={() => { if (!editing) onSelect(); }}>
      <DragHandle dragRef={setDragRef} attrs={attributes as Record<string,unknown>} listeners={listeners as Record<string,unknown>} />
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: funnel.is_active ? 'var(--primary)' : 'var(--border)', flexShrink: 0 }} />
      {editing ? (
        <input
          autoFocus value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, border: 'none', outline: '1.5px solid var(--primary)', borderRadius: 4, padding: '1px 4px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
          onDoubleClick={e => { e.stopPropagation(); setEditing(true); setEditName(funnel.name); }}>
          {funnel.name}
        </span>
      )}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-3)', padding: '0 2px', lineHeight: 1 }}>⋯</button>
        {menuOpen && (
          <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 170, padding: 4 }}>
            {(['Переименовать', funnel.is_active ? 'Деактивировать' : 'Активировать', 'Загрузить из таблицы', 'Удалить'] as const).map(label => (
              <div key={label}
                onClick={e => { e.stopPropagation(); setMenuOpen(false);
                  if (label === 'Переименовать') { setEditing(true); setEditName(funnel.name); }
                  else if (label === 'Активировать' || label === 'Деактивировать') onToggleActive();
                  else if (label === 'Загрузить из таблицы') onResetContent();
                  else onDelete();
                }}
                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 5, color: label === 'Удалить' ? 'var(--danger)' : 'var(--text)', userSelect: 'none' }}>
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SortableStageItem ──────────────────────────────────────────────────────────

function SortableStageItem({ stage, funnel, otherStages, activeId, onRename, onToggleArchived, onDelete, onColorChange, onToggleHidden }: {
  stage: CrmStage; funnel: CrmFunnel; otherStages: CrmStage[]; activeId: string | null;
  onRename: (name: string) => void; onToggleArchived: () => void; onDelete: () => void;
  onColorChange: (c: string | null) => void; onToggleHidden: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(stage.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({ id: stage.id });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: stage.id });
  const setRef = useCallback((node: HTMLDivElement | null) => { setDropRef(node); }, [setDropRef]);

  useEffect(() => {
    function outside(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    if (menuOpen) document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menuOpen]);

  const isSystem = stage.kind !== 'normal';
  const isHidden = isSystem && (funnel.hidden_system_kinds ?? []).includes(stage.kind);

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
    opacity: activeId === stage.id ? 0.4 : stage.is_archived ? 0.5 : isHidden ? 0.4 : 1,
    background: isOver ? 'var(--surface-2)' : 'var(--surface)',
    borderRadius: 7,
    border: '1px solid var(--border)',
    padding: '7px 10px',
    marginBottom: 3,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    zIndex: activeId === stage.id ? 10 : undefined,
  };

  function commitRename() {
    const name = editName.trim();
    if (name && name !== stage.name) onRename(name);
    setEditing(false);
  }

  return (
    <div ref={setRef} style={style}>
      {!isSystem && <DragHandle dragRef={setDragRef} attrs={attributes as Record<string,unknown>} listeners={listeners as Record<string,unknown>} />}
      {isSystem && <span style={{ width: 20, flexShrink: 0 }} />}
      <div style={{ position: 'relative' }}>
        <ColorDot color={stage.color} onClick={() => setColorOpen(v => !v)} />
        {colorOpen && <div style={{ position: 'absolute', left: 0, top: 20, zIndex: 50 }}><ColorPicker value={stage.color} onChange={onColorChange} onClose={() => setColorOpen(false)} /></div>}
      </div>
      {editing ? (
        <input
          autoFocus value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
          style={{ flex: 1, fontSize: 13, border: 'none', outline: '1.5px solid var(--primary)', borderRadius: 4, padding: '1px 4px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}
          onDoubleClick={() => { if (!isSystem) { setEditing(true); setEditName(stage.name); } }}>
          {stage.name}
        </span>
      )}
      {stage.leads_count != null && stage.leads_count > 0 && (
        <span style={{ fontSize: 11, background: 'var(--surface-2)', borderRadius: 10, padding: '1px 6px', color: 'var(--text-2)', fontWeight: 600 }}>{stage.leads_count}</span>
      )}
      {isSystem && (
        <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>{stage.kind}</span>
      )}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button onClick={() => setMenuOpen(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-3)', padding: '0 2px', lineHeight: 1 }}>⋯</button>
        {menuOpen && (
          <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 160, padding: 4 }}>
            {!isSystem && (
              <div onClick={() => { setMenuOpen(false); setEditing(true); setEditName(stage.name); }}
                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 5, color: 'var(--text)', userSelect: 'none' }}>
                Переименовать
              </div>
            )}
            {isSystem && (
              <div onClick={() => { setMenuOpen(false); onToggleHidden(); }}
                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 5, color: 'var(--text)', userSelect: 'none' }}>
                {isHidden ? 'Показать в этой воронке' : 'Скрыть в этой воронке'}
              </div>
            )}
            {!isSystem && (
              <div onClick={() => { setMenuOpen(false); onToggleArchived(); }}
                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 5, color: 'var(--text)', userSelect: 'none' }}>
                {stage.is_archived ? 'Восстановить' : 'В архив'}
              </div>
            )}
            {!isSystem && (
              <div onClick={() => { setMenuOpen(false); onDelete(); }}
                style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 5, color: 'var(--danger)', userSelect: 'none' }}>
                Удалить
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function FunnelsSettings() {
  const [funnels, setFunnels] = useState<CrmFunnel[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [err, setErr] = useState('');
  const [newFunnelName, setNewFunnelName] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [deleteMigrateStageId, setDeleteMigrateStageId] = useState<string | null>(null);
  const [deleteMigrateTo, setDeleteMigrateTo] = useState('');
  const [deleteStageLeadCount, setDeleteStageLeadCount] = useState(0);
  const [deleteFunnelId, setDeleteFunnelId] = useState<string | null>(null);
  const [deleteFunnelMigrateTo, setDeleteFunnelMigrateTo] = useState('');
  const [deleteFunnelLeadCount, setDeleteFunnelLeadCount] = useState(0);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const load = useCallback(async () => {
    const r = await api('GET', '/kviz/api/crm/funnels');
    if (r.ok && Array.isArray(r.data)) {
      setFunnels(r.data as CrmFunnel[]);
      if (!selId && (r.data as CrmFunnel[]).length > 0) setSelId((r.data as CrmFunnel[])[0].id);
    }
  }, [selId]);

  useEffect(() => { load(); }, []);
  useLive(['funnels'], load);

  const selFunnel = funnels.find(f => f.id === selId) ?? null;

  const normalStages = (selFunnel?.stages ?? []).filter(s => s.kind === 'normal');
  const systemStages = (selFunnel?.stages ?? []).filter(s => s.kind !== 'normal');
  const hiddenKinds = selFunnel?.hidden_system_kinds ?? [];
  const visibleSystemStages = systemStages.filter(s => !hiddenKinds.includes(s.kind));
  const hiddenSystemStages = systemStages.filter(s => hiddenKinds.includes(s.kind));
  const visibleNormal = showArchived ? normalStages : normalStages.filter(s => !s.is_archived);
  const sortedNormal = [...visibleNormal].sort((a, b) => a.sort - b.sort);

  // ── Funnel actions ───────────────────────────────────────────────────────────

  async function createFunnel() {
    const name = newFunnelName.trim();
    if (!name) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/funnels', { name });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setNewFunnelName('');
    await load();
    setSelId((data as Record<string,unknown>).id as string);
    if (isMobile) setMobileView('detail');
  }

  async function renameFunnel(id: string, name: string) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnels/${id}`, { name });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(f => f.id === id ? { ...f, name } : f));
  }

  async function toggleFunnelActive(f: CrmFunnel) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnels/${f.id}`, { is_active: !f.is_active });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(x => x.id === f.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function resetFunnelContent(id: string) {
    if (!await showConfirm('Загрузить содержимое из таблицы? Настройки всех этапов этой воронки (пункты, подсказки) будут заменены.')) return;
    const { ok, data } = await api('POST', `/kviz/api/crm/funnels/${id}/reset-content`);
    if (ok) { toast.success('Содержимое загружено'); load(); }
    else setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка');
  }

  async function deleteFunnel(id: string) {
    // Check lead count first
    const f = funnels.find(x => x.id === id);
    if (!f) return;
    // Try to delete; if 409 show migration dialog
    const { ok, status, data } = await api('DELETE', `/kviz/api/crm/funnels/${id}`);
    if (ok) {
      setFunnels(prev => prev.filter(x => x.id !== id));
      if (selId === id) setSelId(funnels.filter(x => x.id !== id)[0]?.id ?? null);
      return;
    }
    if (status === 409) {
      const d = data as Record<string,unknown>;
      setDeleteFunnelId(id);
      setDeleteFunnelLeadCount((d.leads_count as number) ?? 0);
      setDeleteFunnelMigrateTo('');
      return;
    }
    setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка удаления воронки');
  }

  async function confirmDeleteFunnel() {
    if (!deleteFunnelId) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/funnels/${deleteFunnelId}`, { move_funnel_id: deleteFunnelMigrateTo || undefined });
    if (ok) {
      setFunnels(prev => prev.filter(x => x.id !== deleteFunnelId));
      if (selId === deleteFunnelId) setSelId(funnels.filter(x => x.id !== deleteFunnelId)[0]?.id ?? null);
      setDeleteFunnelId(null);
    } else {
      setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка');
    }
  }

  async function handleFunnelDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const ids = funnels.map(f => f.id);
    const from = ids.indexOf(active.id as string), to = ids.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    const newOrder = [...ids]; newOrder.splice(from, 1); newOrder.splice(to, 0, active.id as string);
    setFunnels(prev => newOrder.map(id => prev.find(f => f.id === id)!).filter(Boolean));
    api('PATCH', '/kviz/api/crm/funnels/reorder', { order: newOrder }).catch(() => load());
  }

  // ── Stage actions ────────────────────────────────────────────────────────────

  async function createStage() {
    const name = newStageName.trim();
    if (!name || !selId) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/funnel-stages', { name, funnel_id: selId });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setNewStageName('');
    load();
  }

  async function renameStage(id: string, name: string) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnel-stages/${id}`, { name });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(f => ({ ...f, stages: f.stages.map(s => s.id === id ? { ...s, name } : s) })));
  }

  async function toggleStageArchived(stage: CrmStage) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnel-stages/${stage.id}`, { is_archived: !stage.is_archived });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(f => ({ ...f, stages: f.stages.map(s => s.id === stage.id ? { ...s, is_archived: !s.is_archived } : s) })));
  }

  async function changeStageColor(id: string, color: string | null) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnel-stages/${id}`, { color });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(f => ({ ...f, stages: f.stages.map(s => s.id === id ? { ...s, color } : s) })));
  }

  async function deleteStage(stage: CrmStage) {
    const { ok, status, data } = await api('DELETE', `/kviz/api/crm/funnel-stages/${stage.id}`);
    if (ok) { load(); return; }
    if (status === 409) {
      const d = data as Record<string,unknown>;
      if (d.leads_count) {
        setDeleteMigrateStageId(stage.id);
        setDeleteStageLeadCount(d.leads_count as number);
        setDeleteMigrateTo('');
        return;
      }
      setErr(d.error as string ?? 'Нельзя удалить');
      return;
    }
    setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка удаления');
  }

  async function confirmDeleteStage() {
    if (!deleteMigrateStageId) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/funnel-stages/${deleteMigrateStageId}`, { move_to: deleteMigrateTo || undefined });
    if (ok) { setDeleteMigrateStageId(null); load(); }
    else setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка');
  }

  async function toggleHiddenSystemKind(kind: string) {
    if (!selFunnel) return;
    const current = selFunnel.hidden_system_kinds ?? [];
    const next = current.includes(kind) ? current.filter(k => k !== kind) : [...current, kind];
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnels/${selFunnel.id}`, { hidden_system_kinds: next });
    if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setFunnels(prev => prev.map(f => f.id === selFunnel.id ? { ...f, hidden_system_kinds: next } : f));
  }

  async function handleStageDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null);
    if (!over || active.id === over.id || !selFunnel) return;
    const ids = sortedNormal.map(s => s.id);
    const from = ids.indexOf(active.id as string), to = ids.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    const newOrder = [...ids]; newOrder.splice(from, 1); newOrder.splice(to, 0, active.id as string);
    // Optimistic update
    setFunnels(prev => prev.map(f => {
      if (f.id !== selFunnel.id) return f;
      const sortMap = new Map(newOrder.map((id, i) => [id, i]));
      return { ...f, stages: f.stages.map(s => s.kind !== 'normal' ? s : { ...s, sort: sortMap.get(s.id) ?? s.sort }) };
    }));
    api('PATCH', '/kviz/api/crm/funnel-stages/reorder', { order: newOrder }).catch(() => load());
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const leftVisible = !isMobile || mobileView === 'list';
  const rightVisible = !isMobile || mobileView === 'detail';

  const S = {
    panel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
    panelHeader: { padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 8 },
    panelBody: { flex: 1, overflowY: 'auto' as const, padding: '8px 10px' },
    inp: { padding: '7px 10px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' as const },
    addBtn: { padding: '7px 14px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 as const },
  };

  return (
    <div>
      {err && (
        <div style={{ marginBottom: 10, padding: '8px 14px', background: 'var(--danger-soft,#fee2e2)', borderRadius: 8, color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{err}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--danger)' }} onClick={() => setErr('')}>✕</button>
        </div>
      )}

      {/* Delete stage migration dialog */}
      {deleteMigrateStageId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Удалить этап</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>В этапе {deleteStageLeadCount} заявок. Выберите куда перенести перед удалением:</div>
            <select value={deleteMigrateTo} onChange={e => setDeleteMigrateTo(e.target.value)}
              style={{ ...S.inp, marginBottom: 14 }}>
              <option value="">— выберите этап —</option>
              {(selFunnel?.stages ?? []).filter(s => s.id !== deleteMigrateStageId && !s.is_archived).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={{ padding: '7px 16px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }} onClick={() => setDeleteMigrateStageId(null)}>Отмена</button>
              <button style={{ padding: '7px 16px', border: 'none', borderRadius: 7, background: 'var(--danger)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }} onClick={confirmDeleteStage} disabled={!deleteMigrateTo}>Удалить и перенести</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete funnel migration dialog */}
      {deleteFunnelId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Удалить воронку</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>В воронке {deleteFunnelLeadCount} активных заявок. Выберите воронку для переноса:</div>
            <select value={deleteFunnelMigrateTo} onChange={e => setDeleteFunnelMigrateTo(e.target.value)}
              style={{ ...S.inp, marginBottom: 14 }}>
              <option value="">— выберите воронку —</option>
              {funnels.filter(f => f.id !== deleteFunnelId).map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={{ padding: '7px 16px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }} onClick={() => setDeleteFunnelId(null)}>Отмена</button>
              <button style={{ padding: '7px 16px', border: 'none', borderRadius: 7, background: 'var(--danger)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }} onClick={confirmDeleteFunnel} disabled={!deleteFunnelMigrateTo}>Удалить и перенести</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: isMobile ? 'wrap' : undefined }}>

        {/* Left panel: funnel list */}
        {leftVisible && (
          <div style={{ ...S.panel, width: isMobile ? '100%' : 240, flexShrink: 0 }}>
            <div style={S.panelHeader}>
              Воронки
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>перетащить для порядка</span>
            </div>
            <div style={S.panelBody}>
              <DndContext sensors={sensors}
                onDragStart={({ active }: DragStartEvent) => setActiveDragId(active.id as string)}
                onDragEnd={handleFunnelDragEnd}
                onDragCancel={() => setActiveDragId(null)}>
                {funnels.map(f => (
                  <SortableFunnelItem key={f.id} funnel={f} isSelected={selId === f.id} activeId={activeDragId}
                    onSelect={() => { setSelId(f.id); if (isMobile) setMobileView('detail'); }}
                    onRename={name => renameFunnel(f.id, name)}
                    onToggleActive={() => toggleFunnelActive(f)}
                    onResetContent={() => resetFunnelContent(f.id)}
                    onDelete={() => deleteFunnel(f.id)}
                    onReloadContent={() => load()}
                  />
                ))}
                <DragOverlay>
                  {activeDragId && funnels.find(f => f.id === activeDragId) && (
                    <div style={{ background: 'var(--surface)', border: '1.5px solid var(--primary)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                      {funnels.find(f => f.id === activeDragId)?.name}
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            </div>
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <input style={{ ...S.inp, flex: 1, fontSize: 12 }} placeholder="Новая воронка"
                value={newFunnelName} onChange={e => setNewFunnelName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFunnel()} />
              <button style={{ ...S.addBtn, fontSize: 12, padding: '7px 10px' }} onClick={createFunnel}>+</button>
            </div>
          </div>
        )}

        {/* Right panel: stages */}
        {rightVisible && (
          <div style={{ ...S.panel, flex: 1, minWidth: 0 }}>
            <div style={S.panelHeader}>
              {isMobile && (
                <button onClick={() => setMobileView('list')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--primary)', fontWeight: 700, padding: 0, fontFamily: 'inherit' }}>
                  ← Назад
                </button>
              )}
              <span style={{ flex: 1 }}>{selFunnel?.name ?? 'Выберите воронку'} — Этапы</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer', fontWeight: 400 }}>
                <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                Архив
              </label>
            </div>
            {selFunnel ? (
              <div style={S.panelBody}>
                {/* System stages */}
                {visibleSystemStages.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4, paddingLeft: 2 }}>Системные</div>
                    {visibleSystemStages.map(s => (
                      <SortableStageItem key={s.id} stage={s} funnel={selFunnel} otherStages={[]} activeId={activeDragId}
                        onRename={() => {}} onToggleArchived={() => {}} onDelete={() => {}}
                        onColorChange={c => changeStageColor(s.id, c)}
                        onToggleHidden={() => toggleHiddenSystemKind(s.kind)}
                      />
                    ))}
                  </div>
                )}

                {/* Normal stages */}
                {sortedNormal.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4, paddingLeft: 2 }}>Этапы воронки</div>
                    <DndContext sensors={sensors}
                      onDragStart={({ active }: DragStartEvent) => setActiveDragId(active.id as string)}
                      onDragEnd={handleStageDragEnd}
                      onDragCancel={() => setActiveDragId(null)}>
                      {sortedNormal.map(s => (
                        <SortableStageItem key={s.id} stage={s} funnel={selFunnel} otherStages={sortedNormal} activeId={activeDragId}
                          onRename={name => renameStage(s.id, name)}
                          onToggleArchived={() => toggleStageArchived(s)}
                          onDelete={() => deleteStage(s)}
                          onColorChange={c => changeStageColor(s.id, c)}
                          onToggleHidden={() => {}}
                        />
                      ))}
                      <DragOverlay>
                        {activeDragId && sortedNormal.find(s => s.id === activeDragId) && (
                          <div style={{ background: 'var(--surface)', border: '1.5px solid var(--primary)', borderRadius: 7, padding: '7px 10px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                            {sortedNormal.find(s => s.id === activeDragId)?.name}
                          </div>
                        )}
                      </DragOverlay>
                    </DndContext>
                  </div>
                )}

                {/* Hidden system stages */}
                {hiddenSystemStages.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none', marginBottom: 4 }}>Скрытые ({hiddenSystemStages.length})</summary>
                    <div style={{ paddingLeft: 4 }}>
                      {hiddenSystemStages.map(s => (
                        <SortableStageItem key={s.id} stage={s} funnel={selFunnel} otherStages={[]} activeId={activeDragId}
                          onRename={() => {}} onToggleArchived={() => {}} onDelete={() => {}}
                          onColorChange={c => changeStageColor(s.id, c)}
                          onToggleHidden={() => toggleHiddenSystemKind(s.kind)}
                        />
                      ))}
                    </div>
                  </details>
                )}

                {/* New stage input */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <input style={{ ...S.inp, flex: 1, fontSize: 12 }} placeholder="Новый этап"
                    value={newStageName} onChange={e => setNewStageName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createStage()} />
                  <button style={{ ...S.addBtn, fontSize: 12, padding: '7px 10px' }} onClick={createStage}>+</button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Выберите воронку слева</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
