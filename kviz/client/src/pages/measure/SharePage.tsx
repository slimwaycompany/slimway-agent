import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const CIRC_KEYS = ['neck','chest','arm_l','arm_r','waist','belly','glutes','thigh_l','thigh_r','shin_l','shin_r'] as const;
type CircKey = typeof CIRC_KEYS[number];

const ZONE_LABELS: Record<CircKey, string> = {
  neck: 'Шея', chest: 'Грудь', arm_l: 'Л.рука', arm_r: 'П.рука',
  waist: 'Талия', belly: 'Живот', glutes: 'Ягодицы',
  thigh_l: 'Л.бедро', thigh_r: 'П.бедро', shin_l: 'Л.голень', shin_r: 'П.голень',
};

const BODY_PTS: { key: CircKey; x: number; y: number }[] = [
  { key: 'neck',    x: 50,   y: 18 },
  { key: 'chest',   x: 50,   y: 28 },
  { key: 'arm_r',   x: 36,   y: 30 },
  { key: 'arm_l',   x: 64,   y: 30 },
  { key: 'waist',   x: 50,   y: 38 },
  { key: 'belly',   x: 50,   y: 44 },
  { key: 'glutes',  x: 50,   y: 50 },
  { key: 'thigh_r', x: 45,   y: 60 },
  { key: 'thigh_l', x: 56,   y: 60 },
  { key: 'shin_r',  x: 46,   y: 78 },
  { key: 'shin_l',  x: 54.5, y: 78 },
];

interface IBTest {
  tested_at: string; weight: number|null; bfm: number|null; pbf: number|null;
  smm: number|null; bmi: number|null; vfl: number|null;
}
type IBNumField = 'weight' | 'pbf' | 'smm' | 'vfl';
const IB_METRICS: { label: string; field: IBNumField; unit: string; goodDown: boolean }[] = [
  { label: 'Вес',         field: 'weight', unit: ' кг', goodDown: true },
  { label: '% жира',      field: 'pbf',    unit: '%',   goodDown: true },
  { label: 'Мышцы (SMM)', field: 'smm',    unit: ' кг', goodDown: false },
  { label: 'Висц.жир',    field: 'vfl',    unit: '',    goodDown: true },
];

