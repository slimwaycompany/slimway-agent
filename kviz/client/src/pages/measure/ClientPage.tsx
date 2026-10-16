import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet } from '../../api';
import { MeasureLayout } from './MeasureLayout';

const CIRC_KEYS = ['neck','chest','left_arm','right_arm','waist','belly','hips','left_thigh','right_thigh','left_calf','right_calf'];
const CIRC_LABELS: Record<string, string> = {
  neck:'Шея', chest:'Грудь', left_arm:'Л.рука', right_arm:'П.рука',
  waist:'Талия', belly:'Живот', hips:'Ягодицы', left_thigh:'Л.бедро',
  right_thigh:'П.бедро', left_calf:'Л.голень', right_calf:'П.голень',
};

interface Measurement {
  id: string; measure_no: number; measured_at: string;
  weight: number | null; total_cm: number; consultant: string;
  fitbase_comment_at: string | null; note: string | null;
  [key: string]: unknown;
}
interface Client {
  id: string; name: string; phone: string | null; fitbase_client_id: number | null;
  measurements: Measurement[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtPhone(p: string | null) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `+7 ${d.slice(1,4)}•••-••-${d.slice(9)}`;
  return p;
}
function shortId(id: string) { return id.replace(/-/g,'').slice(0,6).toUpperCase(); }
function fmtDiff(d: number): string { return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1); }
function diffColor(d: number) { return d < 0 ? '#16a34a' : d > 0 ? '#f59e0b' : '#9ca3af'; }

