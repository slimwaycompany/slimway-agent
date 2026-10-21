import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const CIRC_KEYS = ['neck','chest','arm_l','arm_r','waist','belly','glutes','thigh_l','thigh_r','shin_l','shin_r'] as const;

interface Measurement {
  measure_no: number; measured_at: string;
  weight: number | null; total_cm: number;
  neck?: number; chest?: number; arm_l?: number; arm_r?: number;
  waist?: number; belly?: number; glutes?: number;
  thigh_l?: number; thigh_r?: number; shin_l?: number; shin_r?: number;
  inbody?: { fat_kg?: number; fat_pct?: number; skeletal_muscle_kg?: number; bmi?: number; weight_kg?: number } | null;
  [key: string]: unknown;
}
interface ShareData {
  name: string;
  measurements: Measurement[];
  result: { cm_lost: number; kg_lost: number; fat_kg_lost: number | null } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtDiff(d: number) { return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1); }
function diffColor(d: number) { return d < 0 ? '#16a34a' : d > 0 ? '#f59e0b' : '#9ca3af'; }

const ZONE_COLORS: Record<string, string> = {
  neck: '#f59e0b', chest: '#ec4899', arm_l: '#8b5cf6', arm_r: '#06b6d4',
  waist: '#ef4444', belly: '#f97316', glutes: '#84cc16',
  thigh_l: '#14b8a6', thigh_r: '#a855f7', shin_l: '#64748b', shin_r: '#78716c',
};
const ZONE_LABELS: Record<string, string> = {
  neck: 'Шея', chest: 'Грудь', arm_l: 'Л.рука', arm_r: 'П.рука',
  waist: 'Талия', belly: 'Живот', glutes: 'Ягодицы',
  thigh_l: 'Л.бедро', thigh_r: 'П.бедро', shin_l: 'Л.голень', shin_r: 'П.голень',
};

