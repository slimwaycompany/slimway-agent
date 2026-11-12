import type { FreeEl } from './FreeSlide';

interface Props {
  el: FreeEl & { type: 'image' };
  mediaUrl: (path: string) => string;
}

export default function ImageBox({ el, mediaUrl }: Props) {
  if (!el.path) return null;
  const objFit: React.CSSProperties['objectFit'] =
    el.fit === 'stretch' ? 'fill' : (el.fit ?? 'cover');
  return (
    <img
      src={mediaUrl(el.path)}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: objFit, display: 'block' }}
    />
  );
}
