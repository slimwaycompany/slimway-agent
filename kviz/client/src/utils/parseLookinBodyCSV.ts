export interface InBodyCSVRow {
  inbody_id: string;
  tested_at: string;
  phone: string | null;
  source: 'csv';
  gender: string | null;
  age: number | null;
  height: number | null;
  weight: number | null;
  bfm: number | null;
  pbf: number | null;
  smm: number | null;
  ffm: number | null;
  bmi: number | null;
  vfl: number | null;
  inbody_score: number | null;
  whr: number | null;
  bmr: number | null;
  data: Record<string, unknown>;
  raw: string;
}

// Column number (1-indexed, from header "N. Name") → data key
export const COL_KEY: Record<number, string> = {
  1:'id', 2:'height', 3:'gender', 4:'age', 5:'tested_at',
  6:'weight', 7:'weight_min', 8:'weight_max',
  9:'tbw', 10:'tbw_min', 11:'tbw_max',
  12:'protein', 13:'protein_min', 14:'protein_max',
  15:'minerals', 16:'minerals_min', 17:'minerals_max',
  18:'bfm', 19:'bfm_min', 20:'bfm_max',
  21:'ffm', 22:'ffm_min', 23:'ffm_max',
  24:'smm', 25:'smm_min', 26:'smm_max',
  27:'bmi', 28:'bmi_min', 29:'bmi_max',
  30:'pbf', 31:'pbf_min', 32:'pbf_max',
  33:'ffm_ra', 34:'ffm_ra_pct', 35:'ffm_la', 36:'ffm_la_pct',
  37:'ffm_tr', 38:'ffm_tr_pct', 39:'ffm_rl', 40:'ffm_rl_pct',
  41:'ffm_ll', 42:'ffm_ll_pct',
  43:'bfm_ra', 44:'bfm_ra_pct', 45:'bfm_la', 46:'bfm_la_pct',
  47:'bfm_tr', 48:'bfm_tr_pct', 49:'bfm_rl', 50:'bfm_rl_pct',
  51:'bfm_ll', 52:'bfm_ll_pct',
  53:'inbody_score', 54:'target_weight', 55:'weight_control',
  56:'bfm_control', 57:'ffm_control', 58:'bmr',
  59:'whr', 60:'whr_min', 61:'whr_max',
  62:'vfl', 63:'obesity_degree', 64:'obesity_degree_min', 65:'obesity_degree_max',
  66:'imp20_ra', 67:'imp20_la', 68:'imp20_tr', 69:'imp20_rl', 70:'imp20_ll',
  71:'imp100_ra', 72:'imp100_la', 73:'imp100_tr', 74:'imp100_rl', 75:'imp100_ll',
  76:'abdomen_circumference', 77:'growth_score',
  78:'child_obesity', 79:'child_obesity_min', 80:'child_obesity_max',
  81:'systolic', 82:'diastolic', 83:'pulse', 84:'map',
  85:'pulse_pressure', 86:'rpp',
  87:'smi', 88:'recommended_kcal', 89:'bmr_min', 90:'bmr_max',
  91:'systolic2', 92:'diastolic2', 93:'pulse2', 94:'map2',
  95:'pulse_pressure2', 96:'rpp2',
  97:'smm_wt', 98:'ffmi', 99:'fmi',
  100:'grip_l1', 101:'grip_l2', 102:'grip_r1', 103:'grip_r2',
};

// Column number → top-level InBodyCSVRow numeric field
const TOP_COL: Partial<Record<number, keyof Pick<InBodyCSVRow,
  'height'|'age'|'weight'|'bfm'|'ffm'|'smm'|'bmi'|'pbf'|'inbody_score'|'bmr'|'whr'|'vfl'
>>> = {
  2:'height', 4:'age', 6:'weight', 18:'bfm', 21:'ffm',
  24:'smm', 27:'bmi', 30:'pbf', 53:'inbody_score', 58:'bmr', 59:'whr', 62:'vfl',
};

// String-valued columns (not parsed as numbers)
const STRING_COLS = new Set([1, 3, 5]);

export function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t || t === '-' || t === '--') return null;
  const m = t.match(/^level\s+(\d+(?:\.\d+)?)/i);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  if (d.length === 10) return '+7' + d;
  return null;
}

function normalizeInbodyId(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1);
  if (d.length === 10) return '7' + d;
  return d;
}

