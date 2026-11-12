import type { FreeEl } from './FreeSlide';

interface Props {
  el: FreeEl;
  overflowing?: boolean;
  preview?: boolean;
  onRef?: (r: HTMLDivElement | null) => void;
}

// Renders text inside a positioned wrapper. Does NOT set overflow:hidden so
// scaleX/scaleY transform is not clipped by its own container.
// Parent wrapper is responsible for overflow clipping.
export default function TextBox({ el, overflowing, preview, onRef }: Props) {
  const origin =
    el.align === 'right' ? 'right center' :
    el.align === 'center' ? 'center center' : 'left center';

  return (
    <div
      ref={onRef}
      style={{
        position: 'relative',
        width: '100%', height: '100%',
        fontFamily: `'${el.font || 'Manrope'}', sans-serif`,
        fontSize: `calc(var(--screen-h, 400px) * ${el.size ?? 10} / 100)`,
        fontWeight: el.weight ?? 400,
        color: el.color ?? '#000000',
        textAlign: (el.align ?? 'left') as React.CSSProperties['textAlign'],
        transform: `scale(${el.scaleX ?? 1}, ${el.scaleY ?? 1})`,
        transformOrigin: origin,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.2,
        outline: preview && overflowing ? '2px solid #ef4444' : undefined,
      }}
    >
      {el.text}
      {preview && overflowing && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(239,68,68,0.9)', color: '#fff',
          fontSize: 10, padding: '2px 4px', textAlign: 'center', pointerEvents: 'none',
        }}>
          Не помещается, уменьшите размер
        </div>
      )}
    </div>
  );
}
