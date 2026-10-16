import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import QuizPage from './pages/QuizPage';
import SummaryPage from './pages/SummaryPage';
import HistoryPage from './pages/HistoryPage';
import NewPage from './pages/NewPage';
import { isEmbedded } from './utils/iframe';
import './index.css';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const onFail = () => {
      if (isEmbedded) { setOk(false); }
      else { window.location.href = '/window?returnTo=' + encodeURIComponent('/kviz/'); }
    };
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.authed) setOk(true); else onFail(); })
      .catch(onFail);
  }, [navigate]);

  if (ok === null) return null;
  if (ok === false) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#666', fontFamily: 'sans-serif' }}>
      Войдите во вкладке Овчарка и обновите страницу
    </div>
  );
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/new" element={<RequireAuth><NewPage /></RequireAuth>} />
      <Route path="/q/:id/summary" element={<RequireAuth><SummaryPage /></RequireAuth>} />
      <Route path="/q/:id/:step" element={<RequireAuth><QuizPage /></RequireAuth>} />
      <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
