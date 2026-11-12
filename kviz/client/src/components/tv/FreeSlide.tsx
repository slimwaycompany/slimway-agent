import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TextBox from './TextBox';
import ImageBox from './ImageBox';

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
  const prevOverflowKey = useRef('');
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

  useLayoutEffect(() => {
    if (!preview || !dim.h) return;
    const ovSet = new Set<string>();
    for (const [id, el] of Object.entries(textRefs.current)) {
      if (el && el.scrollHeight > el.clientHeight + 1) ovSet.add(id);
    }
    const key = [...ovSet].sort().join(',');
    if (key !== prevOverflowKey.current) {
      prevOverflowKey.current = key;
      setOverflows(ovSet);
    }
  }, [layout, dim.h, preview]);

  const sorted = [...layout.elements].sort((a, b) => a.z - b.z);

  // Set --screen-h so TextBox can compute font-size via CSS calc
  const screenStyle = {
    position: 'absolute' as const, inset: 0, overflow: 'hidden',
    '--screen-h': `${dim.h || 400}px`,
  } as React.CSSProperties;

  return (
    <div ref={containerRef} style={screenStyle}>
      {sorted.map(el => {
        const wrapStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${el.x}%`, top: `${el.y}%`,
          width: `${el.w}%`, height: `${el.h}%`,
          zIndex: el.z,
          overflow: 'hidden', // clipping handled by wrapper, not by TextBox
        };

        if (el.type === 'text') {
          const isOver = overflows.has(el.id);
          return (
            <div key={el.id} style={wrapStyle}>
              <TextBox
                el={el}
                overflowing={isOver}
                preview={preview}
                onRef={r => { textRefs.current[el.id] = r; }}
              />
            </div>
          );
        }

        if (el.type === 'image' && el.path) {
          return (
            <div key={el.id} style={wrapStyle}>
              <ImageBox el={el as FreeEl & { type: 'image' }} mediaUrl={mediaUrl} />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
