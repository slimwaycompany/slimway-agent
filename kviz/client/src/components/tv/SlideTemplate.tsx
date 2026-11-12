import { useEffect, useRef, useState } from 'react';
import { ShapeBox, ImageEl } from './TvScreen';
import TextBox from './TextBox';
import type { ScreenElImage, ScreenElShape, ScreenElText, TextStyle } from '../../lib/tvScreenLayout';
import type {
  SlideTemplate as SlideTemplateType, SlotChild, SlotChildImage, SlotChildShape, SlotChildText,
  TemplateTopEl, TplElSlotClient, TplElSlotImage, TplElSlotText,
} from '../../lib/tvScreenLayout';

export interface SlideTemplateData {
  result_a?: { id: string; title: string; before_path: string; after_path: string } | null;
  result_b?: { id: string; title: string; before_path: string; after_path: string } | null;
  image_path?: string | null;
  slide_text?: string | null;
}

interface Props {
  template: SlideTemplateType;
  data: SlideTemplateData;
  mediaUrl: (p: string) => string;
  sample?: boolean;
  selectedId?: string | null;
  selectedChildId?: string | null;
  onElementClick?: (id: string) => void;
  onChildClick?: (parentId: string, childId: string) => void;
}

export default function SlideTemplate({
  template, data, mediaUrl, sample,
  selectedId, selectedChildId, onElementClick, onChildClick,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [slideH, setSlideH] = useState(0);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSlideH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cssVars = { '--screen-h': `${slideH || 400}px` } as React.CSSProperties;
  const isEditor = !!onElementClick;
  const sorted = [...template.elements]
    .filter(el => isEditor || el.visible !== false)
    .sort((a, b) => a.z - b.z);

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, ...cssVars }}>
      {sorted.map(el => (
        <TopEl
          key={el.id}
          el={el}
          data={data}
          mediaUrl={mediaUrl}
          sample={sample}
          isEditor={isEditor}
          isSelected={selectedId === el.id}
          selectedChildId={selectedChildId}
          onElementClick={onElementClick}
          onChildClick={onChildClick}
        />
      ))}
    </div>
  );
}

function TopEl({
  el, data, mediaUrl, sample, isEditor, isSelected, selectedChildId, onElementClick, onChildClick,
}: {
  el: TemplateTopEl;
  data: SlideTemplateData;
  mediaUrl: (p: string) => string;
  sample?: boolean;
  isEditor: boolean;
  isSelected: boolean;
  selectedChildId?: string | null;
  onElementClick?: (id: string) => void;
  onChildClick?: (parentId: string, childId: string) => void;
}) {
  const hidden = el.visible === false;
  const wrap: React.CSSProperties = {
    position: 'absolute',
    left: `${el.x}%`, top: `${el.y}%`,
    width: `${el.w}%`, height: `${el.h}%`,
    zIndex: el.z,
    transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
    overflow: el.type === 'text' ? undefined : 'hidden',
    opacity: isEditor && hidden ? 0.25 : undefined,
    cursor: onElementClick ? 'pointer' : undefined,
    outline: isEditor && isSelected ? '2px solid #02BDB6' : undefined,
  };

  let content: React.ReactNode = null;
  if (el.type === 'text') {
    content = <TextBox style={el as ScreenElText} text={el.text} />;
  } else if (el.type === 'image') {
    content = <ImageEl el={el as ScreenElImage} mediaUrl={mediaUrl} />;
  } else if (el.type === 'shape') {
    content = <ShapeBox el={el as ScreenElShape} />;
  } else if (el.type === 'slot_client') {
    const client = el.index === 'a' ? (data.result_a ?? null) : (data.result_b ?? null);
    content = (
      <SlotClientContent
        slot={el as TplElSlotClient}
        client={client}
        mediaUrl={mediaUrl}
        sample={sample}
        isEditor={isEditor}
        selectedChildId={selectedChildId}
        onChildClick={onChildClick ? (cid) => onChildClick(el.id, cid) : undefined}
      />
    );
  } else if (el.type === 'slot_image') {
    const slot = el as TplElSlotImage;
    if (data.image_path) {
      const r = slot.radius ? { borderRadius: `calc(var(--screen-h,400px) * ${slot.radius} / 100)` } : {};
      content = <img src={mediaUrl(data.image_path)} alt="" style={{ width: '100%', height: '100%', objectFit: slot.fit === 'stretch' ? 'fill' : (slot.fit ?? 'contain'), opacity: slot.opacity, ...r, display: 'block' }} />;
    } else if (sample) {
      content = <div style={{ width: '100%', height: '100%', background: '#e2e8f0', display: 'grid', placeItems: 'center', color: '#94a3b8', fontWeight: 700, fontSize: 'calc(var(--screen-h,400px) * 2.5 / 100)' }}>Картинка</div>;
    }
  } else if (el.type === 'slot_text') {
    const slot = el as TplElSlotText;
    const text = data.slide_text || (sample ? 'Текст подписи' : '');
    if (text) content = <TextBox style={slot as TextStyle} text={text} />;
  }

  if (!content && el.type !== 'slot_client') return null;

  return (
    <div style={wrap} onClick={onElementClick ? () => onElementClick(el.id) : undefined}>
      {content}
    </div>
  );
}

