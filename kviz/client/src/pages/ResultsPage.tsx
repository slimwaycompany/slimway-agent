import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface TvSettings {
  main_enabled: boolean; main_seconds: number;
  main_label_cm: string; main_label_kg: string; main_label_fat: string;
  results_enabled: boolean; results_seconds: number; results_show_count: number;
  promo_enabled: boolean; promo_seconds: number; promo_image_path: string | null;
}
interface TvSummary { cm_lost: number; kg_lost: number; fat_kg_lost: number; mission: string }
interface TvResult { id: string; title: string; before_path: string; after_path: string; position: number }
interface TvData { settings: TvSettings; summary: TvSummary; results: TvResult[] }

type BlockType = 'main' | 'results' | 'promo';

const BASE = import.meta.env.BASE_URL;

function getBlocks(d: TvData): BlockType[] {
  const b: BlockType[] = [];
  if (d.settings.main_enabled !== false) b.push('main');
  if (d.settings.results_enabled && d.results.some(r => r.before_path && r.after_path)) b.push('results');
  if (d.settings.promo_enabled && d.settings.promo_image_path) b.push('promo');
  return b.length ? b : ['main'];
}

function blockSeconds(block: BlockType, s: TvSettings): number {
  if (block === 'main') return s.main_seconds || 15;
  if (block === 'results') return s.results_seconds || 15;
  return s.promo_seconds || 15;
}

function mediaUrl(path: string, key: string): string {
  return `/api/tv/media?path=${encodeURIComponent(path)}&key=${encodeURIComponent(key)}`;
}

function formatAlmaty(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');
}

// ── Shared layout: logo top-center, mission bottom-center ─────────────────────
function TvBlockLayout({ mission, datetime, children }: {
  mission: string; datetime?: string; children: React.ReactNode;
}) {
  return (
    <>
      <div className="tv-top">
        <img src={`${BASE}tv/logo.png`} alt="SlimWay" className="tv-logo"
          onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>
      <div className="tv-mid">{children}</div>
      <div className="tv-bot">
        <div className="tv-mission">{mission || 'Вместе к лучшей версии себя'}</div>
        {datetime && <div className="tv-datetime">{datetime}</div>}
      </div>
    </>
  );
}

// ── Main block ─────────────────────────────────────────────────────────────────
function MainBlock({ data, values, datetime }: { data: TvData; values: number[]; datetime: string }) {
  const { summary: s, settings: st } = data;
  const labels = [
    st.main_label_cm  || 'Сантиметров убрали',
    st.main_label_kg  || 'Килограммов сбросили',
    st.main_label_fat || 'Жира сожгли',
  ];
  return (
    <TvBlockLayout mission={s.mission} datetime={datetime}>
      <section className="results-counters">
        <article className="results-counter">
          <img className="tv-icon-img" src={`${BASE}tv/sm.jpg`} alt=""
            onError={e => { e.currentTarget.style.display = 'none'; }} />
          <strong>{Math.round(values[0])}</strong>
          <span>{labels[0]}</span><small>см</small>
        </article>
        <article className="results-counter">
          <img className="tv-icon-img" src={`${BASE}tv/kg.png`} alt=""
            onError={e => { e.currentTarget.style.display = 'none'; }} />
          <strong>{Math.round(values[1])}</strong>
          <span>{labels[1]}</span><small>кг</small>
        </article>
        <article className="results-counter">
          <img className="tv-icon-img" src={`${BASE}tv/fat.png`} alt=""
            onError={e => { e.currentTarget.style.display = 'none'; }} />
          <strong>{Math.round(values[2])}</strong>
          <span>{labels[2]}</span><small>кг</small>
        </article>
      </section>
    </TvBlockLayout>
  );
}

// ── Results (before/after) block ───────────────────────────────────────────────
function ResultsBlock({ data, tvKey }: { data: TvData; tvKey: string }) {
  const count = Math.max(1, data.settings.results_show_count || 3);
  const eligible = data.results.filter(r => r.before_path && r.after_path);
  const shown = eligible.slice(0, count);
  return (
    <TvBlockLayout mission={data.summary.mission}>
      <section className="tv-cards">
        {shown.map(r => (
          <article key={r.id} className="tv-card">
            <div className="tv-card-images">
              <div className="tv-card-side">
                <img src={mediaUrl(r.before_path, tvKey)} alt="До" />
                <span className="tv-card-label">До</span>
              </div>
              <div className="tv-card-side">
                <img src={mediaUrl(r.after_path, tvKey)} alt="После" />
                <span className="tv-card-label tv-card-label--after">После</span>
              </div>
            </div>
            {r.title && <div className="tv-card-title">{r.title}</div>}
          </article>
        ))}
      </section>
    </TvBlockLayout>
  );
}

