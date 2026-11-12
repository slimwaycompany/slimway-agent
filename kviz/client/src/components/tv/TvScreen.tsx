import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import smIcon  from '../../assets/tv/sm.png';
import kgIcon  from '../../assets/tv/kg.png';
import fatIcon from '../../assets/tv/fat.png';
import logoImg from '../../assets/tv/logo.png';
import type { ScreenLayout, ScreenEl, ScreenElKind } from '../../lib/tvScreenLayout';

// ── Counter block ────────────────────────────────────────────────────────────

interface CounterBlockProps { icon: string; value: number; unit: string; label: string }

function CounterBlock({ icon, value, unit, label }: CounterBlockProps) {
  const blockRef = useRef<HTMLDivElement>(null);
  const iconRef  = useRef<HTMLImageElement>(null);
  const [fs, setFs] = useState(50);

  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    const compute = () => {
      const { width, height } = block.getBoundingClientRect();
      if (!height || !width) return;
      const iconW = iconRef.current ? iconRef.current.offsetWidth : height * 0.55;
      const digits = Math.max(1, String(Math.round(value)).length);
      const avail = width - iconW - 16;
      const byH = height * 0.55;
      const byW = avail / (digits * 0.48);
      setFs(Math.max(20, Math.floor(Math.min(byH, byW))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(block);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div ref={blockRef} className="tv-counter-block">
      <img ref={iconRef} src={icon} className="tv-counter-icon" alt=""
        onError={e => { e.currentTarget.style.display = 'none'; }} />
      <div className="tv-counter-data">
        <div className="tv-counter-numrow">
          <span className="tv-counter-num" style={{ fontSize: fs }}>{Math.round(value)}</span>
          <span className="tv-counter-unit">{unit}</span>
        </div>
        <div className="tv-counter-label">{label}</div>
      </div>
    </div>
  );
}

const COUNTER_ICONS: Record<string, string> = {
  counter_cm: smIcon, counter_kg: kgIcon, counter_fat: fatIcon,
};
const COUNTER_DEFAULTS: Record<string, { label: string; unit: string }> = {
  counter_cm:  { label: 'Сантиметров убрали',   unit: 'см' },
  counter_kg:  { label: 'Килограммов сбросили',  unit: 'кг' },
  counter_fat: { label: 'Жира сожгли',           unit: 'кг' },
};

// ── Render helpers ──────────────────────────────────────────────────────────

interface RenderCtx {
  counterValues: Record<string, number>;
  carousel: ReactNode;
  datetime: string;
}

function renderEl(el: ScreenEl, ctx: RenderCtx): ReactNode {
  const { kind } = el;

  if (kind === 'logo') {
    return (
      <img src={logoImg} alt="SlimWay"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={e => { e.currentTarget.style.display = 'none'; }} />
    );
  }

  if (kind === 'panel') {
    return (
      <div style={{
        width: '100%', height: '100%',
        borderRadius: 'clamp(14px,1.8vw,28px)',
        border: '1.5px solid rgba(255,255,255,.85)',
        background: 'rgba(255,255,255,.58)',
        boxShadow: '0 12px 48px rgba(38,60,217,.13)',
        backdropFilter: 'blur(22px)',
      }} />
    );
  }

  if (kind === 'intro' || kind === 'mission') {
    const justify =
      el.align === 'right' ? 'flex-end' :
      el.align === 'left'  ? 'flex-start' : 'center';
    return (
      <div style={{
        width: '100%', height: '100%',
        fontFamily: `'${el.font || 'Manrope'}', sans-serif`,
        fontSize: `calc(var(--screen-h, 400px) * ${el.size ?? 1.6} / 100)`,
        fontWeight: el.weight ?? 600,
        color: el.color ?? '#263CD9',
        textAlign: (el.align ?? 'center') as React.CSSProperties['textAlign'],
        display: 'flex', alignItems: 'center', justifyContent: justify,
        wordBreak: 'break-word',
      }}>
        {el.text || ''}
      </div>
    );
  }

  if (kind === 'datetime') {
    const justify = el.align === 'left' ? 'flex-start' : el.align === 'center' ? 'center' : 'flex-end';
    return (
      <div style={{
        width: '100%', height: '100%',
        fontFamily: `'${el.font || 'Manrope'}', sans-serif`,
        fontSize: `calc(var(--screen-h, 400px) * ${el.size ?? 1.3} / 100)`,
        fontWeight: el.weight ?? 600,
        color: el.color ?? '#000000',
        display: 'flex', alignItems: 'center', justifyContent: justify,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {ctx.datetime}
      </div>
    );
  }

  if (kind === 'counter_cm' || kind === 'counter_kg' || kind === 'counter_fat') {
    const def = COUNTER_DEFAULTS[kind];
    return (
      <CounterBlock
        icon={COUNTER_ICONS[kind]}
        value={ctx.counterValues[kind] ?? 0}
        unit={el.unit || def.unit}
        label={el.label || def.label}
      />
    );
  }

  if (kind === 'carousel') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        {ctx.carousel}
      </div>
    );
  }

  return null;
}

// ── TvScreen ─────────────────────────────────────────────────────────────────

export interface TvScreenProps {
  layout: ScreenLayout;
  counters: { cm: number; kg: number; fat: number };
  carousel: ReactNode;
  datetime: string;
  // Editor props: overlay click handler (kind of element clicked)
  onElementClick?: (kind: ScreenElKind) => void;
  selectedKind?: ScreenElKind | null;
}

export default function TvScreen({ layout, counters, carousel, datetime, onElementClick, selectedKind }: TvScreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [screenH, setScreenH] = useState(0);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScreenH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style = { '--screen-h': `${screenH || 400}px` } as React.CSSProperties;
  const counterValues = {
    counter_cm: counters.cm, counter_kg: counters.kg, counter_fat: counters.fat,
  };
  const ctx: RenderCtx = { counterValues, carousel, datetime };
  const sorted = [...layout.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, ...style }}>
      {sorted.map(el => (
        <div
          key={el.kind}
          style={{
            position: 'absolute',
            left: `${el.x}%`, top: `${el.y}%`,
            width: `${el.w}%`, height: `${el.h}%`,
            zIndex: el.z ?? 0,
            overflow: 'hidden',
            ...(onElementClick ? {
              outline: selectedKind === el.kind ? '2px solid #02BDB6' : undefined,
              cursor: 'pointer',
            } : {}),
          }}
          onClick={onElementClick ? () => onElementClick(el.kind) : undefined}
        >
          {renderEl(el, ctx)}
        </div>
      ))}
    </div>
  );
}
