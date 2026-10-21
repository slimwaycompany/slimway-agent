// InBody QR string parser.
// Format documented from physical sheet 2026-10-17 and verified against sample string.

export interface InBodyData {
  raw: string;
  device_id: string;
  phone: string;          // +7XXXXXXXXXX
  height_cm: number;
  age: number;
  gender: 'M' | 'F';
  measured_at: string;    // ISO date-time (UTC)
  weight_kg: number;
  weight_norm: [number, number];
  protein_kg: number;
  protein_norm: [number, number];
  minerals_kg: number;
  minerals_norm: [number, number];
  fat_kg: number;
  fat_norm: [number, number];
  water_l: number;
  water_norm: [number, number];
  lean_kg: number;        // = weight - fat
  lean_norm: [number, number];
  skeletal_muscle_kg: number;
  bmr_kcal: number;
  whr: number;            // waist-hip ratio
  whr_norm: [number, number];
  // weight control targets (if negative: need to lose)
  weight_control_kg: number;
  fat_control_kg: number;
  muscle_control_kg: number;
  ideal_weight_kg: number;
  obesity_pct: number;    // % of normal obesity level (norm: 90–110%)
  // segment data
  lean_by_segment: { right_arm: number; left_arm: number; trunk: number; right_leg: number; left_leg: number };
  fat_by_segment:  { right_arm: number; left_arm: number; trunk: number; right_leg: number; left_leg: number };
  lean_pct_norm_by_segment: { right_arm: number; left_arm: number; trunk: number; right_leg: number; left_leg: number };
  fat_pct_norm_by_segment:  { right_arm: number; left_arm: number; trunk: number; right_leg: number; left_leg: number };
  // derived
  bmi: number;
  fat_pct: number;
}

function g4(s: string, pos: number): number {
  return parseInt(s.slice(pos * 4, pos * 4 + 4), 10);
}
function g4f(s: string, pos: number, divisor = 10): number {
  return Math.round(g4(s, pos) / divisor * 10) / 10;
}
function sign4(raw: string): number {
  // parses +0095 or -0012 → ±9.5
  const sign = raw[0] === '-' ? -1 : 1;
  return sign * parseInt(raw.slice(1), 10) / 10;
}
function seg5(s: string, pos: number, div = 100): { right_arm: number; left_arm: number; trunk: number; right_leg: number; left_leg: number } {
  const base = pos * 4;
  const v = (i: number) => Math.round(parseInt(s.slice(base + i * 4, base + i * 4 + 4), 10) / div * 1000) / 1000;
  return { right_arm: v(0), left_arm: v(1), trunk: v(2), right_leg: v(3), left_leg: v(4) };
}