// Simple SVG line chart for total_cm and weight over measurement numbers
function MeasureChart({ ms }: { ms: Measurement[] }) {
  if (ms.length < 2) return null;
  const W = 480, H = 140, PL = 40, PR = 16, PT = 12, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;

  const totals = ms.map(m => Number(m.total_cm));
  const weights = ms.map(m => m.weight);

  const tMin = Math.min(...totals), tMax = Math.max(...totals);
  const tRange = tMax - tMin || 1;

  const hasW = weights.some(w => w != null);
  const wVals = weights.filter(w => w != null) as number[];
  const wMin = hasW ? Math.min(...wVals) : 0;
  const wMax = hasW ? Math.max(...wVals) : 0;
  const wRange = wMax - wMin || 1;

  function tx(i: number) { return PL + (i / (ms.length - 1)) * iW; }
  function tyT(v: number) { return PT + iH - ((v - tMin) / tRange) * iH; }
  function tyW(v: number) { return PT + iH - ((v - wMin) / wRange) * iH; }

  const tPath = ms.map((m, i) => `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${tyT(Number(m.total_cm)).toFixed(1)}`).join(' ');
  const wPath = ms
    .map((m, i) => m.weight != null ? `${i === 0 || weights.slice(0, i).every(w => w == null) ? 'M' : 'L'}${tx(i).toFixed(1)},${tyW(m.weight).toFixed(1)}` : null)
    .filter(Boolean).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      {/* Grid */}
      {[0, 0.5, 1].map((f, i) => (
        <line key={i} x1={PL} x2={W - PR} y1={PT + iH * (1 - f)} y2={PT + iH * (1 - f)}
          stroke="#e2e6ea" strokeWidth={1} />
      ))}
      {/* Axis labels */}
      {ms.map((m, i) => (
        <text key={i} x={tx(i)} y={H - 4} textAnchor="middle" fontSize={10} fill="#9ca3af">
          {m.measure_no}
        </text>
      ))}
      <text x={PL - 4} y={PT + 4} textAnchor="end" fontSize={9} fill="#02BDB6">{tMax.toFixed(0)}</text>
      <text x={PL - 4} y={PT + iH} textAnchor="end" fontSize={9} fill="#02BDB6">{tMin.toFixed(0)}</text>
      {/* Lines */}
      <path d={tPath} fill="none" stroke="#02BDB6" strokeWidth={2.5} strokeLinejoin="round" />
      {hasW && wPath && <path d={wPath} fill="none" stroke="#263CD9" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />}
      {/* Dots */}
      {ms.map((m, i) => (
        <circle key={i} cx={tx(i)} cy={tyT(Number(m.total_cm))} r={4} fill="#02BDB6" />
      ))}
      {hasW && ms.map((m, i) => m.weight != null ? (
        <circle key={i} cx={tx(i)} cy={tyW(m.weight)} r={3} fill="#263CD9" />
      ) : null)}
      {/* Legend */}
      <circle cx={PL + 8} cy={PT - 2} r={4} fill="#02BDB6" />
      <text x={PL + 16} y={PT + 2} fontSize={10} fill="#6b7280">Сумма см</text>
      {hasW && <><circle cx={PL + 88} cy={PT - 2} r={3} fill="#263CD9" /><text x={PL + 96} y={PT + 2} fontSize={10} fill="#6b7280">Вес</text></>}
    </svg>
  );
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [cmpFrom, setCmpFrom] = useState<string>('');
  const [cmpTo, setCmpTo] = useState<string>('');

  useEffect(() => {
    if (!id) return;
    apiGet(`/api/measure/clients/${id}`)
      .then(d => { setClient(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <MeasureLayout active="reports"><div style={{ padding: 32, color: '#9ca3af' }}>Загрузка…</div></MeasureLayout>;
  if (!client) return <MeasureLayout active="reports"><div style={{ padding: 32 }}>Клиент не найден</div></MeasureLayout>;

  const ms = client.measurements;
  const first = ms[0], last = ms[ms.length - 1];

  // Comparison
  const cmpFromM = ms.find(m => m.id === cmpFrom);
  const cmpToM   = ms.find(m => m.id === cmpTo);

  return (
    <MeasureLayout active="reports">
      <div style={{ padding: '16px', maxWidth: 900, margin: '0 auto' }}>
        <button className="btn btn-secondary" style={{ marginBottom: 16, fontSize: 13, padding: '6px 12px' }}
          onClick={() => navigate('/measure/reports')}>← Отчёты</button>

        {/* Client card */}
        <div style={{ background: 'rgba(2,189,182,0.06)', border: '1px solid rgba(2,189,182,0.3)', borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{client.name}</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {client.phone && <span>{fmtPhone(client.phone)}</span>}
            <span>ID: {shortId(client.id)}</span>
            <span>Замеров: {ms.length}</span>
            {first && <span>Старт: {fmtDate(first.measured_at)}</span>}
            {last && ms.length > 1 && <span>Посл.: {fmtDate(last.measured_at)}</span>}
            {first && last && ms.length > 1 && (
              <span style={{ color: diffColor(Number(last.total_cm) - Number(first.total_cm)), fontWeight: 600 }}>
                Δ∑ {fmtDiff(Number(last.total_cm) - Number(first.total_cm))} см
              </span>
            )}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12, fontSize: 13, padding: '7px 14px' }}
            onClick={() => navigate('/measure/new')}>
            + Новый замер
          </button>
        </div>

        {/* Chart */}
        {ms.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #e2e6ea' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 }}>График</div>
            <MeasureChart ms={ms} />
          </div>
        )}

        {/* Comparison */}
        {ms.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #e2e6ea' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 12 }}>Сравнение замеров</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <select value={cmpFrom} onChange={e => setCmpFrom(e.target.value)}
                style={{ padding: '7px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }}>
                <option value="">С замера…</option>
                {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
              </select>
              <select value={cmpTo} onChange={e => setCmpTo(e.target.value)}
                style={{ padding: '7px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }}>
                <option value="">По замер…</option>
                {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
              </select>
            </div>
            {cmpFromM && cmpToM && cmpFromM !== cmpToM && (
              <div style={{ overflowX: 'auto' }}>
                <table className="measure-table">
                  <thead>
                    <tr><th>Точка</th><th>№{cmpFromM.measure_no}</th><th>№{cmpToM.measure_no}</th><th>Разница</th></tr>
                  </thead>
                  <tbody>
                    {[{key:'weight',label:'Вес (кг)'}, ...CIRC_KEYS.map(k => ({ key: k, label: CIRC_LABELS[k] }))].map(({ key, label }) => {
                      const a = cmpFromM[key] != null ? Number(cmpFromM[key]) : null;
                      const b = cmpToM[key]   != null ? Number(cmpToM[key])   : null;
                      const d = a != null && b != null ? b - a : null;
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>{a?.toFixed(1) ?? '—'}</td>
                          <td>{b?.toFixed(1) ?? '—'}</td>
                          <td style={{ fontWeight: 600, color: d != null ? diffColor(d) : '#9ca3af' }}>
                            {d != null ? fmtDiff(d) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ fontWeight: 700 }}>
                      <td>∑ обхватов</td>
                      <td>{Number(cmpFromM.total_cm).toFixed(1)}</td>
                      <td>{Number(cmpToM.total_cm).toFixed(1)}</td>
                      <td style={{ color: diffColor(Number(cmpToM.total_cm) - Number(cmpFromM.total_cm)) }}>
                        {fmtDiff(Number(cmpToM.total_cm) - Number(cmpFromM.total_cm))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* All measurements */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e6ea', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e6ea', fontWeight: 600, fontSize: 13, color: '#9ca3af', textTransform: 'uppercase' }}>
            Все замеры
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="measure-table">
              <thead>
                <tr>
                  <th>№</th><th>Дата</th><th>Консультант</th>
                  <th>Вес</th>
                  {CIRC_KEYS.map(k => <th key={k}>{CIRC_LABELS[k]}</th>)}
                  <th>∑ см</th><th>Δ пред.</th><th>Δ старт</th>
                </tr>
              </thead>
              <tbody>
                {ms.map((m, i) => {
                  const prev = i > 0 ? ms[i - 1] : null;
                  const dp = prev ? Number(m.total_cm) - Number(prev.total_cm) : null;
                  const ds = i > 0 ? Number(m.total_cm) - Number(ms[0].total_cm) : null;
                  return (
                    <tr key={m.id}>
                      <td>{m.measure_no}</td>
                      <td>{fmtDate(m.measured_at)}</td>
                      <td style={{ fontSize: 12 }}>{m.consultant}</td>
                      <td>{m.weight != null ? Number(m.weight).toFixed(1) : '—'}</td>
                      {CIRC_KEYS.map(k => <td key={k}>{m[k] != null ? Number(m[k]).toFixed(1) : '—'}</td>)}
                      <td style={{ fontWeight: 600 }}>{Number(m.total_cm).toFixed(1)}</td>
                      <td style={{ fontWeight: 600, color: dp != null ? diffColor(dp) : '#9ca3af' }}>
                        {dp != null ? fmtDiff(dp) : '—'}
                      </td>
                      <td style={{ fontWeight: 600, color: ds != null ? diffColor(ds) : '#9ca3af' }}>
                        {ds != null ? fmtDiff(ds) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MeasureLayout>
  );
}
