export interface ItemForLabel {
  device_type_code?: string | null;
  device_type_codes?: string[] | null;
  sessions?: number | null;
  is_unlimited?: boolean | null;
  daily_limit?: number | null;
  sessions_left?: number | null;
  sessions_total?: number | null;
}

export function itemLabel(item: ItemForLabel, dtNameMap: Record<string, string>): string {
  const isPool = Array.isArray(item.device_type_codes) && item.device_type_codes.length > 0;
  let nameStr: string;
  if (isPool) {
    nameStr = 'Cross: ' + (item.device_type_codes as string[]).map(c => dtNameMap[c] ?? c).join(' / ');
  } else {
    const code = item.device_type_code ?? '';
    nameStr = dtNameMap[code] ?? (code || '?');
  }

  if (item.is_unlimited) {
    return nameStr + (item.daily_limit ? ` (${item.daily_limit} в день)` : ' ∞');
  }

  if (item.sessions_left !== undefined && item.sessions_left !== null &&
      item.sessions_total !== undefined && item.sessions_total !== null) {
    return `${nameStr} — ${item.sessions_left} из ${item.sessions_total}`;
  }

  return `${nameStr} ×${item.sessions ?? '?'}`;
}
