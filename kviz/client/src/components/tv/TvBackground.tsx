import type { DEFAULT_FX } from '../../lib/tvScreenLayout';

type ResolvedFx = typeof DEFAULT_FX;

interface Props {
  fx: ResolvedFx;
  /** Static-only: no animation even if fx.bg.anim=true (for previews) */
  staticOnly?: boolean;
}

export default function TvBackground({ fx, staticOnly }: Props) {
  const reduced = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const animated = fx.bg.anim && fx.quality !== 'eco' && !reduced && !staticOnly;
  const paused = fx.bg.paused;
  const medium = fx.bg.intensity === 'medium';
  const grain = fx.bg.grain;

  const blobClass = [
    'tv-bg-blob',
    animated ? (medium ? 'tv-bg-medium' : 'tv-bg-soft') : 'tv-bg-static',
    paused ? 'tv-bg-paused' : '',
  ].filter(Boolean).join(' ');

  // SVG grain texture as data-URI (rendered once, static)
  const grainUri = grain > 0
    ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`
    : undefined;

  return (
    <div className="tv-bg-layer" aria-hidden="true">
      {/* Base gradient */}
      <div className="tv-bg-base" />
      {/* Animated blobs (radial gradients — softness from gradient, not filter:blur) */}
      <div className={`${blobClass} tv-bg-blob-a`} />
      <div className={`${blobClass} tv-bg-blob-b`} />
      <div className={`${blobClass} tv-bg-blob-c`} />
      {/* Grain overlay */}
      {grainUri && (
        <div className="tv-bg-grain" style={{ opacity: grain / 100, backgroundImage: grainUri }} />
      )}
    </div>
  );
}
