// Truncate at the first part containing a digit (handles dates like «07.10», phone fragments).
// If all parts are letters: apply «Имя Ф.» for 2+ parts, return single part as-is.
function toShortName(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';

  const digitIdx = parts.findIndex(p => /\d/.test(p));

  if (digitIdx !== -1) {
    // Truncate at the digit part and return verbatim — no abbreviation
    return parts.slice(0, digitIdx).join(' ');
  }

  // All parts are letters
  if (parts.length === 1) return parts[0];

  // 2+ all-letter parts → «Имя Ф.»; skip abbreviation if second word is 1 char
  const second = parts[1];
  if (second.length <= 1) return `${parts[0]} ${second}`;
  return `${parts[0]} ${second.charAt(0).toUpperCase()}.`;
}

// True when the value consists only of phone/digit characters — skip as a name source.
function isPhoneOnly(s: string): boolean {
  return !s.replace(/[\d\s+\-().]/g, '').trim();
}

export function shortName(
  lead?: { id?: unknown; name?: unknown; title?: unknown },
  client?: { name?: unknown; surname?: unknown },
): string {
  // 1. Client: name [+ surname]
  const cn = String(client?.name || '').trim();
  if (cn && !isPhoneOnly(cn)) {
    const cs = String(client?.surname || '').trim();
    const combined = cs ? `${cn} ${cs}` : cn;
    const r = toShortName(combined);
    if (r) return r;
  }

  // 2. Lead name
  const ln = String(lead?.name || '').trim();
  if (ln && !isPhoneOnly(ln)) {
    const r = toShortName(ln);
    if (r) return r;
  }

  // 3. Lead title
  const lt = String(lead?.title || '').trim();
  if (lt && !isPhoneOnly(lt)) {
    const r = toShortName(lt);
    if (r) return r;
  }

  // 4. Fallback
  return lead?.id !== undefined ? `Клиент #${lead.id}` : '';
}
