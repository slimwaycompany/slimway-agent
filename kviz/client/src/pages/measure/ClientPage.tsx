import { useState, useEffect, useCallback, useRef, Component } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import { MeasureLayout } from './MeasureLayout';
import { parseInBody } from '../../utils/inbody';

const CIRC_KEYS = ['neck','chest','arm_l','arm_r','waist','belly','glutes','thigh_l','thigh_r','shin_l','shin_r'] as const;
type CircKey = typeof CIRC_KEYS[number];

const BODY_POINTS: { key: CircKey; label: string; x: number; y: number }[] = [
  { key: 'neck',    label: 'Шея',      x: 50,   y: 18 },
  { key: 'chest',   label: 'Грудь',    x: 50,   y: 28 },
  { key: 'arm_r',   label: 'П.рука',   x: 36,   y: 30 },
  { key: 'arm_l',   label: 'Л.рука',   x: 64,   y: 30 },
  { key: 'waist',   label: 'Талия',    x: 50,   y: 38 },
  { key: 'belly',   label: 'Живот',    x: 50,   y: 44 },
  { key: 'glutes',  label: 'Ягодицы',  x: 50,   y: 50 },
  { key: 'thigh_r', label: 'П.бедро',  x: 45,   y: 60 },
  { key: 'thigh_l', label: 'Л.бедро',  x: 56,   y: 60 },
  { key: 'shin_r',  label: 'П.голень', x: 46,   y: 78 },
  { key: 'shin_l',  label: 'Л.голень', x: 54.5, y: 78 },
];

const ALL_ZONES: { key: string; label: string; color: string; isWeight?: boolean }[] = [
  { key: 'total_cm', label: 'Сумма',   color: '#02BDB6' },
  { key: 'weight',   label: 'Вес',     color: '#263CD9', isWeight: true },
  { key: 'neck',     label: 'Шея',     color: '#f59e0b' },
  { key: 'chest',    label: 'Грудь',   color: '#ec4899' },
  { key: 'arm_l',    label: 'Л.рука',  color: '#8b5cf6' },
  { key: 'arm_r',    label: 'П.рука',  color: '#06b6d4' },
  { key: 'waist',    label: 'Талия',   color: '#ef4444' },
  { key: 'belly',    label: 'Живот',   color: '#f97316' },
  { key: 'glutes',   label: 'Ягодицы', color: '#84cc16' },
  { key: 'thigh_l',  label: 'Л.бедро', color: '#14b8a6' },
  { key: 'thigh_r',  label: 'П.бедро', color: '#a855f7' },
  { key: 'shin_l',   label: 'Л.голень',color: '#64748b' },
  { key: 'shin_r',   label: 'П.голень',color: '#78716c' },
];
const DEFAULT_ZONES = ['total_cm', 'weight'];
const LS_KEY = 'mz_zones';

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
interface StudioResult { cm_lost: number; kg_lost: number; fat_kg_lost: number | null; sent_by: string; sent_at: string; to_measure_no: number }
interface InBodyTest {
  id: string; inbody_id: string; tested_at: string; source: 'qr' | 'csv';
  weight: number | null; bfm: number | null; pbf: number | null;
  smm: number | null; ffm: number | null; bmi: number | null;
  vfl: number | null; inbody_score: number | null; whr: number | null; bmr: number | null;
  data: Record<string, unknown> | null;
}

// ── Error boundary ─────────────────────────────────────────────────────────────
class ErrorBlock extends Component<{ children: ReactNode; label: string }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String(e) }; }
  render() {
    if (this.state.err) return (
      <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 14, color: '#ef4444', fontSize: 13 }}>
        Не удалось загрузить: {this.props.label}. <span style={{ color: '#9ca3af' }}>{this.state.err}</span>
      </div>
    );
    return this.props.children;
  }
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
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}
function fmtShortDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

// ── Body figure ────────────────────────────────────────────────────────────────

function BodyFigure({ m, prev, activeZones, activeZone, onZoneClick }: {
  m: Measurement | null; prev: Measurement | null;
  activeZones: string[]; activeZone: CircKey | null; onZoneClick: (key: CircKey) => void;
}) {
  const leftKeys = new Set<CircKey>(['arm_r', 'thigh_r', 'shin_r']);
  const centerKeys = new Set<CircKey>(['neck', 'chest', 'waist', 'belly', 'glutes']);
  const sideByKey = new Map<CircKey, 'left' | 'right'>();
  let centerIndex = 0;
  for (const pt of BODY_POINTS) {
    const side = leftKeys.has(pt.key) ? 'left' : centerKeys.has(pt.key) ? (centerIndex++ % 2 ? 'right' : 'left') : 'right';
    sideByKey.set(pt.key, side);
  }
  const rows = { left: BODY_POINTS.filter(p => sideByKey.get(p.key) === 'left'), right: BODY_POINTS.filter(p => sideByKey.get(p.key) === 'right') };
  const rowY = new Map<CircKey, number>();
  for (const side of ['left', 'right'] as const) rows[side].forEach((pt, i) => rowY.set(pt.key, 8 + (84 * (i + 1)) / (rows[side].length + 1)));
  return (
    <div className={`figure-canvas${activeZone ? ' figure-blurred' : ''}`}>
      <img className="body-silhouette" src="/kviz/img/body.png" alt="Силуэт фигуры" />
      <svg className="figure-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {BODY_POINTS.map(pt => <line key={pt.key} x1={15 + pt.x * .7} y1={pt.y} x2={sideByKey.get(pt.key) === 'left' ? 27 : 73} y2={rowY.get(pt.key)} stroke="#91a0b7" strokeWidth=".35" />)}
      </svg>
      {m && BODY_POINTS.map(pt => {
        const val = m[pt.key] != null ? Number(m[pt.key]) : null;
        if (val == null) return null;
        const diff = prev && prev[pt.key] != null ? val - Number(prev[pt.key]) : null;
        const active = activeZones.includes(pt.key);
        const zoneColor = ALL_ZONES.find(z => z.key === pt.key)?.color ?? '#02BDB6';
        const side = sideByKey.get(pt.key)!;
        return (
          <div key={pt.key}
            onClick={() => onZoneClick(pt.key)}
            className={`body-callout body-callout-${side} ${active ? 'active' : ''}`}
            style={{ top: `${rowY.get(pt.key)}%`, '--zone-color': zoneColor } as React.CSSProperties}
          >
            <span className="body-callout-label">{pt.label}</span>
            <strong>{val.toFixed(1)} см</strong>
            {diff !== null && <small style={{ color: diffColor(diff) }}>{fmtDiff(diff)}</small>}
          </div>
        );
      })}
    </div>
  );
}

// ── Zone checkboxes ────────────────────────────────────────────────────────────

