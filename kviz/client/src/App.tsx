import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MeasureLayout } from './pages/measure/MeasureLayout';
import HomePage from './pages/HomePage';
import QuizPage from './pages/QuizPage';
import SummaryPage from './pages/SummaryPage';
import HistoryPage from './pages/HistoryPage';
import NewPage from './pages/NewPage';
import NewMeasurePage from './pages/measure/NewMeasurePage';
import ClientPage from './pages/measure/ClientPage';
import PrintPage from './pages/measure/PrintPage';
import ManagerPage from './pages/manager/ManagerPage';
import AdminPage from './pages/manager/AdminPage';
import AdminReportsPage from './pages/reports/ReportsPage';
import ResultsPage from './pages/ResultsPage';
import SharePage from './pages/measure/SharePage';
import InBodyImportPage from './pages/measure/InBodyImportPage';
import InBodyScanPage from './pages/measure/InBodyScanPage';
import PlaceholderPage from './pages/crm/PlaceholderPage';
import SettingsPage from './pages/crm/SettingsPage';
import ClientsPage from './pages/crm/ClientsPage';
import KassaPage from './pages/crm/KassaPage';
import FunnelPage from './pages/crm/FunnelPage';
import { isEmbedded } from './utils/iframe';
import { PermContext } from './lib/permContext';
import type { PermEntry } from './lib/permContext';
import { Toaster } from './components/ui/Toaster';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import './index.css';

interface MeResponse {
  authed: boolean;
  login?: string;
  display_name?: string;
  role?: string;
  perms?: Record<string, PermEntry>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<{ ok: boolean | null; role: string; perms: Record<string, PermEntry> }>({
    ok: null, role: '', perms: {},
  });

  useEffect(() => {
    const onFail = () => {
      if (isEmbedded) { setState({ ok: false, role: '', perms: {} }); }
      else { window.location.href = '/window?returnTo=' + encodeURIComponent('/kviz/'); }
    };
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.json() as Promise<MeResponse>)
      .then(d => {
        if (d.authed) setState({ ok: true, role: d.role ?? '', perms: d.perms ?? {} });
        else onFail();
      })
      .catch(onFail);
  }, [navigate]);

  if (state.ok === null) return null;
  if (state.ok === false) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#666', fontFamily: 'sans-serif' }}>
      Войдите во вкладке Овчарка и обновите страницу
    </div>
  );
  return (
    <PermContext.Provider value={{ role: state.role, perms: state.perms }}>
      {children}
    </PermContext.Provider>
  );
}

function MeasureLandingPage() {
  const [sp] = useSearchParams();
  const s = sp.get('section');
  if (s === 'measure') return <NewMeasurePage />;
  if (s === 'inbody')  return <InBodyScanPage />;
  return <MeasureLayout />;
}

export default function App() {
  // Sync theme from server on initial load (corrects localStorage cache if stale)
  useEffect(() => {
    if (window.location.pathname.startsWith('/kviz/results')) return;
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { ui_theme?: string } | null) => {
        if (!d?.ui_theme) return;
        const root = document.documentElement;
        if (d.ui_theme === 'dark') root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
        try { localStorage.setItem('sw-theme', d.ui_theme); } catch {}
      })
      .catch(() => {});
  }, []);

  // Listen for theme change from parent shell
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!e.data || e.data.type !== 'sw-theme') return;
      if (window.location.pathname.startsWith('/kviz/results')) return;
      const t = e.data.theme as string, root = document.documentElement;
      if (t === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
      try { localStorage.setItem('sw-theme', t); } catch {}
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <ConfirmProvider>
    <Routes>
      <Route path="/results" element={<ResultsPage />} />
      <Route path="/r/:token" element={<SharePage />} />
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/new" element={<RequireAuth><NewPage /></RequireAuth>} />
      <Route path="/q/:id/summary" element={<RequireAuth><SummaryPage /></RequireAuth>} />
      <Route path="/q/:id/:step" element={<RequireAuth><QuizPage /></RequireAuth>} />
      <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
      <Route path="/measure" element={<RequireAuth><MeasureLandingPage /></RequireAuth>} />
      <Route path="/measure/new" element={<RequireAuth><NewMeasurePage /></RequireAuth>} />
      <Route path="/measure/reports" element={<Navigate to="/reports" replace />} />
      <Route path="/measure/client/:id" element={<RequireAuth><ClientPage /></RequireAuth>} />
      <Route path="/measure/print" element={<RequireAuth><PrintPage /></RequireAuth>} />
      <Route path="/measure/inbody" element={<RequireAuth><InBodyScanPage /></RequireAuth>} />
      <Route path="/measure/inbody-import" element={<RequireAuth><InBodyImportPage /></RequireAuth>} />
      <Route path="/manager" element={<RequireAuth><ManagerPage /></RequireAuth>} />
      <Route path="/manager/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
      <Route path="/reports" element={<RequireAuth><AdminReportsPage /></RequireAuth>} />
      <Route path="/reports/client/:id" element={<RequireAuth><ClientPage /></RequireAuth>} />
      <Route path="/metrics" element={<Navigate to="/reports" replace />} />
      <Route path="/crm/clients" element={<RequireAuth><ClientsPage /></RequireAuth>} />
      <Route path="/crm/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/crm/schedule" element={<RequireAuth><PlaceholderPage title="Расписание" /></RequireAuth>} />
      <Route path="/crm/funnel" element={<RequireAuth><FunnelPage /></RequireAuth>} />
      <Route path="/crm/cashier" element={<RequireAuth><KassaPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <Toaster />
    </ConfirmProvider>
  );
}
