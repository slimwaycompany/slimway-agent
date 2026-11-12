import { useEffect, useRef, useState, type ReactNode } from 'react';
import smIcon  from '../../assets/tv/sm.png';
import kgIcon  from '../../assets/tv/kg.png';
import fatIcon from '../../assets/tv/fat.png';
import logoImg from '../../assets/tv/logo.png';
import TextBox from './TextBox';
import type { ScreenEl, ScreenElImage, ScreenElShape, ScreenLayout } from '../../lib/tvScreenLayout';

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

// ── ShapeBox ──────────────────────────────────────────────────────────────────

export function ShapeBox({ el }: { el: ScreenElShape }) {
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

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius, background, border,
      boxShadow:      el.shadow ? '0 12px 48px rgba(38,60,217,.13)' : undefined,
      backdropFilter: el.blur   ? 'blur(22px)' : undefined,
      boxSizing:      'border-box',
    }} />
  );
}

// ── ImageEl ───────────────────────────────────────────────────────────────────

export function ImageEl({ el, mediaUrl }: { el: ScreenElImage; mediaUrl?: (p: string) => string }) {
  const src = el.asset ? ASSET_SRC[el.asset] : (el.path && mediaUrl ? mediaUrl(el.path) : undefined);
  if (!src) return null;
  const objFit: React.CSSProperties['objectFit'] = el.fit === 'stretch' ? 'fill' : (el.fit ?? 'contain');
  const radius = el.radius ? `calc(var(--screen-h,400px) * ${el.radius} / 100)` : undefined;
  return (
    <img src={src} alt="" style={{
      width: '100%', height: '100%', objectFit: objFit,
      opacity: el.opacity, borderRadius: radius, display: 'block',
    }} onError={e => { e.currentTarget.style.display = 'none'; }} />
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
}

export default function TvScreen({
  layout, values, mission, carousel, datetime,
  mediaUrl, selectedId, onElementClick,
}: TvScreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [screenH, setScreenH] = useState(0);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScreenH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style = { '--screen-h': `${screenH || 400}px` } as React.CSSProperties;
  const isEditor = !!onElementClick;
  const sorted = [...layout.elements]
    .filter(el => isEditor || el.visible !== false)
    .sort((a, b) => a.z - b.z);

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, ...style }}>
      {sorted.map(el => {
        const hidden = el.visible === false;
        const rotate = el.rotate ?? 0;
        const wrapStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${el.x}%`, top: `${el.y}%`,
          width: `${el.w}%`, height: `${el.h}%`,
          zIndex: el.z,
          transform: rotate ? `rotate(${rotate}deg)` : undefined,
          transformOrigin: 'center center',
          opacity: isEditor && hidden ? 0.25 : undefined,
          ...(onElementClick ? {
            outline: selectedId === el.id ? '2px solid #02BDB6' : undefined,
            cursor: 'pointer',
          } : {}),
        };

        let content: ReactNode;
        switch (el.type) {
          case 'text':
            content = <TextBox style={el} text={el.text} />;
            break;
          case 'value': {
            const v = values[el.bind] ?? 0;
            content = <TextBox style={el} text={String(Math.round(v))} />;
            break;
          }
          case 'mission':
            content = <TextBox style={el} text={mission} />;
            break;
          case 'datetime':
            content = <TextBox style={el} text={datetime} />;
            break;
          case 'image':
            content = <ImageEl el={el} mediaUrl={mediaUrl} />;
            break;
          case 'shape':
            content = <ShapeBox el={el} />;
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