function ZoneCheckboxes({ zones, onChange }: { zones: string[]; onChange: (z: string[]) => void }) {
  const toggle = (key: string) => {
    onChange(zones.includes(key) ? zones.filter(z => z !== key) : [...zones, key]);
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {ALL_ZONES.map(z => (
          <label key={z.key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, padding: '3px 8px',
            background: zones.includes(z.key) ? z.color + '22' : '#f1f5f9',
            border: `1.5px solid ${zones.includes(z.key) ? z.color : '#e2e6ea'}`,
            borderRadius: 20, color: zones.includes(z.key) ? '#1a202c' : '#64748b',
            fontWeight: zones.includes(z.key) ? 600 : 400, transition: 'all .15s',
          }}>
            <input type="checkbox" style={{ display: 'none' }} checked={zones.includes(z.key)} onChange={() => toggle(z.key)} />
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: z.color, flexShrink: 0 }} />
            {z.label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={qBtn} onClick={() => onChange(ALL_ZONES.map(z => z.key))}>Все зоны</button>
        <button style={qBtn} onClick={() => onChange(['total_cm'])}>Только сумма</button>
        <button style={qBtn} onClick={() => onChange(DEFAULT_ZONES)}>Сбросить</button>
      </div>
    </div>
  );
}
const qBtn: React.CSSProperties = {
  fontSize: 11, padding: '3px 10px', border: '1px solid #e2e6ea', borderRadius: 6,
  background: '#f8fafc', cursor: 'pointer', fontFamily: 'inherit', color: '#374151',
};

// ── Multi-line SVG chart ───────────────────────────────────────────────────────

function MultiLineChart({ ms, zones, selectedId, onSelect }: {
  ms: Measurement[]; zones: string[]; selectedId: string; onSelect: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (ms.length < 2) {
    return (
      <div style={{ background: '#f8fafc', borderRadius: 10, padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
        Динамика появится после второго замера
      </div>
    );
  }

  const W = 560, H = 200, PL = 44, PR = 44, PT = 14, PB = 36;
  const iW = W - PL - PR, iH = H - PT - PB;

  const activeZones = ALL_ZONES.filter(z => zones.includes(z.key));
  const cmZones = activeZones.filter(z => !z.isWeight);
  const hasWeight = zones.includes('weight') && ms.some(m => m.weight != null);

  // cm range (left axis)
  let cmMin = Infinity, cmMax = -Infinity;
  for (const z of cmZones) {
    for (const m of ms) {
      const v = m[z.key] != null ? Number(m[z.key]) : null;
      if (v != null) { cmMin = Math.min(cmMin, v); cmMax = Math.max(cmMax, v); }
    }
  }
  if (cmMin === Infinity) { cmMin = 0; cmMax = 100; }
  const cmRange = cmMax - cmMin || 1;
  const cmPad = cmRange * 0.1;

  // weight range (right axis)
  let wMin = Infinity, wMax = -Infinity;
  if (hasWeight) {
    for (const m of ms) {
      if (m.weight != null) { wMin = Math.min(wMin, m.weight); wMax = Math.max(wMax, m.weight); }
    }
  }
  if (wMin === Infinity) { wMin = 50; wMax = 100; }
  const wRange = wMax - wMin || 1;
  const wPad = wRange * 0.1;

  function tx(i: number) { return PL + (i / (ms.length - 1)) * iW; }
  function tyCm(v: number) { return PT + iH - ((v - (cmMin - cmPad)) / (cmRange + 2 * cmPad)) * iH; }
  function tyW(v: number)  { return PT + iH - ((v - (wMin - wPad))  / (wRange  + 2 * wPad))  * iH; }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = (e.clientX - rect.left) * (W / rect.width);
    const relX = xPx - PL;
    const idx = Math.round((relX / iW) * (ms.length - 1));
    setHoverIdx(Math.max(0, Math.min(ms.length - 1, idx)));
  }

  const hi = hoverIdx ?? (ms.findIndex(m => m.id === selectedId) >= 0 ? ms.findIndex(m => m.id === selectedId) : null);
  const selIdx = ms.findIndex(m => m.id === selectedId);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
      onClick={() => { if (hoverIdx != null) onSelect(ms[hoverIdx].id); }}
    >
      {/* Grid */}
      {[0, 0.5, 1].map((f, i) => (
        <line key={i} x1={PL} x2={W - PR} y1={PT + iH * (1 - f)} y2={PT + iH * (1 - f)}
          stroke="#e2e6ea" strokeWidth={0.8} />
      ))}

      {/* X axis labels */}
      {ms.map((m, i) => (
        <text key={i} x={tx(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#9ca3af">
          {`№${m.measure_no}·${fmtShortDate(m.measured_at)}`}
        </text>
      ))}

      {/* Left Y axis labels (cm) */}
      {cmZones.length > 0 && [0, 0.5, 1].map((f, i) => {
        const v = (cmMin - cmPad) + f * (cmRange + 2 * cmPad);
        return <text key={i} x={PL - 4} y={PT + iH * (1 - f) + 3} textAnchor="end" fontSize={9} fill="#6b7280">{v.toFixed(0)}</text>;
      })}

      {/* Right Y axis labels (kg) */}
      {hasWeight && [0, 0.5, 1].map((f, i) => {
        const v = (wMin - wPad) + f * (wRange + 2 * wPad);
        return <text key={i} x={W - PR + 4} y={PT + iH * (1 - f) + 3} textAnchor="start" fontSize={9} fill="#263CD9">{v.toFixed(1)}</text>;
      })}

      {/* Lines */}
      {cmZones.map(z => {
        const pts = ms.map((m, i) => {
          const v = m[z.key] != null ? Number(m[z.key]) : null;
          return v != null ? `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${tyCm(v).toFixed(1)}` : null;
        }).filter(Boolean).join(' ');
        if (!pts) return null;
        return <path key={z.key} d={pts} fill="none" stroke={z.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
      })}
      {hasWeight && (() => {
        const pts = ms.map((m, i) => {
          if (m.weight == null) return null;
          return `${i === 0 || ms.slice(0, i).every(x => x.weight == null) ? 'M' : 'L'}${tx(i).toFixed(1)},${tyW(m.weight).toFixed(1)}`;
        }).filter(Boolean).join(' ');
        return pts ? <path d={pts} fill="none" stroke="#263CD9" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" /> : null;
      })()}

      {/* Dots */}
      {cmZones.map(z =>
        ms.map((m, i) => {
          const v = m[z.key] != null ? Number(m[z.key]) : null;
          if (v == null) return null;
          const isSelected = m.id === selectedId;
          const isLast = i === ms.length - 1;
          return (
            <g key={`${z.key}-${i}`}>
              <circle cx={tx(i)} cy={tyCm(v)} r={isSelected ? 6 : isLast ? 5 : 3.5} fill={z.color} stroke="#fff" strokeWidth={1.5} />
              {isLast && z.key === activeZones[0]?.key && (
                <text x={tx(i)} y={tyCm(v) - 8} textAnchor="middle" fontSize={9} fontWeight="700" fill={z.color}>
                  {v.toFixed(1)}
                </text>
              )}
            </g>
          );
        })
      )}
      {hasWeight && ms.map((m, i) => {
        if (m.weight == null) return null;
        const isSelected = m.id === selectedId;
        const isLast = i === ms.length - 1;
        return (
          <g key={`w-${i}`}>
            <circle cx={tx(i)} cy={tyW(m.weight)} r={isSelected ? 5 : isLast ? 4 : 3} fill="#263CD9" stroke="#fff" strokeWidth={1.5} />
            {isLast && zones[0] === 'weight' && (
              <text x={tx(i)} y={tyW(m.weight) - 7} textAnchor="middle" fontSize={9} fontWeight="700" fill="#263CD9">
                {m.weight.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}

      {/* Selected highlight bar */}
      {selIdx >= 0 && (
        <line x1={tx(selIdx)} x2={tx(selIdx)} y1={PT} y2={PT + iH}
          stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
      )}

      {/* Hover cursor + tooltip */}
      {hi != null && (
        <>
          <line x1={tx(hi)} x2={tx(hi)} y1={PT} y2={PT + iH} stroke="#334155" strokeWidth={1} opacity={0.4} />
          {(() => {
            const m = ms[hi];
            const prev = hi > 0 ? ms[hi - 1] : null;
            const tipLines: { label: string; val: string; color: string }[] = [];
            for (const z of activeZones) {
              const v = m[z.key] != null ? Number(m[z.key]) : null;
              if (v == null) continue;
              const pv = prev && prev[z.key] != null ? Number(prev[z.key]) : null;
              const diff = pv != null ? v - pv : null;
              tipLines.push({
                label: z.label,
                val: `${v.toFixed(1)}${diff != null ? ` (${fmtDiff(diff)})` : ''}`,
                color: z.color,
              });
            }
            const tipW = 140, lineH = 14, tipH = 18 + tipLines.length * lineH;
            const tipX = tx(hi) + 8 + tipW > W - PR ? tx(hi) - 8 - tipW : tx(hi) + 8;
            const tipY = Math.max(PT, PT + iH / 2 - tipH / 2);
            return (
              <g>
                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(30,41,59,0.92)" />
                <text x={tipX + 8} y={tipY + 12} fontSize={9} fontWeight="700" fill="#e2e8f0">
                  №{m.measure_no} · {fmtDate(m.measured_at)}
                </text>
                {tipLines.map((l, i) => (
                  <g key={i}>
                    <circle cx={tipX + 12} cy={tipY + 18 + i * lineH + 3} r={3} fill={l.color} />
                    <text x={tipX + 20} y={tipY + 22 + i * lineH} fontSize={9} fill="#e2e8f0">{l.label}: {l.val}</text>
                  </g>
                ))}
              </g>
            );
          })()}
        </>
      )}
    </svg>
  );
}

// ── Fitbase button per measurement ─────────────────────────────────────────────

function FitbaseBtn({ m, client, onDone }: {
  m: Measurement; client: Client;
  onDone: (measurementId: string, fitbase_comment_at: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const localAt = m.fitbase_comment_at;

  async function send() {
    setSending(true); setError(null); setConfirm(false);
    try {
      const r = await apiPost(`/api/measure/measurements/${m.id}/fitbase`, {});
      if (r.error) throw new Error(r.error);
      onDone(m.id, r.fitbase_comment_at);
    } catch (e) { setError(String(e)); }
    finally { setSending(false); }
  }

  if (!client.fitbase_client_id) {
    return <span style={{ fontSize: 11, color: '#9ca3af' }}>Нет связи Fitbase</span>;
  }
  if (localAt) {
    return (
      <span style={{ fontSize: 11, color: '#22c55e' }}>
        ✓ {fmtTime(localAt)}
        {!confirm && <button onClick={() => setConfirm(true)} style={fbReSt}>↺</button>}
        {confirm && <><button onClick={send} disabled={sending} style={{ ...fbReSt, color: '#f59e0b' }}>Ещё раз?</button><button onClick={() => setConfirm(false)} style={fbReSt}>✕</button></>}
      </span>
    );
  }
  return (
    <div>
      <button onClick={send} disabled={sending} style={fbBtnSt}>{sending ? '…' : 'Fitbase'}</button>
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{error}</div>}
    </div>
  );
}
const fbBtnSt: React.CSSProperties = { fontSize: 11, padding: '2px 8px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
const fbReSt:  React.CSSProperties = { fontSize: 10, marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0 };

// ── Link dialog ────────────────────────────────────────────────────────────────

function LinkDialog({ clientId, onLinked, onClose }: {
  clientId: string; onLinked: (fbId: number) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ fitbase_client_id: number; name: string; phone: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(async () => {
      try {
        const data = await apiGet(`/api/measure/clients?q=${encodeURIComponent(q)}`);
        setResults((data as { source: string; fitbase_client_id: number | null; name: string; phone: string | null }[])
          .filter(c => c.source === 'fitbase' && c.fitbase_client_id));
      } catch { setResults([]); }
    }, 300);
  }, [q]);

  async function link(fbId: number) {
    setSaving(true); setErr('');
    try {
      await fetch(`/kviz/api/measure/clients/${clientId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitbase_client_id: fbId }),
      });
      onLinked(fbId);
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={modalS} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Связать с клиентом Fitbase</div>
        <input autoFocus style={inputS} placeholder="Имя или телефон" value={q}
          onChange={e => setQ(e.target.value)} />
        {results.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
            {results.map(c => (
              <div key={c.fitbase_client_id} onClick={() => !saving && link(c.fitbase_client_id)}
                style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid #e2e6ea', marginBottom: 4, background: '#fff',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                {c.phone && <span style={{ fontSize: 12, color: '#6b7280' }}>{c.phone}</span>}
              </div>
            ))}
          </div>
        )}
        {err && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{err}</div>}
        <button onClick={onClose} style={{ ...fbBtnSt, marginTop: 12, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea' }}>Отмена</button>
      </div>
    </div>
  );
}

// ── Print dialog ───────────────────────────────────────────────────────────────

function PrintDialog({ ms, clientId, onClose }: {
  ms: Measurement[]; clientId: string; onClose: () => void;
}) {
  const [fromId, setFromId] = useState(ms[0]?.id ?? '');
  const [toId, setToId] = useState(ms[ms.length - 1]?.id ?? '');
  const query = `client=${encodeURIComponent(clientId)}&from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`;

  function printBlank() {
    const frame = document.createElement('iframe');
    frame.title = 'Печать бланка замеров';
    frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none';
    let disposed = false;
    const cleanup = () => { if (disposed) return; disposed = true; window.removeEventListener('afterprint', cleanup); window.setTimeout(() => frame.remove(), 300); };
    window.addEventListener('afterprint', cleanup, { once: true });
    frame.onload = () => {
      const started = Date.now();
      const waitForBlank = () => {
        try {
          const image = frame.contentDocument?.querySelector('img');
          if (image && image.complete && image.naturalWidth > 0) {
            frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
            frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(cleanup, 300_000); return;
          }
        } catch { cleanup(); return; }
        if (Date.now() - started > 20_000) { cleanup(); return; }
        window.setTimeout(waitForBlank, 100);
      };
      waitForBlank();
    };
    document.body.appendChild(frame);
    frame.src = `/kviz/measure/print?${query}&embed=1&mode=print`;
  }

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={{ ...modalS, width: 'min(1100px,96vw)', height: 'min(92vh,900px)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>🖨 Предпросмотр бланка</div>
        <label style={lblS}>ДО — замер</label>
        <select value={fromId} onChange={e => setFromId(e.target.value)} style={selS}>
          {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
        </select>
        <label style={{ ...lblS, marginTop: 10 }}>ПОСЛЕ — замер</label>
        <select value={toId} onChange={e => setToId(e.target.value)} style={selS}>
          {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
        </select>
        <iframe title="Предпросмотр бланка" src={`/kviz/measure/print?${query}&embed=1&mode=preview`} style={{ flex: 1, minHeight: 220, width: '100%', border: '1px solid #e2e6ea', borderRadius: 8, background: '#f8fafc', marginTop: 14 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...fbBtnSt, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', padding: '7px 14px', fontSize: 13 }}>Отмена</button>
          <button onClick={printBlank} style={{ padding: '7px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flex: 1 }}>
            Печать
          </button>
        </div>
      </div>
    </div>
  );
}
const overlayS: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
const modalS:   React.CSSProperties = { background: '#fff', borderRadius: 14, padding: '20px 22px', width: 'min(400px,94vw)', maxHeight: '90vh', overflow: 'auto' };
const inputS:   React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ea', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
const selS:     React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e6ea', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', marginTop: 4 };
const lblS:     React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block' };

// ── Share link dialog ──────────────────────────────────────────────────────────

function ShareLinkDialog({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/kviz/api/measure/clients/${clientId}/share`, { credentials: 'include' })
      .then(r => r.json()).then(d => setUrl(d.url ? window.location.origin + d.url : null))
      .catch(e => setErr(String(e))).finally(() => setLoading(false));
  }, [clientId]);

  async function refresh() {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/kviz/api/measure/clients/${clientId}/share/refresh`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      setUrl(d.url ? window.location.origin + d.url : null);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const waUrl = url ? `https://wa.me/?text=${encodeURIComponent('Ваши результаты SlimWay: ' + url)}` : '';

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={{ ...modalS, width: 'min(400px,94vw)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Ссылка для клиента</div>
        {loading && <div style={{ color: '#9ca3af', fontSize: 13 }}>Генерация…</div>}
        {err && <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
        {url && !loading && (
          <>
            <div style={{ background: '#f1f5f9', borderRadius: 8, padding: '8px 12px', fontSize: 12, wordBreak: 'break-all', marginBottom: 12 }}>{url}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={copy} style={{ ...ibBtnSt, flex: 1 }}>{copied ? '✓ Скопировано' : 'Скопировать'}</button>
              <a href={waUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...ibBtnSt, textDecoration: 'none', background: '#dcfce7', color: '#166534', border: '1px solid #86efac', flex: 1, textAlign: 'center' as const }}>
                WhatsApp
              </a>
            </div>
            <button onClick={refresh} disabled={loading} style={{ fontSize: 12, background: 'none', border: '1px solid #e2e6ea', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: '#6b7280', width: '100%', fontFamily: 'inherit' }}>
              Перевыпустить ссылку (старая перестанет работать)
            </button>
          </>
        )}
        <button onClick={onClose} style={{ ...fbBtnSt, marginTop: 12, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', width: '100%', padding: '8px', fontSize: 13 }}>Закрыть</button>
      </div>
    </div>
  );
}

// ── InBody scan dialog ─────────────────────────────────────────────────────────

function extractIBData(input: string): string | null {
  const trimmed = input.trim();
  // Full URL: https://qrcode.inbody.com?IBData=...
  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get('IBData');
    if (v) return v;
  } catch { /* not a URL, try raw string */ }
  // Raw QR string (starts with device prefix)
  if (/^270-/.test(trimmed)) return trimmed;
  return null;
}

function InBodyDialog({ clientId, onDone, onClose }: {
  clientId: string; onDone: () => void; onClose: () => void;
}) {
  const [pasteVal, setPasteVal] = useState('');
  const [parsed, setParsed] = useState<InBodyData | null>(null);
  const [parseErr, setParseErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function tryParse(raw: string) {
    const s = extractIBData(raw);
    if (!s) { setParseErr('Не удалось найти данные InBody в строке'); setParsed(null); return; }
    const d = parseInBody(s);
    if (!d) { setParseErr('Строка не распознана как данные InBody'); setParsed(null); return; }
    setParseErr('');
    setParsed(d);
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setCameraActive(true);
      scanFrame();
    } catch { setParseErr('Камера недоступна. Вставьте ссылку или загрузите фото.'); }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setCameraActive(false);
  }

  function scanFrame() {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    ctx.drawImage(video, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    import('jsqr').then(({ default: jsQR }) => {
      const code = jsQR(imgData.data, imgData.width, imgData.height);
      if (code?.data) {
        stopCamera();
        tryParse(code.data);
      } else {
        rafRef.current = requestAnimationFrame(scanFrame);
      }
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      import('jsqr').then(({ default: jsQR }) => {
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) tryParse(code.data);
        else setParseErr('QR-код не найден на фото. Попробуйте вставить ссылку вручную.');
      });
    };
    img.src = URL.createObjectURL(file);
  }

  useEffect(() => () => { stopCamera(); }, []);

  async function save() {
    if (!parsed) return;
    setSaving(true); setSaveErr('');
    try {
      const r = await fetch('/kviz/api/inbody/qr', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, inbody: parsed }),
      });
      const json = await r.json();
      if (!r.ok) { setSaveErr(json.error || 'Ошибка сохранения'); return; }
      onDone();
    } catch (e) { setSaveErr(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={{ ...modalS, width: 'min(460px,96vw)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>InBody — сканирование</div>

        {!parsed && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button style={ibBtnSt} onClick={cameraActive ? stopCamera : startCamera}>
                {cameraActive ? '⏹ Стоп' : '📷 Камера'}
              </button>
              <button style={ibBtnSt} onClick={() => fileRef.current?.click()}>📂 Фото</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
            </div>
            {cameraActive && (
              <div style={{ position: 'relative', marginBottom: 12, borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                <video ref={videoRef} style={{ width: '100%', display: 'block' }} muted playsInline />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div style={{ position: 'absolute', inset: 0, border: '2px solid #02BDB6', borderRadius: 8, pointerEvents: 'none' }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Или вставьте ссылку / строку из QR:</div>
            <input style={inputS} placeholder="https://qrcode.inbody.com?IBData=..." value={pasteVal}
              onChange={e => { setPasteVal(e.target.value); if (e.target.value.length > 20) tryParse(e.target.value); }} />
            {parseErr && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{parseErr}</div>}
          </>
        )}

        {parsed && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#166534' }}>✓ Данные распознаны</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
              <span>Дата: {new Date(parsed.measured_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Yekaterinburg' })}</span>
              <span>Вес: {parsed.weight_kg} кг</span>
              <span>Рост: {parsed.height_cm} см</span>
              <span>Жир: {parsed.fat_kg} кг ({parsed.fat_pct}%)</span>
              <span>Мышцы: {parsed.skeletal_muscle_kg} кг</span>
              <span>ИМТ: {parsed.bmi}</span>
            </div>
            <button style={{ marginTop: 8, fontSize: 12, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0 }}
              onClick={() => { setParsed(null); setPasteVal(''); }}>← Заново</button>
          </div>
        )}

        {saveErr && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{saveErr}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ ...fbBtnSt, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', padding: '7px 14px', fontSize: 13 }}>Отмена</button>
          {parsed && (
            <button onClick={save} disabled={saving} style={{ flex: 1, padding: '7px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
const ibBtnSt: React.CSSProperties = { padding: '6px 14px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 };

// ── Zone Detail Panel ─────────────────────────────────────────────────────────

type SegKey = 'right_arm' | 'left_arm' | 'trunk' | 'right_leg' | 'left_leg';
const SEGMENT_MAP: Partial<Record<CircKey, SegKey>> = {
  neck: 'trunk', arm_r: 'right_arm', arm_l: 'left_arm',
  chest: 'trunk', waist: 'trunk', belly: 'trunk', glutes: 'trunk',
  thigh_r: 'right_leg', thigh_l: 'left_leg',
  shin_r: 'right_leg', shin_l: 'left_leg',
};
const SEG_LABELS: Record<SegKey, string> = { right_arm: 'Правая рука', left_arm: 'Левая рука', trunk: 'Туловище', right_leg: 'Правая нога', left_leg: 'Левая нога' };
const SEG_DATA_KEYS: Record<SegKey, { ffm: string; bfm: string; ffmPct: string; bfmPct: string }> = {
  right_arm: { ffm: 'ffm_ra', bfm: 'bfm_ra', ffmPct: 'ffm_ra_pct', bfmPct: 'bfm_ra_pct' },
  left_arm:  { ffm: 'ffm_la', bfm: 'bfm_la', ffmPct: 'ffm_la_pct', bfmPct: 'bfm_la_pct' },
  trunk:     { ffm: 'ffm_tr', bfm: 'bfm_tr', ffmPct: 'ffm_tr_pct', bfmPct: 'bfm_tr_pct' },
  right_leg: { ffm: 'ffm_rl', bfm: 'bfm_rl', ffmPct: 'ffm_rl_pct', bfmPct: 'bfm_rl_pct' },
  left_leg:  { ffm: 'ffm_ll', bfm: 'bfm_ll', ffmPct: 'ffm_ll_pct', bfmPct: 'bfm_ll_pct' },
};

function ZoneDetailPanel({ zoneKey, ms, latestIBData, onClose }: { zoneKey: CircKey; ms: Measurement[]; latestIBData: Record<string, unknown> | null; onClose: () => void }) {
  const zone = ALL_ZONES.find(z => z.key === zoneKey)!;
  const history = ms.map((m, i) => ({ m, prev: ms[i - 1] ?? null })).filter(({ m }) => m[zoneKey] != null);

  // Linear trend (last 6 measurements, min 3 required)
  let trendInfo: { slopePerWeek: number; next2w: number; next4w: number } | null = null;
  if (history.length >= 3) {
    const pts = history.slice(-6);
    const xs = pts.map(({ m }) => new Date(m.measured_at).getTime() / 86400000);
    const ys = pts.map(({ m }) => Number(m[zoneKey]));
    const n = pts.length;
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slopePerDay = den > 0 ? num / den : 0;
    const lastVal = Number(history[history.length - 1].m[zoneKey]);
    trendInfo = { slopePerWeek: slopePerDay * 7, next2w: lastVal + slopePerDay * 14, next4w: lastVal + slopePerDay * 28 };
  }

  const segKey = SEGMENT_MAP[zoneKey];
  const segDataKeys = segKey ? SEG_DATA_KEYS[segKey] : null;

  // Sparkline SVG
  const vals = history.map(({ m }) => Number(m[zoneKey]));
  const sparkMin = Math.min(...vals), sparkMax = Math.max(...vals), sparkRange = sparkMax - sparkMin || 1;
  const SW = 240, SH = 44;
  const pts2 = vals.map((v, i) => [i / Math.max(vals.length - 1, 1) * (SW - 16) + 8, SH - 8 - (v - sparkMin) / sparkRange * (SH - 16)] as [number, number]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="zone-panel-overlay" onClick={onClose}>
      <div className="zone-panel" style={{ '--zone-color': zone.color } as React.CSSProperties} onClick={e => e.stopPropagation()}>
        <div className="zone-panel-header">
          <span style={{ fontWeight: 700, fontSize: 16, color: zone.color }}>{zone.label}</span>
          <button className="zone-panel-close" onClick={onClose}>×</button>
        </div>

        <div className="zone-panel-history">
          {history.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Нет замеров для этой зоны</div>}
          {history.map(({ m, prev: p }, hi) => {
            const val = Number(m[zoneKey]);
            const diffPrev = p && p[zoneKey] != null ? val - Number(p[zoneKey]) : null;
            const firstVal = hi > 0 && history[0].m[zoneKey] != null ? Number(history[0].m[zoneKey]) : null;
            const diffStart = firstVal != null && hi > 0 ? val - firstVal : null;
            return (
              <div key={m.id} className="zone-panel-row">
                <span className="zone-row-date">№{m.measure_no} · {fmtDate(m.measured_at)}</span>
                <span className="zone-row-val">{val.toFixed(1)} <span style={{ fontSize: 10, fontWeight: 400 }}>см</span></span>
                {diffPrev !== null && <span className="zone-row-diff" style={{ color: diffColor(diffPrev) }}>{fmtDiff(diffPrev)}</span>}
                {diffStart !== null && <span className="zone-row-diff" style={{ color: diffColor(diffStart), opacity: 0.7 }}>{fmtDiff(diffStart)}</span>}
              </div>
            );
          })}
        </div>

        {vals.length >= 2 && (
          <svg width="100%" viewBox={`0 0 ${SW} ${SH}`} style={{ display: 'block', marginTop: 8 }}>
            <polyline points={pts2.map(p => p.join(',')).join(' ')} fill="none" stroke={zone.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {pts2.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={zone.color} />)}
          </svg>
        )}

        {trendInfo && (
          <div style={{ fontSize: 12, color: '#374151', marginTop: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 8 }}>
            <span style={{ fontWeight: 600 }}>Тренд: </span>
            {trendInfo.slopePerWeek < 0 ? '↓ ' : '↑ '}{Math.abs(trendInfo.slopePerWeek).toFixed(2)} см/нед ·{' '}
            через 2 нед: <b>{trendInfo.next2w.toFixed(1)}</b> · через 4 нед: <b>{trendInfo.next4w.toFixed(1)}</b>
          </div>
        )}

        {latestIBData && segKey && segDataKeys && (
          <div style={{ fontSize: 12, color: '#374151', marginTop: 8, padding: '6px 10px', background: 'rgba(2,189,182,.06)', borderRadius: 8, border: '1px solid rgba(2,189,182,.2)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>InBody · {SEG_LABELS[segKey]}</div>
            {latestIBData[segDataKeys.ffm] != null && (
              <div>Безжир.: <b>{Number(latestIBData[segDataKeys.ffm]).toFixed(2)} кг</b>
                {latestIBData[segDataKeys.ffmPct] != null && <span style={{ color: '#9ca3af', marginLeft: 4 }}>({Number(latestIBData[segDataKeys.ffmPct]).toFixed(1)}%)</span>}
              </div>
            )}
            {latestIBData[segDataKeys.bfm] != null && (
              <div>Жировая: <b>{Number(latestIBData[segDataKeys.bfm]).toFixed(2)} кг</b>
                {latestIBData[segDataKeys.bfmPct] != null && <span style={{ color: '#9ca3af', marginLeft: 4 }}>({Number(latestIBData[segDataKeys.bfmPct]).toFixed(1)}%)</span>}
              </div>
            )}
            {segKey === 'trunk' && (
              <>
                {latestIBData['vfl'] != null && <div>Висц. жир: <b>{Number(latestIBData['vfl']).toFixed(0)}</b></div>}
                {latestIBData['whr'] != null && <div>WHR: <b>{Number(latestIBData['whr']).toFixed(2)}</b></div>}
                {latestIBData['abdomen_circumference'] != null && <div>Окр. живота: <b>{Number(latestIBData['abdomen_circumference']).toFixed(1)} см</b></div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Unlink button ─────────────────────────────────────────────────────────────

function UnlinkBtn({ testId, onDone }: { testId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function unlink() {
    setLoading(true);
    try {
      await fetch(`/kviz/api/inbody/tests/${testId}/unlink`, { method: 'POST', credentials: 'include' });
      onDone();
    } finally { setLoading(false); setConfirm(false); }
  }
  if (!confirm) return <button onClick={() => setConfirm(true)} style={{ fontSize: 10, padding: '1px 6px', background: 'none', border: '1px solid #e2e6ea', borderRadius: 4, cursor: 'pointer', color: '#9ca3af', fontFamily: 'inherit' }}>Отвязать</button>;
  return (
    <span>
      <button onClick={unlink} disabled={loading} style={{ fontSize: 10, padding: '1px 6px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', color: '#ef4444', fontFamily: 'inherit' }}>{loading ? '…' : 'Да'}</button>
      <button onClick={() => setConfirm(false)} style={{ fontSize: 10, marginLeft: 2, padding: '1px 4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>✕</button>
    </span>
  );
}

// ── Link InBody dialog ─────────────────────────────────────────────────────────

interface UnlinkedTest {
  id: string; inbody_id: string; tested_at: string;
  gender: string | null; age: number | null; height: number | null;
  weight: number | null; bfm: number | null; smm: number | null;
  inbody_score: number | null; source: string;
}

function LinkInBodyDialog({ clientId, clientPhone, onLinked, onClose }: {
  clientId: string; clientPhone: string | null; onLinked: () => void; onClose: () => void;
}) {
  const [tests, setTests] = useState<UnlinkedTest[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/kviz/api/inbody/unlinked-tests', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTests(Array.isArray(d) ? d : []))
      .catch(() => setErr('Не удалось загрузить список'))
      .finally(() => setLoading(false));
  }, []);

  const shown = tests.filter(t => {
    if (!q) return true;
    const ql = q.toLowerCase();
    return t.inbody_id.toLowerCase().includes(ql) || t.tested_at.slice(0, 10).includes(ql);
  });

  function toggle(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  async function link() {
    if (!selected.size) return;
    setSaving(true); setErr('');
    try {
      const r = await fetch('/kviz/api/inbody/link-to-client', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, test_ids: [...selected] }),
      });
      const json = await r.json();
      if (!r.ok) { setErr(json.error || 'Ошибка'); return; }
      onLinked();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  if (!clientPhone) return (
    <div style={overlayS} onClick={onClose}>
      <div style={modalS} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Привязать InBody</div>
        <div style={{ color: '#f59e0b', fontSize: 13 }}>У клиента нет номера телефона — привязка невозможна</div>
        <button onClick={onClose} style={{ ...fbBtnSt, marginTop: 14, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea' }}>Закрыть</button>
      </div>
    </div>
  );

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={{ ...modalS, width: 'min(640px,96vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Привязать InBody к клиенту</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Телефон клиента: <b>{clientPhone}</b></div>
        <input style={{ ...inputS, marginBottom: 10 }} placeholder="Поиск по ID или дате (YYYY-MM-DD)…" value={q} onChange={e => setQ(e.target.value)} />
        {err && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        {loading && <div style={{ color: '#9ca3af', fontSize: 13 }}>Загрузка…</div>}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!loading && shown.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>Нет непривязанных тестов</div>}
          {shown.map(t => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8,
              background: selected.has(t.id) ? 'rgba(2,189,182,.08)' : '#f8fafc',
              border: `1px solid ${selected.has(t.id) ? '#02BDB6' : '#e2e6ea'}`,
              marginBottom: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{fmtDate(t.tested_at)} <span style={{ color: '#9ca3af', fontWeight: 400 }}>ID: {t.inbody_id}</span></div>
                <div style={{ color: '#6b7280' }}>
                  {t.weight != null && `Вес: ${t.weight.toFixed(1)} кг`}
                  {t.bfm != null && ` · Жир: ${t.bfm.toFixed(1)} кг`}
                  {t.smm != null && ` · Мышцы: ${t.smm.toFixed(1)} кг`}
                  {t.age != null && ` · ${t.age} лет`}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ ...fbBtnSt, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea' }}>Отмена</button>
          <button onClick={link} disabled={saving || !selected.size}
            style={{ flex: 1, padding: '7px 18px', background: selected.size ? '#02BDB6' : '#e2e6ea', color: selected.size ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: selected.size ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {saving ? 'Привязка…' : `Привязать${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── InBody block ─────────────────────────────────────────────────────────────

interface IBMetric {
  key: keyof InBodyTest;
  label: string;
  unit: string;
  normMin?: string; // key in data for norm min
  normMax?: string; // key in data for norm max
  norms?: [number, number]; // static norms fallback
  goodDir?: 'low' | 'high';
  decimals?: number;
}

const IB_METRICS: IBMetric[] = [
  { key: 'inbody_score', label: 'Оценка',    unit: '',   norms: [70, 90], goodDir: 'high', decimals: 0 },
  { key: 'weight',       label: 'Вес',       unit: 'кг', normMin: 'weight_min', normMax: 'weight_max' },
  { key: 'pbf',          label: 'Жир %',     unit: '%',  normMin: 'pbf_min',    normMax: 'pbf_max',  goodDir: 'low' },
  { key: 'bfm',          label: 'Жир кг',    unit: 'кг', normMin: 'bfm_min',    normMax: 'bfm_max',  goodDir: 'low' },
  { key: 'smm',          label: 'Мышцы',     unit: 'кг', normMin: 'smm_min',    normMax: 'smm_max',  goodDir: 'high' },
  { key: 'vfl',          label: 'Висц. жир', unit: '',   norms: [1, 9],         goodDir: 'low', decimals: 0 },
  { key: 'bmi',          label: 'ИМТ',       unit: '',   normMin: 'bmi_min',    normMax: 'bmi_max' },
];

function resolveNorm(m: IBMetric, data: Record<string, unknown> | null): [number, number] | null {
  if (m.normMin && m.normMax && data) {
    const lo = data[m.normMin], hi = data[m.normMax];
    if (typeof lo === 'number' && typeof hi === 'number' && hi > lo) return [lo, hi];
  }
  return m.norms ?? null;
}

function ibColor(val: number, norms: [number, number] | null, goodDir?: 'low' | 'high'): string {
  if (!norms) return '#374151';
  const [lo, hi] = norms;
  if (val >= lo && val <= hi) return '#16a34a';
  if (goodDir === 'low' && val > hi) return '#ef4444';
  if (goodDir === 'high' && val < lo) return '#ef4444';
  return '#f59e0b';
}

type IBChartKey = 'weight' | 'smm' | 'bfm' | 'pbf' | 'tbw' | 'inbody_score';
const IB_CHART_LINES: { key: IBChartKey; label: string; color: string; dashed?: boolean; dataKey?: string }[] = [
  { key: 'weight',       label: 'Вес кг',      color: '#263CD9', dashed: true },
  { key: 'smm',          label: 'Мышцы кг',    color: '#02BDB6' },
  { key: 'bfm',          label: 'Жир кг',      color: '#ef4444' },
  { key: 'pbf',          label: '% жира',      color: '#f97316' },
  { key: 'tbw',          label: 'Вода л',      color: '#06b6d4', dataKey: 'tbw' },
  { key: 'inbody_score', label: 'Оценка',      color: '#8b5cf6' },
];

// ── InBody Full Sheet popup ────────────────────────────────────────────────────

function ibBarPct(val: number, lo: number, hi: number): number {
  // Normalize val to % position on bar: lo=25%, hi=75%
  const span = hi - lo;
  if (span <= 0) return 50;
  const extra = span * 0.5; // 50% padding on each side
  const total = span + 2 * extra;
  return Math.max(2, Math.min(98, ((val - (lo - extra)) / total) * 100));
}

function NormBar({ val, lo, hi, goodDir, unit = '' }: { val: number | null; lo: number | null; hi: number | null; goodDir?: 'low' | 'high'; unit?: string }) {
  if (val == null || lo == null || hi == null) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  const pct = ibBarPct(val, lo, hi);
  const color = ibColor(val, [lo, hi], goodDir);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, position: 'relative', overflow: 'visible' }}>
        <div style={{ position: 'absolute', left: '25%', right: '25%', height: '100%', background: '#dcfce7', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: -2, width: 12, height: 12, background: color, borderRadius: '50%', transform: 'translateX(-50%)', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 40, textAlign: 'right' }}>{val.toFixed(1)}{unit}</span>
    </div>
  );
}

function InBodyFullSheet({ tests, firstTest, onClose }: { tests: InBodyTest[]; firstTest: InBodyTest | null; onClose: () => void }) {
  const [selIdx, setSelIdx] = useState(tests.length - 1);
  const [compare, setCompare] = useState(false);
  const t = tests[selIdx] ?? tests[tests.length - 1];
  const d = t?.data as Record<string, unknown> | null ?? null;
  const f = firstTest?.data as Record<string, unknown> | null ?? null;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  if (!t) return null;

  function n(key: string): number | null {
    const v = d?.[key];
    return typeof v === 'number' ? v : null;
  }
  function fn(key: string): number | null {
    const v = f?.[key];
    return typeof v === 'number' ? v : null;
  }
  function diff(a: number | null, b: number | null): string {
    if (a == null || b == null) return '';
    const d = b - a;
    return (d >= 0 ? '+' : '') + d.toFixed(1);
  }
  function diffColor2(a: number | null, b: number | null, goodDir?: 'low' | 'high'): string {
    if (a == null || b == null) return '#9ca3af';
    const d = b - a;
    if (d === 0) return '#9ca3af';
    if (goodDir === 'low') return d > 0 ? '#ef4444' : '#16a34a';
    if (goodDir === 'high') return d > 0 ? '#16a34a' : '#ef4444';
    return '#374151';
  }

  const score = t.inbody_score;
  const scoreColor = score != null ? ibColor(score, [70, 90], 'high') : '#9ca3af';

  function Row({ label, val, unit = '', normMin, normMax, goodDir, fKey }: {
    label: string; val: number | null; unit?: string;
    normMin?: string; normMax?: string; goodDir?: 'low' | 'high'; fKey?: string;
  }) {
    const lo = normMin ? n(normMin) : null;
    const hi = normMax ? n(normMax) : null;
    const fVal = fKey ? fn(fKey) : null;
    return (
      <tr>
        <td style={{ padding: '4px 8px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{label}</td>
        <td style={{ padding: '4px 8px', fontSize: 13, fontWeight: 700, color: val != null && lo != null && hi != null ? ibColor(val, [lo, hi], goodDir) : '#374151' }}>
          {val != null ? val.toFixed(1) + unit : '—'}
        </td>
        <td style={{ padding: '4px 8px', fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          {lo != null && hi != null ? `${lo.toFixed(1)}–${hi.toFixed(1)}` : ''}
        </td>
        {compare && <td style={{ padding: '4px 8px', fontSize: 12, fontWeight: 600, color: diffColor2(fVal, val, goodDir) }}>
          {diff(fVal, val)}
        </td>}
      </tr>
    );
  }

  function SegRow({ label, ffm, bfm }: { label: string; ffm: string; bfm: string }) {
    const ffmV = n(ffm), bfmV = n(bfm);
    const ffmF = fn(ffm), bfmF = fn(bfm);
    return (
      <tr>
        <td style={{ padding: '3px 6px', fontSize: 11, color: '#6b7280' }}>{label}</td>
        <td style={{ padding: '3px 6px', fontSize: 12, fontWeight: 600, color: '#02BDB6' }}>
          {ffmV != null ? ffmV.toFixed(2) : '—'}{compare && ffmF != null && ffmV != null ? <span style={{ fontSize: 10, color: diffColor2(ffmF, ffmV, 'high'), marginLeft: 3 }}>{diff(ffmF, ffmV)}</span> : null}
        </td>
        <td style={{ padding: '3px 6px', fontSize: 12, fontWeight: 600, color: '#f97316' }}>
          {bfmV != null ? bfmV.toFixed(2) : '—'}{compare && bfmF != null && bfmV != null ? <span style={{ fontSize: 10, color: diffColor2(bfmF, bfmV, 'low'), marginLeft: 3 }}>{diff(bfmF, bfmV)}</span> : null}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(860px,96vw)', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #e2e6ea', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor, minWidth: 56 }}>
            {score != null ? score.toFixed(0) : '—'}<span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', marginLeft: 2 }}>pts</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Полный лист InBody</div>
            <select value={selIdx} onChange={e => setSelIdx(Number(e.target.value))}
              style={{ fontSize: 12, border: '1px solid #e2e6ea', borderRadius: 6, padding: '2px 6px', fontFamily: 'inherit', marginTop: 2 }}>
              {tests.map((t, i) => <option key={t.id} value={i}>{fmtDate(t.tested_at)} ({t.source})</option>)}
            </select>
          </div>
          {firstTest && firstTest.id !== t.id && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
              Сравнить с первым
            </label>
          )}
          <button onClick={onClose} style={{ fontSize: 22, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Left column */}
          <div>
            {/* Body composition */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Состав тела</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ padding: '3px 8px', fontSize: 11, color: '#9ca3af', textAlign: 'left', fontWeight: 400 }}>Показатель</th><th style={{ textAlign: 'left', padding: '3px 8px', fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>Значение</th><th style={{ textAlign: 'left', padding: '3px 8px', fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>Норма</th>{compare && <th style={{ padding: '3px 8px', fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>Δ</th>}</tr></thead>
                <tbody>
                  <Row label="Вода (л)" val={n('tbw')} normMin="tbw_min" normMax="tbw_max" fKey="tbw" goodDir="high" />
                  <Row label="Белок (кг)" val={n('protein')} normMin="protein_min" normMax="protein_max" fKey="protein" goodDir="high" />
                  <Row label="Минералы (кг)" val={n('minerals')} normMin="minerals_min" normMax="minerals_max" fKey="minerals" goodDir="high" />
                  <Row label="Жир (кг)" val={n('bfm')} normMin="bfm_min" normMax="bfm_max" fKey="bfm" goodDir="low" />
                  <Row label="Вес (кг)" val={n('weight')} normMin="weight_min" normMax="weight_max" fKey="weight" />
                </tbody>
              </table>
            </div>

            {/* Muscle–fat analysis */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Мышцы–жир</div>
              {([
                { label: 'Вес (кг)', val: n('weight'), lo: n('weight_min'), hi: n('weight_max'), fKey: 'weight' },
                { label: 'Мышцы кг', val: n('smm'), lo: n('smm_min'), hi: n('smm_max'), goodDir: 'high' as const, fKey: 'smm' },
                { label: 'Жир кг', val: n('bfm'), lo: n('bfm_min'), hi: n('bfm_max'), goodDir: 'low' as const, fKey: 'bfm' },
              ]).map(({ label, val, lo, hi, goodDir, fKey }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#6b7280' }}>{label}</span>
                    {compare && fn(fKey) != null && val != null && <span style={{ fontSize: 11, color: diffColor2(fn(fKey), val, goodDir) }}>{diff(fn(fKey), val)}</span>}
                  </div>
                  <NormBar val={val} lo={lo} hi={hi} goodDir={goodDir} />
                </div>
              ))}
            </div>

            {/* Obesity */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Ожирение</div>
              {([
                { label: 'ИМТ', val: n('bmi'), lo: n('bmi_min'), hi: n('bmi_max'), fKey: 'bmi' },
                { label: '% жира', val: n('pbf'), lo: n('pbf_min'), hi: n('pbf_max'), goodDir: 'low' as const, fKey: 'pbf' },
              ]).map(({ label, val, lo, hi, goodDir, fKey }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: '#6b7280' }}>{label}</span>
                    {compare && fn(fKey) != null && val != null && <span style={{ fontSize: 11, color: diffColor2(fn(fKey), val, goodDir) }}>{diff(fn(fKey), val)}</span>}
                  </div>
                  <NormBar val={val} lo={lo} hi={hi} goodDir={goodDir} />
                </div>
              ))}
            </div>

            {/* Segments */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 6 }}>Сегменты (кг)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ padding: '3px 6px', fontSize: 11, color: '#9ca3af', textAlign: 'left', fontWeight: 400 }}>Зона</th>
                  <th style={{ padding: '3px 6px', fontSize: 11, color: '#02BDB6', textAlign: 'left', fontWeight: 600 }}>Безжир.</th>
                  <th style={{ padding: '3px 6px', fontSize: 11, color: '#f97316', textAlign: 'left', fontWeight: 600 }}>Жир</th>
                </tr></thead>
                <tbody>
                  <SegRow label="Правая рука" ffm="ffm_ra" bfm="bfm_ra" />
                  <SegRow label="Левая рука"  ffm="ffm_la" bfm="bfm_la" />
                  <SegRow label="Туловище"    ffm="ffm_tr" bfm="bfm_tr" />
                  <SegRow label="Правая нога" ffm="ffm_rl" bfm="bfm_rl" />
                  <SegRow label="Левая нога"  ffm="ffm_ll" bfm="bfm_ll" />
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column */}
          <div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Контроль и цели</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    { label: 'Идеальный вес', key: 'target_weight', unit: ' кг' },
                    { label: 'Контроль веса', key: 'weight_control', unit: ' кг' },
                    { label: 'Контроль жира', key: 'bfm_control', unit: ' кг' },
                    { label: 'Контроль мышц', key: 'ffm_control', unit: ' кг' },
                  ].map(({ label, key, unit }) => (
                    <tr key={key}>
                      <td style={{ padding: '3px 0', fontSize: 12, color: '#6b7280' }}>{label}</td>
                      <td style={{ padding: '3px 0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                        {n(key) != null ? n(key)!.toFixed(1) + unit : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Дополнительно</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    { label: 'Висц. жир (ед.)', key: 'vfl', unit: '' },
                    { label: 'Талия/бёдра (WHR)', key: 'whr', unit: '' },
                    { label: 'Окр. живота (см)', key: 'abdomen_circumference', unit: '' },
                    { label: 'Степень ожирения', key: 'obesity_degree', unit: '%' },
                    { label: 'ИСМ (SMI)', key: 'smi', unit: '' },
                    { label: 'Безжировая масса', key: 'ffm', unit: ' кг' },
                  ].map(({ label, key, unit }) => {
                    const val = key === 'ffm' ? t.ffm : n(key);
                    return (
                      <tr key={key}>
                        <td style={{ padding: '3px 0', fontSize: 12, color: '#6b7280' }}>{label}</td>
                        <td style={{ padding: '3px 0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                          {val != null ? val.toFixed(key === 'vfl' || key === 'smi' ? 0 : 2) + unit : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ background: 'rgba(2,189,182,.06)', border: '1px solid rgba(2,189,182,.2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>Обмен веществ</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Базальный метаболизм</td>
                    <td style={{ padding: '3px 0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                      {t.bmr != null ? `${t.bmr.toFixed(0)} ккал` : '—'}
                      {n('bmr_min') != null && n('bmr_max') != null && <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>({n('bmr_min')!.toFixed(0)}–{n('bmr_max')!.toFixed(0)})</span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Рекомендуемые ккал</td>
                    <td style={{ padding: '3px 0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                      {n('recommended_kcal') != null ? `${n('recommended_kcal')!.toFixed(0)} ккал` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InBodyBlock({ tests, onScan, onUnlink }: { tests: InBodyTest[]; onScan: () => void; onUnlink: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [ibLines, setIbLines] = useState<IBChartKey[]>(['weight', 'smm', 'bfm']);
  const [fullSheet, setFullSheet] = useState(false);

  if (tests.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>InBody</span>
          <button onClick={onScan} style={ibBtnSt}>+ Сканировать</button>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>Нет данных InBody</div>
      </div>
    );
  }

  const last = tests[tests.length - 1];
  const first = tests[0];

  // Chart
  const W = 560, H = 140, PL = 40, PR = 12, PT = 12, PB = 28;
  const iW = W - PL - PR, iH = H - PT - PB;

  function ibChartRange(key: IBChartKey) {
    const line = IB_CHART_LINES.find(l => l.key === key);
    let mn = Infinity, mx = -Infinity;
    for (const t of tests) {
      const v = line?.dataKey
        ? (t.data as Record<string,unknown> | null)?.[line.dataKey]
        : t[key as keyof InBodyTest];
      if (v != null) { mn = Math.min(mn, Number(v)); mx = Math.max(mx, Number(v)); }
    }
    if (mn === Infinity) return null;
    const rng = mx - mn || 1;
    return { mn: mn - rng * 0.1, mx: mx + rng * 0.1 };
  }

  function tx(i: number) { return PL + (i / Math.max(tests.length - 1, 1)) * iW; }
  function ty(v: number, mn: number, mx: number) { return PT + iH - ((v - mn) / (mx - mn)) * iH; }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#374151' }}>InBody · {tests.length} тест{tests.length > 1 ? 'ов' : ''}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setFullSheet(true)} style={{ ...ibBtnSt, background: 'rgba(2,189,182,.08)', color: '#02BDB6', border: '1px solid rgba(2,189,182,.3)' }}>Полный лист</button>
          <button onClick={onScan} style={ibBtnSt}>+ Сканировать</button>
        </div>
      </div>
      {fullSheet && <InBodyFullSheet tests={tests} firstTest={tests[0] ?? null} onClose={() => setFullSheet(false)} />}

      {/* Latest test metrics with norms and arrows */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
          Последний: {fmtDate(last.tested_at)} ({last.source === 'qr' ? 'QR' : 'CSV'})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px 12px' }}>
          {IB_METRICS.map(m => {
            const v = last[m.key];
            if (v == null) return null;
            const norm = resolveNorm(m, last.data);
            const col = ibColor(Number(v), norm, m.goodDir);
            const prev = tests.length > 1 ? tests[tests.length - 2][m.key] : null;
            let arrow = '';
            if (prev != null) {
              const d = Number(v) - Number(prev);
              if (Math.abs(d) > 0.05) arrow = d > 0 ? ' ↑' : ' ↓';
            }
            const decimals = m.decimals ?? 1;
            return (
              <div key={String(m.key)} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: col, lineHeight: 1.1 }}>
                  {Number(v).toFixed(decimals)}{m.unit}<span style={{ fontSize: 11, color: col }}>{arrow}</span>
                </div>
                {norm && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{norm[0].toFixed(1)}–{norm[1].toFixed(1)}</div>}
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart (2+ tests) */}
      {tests.length >= 2 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {IB_CHART_LINES.map(l => (
              <label key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer',
                padding: '2px 8px', borderRadius: 20, border: `1.5px solid ${ibLines.includes(l.key) ? l.color : '#e2e6ea'}`,
                background: ibLines.includes(l.key) ? l.color + '18' : '#f8fafc', color: ibLines.includes(l.key) ? '#1a202c' : '#9ca3af' }}>
                <input type="checkbox" style={{ display: 'none' }} checked={ibLines.includes(l.key)}
                  onChange={() => setIbLines(prev => prev.includes(l.key) ? prev.filter(k => k !== l.key) : [...prev, l.key])} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                {l.label}
              </label>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {[0, 0.5, 1].map((f, i) => <line key={i} x1={PL} x2={W - PR} y1={PT + iH * (1 - f)} y2={PT + iH * (1 - f)} stroke="#e2e6ea" strokeWidth={0.7} />)}
            {tests.map((t, i) => (
              <text key={i} x={tx(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">
                {fmtShortDate(t.tested_at)}
              </text>
            ))}
            {IB_CHART_LINES.filter(l => ibLines.includes(l.key)).map(l => {
              const range = ibChartRange(l.key);
              if (!range) return null;
              const pathParts = tests.map((t, i) => {
                const v = l.dataKey ? (t.data as Record<string,unknown> | null)?.[l.dataKey] : t[l.key as keyof InBodyTest];
                if (v == null) return null;
                return `${i === 0 ? 'M' : 'L'}${tx(i).toFixed(1)},${ty(Number(v), range.mn, range.mx).toFixed(1)}`;
              }).filter(Boolean).join(' ');
              return pathParts ? <path key={l.key} d={pathParts} fill="none" stroke={l.color} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" strokeDasharray={l.dashed ? '5 3' : undefined} /> : null;
            })}
            {IB_CHART_LINES.filter(l => ibLines.includes(l.key)).map(l => {
              const range = ibChartRange(l.key);
              if (!range) return null;
              return tests.map((t, i) => {
                const v = l.dataKey ? (t.data as Record<string,unknown> | null)?.[l.dataKey] : t[l.key as keyof InBodyTest];
                if (v == null) return null;
                const isLast = i === tests.length - 1;
                return (
                  <g key={`${l.key}-${i}`}>
                    <circle cx={tx(i)} cy={ty(Number(v), range.mn, range.mx)} r={isLast ? 4 : 2.5} fill={l.color} stroke="#fff" strokeWidth={1} />
                    {isLast && (
                      <text x={tx(i)} y={ty(Number(v), range.mn, range.mx) - 6} textAnchor="middle" fontSize={8} fontWeight="700" fill={l.color}>
                        {Number(v).toFixed(1)}
                      </text>
                    )}
                  </g>
                );
              });
            })}
            {(() => {
              const firstKey = IB_CHART_LINES.find(l => ibLines.includes(l.key))?.key;
              if (!firstKey) return null;
              const range = ibChartRange(firstKey);
              if (!range) return null;
              return [0, 0.5, 1].map((f, i) => {
                const v = range.mn + f * (range.mx - range.mn);
                return <text key={i} x={PL - 3} y={PT + iH * (1 - f) + 3} textAnchor="end" fontSize={8} fill="#9ca3af">{v.toFixed(1)}</text>;
              });
            })()}
          </svg>
        </div>
      )}

      {/* Expand/collapse table */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', padding: '8px 16px', background: '#f8fafc', border: 'none', borderTop: '1px solid #f1f5f9',
          cursor: 'pointer', fontSize: 12, color: '#6b7280', textAlign: 'left', fontFamily: 'inherit' }}>
        {expanded ? '▲ Скрыть таблицу' : `▼ Все тесты (${tests.length})`}
      </button>
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table className="measure-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Дата</th><th>Ист.</th><th>Вес</th><th>Жир кг</th><th>% жира</th>
                <th>Мышцы</th><th>ИМТ</th><th>Висц.</th><th>Оценка</th><th></th>
              </tr>
            </thead>
            <tbody>
              {[...tests].reverse().map(t => {
                const diff = first.bfm != null && t.bfm != null ? t.bfm - first.bfm : null;
                return (
                  <tr key={t.id}>
                    <td>{fmtDate(t.tested_at)}</td>
                    <td style={{ color: '#9ca3af' }}>{t.source}</td>
                    <td>{t.weight?.toFixed(1) ?? '—'}</td>
                    <td>{t.bfm != null ? <span style={{ color: diff != null ? diffColor(diff) : '#374151' }}>{t.bfm.toFixed(1)}</span> : '—'}</td>
                    <td>{t.pbf?.toFixed(1) ?? '—'}</td>
                    <td>{t.smm?.toFixed(1) ?? '—'}</td>
                    <td>{t.bmi?.toFixed(1) ?? '—'}</td>
                    <td>{t.vfl?.toFixed(0) ?? '—'}</td>
                    <td style={{ fontWeight: 600, color: t.inbody_score != null ? ibColor(t.inbody_score, [70, 90], 'high') : '#9ca3af' }}>
                      {t.inbody_score?.toFixed(0) ?? '—'}
                    </td>
                    <td>
                      <UnlinkBtn testId={t.id} onDone={onUnlink} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ClientPage ────────────────────────────────────────────────────────────

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [studioResult, setStudioResult] = useState<StudioResult | null>(null);
  const [inbodyTests, setInbodyTests] = useState<InBodyTest[]>([]);
  const [sendingResult, setSendingResult] = useState(false);
  const [resultError, setResultError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMId, setSelectedMId] = useState<string>('');
  const [zones, setZones] = useState<string[]>(() => {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : DEFAULT_ZONES; } catch { return DEFAULT_ZONES; }
  });
  const [cmpFrom, setCmpFrom] = useState('');
  const [cmpTo, setCmpTo] = useState('');
  const [loadError, setLoadError] = useState('');
  const [printDialog, setPrintDialog] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [inbodyDialog, setInbodyDialog] = useState(false);
  const [shareLinkDialog, setShareLinkDialog] = useState(false);
  const [linkInBodyDialog, setLinkInBodyDialog] = useState(false);
  const [zoneDetailKey, setZoneDetailKey] = useState<CircKey | null>(null);
  const [fbOverrides, setFbOverrides] = useState<Record<string, string>>({}); // mId → fitbase_comment_at

  const reload = useCallback(async () => {
    if (!id) return;
    const [d, result, ibs] = await Promise.all([
      apiGet(`/api/measure/clients/${id}`),
      apiGet(`/api/measure/clients/${id}/results`).then((r: any) => r?.error ? null : r).catch(() => null),
      apiGet(`/api/inbody/clients/${id}`).then((r: unknown) => Array.isArray(r) ? r : []).catch(() => []),
    ]);
    if (!d || !Array.isArray(d.measurements)) throw new Error('Не удалось загрузить данные клиента');
    setClient(d as Client);
    setStudioResult(result as StudioResult | null);
    setInbodyTests((ibs as InBodyTest[]) || []);
    setSelectedMId(prev => prev || ((d as Client).measurements.at(-1)?.id ?? ''));
  }, [id]);

  useEffect(() => {
    reload().catch(e => setLoadError(String(e))).finally(() => setLoading(false));
  }, [reload]);

  function saveZones(z: string[]) {
    setZones(z);
    try { localStorage.setItem(LS_KEY, JSON.stringify(z)); } catch {}
  }

  function openZoneDetail(key: CircKey) { setZoneDetailKey(key); }

  if (loading) return <MeasureLayout active="reports"><div style={{ padding: 32, color: '#9ca3af' }}>Загрузка…</div></MeasureLayout>;
  if (loadError) return <MeasureLayout active="reports"><div style={{ padding: 32, color: '#ef4444', fontSize: 14 }}>{loadError}</div></MeasureLayout>;
  if (!client) return <MeasureLayout active="reports"><div style={{ padding: 32 }}>Клиент не найден</div></MeasureLayout>;

  const ms = client.measurements;
  const first = ms[0], last = ms[ms.length - 1];
  const cmLost = first && last ? Math.max(0, Number(first.total_cm) - Number(last.total_cm)) : 0;
  const kgLost = first?.weight != null && last?.weight != null ? Math.max(0, Number(first.weight) - Number(last.weight)) : 0;
  const canSendResult = cmLost > 0 || kgLost > 0;
  const firstMAt = ms[0]?.measured_at;
  const firstIBAfterStart = firstMAt ? (inbodyTests.find(t => t.tested_at >= firstMAt) ?? inbodyTests[0]) : inbodyTests[0];
  const firstIBFat = firstIBAfterStart?.bfm ?? null;
  const lastIBFat  = inbodyTests[inbodyTests.length - 1]?.bfm ?? null;
  const fatKgLost  = firstIBFat != null && lastIBFat != null ? Math.max(0, firstIBFat - lastIBFat) : null;
  const latestIBData = inbodyTests.length > 0 ? (inbodyTests[inbodyTests.length - 1].data ?? null) : null;
  const selectedM = ms.find(m => m.id === selectedMId) ?? last ?? null;
  const selectedIdx = ms.findIndex(m => m.id === selectedMId);
  const prevM = selectedIdx > 0 ? ms[selectedIdx - 1] : null;

  const mergedM = selectedM ? {
    ...selectedM,
    fitbase_comment_at: fbOverrides[selectedM.id] ?? selectedM.fitbase_comment_at,
  } : null;

  const mergedClient = { ...client, fitbase_client_id: client.fitbase_client_id };

  function onFbDone(mId: string, at: string) {
    setFbOverrides(prev => ({ ...prev, [mId]: at }));
  }

  async function sendStudioResult() {
    setSendingResult(true); setResultError('');
    try {
      const result = await apiPost(`/api/measure/clients/${client.id}/results`, { fat_kg_lost: fatKgLost });
      if (result.error) throw new Error(result.error);
      setStudioResult(result);
    }
    catch (e) { setResultError(String(e).replace(/^Error:\s*/, '')); }
    finally { setSendingResult(false); }
  }

  return (
    <MeasureLayout active="reports">
      {printDialog && ms.length > 0 && (
        <PrintDialog ms={ms} clientId={client.id} onClose={() => setPrintDialog(false)} />
      )}
      {linkDialog && (
        <LinkDialog clientId={client.id} onClose={() => setLinkDialog(false)}
          onLinked={fbId => { setLinkDialog(false); setClient(c => c ? { ...c, fitbase_client_id: fbId } : c); }} />
      )}
      {inbodyDialog && (
        <InBodyDialog clientId={client.id} onClose={() => setInbodyDialog(false)}
          onDone={() => { setInbodyDialog(false); reload(); }} />
      )}
      {shareLinkDialog && (
        <ShareLinkDialog clientId={client.id} onClose={() => setShareLinkDialog(false)} />
      )}
      {zoneDetailKey && (
        <ZoneDetailPanel zoneKey={zoneDetailKey} ms={ms} latestIBData={latestIBData} onClose={() => setZoneDetailKey(null)} />
      )}
      {linkInBodyDialog && (
        <LinkInBodyDialog clientId={client.id} clientPhone={client.phone} onLinked={() => { setLinkInBodyDialog(false); reload(); }} onClose={() => setLinkInBodyDialog(false)} />
      )}

      <div className="measure-client-content">
        {/* Header */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => navigate('/measure/reports')}>← Отчёты</button>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 17 }}>{client.name}</div>
          {ms.length > 0 && (
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
              onClick={() => setPrintDialog(true)}>🖨 Бланк</button>
          )}
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => setInbodyDialog(true)}>InBody</button>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => setLinkInBodyDialog(true)}>🔗 InBody</button>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => setShareLinkDialog(true)}>🔗 Ссылка</button>
          <button className="btn btn-primary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => navigate('/measure/new')}>+ Замер</button>
        </div>

        {/* Client info */}
        <div style={{ background: 'rgba(2,189,182,0.06)', border: '1px solid rgba(2,189,182,0.3)', borderRadius: 12, padding: '10px 16px', marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {client.phone && <span style={{ fontSize: 13, color: '#6b7280' }}>{fmtPhone(client.phone)}</span>}
          <span style={{ fontSize: 13, color: '#6b7280' }}>ID: {shortId(client.id)}</span>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Замеров: {ms.length}</span>
          {first && <span style={{ fontSize: 13, color: '#6b7280' }}>Старт: {fmtDate(first.measured_at)}</span>}
          {first && last && ms.length > 1 && (
            <span style={{ fontSize: 13, fontWeight: 700, color: diffColor(Number(last.total_cm) - Number(first.total_cm)) }}>
              Δ∑ {fmtDiff(Number(last.total_cm) - Number(first.total_cm))} см
            </span>
          )}
          {!client.fitbase_client_id && (
            <button onClick={() => setLinkDialog(true)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: '1px solid #e2e6ea', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>
              Связать с Fitbase
            </button>
          )}
          {client.fitbase_client_id && <span style={{ fontSize: 12, color: '#22c55e' }}>Fitbase #{client.fitbase_client_id}</span>}
        </div>

        {/* Measurement chips */}
        {ms.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {ms.map(m => {
              const active = m.id === selectedMId;
              return (
                <button key={m.id} onClick={() => setSelectedMId(m.id)}
                  style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? '#02BDB6' : '#f1f5f9', color: active ? '#fff' : '#374151',
                    border: `1.5px solid ${active ? '#02BDB6' : '#e2e6ea'}` }}>
                  №{m.measure_no} · {fmtDate(m.measured_at)}
                </button>
              );
            })}
          </div>
        )}

        <div className="measure-client-grid">
          <aside className="measure-figure-column">
            <ErrorBlock label="Фигура"><BodyFigure m={mergedM} prev={prevM} activeZones={zones} activeZone={zoneDetailKey} onZoneClick={openZoneDetail} /></ErrorBlock>
          </aside>
          <section>
            <div className="measure-lost-card">
              <div style={{ fontWeight: 700, color: '#263CD9', fontSize: 16 }}>Потеряно со старта</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{first && last ? `С замера №${first.measure_no} по №${last.measure_no}` : 'Появится после первого замера'}</div>
              <div className="measure-lost-values">
                <div className="measure-lost-value"><strong>{cmLost.toFixed(1)}</strong><span>сантиметров</span></div>
                <div className="measure-lost-value"><strong>{kgLost.toFixed(1)}</strong><span>килограммов</span></div>
                <div className="measure-lost-value"><strong>{fatKgLost != null ? fatKgLost.toFixed(1) : (studioResult?.fat_kg_lost?.toFixed(1) ?? '—')}</strong><span>жира, кг{fatKgLost == null ? ' · добавьте InBody' : ''}</span></div>
              </div>
              <button disabled={!canSendResult || sendingResult} title={!canSendResult ? 'Потерь со старта пока нет' : undefined} onClick={sendStudioResult}>
                {sendingResult ? 'Отправка…' : studioResult ? 'Обновить результат студии' : 'Отправить в результаты студии'}
              </button>
              {!canSendResult && <span style={{ marginLeft: 10, fontSize: 12, color: '#64748b' }}>Кнопка станет доступна при снижении суммы обхватов или веса</span>}
              {resultError && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{resultError}</div>}
              {studioResult && <div style={{ color: '#047857', fontSize: 12, marginTop: 8 }}>
                В результатах студии: {Number(studioResult.cm_lost).toFixed(0)} см, {Number(studioResult.kg_lost).toFixed(1)} кг ({new Date(studioResult.sent_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, {studioResult.sent_by})
              </div>}
            </div>
            <ErrorBlock label="InBody"><InBodyBlock tests={inbodyTests} onScan={() => setInbodyDialog(true)} onUnlink={() => reload()} /></ErrorBlock>
            {mergedM && <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#374151' }}>Замер №{mergedM.measure_no} · {fmtDate(mergedM.measured_at)}</div>
              <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 10px' }}>{mergedM.consultant}{mergedM.note && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>{mergedM.note}</span>}</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8, fontSize: 13 }}>
                {mergedM.weight != null && <span>Вес: <b>{Number(mergedM.weight).toFixed(1)} кг</b>{prevM?.weight != null && <span style={{ color: diffColor(Number(mergedM.weight) - Number(prevM.weight)), marginLeft: 5 }}>{fmtDiff(Number(mergedM.weight) - Number(prevM.weight))}</span>}</span>}
                <span>∑ обхватов: <b style={{ color: '#02BDB6' }}>{Number(mergedM.total_cm).toFixed(1)} см</b>{prevM && <span style={{ color: diffColor(Number(mergedM.total_cm) - Number(prevM.total_cm)), marginLeft: 5 }}>{fmtDiff(Number(mergedM.total_cm) - Number(prevM.total_cm))}</span>}</span>
              </div>
              <FitbaseBtn m={{ ...mergedM, fitbase_comment_at: fbOverrides[mergedM.id] ?? mergedM.fitbase_comment_at }} client={mergedClient} onDone={onFbDone} />
            </div>}

        {/* Zone checkboxes + chart */}
        {ms.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #e2e6ea' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 }}>График динамики</div>
            <ZoneCheckboxes zones={zones} onChange={saveZones} />
            <MultiLineChart ms={ms} zones={zones} selectedId={selectedMId} onSelect={id => setSelectedMId(id)} />
          </div>
        )}

        {/* Comparison */}
        {ms.length >= 2 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 20, border: '1px solid #e2e6ea' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 12 }}>Сравнение замеров</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <select value={cmpFrom} onChange={e => setCmpFrom(e.target.value)} style={{ padding: '7px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }}>
                <option value="">С замера…</option>
                {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
              </select>
              <select value={cmpTo} onChange={e => setCmpTo(e.target.value)} style={{ padding: '7px 12px', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 14 }}>
                <option value="">По замер…</option>
                {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
              </select>
            </div>
            {(() => {
              const fromM = ms.find(m => m.id === cmpFrom);
              const toM   = ms.find(m => m.id === cmpTo);
              if (!fromM || !toM || fromM === toM) return null;
              return (
                <div style={{ overflowX: 'auto' }}>
                  <table className="measure-table">
                    <thead><tr><th>Точка</th><th>№{fromM.measure_no}</th><th>№{toM.measure_no}</th><th>Разница</th></tr></thead>
                    <tbody>
                      {[{key:'weight',label:'Вес (кг)'}, ...CIRC_KEYS.map(k => ({ key: k, label: ALL_ZONES.find(z => z.key === k)?.label ?? k }))].map(({ key, label }) => {
                        const a = fromM[key] != null ? Number(fromM[key]) : null;
                        const b = toM[key]   != null ? Number(toM[key])   : null;
                        const d = a != null && b != null ? b - a : null;
                        return (
                          <tr key={key}>
                            <td>{label}</td>
                            <td>{a?.toFixed(1) ?? '—'}</td>
                            <td>{b?.toFixed(1) ?? '—'}</td>
                            <td style={{ fontWeight: 600, color: d != null ? diffColor(d) : '#9ca3af' }}>{d != null ? fmtDiff(d) : '—'}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ fontWeight: 700 }}>
                        <td>∑ обхватов</td>
                        <td>{Number(fromM.total_cm).toFixed(1)}</td>
                        <td>{Number(toM.total_cm).toFixed(1)}</td>
                        <td style={{ color: diffColor(Number(toM.total_cm) - Number(fromM.total_cm)) }}>{fmtDiff(Number(toM.total_cm) - Number(fromM.total_cm))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* All measurements table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e6ea', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e6ea', fontWeight: 600, fontSize: 13, color: '#9ca3af', textTransform: 'uppercase' }}>
            Все замеры
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="measure-table">
              <thead>
                <tr>
                  <th>№</th><th>Дата</th><th>Консультант</th><th>Вес</th>
                  {CIRC_KEYS.map(k => <th key={k}>{ALL_ZONES.find(z => z.key === k)?.label ?? k}</th>)}
                  <th>∑ см</th><th>Δ пред.</th><th>Δ старт</th><th>Fitbase</th>
                </tr>
              </thead>
              <tbody>
                {ms.map((m, i) => {
                  const prev = i > 0 ? ms[i - 1] : null;
                  const dp = prev ? Number(m.total_cm) - Number(prev.total_cm) : null;
                  const ds = i > 0 ? Number(m.total_cm) - Number(ms[0].total_cm) : null;
                  const fbAt = fbOverrides[m.id] ?? m.fitbase_comment_at;
                  return (
                    <tr key={m.id} style={{ background: m.id === selectedMId ? 'rgba(2,189,182,0.05)' : undefined }}
                      onClick={() => setSelectedMId(m.id)}>
                      <td>{m.measure_no}</td>
                      <td>{fmtDate(m.measured_at)}</td>
                      <td style={{ fontSize: 12 }}>{m.consultant}</td>
                      <td>{m.weight != null ? Number(m.weight).toFixed(1) : '—'}</td>
                      {CIRC_KEYS.map(k => <td key={k}>{m[k] != null ? Number(m[k]).toFixed(1) : '—'}</td>)}
                      <td style={{ fontWeight: 600 }}>{Number(m.total_cm).toFixed(1)}</td>
                      <td style={{ fontWeight: 600, color: dp != null ? diffColor(dp) : '#9ca3af' }}>{dp != null ? fmtDiff(dp) : '—'}</td>
                      <td style={{ fontWeight: 600, color: ds != null ? diffColor(ds) : '#9ca3af' }}>{ds != null ? fmtDiff(ds) : '—'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <FitbaseBtn
                          m={{ ...m, fitbase_comment_at: fbAt }}
                          client={mergedClient}
                          onDone={onFbDone}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
          </section>
        </div>
      </div>
    </MeasureLayout>
  );
}
