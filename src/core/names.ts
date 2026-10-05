// «Имя Ф.» — first name in full, first letter of last name with dot.
// If only one word (nickname) — first 12 chars.
// Phone numbers are never included in event texts.
export function shortName(
  lead?: { name?: unknown; title?: unknown },
  client?: { name?: unknown; surname?: unknown },
): string {
  const rawName = String(client?.name || lead?.name || lead?.title || '');

  // Strip phone-like sequences
  const clean = rawName.replace(/\+?\d[\d\s\-()+]{5,}/g, '').trim();
  if (!clean) return '';

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 12);

  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
}
