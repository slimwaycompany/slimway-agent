import * as Dialog from '@radix-ui/react-dialog';

interface Props {
  message: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
}

/** Shared confirm dialog — replaces inline ConfirmModal components. */
export function ConfirmDialog({ message, onConfirm, onClose, confirmLabel = 'Удалить' }: Props) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
          <Dialog.Content
            className="ui-modal-sheet"
            style={{ maxWidth: 400 }}
            onInteractOutside={e => e.preventDefault()}
          >
            <div className="ui-modal-header">
              <Dialog.Title className="ui-modal-title">Подтверждение</Dialog.Title>
            </div>
            <div className="ui-modal-body">
              <p style={{ fontSize: 15, lineHeight: 1.6 }}>{message}</p>
            </div>
            <div className="ui-modal-actions">
              <Dialog.Close asChild>
                <button className="ui-btn ui-btn-secondary" onClick={onClose}>Отмена</button>
              </Dialog.Close>
              <button className="ui-btn ui-btn-danger" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