interface Msr {
  measure_no: number; measured_at: string; total_cm: number;
  [k: string]: unknown;
}
interface ShareData {
  name: string; measurements: Msr[]; inbody_tests?: IBTest[];
  result: { cm_lost: number; kg_lost: number; fat_kg_lost: number|null } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function BodyPanel({ m, prev }: { m: Msr | null | undefined; prev: Msr | null | undefined }) {
  const [tapped, setTapped] = useState<CircKey | null>(null);
  if (!m) return null;
  return (
    <div style={{ position: 'relative', height: 300, userSelect: 'none' }}>
      <img src="/kviz/img/body.png" alt="" style={{ position: 'absolute', left: '15%', top: 0, width: '70%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
      {BODY_PTS.map(pt => {
        const val = m[pt.key] != null ? Number(m[pt.key]) : null;
        if (val == null) return null;
        const pval = prev?.[pt.key] != null ? Number(prev[pt.key]) : null;
        const delta = pval != null ? val - pval : null;
        const isLoss = delta != null && delta < 0;
        const bg = tapped === pt.key ? 'var(--accent)' : isLoss ? 'var(--success)' : 'var(--text-3)';
        return (
          <button key={pt.key}
            onClick={() => setTapped(tapped === pt.key ? null : pt.key)}
            style={{ position: 'absolute', left: `${pt.x}%`, top: `${pt.y}%`,
              transform: 'translate(-50%, -50%)', background: bg, color: 'var(--surface)',
              border: 'none', borderRadius: 6, fontSize: 9, padding: '2px 4px', cursor: 'pointer',
              whiteSpace: 'nowrap', fontWeight: 700, lineHeight: 1.3,
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)', zIndex: 2 }}
          >
            {tapped === pt.key ? val.toFixed(1) : ZONE_LABELS[pt.key].slice(0, 4)}
          </button>
        );
      })}
    </div>
  );
}

function IBChart({ ibs }: { ibs: IBTest[] }) {
  const pts = ibs.filter(ib => ib.weight != null);
  if (pts.length < 3) return null;
  const vals = pts.map(ib => Number(ib.weight));
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const W = 320, H = 90, PL = 32, PR = 8, PT = 8, PB = 20;
  const iW = W - PL - PR, iH = H - PT - PB;
  const tx = (i: number) => PL + (i / (pts.length - 1)) * iW;
  const ty = (v: number) => PT + iH - ((v - min + range * 0.1) / (range * 1.2)) * iH;
  const d = pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${ty(vals[i]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((ib, i) => (
        <g key={i}>
          <circle cx={tx(i)} cy={ty(vals[i])} r={i === pts.length - 1 ? 5 : 3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
          <text x={tx(i)} y={H - 2} textAnchor="middle" fontSize={7} fill="var(--text-3)">{fmtDate(ib.tested_at).slice(0, 5)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'figure' | 'zones' | 'inbody'>('figure');
  const [mView, setMView] = useState<'before' | 'after'>('after');

  // Public share page — always light
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    return () => {
      try {
        if (localStorage.getItem('sw-theme') === 'dark')
          document.documentElement.setAttribute('data-theme', 'dark');
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/r/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error || 'Ошибка')))
      .then(setData)
      .catch(e => setError(typeof e === 'string' ? e : 'Ссылка недействительна'));
  }, [token]);

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif', background: 'var(--surface-2)' }}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 48 }}>🔗</div>
        <div style={{ fontWeight: 700, fontSize: 18, margin: '12px 0 8px' }}>Ссылка недействительна</div>
        <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{error}</div>
      </div>
    </div>
  );
  if (!data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ color: 'var(--text-3)' }}>Загрузка…</div>
    </div>
  );

  const ms = data.measurements;
  const ibs = data.inbody_tests ?? [];
  const first = ms.length > 0 ? ms[0] : null;
  const last = ms.length > 0 ? ms[ms.length - 1] : null;
  const ibFirst = ibs.length > 0 ? ibs[0] : null;
  const ibLast = ibs.length > 0 ? ibs[ibs.length - 1] : null;

  const cmLost = data.result?.cm_lost
    ?? (ms.length >= 2 && first && last ? Number(first.total_cm) - Number(last.total_cm) : 0);
  const kgLost = data.result?.kg_lost
    ?? (ibs.length >= 2 && ibFirst?.weight != null && ibLast?.weight != null
      ? Number(ibFirst.weight) - Number(ibLast.weight) : 0);
  const fatLost = data.result?.fat_kg_lost
    ?? (ibs.length >= 2 && ibFirst?.bfm != null && ibLast?.bfm != null
      ? Number(ibFirst.bfm) - Number(ibLast.bfm) : null);

  const dateBefore = first?.measured_at ?? ibFirst?.tested_at ?? null;
  const dateAfter  = last?.measured_at  ?? ibLast?.tested_at  ?? null;

  const CS = {
    background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
    boxShadow: '0 2px 8px rgba(2,189,182,0.06)', marginBottom: 12, overflow: 'hidden',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-2)', fontFamily: 'Inter,sans-serif', color: 'var(--text)', paddingBottom: 32 }}>
      <style>{`
        * { box-sizing: border-box; }
        .sp-figure-desktop { display: flex !important; }
        .sp-figure-mobile  { display: none  !important; }
        .sp-tbl { display: block !important; }
        .sp-cds { display: none  !important; }
        @media (max-width: 640px) {
          .sp-figure-desktop { display: none  !important; }
          .sp-figure-mobile  { display: block !important; }
          .sp-tbl { display: none  !important; }
          .sp-cds { display: block !important; }
          input, select, textarea { font-size: 16px !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#02BDB6,#263CD9)', padding: '20px 20px 24px' }}>
        <img src="/img/logo.png" alt="SlimWay" style={{ height: 28, borderRadius: 6, marginBottom: 10, display: 'block' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div style={{ color: 'var(--surface)', fontWeight: 700, fontSize: 22 }}>{data.name}</div>
        {dateBefore && dateAfter && dateBefore !== dateAfter && (
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 4 }}>
            {fmtDate(dateBefore)} → {fmtDate(dateAfter)}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 16px' }}>
        {/* Hero */}
        <div style={{ background: 'var(--surface)', borderRadius: '0 0 20px 20px', padding: '20px 12px', marginBottom: 16,
          boxShadow: '0 4px 20px rgba(2,189,182,0.12)', display: 'flex' }}>
          {[
            { val: cmLost  > 0 ? cmLost  : null, unit: 'сантиметров', color: 'var(--primary)' },
            { val: kgLost  > 0 ? kgLost  : null, unit: 'килограммов', color: 'var(--accent)' },
            { val: fatLost != null && fatLost > 0 ? fatLost : null, unit: 'кг жира', color: 'var(--danger)' },
          ].map(({ val, unit, color }, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
              <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: val != null ? color : 'var(--border)' }}>
                {val != null ? `−${val.toFixed(1)}` : '—'}
              </div>
              <div style={{ fontSize: 11, marginTop: 4, color: val != null ? 'var(--text-2)' : 'var(--border)' }}>{unit}</div>
            </div>
          ))}
        </div>

        {/* Tabs — sticky on mobile */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-2)', paddingBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--border)', borderRadius: 14, padding: 4 }}>
            {(['figure','zones','inbody'] as const).map((id, i) => (
              <button key={id} onClick={() => setTab(id)} style={{
                flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 14, borderRadius: 10, transition: 'all 0.15s',
                background: tab === id ? 'var(--primary)' : 'transparent',
                color: tab === id ? 'var(--surface)' : 'var(--text)',
              }}>
                {(['Фигура','Замеры','InBody'] as const)[i]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Фигура ── */}
        {tab === 'figure' && (
          ms.length < 2
            ? <div style={CS}><div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Пока недостаточно данных</div></div>
            : <div style={CS}>
                <div style={{ padding: '12px 8px' }}>
                  <div className="sp-figure-desktop" style={{ gap: 8, justifyContent: 'center' }}>
                    {[{ m: first, prev: null, label: 'До' }, { m: last, prev: first, label: 'После' }].map(({ m, prev, label }) => (
                      <div key={label} style={{ flex: 1 }}>
                        <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-2)',
                          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                        <BodyPanel m={m} prev={prev} />
                      </div>
                    ))}
                  </div>
                  <div className="sp-figure-mobile">
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
                      {(['before','after'] as const).map(mode => (
                        <button key={mode} onClick={() => setMView(mode)} style={{
                          padding: '6px 24px', borderRadius: 20, border: 'none', cursor: 'pointer',
                          background: mView === mode ? 'var(--primary)' : 'var(--surface-2)',
                          color: mView === mode ? 'var(--surface)' : 'var(--text)', fontWeight: 600, fontSize: 13,
                        }}>
                          {mode === 'before' ? 'До' : 'После'}
                        </button>
                      ))}
                    </div>
                    <BodyPanel m={mView === 'before' ? first : last} prev={mView === 'after' ? first : null} />
                  </div>
                </div>
              </div>
        )}

        {/* ── Замеры ── */}
        {tab === 'zones' && (
          <>
            <div className="sp-tbl">
              <div style={CS}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                      {['Зона','Было','Стало','Разница'].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '10px 16px', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CIRC_KEYS.map(k => {
                      const bv = first?.[k] != null ? Number(first[k]) : null;
                      const av = last?.[k] != null  ? Number(last[k])  : null;
                      if (bv == null && av == null) return null;
                      const d = bv != null && av != null && ms.length >= 2 ? av - bv : null;
                      const dc = d == null ? 'var(--text-3)' : d < 0 ? 'var(--success)' : d > 0 ? 'var(--warning)' : 'var(--text-3)';
                      return (
                        <tr key={k} style={{ borderTop: '1px solid #f8fafc', background: d != null && d < 0 ? 'rgba(22,163,74,0.03)' : 'transparent' }}>
                          <td style={{ padding: '8px 16px', fontWeight: 600 }}>{ZONE_LABELS[k]}</td>
                          <td style={{ textAlign: 'right', padding: '8px 16px', color: 'var(--text-2)' }}>{bv != null ? bv.toFixed(1) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: '8px 16px' }}>{av != null ? av.toFixed(1) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: '8px 16px', color: dc, fontWeight: 700 }}>
                            {d == null ? '—' : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="sp-cds">
              <div style={CS}>
                {CIRC_KEYS.map((k, idx) => {
                  const bv = first?.[k] != null ? Number(first[k]) : null;
                  const av = last?.[k] != null  ? Number(last[k])  : null;
                  if (bv == null && av == null) return null;
                  const d = bv != null && av != null && ms.length >= 2 ? av - bv : null;
                  const dc = d == null ? 'var(--text-3)' : d < 0 ? 'var(--success)' : d > 0 ? 'var(--warning)' : 'var(--text-3)';
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px',
                      borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                      background: d != null && d < 0 ? 'rgba(22,163,74,0.03)' : 'transparent' }}>
                      <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{ZONE_LABELS[k]}</div>
                      <div style={{ color: 'var(--text-2)', fontSize: 13, marginRight: 10 }}>
                        {bv != null ? bv.toFixed(1) : '—'} → {av != null ? av.toFixed(1) : '—'}
                      </div>
                      <div style={{ color: dc, fontWeight: 700, fontSize: 15, minWidth: 44, textAlign: 'right' }}>
                        {d == null ? '—' : (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── InBody ── */}
        {tab === 'inbody' && (
          ibs.length === 0
            ? <div style={CS}><div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Нет данных InBody</div></div>
            : <>
                <div style={{ display: 'grid', gridTemplateColumns: ibs.length >= 2 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
                  {(ibs.length >= 2 ? [{ ib: ibFirst!, comp: ibFirst }, { ib: ibLast!, comp: ibFirst }] : [{ ib: ibLast!, comp: null }]).map(({ ib, comp }, i) => (
                    <div key={i} style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', padding: '14px 16px',
                      boxShadow: i > 0 ? '0 2px 10px rgba(2,189,182,0.1)' : 'none' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                        {ibs.length === 1 ? 'Тест' : (i === 0 ? 'Первый' : 'Последний')} · {fmtDate(ib.tested_at)}
                      </div>
                      {IB_METRICS.map(({ label, field, unit, goodDown }) => {
                        const val = ib[field];
                        if (val == null) return null;
                        const prevVal = i > 0 && comp ? comp[field] : null;
                        const delta = prevVal != null ? val - prevVal : null;
                        const arrow = delta == null ? '' : delta < 0 ? ' ↓' : delta > 0 ? ' ↑' : '';
                        const arrowColor = delta == null ? '' : (goodDown ? delta < 0 : delta > 0) ? 'var(--success)' : 'var(--warning)';
                        return (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>
                              {val}{unit}{arrow && <span style={{ color: arrowColor, fontSize: 12 }}>{arrow}</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {ibs.length >= 3 && (
                  <div style={CS}>
                    <div style={{ padding: '12px 12px 8px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Вес — динамика</div>
                      <IBChart ibs={ibs} />
                    </div>
                  </div>
                )}
              </>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', paddingTop: 8 }}>
          SlimWay — студия коррекции фигуры
        </div>
      </div>
    </div>
  );
}
