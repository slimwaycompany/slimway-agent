// Rewrite /api/... → /kviz/api/... so the same paths work in dev (proxied) and prod
const pfx = (path: string) => path.startsWith('/api') ? '/kviz' + path : path;

async function req(path: string, opts?: RequestInit) {
  const r = await fetch(pfx(path), { credentials: 'include', ...opts });
  if (r.status === 401) { window.location.href = '/window'; throw new Error('Unauthorized'); }
  return r;
}

export async function apiGet(path: string) {
  const r = await req(path);
  return r.json();
}

export async function apiPost(path: string, body: unknown) {
  const r = await req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function apiPatch(path: string, body: unknown) {
  const r = await req(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function apiDelete(path: string) {
  const r = await req(path, { method: 'DELETE' });
  return r.json();
}