function MiniChart({ ms }: { ms: Measurement[] }) {
  if (ms.length < 2) return null;
  const W = 360, H = 120, PL = 32, PR = 8, PT = 8, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;
  const vals = ms.map(m => Number(m.total_cm));
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const tx = (i: number) => PL + (i / (ms.length - 1)) * iW;
  const ty = (v: number) => PT + iH - ((v - min + range * 0.1) / (range * 1.2)) * iH;
  const d = ms.map((m, i) => `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${ty(Number(m.total_cm)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <path d={d} fill="none" stroke="#02BDB6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {ms.map((m, i) => (
        <g key={i}>
          <circle cx={tx(i)} cy={ty(Number(m.total_cm))} r={i === ms.length - 1 ? 5 : 3.5} fill="#02BDB6" stroke="#fff" strokeWidth={1.5} />
          <text x={tx(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">
            {`№${m.measure_no}`}
          </text>
        </g>
      ))}
      <text x={tx(ms.length - 1)} y={ty(vals[ms.length - 1]) - 8} textAnchor="middle" fontSize={9} fontWeight="700" fill="#02BDB6">
        {vals[vals.length - 1].toFixed(1)}
      </text>
    </svg>
  );
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/r/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error || 'Ошибка')))
      .then(setData)
      .catch(e => setError(typeof e === 'string' ? e : 'Ссылка недействительна'));
  }, [token]);

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Ссылка недействительна</div>
        <div style={{ color: '#6b7280', fontSize: 14 }}>{error}</div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ color: '#9ca3af' }}>Загрузка…</div>
    </div>
  );

  const ms = data.measurements;
  const first = ms[0], last = ms[ms.length - 1];
  const cmLost = data.result?.cm_lost ?? (first && last ? Math.max(0, Number(first.total_cm) - Number(last.total_cm)) : 0);
  const kgLost = data.result?.kg_lost ?? (first?.weight != null && last?.weight != null ? Math.max(0, Number(first.weight) - Number(last.weight)) : 0);
  const fatLost = data.result?.fat_kg_lost ?? null;

  const lastInBody = ms.slice().reverse().find(m => m.inbody);
  const ib = lastInBody?.inbody;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter,sans-serif', color: '#1e293b' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#02BDB6,#263CD9)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/img/logo.png" alt="SlimWay" style={{ height: 36, borderRadius: 8 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>SlimWay — результаты</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>{data.name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 16px' }}>

        {/* Потеряно */}
        {(cmLost > 0 || kgLost > 0) && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '20px 20px', marginBottom: 16, border: '1px solid #e2e6ea', boxShadow: '0 2px 8px rgba(2,189,182,0.08)' }}>
            <div style={{ fontWeight: 700, color: '#263CD9', fontSize: 16, marginBottom: 12 }}>Потеряно со старта</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center', flex: 1, minWidth: 80 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#02BDB6' }}>{cmLost.toFixed(1)}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>сантиметров</div>
              </div>
              <div style={{ textAlign: 'center', flex: 1, minWidth: 80 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#263CD9' }}>{kgLost.toFixed(1)}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>килограммов</div>
              </div>
              {fatLost != null && (
                <div style={{ textAlign: 'center', flex: 1, minWidth: 80 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444' }}>{fatLost.toFixed(1)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>кг жира</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* InBody summary */}
        {ib && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, border: '1px solid #e2e6ea' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#374151' }}>InBody-оценка</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
              {ib.weight_kg != null && <span>Вес: <b>{ib.weight_kg} кг</b></span>}
              {ib.fat_pct != null && <span>% жира: <b>{ib.fat_pct}%</b></span>}
              {ib.fat_kg != null && <span>Жировая масса: <b>{ib.fat_kg} кг</b></span>}
              {ib.skeletal_muscle_kg != null && <span>Мышцы: <b>{ib.skeletal_muscle_kg} кг</b></span>}
              {ib.bmi != null && <span>ИМТ: <b>{ib.bmi}</b></span>}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
              Замер {fmtDate(lastInBody!.measured_at)}
            </div>
          </div>
        )}

        {/* Chart */}
        {ms.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, border: '1px solid #e2e6ea' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#374151' }}>График — сумма обхватов</div>
            <MiniChart ms={ms} />
          </div>
        )}

        {/* Zones from last measurement */}
        {last && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, border: '1px solid #e2e6ea' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#374151' }}>
              Последний замер — №{last.measure_no} · {fmtDate(last.measured_at)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {last.weight != null && (
                <div style={{ padding: '6px 12px', borderRadius: 8, background: '#263CD9' + '15', border: '1px solid #263CD9' + '40', fontSize: 12, fontWeight: 600 }}>
                  Вес: {Number(last.weight).toFixed(1)} кг
                  {first?.weight != null && <span style={{ color: diffColor(Number(last.weight) - Number(first.weight)), marginLeft: 6, fontWeight: 700 }}>
                    {fmtDiff(Number(last.weight) - Number(first.weight))}
                  </span>}
                </div>
              )}
              {CIRC_KEYS.map(k => {
                const v = last[k] != null ? Number(last[k]) : null;
                if (v == null) return null;
                const fv = first[k] != null ? Number(first[k]) : null;
                const d = fv != null ? v - fv : null;
                const color = ZONE_COLORS[k] ?? '#02BDB6';
                return (
                  <div key={k} style={{ padding: '6px 12px', borderRadius: 8, background: color + '15', border: `1px solid ${color}40`, fontSize: 12, fontWeight: 600 }}>
                    {ZONE_LABELS[k]}: {v.toFixed(1)}
                    {d != null && <span style={{ color: diffColor(d), marginLeft: 6, fontWeight: 700 }}>{fmtDiff(d)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', paddingBottom: 24 }}>
          SlimWay — студия коррекции фигуры
        </div>
      </div>
    </div>
  );
}
