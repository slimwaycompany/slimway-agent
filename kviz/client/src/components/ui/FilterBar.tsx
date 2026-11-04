import { useState } from 'react';

interface FilterBarProps {
  children: React.ReactNode;
  /** Number of active (non-default) filters. Shows in mobile button badge. */
  activeCount?: number;
}

/**
 * Desktop: children inline, flex-wrap.
 * Phone (≤640px): "Фильтры (N)" button → slide-up panel from bottom.
 */
export default function FilterBar({ children, activeCount = 0 }: FilterBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop inline bar */}
      <div className="ui-filterbar-desktop">{children}</div>

      {/* Mobile toggle button */}
      <div className="ui-filterbar-mobile-btn">
        <button className="ui-filterbar-toggle tap-target" onClick={() => setOpen(true)}>
          Фильтры{activeCount > 0 ? ` (${activeCount})` : ''} ▾
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="ui-filterbar-overlay" onClick={() => setOpen(false)}>
          <div className="ui-filterbar-panel" onClick={e => e.stopPropagation()}>
            <div className="ui-filterbar-panel-header">
              <span>Фильтры</span>
              <button className="ui-modal-close tap-target" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="ui-filterbar-panel-body">{children}</div>
            <div className="ui-filterbar-panel-footer">
              <button className="ui-filterbar-apply tap-target" onClick={() => setOpen(false)}>
                Применить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