function SlotClientContent({
  slot, client, mediaUrl, sample, isEditor, selectedChildId, onChildClick,
}: {
  slot: TplElSlotClient;
  client: { title: string; before_path: string; after_path: string } | null;
  mediaUrl: (p: string) => string;
  sample?: boolean;
  isEditor: boolean;
  selectedChildId?: string | null;
  onChildClick?: (childId: string) => void;
}) {
  const sorted = [...slot.children]
    .filter(c => isEditor || c.visible !== false)
    .sort((a, b) => a.z - b.z);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {sorted.map(child => {
        const childStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${child.x}%`, top: `${child.y}%`,
          width: `${child.w}%`, height: `${child.h}%`,
          zIndex: child.z,
          overflow: child.type === 'text' ? undefined : 'hidden',
          opacity: isEditor && child.visible === false ? 0.25 : undefined,
          cursor: onChildClick ? 'pointer' : undefined,
          outline: isEditor && selectedChildId === child.id ? '1.5px solid #38bdf8' : undefined,
        };

        let content: React.ReactNode = null;
        if (child.type === 'text') {
          const text = (child as SlotChildText).bind === 'name'
            ? (client?.title ?? (sample ? 'Имя клиента' : ''))
            : ((child as SlotChildText).text ?? '');
          if (text || sample) content = <TextBox style={child as SlotChildText} text={text} />;
        } else if (child.type === 'image') {
          const img = child as SlotChildImage;
          if (img.bind === 'before' || img.bind === 'after') {
            const path = img.bind === 'before' ? client?.before_path : client?.after_path;
            if (path) {
              const r = img.radius ? { borderRadius: `calc(var(--screen-h,400px) * ${img.radius} / 100)` } : {};
              content = <img src={mediaUrl(path)} alt="" style={{ width: '100%', height: '100%', objectFit: img.fit === 'stretch' ? 'fill' : (img.fit ?? 'cover'), opacity: img.opacity, ...r, display: 'block' }} />;
            } else if (sample) {
              const label = img.bind === 'before' ? 'ДО' : 'ПОСЛЕ';
              const bg = img.bind === 'before' ? '#fde8e8' : '#e8fdf4';
              const color = img.bind === 'before' ? '#dc2626' : '#16a34a';
              content = <div style={{ width: '100%', height: '100%', background: bg, display: 'grid', placeItems: 'center', color, fontSize: 'calc(var(--screen-h,400px) * 2.5 / 100)', fontWeight: 700 }}>{label}</div>;
            }
          } else if (img.path) {
            const r = img.radius ? { borderRadius: `calc(var(--screen-h,400px) * ${img.radius} / 100)` } : {};
            content = <img src={mediaUrl(img.path)} alt="" style={{ width: '100%', height: '100%', objectFit: img.fit === 'stretch' ? 'fill' : (img.fit ?? 'cover'), opacity: img.opacity, ...r, display: 'block' }} />;
          }
        } else if (child.type === 'shape') {
          const sc = child as SlotChildShape;
          const shapeEl: ScreenElShape = { ...sc, type: 'shape', id: sc.id, x: 0, y: 0, w: 100, h: 100 };
          content = <ShapeBox el={shapeEl} />;
        }

        if (!content) return null;
        return (
          <div key={child.id} style={childStyle}
            onClick={onChildClick ? (e) => { e.stopPropagation(); onChildClick(child.id); } : undefined}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
