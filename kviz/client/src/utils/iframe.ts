export const isEmbedded: boolean = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

export function postToParent(msg: Record<string, unknown>): void {
  if (!isEmbedded) return;
  try { window.parent.postMessage(msg, window.location.origin); } catch {}
}
