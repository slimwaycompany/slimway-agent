import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import FreeSlide from '../components/tv/FreeSlide';
import TvScreen from '../components/tv/TvScreen';
import SlideTemplate from '../components/tv/SlideTemplate';
import type { FreeLayout, ScreenLayout, SlideTemplates } from '../lib/tvScreenLayout';
import { defaultScreenLayout, defaultSlideTemplates } from '../lib/tvScreenLayout';

interface TvCounters { cm_lost: number; kg_lost: number; fat_kg_lost: number }
interface TvResult  { id: string; title: string; before_path: string; after_path: string }
interface TvSlide {
  id: string; kind: 'result1' | 'result2' | 'promo' | 'usp' | 'free';
  duration_sec: number; enabled: boolean;
  image_path: string | null; result_a: TvResult | null; result_b: TvResult | null;
  layout?: FreeLayout;
  slide_text?: string | null;
}
interface TvData {
  screen_layout: ScreenLayout;
  counters: TvCounters;
  mission: string;
  slides: TvSlide[];
  slide_templates?: SlideTemplates;
  serverTime: string;
  version: string;
}

function mediaUrl(path: string, key: string) {
  return `/api/tv/media?path=${encodeURIComponent(path)}&key=${encodeURIComponent(key)}`;
}

function formatAlmaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');
}

// ── Slide template kind mapping ───────────────────────────────────────────────
const SLIDE_TPL_KIND: Record<string, 'result1' | 'result2' | 'image'> = {
  result1: 'result1', result2: 'result2', promo: 'image', usp: 'image',
};

