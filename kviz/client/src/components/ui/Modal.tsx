import * as Dialog from '@radix-ui/react-dialog';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons pinned to bottom. On mobile: pinned inside sheet. */
  actions?: React.ReactNode;
  wide?: boolean;
  size?: 'wide' | 'xl';
}

/** On desktop: centered overlay. On phone (≤640px): bottom sheet. */
export default function Modal({ title, onClose, children, actions, wide, size }: ModalProps) {
  const sizeClass = size === 'xl' ? ' ui-modal-sheet--xl' : (size === 'wide' || wide) ? ' ui-modal-sheet--wide' : '';
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="ui-modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <Dialog.Content
            className={`ui-modal-sheet${sizeClass}`}
            onInteractOutside={e => e.preventDefault()}
          >
            <div className="ui-modal-header">
              <Dialog.Title className="ui-modal-title">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <button className="ui-modal-close" aria-label="Закрыть">✕</button>
              </Dialog.Close>
            </div>
            <div className="ui-modal-body">{children}</div>
            {actions && <div className="ui-modal-actions">{actions}</div>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