// "2026.08.31 17:56:13" as Asia/Yekaterinburg (UTC+5) → ISO
function parseYekDate(s: string): string | null {
  const m = s.trim().match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, yr, mo, dy, hr, mi, sc = '0'] = m;
  const utc = new Date(Date.UTC(+yr, +mo - 1, +dy, +hr - 5, +mi, +sc));
  return isNaN(utc.getTime()) ? null : utc.toISOString();
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur); cur = '';
    } else cur += ch;
  }
  result.push(cur);
  return result;
}

// Extract 1-based column number from header "18. BFM (Body Fat Mass)" → 18
function headerNum(h: string): number | null {
  const m = h.trim().match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

export function parseLookinBodyCSV(csvText: string): InBodyCSVRow[] {
  const text = csvText.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  if (headers.length !== 103) console.warn(`[InBody CSV] expected 103 columns, got ${headers.length}`);

  // Map column number (1-based from header) → array index (0-based)
  const colNumToIdx = new Map<number, number>();
  for (let j = 0; j < headers.length; j++) {
    const n = headerNum(headers[j]);
    if (n != null) colNumToIdx.set(n, j);
  }

  const idIdx   = colNumToIdx.get(1);
  const dateIdx = colNumToIdx.get(5);

  if (idIdx == null || dateIdx == null) return [];

  const rows: InBodyCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);

    const rawId = (cols[idIdx] ?? '').trim().replace(/^<|>$/g, '');
    if (!rawId) continue;

    const tested_at = parseYekDate((cols[dateIdx] ?? '').trim());
    if (!tested_at) continue;

    const inbody_id = normalizeInbodyId(rawId);
    const phone = normalizePhone(rawId);

    const data: Record<string, unknown> = {};
    colNumToIdx.forEach((arrIdx, colNum) => {
      const key = COL_KEY[colNum];
      if (!key) return;
      const rawVal = (cols[arrIdx] ?? '').trim();
      data[key] = STRING_COLS.has(colNum)
        ? (rawVal === '-' || rawVal === '--' ? null : rawVal || null)
        : parseNum(rawVal);
    });

    const row: InBodyCSVRow = {
      inbody_id, tested_at, phone, source: 'csv',
      gender: null, age: null, height: null, weight: null,
      bfm: null, pbf: null, smm: null, ffm: null,
      bmi: null, vfl: null, inbody_score: null, whr: null, bmr: null,
      data, raw: line,
    };

    // Gender from col 3
    const genderIdx = colNumToIdx.get(3);
    if (genderIdx != null) row.gender = (cols[genderIdx] ?? '').trim() || null;

    // Top-level numeric fields
    for (const [colNumStr, field] of Object.entries(TOP_COL)) {
      const arrIdx = colNumToIdx.get(parseInt(colNumStr));
      if (arrIdx != null && field) {
        (row as Record<string, unknown>)[field] = parseNum(cols[arrIdx] ?? '');
      }
    }

    rows.push(row);
  }

  return rows;
}

// Re-parse a stored raw CSV row by column position (assumes sequential col order 1–103).
// Used by the server-side recalculate endpoint — no header available.
export function reParseRawRow(rawLine: string): {
  data: Record<string, unknown>;
  topLevel: Partial<Pick<InBodyCSVRow, 'height'|'age'|'weight'|'bfm'|'ffm'|'smm'|'bmi'|'pbf'|'inbody_score'|'bmr'|'whr'|'vfl'|'gender'>>;
} {
  const cols = parseCSVLine(rawLine);
  const data: Record<string, unknown> = {};
  for (let j = 0; j < Math.min(cols.length, 103); j++) {
    const colNum = j + 1;
    const key = COL_KEY[colNum];
    if (!key) continue;
    const rawVal = (cols[j] ?? '').trim();
    data[key] = STRING_COLS.has(colNum)
      ? (rawVal === '-' || rawVal === '--' ? null : rawVal || null)
      : parseNum(rawVal);
  }
  const topLevel: ReturnType<typeof reParseRawRow>['topLevel'] = {};
  for (const [colNumStr, field] of Object.entries(TOP_COL)) {
    const arrIdx = parseInt(colNumStr) - 1;
    if (arrIdx >= 0 && arrIdx < cols.length && field) {
      (topLevel as Record<string, unknown>)[field] = parseNum(cols[arrIdx] ?? '');
    }
  }
  const genderIdx = 3 - 1; // col 3
  if (genderIdx < cols.length) topLevel.gender = (cols[genderIdx] ?? '').trim() || null;
  return { data, topLevel };
}