export function parseInBody(raw: string): InBodyData | null {
  try {
    // ── Header: device ID + user phone (padded with !)
    const excl = raw.indexOf('!');
    if (excl < 0) return null;
    const device_id = raw.slice(0, excl).replace(/\d+$/, m => {
      // device serial ends where the user ID (numeric) begins
      return '';
    });
    // More precise: find where digits-only run starts after the device prefix
    const deviceMatch = raw.match(/^(270-[A-Z0-9]+?)(\d{9,12})(!+)/);
    if (!deviceMatch) return null;
    const device_id_clean = deviceMatch[1];
    const rawPhone = deviceMatch[2];
    // Normalize phone: 8XXXXXXXXXX → +7... or 7XXXXXXXXXX → +7...
    let phone = rawPhone;
    if (phone.startsWith('8') && phone.length === 11) phone = '7' + phone.slice(1);
    if (!phone.startsWith('7')) return null;
    phone = '+' + phone;

    // ── After header: find position after all !
    const afterHeader = raw.indexOf('!', excl) + 1;
    while (raw[afterHeader - 1] === '!') {}
    // Find where ! block ends
    let pos = excl + deviceMatch[2].length;
    while (raw[pos] === '!') pos++;
    const data = raw.slice(pos); // everything after the header

    // ── Basic measurements (positions in `data`)
    const height_cm  = parseInt(data.slice(0, 4), 10) / 10;
    const age        = parseInt(data.slice(4, 7), 10);
    const gender     = (data[8] === 'M' ? 'M' : 'F') as 'M' | 'F';
    // date: YYYYMMDD, time: HHMM
    const dateStr    = data.slice(9, 17);  // YYYYMMDD
    const timeStr    = data.slice(17, 21); // HHMM
    const measuredAt = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${timeStr.slice(0,2)}:${timeStr.slice(2,4)}:00+05:00`;

    // ── Body composition blocks (start at data offset 23, 4-char groups)
    const bc = data.slice(23); // body composition section

    const protein_kg   = g4f(bc, 0);
    const protein_norm: [number, number] = [g4f(bc, 1), g4f(bc, 2)];
    const minerals_kg  = g4f(bc, 3, 100);
    const minerals_norm: [number, number] = [g4f(bc, 4, 100), g4f(bc, 5, 100)];
    const fat_kg       = g4f(bc, 6);
    const fat_norm: [number, number]     = [g4f(bc, 7), g4f(bc, 8)];
    const water_l      = g4f(bc, 9);
    const water_norm: [number, number]   = [g4f(bc, 10), g4f(bc, 11)];
    const lean_kg      = g4f(bc, 12);  // lean (fat-free) mass, no norm here
    const weight_kg    = g4f(bc, 13);
    const weight_norm: [number, number]  = [g4f(bc, 14), g4f(bc, 15)];
    const obesity_pct  = g4f(bc, 16);  // percent of normal obesity level
    const skeletal_muscle_kg = g4f(bc, 17);
    // groups 18-22 unclear, skip
    const ideal_weight_kg = g4f(bc, 23);

    // ── Weight control (+xxxx × 3) after group 23 (=position 24*4=96 chars in bc)
    const ctrlStr = bc.slice(24 * 4);
    const ctrlMatch = ctrlStr.match(/^([+-]\d{4})([+-]\d{4})([+-]\d{4})/);
    const weight_control_kg = ctrlMatch ? sign4(ctrlMatch[1]) : 0;
    const fat_control_kg    = ctrlMatch ? sign4(ctrlMatch[2]) : 0;
    const muscle_control_kg = ctrlMatch ? sign4(ctrlMatch[3]) : 0;

    // ── BMR and WHR (after the +/- section)
    const afterCtrl = ctrlMatch ? bc.slice(24 * 4 + 15) : bc.slice(24 * 4);
    const bmr_kcal  = parseInt(afterCtrl.slice(0, 4), 10);
    const whr       = parseInt(afterCtrl.slice(4, 8), 10) / 100;
    const whr_norm: [number, number] = [
      parseInt(afterCtrl.slice(8, 12), 10) / 100,
      parseInt(afterCtrl.slice(12, 16), 10) / 100,
    ];

    // ── Lean mass norm (found after fat% norms in the tail section)
    // Located after `!!!!` following -2DM-... in the PASS section
    const tailMatch = raw.match(/!{4}(\d+)$/);
    // Segment data is in the tail section after `!!!!`
    const tailStr = tailMatch ? tailMatch[1] : '';

    // tail layout (from spec and verified against sample):
    // 5×4 unknown | 5×4 lean_by_seg (÷100) | 5×4 fat_by_seg (÷100) |
    // 5×4 lean_pct_norm | 5×4 fat_pct_norm | 4 score | 8 zeros | 4 lean_norm_min | 4 lean_norm_max | ... obesity ...
    const lean_by_segment = tailStr.length >= 60 ? seg5(tailStr, 5, 100) : { right_arm: 0, left_arm: 0, trunk: 0, right_leg: 0, left_leg: 0 };
    const fat_by_segment  = tailStr.length >= 80 ? seg5(tailStr, 10, 100) : { right_arm: 0, left_arm: 0, trunk: 0, right_leg: 0, left_leg: 0 };
    const lean_pct_norm_by_segment = tailStr.length >= 100 ? seg5(tailStr, 15, 10) : { right_arm: 0, left_arm: 0, trunk: 0, right_leg: 0, left_leg: 0 };
    const fat_pct_norm_by_segment  = tailStr.length >= 120 ? seg5(tailStr, 20, 10) : { right_arm: 0, left_arm: 0, trunk: 0, right_leg: 0, left_leg: 0 };

    // Lean mass norm from tail (after 5 fat% norm groups + 4 unknown chars = position 25 in tail)
    const lnMin = tailStr.length >= 128 ? parseInt(tailStr.slice(100, 104), 10) / 10 : 0;
    const lnMax = tailStr.length >= 132 ? parseInt(tailStr.slice(104, 108), 10) / 10 : 0;
    const lean_norm: [number, number] = lnMin > 0 ? [lnMin, lnMax] : [0, 0];

    // ── Derived
    const bmi     = Math.round(weight_kg / ((height_cm / 100) ** 2) * 10) / 10;
    const fat_pct = Math.round(fat_kg / weight_kg * 1000) / 10;

    return {
      raw, device_id: device_id_clean, phone,
      height_cm, age, gender, measured_at: measuredAt,
      weight_kg, weight_norm, protein_kg, protein_norm,
      minerals_kg, minerals_norm, fat_kg, fat_norm,
      water_l, water_norm, lean_kg, lean_norm,
      skeletal_muscle_kg, bmr_kcal, whr, whr_norm,
      weight_control_kg, fat_control_kg, muscle_control_kg, ideal_weight_kg,
      obesity_pct, lean_by_segment, fat_by_segment,
      lean_pct_norm_by_segment, fat_pct_norm_by_segment,
      bmi, fat_pct,
    };
  } catch { return null; }
}

// ── Self-check (runs only in dev) ─────────────────────────────────────────────
const SAMPLE = '270-51F92600002187767681579!!!!!!!!!!!!!!!!!!!!!!18350290M20261017092710010701120136038603850471009900890178040104170509054706460630085208720304085900895019201540710741+0095+0012+0083155000860080009004460710872876000000000000000000003874386602473276319535183494021529422882PASS00124004280111046303540741000002200150008501111001111110011100440270-2DM-0484!!!!01850250030001000200029102920243090309110005000500470016001609460950099110571066007360072101008008470085000710000000567069314371675087016200290471';

export function selfCheck(): string[] {
  const d = parseInBody(SAMPLE);
  if (!d) return ['FAIL: parse returned null'];
  const errors: string[] = [];
  const check = (field: string, got: number | string, expected: number | string) => {
    if (String(got) !== String(expected)) errors.push(`${field}: got ${got}, expected ${expected}`);
  };
  check('phone',   d.phone,              '+77767681579');
  check('height',  d.height_cm,          183.5);
  check('age',     d.age,                29);
  check('gender',  d.gender,             'M');
  check('weight',  d.weight_kg,          64.6);
  check('weight_norm[0]', d.weight_norm[0], 63);
  check('weight_norm[1]', d.weight_norm[1], 85.2);
  check('protein', d.protein_kg,         10.7);
  check('protein_norm[0]', d.protein_norm[0], 11.2);
  check('protein_norm[1]', d.protein_norm[1], 13.6);
  check('minerals', d.minerals_kg,       3.86);
  check('fat',     d.fat_kg,             9.9);
  check('fat_norm[0]', d.fat_norm[0],    8.9);
  check('fat_norm[1]', d.fat_norm[1],    17.8);
  check('water',   d.water_l,            40.1);
  check('lean',    d.lean_kg,            54.7);
  check('skeletal_muscle', d.skeletal_muscle_kg, 30.4);
  check('ideal_weight', d.ideal_weight_kg, 74.1);
  check('bmr',     d.bmr_kcal,           1550);
  check('whr',     d.whr,                0.86);
  check('bmi',     d.bmi,                19.2);
  check('fat_pct', d.fat_pct,            15.3); // 9.9/64.6 = 15.32% ~ 15.3
  check('lean_by_segment.right_arm', d.lean_by_segment.right_arm, 2.91);
  check('lean_by_segment.trunk',     d.lean_by_segment.trunk,     24.3);
  check('fat_by_segment.trunk',      d.fat_by_segment.trunk,      0.47);
  return errors;
}

if (import.meta.env?.DEV) {
  const errs = selfCheck();
  if (errs.length > 0) console.warn('[InBody] self-check failed:', errs);
  else console.log('[InBody] self-check passed');
}
