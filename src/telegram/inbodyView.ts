export interface DataFields {
  weight_control: number | null;
  bfm_control: number | null;
  ffm_control: number | null;
  target_weight: number | null;
  ideal_weight: number | null;
}

export function extractDataFields(data: Record<string, unknown> | null): DataFields {
  const n = (key: string): number | null => {
    if (!data) return null;
    const v = data[key];
    if (v === null || v === undefined || v === '') return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  };
  return {
    weight_control: n('weight_control'),
    bfm_control:    n('bfm_control'),
    ffm_control:    n('ffm_control'),
    target_weight:  n('target_weight'),
    ideal_weight:   n('ideal_weight'),
  };
}

// returns non-null string (gate) only when weight + weightControl ≈ targetWeight
export function beforeTarget(
  weight: number | null,
  weightControl: number | null,
  targetWeight: number | null,
): string | null {
  if (weight === null || weightControl === null || targetWeight === null) return null;
  return Math.abs(weight + weightControl - targetWeight) <= 0.1 ? 'ok' : null;
}

// current − previous, rounded to 1 decimal; null if either value is null
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

// formats number with 1 decimal and unit; null/undefined → '—'
export function formatValue(x: number | null | undefined, unit: string): string {
  if (x === null || x === undefined) return '—';
  const s = Number(x).toFixed(1);
  return unit ? `${s} ${unit}` : s;
}
