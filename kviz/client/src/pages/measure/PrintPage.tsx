import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet } from '../../api';

// Print blank coordinates (x%, y% from blank dimensions)
const PRINT_ROWS: { key: string; y: number }[] = [
  { key: 'neck',    y: 37.7 },
  { key: 'chest',   y: 41.8 },
  { key: 'arm_l',   y: 45.9 },
  { key: 'arm_r',   y: 50.0 },
  { key: 'waist',   y: 54.2 },
  { key: 'glutes',  y: 58.3 },
  { key: 'thigh_l', y: 62.4 },
  { key: 'thigh_r', y: 66.5 },
  { key: 'shin_l',  y: 70.6 },
  { key: 'shin_r',  y: 74.8 },
];
const X_DO   = 29.7;
const X_AFTER = 88.5;

interface Measurement {
  id: string; measure_no: number; measured_at: string;
  weight: number | null; total_cm: number; consultant: string;
  [key: string]: unknown;
}
interface Client {
  id: string; name: string;
  measurements: Measurement[];
}

function fmtDateRu(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDiff(d: number) { return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1); }

function Txt({ x, y, children, bold, size }: {
  x: number; y: number; children: React.ReactNode; bold?: boolean; size?: number;
}) {
  return (
    <div style={{
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      transform: 'translate(-50%, -50%)',
      fontFamily: "'Arial", fontWeight: bold ? 700 : 400,
      fontSize: size ?? 13,
      color: '#1a1a1a',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    }}>
      {children}
    </div>
  );
}

export default function PrintPage() {
  const [params] = useSearchParams();
  const clientId = params.get('client') ?? '';
  const fromId   = params.get('from') ?? '';
  const toId     = params.get('to') ?? '';

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    apiGet(`/api/measure/clients/${clientId}`)
      .then(d => setClient(d))
      .catch(() => setErr('Не удалось загрузить клиента'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!loading && !err && client) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [loading, err, client]);

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#6b7280' }}>Загрузка…</div>;
  if (err || !client) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#ef4444' }}>{err || 'Клиент не найден'}</div>;

  const ms = client.measurements;
  const fromM = ms.find(m => m.id === fromId) ?? ms[0];
  const toM   = ms.find(m => m.id === toId)   ?? ms[ms.length - 1];

  const daysBetween = fromM && toM
    ? Math.round((new Date(toM.measured_at).getTime() - new Date(fromM.measured_at).getTime()) / 86400_000)
    : null;

  const totalDelta  = fromM && toM ? Number(toM.total_cm)  - Number(fromM.total_cm)  : null;
  const weightDelta = fromM && toM && fromM.weight != null && toM.weight != null
    ? Number(toM.weight) - Number(fromM.weight) : null;

  const bellyFrom = fromM ? Number(fromM.belly ?? 0) : null;
  const bellyTo   = toM   ? Number(toM.belly   ?? 0) : null;

  const summaryLine1 = bellyFrom != null && bellyTo != null
    ? `Живот: ${bellyFrom.toFixed(1)} → ${bellyTo.toFixed(1)} (${fmtDiff(bellyTo - bellyFrom)} см)`
    : '';
  const summaryLine2 = totalDelta != null
    ? `Итого: ${fmtDiff(totalDelta)} см${weightDelta != null ? `, вес ${fmtDiff(weightDelta)} кг` : ''}${daysBetween ? ` за ${daysBetween} дн.` : ''}`
    : '';
  const summaryLine3 = toM ? `Консультант: ${toM.consultant}` : '';

  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        body { margin: 0; padding: 0; }
        @media screen { .print-btn { display: flex; } }
        @media print  { .print-btn { display: none !important; } }
      `}</style>

      {/* Screen-only print button */}
      <div className="print-btn" style={{ position: 'fixed', top: 16, right: 16, zIndex: 10, gap: 8 }}>
        <button onClick={() => window.print()}
          style={{ padding: '8px 20px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          🖨 Печать
        </button>
        <button onClick={() => window.close()}
          style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
          Закрыть
        </button>
      </div>

      {/* A4 page */}
      <div style={{
        width: '210mm', height: '297mm',
        position: 'relative', overflow: 'hidden',
        background: '#fff',
      }}>
        <img src="/kviz/img/bodyr.png" alt="" style={{ width: '100%', height: '100%', display: 'block' }} />

        {/* Client name */}
        {client && <Txt x={36} y={12.3} bold size={15}>{client.name}</Txt>}

        {/* ДО */}
        {fromM && <>
          <Txt x={20.5} y={25.3} size={12}>{fmtDateRu(fromM.measured_at)}</Txt>
          {fromM.weight != null && <Txt x={19} y={29.5} size={13} bold>{Number(fromM.weight).toFixed(1)}</Txt>}
        </>}

        {/* ПОСЛЕ */}
        {toM && <>
          <Txt x={79.2} y={25.3} size={12}>{fmtDateRu(toM.measured_at)}</Txt>
          {toM.weight != null && <Txt x={77.8} y={29.5} size={13} bold>{Number(toM.weight).toFixed(1)}</Txt>}
        </>}

        {/* Measurement rows */}
        {PRINT_ROWS.map(row => {
          const vFrom = fromM && fromM[row.key] != null ? Number(fromM[row.key]) : null;
          const vTo   = toM   && toM[row.key]   != null ? Number(toM[row.key])   : null;
          return (
            <div key={row.key}>
              {vFrom != null && <Txt x={X_DO}    y={row.y} size={13} bold>{vFrom.toFixed(1)}</Txt>}
              {vTo   != null && <Txt x={X_AFTER} y={row.y} size={13} bold>{vTo.toFixed(1)}</Txt>}
            </div>
          );
        })}

        {/* Summary lines */}
        {summaryLine1 && <Txt x={40} y={78.4} size={12}>{summaryLine1}</Txt>}
        {summaryLine2 && <Txt x={40} y={81.0} size={12}>{summaryLine2}</Txt>}
        {summaryLine3 && <Txt x={40} y={83.6} size={12}>{summaryLine3}</Txt>}
      </div>
    </>
  );
}
