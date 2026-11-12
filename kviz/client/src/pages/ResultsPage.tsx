import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import smIcon  from '../assets/tv/sm.png';
import kgIcon  from '../assets/tv/kg.png';
import fatIcon from '../assets/tv/fat.png';
import logoImg from '../assets/tv/logo.png';
import FreeSlide, { type FreeLayout } from '../components/tv/FreeSlide';

interface TvSettings { main_label_cm: string; main_label_kg: string; main_label_fat: string; intro_text: string }
interface TvCounters { cm_lost: number; kg_lost: number; fat_kg_lost: number }
interface TvResult  { id: string; title: string; before_path: string; after_path: string }
interface TvSlide {
  id: string; kind: 'result1' | 'result2' | 'promo' | 'usp' | 'free';
  duration_sec: number; enabled: boolean;
  image_path: string | null; result_a: TvResult | null; result_b: TvResult | null;
  layout?: FreeLayout;
}
interface TvData {
  settings: TvSettings; counters: TvCounters; mission: string;
  slides: TvSlide[]; serverTime: string;
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

// ── Result card: title + two photos (before/after) ──────────────────────────
function ResultCard({ res, tvKey, small }: { res: TvResult; tvKey: string; small?: boolean }) {
  return (
    <div className="tv-res1" style={small ? { padding: 'clamp(6px,1vh,12px) clamp(6px,1vw,12px)' } : undefined}>
      <div className="tv-res-title">{res.title}</div>
      <div className="tv-res-photos">
        <div className="tv-res-side">
          <img src={mediaUrl(res.before_path, tvKey)} alt="До"
            onError={e => { (e.currentTarget.closest('.tv-res1, .tv-res2-card') as HTMLElement | null)?.setAttribute('data-failed', '1'); }} />
          <span className="tv-res-label">До</span>
        </div>
        <div className="tv-res-side">
          <img src={mediaUrl(res.after_path, tvKey)} alt="После"
            onError={e => { (e.currentTarget.closest('.tv-res1, .tv-res2-card') as HTMLElement | null)?.setAttribute('data-failed', '1'); }} />
          <span className="tv-res-label tv-res-label--after">После</span>
        </div>
      </div>
    </div>
  );
}

// ── Slide content by kind ───────────────────────────────────────────────────
function SlideContent({ slide, tvKey, onFail }: { slide: TvSlide; tvKey: string; onFail: () => void }) {
  const handleErr = useCallback(() => { onFail(); }, [onFail]);

  if (slide.kind === 'result1' && slide.result_a) {
    return <ResultCard res={slide.result_a} tvKey={tvKey} />;
  }
  if (slide.kind === 'result2' && slide.result_a && slide.result_b) {
    return (
      <div className="tv-res2">
        <div className="tv-res2-card"><ResultCard res={slide.result_a} tvKey={tvKey} small /></div>
        <div className="tv-res2-card"><ResultCard res={slide.result_b} tvKey={tvKey} small /></div>
      </div>
    );
  }
  if ((slide.kind === 'promo' || slide.kind === 'usp') && slide.image_path) {
    return (
      <div className="tv-img-slide">
        <img src={mediaUrl(slide.image_path, tvKey)} alt={slide.kind} onError={handleErr} />
      </div>
    );
  }
  return null;
}

// ── Counter block: icon left, number+unit+label right ───────────────────────
function CounterBlock({ icon, value, unit, label }: { icon: string; value: number; unit: string; label: string }) {
  const blockRef = useRef<HTMLDivElement>(null);
  const iconRef  = useRef<HTMLImageElement>(null);
  const [fs, setFs] = useState(50);

  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    const compute = () => {
      const { width, height } = block.getBoundingClientRect();
      if (!height || !width) return;
      const iconW = iconRef.current ? iconRef.current.offsetWidth : height * 0.55;
      const digits = Math.max(1, String(Math.round(value)).length);
      const avail = width - iconW - 16;
      const byH = height * 0.55;
      const byW = avail / (digits * 0.48); // Barlow Condensed width ratio
      setFs(Math.max(20, Math.floor(Math.min(byH, byW))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(block);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div ref={blockRef} className="tv-counter-block">
      <img ref={iconRef} src={icon} className="tv-counter-icon" alt=""
        onError={e => { e.currentTarget.style.display = 'none'; }} />
      <div className="tv-counter-data">
        <div className="tv-counter-numrow">
          <span className="tv-counter-num" style={{ fontSize: fs }}>{Math.round(value)}</span>
          <span className="tv-counter-unit">{unit}</span>
        </div>
        <div className="tv-counter-label">{label}</div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
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

  const valuesRef  = useRef([0, 0, 0]);
  const prevTargetRef = useRef([0, 0, 0]);
  const rafRef     = useRef<number>(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout>>();
  const slideIdxRef = useRef(0);

  // Lock body/html scroll while TV screen is active
  useEffect(() => {
    document.documentElement.classList.add('tv-page');
    document.body.classList.add('tv-page');
    return () => {
      document.documentElement.classList.remove('tv-page');
      document.body.classList.remove('tv-page');
    };
  }, []);

  // Datetime clock, Asia/Almaty, every 10s
  useEffect(() => {
    const id = setInterval(() => setDatetime(formatAlmaty(new Date())), 10_000);
    return () => clearInterval(id);
  }, []);

  function animateCounters(c: TvCounters) {
    const target = [c.cm_lost, c.kg_lost, c.fat_kg_lost];
    const prev   = prevTargetRef.current;
    // Skip animation if values unchanged
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

  // SSE for real-time push
  useEffect(() => {
    if (!tvKey) return;
    const es = new EventSource(`/api/tv/stream?key=${encodeURIComponent(tvKey)}`);
    es.addEventListener('changed', () => loadData());
    return () => es.close();
  }, [tvKey, loadData]);

  // Fallback poll every 60s
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

  const st  = data.settings;
  const labels  = [st.main_label_cm || 'Сантиметров убрали', st.main_label_kg || 'Килограммов сбросили', st.main_label_fat || 'Жира сожгли'];
  const icons   = [smIcon, kgIcon, fatIcon];
  const units   = ['см', 'кг', 'кг'];
  const curSlide = slides.length ? slides[slideIdxRef.current % slides.length] : null;

  return (
    <main className="tv-screen">
      <div className="tv-glow tv-glow-a" />
      <div className="tv-glow tv-glow-b" />

      {/* Header: logo top-center */}
      <div className="tv-hdr">
        <img src={logoImg} alt="SlimWay" className="tv-logo"
          onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>

      {/* Body: left 30% counters + right 70% carousel */}
      <div className="tv-body">
        <div className="tv-left">
          <div className="tv-counter-panel">
            {st.intro_text && <div className="tv-counter-intro">{st.intro_text}</div>}
            {values.map((v, i) => (
              <CounterBlock key={i} icon={icons[i]} value={v} unit={units[i]} label={labels[i]} />
            ))}
          </div>
        </div>

        <div className="tv-right">
          {curSlide && (
            <div className={`tv-slide${anim === 'exit' ? ' tv-slide--exit' : anim === 'enter' ? ' tv-slide--enter' : ''}`}>
              {curSlide.kind === 'free' && curSlide.layout ? (
                <div style={{
                  flex: 1, position: 'relative', overflow: 'hidden',
                  borderRadius: 'clamp(14px,1.8vw,28px)',
                  ...(curSlide.layout.frame ? {
                    border: '2px solid transparent',
                    background: 'linear-gradient(rgba(255,255,255,.58),rgba(255,255,255,.58)) padding-box, linear-gradient(135deg,#02BDB6,#263CD9) border-box',
                    boxShadow: '0 12px 48px rgba(38,60,217,.13)',
                    backdropFilter: 'blur(16px)',
                  } : {}),
                }}>
                  <FreeSlide
                    layout={curSlide.layout}
                    mediaUrl={p => mediaUrl(p, tvKey)}
                  />
                </div>
              ) : (
                <div className="tv-frame">
                  <SlideContent
                    slide={curSlide}
                    tvKey={tvKey}
                    onFail={() => setFailedIds(s => new Set([...s, curSlide.id]))}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: mission center, datetime bottom-right */}
      <div className="tv-ftr">
        <div className="tv-mission">{data.mission || 'Вместе к лучшей версии себя'}</div>
        <div className="tv-datetime">{datetime}</div>
      </div>
    </main>
  );
}
