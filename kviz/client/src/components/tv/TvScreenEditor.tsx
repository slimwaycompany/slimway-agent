import { useCallback, useEffect, useRef, useState } from 'react';
import TvScreen from './TvScreen';
import type { ScreenEl, ScreenElImage, ScreenElShape, ScreenElType, ScreenLayout } from '../../lib/tvScreenLayout';
import { ASSET_LABELS, BIND_LABELS, SHAPE_LABELS, TYPE_LABELS, VALID_FONTS, defaultScreenLayout, newId } from '../../lib/tvScreenLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'rotate';

interface DragState {
  id: string;
  mode: DragMode;
  startX: number; startY: number;
  startEl: ScreenEl;
  pW: number; pH: number;
  shiftKey: boolean;
}

interface Props {
  initialLayout: ScreenLayout;
  initialMission: string;
  onSave: (layout: ScreenLayout, mission: string) => Promise<void>;
  onClose: () => void;
}

// ── Style constants ───────────────────────────────────────────────────────────

const INP: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1px solid #334155', borderRadius: 5,
  fontSize: 12, fontFamily: 'inherit', background: '#0f172a', color: '#e2e8f0',
  outline: 'none', boxSizing: 'border-box',
};
const LBL: React.CSSProperties = { fontSize: 11, color: '#64748b', marginBottom: 3, display: 'block' };
const ROW: React.CSSProperties = { marginBottom: 10 };
const BTN: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid #334155', borderRadius: 5,
  background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function snap(v: number): number { return Math.round(v * 2) / 2; }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function applyDrag(el: ScreenEl, drag: DragState, cx: number, cy: number, pRect: DOMRect): ScreenEl {
  const dxPct = (cx - drag.startX) / drag.pW * 100;
  const dyPct = (cy - drag.startY) / drag.pH * 100;
  const { x, y, w, h } = drag.startEl;
  const MIN = 2;

  if (drag.mode === 'rotate') {
    const elCx = (x + w / 2) / 100 * pRect.width  + pRect.left;
    const elCy = (y + h / 2) / 100 * pRect.height + pRect.top;
    const angle = Math.atan2(cy - elCy, cx - elCx) * 180 / Math.PI + 90;
    const step = drag.shiftKey ? 15 : 5;
    return { ...el, rotate: Math.max(-180, Math.min(180, Math.round(angle / step) * step)) };
  }
  if (drag.mode === 'move') return { ...el, x: snap(clamp(x + dxPct, 0, 100 - w)), y: snap(clamp(y + dyPct, 0, 100 - h)) };
  if (drag.mode === 'se') return { ...el, w: snap(clamp(w + dxPct, MIN, 100 - x)), h: snap(clamp(h + dyPct, MIN, 100 - y)) };
  if (drag.mode === 'sw') {
    const nx = snap(clamp(x + dxPct, 0, x + w - MIN));
    return { ...el, x: nx, w: snap(clamp(w - dxPct, MIN, 100 - nx)), h: snap(clamp(h + dyPct, MIN, 100 - y)) };
  }
  if (drag.mode === 'ne') {
    const ny = snap(clamp(y + dyPct, 0, y + h - MIN));
    return { ...el, y: ny, w: snap(clamp(w + dxPct, MIN, 100 - x)), h: snap(clamp(h - dyPct, MIN, 100 - ny)) };
  }
  if (drag.mode === 'nw') {
    const nx = snap(clamp(x + dxPct, 0, x + w - MIN));
    const ny = snap(clamp(y + dyPct, 0, y + h - MIN));
    return { ...el, x: nx, y: ny, w: snap(clamp(w - dxPct, MIN, 100 - nx)), h: snap(clamp(h - dyPct, MIN, 100 - ny)) };
  }
  if (drag.mode === 'n') {
    const ny = snap(clamp(y + dyPct, 0, y + h - MIN));
    return { ...el, y: ny, h: snap(clamp(h - dyPct, MIN, 100 - ny)) };
  }
  if (drag.mode === 's') return { ...el, h: snap(clamp(h + dyPct, MIN, 100 - y)) };
  if (drag.mode === 'e') return { ...el, w: snap(clamp(w + dxPct, MIN, 100 - x)) };
  if (drag.mode === 'w') {
    const nx = snap(clamp(x + dxPct, 0, x + w - MIN));
    return { ...el, x: nx, w: snap(clamp(w - dxPct, MIN, 100 - nx)) };
  }
  return el;
}

function formatAlmaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');
}

async function readBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res((e.target!.result as string).split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function apiPut(url: string, body: unknown) {
  const r = await fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}
async function apiPost(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

// ── Handles ───────────────────────────────────────────────────────────────────

type HandlePos = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const CORNER_STYLE: React.CSSProperties = { width: 10, height: 10, background: '#02BDB6', borderRadius: '50%', border: '2px solid #fff' };
const EDGE_STYLE:   React.CSSProperties = { width: 8,  height: 8,  background: '#02BDB6', borderRadius: 2, border: '2px solid #fff' };

const HANDLE_POS: Record<HandlePos, React.CSSProperties> = {
  nw: { top: -5, left: -5, cursor: 'nw-resize' },
  ne: { top: -5, right: -5, cursor: 'ne-resize' },
  sw: { bottom: -5, left: -5, cursor: 'sw-resize' },
  se: { bottom: -5, right: -5, cursor: 'se-resize' },
  n:  { top: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' },
  s:  { bottom: -4, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' },
  e:  { right: -4, top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' },
  w:  { left: -4, top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' },
};

function Handle({ pos, onDown }: { pos: HandlePos; onDown: (e: React.PointerEvent, m: DragMode) => void }) {
  const isCorner = ['nw','ne','sw','se'].includes(pos);
  return (
    <div
      style={{ position: 'absolute', zIndex: 10, touchAction: 'none', ...( isCorner ? CORNER_STYLE : EDGE_STYLE), ...HANDLE_POS[pos] }}
      onPointerDown={e => { e.stopPropagation(); onDown(e, pos); }}
    />
  );
}

// ── Property sub-components ───────────────────────────────────────────────────

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={ROW}>
      <label style={LBL}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="color" value={value} style={{ width: 32, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          onChange={e => onChange(e.target.value)} />
        <input value={value} style={{ ...INP, flex: 1 }}
          onChange={e => /^#[0-9A-Fa-f]{0,6}$/.test(e.target.value) && onChange(e.target.value)} />
      </div>
    </div>
  );
}

function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={ROW}>
      <label style={LBL}>{label} <span style={{ color: '#94a3b8' }}>{Math.round(value * 100)}%</span></label>
      <input type="range" min={0} max={1} step={0.01} value={value} style={{ width: '100%' }}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function TextStyleProps({ el, onChange }: { el: Record<string, unknown>; onChange: (u: Record<string, unknown>) => void }) {
  return (
    <>
      <div style={ROW}>
        <label style={LBL}>Шрифт</label>
        <select value={String(el.font ?? 'Manrope')} style={INP} onChange={e => onChange({ font: e.target.value })}>
          {VALID_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={LBL}>Размер (%h)</label>
          <input type="number" step="0.1" min={0.5} max={60} value={el.size as number ?? 2} style={INP}
            onChange={e => onChange({ size: Number(e.target.value) })} />
        </div>
        <div>
          <label style={LBL}>Насыщенность</label>
          <select value={el.weight as number ?? 400} style={INP} onChange={e => onChange({ weight: Number(e.target.value) })}>
            <option value={400}>400 Regular</option>
            <option value={600}>600 SemiBold</option>
            <option value={800}>800 ExtraBold</option>
          </select>
        </div>
      </div>
      <ColorRow label="Цвет текста" value={String(el.color ?? '#000000')} onChange={c => onChange({ color: c })} />
      <SliderRow label="Прозрачность" value={el.opacity as number ?? 1} onChange={v => onChange({ opacity: v })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={LBL}>Выравнивание</label>
          <select value={String(el.align ?? 'left')} style={INP} onChange={e => onChange({ align: e.target.value })}>
            <option value="left">Лево</option>
            <option value="center">Центр</option>
            <option value="right">Право</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={LBL}>Scale X (0.5–2)</label>
          <input type="number" step="0.05" min={0.5} max={2} value={el.scaleX as number ?? 1} style={INP}
            onChange={e => onChange({ scaleX: Number(e.target.value) })} />
        </div>
        <div>
          <label style={LBL}>Scale Y (0.5–2)</label>
          <input type="number" step="0.05" min={0.5} max={2} value={el.scaleY as number ?? 1} style={INP}
            onChange={e => onChange({ scaleY: Number(e.target.value) })} />
        </div>
      </div>
    </>
  );
}

function ShapeProps({ el, onChange }: { el: ScreenElShape; onChange: (u: Partial<ScreenElShape>) => void }) {
  const fill = el.fill ?? { type: 'solid' as const, color: '#ffffff', opacity: 0.58 };
  const border = el.border ?? { width: 0.15, color: '#ffffff', opacity: 0.85 };
  const borderOn = !!el.border;

  return (
    <>
      <div style={ROW}>
        <label style={LBL}>Форма</label>
        <select value={el.shape} style={INP} onChange={e => onChange({ shape: e.target.value as ScreenElShape['shape'] })}>
          {Object.entries(SHAPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {(el.shape === 'rounded') && (
        <div style={ROW}>
          <label style={LBL}>Радиус (%h, 0–10)</label>
          <input type="number" step="0.5" min={0} max={10} value={el.radius ?? 2} style={INP}
            onChange={e => onChange({ radius: Number(e.target.value) })} />
        </div>
      )}
      <div style={ROW}>
        <label style={LBL}>Заливка</label>
        <select value={fill.type} style={INP} onChange={e => {
          const t = e.target.value;
          onChange({ fill: t === 'solid'
            ? { type: 'solid', color: '#ffffff', opacity: 0.58 }
            : { type: 'gradient', from: '#02BDB6', to: '#263CD9', angle: 135, opacity: 1 },
          });
        }}>
          <option value="solid">Однотонная</option>
          <option value="gradient">Градиент</option>
        </select>
      </div>
      {fill.type === 'solid' && (
        <>
          <ColorRow label="Цвет" value={fill.color} onChange={c => onChange({ fill: { ...fill, type: 'solid', color: c } })} />
          <SliderRow label="Прозрачность" value={fill.opacity} onChange={v => onChange({ fill: { ...fill, type: 'solid', opacity: v } })} />
        </>
      )}
      {fill.type === 'gradient' && el.fill?.type === 'gradient' && (() => {
        const gf = el.fill;
        return (
          <>
            <ColorRow label="Цвет 1" value={gf.from} onChange={c => onChange({ fill: { ...gf, from: c } })} />
            <ColorRow label="Цвет 2" value={gf.to}   onChange={c => onChange({ fill: { ...gf, to: c } })} />
            <div style={ROW}>
              <label style={LBL}>Угол (°)</label>
              <input type="number" min={0} max={360} step={5} value={gf.angle} style={INP}
                onChange={e => onChange({ fill: { ...gf, angle: Number(e.target.value) } })} />
            </div>
            <SliderRow label="Прозрачность" value={gf.opacity} onChange={v => onChange({ fill: { ...gf, opacity: v } })} />
          </>
        );
      })()}
      <div style={ROW}>
        <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={borderOn} onChange={e => onChange({ border: e.target.checked ? border : undefined })} />
          Рамка
        </label>
      </div>
      {borderOn && (
        <>
          <div style={ROW}>
            <label style={LBL}>Толщина (%h)</label>
            <input type="number" step="0.01" min={0} max={1} value={border.width} style={INP}
              onChange={e => onChange({ border: { ...border, width: Number(e.target.value) } })} />
          </div>
          <ColorRow label="Цвет рамки" value={border.color} onChange={c => onChange({ border: { ...border, color: c } })} />
          <SliderRow label="Прозрачность рамки" value={border.opacity} onChange={v => onChange({ border: { ...border, opacity: v } })} />
        </>
      )}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
        <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!el.shadow} onChange={e => onChange({ shadow: e.target.checked || undefined })} />Тень
        </label>
        <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!el.blur} onChange={e => onChange({ blur: e.target.checked || undefined })} />Blur (стекло)
        </label>
      </div>
    </>
  );
}

function ImageProps({ el, onChange, uploadError, onUpload }: {
  el: ScreenElImage;
  onChange: (u: Partial<ScreenElImage>) => void;
  uploadError: string;
  onUpload: (file: File) => void;
}) {
  const isAsset = !!el.asset;
  return (
    <>
      <div style={ROW}>
        <label style={LBL}>Источник</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <label style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}>
            <input type="radio" checked={isAsset} onChange={() => onChange({ asset: 'logo', path: undefined })} /> Встроенный
          </label>
          <label style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}>
            <input type="radio" checked={!isAsset} onChange={() => onChange({ asset: undefined, path: undefined })} /> Загруженный
          </label>
        </div>
        {isAsset && (
          <select value={el.asset ?? 'logo'} style={INP} onChange={e => onChange({ asset: e.target.value as ScreenElImage['asset'] })}>
            {Object.entries(ASSET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {!isAsset && (
          <div>
            {el.path && <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{el.path}</div>}
            <label style={{ ...BTN, display: 'inline-block', cursor: 'pointer' }}>
              Выбрать файл<input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
            </label>
            {el.path && <button style={{ ...BTN, marginLeft: 6, color: '#f87171', borderColor: '#7f1d1d' }}
              onClick={() => onChange({ path: undefined })}>✕</button>}
            {uploadError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{uploadError}</div>}
          </div>
        )}
      </div>
      <div style={ROW}>
        <label style={LBL}>Масштаб</label>
        <select value={el.fit ?? 'contain'} style={INP} onChange={e => onChange({ fit: e.target.value as ScreenElImage['fit'] })}>
          <option value="contain">Вписать (contain)</option>
          <option value="cover">Заполнить (cover)</option>
          <option value="stretch">Растянуть</option>
        </select>
      </div>
      <SliderRow label="Прозрачность" value={el.opacity ?? 1} onChange={v => onChange({ opacity: v })} />
      <div style={ROW}>
        <label style={LBL}>Радиус (%h, 0–10)</label>
        <input type="number" step="0.5" min={0} max={10} value={el.radius ?? 0} style={INP}
          onChange={e => onChange({ radius: Number(e.target.value) })} />
      </div>
    </>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

const MOCK_VALUES = { value_cm: 15847, value_kg: 3241, value_fat: 1256 };

export default function TvScreenEditor({ initialLayout, initialMission, onSave, onClose }: Props) {
  const [layout, setLayout]         = useState<ScreenLayout>(initialLayout);
  const [missionText, setMission]   = useState(initialMission);
  const [history, setHistory]       = useState<[ScreenLayout, string][]>([]);
  const [future, setFuture]         = useState<[ScreenLayout, string][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag]             = useState<DragState | null>(null);
  const [tvMode, setTvMode]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [uploadError, setUploadErr] = useState('');
  const [now, setNow]               = useState(() => formatAlmaty(new Date()));
  const [layerDragId, setLayerDragId]   = useState<string | null>(null);
  const [layerOverId, setLayerOverId]   = useState<string | null>(null);

  const previewRef     = useRef<HTMLDivElement>(null);
  const preInterRef    = useRef<[ScreenLayout, string] | null>(null);
  const dragRef        = useRef<DragState | null>(null);
  const layoutRef      = useRef(layout);
  const missionRef     = useRef(missionText);
  layoutRef.current  = layout;
  missionRef.current = missionText;

  useEffect(() => { dragRef.current = drag; }, [drag]);
  useEffect(() => {
    const id = setInterval(() => setNow(formatAlmaty(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── History ─────────────────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    setHistory(h => [...h.slice(-49), [layoutRef.current, missionRef.current]]);
    setFuture([]);
  }, []);

  function undo() {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture(f => [[layoutRef.current, missionRef.current], ...f.slice(0, 49)]);
      setLayout(prev[0]); setMission(prev[1]);
      return h.slice(0, -1);
    });
  }
  function redo() {
    setFuture(f => {
      if (!f.length) return f;
      const next = f[0];
      setHistory(h => [...h, [layoutRef.current, missionRef.current]]);
      setLayout(next[0]); setMission(next[1]);
      return f.slice(1);
    });
  }

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Layout mutations ─────────────────────────────────────────────────────────

  function updateEl(id: string, upd: Record<string, unknown>) {
    pushHistory();
    setLayout(l => ({ ...l, elements: l.elements.map(e => e.id === id ? { ...e, ...upd } as ScreenEl : e) }));
  }

  function deleteEl(id: string) {
    pushHistory();
    setLayout(l => ({ ...l, elements: l.elements.filter(e => e.id !== id) }));
    setSelectedId(null);
  }

  function addEl(type: ScreenElType) {
    const maxZ = layout.elements.reduce((m, e) => Math.max(m, e.z), 0);
    let el: ScreenEl;
    const base = { id: newId(), visible: true as const, locked: false as const };
    switch (type) {
      case 'text':
        el = { ...base, type, x: 10, y: 10, w: 80, h: 15, z: maxZ + 1, text: 'Новый текст', font: 'Manrope', size: 2, weight: 400, color: '#000000', align: 'center' }; break;
      case 'value':
        el = { ...base, type, x: 10, y: 10, w: 30, h: 15, z: maxZ + 1, bind: 'value_cm', font: 'Barlow Condensed', size: 10, weight: 800, color: '#1e293b', align: 'right' }; break;
      case 'mission':
        el = { ...base, type, x: 10, y: 90, w: 80, h: 8, z: maxZ + 1, font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' }; break;
      case 'datetime':
        el = { ...base, type, x: 70, y: 92, w: 29, h: 5, z: maxZ + 1, font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' }; break;
      case 'image':
        el = { ...base, type, x: 10, y: 10, w: 20, h: 20, z: maxZ + 1, asset: 'logo', fit: 'contain' }; break;
      case 'shape':
        el = { ...base, type, x: 10, y: 10, w: 80, h: 80, z: 0, shape: 'rounded', radius: 2, fill: { type: 'solid', color: '#ffffff', opacity: 0.58 }, border: { width: 0.15, color: '#ffffff', opacity: 0.85 }, shadow: true, blur: true }; break;
      case 'carousel':
        el = { ...base, type, x: 30, y: 11, w: 69, h: 80, z: 0, frame: false }; break;
      default: return;
    }
    pushHistory();
    setLayout(l => ({ ...l, elements: [...l.elements, el] }));
    setSelectedId(el.id);
  }

  // ── Drag/resize ──────────────────────────────────────────────────────────────

  function startDrag(e: React.PointerEvent, id: string, mode: DragMode) {
    if (e.button !== 0) return;
    e.preventDefault();
    const preview = previewRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const el = layout.elements.find(x => x.id === id);
    if (!el) return;
    if (el.locked && mode !== 'rotate') return;
    preInterRef.current = [layout, missionText];
    const ds: DragState = {
      id, mode, startX: e.clientX, startY: e.clientY,
      startEl: { ...el }, pW: rect.width, pH: rect.height, shiftKey: e.shiftKey,
    };
    setDrag(ds);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPreviewPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const preview = previewRef.current;
    if (!preview) return;
    const pRect = preview.getBoundingClientRect();
    const updated = applyDrag(d.startEl, { ...d, shiftKey: e.shiftKey }, e.clientX, e.clientY, pRect);
    setLayout(l => ({ ...l, elements: l.elements.map(el => el.id === d.id ? updated : el) }));
  }

  function endDrag() {
    if (dragRef.current && preInterRef.current) {
      const [prevLayout, prevMission] = preInterRef.current;
      setHistory(h => [...h.slice(-49), [prevLayout, prevMission]]);
      setFuture([]);
      preInterRef.current = null;
    }
    setDrag(null);
  }

  // ── Layer reorder ─────────────────────────────────────────────────────────────

  function onLayerDrop(targetId: string) {
    if (!layerDragId || layerDragId === targetId) { setLayerDragId(null); setLayerOverId(null); return; }
    const topFirst = [...layout.elements].sort((a, b) => b.z - a.z);
    const fromIdx  = topFirst.findIndex(e => e.id === layerDragId);
    const toIdx    = topFirst.findIndex(e => e.id === targetId);
    if (fromIdx === -1 || toIdx === -1) { setLayerDragId(null); setLayerOverId(null); return; }
    const reordered = [...topFirst];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, topFirst[fromIdx]);
    pushHistory();
    setLayout(l => ({
      ...l,
      elements: l.elements.map(el => {
        const idx = reordered.findIndex(r => r.id === el.id);
        return { ...el, z: reordered.length - 1 - idx };
      }),
    }));
    setLayerDragId(null); setLayerOverId(null);
  }

  // ── Image upload ─────────────────────────────────────────────────────────────

  async function uploadImage(id: string, file: File) {
    setUploadErr('');
    try {
      const b64 = await readBase64(file);
      const r = await apiPost('/kviz/api/tv/screen/image', { content_base64: b64 });
      if (r.ok) updateEl(id, { path: r.data.path, asset: undefined });
      else setUploadErr(r.data?.error || 'Ошибка загрузки');
    } catch { setUploadErr('Ошибка загрузки'); }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true); setError('');
    try { await onSave(layout, missionText); onClose(); }
    catch (e) { setError(String(e)); setSaving(false); }
  }

  // ── Snap guides ───────────────────────────────────────────────────────────────

  const selEl = selectedId ? layout.elements.find(e => e.id === selectedId) ?? null : null;
  const snapGuides = drag && selEl ? (() => {
    const el = selEl;
    const xs = [el.x, el.x + el.w / 2, el.x + el.w];
    const ys = [el.y, el.y + el.h / 2, el.y + el.h];
    const pts = [0, 50, 100]; const thr = 2;
    return {
      v: pts.filter(v => xs.some(x => Math.abs(x - v) < thr)),
      h: pts.filter(v => ys.some(y => Math.abs(y - v) < thr)),
    };
  })() : { v: [] as number[], h: [] as number[] };

  // ── Warnings ──────────────────────────────────────────────────────────────────

  const hasCarousel = layout.elements.some(e => e.type === 'carousel' && e.visible !== false);
  const warnings: string[] = [];
  if (!hasCarousel) warnings.push('Нет элемента «Карусель» — слайды не будут показаны');

  // ── Render ────────────────────────────────────────────────────────────────────

  const layersTopFirst = [...layout.elements].sort((a, b) => b.z - a.z);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', fontFamily: 'Manrope,system-ui,sans-serif' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '8px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Редактор экрана ТВ</span>
        <button style={BTN} onClick={undo} disabled={!history.length} title="Ctrl+Z">↩</button>
        <button style={BTN} onClick={redo} disabled={!future.length} title="Ctrl+Y">↪</button>
        <button style={{ ...BTN, color: tvMode ? '#02BDB6' : '#94a3b8', borderColor: tvMode ? '#02BDB6' : '#334155' }}
          onClick={() => setTvMode(m => !m)} title="Режим просмотра ТВ">TV</button>
        <button style={{ ...BTN, color: '#fbbf24', borderColor: '#78350f' }}
          onClick={() => { pushHistory(); setLayout(defaultScreenLayout()); }}>Сброс</button>
        <button style={{ ...BTN, background: '#02BDB6', color: '#fff', border: 'none' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button style={{ ...BTN, marginLeft: 4 }} onClick={onClose}>✕</button>
      </div>

      {error && <div style={{ padding: '6px 16px', background: '#7f1d1d', color: '#fca5a5', fontSize: 12, flexShrink: 0 }}>{error}</div>}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left panel */}
        <div style={{ width: 220, flexShrink: 0, background: '#0f172a', borderRight: '1px solid #1e293b', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Add buttons */}
          <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em' }}>Добавить</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '0 8px 8px' }}>
            {(['text','value','mission','datetime','image','shape','carousel'] as ScreenElType[]).map(t => (
              <button key={t} style={{ ...BTN, padding: '5px 6px', fontSize: 11, textAlign: 'left' }} onClick={() => addEl(t)}>
                + {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #1e293b', padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em' }}>Слои</div>

          {layersTopFirst.map(el => (
            <div
              key={el.id}
              draggable
              onDragStart={() => setLayerDragId(el.id)}
              onDragOver={e => { e.preventDefault(); setLayerOverId(el.id); }}
              onDrop={() => onLayerDrop(el.id)}
              onDragEnd={() => { setLayerDragId(null); setLayerOverId(null); }}
              style={{
                padding: '7px 8px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                background: selectedId === el.id ? 'rgba(2,189,182,.18)' : layerOverId === el.id ? 'rgba(2,189,182,.08)' : 'transparent',
                color: selectedId === el.id ? '#02BDB6' : '#94a3b8',
                borderLeft: selectedId === el.id ? '2px solid #02BDB6' : '2px solid transparent',
                fontWeight: selectedId === el.id ? 700 : 400,
                opacity: el.visible === false ? 0.5 : 1,
              }}
              onClick={() => setSelectedId(el.id)}
            >
              {/* Eye icon */}
              <span
                style={{ cursor: 'pointer', opacity: el.visible === false ? 0.4 : 1, fontSize: 11 }}
                title={el.visible === false ? 'Показать' : 'Скрыть'}
                onClick={e => { e.stopPropagation(); updateEl(el.id, { visible: el.visible === false ? true : false }); }}
              >👁</span>
              {/* Lock icon */}
              <span
                style={{ cursor: 'pointer', fontSize: 11, opacity: el.locked ? 1 : 0.3 }}
                title={el.locked ? 'Разблокировать' : 'Заблокировать'}
                onClick={e => { e.stopPropagation(); updateEl(el.id, { locked: !el.locked }); }}
              >🔒</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {TYPE_LABELS[el.type]}
                {'text' in el && el.text ? ` «${(el.text as string).slice(0, 10)}»` : ''}
                {'bind' in el ? ` (${BIND_LABELS[el.bind as keyof typeof BIND_LABELS]})` : ''}
              </span>
              <span style={{ color: '#475569', fontSize: 10 }}>⠿</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
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
              borderRadius: 8, overflow: 'hidden',
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

            {/* TV render */}
            <TvScreen
              layout={layout}
              values={MOCK_VALUES}
              mission={missionText}
              carousel={
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(38,60,217,.12)', borderRadius: 'clamp(14px,1.8vw,28px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#263CD9', fontSize: 'clamp(10px,1.4vw,20px)', fontWeight: 700, opacity: .6 }}>Карусель слайдов</span>
                </div>
              }
              datetime={now}
            />

            {/* Drag overlays (hidden in TV mode) */}
            {!tvMode && layout.elements.map(el => {
              const isSel = selectedId === el.id;
              return (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: `${el.x}%`, top: `${el.y}%`,
                    width: `${el.w}%`, height: `${el.h}%`,
                    zIndex: 500 + el.z,
                    boxSizing: 'border-box',
                    border: isSel ? '1.5px solid #02BDB6' : '1px dashed rgba(2,189,182,.25)',
                    cursor: el.locked ? 'not-allowed' : (drag?.mode === 'move' && drag.id === el.id ? 'grabbing' : 'move'),
                    touchAction: 'none',
                  }}
                  onPointerDown={e => { startDrag(e, el.id, 'move'); setSelectedId(el.id); }}
                  onClick={() => setSelectedId(el.id)}
                >
                  {isSel && (
                    <>
                      {/* Rotation handle */}
                      <div
                        style={{ position: 'absolute', top: -26, left: '50%', transform: 'translateX(-50%)', width: 16, height: 16, background: '#fbbf24', borderRadius: '50%', border: '2px solid #fff', zIndex: 11, cursor: 'alias', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}
                        onPointerDown={e => { e.stopPropagation(); startDrag(e, el.id, 'rotate'); }}
                      >↻</div>
                      {/* Rotation line */}
                      <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', width: 1, height: 14, background: '#fbbf24', opacity: 0.6 }} />
                      {/* 8 handles */}
                      {(['nw','ne','sw','se','n','s','e','w'] as HandlePos[]).map(pos => (
                        <Handle key={pos} pos={pos} onDown={(e, m) => startDrag(e, el.id, m)} />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Snap guides */}
            {!tvMode && snapGuides.v.map(v => (
              <div key={`v${v}`} style={{ position: 'absolute', left: `${v}%`, top: 0, bottom: 0, width: 1, background: '#02BDB6', opacity: 0.7, zIndex: 600, pointerEvents: 'none' }} />
            ))}
            {!tvMode && snapGuides.h.map(v => (
              <div key={`h${v}`} style={{ position: 'absolute', top: `${v}%`, left: 0, right: 0, height: 1, background: '#02BDB6', opacity: 0.7, zIndex: 600, pointerEvents: 'none' }} />
            ))}
          </div>
        </div>

        {/* Right: properties */}
        <div style={{ width: 280, flexShrink: 0, background: '#0f172a', borderLeft: '1px solid #1e293b', overflow: 'auto', padding: 14 }}>
          {selEl ? (
            <>
              <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                {TYPE_LABELS[selEl.type]}
              </div>

              {/* Common: position/size/rotate/z */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                {(['x','y','w','h'] as const).map(k => (
                  <div key={k}>
                    <label style={LBL}>{k === 'x' ? 'X%' : k === 'y' ? 'Y%' : k === 'w' ? 'W%' : 'H%'}</label>
                    <input type="number" step="0.5" min={k === 'w' || k === 'h' ? 2 : 0} max={100} value={selEl[k]} style={INP}
                      onChange={e => updateEl(selEl.id, { [k]: snap(Number(e.target.value)) })} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div>
                  <label style={LBL}>Поворот°</label>
                  <input type="number" step="1" min={-180} max={180} value={selEl.rotate ?? 0} style={INP}
                    onChange={e => updateEl(selEl.id, { rotate: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={LBL}>Z-слой</label>
                  <input type="number" min={0} max={500} step={1} value={selEl.z} style={INP}
                    onChange={e => updateEl(selEl.id, { z: Math.round(Number(e.target.value)) })} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #1e293b', margin: '10px 0' }} />

              {/* Text types */}
              {selEl.type === 'text' && (
                <>
                  <div style={ROW}>
                    <label style={LBL}>Текст</label>
                    <textarea value={selEl.text} rows={3} style={{ ...INP, resize: 'vertical' }}
                      onChange={e => updateEl(selEl.id, { text: e.target.value })} />
                  </div>
                  <TextStyleProps el={selEl as unknown as Record<string, unknown>} onChange={u => updateEl(selEl.id, u)} />
                </>
              )}
              {selEl.type === 'value' && (
                <>
                  <div style={ROW}>
                    <label style={LBL}>Счётчик</label>
                    <select value={selEl.bind} style={INP} onChange={e => updateEl(selEl.id, { bind: e.target.value })}>
                      {Object.entries(BIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <TextStyleProps el={selEl as unknown as Record<string, unknown>} onChange={u => updateEl(selEl.id, u)} />
                </>
              )}
              {selEl.type === 'mission' && (
                <>
                  <div style={ROW}>
                    <label style={LBL}>Текст миссии</label>
                    <textarea value={missionText} rows={3} style={{ ...INP, resize: 'vertical' }}
                      onChange={e => setMission(e.target.value)} />
                  </div>
                  <TextStyleProps el={selEl as unknown as Record<string, unknown>} onChange={u => updateEl(selEl.id, u)} />
                </>
              )}
              {selEl.type === 'datetime' && (
                <TextStyleProps el={selEl as unknown as Record<string, unknown>} onChange={u => updateEl(selEl.id, u)} />
              )}
              {selEl.type === 'image' && (
                <ImageProps
                  el={selEl}
                  onChange={u => updateEl(selEl.id, u as Record<string, unknown>)}
                  uploadError={uploadError}
                  onUpload={f => uploadImage(selEl.id, f)}
                />
              )}
              {selEl.type === 'shape' && (
                <ShapeProps el={selEl} onChange={u => updateEl(selEl.id, u as Record<string, unknown>)} />
              )}
              {selEl.type === 'carousel' && (
                <>
                  <div style={ROW}>
                    <label style={LBL}>Радиус (%h, 0–10)</label>
                    <input type="number" step="0.5" min={0} max={10} value={selEl.radius ?? 0} style={INP}
                      onChange={e => updateEl(selEl.id, { radius: Number(e.target.value) })} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                    <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!selEl.frame} onChange={e => updateEl(selEl.id, { frame: e.target.checked })} /> Рамка-градиент
                    </label>
                    <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!selEl.shadow} onChange={e => updateEl(selEl.id, { shadow: e.target.checked || undefined })} /> Тень
                    </label>
                  </div>
                </>
              )}

              <div style={{ borderTop: '1px solid #1e293b', marginTop: 10, paddingTop: 10 }}>
                <button style={{ ...BTN, color: '#f87171', borderColor: '#7f1d1d', width: '100%' }}
                  onClick={() => deleteEl(selEl.id)}>Удалить элемент</button>
              </div>
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
              Выберите элемент<br />в дереве или на экране
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      {warnings.length > 0 && (
        <div style={{ flexShrink: 0, padding: '6px 16px', background: '#422006', borderTop: '1px solid #78350f', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {warnings.map((w, i) => (
            <span key={i} style={{ fontSize: 12, color: '#fbbf24' }}>⚠ {w}</span>
          ))}
        </div>
      )}
    </div>
  );
}
