import { useEffect } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons pinned to bottom. On mobile: pinned inside sheet. */
  actions?: React.ReactNode;
  wide?: boolean;
}

/** On desktop: centered overlay. On phone (≤640px): bottom sheet. */
export default function Modal({ title, onClose, children, actions, wide }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="ui-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`ui-modal-sheet${wide ? ' ui-modal-sheet--wide' : ''}`}>
        <div className="ui-modal-header">
          <span className="ui-modal-title">{title}</span>
          <button className="ui-modal-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {actions && <div className="ui-modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
