import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { MeasureLayout } from './MeasureLayout';
import * as XLSX from 'xlsx';

const CIRC_KEYS = ['neck','chest','arm_l','arm_r','waist','belly','glutes','thigh_l','thigh_r','shin_l','shin_r'];
const CIRC_LABELS: Record<string, string> = {
  neck:'Шея', chest:'Грудь', arm_l:'Л.рука', arm_r:'П.рука',
  waist:'Талия', belly:'Живот', glutes:'Ягодицы', thigh_l:'Л.бедро',
  thigh_r:'П.бедро', shin_l:'Л.голень', shin_r:'П.голень',
};

interface Row {
  id: string; client_id: string; measure_no: number; consultant: string;
  measured_at: string; weight: number | null; total_cm: number;
  body_clients: { name: string; phone: string | null; fitbase_client_id: number | null };
  studio_result?: { cm_lost: number; kg_lost: number; sent_by: string; sent_at: string } | null;
  [key: string]: unknown;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function shortId(id: string) { return id.replace(/-/g,'').slice(0,6).toUpperCase(); }

type SortKey = 'measured_at' | 'client_name' | 'total_cm' | 'weight';

export default function ReportsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clientQ, setClientQ] = useState('');
  const [consultant, setConsultant] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('measured_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [ibCounts, setIbCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to)   qs.set('to', to);
      if (consultant) qs.set('consultant', consultant);
      const data = await apiGet(`/api/measure/measurements?${qs}`);
      setRows(data);
      const clientIds = [...new Set((data as Row[]).map(r => r.client_id))];
      if (clientIds.length) {
        const counts = await apiGet(`/api/inbody/counts?client_ids=${clientIds.join(',')}`).catch(() => ({}));
        setIbCounts(counts || {});
      }
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [from, to, consultant]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const filtered = rows.filter(r => {
    if (!clientQ) return true;
    const q = clientQ.toLowerCase();
    return r.body_clients.name.toLowerCase().includes(q) || (r.body_clients.phone || '').includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: unknown, bv: unknown;
    if (sortKey === 'client_name') { av = a.body_clients.name; bv = b.body_clients.name; }
    else if (sortKey === 'measured_at') { av = a.measured_at; bv = b.measured_at; }
    else { av = a[sortKey]; bv = b[sortKey]; }
    const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: all measurements
    const ws1Data = sorted.map(r => ({
      'Клиент': r.body_clients.name,
      'Телефон': r.body_clients.phone || '',
      'ID': shortId(r.client_id),
      '№': r.measure_no,
      'Дата': fmtDate(r.measured_at),
      'Консультант': r.consultant,
      'Вес': r.weight ?? '',
      ...Object.fromEntries(CIRC_KEYS.map(k => [CIRC_LABELS[k], (r[k] as number | null) ?? ''])),
      'Сумма см': Number(r.total_cm).toFixed(1),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ws1Data), 'Замеры');

    // Sheet 2: summary per client
    const byClient: Record<string, Row[]> = {};
    for (const r of sorted) {
      if (!byClient[r.client_id]) byClient[r.client_id] = [];
      byClient[r.client_id].push(r);
    }
    const ws2Data = Object.values(byClient).map(ms => {
      const sorted2 = [...ms].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
      const first = sorted2[0], last = sorted2[sorted2.length - 1];
      return {
        'Клиент': first.body_clients.name,
        'Телефон': first.body_clients.phone || '',
        'Замеров': sorted2.length,
        'Первый замер': fmtDate(first.measured_at),
        'Последний замер': fmtDate(last.measured_at),
        'Δ веса': first.weight != null && last.weight != null ? Number(last.weight - first.weight).toFixed(1) : '',
        'Δ суммы см': (Number(last.total_cm) - Number(first.total_cm)).toFixed(1),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ws2Data), 'Итоги по клиентам');

    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    XLSX.writeFile(wb, `zamery_${today}.xlsx`);
  }

  const Th = ({ label, k }: { label: string; k?: SortKey }) => (
    <th style={{ cursor: k ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
        onClick={() => k && toggleSort(k)}>
      {label}{k && sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <MeasureLayout active="reports">
      <div style={{ padding: '16px', maxWidth: 1400, margin: '0 auto' }}>
        {/* Filters */}
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} placeholder="От" />
          <input type="date" value={to}   onChange={e => setTo(e.target.value)}   placeholder="До" />
          <input value={clientQ}    onChange={e => setClientQ(e.target.value)}    placeholder="Клиент" style={{ padding: '8px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }} />
          <input value={consultant} onChange={e => setConsultant(e.target.value)} placeholder="Консультант" style={{ padding: '8px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }} />
          <button className="btn btn-primary" style={{ padding: '8px 18px', fontSize: 14 }} onClick={load}>Обновить</button>
          <button className="btn btn-secondary" style={{ padding: '8px 18px', fontSize: 14 }} onClick={exportExcel}>⬇ Excel</button>
        </div>

        {loading && <div style={{ color: '#9ca3af', padding: 20 }}>Загрузка…</div>}

        {!loading && sorted.length === 0 && (
          <div className="empty">Нет замеров по заданным фильтрам</div>
        )}

        {!loading && sorted.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="measure-table">
              <thead>
                <tr>
                  <Th label="Клиент" k="client_name" />
                  <th>ID</th>
                  <Th label="№" />
                  <Th label="Дата" k="measured_at" />
                  <th>Консультант</th>
                  <Th label="Вес" k="weight" />
                  {CIRC_KEYS.map(k => <th key={k}>{CIRC_LABELS[k]}</th>)}
                  <Th label="∑ см" k="total_cm" />
                  <th>InBody</th>
                  <th>В результатах</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id}>
                    <td>
                      <span style={{ color: '#02BDB6', cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => navigate(`/measure/client/${r.client_id}`)}>
                        {r.body_clients.name}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: '#9ca3af' }}>{shortId(r.client_id)}</td>
                    <td>{r.measure_no}</td>
                    <td>{fmtDate(r.measured_at)}</td>
                    <td style={{ fontSize: 13 }}>{r.consultant}</td>
                    <td>{r.weight != null ? Number(r.weight).toFixed(1) : '—'}</td>
                    {CIRC_KEYS.map(k => <td key={k}>{r[k] != null ? Number(r[k]).toFixed(1) : '—'}</td>)}
                    <td style={{ fontWeight: 600 }}>{Number(r.total_cm).toFixed(1)}</td>
                    <td style={{ color: ibCounts[r.client_id] ? '#02BDB6' : '#9ca3af', fontWeight: ibCounts[r.client_id] ? 600 : 400 }}>
                      {ibCounts[r.client_id] ?? '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: r.studio_result ? '#047857' : '#9ca3af' }}>
                      {r.studio_result ? `${Number(r.studio_result.cm_lost).toFixed(0)} см, ${Number(r.studio_result.kg_lost).toFixed(1)} кг (${fmtDate(r.studio_result.sent_at)}, ${r.studio_result.sent_by})` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MeasureLayout>
  );
}
