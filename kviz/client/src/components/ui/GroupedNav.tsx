import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, X } from 'lucide-react';
import { useBreakpoint } from '../../lib/useBreakpoint';
import type { LucideIcon } from 'lucide-react';

export interface GroupedNavItem {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export interface GroupedNavGroup {
  id: string;
  label: string;
  items: GroupedNavItem[];
}

interface Props {
  groups: GroupedNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  storageKey: string;
  synonyms?: [string, string][]; // [keyword, itemId]
  flat?: boolean; // skip group headers, show flat list
}

export function GroupedNav({ groups, activeId, onSelect, storageKey, synonyms, flat }: Props) {
  const isMobile = useBreakpoint() !== 'desktop';
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const init = new Set<string>();
    // Open the active section's group
    for (const g of groups) {
      if (g.items.some(i => i.id === activeId)) { init.add(g.id); break; }
    }
    // Restore persisted open groups
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as string[] | null;
      if (Array.isArray(saved)) saved.forEach(id => init.add(id));
    } catch {}
    return init;
  });

  // Ensure active section's group stays open
  useEffect(() => {
    setOpenGroups(prev => {
      for (const g of groups) {
        if (g.items.some(i => i.id === activeId) && !prev.has(g.id)) {
          const next = new Set(prev);
          next.add(g.id);
          return next;
        }
      }
      return prev;
    });
  }, [activeId, groups]);

  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const q = search.toLowerCase().trim();

  function matches(item: GroupedNavItem): boolean {
    if (!q) return true;
    if (item.label.toLowerCase().includes(q)) return true;
    if (synonyms) {
      for (const [kw, sid] of synonyms) {
        if (sid === item.id && kw.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  }

  const displayGroups = groups
    .map(g => ({ ...g, items: g.items.filter(matches) }))
    .filter(g => g.items.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск…"
            style={{
              width: '100%', padding: '6px 28px 6px 10px', fontSize: 13,
              border: '1px solid var(--border)', borderRadius: 7,
              background: 'var(--input-bg)', color: 'var(--text)',
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 2, lineHeight: 1 }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Nav list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {flat ? (
          // Flat list — no group headers
          displayGroups.flatMap(g => g.items).map(item => (
            <NavRow key={item.id} item={item} active={item.id === activeId} isMobile={isMobile} onSelect={onSelect} />
          ))
        ) : (
          displayGroups.map(g => {
            const isOpen = !!q || openGroups.has(g.id);
            const hasActive = !q && g.items.some(i => i.id === activeId);
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => !q && toggleGroup(g.id)}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', height: 34,
                    padding: '0 14px',
                    background: 'var(--surface-2)', border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: q ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {!isOpen && hasActive && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', marginRight: 6, flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left' }}>
                    {g.label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', marginRight: 4 }}>{g.items.length}</span>
                  {!q && (isOpen
                    ? <ChevronDown size={12} strokeWidth={2.5} color="var(--text-3)" />
                    : <ChevronRight size={12} strokeWidth={2.5} color="var(--text-3)" />
                  )}
                </button>
                {isOpen && g.items.map(item => (
                  <NavRow key={item.id} item={item} active={item.id === activeId} isMobile={isMobile} onSelect={onSelect} />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function NavRow({ item, active, isMobile, onSelect }: {
  item: GroupedNavItem; active: boolean; isMobile: boolean; onSelect: (id: string) => void;
}) {
  const { Icon } = item;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      style={{
        display: 'flex', alignItems: 'center', width: '100%',
        padding: isMobile ? '0 16px 0 18px' : '9px 16px 9px 18px',
        height: isMobile ? 48 : 'auto',
        background: active ? 'var(--primary-soft)' : 'none',
        border: 'none', borderBottom: '1px solid var(--border)',
        cursor: 'pointer', gap: 10,
        fontFamily: 'inherit', textAlign: 'left',
        color: active ? 'var(--primary)' : 'var(--text)',
        fontSize: 13, fontWeight: active ? 700 : 500,
      }}
    >
      <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0, color: active ? 'var(--primary)' : 'var(--text-2)' }} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {isMobile && <ChevronRight size={13} strokeWidth={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
    </button>
  );
}
