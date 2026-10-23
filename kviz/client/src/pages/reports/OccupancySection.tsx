import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';

interface Visit {
  fitbase_id: string;
  client_fitbase_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  status: number | null;
  visit_at: string | null;
  visit_date: string | null;
  service: string | null;
  resource: string | null;
  abonement: string | null;
  is_trial: boolean;
}

interface OccupancyData {
  visits: Visit[];
  resources: string[];
  abonements: string[];
  statuses: string[];
  total: number;
  unique_clients: number;
  from: string;
  to: string;
}

const YEK = 5;
function yekHour(iso: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getUTCHours() + YEK) % 24;
}

function fmtDate(d: string) { return d.split('-').reverse().join('.'); }
function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const h = yekHour(iso)!;
  const m = new Date(iso).getUTCMinutes();
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

const STATUS_LABELS: Record<string, string> = {
  '0': 'Ожидает', '1': 'Подтверждён', '2': 'Отменён', '3': 'Пришёл', '4': 'Не пришёл',
};

function statusLabel(s: number | null) {
  return STATUS_LABELS[String(s ?? '')] ?? String(s ?? '—');
}

const today = new Date(Date.now() + YEK * 3_600_000).toISOString().slice(0, 10);
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6–22

export default function OccupancySection() {
  const [from, setFrom] = useState(today);
  const [to, setTo]     = useState(today);
  const [resource, setResource]   = useState('');
  const [abonement, setAbonement] = useState('');
  const [data, setData]   = useState<OccupancyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [cellVisits, setCellVisits] = useState<Visit[] | null>(null);
  const [cellLabel, setCellLabel]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setCellVisits(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (resource)  params.set('resource', resource);
      if (abonement) params.set('abonement', abonement);
      const r = await fetch(`/kviz/api/reports/occupancy?${params}`, { credentials: 'include' });
      setData(r.ok ? await r.json() : null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [from, to, resource, abonement]);

  function getCell(date: string, hour: number) {
    return (data?.visits ?? []).filter(v => v.visit_date === date && yekHour(v.visit_at) === hour);
  }

  function clickCell(date: string, hour: number) {
    const vs = getCell(date, hour);
    setCellVisits(vs);
    setCellLabel(`${fmtDate(date)} ${String(hour).padStart(2,'0')}:00`);
  }

  function exportXLSX() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const rows = [
      ['Дата', 'Время', 'Клиент', 'Телефон', 'Статус', 'Услуга', 'Аппарат', 'Абонемент', 'Пробное'],
      ...data.visits.map(v => [
        v.visit_date ?? '', fmtTime(v.visit_at),
        v.client_name ?? '', v.client_phone ?? '',
        statusLabel(v.status), v.service ?? '', v.resource ?? '', v.abonement ?? '',
        v.is_trial ? 'да' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Занятия');
    XLSX.writeFile(wb, `occupancy-${data.from}-${data.to}.xlsx`);
  }

  // Build list of dates in range
  const dates: string[] = [];
  if (data) {
    const cur = new Date(data.from + 'T00:00:00Z');
    const end = new Date(data.to   + 'T00:00:00Z');
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const maxCount = Math.max(1, ...dates.flatMap(d => HOURS.map(h => getCell(d, h).length)));

  return (
    <div style={{ padding: '12px 12px 32px' }}>
      <div style={s.filterRow}>
        <input type="date" style={s.inp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.inp} value={to} onChange={e => setTo(e.target.value)} />
        {data?.resources && data.resources.length > 0 && (
          <select style={s.sel} value={resource} onChange={e => setResource(e.target.value)}>
            <option value="">Все аппараты</option>
            {data.resources.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {data?.abonements && data.abonements.length > 0 && (
          <select style={s.sel} value={abonement} onChange={e => setAbonement(e.target.value)}>
            <option value="">Все абонементы</option>
            {data.abonements.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        {data && <button style={s.csvBtn} onClick={exportXLSX}>Excel</button>}
      </div>

      {!data && !loading && <div style={s.empty}>Выберите период и нажмите «Загрузить»</div>}
      {loading && <div style={s.empty}>Загрузка…</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'Всего', val: data.total, color: '#02BDB6' },
              { label: 'Уникальных клиентов', val: data.unique_clients, color: '#263CD9' },
            ].map(c => (
              <div key={c.label} style={s.card}>
                <div style={{ fontSize: 12, color: '#64748b' }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.val}</div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={s.th}>Дата</th>
                  {HOURS.map(h => <th key={h} style={s.th}>{h}:00</th>)}
                </tr>
              </thead>
              <tbody>
                {dates.map(date => (
                  <tr key={date}>
                    <td style={{ ...s.td, fontWeight: 600, whiteSpace: 'nowrap', background: '#f8fafc' }}>{fmtDate(date)}</td>
                    {HOURS.map(h => {
                      const cnt = getCell(date, h).length;
                      const intensity = cnt === 0 ? 0 : Math.round(40 + (cnt / maxCount) * 215);
                      const bg = cnt === 0 ? '#f8fafc' : `rgba(2,189,182,${(intensity / 255).toFixed(2)})`;
                      return (
                        <td key={h} style={{ ...s.td, background: bg, cursor: cnt > 0 ? 'pointer' : 'default', color: intensity > 180 ? '#fff' : '#1a202c' }}
                          onClick={() => cnt > 0 && clickCell(date, h)} title={cnt > 0 ? `${cnt} визитов` : ''}>
                          {cnt > 0 ? cnt : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cell detail panel */}
          {cellVisits && (
            <div style={s.panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Визиты {cellLabel}</span>
                <button style={s.closeBtn} onClick={() => setCellVisits(null)}>✕</button>
              </div>
              {cellVisits.map(v => (
                <div key={v.fitbase_id} style={s.visitRow}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.client_name || '—'}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {fmtTime(v.visit_at)} · {statusLabel(v.status)} · {v.service || '—'}
                    {v.resource ? ` · ${v.resource}` : ''}
                    {v.abonement ? ` · ${v.abonement}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.total > 0 && (
            <div>
              <div style={s.sectionTitle}>По статусам</div>
              {(() => {
                const map: Record<string, number> = {};
                for (const v of data.visits) { const k = statusLabel(v.status); map[k] = (map[k] || 0) + 1; }
                return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, cnt]) => (
                  <div key={label} style={s.totalRow}><span>{label}</span><span style={{ fontWeight: 700 }}>{cnt}</span></div>
                ));
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  filterRow:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  inp:          { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  sel:          { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  loadBtn:      { padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:       { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  empty:        { color: '#94a3b8', fontSize: 13 },
  card:         { background: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: 130 },
  th:           { padding: '5px 7px', background: '#f1f5f9', fontWeight: 600, color: '#475569', border: '1px solid #e2e8f0', whiteSpace: 'nowrap', textAlign: 'center' as const },
  td:           { padding: '4px 7px', border: '1px solid #e2e8f0', textAlign: 'center' as const, minWidth: 34, fontSize: 12 },
  panel:        { background: '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 16 },
  visitRow:     { borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginBottom: 6 },
  closeBtn:     { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748b', padding: '0 4px' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6, marginTop: 16 },
  totalRow:     { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f1f5f9' },
};
