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

function parseNum(s: string): number | null {
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

function parseCSVLine(line: string): string[] {
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

// "1. ID" → "id", "18. BFM" → "bfm", "53. InBody Score" → "inbody_score"
function slug(h: string): string {
  return h.trim().replace(/^\d+\.\s*/, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().replace(/^_|_$/g, '');
}

const NUM_COLS: Record<string, keyof Pick<InBodyCSVRow, 'height'|'age'|'weight'|'bfm'|'pbf'|'smm'|'ffm'|'bmi'|'vfl'|'inbody_score'|'whr'|'bmr'>> = {
  height: 'height',
  age: 'age',
  weight: 'weight',
  bfm: 'bfm',
  pbf: 'pbf',
  smm: 'smm',
  ffm: 'ffm',
  bmi: 'bmi',
  vfl: 'vfl',
  inbody_score: 'inbody_score',
  whr: 'whr',
  bmr: 'bmr',
};

export function parseLookinBodyCSV(csvText: string): InBodyCSVRow[] {
  const text = csvText.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const slugs = headers.map(slug);

  const idIdx = slugs.findIndex(s => s === 'id');
  const dateIdx = slugs.findIndex(s => s.includes('test_date') || (s.includes('date') && !s.includes('birth') && !s.includes('created')));
  const genderIdx = slugs.findIndex(s => s === 'gender');

  if (idIdx < 0 || dateIdx < 0) return [];

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
    for (let j = 0; j < headers.length; j++) {
      const val = (cols[j] ?? '').trim();
      data[slugs[j] || `col_${j}`] = val === '-' || val === '--' ? null : val;
    }

    const row: InBodyCSVRow = {
      inbody_id, tested_at, phone, source: 'csv',
      gender: genderIdx >= 0 ? ((cols[genderIdx] ?? '').trim() || null) : null,
      age: null, height: null, weight: null,
      bfm: null, pbf: null, smm: null, ffm: null,
      bmi: null, vfl: null, inbody_score: null, whr: null, bmr: null,
      data, raw: line,
    };

    for (let j = 0; j < slugs.length; j++) {
      const field = NUM_COLS[slugs[j]];
      if (field) (row as Record<string, unknown>)[field] = parseNum(cols[j] ?? '');
    }

    rows.push(row);
  }

  return rows;
}
