import { useState, useEffect, useRef } from 'react';
import { FbImportModal } from '../FunnelsSettings';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BookingsJob {
  status: string;
  total_clients?: number;
  done_clients?: number;
  stats?: {
    created: number; updated: number; to_virtual: number;
    skipped_no_device: number; skipped_client_overlap: number;
    skipped_unknown_status: number; errors: number;
  };
  errors?: string[];
  started_at?: string;
  finished_at?: string;
}

interface HiJob {
  status: string;
  kind?: string;
  total_clients?: number;
  done_clients?: number;
  stats?: { plans_upserted: number; sales_upserted: number; visits_upserted: number };
  errors?: string[];
  started_at?: string;
  finished_at?: string;
}

interface CrmFunnel { id: string; name: string }

// ── API ────────────────────────────────────────────────────────────────────────

async function apiFetch(url: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusColor(s: string) {
  if (s === 'running') return '#d97706';
  if (s === 'done')    return '#16a34a';
  if (s === 'error')   return '#dc2626';
  return 'var(--text-3)';
}

// ── Card skeleton ──────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Btn({ onClick, loading, children, danger }: { onClick: () => void; loading?: boolean; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ padding: '7px 16px', background: danger ? 'var(--danger)' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
      {loading ? '…' : children}
    </button>
  );
}

// ── Bookings import card ───────────────────────────────────────────────────────

function BookingsCard() {
  const [job, setJob]     = useState<BookingsJob | null>(null);
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    poll();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function poll() {
    try {
      const { ok, data } = await apiFetch('/kviz/api/crm/fb-sync/bookings/status');
      if (ok) setJob(data as BookingsJob);
    } catch {}
  }

  async function start() {
    setErr('');
    setLoading(true);
    try {
      const { ok, data } = await apiFetch('/kviz/api/crm/fb-sync/bookings/start', 'POST');
      if (!ok) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); setLoading(false); return; }
      timerRef.current = setInterval(() => {
        poll().then(() => {
          if (job?.status === 'done' || job?.status === 'error') {
            if (timerRef.current) clearInterval(timerRef.current);
          }
        });
      }, 2500);
      poll();
    } catch { setErr('Не удалось запустить'); }
    setLoading(false);
  }

  const running = job?.status === 'running';

  return (
    <Card title="Записи и посещения">
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
        Переносит записи Fitbase в Расписание CRM. Обновляет статусы существующих записей.
      </div>
      {job && job.status !== 'idle' && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: statusColor(job.status) }}>{job.status === 'running' ? 'Идёт…' : job.status === 'done' ? 'Готово' : 'Ошибка'}</span>
            {running && job.total_clients ? (
              <span style={{ color: 'var(--text-2)' }}>{job.done_clients ?? 0} / {job.total_clients} клиентов</span>
            ) : null}
            {job.finished_at && <span style={{ color: 'var(--text-3)' }}>в {fmtTime(job.finished_at)}</span>}
          </div>
          {job.stats && (
            <div style={{ color: 'var(--text-2)' }}>
              Создано: {job.stats.created}
              {job.stats.updated > 0 ? ` · обновлено: ${job.stats.updated}` : ''}
              {job.stats.to_virtual > 0 ? ` · на виртуальных: ${job.stats.to_virtual}` : ''}
              {(job.stats.skipped_no_device + job.stats.skipped_client_overlap + job.stats.skipped_unknown_status) > 0
                ? ` · пропущено: ${job.stats.skipped_no_device + job.stats.skipped_client_overlap + job.stats.skipped_unknown_status}` : ''}
              {` · ошибок: ${job.stats.errors}`}
            </div>
          )}
          {(job.errors?.length ?? 0) > 0 && (
            <div style={{ color: 'var(--danger)', marginTop: 4, maxHeight: 60, overflowY: 'auto', fontSize: 11 }}>
              {job.errors?.slice(-3).join(' | ')}
            </div>
          )}
        </div>
      )}
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <Btn onClick={start} loading={loading || running}>
        {running ? 'Идёт импорт…' : 'Запустить импорт'}
      </Btn>
      {running && (
        <button onClick={poll} style={{ marginLeft: 8, padding: '7px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-2)' }}>
          Обновить статус
        </button>
      )}
    </Card>
  );
}

// ── Leads (Заявки) import card ─────────────────────────────────────────────────

function LeadsCard() {
  const [funnels, setFunnels]   = useState<CrmFunnel[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    apiFetch('/kviz/api/crm/funnels').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setFunnels(data as CrmFunnel[]);
    });
  }, []);

  return (
    <Card title="Заявки">
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
        Переносит заявки из воронок Fitbase в CRM с маппингом этапов.
      </div>
      <Btn onClick={() => setModalOpen(true)}>Перенести заявки из Fitbase</Btn>
      {modalOpen && <FbImportModal funnels={funnels as never} onClose={() => setModalOpen(false)} />}
    </Card>
  );
}

// ── History import card ────────────────────────────────────────────────────────

function HistoryCard() {
  const [job, setJob]     = useState<HiJob | null>(null);
  const [err, setErr]     = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    poll();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function poll() {
    try {
      const { ok, data } = await apiFetch('/kviz/api/crm/fitbase-history-import/status');
      if (ok) setJob(data as HiJob);
    } catch {}
  }

  async function start(kind: 'full' | 'nightly') {
    setErr('');
    try {
      const { ok, data, status } = await apiFetch('/kviz/api/crm/fitbase-history-import', 'POST', { kind });
      if (!ok && status !== 409) { setErr((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
      timerRef.current = setInterval(poll, 2500);
      poll();
    } catch { setErr('Не удалось запустить'); }
  }

  const running = job?.status === 'running';

  return (
    <Card title="История покупок и посещений">
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
        Полный / ночной импорт абонементов, продаж и визитов из Fitbase в историю клиентов CRM.
      </div>
      {job && job.status !== 'idle' && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: statusColor(job.status) }}>
              {job.status === 'running' ? 'Идёт…' : job.status === 'done' ? 'Готово' : 'Ошибка'}
            </span>
            {running && job.total_clients ? (
              <span style={{ color: 'var(--text-2)' }}>{job.done_clients ?? 0} / {job.total_clients} клиентов</span>
            ) : null}
            {job.finished_at && <span style={{ color: 'var(--text-3)' }}>в {fmtTime(job.finished_at)}</span>}
          </div>
          {job.stats && (
            <div style={{ color: 'var(--text-2)' }}>
              Планы: {job.stats.plans_upserted} · продажи: {job.stats.sales_upserted} · визиты: {job.stats.visits_upserted}
            </div>
          )}
          {(job.errors?.length ?? 0) > 0 && (
            <div style={{ color: 'var(--danger)', marginTop: 4, maxHeight: 60, overflowY: 'auto', fontSize: 11 }}>
              {job.errors?.slice(-3).join(' | ')}
            </div>
          )}
        </div>
      )}
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={() => start('nightly')} loading={running}>
          {running ? 'Идёт импорт…' : 'Ночной импорт'}
        </Btn>
        <button onClick={() => start('full')} disabled={running}
          style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: running ? 'wait' : 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>
          Полный (медленно)
        </button>
      </div>
    </Card>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function FbSyncSettings() {
  return (
    <div style={{ padding: '16px 20px 60px', fontFamily: "'Manrope',system-ui,sans-serif", maxWidth: 700 }}>
      <BookingsCard />
      <LeadsCard />
      <HistoryCard />
    </div>
  );
}
