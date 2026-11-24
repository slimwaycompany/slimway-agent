const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export type PlanRestriction = {
  allowed_weekdays?: number[] | null;
  time_from?: string | null;
  time_to?: string | null;
};

export function formatPlanRestriction(plan: PlanRestriction): string {
  const parts: string[] = [];
  const days = plan.allowed_weekdays;
  if (days && days.length > 0 && days.length < 7) {
    parts.push(compressDays([...days].sort((a, b) => a - b)));
  }
  if (plan.time_from && plan.time_to) {
    parts.push(`${plan.time_from.slice(0, 5)}–${plan.time_to.slice(0, 5)}`);
  }
  return parts.join(' · ');
}

function compressDays(days: number[]): string {
  const ranges: string[] = [];
  let s = days[0], e = days[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i] === e + 1) { e = days[i]; }
    else { ranges.push(rangeStr(s, e)); s = e = days[i]; }
  }
  ranges.push(rangeStr(s, e));
  return ranges.join(', ');
}

function rangeStr(s: number, e: number): string {
  if (s === e) return DAY_SHORT[s];
  if (s + 1 === e) return `${DAY_SHORT[s]}, ${DAY_SHORT[e]}`;
  return `${DAY_SHORT[s]}–${DAY_SHORT[e]}`;
}

// Returns restriction reason or '' if plan matches the given date+slot
export function planMatchesSlot(
  plan: PlanRestriction,
  date: string,   // YYYY-MM-DD
  slot: string,   // HH:MM (may be empty)
): string {
  const days = plan.allowed_weekdays;
  if (days && days.length > 0 && days.length < 7) {
    const dow = new Date(date + 'T12:00:00').getDay();
    const wd = dow === 0 ? 7 : dow;
    if (!days.includes(wd)) {
      return 'Не тот день: ' + (formatPlanRestriction(plan) || '—');
    }
  }
  if (slot && plan.time_from && plan.time_to) {
    const tf = plan.time_from.slice(0, 5);
    const tt = plan.time_to.slice(0, 5);
    if (slot < tf || slot >= tt) {
      return `Не то время: ${tf}–${tt}`;
    }
  }
  return '';
}
