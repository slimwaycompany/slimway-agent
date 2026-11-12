import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TextBox from './TextBox';
import { ShapeBox, ImageEl } from './TvScreen';
import { migrateFreeLayoutToV2 } from '../../lib/tvScreenLayout';
import type { FreeLayout, ScreenElText, ScreenElImage, ScreenElShape } from '../../lib/tvScreenLayout';

export type { FreeLayout };

interface Props {
  layout: FreeLayout | unknown;
  mediaUrl: (path: string) => string;
  preview?: boolean;
}

export default function FreeSlide({ layout: rawLayout, mediaUrl, preview }: Props) {
  const layout = migrateFreeLayoutToV2(rawLayout);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevOverflowKey = useRef('');
  const [screenH, setScreenH] = useState(0);
  const [overflows, setOverflows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScreenH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!preview || !screenH) return;
    const ovSet = new Set<string>();
    for (const [id, el] of Object.entries(textRefs.current)) {
      if (el && el.scrollHeight > el.clientHeight + 1) ovSet.add(id);
    }
    const key = [...ovSet].sort().join(',');
    if (key !== prevOverflowKey.current) {
      prevOverflowKey.current = key;
      setOverflows(ovSet);
    }
  }, [layout, screenH, preview]);

  const sorted = [...layout.elements].sort((a, b) => a.z - b.z);
  const style = {
    position: 'absolute' as const, inset: 0, overflow: 'hidden',
    '--screen-h': `${screenH || 400}px`,
  } as React.CSSProperties;

  return (
    <div ref={containerRef} style={style}>
      {sorted.map(el => {
        const wrapStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${el.x}%`, top: `${el.y}%`,
          width: `${el.w}%`, height: `${el.h}%`,
          zIndex: el.z, overflow: 'hidden',
        };
        if (el.type === 'text') {
          const te = el as ScreenElText;
          return (
            <div key={el.id} style={wrapStyle}>
              <TextBox style={te} text={te.text} overflowing={overflows.has(el.id)} preview={preview}
                onRef={r => { textRefs.current[el.id] = r; }} />
            </div>
          );
        }
        if (el.type === 'image') {
          return (
            <div key={el.id} style={wrapStyle}>
              <ImageEl el={el as ScreenElImage} mediaUrl={mediaUrl} />
            </div>
          );
        }
        if (el.type === 'shape') {
          return (
            <div key={el.id} style={wrapStyle}>
              <ShapeBox el={el as ScreenElShape} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
