import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import { MeasureLayout } from './MeasureLayout';

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

function BodyFigure({ m, prev, activeZones, onToggleZone }: {
  m: Measurement | null; prev: Measurement | null;
  activeZones: string[]; onToggleZone: (key: string) => void;
}) {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 200, margin: '0 auto', userSelect: 'none' }}>
      <img src="/kviz/img/body.png" alt="body" style={{ width: '100%', display: 'block' }} />
      {m && BODY_POINTS.map(pt => {
        const val = m[pt.key] != null ? Number(m[pt.key]) : null;
        if (val == null) return null;
        const diff = prev && prev[pt.key] != null ? val - Number(prev[pt.key]) : null;
        const active = activeZones.includes(pt.key);
        const zoneColor = ALL_ZONES.find(z => z.key === pt.key)?.color ?? '#02BDB6';
        // pills on right side for left-of-center points, on left for right-of-center
        const onRight = pt.x <= 50;
        return (
          <div key={pt.key}
            onClick={() => onToggleZone(pt.key)}
            style={{
              position: 'absolute',
              left: `${pt.x}%`, top: `${pt.y}%`,
              transform: 'translateY(-50%)',
              cursor: 'pointer',
            }}
          >
            {/* dot */}
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: active ? zoneColor : '#9ca3af',
              border: '2px solid #fff',
              position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)',
              zIndex: 2,
            }} />
            {/* pill */}
            <div style={{
              position: 'absolute',
              [onRight ? 'left' : 'right']: 8,
              top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(4px)',
              border: `1.5px solid ${active ? zoneColor : '#e2e6ea'}`,
              borderRadius: 7,
              padding: '2px 6px',
              whiteSpace: 'nowrap',
              fontSize: 10,
              fontWeight: 600,
              color: '#1a202c',
              lineHeight: 1.4,
              minWidth: 52,
              zIndex: 1,
            }}>
              <div style={{ color: '#6b7280', fontSize: 9 }}>{pt.label}</div>
              <div>{val.toFixed(1)}</div>
              {diff !== null && (
                <div style={{ color: diffColor(diff), fontSize: 9 }}>{fmtDiff(diff)}</div>
              )}
            </div>
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
              {isLast && (
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
            {isLast && (
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

  function openPrint() {
    window.open(`/kviz/measure/print?client=${clientId}&from=${fromId}&to=${toId}`, '_blank');
    onClose();
  }

  return (
    <div style={overlayS} onClick={onClose}>
      <div style={modalS} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>🖨 Печать бланка</div>
        <label style={lblS}>ДО — замер</label>
        <select value={fromId} onChange={e => setFromId(e.target.value)} style={selS}>
          {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
        </select>
        <label style={{ ...lblS, marginTop: 10 }}>ПОСЛЕ — замер</label>
        <select value={toId} onChange={e => setToId(e.target.value)} style={selS}>
          {ms.map(m => <option key={m.id} value={m.id}>№{m.measure_no} ({fmtDate(m.measured_at)})</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...fbBtnSt, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', padding: '7px 14px', fontSize: 13 }}>Отмена</button>
          <button onClick={openPrint} style={{ padding: '7px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flex: 1 }}>
            Открыть бланк
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

// ── Main ClientPage ────────────────────────────────────────────────────────────

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMId, setSelectedMId] = useState<string>('');
  const [zones, setZones] = useState<string[]>(() => {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : DEFAULT_ZONES; } catch { return DEFAULT_ZONES; }
  });
  const [cmpFrom, setCmpFrom] = useState('');
  const [cmpTo, setCmpTo] = useState('');
  const [printDialog, setPrintDialog] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [fbOverrides, setFbOverrides] = useState<Record<string, string>>({}); // mId → fitbase_comment_at

  const reload = useCallback(async () => {
    if (!id) return;
    const d: Client = await apiGet(`/api/measure/clients/${id}`);
    setClient(d);
    setSelectedMId(prev => prev || (d.measurements.at(-1)?.id ?? ''));
  }, [id]);

  useEffect(() => { reload().finally(() => setLoading(false)); }, [reload]);

  function saveZones(z: string[]) {
    setZones(z);
    try { localStorage.setItem(LS_KEY, JSON.stringify(z)); } catch {}
  }

  function toggleZoneFromFigure(key: string) {
    saveZones(zones.includes(key) ? zones.filter(z => z !== key) : [...zones, key]);
  }

  if (loading) return <MeasureLayout active="reports"><div style={{ padding: 32, color: '#9ca3af' }}>Загрузка…</div></MeasureLayout>;
  if (!client) return <MeasureLayout active="reports"><div style={{ padding: 32 }}>Клиент не найден</div></MeasureLayout>;

  const ms = client.measurements;
  const first = ms[0], last = ms[ms.length - 1];
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

  return (
    <MeasureLayout active="reports">
      {printDialog && ms.length > 0 && (
        <PrintDialog ms={ms} clientId={client.id} onClose={() => setPrintDialog(false)} />
      )}
      {linkDialog && (
        <LinkDialog clientId={client.id} onClose={() => setLinkDialog(false)}
          onLinked={fbId => { setLinkDialog(false); setClient(c => c ? { ...c, fitbase_client_id: fbId } : c); }} />
      )}

      <div style={{ padding: '16px', maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => navigate('/measure/reports')}>← Отчёты</button>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 17 }}>{client.name}</div>
          {ms.length > 0 && (
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}
              onClick={() => setPrintDialog(true)}>🖨 Бланк</button>
          )}
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

        {/* Figure + selected measurement details */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {/* Body figure */}
          <div style={{ flex: '0 0 auto', width: 'min(200px, 45vw)' }}>
            <BodyFigure m={mergedM} prev={prevM} activeZones={zones} onToggleZone={toggleZoneFromFigure} />
          </div>

          {/* Selected measurement stats */}
          {mergedM && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#374151' }}>
                Замер №{mergedM.measure_no} · {fmtDate(mergedM.measured_at)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                {mergedM.consultant}
                {mergedM.note && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>{mergedM.note}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13, marginBottom: 10 }}>
                {mergedM.weight != null && (
                  <>
                    <span style={{ color: '#6b7280' }}>Вес:</span>
                    <span style={{ fontWeight: 600 }}>
                      {Number(mergedM.weight).toFixed(1)} кг
                      {prevM?.weight != null && <span style={{ color: diffColor(Number(mergedM.weight) - Number(prevM.weight)), marginLeft: 4, fontSize: 11 }}>{fmtDiff(Number(mergedM.weight) - Number(prevM.weight))}</span>}
                    </span>
                  </>
                )}
                <span style={{ color: '#6b7280' }}>∑ обхватов:</span>
                <span style={{ fontWeight: 700, color: '#02BDB6' }}>
                  {Number(mergedM.total_cm).toFixed(1)} см
                  {prevM && <span style={{ color: diffColor(Number(mergedM.total_cm) - Number(prevM.total_cm)), marginLeft: 4, fontSize: 11 }}>{fmtDiff(Number(mergedM.total_cm) - Number(prevM.total_cm))}</span>}
                </span>
              </div>

              {/* Fitbase button */}
              <div style={{ marginTop: 6 }}>
                <FitbaseBtn
                  m={{ ...mergedM, fitbase_comment_at: fbOverrides[mergedM.id] ?? mergedM.fitbase_comment_at }}
                  client={mergedClient}
                  onDone={onFbDone}
                />
              </div>
            </div>
          )}
        </div>

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
      </div>
    </MeasureLayout>
  );
}
