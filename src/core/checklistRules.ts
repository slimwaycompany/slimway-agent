export interface ShowIfCond {
  key: string;
  op: 'eq' | 'neq' | 'contains' | 'not_contains' | 'not_none' | 'in' | 'gte' | 'lte';
  value: string | string[] | number;
}

export function evalShowIf(
  cond: ShowIfCond,
  answerByKey: Map<string, { option: string; text: string }>,
  multiByKey: Map<string, Set<string>>,
  noneByKey?: Map<string, string | null>
): boolean {
  const a   = answerByKey.get(cond.key);
  const sel = Array.from(multiByKey.get(cond.key) ?? []);
  const opt = a?.option ?? '';
  const txt = a?.text   ?? '';
  switch (cond.op) {
    case 'eq':           return opt === String(cond.value);
    case 'neq':          return opt !== String(cond.value);
    case 'contains':     return sel.includes(String(cond.value)) || opt === String(cond.value);
    case 'not_contains': return !sel.includes(String(cond.value)) && opt !== String(cond.value);
    case 'not_none': {
      const noneId = noneByKey?.get(cond.key) ?? null;
      const realSel = noneId ? sel.filter(id => id !== noneId) : sel;
      return realSel.length > 0 || !!opt || !!txt;
    }
    case 'in':  return Array.isArray(cond.value) && (cond.value as string[]).includes(opt);
    case 'gte': return Number(txt || opt) >= Number(cond.value);
    case 'lte': return Number(txt || opt) <= Number(cond.value);
  }
  return true;
}
