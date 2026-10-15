import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import QuizPage from './pages/QuizPage';
import SummaryPage from './pages/SummaryPage';
import HistoryPage from './pages/HistoryPage';
import NewPage from './pages/NewPage';
import './index.css';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.authed) setOk(true);
        else window.location.href = '/window';
      })
      .catch(() => { window.location.href = '/window'; });
  }, [navigate]);

  if (ok === null) return null;
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
