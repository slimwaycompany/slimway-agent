import { useCallback, useEffect, useRef, useState } from 'react';
import TvScreen from './TvScreen';
import type { ScreenEl, ScreenElKind, ScreenLayout } from '../../lib/tvScreenLayout';
import { SCREEN_EL_LABELS, defaultScreenLayout } from '../../lib/tvScreenLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  kind: ScreenElKind;
  mode: DragMode;
  startX: number; startY: number;
  startEl: ScreenEl;
  pW: number; pH: number; // preview container dimensions
}

interface Props {
  initialLayout: ScreenLayout;
  onSave: (layout: ScreenLayout) => Promise<void>;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function snap(v: number): number { return Math.round(v * 2) / 2; } // 0.5% grid
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function applyDrag(el: ScreenEl, drag: DragState, cx: number, cy: number): ScreenEl {
  const dxPct = (cx - drag.startX) / drag.pW * 100;
  const dyPct = (cy - drag.startY) / drag.pH * 100;
  const { x, y, w, h } = drag.startEl;
  const MIN_SIZE = 2;

  if (drag.mode === 'move') {
    return { ...el, x: snap(clamp(x + dxPct, 0, 100 - w)), y: snap(clamp(y + dyPct, 0, 100 - h)) };
  }
  if (drag.mode === 'se') {
    return { ...el, w: snap(clamp(w + dxPct, MIN_SIZE, 100 - x)), h: snap(clamp(h + dyPct, MIN_SIZE, 100 - y)) };
  }
  if (drag.mode === 'sw') {
    const nx = snap(clamp(x + dxPct, 0, x + w - MIN_SIZE));
    return { ...el, x: nx, w: snap(clamp(w - dxPct, MIN_SIZE, 100 - nx)), h: snap(clamp(h + dyPct, MIN_SIZE, 100 - y)) };
  }
  if (drag.mode === 'ne') {
    const ny = snap(clamp(y + dyPct, 0, y + h - MIN_SIZE));
    return { ...el, y: ny, w: snap(clamp(w + dxPct, MIN_SIZE, 100 - x)), h: snap(clamp(h - dyPct, MIN_SIZE, 100 - ny)) };
  }
  if (drag.mode === 'nw') {
    const nx = snap(clamp(x + dxPct, 0, x + w - MIN_SIZE));
    const ny = snap(clamp(y + dyPct, 0, y + h - MIN_SIZE));
    return { ...el, x: nx, y: ny, w: snap(clamp(w - dxPct, MIN_SIZE, 100 - nx)), h: snap(clamp(h - dyPct, MIN_SIZE, 100 - ny)) };
  }
  return el;
}

// ── Resize handle ─────────────────────────────────────────────────────────────

type Pos = 'nw' | 'ne' | 'sw' | 'se';
const HANDLE_STYLES: Record<Pos, React.CSSProperties> = {
  nw: { top: -5, left: -5, cursor: 'nw-resize' },
  ne: { top: -5, right: -5, cursor: 'ne-resize' },
  sw: { bottom: -5, left: -5, cursor: 'sw-resize' },
  se: { bottom: -5, right: -5, cursor: 'se-resize' },
};

function ResizeHandle({ pos, onDown }: { pos: Pos; onDown: (e: React.PointerEvent, mode: DragMode) => void }) {
  return (
    <div
      style={{
        position: 'absolute', width: 10, height: 10,
        background: '#02BDB6', borderRadius: '50%', border: '2px solid #fff',
        zIndex: 10, touchAction: 'none',
        ...HANDLE_STYLES[pos],
      }}
      onPointerDown={e => { e.stopPropagation(); onDown(e, pos); }}
    />
  );
}

// ── Properties panel ──────────────────────────────────────────────────────────

const VALID_FONTS = ['Manrope', 'Montserrat', 'Oswald', 'Barlow Condensed', 'Playfair Display', 'Russo One', 'Unbounded'];
const TEXT_KINDS   = new Set<ScreenElKind>(['intro', 'mission', 'datetime']);
const COUNTER_KINDS = new Set<ScreenElKind>(['counter_cm', 'counter_kg', 'counter_fat']);

const INP: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1px solid #334155', borderRadius: 5,
  fontSize: 12, fontFamily: 'inherit', background: '#0f172a', color: '#e2e8f0',
  outline: 'none', boxSizing: 'border-box',
};
const LBL: React.CSSProperties = { fontSize: 11, color: '#64748b', marginBottom: 3, display: 'block' };
const ROW: React.CSSProperties = { marginBottom: 10 };

