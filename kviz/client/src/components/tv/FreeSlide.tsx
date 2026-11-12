import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface FreeEl {
  id: string;
  type: 'text' | 'image';
  x: number; y: number; w: number; h: number; z: number;
  // text-only
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: string;
  scaleX?: number;
  scaleY?: number;
  // image-only
  path?: string;
  fit?: 'cover' | 'contain' | 'stretch';
}

export interface FreeLayout {
  frame: boolean;
  elements: FreeEl[];
}

interface Props {
  layout: FreeLayout;
  mediaUrl: (path: string) => string;
  preview?: boolean; // show overflow hints in editor preview
}

export default function FreeSlide({ layout, mediaUrl, preview }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [overflows, setOverflows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDim({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Check text overflow after every render (only in preview mode)
  useLayoutEffect(() => {
    if (!preview || !dim.h) return;
    const ovSet = new Set<string>();
    for (const [id, el] of Object.entries(textRefs.current)) {
      if (el && el.scrollHeight > el.clientHeight + 1) ovSet.add(id);
    }
    setOverflows(ovSet);
  });

  const sorted = [...layout.elements].sort((a, b) => a.z - b.z);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {sorted.map(el => {
        const base: React.CSSProperties = {
          position: 'absolute',
          left: `${el.x}%`,
          top: `${el.y}%`,
          width: `${el.w}%`,
          height: `${el.h}%`,
          zIndex: el.z,
          overflow: 'hidden',
        };

        if (el.type === 'text') {
          const pxSize = dim.h > 0 ? dim.h * (el.size ?? 10) / 100 : 16;
          const origin =
            el.align === 'right' ? 'right center' :
            el.align === 'center' ? 'center center' : 'left center';
          const isOver = overflows.has(el.id);
          return (
            <div
              key={el.id}
              ref={r => { textRefs.current[el.id] = r; }}
              style={{
                ...base,
                fontFamily: `'${el.font || 'Manrope'}', sans-serif`,
                fontSize: pxSize,
                fontWeight: el.weight ?? 400,
                color: el.color ?? '#000000',
                textAlign: (el.align ?? 'left') as React.CSSProperties['textAlign'],
                transform: `scale(${el.scaleX ?? 1}, ${el.scaleY ?? 1})`,
                transformOrigin: origin,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.2,
                outline: preview && isOver ? '2px solid #ef4444' : undefined,
              }}
            >
              {el.text}
              {preview && isOver && (
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

        if (el.type === 'image' && el.path) {
          const objFit: React.CSSProperties['objectFit'] =
            el.fit === 'stretch' ? 'fill' : (el.fit ?? 'cover');
          return (
            <div key={el.id} style={base}>
              <img
                src={mediaUrl(el.path)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: objFit, display: 'block' }}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
