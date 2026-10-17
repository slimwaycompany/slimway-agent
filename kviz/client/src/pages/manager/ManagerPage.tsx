import { useState, useEffect, useRef, useCallback } from 'react';

interface DoneInfo {
  done_id: string;
  done_by: string;
  done_by_name: string;
  done_at: string;
}

interface Story {
  id: string;
  slot: string;
  idea: string;
  caption: string | null;
}

interface Task {
  id: string;
  title: string;
  hint: string | null;
  category: string;
  slot_time: string;
  status: 'done' | 'current' | 'overdue' | 'pending';
  done: DoneInfo | null;
  stories_today?: Story[];
}

interface DayData {
  date: string;
  day_of_week: string;
  is_weekend: boolean;
  user: { id: string; display_name: string; role: string };
  tasks: Task[];
  stats: { total: number; done: number; overdue: number };
}

const STATUS_COLOR: Record<Task['status'], string> = {
  done:    '#22c55e',
  current: '#f59e0b',
  overdue: '#ef4444',
  pending: '#94a3b8',
};

const STATUS_LABEL: Record<Task['status'], string> = {
  done:    'Готово',
  current: 'Сейчас',
  overdue: 'Просрочено',
  pending: 'Ожидание',
};

export default function ManagerPage() {
  const [data, setData] = useState<DayData | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const lastOverdue = useRef(-1);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/kviz/api/manager/today', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: DayData = await r.json();
      setData(d);
      setErr(null);
      const ov = d.stats.overdue;
      if (ov !== lastOverdue.current) {
        lastOverdue.current = ov;
        try { window.parent.postMessage({ type: 'manager:overdue', count: ov }, '*'); } catch {}
      }
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const markDone = async (taskId: string) => {
    setBusy(b => ({ ...b, [taskId]: true }));
    try {
      await fetch(`/kviz/api/manager/tasks/${taskId}/done`, { method: 'POST', credentials: 'include' });
      await load();
    } finally { setBusy(b => ({ ...b, [taskId]: false })); }
  };

  const unmarkDone = async (taskId: string) => {
    setBusy(b => ({ ...b, [taskId]: true }));
    try {
      await fetch(`/kviz/api/manager/tasks/${taskId}/done`, { method: 'DELETE', credentials: 'include' });
      await load();
    } finally { setBusy(b => ({ ...b, [taskId]: false })); }
  };

  if (loading) return <div style={s.center}>Загрузка...</div>;
  if (err && !data) return <div style={s.center}>Ошибка: {err}</div>;
  if (!data) return null;

  const { tasks, stats, user } = data;
  const dateStr = data.date.split('-').reverse().join('.');

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.dateLabel}>
            {data.day_of_week}, {dateStr}{data.is_weekend ? ' · выходной' : ''}
          </div>
          <div style={s.statsRow}>
            <span style={s.statAll}>Всего: {stats.total}</span>
            <span style={{ ...s.statAll, color: '#22c55e' }}>Выполнено: {stats.done}</span>
            {stats.overdue > 0 && <span style={{ ...s.statAll, color: '#ef4444' }}>Просрочено: {stats.overdue}</span>}
          </div>
        </div>
        {user.role === 'admin' && (
          <a href="/kviz/manager/admin" style={s.adminLink}>⚙ Настройки</a>
        )}
      </div>

      <div style={s.list}>
        {tasks.map(task => (
          <div key={task.id} style={{ ...s.card, borderLeft: `4px solid ${STATUS_COLOR[task.status]}` }}>
            <div style={s.cardTop}>
              <span style={s.slot}>{task.slot_time}</span>
              <span style={{ ...s.badge, background: STATUS_COLOR[task.status] }}>
                {STATUS_LABEL[task.status]}
              </span>
            </div>
            <div style={s.title}>{task.title}</div>
            {task.hint && <div style={s.hint}>{task.hint}</div>}
            {task.done && (
              <div style={s.doneInfo}>
                ✓ {task.done.done_by_name} · {new Date(task.done.done_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}
              </div>
            )}

            {task.stories_today && task.stories_today.length > 0 && (
              <div style={s.stories}>
                <div style={s.storiesHdr}>Сторисы сегодня:</div>
                {task.stories_today.map(st => (
                  <div key={st.id} style={s.storyRow}>
                    <span style={s.storyIdea}>{st.idea}</span>
                    {st.caption && (
                      <button
                        style={s.copyBtn}
                        onClick={() => navigator.clipboard?.writeText(st.caption!).catch(() => {})}
                      >
                        Скопировать подпись
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={s.actions}>
              {task.status !== 'done' && (
                <button style={s.btnDone} disabled={busy[task.id]} onClick={() => markDone(task.id)}>
                  {busy[task.id] ? '...' : 'Готово'}
                </button>
              )}
              {task.status === 'done' && (task.done?.done_by === user.id || user.role === 'admin') && (
                <button style={s.btnCancel} disabled={busy[task.id]} onClick={() => unmarkDone(task.id)}>
                  {busy[task.id] ? '...' : 'Отменить'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:      { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" },
  center:    { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontFamily: 'system-ui,sans-serif' },
  header:    { padding: '14px 16px 10px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'sticky', top: 0, zIndex: 10 },
  dateLabel: { fontSize: 15, fontWeight: 700, color: '#1a202c' },
  statsRow:  { display: 'flex', gap: 12, marginTop: 4 },
  statAll:   { fontSize: 13, color: '#64748b' },
  adminLink: { fontSize: 13, color: '#263CD9', textDecoration: 'none', flexShrink: 0 },
  list:      { padding: '12px 12px 32px' },
  card:      { background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTop:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  slot:      { fontSize: 13, fontWeight: 700, color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  badge:     { fontSize: 11, fontWeight: 700, color: '#fff', borderRadius: 6, padding: '2px 8px' },
  title:     { fontSize: 15, fontWeight: 600, color: '#1a202c', marginBottom: 4 },
  hint:      { fontSize: 13, color: '#64748b', marginBottom: 6 },
  doneInfo:  { fontSize: 12, color: '#22c55e', fontWeight: 500, marginBottom: 6 },
  stories:   { background: '#f0fdf4', borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  storiesHdr:{ fontSize: 12, fontWeight: 600, color: '#15803d', marginBottom: 4 },
  storyRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', gap: 8 },
  storyIdea: { fontSize: 13, color: '#1a202c', flex: 1 },
  copyBtn:   { fontSize: 11, fontWeight: 600, color: '#263CD9', background: 'none', border: '1px solid #263CD9', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' },
  actions:   { display: 'flex', gap: 8, marginTop: 8 },
  btnDone:   { padding: '7px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  btnCancel: { padding: '7px 16px', background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
};