// ── Promo block ────────────────────────────────────────────────────────────────
function PromoBlock({ data, tvKey }: { data: TvData; tvKey: string }) {
  const path = data.settings.promo_image_path;
  if (!path) return null;
  return (
    <TvBlockLayout mission={data.summary.mission}>
      <div className="tv-promo">
        <img src={mediaUrl(path, tvKey)} alt="Акция" />
      </div>
    </TvBlockLayout>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const { search } = useLocation();
  const tvKey = new URLSearchParams(search).get('key') || '';
  const [data, setData] = useState<TvData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [blockIdx, setBlockIdx] = useState(0);
  const [anim, setAnim] = useState<'idle' | 'exit' | 'enter'>('idle');
  const [values, setValues] = useState([0, 0, 0]);
  const [datetime, setDatetime] = useState(() => formatAlmaty(new Date()));
  const valuesRef = useRef([0, 0, 0]);
  const dataRef = useRef<TvData | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const blockIdxRef = useRef(0);

  // Lock body/html scroll while TV screen is active
  useEffect(() => {
    document.documentElement.classList.add('tv-page');
    document.body.classList.add('tv-page');
    return () => {
      document.documentElement.classList.remove('tv-page');
      document.body.classList.remove('tv-page');
    };
  }, []);

  // Datetime clock, Asia/Almaty, updates every 10s
  useEffect(() => {
    const id = setInterval(() => setDatetime(formatAlmaty(new Date())), 10_000);
    return () => clearInterval(id);
  }, []);

  function animateCounters(s: TvSummary) {
    cancelAnimationFrame(rafRef.current);
    const from = [...valuesRef.current];
    const target = [s.cm_lost, s.kg_lost, s.fat_kg_lost];
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / 1100);
      const eased = 1 - (1 - p) ** 3;
      const cur = target.map((n, i) => from[i] + (n - from[i]) * eased);
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
      dataRef.current = d;
      setData(d);
      setInvalid(false);
      animateCounters(d.summary);
    } catch { /* retry on next SSE update */ }
  }, [tvKey]);

  useEffect(() => { loadData(); }, [loadData]);

  // SSE for real-time push when studio_results change
  useEffect(() => {
    if (!tvKey) return;
    const es = new EventSource(`/api/tv/stream?key=${encodeURIComponent(tvKey)}`);
    es.addEventListener('update', () => { loadData(); });
    return () => es.close();
  }, [tvKey, loadData]);

  // Block cycling
  useEffect(() => {
    if (!data) return;
    const blocks = getBlocks(data);
    if (blocks.length <= 1) return;
    const curBlock = blocks[blockIdxRef.current % blocks.length];
    const secs = blockSeconds(curBlock, data.settings);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnim('exit');
      setTimeout(() => {
        const nextIdx = blockIdxRef.current + 1;
        blockIdxRef.current = nextIdx;
        setBlockIdx(nextIdx);
        setAnim('enter');
        setTimeout(() => setAnim('idle'), 400);
      }, 400);
    }, secs * 1000);
    return () => clearTimeout(timerRef.current);
  }, [data, blockIdx]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); clearTimeout(timerRef.current); }, []);

  if (invalid) return <main className="results-invalid">404</main>;
  if (!data) return null;

  const blocks = getBlocks(data);
  const curBlock = blocks[blockIdxRef.current % blocks.length];

  return (
    <main className="results-screen">
      <div className="results-glow results-glow-a" />
      <div className="results-glow results-glow-b" />
      <div className={`tv-block${anim === 'exit' ? ' tv-block--exit' : anim === 'enter' ? ' tv-block--enter' : ''}`}>
        {curBlock === 'main'    && <MainBlock    data={data} values={values} datetime={datetime} />}
        {curBlock === 'results' && <ResultsBlock data={data} tvKey={tvKey} />}
        {curBlock === 'promo'   && <PromoBlock   data={data} tvKey={tvKey} />}
      </div>
    </main>
  );
}
