import { useState, useEffect, useRef, useCallback } from 'react';
import CashClosing from './CashClosing';

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
  scope: 'shared' | 'personal';
  done: DoneInfo | null;
  stories_today?: Story[];
}

interface WeekReel {
  id: string;
  title: string;
  day_iso: number;
  day_name: string;
  date: string;
  status: 'done' | 'overdue' | 'pending';
}

interface DayData {
  date: string;
  day_of_week: string;
  is_weekend: boolean;
  user: { id: string; display_name: string; role: string };
  tasks: Task[];
  stats: { total: number; done: number; overdue: number };
}

interface Shift {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
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

function fmtHHMM(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

function fmtDuration(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export default function ManagerPage() {
  const [data, setData] = useState<DayData | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const lastOverdue = useRef(-1);

  // Shift state
  const [shiftData, setShiftData] = useState<{
    my_shift: Shift | null;
    on_shift: { name: string; started_at: string }[];
  } | null>(null);
  const [weekReels, setWeekReels] = useState<WeekReel[]>([]);
  const [shiftUsers, setShiftUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [replacing, setReplacing] = useState('');
  const [commentStart, setCommentStart] = useState('');
  const [commentEnd, setCommentEnd] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftErr, setShiftErr] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [showCashClosing, setShowCashClosing] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

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

  const loadShift = useCallback(async () => {
    try {
      const r = await fetch('/kviz/api/shifts/current', { credentials: 'include' });
      if (r.ok) setShiftData(await r.json());
    } catch {}
  }, []);

  const loadWeekReels = useCallback(async () => {
    try {
      const r = await fetch('/kviz/api/manager/week-reels', { credentials: 'include' });
      if (r.ok) setWeekReels(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadShift();
    loadWeekReels();
    fetch('/kviz/api/shifts/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((d: unknown) => setShiftUsers(Array.isArray(d) ? d as { id: string; display_name: string }[] : []))
      .catch(() => {});
    const t = setInterval(() => { load(); loadShift(); loadWeekReels(); }, 30_000);
    return () => clearInterval(t);
  }, [load, loadShift, loadWeekReels]);

  const startShift = async () => {
    setShiftBusy(true); setShiftErr(null);
    try {
      const r = await fetch('/kviz/api/shifts/start', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacing: replacing || undefined, comment: commentStart || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setCommentStart(''); setReplacing('');
      await loadShift();
    } catch (e) { setShiftErr(String(e)); }
    finally { setShiftBusy(false); }
  };

  const endShift = async () => {
    setShiftBusy(true); setShiftErr(null);
    try {
      const r = await fetch('/kviz/api/shifts/end', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: commentEnd || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setConfirmEnd(false); setCommentEnd('');
      await loadShift();
    } catch (e) { setShiftErr(String(e)); }
    finally { setShiftBusy(false); }
  };

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {user.role === 'admin' && (
            <a href="/kviz/manager/admin" style={s.adminLink}>⚙ Настройки</a>
          )}
          <button onClick={() => setShowCashClosing(true)} style={s.btnCashClose}>Закрытие смены</button>
        </div>
      </div>
      {showCashClosing && <CashClosing onClose={() => setShowCashClosing(false)} />}

      {/* Shift block */}
      {shiftData !== null && (
        <div style={s.shiftBlock}>
          {shiftData.my_shift?.status === 'open' ? (
            <>
              <div style={s.shiftActive}>
                На смене с {fmtHHMM(shiftData.my_shift.started_at)} · {fmtDuration(shiftData.my_shift.started_at)}
              </div>
              {!confirmEnd ? (
                <button style={s.btnEndShift} onClick={() => setConfirmEnd(true)}>Закончить смену</button>
              ) : (
                <div>
                  <input
                    style={s.shiftInput}
                    placeholder="Комментарий к закрытию (необязательно)"
                    value={commentEnd}
                    onChange={e => setCommentEnd(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={s.btnEndConfirm} disabled={shiftBusy} onClick={endShift}>
                      {shiftBusy ? '...' : 'Подтвердить'}
                    </button>
                    <button style={s.btnCancelEnd} onClick={() => { setConfirmEnd(false); setCommentEnd(''); }}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {shiftErr && <div style={s.shiftErr}>{shiftErr}</div>}
            </>
          ) : (
            <>
              <div style={s.shiftInactive}>Вы не на смене</div>
              <div style={s.shiftForm}>
                {shiftUsers.length > 0 && (
                  <select style={s.shiftSelect} value={replacing} onChange={e => setReplacing(e.target.value)}>
                    <option value="">Замена (необязательно)</option>
                    {shiftUsers.map(u => <option key={u.id} value={u.display_name}>{u.display_name}</option>)}
                  </select>
                )}
                <input
                  style={s.shiftInput}
                  placeholder="Комментарий (необязательно)"
                  value={commentStart}
                  onChange={e => setCommentStart(e.target.value)}
                />
                <button style={s.btnStartShift} disabled={shiftBusy} onClick={startShift}>
                  {shiftBusy ? '...' : 'Начать смену'}
                </button>
              </div>
              {shiftErr && <div style={s.shiftErr}>{shiftErr}</div>}
            </>
          )}
          {shiftData.on_shift.length > 0 && (
            <div style={s.onShift}>
              Сейчас на смене: {shiftData.on_shift.map(ws => `${ws.name} (с ${fmtHHMM(ws.started_at)})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {weekReels.length > 0 && (
        <div style={s.weekReels}>
          <div style={s.weekReelsHdr}>На этой неделе</div>
          {weekReels.map(r => (
            <div key={`${r.id}:${r.day_iso}`} style={s.reelRow}>
              <span style={s.reelDay}>{r.day_name}</span>
              <span style={s.reelTitle}>{r.title}</span>
              <span>{r.status === 'done' ? '✅' : r.status === 'overdue' ? '❌' : '⏳'}</span>
            </div>
          ))}
        </div>
      )}

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
            {task.done && task.scope === 'shared' && (
              <div style={s.doneInfo}>
                ✓ {task.done.done_by_name} · {new Date(task.done.done_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}
              </div>
            )}
            {task.done && task.scope === 'personal' && (
              <div style={s.doneInfo}>✓ Готово</div>
            )}
            {!task.done && task.scope === 'personal' && (
              <div style={{ ...s.doneInfo, color: '#94a3b8' }}>личная задача</div>
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
              {/касс/i.test(task.title) && (
                <button style={s.btnCashClose} onClick={() => setShowCashClosing(true)}>X-отчёт</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:          { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" },
  center:        { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontFamily: 'system-ui,sans-serif' },
  header:        { padding: '14px 16px 10px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'sticky', top: 0, zIndex: 10 },
  dateLabel:     { fontSize: 15, fontWeight: 700, color: '#1a202c' },
  statsRow:      { display: 'flex', gap: 12, marginTop: 4 },
  statAll:       { fontSize: 13, color: '#64748b' },
  adminLink:     { fontSize: 13, color: '#263CD9', textDecoration: 'none', flexShrink: 0 },
  btnCashClose:  { padding: '5px 12px', background: '#263CD9', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  shiftBlock:    { background: '#fff', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' },
  shiftActive:   { fontSize: 15, fontWeight: 700, color: '#02BDB6', marginBottom: 8 },
  shiftInactive: { fontSize: 14, fontWeight: 600, color: '#64748b', marginBottom: 8 },
  shiftForm:     { display: 'flex', flexDirection: 'column', gap: 8 },
  shiftInput:    { padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  shiftSelect:   { padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' },
  btnStartShift: { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
  btnEndShift:   { padding: '7px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  btnEndConfirm: { padding: '7px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  btnCancelEnd:  { padding: '7px 14px', background: 'none', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  onShift:       { fontSize: 12, color: '#64748b', marginTop: 8 },
  shiftErr:      { fontSize: 12, color: '#ef4444', marginTop: 4 },
  weekReels:     { background: '#fff', padding: '10px 16px', borderBottom: '1px solid #e2e8f0' },
  weekReelsHdr:  { fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 },
  reelRow:       { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' },
  reelDay:       { fontSize: 12, fontWeight: 700, color: '#64748b', width: 22, flexShrink: 0 },
  reelTitle:     { fontSize: 13, color: '#1a202c', flex: 1 },
  list:          { padding: '12px 12px 32px' },
  card:          { background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTop:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  slot:          { fontSize: 13, fontWeight: 700, color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  badge:         { fontSize: 11, fontWeight: 700, color: '#fff', borderRadius: 6, padding: '2px 8px' },
  title:         { fontSize: 15, fontWeight: 600, color: '#1a202c', marginBottom: 4 },
  hint:          { fontSize: 13, color: '#64748b', marginBottom: 6 },
  doneInfo:      { fontSize: 12, color: '#22c55e', fontWeight: 500, marginBottom: 6 },
  stories:       { background: '#f0fdf4', borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  storiesHdr:    { fontSize: 12, fontWeight: 600, color: '#15803d', marginBottom: 4 },
  storyRow:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', gap: 8 },
  storyIdea:     { fontSize: 13, color: '#1a202c', flex: 1 },
  copyBtn:       { fontSize: 11, fontWeight: 600, color: '#263CD9', background: 'none', border: '1px solid #263CD9', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' },
  actions:       { display: 'flex', gap: 8, marginTop: 8 },
  btnDone:       { padding: '7px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  btnCancel:     { padding: '7px 16px', background: 'none', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
};