// ── Main page ────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const { search } = useLocation();
  const tvKey = new URLSearchParams(search).get('key') || '';

  const [data, setData]       = useState<TvData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [anim, setAnim]       = useState<'idle' | 'exit' | 'enter'>('idle');
  const [values, setValues]   = useState([0, 0, 0]);
  const [datetime, setDatetime] = useState(() => formatAlmaty(new Date()));
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const valuesRef     = useRef([0, 0, 0]);
  const prevTargetRef = useRef([0, 0, 0]);
  const rafRef        = useRef<number>(0);
  const timerRef      = useRef<ReturnType<typeof setTimeout>>();
  const slideIdxRef   = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add('tv-page');
    document.body.classList.add('tv-page');
    return () => {
      document.documentElement.classList.remove('tv-page');
      document.body.classList.remove('tv-page');
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setDatetime(formatAlmaty(new Date())), 10_000);
    return () => clearInterval(id);
  }, []);

  function animateCounters(c: TvCounters) {
    const target = [c.cm_lost, c.kg_lost, c.fat_kg_lost];
    const prev   = prevTargetRef.current;
    if (target[0] === prev[0] && target[1] === prev[1] && target[2] === prev[2]) return;
    prevTargetRef.current = target;
    cancelAnimationFrame(rafRef.current);
    const from    = [...valuesRef.current];
    const started = performance.now();
    const tick = (now: number) => {
      const p     = Math.min(1, (now - started) / 1100);
      const eased = 1 - (1 - p) ** 3;
      const cur   = target.map((n, i) => from[i] + (n - from[i]) * eased);
      valuesRef.current = cur;
      setValues(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const loadData = useCallback(async () => {
    try {
      const r = await fetch(`/api/tv/data?key=${encodeURIComponent(tvKey)}`, { cache: 'no-store' });
      if (r.status === 404) { setInvalid(true); return; }
      if (!r.ok) return;
      const d: TvData = await r.json();
      setData(d);
      setInvalid(false);
      animateCounters(d.counters);
    } catch { /* retry on next SSE / poll */ }
  }, [tvKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!tvKey) return;
    const es = new EventSource(`/api/tv/stream?key=${encodeURIComponent(tvKey)}`);
    es.addEventListener('changed', () => loadData());
    return () => es.close();
  }, [tvKey, loadData]);

  useEffect(() => {
    const id = setInterval(loadData, 60_000);
    return () => clearInterval(id);
  }, [loadData]);

  const slides = (data?.slides ?? []).filter(s => s.enabled && !failedIds.has(s.id));

  // Preload next slide images
  useEffect(() => {
    if (!slides.length) return;
    const next = slides[(slideIdxRef.current + 1) % slides.length];
    if (!next) return;
    const paths: string[] = [];
    if (next.result_a?.before_path) paths.push(next.result_a.before_path);
    if (next.result_a?.after_path)  paths.push(next.result_a.after_path);
    if (next.result_b?.before_path) paths.push(next.result_b.before_path);
    if (next.result_b?.after_path)  paths.push(next.result_b.after_path);
    if (next.image_path) paths.push(next.image_path);
    if (next.kind === 'free' && next.layout) {
      for (const el of next.layout.elements) {
        if (el.type === 'image' && el.path) paths.push(el.path);
      }
    }
    paths.forEach(p => { const img = new Image(); img.src = mediaUrl(p, tvKey); });
  }, [slideIdx, slides, tvKey]);

  // Slide cycling
  useEffect(() => {
    if (!slides.length || slides.length <= 1) return;
    const cur = slides[slideIdxRef.current % slides.length];
    const secs = cur?.duration_sec || 10;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnim('exit');
      setTimeout(() => {
        const nextIdx = slideIdxRef.current + 1;
        slideIdxRef.current = nextIdx;
        setSlideIdx(nextIdx);
        setAnim('enter');
        setTimeout(() => setAnim('idle'), 600);
      }, 400);
    }, secs * 1000);
    return () => clearTimeout(timerRef.current);
  }, [slideIdx, slides]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
  }, []);

  if (invalid) return <main className="results-invalid">404</main>;
  if (!data) return null;

  const curSlide = slides.length ? slides[slideIdxRef.current % slides.length] : null;
  const screenLayout: ScreenLayout = data.screen_layout ?? defaultScreenLayout();
  const slideTemplates = data.slide_templates ?? defaultSlideTemplates();

  const carousel = curSlide ? (
    <div className={`tv-slide${anim === 'exit' ? ' tv-slide--exit' : anim === 'enter' ? ' tv-slide--enter' : ''}`}
      style={{ position: 'absolute', inset: 0 }}>
      {curSlide.kind === 'free' && curSlide.layout ? (
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: 'clamp(14px,1.8vw,28px)',
          overflow: 'hidden',
          ...(curSlide.layout.frame ? {
            border: '2px solid transparent',
            background: 'linear-gradient(rgba(255,255,255,.58),rgba(255,255,255,.58)) padding-box, linear-gradient(135deg,#02BDB6,#263CD9) border-box',
            boxShadow: '0 12px 48px rgba(38,60,217,.13)',
            backdropFilter: 'blur(16px)',
          } : {}),
        }}>
          <FreeSlide layout={curSlide.layout} mediaUrl={p => mediaUrl(p, tvKey)} />
        </div>
      ) : SLIDE_TPL_KIND[curSlide.kind] ? (
        <div style={{ position: 'absolute', inset: 0, borderRadius: 'clamp(14px,1.8vw,28px)', overflow: 'hidden' }}>
          <SlideTemplate
            template={slideTemplates[SLIDE_TPL_KIND[curSlide.kind]]}
            data={{
              result_a: curSlide.result_a,
              result_b: curSlide.result_b,
              image_path: curSlide.image_path,
              slide_text: curSlide.slide_text,
            }}
            mediaUrl={p => mediaUrl(p, tvKey)}
          />
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <main className="tv-screen">
      <div className="tv-glow tv-glow-a" />
      <div className="tv-glow tv-glow-b" />
      <TvScreen
        layout={screenLayout}
        values={{ value_cm: values[0], value_kg: values[1], value_fat: values[2] }}
        mission={data.mission ?? ''}
        carousel={carousel}
        datetime={datetime}
        mediaUrl={p => mediaUrl(p, tvKey)}
      />
    </main>
  );
}
