import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  active: 'new' | 'reports';
  children: React.ReactNode;
}

export function MeasureLayout({ active, children }: Props) {
  const navigate = useNavigate();
  const [showResults, setShowResults] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tvUrl, setTvUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.role === 'admin') {
          setIsAdmin(true);
          return fetch('/kviz/api/results/mission', { credentials: 'include' })
            .then(r => r.json())
            .then(m => { if (m.display_url) setTvUrl(window.location.origin + m.display_url); });
        }
      })
      .catch(() => {/* ignore */});
  }, []);

  function openResults() { setShowResults(true); }
  function closeResults() { setShowResults(false); }

  async function copyTvLink() {
    if (!tvUrl) return;
    await navigator.clipboard.writeText(tvUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const resultsSrc = isAdmin && tvUrl ? tvUrl.replace(window.location.origin, '') : '/kviz/results-view';

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e6ea', padding: '0 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 4, height: 48 }}>
          <span style={{ fontWeight: 700, fontSize: 16, marginRight: 12, color: '#1a1a2e' }}>📏 Замеры</span>
          <button
            className={`measure-subtab${active === 'new' ? ' active' : ''}`}
            onClick={() => navigate('/measure/new')}
          >Новый замер</button>
          <button
            className={`measure-subtab${active === 'reports' ? ' active' : ''}`}
            onClick={() => navigate('/measure/reports')}
          >Отчёты</button>
          <button
            className="measure-subtab"
            style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#02BDB6,#263CD9)', color: '#fff', border: 'none' }}
            onClick={openResults}
          >Результаты студии</button>
        </div>
      </div>
      <div>{children}</div>

      {showResults && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', flexDirection: 'column',
          background: '#000',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(0,0,0,0.8)', flexShrink: 0 }}>
            {isAdmin && tvUrl && (
              <button onClick={copyTvLink} style={{
                background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 6,
                padding: '4px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>
                {copied ? '✓ Скопировано' : 'Скопировать ссылку для ТВ'}
              </button>
            )}
            <button onClick={closeResults} style={{
              marginLeft: 'auto', background: 'transparent', border: '1px solid #666',
              color: '#fff', borderRadius: 6, padding: '4px 14px', cursor: 'pointer', fontSize: 13,
            }}>✕ Закрыть</button>
          </div>
          <iframe
            ref={iframeRef}
            src={resultsSrc}
            style={{ flex: 1, border: 'none', width: '100%' }}
            title="Результаты студии"
          />
        </div>
      )}
    </div>
  );
}
