// Asia/Almaty = UTC+5, no DST year-round.
// Weekdays  07:30–22:30
// Weekends  07:30–21:00

function almatyNow(): { h: number; m: number; dow: number } {
  const ms = Date.now() + 5 * 3600 * 1000; // shift to UTC+5
  const d  = new Date(ms);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay() };
}

export function isInWorkWindow(): boolean {
  const { h, m, dow } = almatyNow();
  const t         = h * 60 + m;
  const start     = 7 * 60 + 30;   // 07:30
  const isWeekend = dow === 0 || dow === 6;
  const end       = isWeekend ? 21 * 60 : 22 * 60 + 30;
  return t >= start && t < end;
}
