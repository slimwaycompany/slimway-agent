type ToastType = 'error' | 'success' | 'info';
type Handler = (msg: string, type: ToastType) => void;

let _handler: Handler | null = null;

export function _registerToastHandler(h: Handler) { _handler = h; }

export const toast = {
  error:   (msg: string) => _handler?.(msg, 'error'),
  success: (msg: string) => _handler?.(msg, 'success'),
  info:    (msg: string) => _handler?.(msg, 'info'),
};
