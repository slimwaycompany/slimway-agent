import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../api';
import { TEMP_BADGES, TEMP_COLORS, EARLY_CLOSE_REASONS } from '../config/qualify';

interface Session {
  id: string; consultant: string; status: string; current_step: number;
  temperature?: string; score?: number; created_at: string; completed_at?: string;
  client_name?: string; client_phone?: string;
  answers?: { closed_early?: { reason: string; comment?: string } };
}

const CONSULTANT_KEY = 'sw_consultant';

export default function HomePage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [consultant, setConsultant] = useState(localStorage.getItem(CONSULTANT_KEY) ?? '');
  const [editingName, setEditingName] = useState(!localStorage.getItem(CONSULTANT_KEY));
  const [nameInput, setNameInput] = useState(consultant);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (editingName) nameRef.current?.focus(); }, [editingName]);

  async function load() {
    const data = await apiGet('/api/sessions');
    setSessions(data);
  }

  function saveName() {
    const n = nameInput.trim();
    if (!n) return;
    localStorage.setItem(CONSULTANT_KEY, n);
    setConsultant(n);
    setEditingName(false);
  }

  async function newSession() {
    if (!consultant) { setEditingName(true); return; }
    const s = await apiPost('/api/sessions', { consultant });
    navigate(`/q/${s.id}/1`);
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Удалить черновик?')) return;
    await apiDelete(`/api/sessions/${id}`);
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  const drafts = sessions.filter(s => s.status === 'draft');
  const done = sessions.filter(s => s.status === 'done').slice(0, 20);

  async function logout() {
    await fetch('/kviz/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/window';
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>SlimWay</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn-secondary" href="/window" style={{ fontSize: 13, padding: '8px 14px', textDecoration: 'none' }}>← Овчарка</a>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }} onClick={() => navigate('/history')}>
            История
          </button>
        </div>
      </div>

      <div className="consultant-bar">
        {editingName ? (
          <>
            <input ref={nameRef} value={nameInput} onChange={e => setNameInput(e.target.value)}
              placeholder="Ваше имя" onKeyDown={e => e.key === 'Enter' && saveName()} />
            <button className="btn btn-outline" style={{ padding: '6px 14px', fontSize: 14 }} onClick={saveName}>
              Сохранить
            </button>
          </>
        ) : (
          <>
            <span>Консультант: <strong>{consultant}</strong></span>
            <button className="edit-link" onClick={() => { setNameInput(consultant); setEditingName(true); }}>изменить</button>
            <button className="edit-link" style={{ marginLeft: 'auto', color: '#9ca3af' }} onClick={logout}>выйти</button>
          </>
        )}
      </div>

      <button className="btn btn-primary" style={{ width: '100%', fontSize: 18, padding: 18 }} onClick={newSession}>
        + Новая квалификация
      </button>

      {drafts.length > 0 && (
        <>
          <div className="section-title">Незавершённые</div>
          {drafts.map(s => (
            <div key={s.id} className="session-card" onClick={() => navigate(`/q/${s.id}/${s.current_step}`)}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.client_name ?? s.consultant}</div>
                {s.client_name && <div style={{ fontSize: 13, color: '#6b7280' }}>{s.consultant}</div>}
                <div className="meta">Шаг {s.current_step} · {fmtDate(s.created_at)}</div>
              </div>
              <button className="btn btn-danger" style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={e => deleteSession(s.id, e)}>
                Удалить
              </button>
            </div>
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="section-title">Последние завершённые</div>
          {done.map(s => (
            <div key={s.id} className="session-card" onClick={() => navigate(`/q/${s.id}/summary`)}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.client_name ?? 'Без имени'}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{s.consultant}</div>
                <div className="meta">{fmtDate(s.completed_at ?? s.created_at)}</div>
                {s.answers?.closed_early && (
                  <div className="meta" style={{ color: '#9ca3af' }}>
                    Закрыта досрочно: {EARLY_CLOSE_REASONS.find(r => r.id === s.answers!.closed_early!.reason)?.label ?? s.answers.closed_early.reason}
                  </div>
                )}
              </div>
              {s.temperature && (
                <span style={{ background: TEMP_COLORS[s.temperature], color: '#fff', padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {TEMP_BADGES[s.temperature]}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
