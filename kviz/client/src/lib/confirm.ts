type ConfirmHandler = (msg: string) => Promise<boolean>;

let _handler: ConfirmHandler | null = null;

export function _registerConfirmHandler(h: ConfirmHandler) { _handler = h; }

export function showConfirm(msg: string): Promise<boolean> {
  if (_handler) return _handler(msg);
  // fallback if provider not mounted
  return Promise.resolve(window.confirm(msg));
}