function PropertiesPanel({ el, onChange }: { el: ScreenEl; onChange: (upd: Partial<ScreenEl>) => void }) {
  const isText    = TEXT_KINDS.has(el.kind);
  const isCounter = COUNTER_KINDS.has(el.kind);

  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
        {SCREEN_EL_LABELS[el.kind]}
      </div>

      {/* Position / size */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        {(['x', 'y', 'w', 'h'] as const).map(k => (
          <div key={k}>
            <label style={LBL}>{k === 'x' ? 'Лево %' : k === 'y' ? 'Верх %' : k === 'w' ? 'Ширина %' : 'Высота %'}</label>
            <input type="number" step="0.5" min={k === 'w' || k === 'h' ? 2 : 0} max={100} value={el[k]}
              style={INP}
              onChange={e => onChange({ [k]: snap(Number(e.target.value)) })} />
          </div>
        ))}
      </div>

      {/* Z-index */}
      <div style={ROW}>
        <label style={LBL}>Слой (z)</label>
        <input type="number" min={0} max={50} step={1} value={el.z ?? 0}
          style={INP} onChange={e => onChange({ z: Math.round(Number(e.target.value)) })} />
      </div>

      {/* Text content */}
      {(isText && el.kind !== 'datetime') && (
        <div style={ROW}>
          <label style={LBL}>Текст</label>
          <textarea value={el.text ?? ''} rows={3}
            style={{ ...INP, resize: 'vertical' }}
            onChange={e => onChange({ text: e.target.value })} />
        </div>
      )}

      {/* Counter content */}
      {isCounter && (
        <>
          <div style={ROW}>
            <label style={LBL}>Подпись</label>
            <input value={el.label ?? ''} style={INP}
              onChange={e => onChange({ label: e.target.value })} />
          </div>
          <div style={ROW}>
            <label style={LBL}>Единица</label>
            <input value={el.unit ?? ''} style={INP}
              onChange={e => onChange({ unit: e.target.value })} />
          </div>
        </>
      )}

      {/* Text style */}
      {(isText || isCounter) && (
        <>
          <div style={ROW}>
            <label style={LBL}>Шрифт</label>
            <select value={el.font ?? 'Manrope'} style={{ ...INP }}
              onChange={e => onChange({ font: e.target.value })}>
              {VALID_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={LBL}>Размер (%h)</label>
              <input type="number" step="0.1" min={0.3} max={20} value={el.size ?? 1.6}
                style={INP} onChange={e => onChange({ size: Number(e.target.value) })} />
            </div>
            <div>
              <label style={LBL}>Насыщенность</label>
              <select value={el.weight ?? 600} style={{ ...INP }}
                onChange={e => onChange({ weight: Number(e.target.value) as 400 | 600 | 800 })}>
                <option value={400}>400 Regular</option>
                <option value={600}>600 SemiBold</option>
                <option value={800}>800 ExtraBold</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={LBL}>Цвет текста</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={el.color ?? '#263CD9'}
                  style={{ width: 32, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                  onChange={e => onChange({ color: e.target.value })} />
                <input value={el.color ?? '#263CD9'} style={{ ...INP, flex: 1 }}
                  onChange={e => /^#[0-9A-Fa-f]{0,6}$/.test(e.target.value) && onChange({ color: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={LBL}>Выравнивание</label>
              <select value={el.align ?? 'center'} style={{ ...INP }}
                onChange={e => onChange({ align: e.target.value as 'left' | 'center' | 'right' })}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Mock data for preview ─────────────────────────────────────────────────────

const MOCK_COUNTERS = { cm: 15847, kg: 3241, fat: 1256 };

function formatAlmaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');
}

// ── Editor ───────────────────────────────────────────────────────────────────

export default function TvScreenEditor({ initialLayout, onSave, onClose }: Props) {
  const [layout, setLayout] = useState<ScreenLayout>(initialLayout);
  const [history, setHistory] = useState<ScreenLayout[]>([]);
  const [future, setFuture] = useState<ScreenLayout[]>([]);
  const [selectedKind, setSelectedKind] = useState<ScreenElKind | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => formatAlmaty(new Date()));

  const previewRef = useRef<HTMLDivElement>(null);
  const preInteractionRef = useRef<ScreenLayout | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Keep drag ref in sync for pointer events
  useEffect(() => { dragRef.current = drag; }, [drag]);

  useEffect(() => {
    const id = setInterval(() => setNow(formatAlmaty(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Layout updates ──────────────────────────────────────────────────────────

  const pushHistory = useCallback((prev: ScreenLayout) => {
    setHistory(h => [...h.slice(-49), prev]);
    setFuture([]);
  }, []);

  function updateEl(kind: ScreenElKind, upd: Partial<ScreenEl>) {
    pushHistory(layout);
    setLayout(l => ({ ...l, elements: l.elements.map(e => e.kind === kind ? { ...e, ...upd } : e) }));
  }

  function undo() {
    if (!history.length) return;
    setFuture(f => [layout, ...f.slice(0, 49)]);
    setLayout(history[history.length - 1]);
    setHistory(h => h.slice(0, -1));
  }

  function redo() {
    if (!future.length) return;
    setHistory(h => [...h, layout]);
    setLayout(future[0]);
    setFuture(f => f.slice(1));
  }

  function resetLayout() {
    pushHistory(layout);
    setLayout(defaultScreenLayout());
  }

  // ── Drag/resize ─────────────────────────────────────────────────────────────

  function startDrag(e: React.PointerEvent, kind: ScreenElKind, mode: DragMode) {
    e.preventDefault();
    const preview = previewRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const el = layout.elements.find(x => x.kind === kind);
    if (!el) return;
    preInteractionRef.current = layout;
    const ds: DragState = {
      kind, mode,
      startX: e.clientX, startY: e.clientY,
      startEl: { ...el },
      pW: rect.width, pH: rect.height,
    };
    setDrag(ds);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPreviewPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const updated = applyDrag(d.startEl, d, e.clientX, e.clientY);
    setLayout(l => ({ ...l, elements: l.elements.map(el => el.kind === d.kind ? updated : el) }));
  }

  function endDrag() {
    if (dragRef.current && preInteractionRef.current) {
      pushHistory(preInteractionRef.current);
      preInteractionRef.current = null;
    }
    setDrag(null);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await onSave(layout);
      onClose();
    } catch (e) { setError(String(e)); }
    setSaving(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectedEl = selectedKind ? layout.elements.find(e => e.kind === selectedKind) ?? null : null;

  const BTN: React.CSSProperties = {
    padding: '6px 12px', border: '1px solid #334155', borderRadius: 5,
    background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', fontFamily: 'Manrope,system-ui,sans-serif' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '10px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Редактор экрана ТВ</span>
        <button style={BTN} onClick={undo} disabled={!history.length} title="Отменить (Ctrl+Z)">↩</button>
        <button style={BTN} onClick={redo} disabled={!future.length} title="Повторить">↪</button>
        <button style={{ ...BTN, color: '#fbbf24', borderColor: '#78350f' }} onClick={resetLayout} title="Сбросить до стандартного макета">Сброс</button>
        <button style={{ ...BTN, background: '#02BDB6', color: '#fff', border: 'none' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button style={{ ...BTN, marginLeft: 4 }} onClick={onClose}>✕</button>
      </div>

      {error && <div style={{ padding: '6px 16px', background: '#7f1d1d', color: '#fca5a5', fontSize: 12, flexShrink: 0 }}>{error}</div>}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: element tree */}
        <div style={{ width: 200, flexShrink: 0, background: '#0f172a', borderRight: '1px solid #1e293b', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em' }}>Элементы</div>
          {layout.elements.map(el => (
            <div key={el.kind}
              style={{
                padding: '9px 12px', cursor: 'pointer', fontSize: 12,
                background: selectedKind === el.kind ? 'rgba(2,189,182,.18)' : 'transparent',
                color: selectedKind === el.kind ? '#02BDB6' : '#94a3b8',
                borderLeft: selectedKind === el.kind ? '2px solid #02BDB6' : '2px solid transparent',
                fontWeight: selectedKind === el.kind ? 700 : 400,
              }}
              onClick={() => setSelectedKind(el.kind)}
            >
              {SCREEN_EL_LABELS[el.kind]}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ padding: '8px 12px', fontSize: 10, color: '#475569', borderTop: '1px solid #1e293b' }}>
            Drag для перемещения<br />Угловые точки для размера
          </div>
        </div>

        {/* Center: 16:9 preview */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#020c1b', overflow: 'hidden' }}>
          <div
            ref={previewRef}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 'min(100%, calc((100vh - 120px) * 16 / 9))',
              aspectRatio: '16/9',
              background: 'linear-gradient(135deg,#e8fbfa 0%,#f7f8ff 52%,#eef0ff 100%)',
              borderRadius: 8,
              overflow: 'hidden',
              cursor: drag ? (drag.mode === 'move' ? 'grabbing' : drag.mode + '-resize') : 'default',
              userSelect: 'none',
            }}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* TV glows */}
            <div className="tv-glow tv-glow-a" style={{ opacity: .18 }} />
            <div className="tv-glow tv-glow-b" style={{ opacity: .18 }} />

            {/* TV Screen */}
            <TvScreen
              layout={layout}
              counters={MOCK_COUNTERS}
              carousel={
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(38,60,217,.12)', borderRadius: 'clamp(14px,1.8vw,28px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#263CD9', fontSize: 'clamp(10px,1.4vw,20px)', fontWeight: 700, opacity: .6 }}>Карусель слайдов</span>
                </div>
              }
              datetime={now}
            />

            {/* Drag overlay */}
            {layout.elements.map(el => (
              <div
                key={el.kind}
                style={{
                  position: 'absolute',
                  left: `${el.x}%`, top: `${el.y}%`,
                  width: `${el.w}%`, height: `${el.h}%`,
                  zIndex: 500 + (el.z ?? 0),
                  boxSizing: 'border-box',
                  border: selectedKind === el.kind ? '1.5px solid #02BDB6' : '1px dashed rgba(2,189,182,.25)',
                  cursor: drag?.mode === 'move' && drag.kind === el.kind ? 'grabbing' : 'move',
                  touchAction: 'none',
                }}
                onPointerDown={e => startDrag(e, el.kind, 'move')}
                onClick={() => setSelectedKind(el.kind)}
              >
                {selectedKind === el.kind && (['nw', 'ne', 'sw', 'se'] as Pos[]).map(pos => (
                  <ResizeHandle key={pos} pos={pos} onDown={(e, mode) => startDrag(e, el.kind, mode)} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Right: properties */}
        <div style={{ width: 260, flexShrink: 0, background: '#0f172a', borderLeft: '1px solid #1e293b', overflow: 'auto', padding: 14 }}>
          {selectedEl
            ? <PropertiesPanel el={selectedEl} onChange={upd => updateEl(selectedKind!, upd)} />
            : <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
                Выберите элемент<br/>в дереве или на экране
              </div>
          }
        </div>
      </div>
    </div>
  );
}
