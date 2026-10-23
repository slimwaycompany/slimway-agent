import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface Summary { cm_lost: number; kg_lost: number; fat_kg_lost: number; clients: number; mission: string }

export default function ResultsPage() {
  const { search } = useLocation();
  const key = new URLSearchParams(search).get('key') || '';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [values, setValues] = useState([0, 0, 0, 0]);
  const [invalid, setInvalid] = useState(false);
  const [logoReady, setLogoReady] = useState(false);
  const valuesRef = useRef(values);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/results/summary?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (response.status === 404) { setInvalid(true); return; }
      if (!response.ok) return;
      const next: Summary = await response.json();
      setSummary(next);
      const from = valuesRef.current;
      const target = [next.cm_lost, next.kg_lost, next.fat_kg_lost, next.clients];
      const started = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - started) / 1100);
        const eased = 1 - (1 - p) ** 3;
        const current = target.map((n, i) => from[i] + (n - from[i]) * eased);
        valuesRef.current = current;
        setValues(current);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setInvalid(false);
    } catch { /* retry on next refresh */ }
  }, [key]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (invalid) return <main className="results-invalid">404</main>;
  return (
    <main className="results-screen">
      <div className="results-glow results-glow-a" /><div className="results-glow results-glow-b" />
      <header className="results-header">
        <div className="results-logo">
          <img src="/img/logo.png" alt="SlimWay" onLoad={() => setLogoReady(true)} onError={e => { e.currentTarget.style.display = 'none'; setLogoReady(false); }} />
          {!logoReady && <span>SlimWay</span>}
        </div>
        <div className="results-mission">{summary?.mission || 'Вместе к лучшей версии себя'}</div>
      </header>
      <section className="results-counters">
        <article className="results-counter"><span className="results-icon">↘</span><strong>{values[0].toFixed(1)}</strong><span>Сантиметров убрали</span><small>см</small></article>
        <article className="results-counter"><span className="results-icon">↓</span><strong>{values[1].toFixed(1)}</strong><span>Килограммов сбросили</span><small>кг</small></article>
        <article className="results-counter"><span className="results-icon">✦</span><strong>{values[2].toFixed(1)}</strong><span>Жира сожгли</span><small>кг</small></article>
      </section>
      <footer className="results-footer">Клиенток с результатом: <b>{Math.round(values[3])}</b></footer>
    </main>
  );
}
