import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../api';
import { TEMP_BADGES, TEMP_COLORS, EARLY_CLOSE_REASONS } from '../config/qualify';

interface Session {
  id: string; consultant: string; status: string;
  temperature?: string; score?: number; created_at: string; completed_at?: string;
  client_name?: string; client_phone?: string;
  answers?: { closed_early?: { reason: string; comment?: string } };
}

const TEMPERATURES = [
  { value: '', label: 'Все' },
  { value: 'hot', label: '🔥 Горячий' },
  { value: 'warm', label: '🌤 Тёплый' },
  { value: 'cold', label: '❄️ Холодный' },
  { value: 'stop', label: '⛔ Стоп' },
  { value: 'postpone', label: '⏸ Отложить' },
];

export default function HistoryPage() {
  const navigate = useNavigate();
  const [all, setAll] = useState<Session[]>([]);
  const [filters, setFilters] = useState({ from: '', to: '', temperature: '', consultant: '', search: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.temperature) params.set('temperature', filters.temperature);
    if (filters.consultant) params.set('consultant', filters.consultant);
    if (filters.search) params.set('search', filters.search);
    const data = await apiGet(`/api/sessions?${params}`);
    setAll(data);
  }

  function set(k: keyof typeof filters, v: string) {
    setFilters(f => ({ ...f, [k]: v }));
  }

  useEffect(() => { load(); }, [filters]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>История</h1>
        <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}
          onClick={() => navigate('/')}>
          ← Главная
        </button>
      </div>

      <div className="filter-bar">
        <input type="date" value={filters.from} onChange={e => set('from', e.target.value)} placeholder="С" title="От" />
        <input type="date" value={filters.to} onChange={e => set('to', e.target.value)} placeholder="По" title="До" />
        <select value={filters.temperature} onChange={e => set('temperature', e.target.value)}>
          {TEMPERATURES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="text" value={filters.consultant} onChange={e => set('consultant', e.target.value)}
          placeholder="Консультант" style={{ width: 140 }} />
        <input type="text" value={filters.search} onChange={e => set('search', e.target.value)}
          placeholder="Имя или телефон" style={{ width: 160 }} />
      </div>

      <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>
        Найдено: {all.length}
      </div>

      {all.map(s => (
        <div key={s.id} className="session-card" onClick={() => navigate(s.status === 'draft' ? `/q/${s.id}/${1}` : `/q/${s.id}/summary`)}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.temperature && (
                <span className="temp-dot" style={{ background: TEMP_COLORS[s.temperature] }} />
              )}
              <span style={{ fontWeight: 600 }}>{s.client_name ?? 'Без имени'}</span>
              <span style={{ fontSize: 13, color: '#9ca3af' }}>{s.status === 'draft' ? 'черновик' : ''}</span>
            </div>
            <div className="meta" style={{ color: '#6b7280', fontSize: 13 }}>{s.consultant}</div>
            {s.client_phone && <div style={{ fontSize: 12, color: '#9ca3af' }}>{s.client_phone}</div>}
            <div className="meta">
              {fmtDate(s.completed_at ?? s.created_at)}
              {s.temperature && ` · ${TEMP_BADGES[s.temperature]}`}
              {s.score !== undefined && s.score !== null ? ` · ${s.score} пт` : ''}
            </div>
            {s.answers?.closed_early && (
              <div className="meta" style={{ color: '#9ca3af' }}>
                Закрыта досрочно: {EARLY_CLOSE_REASONS.find(r => r.id === s.answers!.closed_early!.reason)?.label ?? s.answers.closed_early.reason}
              </div>
            )}
          </div>
          <span style={{ color: '#c4c9d4', fontSize: 20 }}>›</span>
        </div>
      ))}

      {all.length === 0 && (
        <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 48 }}>
          Квалификаций не найдено
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
