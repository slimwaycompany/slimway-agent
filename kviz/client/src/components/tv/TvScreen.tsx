import { useEffect, useRef, useState, type ReactNode } from 'react';
import smIcon  from '../../assets/tv/sm.png';
import kgIcon  from '../../assets/tv/kg.png';
import fatIcon from '../../assets/tv/fat.png';
import logoImg from '../../assets/tv/logo.png';
import TextBox from './TextBox';
import type { ElFx, ScreenEl, ScreenElImage, ScreenElShape, ScreenLayout } from '../../lib/tvScreenLayout';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ASSET_SRC: Record<string, string> = {
  logo: logoImg, icon_cm: smIcon, icon_kg: kgIcon, icon_fat: fatIcon,
};

export function hexA(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function shadowColor(color: ElFx['shadow'] extends undefined ? never : NonNullable<ElFx['shadow']>['color'], blur: number, offsetY: number, opacity: number): string {
  const alpha = opacity / 100;
  const c = color === 'teal' ? `rgba(2,189,182,${alpha})` : color === 'blue' ? `rgba(38,60,217,${alpha})` : `rgba(0,0,0,${alpha})`;
  return `0 ${offsetY}px ${blur}px ${c}`;
}

function floatStyle(fx: ElFx | undefined, idx: number, quality: string): React.CSSProperties {
  if (!fx?.float?.on || quality === 'eco') return {};
  const { amp, period_sec } = fx.float;
  const delay = -((idx * 0.7) % period_sec);
  return {
    '--float-amp': `calc(var(--screen-h,400px) * ${amp} / 100)`,
    '--float-period': `${period_sec}s`,
    animationDelay: `${delay}s`,
  } as React.CSSProperties;
}

// ── ShapeBox ──────────────────────────────────────────────────────────────────

export function ShapeBox({ el, fx, idx = 0, quality = 'high' }: { el: ScreenElShape; fx?: ElFx; idx?: number; quality?: string }) {
  const r = el.radius ?? 0;
  const borderRadius: React.CSSProperties['borderRadius'] = ({
    rect:    '0',
    rounded: `calc(var(--screen-h,400px) * ${r} / 100)`,
    circle:  '50%',
    ellipse: '50%',
    pill:    '999px',
  } as Record<string, string>)[el.shape];

  let background: string | undefined;
  if (el.fill?.type === 'solid') {
    background = hexA(el.fill.color, el.fill.opacity);
  } else if (el.fill?.type === 'gradient') {
    const { from, to, angle, opacity } = el.fill;
    background = `linear-gradient(${angle}deg, ${hexA(from, opacity)}, ${hexA(to, opacity)})`;
  }

  const border = el.border
    ? `calc(var(--screen-h,400px) * ${el.border.width} / 100) solid ${hexA(el.border.color, el.border.opacity)}`
    : undefined;

  const shadow = fx?.shadow?.on ? shadowColor(fx.shadow.color, fx.shadow.blur, fx.shadow.offsetY, fx.shadow.opacity) :
    el.shadow ? '0 12px 48px rgba(38,60,217,.13)' : undefined;

  const glassOn = fx?.glass?.on;
  const backdropFilter = glassOn
    ? (quality !== 'eco' ? `blur(16px) saturate(1.4)` : undefined)
    : (el.blur ? (quality !== 'eco' ? 'blur(22px)' : undefined) : undefined);
  const glassBg = glassOn ? `rgba(255,255,255,${(fx!.glass!.opacity) / 100})` : background;

  const elFxBlur = fx?.blur && quality !== 'eco' ? `blur(${fx.blur}px)` : undefined;

  const fStyle = { ...floatStyle(fx, idx, quality) };
  const isFloat = fx?.float?.on && quality !== 'eco';

  const inner = (
    <div style={{
      width: '100%', height: '100%', borderRadius,
      background: glassBg ?? background, border,
      boxShadow: shadow,
      backdropFilter,
      filter: elFxBlur,
      boxSizing: 'border-box',
    }} />
  );

  if (!isFloat) return inner;
  return (
    <div className="tv-el-float" style={{ width: '100%', height: '100%', ...fStyle }}>
      {inner}
    </div>
  );
}

// ── ImageEl ───────────────────────────────────────────────────────────────────

export function ImageEl({ el, mediaUrl, fx, idx = 0, quality = 'high' }: { el: ScreenElImage; mediaUrl?: (p: string) => string; fx?: ElFx; idx?: number; quality?: string }) {
  const src = el.asset ? ASSET_SRC[el.asset] : (el.path && mediaUrl ? mediaUrl(el.path) : undefined);
  if (!src) return null;
  const objFit: React.CSSProperties['objectFit'] = el.fit === 'stretch' ? 'fill' : (el.fit ?? 'contain');
  const radius = el.radius ? `calc(var(--screen-h,400px) * ${el.radius} / 100)` : undefined;

  const shadow = fx?.shadow?.on ? shadowColor(fx.shadow.color, fx.shadow.blur, fx.shadow.offsetY, fx.shadow.opacity) : undefined;
  const elFxBlur = fx?.blur && quality !== 'eco' ? `blur(${fx.blur}px)` : undefined;
  const isFloat = fx?.float?.on && quality !== 'eco';
  const fStyle = floatStyle(fx, idx, quality);

  const img = (
    <img src={src} alt="" style={{
      width: '100%', height: '100%', objectFit: objFit,
      opacity: el.opacity, borderRadius: radius,
      boxShadow: shadow,
      filter: elFxBlur,
      display: 'block',
    }} onError={e => { e.currentTarget.style.display = 'none'; }} />
  );

  if (!isFloat) return img;
  return (
    <div className="tv-el-float" style={{ width: '100%', height: '100%', ...fStyle }}>
      {img}
    </div>
  );
}

// ── TvScreen ─────────────────────────────────────────────────────────────────

export interface TvScreenProps {
  layout: ScreenLayout;
  values: { value_cm: number; value_kg: number; value_fat: number };
  mission: string;
  carousel: ReactNode;
  datetime: string;
  mediaUrl?: (path: string) => string;
  selectedId?: string | null;
  onElementClick?: (id: string) => void;
  /** Flash keys for each counter value — bump to trigger flash animation */
  flashKeys?: [number, number, number];
  quality?: string;
  /** Sheen period in seconds (0 = disabled) */
  sheenPeriod?: number;
}

const VALUE_BINDS = ['value_cm', 'value_kg', 'value_fat'] as const;

export default function TvScreen({
  layout, values, mission, carousel, datetime,
  mediaUrl, selectedId, onElementClick,
  flashKeys = [0, 0, 0], quality = 'high', sheenPeriod = 0,
}: TvScreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [screenH, setScreenH] = useState(0);
  const [flashClasses, setFlashClasses] = useState(['', '', '']);
  const prevFlashKeys = useRef([0, 0, 0]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScreenH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Counter flash: when flashKeys changes, add class then remove after 0.8s
  useEffect(() => {
    const newClasses = flashKeys.map((k, i) => {
      if (k !== prevFlashKeys.current[i]) return 'tv-counter-num--flash';
      return '';
    });
    if (newClasses.some(c => c)) {
      prevFlashKeys.current = [...flashKeys];
      setFlashClasses(newClasses);
      const id = setTimeout(() => setFlashClasses(['', '', '']), 900);
      return () => clearTimeout(id);
    }
  }, [flashKeys]);

  const style = { '--screen-h': `${screenH || 400}px` } as React.CSSProperties;
  const isEditor = !!onElementClick;
  const sorted = [...layout.elements]
    .filter(el => isEditor || el.visible !== false)
    .sort((a, b) => a.z - b.z);

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, ...style }}>
      {sorted.map((el, idx) => {
        const hidden = el.visible === false;
        const rotate = el.rotate ?? 0;
        const elFx = el.fx;
        const wrapStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${el.x}%`, top: `${el.y}%`,
          width: `${el.w}%`, height: `${el.h}%`,
          zIndex: el.z,
          transform: rotate ? `rotate(${rotate}deg)` : undefined,
          transformOrigin: 'center center',
          overflow: el.type === 'text' ? undefined : 'hidden',
          opacity: isEditor && hidden ? 0.25 : undefined,
          ...(onElementClick ? {
            outline: selectedId === el.id ? '2px solid #02BDB6' : undefined,
            cursor: 'pointer',
          } : {}),
        };

        let content: ReactNode;
        switch (el.type) {
          case 'text': {
            const tshadow = elFx?.textShadow ? '0 2px 8px rgba(0,0,0,.35)' : undefined;
            const fStyle = elFx?.float?.on && quality !== 'eco' ? floatStyle(elFx, idx, quality) : {};
            const isFloat = elFx?.float?.on && quality !== 'eco';
            const inner = <TextBox style={el} text={el.text} extraStyle={tshadow ? { textShadow: tshadow } : undefined} />;
            content = isFloat ? <div className="tv-el-float" style={{ width: '100%', height: '100%', ...fStyle }}>{inner}</div> : inner;
            break;
          }
          case 'value': {
            const bindIdx = VALUE_BINDS.indexOf(el.bind as typeof VALUE_BINDS[number]);
            const v = values[el.bind as keyof typeof values] ?? 0;
            const flashCls = bindIdx >= 0 ? flashClasses[bindIdx] : '';
            const tshadow = elFx?.textShadow ? '0 2px 8px rgba(0,0,0,.35)' : undefined;
            content = <TextBox style={el} text={String(Math.round(v))} flashClass={flashCls} extraStyle={tshadow ? { textShadow: tshadow } : undefined} />;
            break;
          }
          case 'mission':
            content = <TextBox style={el} text={mission} />;
            break;
          case 'datetime':
            content = <TextBox style={el} text={datetime} />;
            break;
          case 'image':
            content = <ImageEl el={el} mediaUrl={mediaUrl} fx={elFx} idx={idx} quality={quality} />;
            break;
          case 'shape':
            content = <ShapeBox el={el} fx={elFx} idx={idx} quality={quality} />;
            break;
          case 'carousel':
            content = (
              <div style={{
                position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
                borderRadius: el.radius ? `calc(var(--screen-h,400px) * ${el.radius} / 100)` : undefined,
              }}>
                {carousel}
              </div>
            );
            break;
          default:
            content = null;
        }

        return (
          <div key={el.id} style={wrapStyle} onClick={onElementClick ? () => onElementClick(el.id) : undefined}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
