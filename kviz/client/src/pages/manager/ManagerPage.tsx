import { useState, useEffect, useRef, useCallback } from 'react';
import CashClosing from './CashClosing';
import LeadDrawer from '../crm/LeadDrawer';
import MyMonthPage from './MyMonthPage';

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
  const [subTab, setSubTab] = useState<'checklist' | 'mymonth'>('checklist');
  const [meRole, setMeRole] = useState('');
  const [meId, setMeId]     = useState('');

  useEffect(() => {
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : {})
      .then(d => { setMeRole(d?.role ?? ''); setMeId(d?.id ?? ''); })
      .catch(() => {});
  }, []);

  const [data, setData] = useState<DayData | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
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

  // Check-in state
  const [checkinStatus, setCheckinStatus] = useState<{ trusted: boolean; device_name: string | null; hide_on_mobile: boolean } | null>(null);
  const [checkinOpen, setCheckinOpen]     = useState<'in' | 'out' | null>(null);
  const [checkinPhoto, setCheckinPhoto]   = useState<string | null>(null);
  const [checkinRole, setCheckinRole]     = useState<'call_center' | 'consultant' | ''>('');
  const [requireRole, setRequireRole]     = useState(false);
  const [checkinBusy, setCheckinBusy]     = useState(false);
  const [checkinErr,  setCheckinErr]      = useState('');
  const [checkinOk,   setCheckinOk]       = useState(false);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
    } catch { setCheckinErr('Нет доступа к камере'); }
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function capturePhoto() {
    if (!videoRef.current) return;
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 240;
    cv.getContext('2d')?.drawImage(videoRef.current, 0, 0, 320, 240);
    setCheckinPhoto(cv.toDataURL('image/jpeg', 0.7));
    stopStream();
  }

  async function submitCheckin() {
    if (!checkinPhoto || checkinBusy) return;
    setCheckinBusy(true); setCheckinErr('');
    try {
      const body: Record<string, unknown> = {
        type: checkinOpen,
        photo: checkinPhoto.replace(/^data:image\/\w+;base64,/, ''),
      };
      if (checkinRole) body.role = checkinRole;
      const r = await fetch('/kviz/api/checkin/mark', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.status === 400 && d.require_role) { setRequireRole(true); setCheckinBusy(false); return; }
      if (!r.ok) { setCheckinErr(d.error || 'Ошибка'); setCheckinBusy(false); return; }
      setCheckinOk(true);
      setTimeout(() => { setCheckinOpen(null); setCheckinOk(false); stopStream(); }, 1500);
    } catch (e) { setCheckinErr(String(e)); }
    setCheckinBusy(false);
  }

  function openCheckinModal(type: 'in' | 'out') {
    setCheckinOpen(type); setCheckinPhoto(null);
    setRequireRole(false); setCheckinRole('');
    setCheckinErr(''); setCheckinOk(false);
  }

  function closeCheckinModal() {
    setCheckinOpen(null); stopStream(); setCheckinPhoto(null);
    setRequireRole(false); setCheckinRole(''); setCheckinErr(''); setCheckinOk(false);
  }

  // Start camera when modal opens; stop when it closes
  useEffect(() => {
    if (checkinOpen) void startCamera();
    return () => stopStream();
  }, [checkinOpen, startCamera]);

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
    fetch('/kviz/api/checkin/device-status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(setCheckinStatus).catch(() => {});
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
      const r = await fetch(`/kviz/api/manager/tasks/${taskId}/done`, { method: 'POST', credentials: 'include' });
      const json = await r.json();
      if (json.already && json.message) {
        setToast(json.message);
        setTimeout(() => setToast(null), 3500);
      }
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

  // Sub-tab strip
  const tabStrip = (
    <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
      {(['checklist', 'mymonth'] as const).map(tab => (
        <button
          key={tab}
          onClick={() => setSubTab(tab)}
          style={{
            padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: subTab === tab ? 700 : 500,
            color: subTab === tab ? '#02BDB6' : '#64748b',
            borderBottom: subTab === tab ? '2px solid #02BDB6' : '2px solid transparent',
            fontFamily: 'inherit', transition: 'all .15s',
          }}
        >
          {tab === 'checklist' ? 'Чек-лист' : 'Мой месяц'}
        </button>
      ))}
    </div>
  );

  if (subTab === 'mymonth') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'Manrope',system-ui,sans-serif" }}>
        {tabStrip}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {meId ? <MyMonthPage role={meRole} sessionUserId={meId} /> : <div style={s.center}>Загрузка...</div>}
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif" }}>{tabStrip}<div style={s.center}>Загрузка...</div></div>;
  if (err && !data) return <div style={s.center}>Ошибка: {err}</div>;
  if (!data) return null;

  const { tasks, stats, user } = data;
  const dateStr = data.date.split('-').reverse().join('.');

  return (
    <div style={s.root}>
      {tabStrip}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}
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

      {/* Check-in block: only on trusted device */}
      {checkinStatus?.trusted && !(checkinStatus.hide_on_mobile && window.innerWidth <= 640) && (
        <div style={s.checkinBlock}>
          <div style={s.checkinLabel}>{checkinStatus.device_name ?? 'Студия'}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.btnCheckinIn}  onClick={() => openCheckinModal('in')}>Пришла</button>
            <button style={s.btnCheckinOut} onClick={() => openCheckinModal('out')}>Ушла</button>
          </div>
        </div>
      )}

      {/* Check-in modal */}
      {checkinOpen && (
        <div style={s.ciOverlay} onClick={closeCheckinModal}>
          <div style={s.ciModal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{checkinOpen === 'in' ? '📸 Пришла на смену' : '📸 Ушла со смены'}</div>
              <button style={s.iconBtn} onClick={closeCheckinModal}>✕</button>
            </div>
            {checkinOk ? (
              <div style={{ textAlign: 'center', color: '#16a34a', fontSize: 15, fontWeight: 700, padding: '20px 0' }}>✓ Отметка принята</div>
            ) : (
              <>
                {checkinErr && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{checkinErr}</div>}
                {!checkinPhoto ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000', display: 'block' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button style={s.btnCancelEnd} onClick={closeCheckinModal}>Отмена</button>
                      <button style={s.btnStartShift} onClick={capturePhoto}>Сделать фото</button>
                    </div>
                  </>
                ) : (
                  <>
                    <img src={checkinPhoto} alt="" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
                    {requireRole && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' }}>Укажите роль:</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {(['call_center', 'consultant'] as const).map(r => (
                            <button key={r} onClick={() => setCheckinRole(r)}
                              style={{ flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${checkinRole === r ? '#02BDB6' : '#e2e8f0'}`,
                                background: checkinRole === r ? '#e0faf9' : '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
                              {r === 'call_center' ? 'Call Center' : 'Консультант'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button style={s.btnCancelEnd} onClick={() => { setCheckinPhoto(null); setCheckinErr(''); setRequireRole(false); void startCamera(); }}>Переснять</button>
                      <button style={s.btnStartShift} disabled={checkinBusy || (requireRole && !checkinRole)} onClick={() => void submitCheckin()}>
                        {checkinBusy ? '…' : 'Отправить'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
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

      <TrialsTodaySection />
      <LeadTasksSection />
    </div>
  );
}

// ── Trials Today Section ───────────────────────────────────────────────────────

interface TrialToday {
  fitbase_visit_id: string;
  client_name: string | null;
  visit_time: string;
  status: number;
  reminder_status: 'none' | 'pending' | 'sent' | 'cancelled';
  confirmed: boolean;
}

function TrialsTodaySection() {
  const [trials, setTrials] = useState<TrialToday[]>([]);

  useEffect(() => {
    fetch('/kviz/api/manager/trials-today', { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setTrials(d); }).catch(() => {});
  }, []);

  if (!trials.length) return null;

  const remLabel = (t: TrialToday) => {
    if (t.confirmed) return '✅ Подтвердила';
    if (t.reminder_status === 'sent') return '🔔 Напоминание отправлено';
    if (t.reminder_status === 'pending') return '⏳ Напоминание запланировано';
    return '';
  };

  return (
    <div style={{ margin: '0 0 12px', padding: '10px 16px', background: '#f0fdf4', borderRadius: 10, borderLeft: '3px solid #16a34a' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>
        🧪 Пробные сегодня
      </div>
      {trials.map(t => (
        <div key={t.fitbase_visit_id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#1a202c', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, minWidth: 42 }}>{t.visit_time}</span>
          <span style={{ flex: 1 }}>{t.client_name ?? '—'}</span>
          <span style={{ color: t.confirmed ? '#16a34a' : '#64748b', fontSize: 12 }}>{remLabel(t)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Lead Tasks Section ─────────────────────────────────────────────────────────

interface LeadTask {
  id: string; description: string; status: string; due_at: string | null;
  is_overdue: boolean; lead_id: string | null;
  crm_leads?: { id: string; title: string | null; name: string | null; surname: string | null } | null;
}
interface Funnel { id: string; name: string; stages: { id: string; name: string; kind: string; sort: number; is_archived: boolean }[] }

function leadDisplayName(t: LeadTask) {
  const l = t.crm_leads;
  if (!l) return '';
  const composed = [l.name, l.surname].filter(Boolean).join(' ');
  return l.title || composed || '';
}

function todayStr() {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function LeadTasksSection() {
  const [tasks, setTasks]       = useState<LeadTask[]>([]);
  const [funnels, setFunnels]   = useState<Funnel[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState<Record<string, boolean>>({});
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin]   = useState(false);
  const [meId, setMeId]         = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('me');
  const [appUsers, setAppUsers] = useState<{ id: string; display_name: string }[]>([]);

  function load(uid?: string) {
    const uidToUse = uid ?? filterUser;
    const params = new URLSearchParams({ status: 'open' });
    if (uidToUse && uidToUse !== 'all') params.set('responsible_user_id', uidToUse === 'me' ? meId : uidToUse);
    fetch(`/kviz/api/crm/lead-tasks?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setTasks(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    fetch('/kviz/api/me', { credentials: 'include' }).then(r => r.json()).then(d => {
      const admin = d?.role === 'admin';
      setIsAdmin(admin);
      setMeId(d?.id ?? '');
      if (!admin) {
        // non-admin: fetch their tasks immediately
        const params = new URLSearchParams({ status: 'open' });
        if (d?.id) params.set('responsible_user_id', d.id);
        fetch(`/kviz/api/crm/lead-tasks?${params}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : [])
          .then(dd => { setTasks(Array.isArray(dd) ? dd : []); setLoading(false); })
          .catch(() => setLoading(false));
      } else {
        // admin: load all, also fetch app users for filter
        fetch('/kviz/api/crm/lead-tasks?status=open', { credentials: 'include' })
          .then(r => r.ok ? r.json() : [])
          .then(dd => { setTasks(Array.isArray(dd) ? dd : []); setLoading(false); })
          .catch(() => setLoading(false));
        fetch('/kviz/api/crm/app-users', { credentials: 'include' })
          .then(r => r.ok ? r.json() : []).then(dd => setAppUsers(Array.isArray(dd) ? dd : [])).catch(() => {});
      }
    }).catch(() => setLoading(false));

    fetch('/kviz/api/crm/funnels', { credentials: 'include' })
      .then(r => r.ok ? r.json() : []).then(d => setFunnels(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function handleFilterChange(uid: string) {
    setFilterUser(uid);
    setLoading(true);
    const params = new URLSearchParams({ status: 'open' });
    if (uid && uid !== 'all') params.set('responsible_user_id', uid === 'me' ? meId : uid);
    fetch(`/kviz/api/crm/lead-tasks?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setTasks(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  async function markDone(task: LeadTask) {
    setBusy(b => ({ ...b, [task.id]: true }));
    try {
      await fetch(`/kviz/api/crm/lead-tasks/${task.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } finally { setBusy(b => ({ ...b, [task.id]: false })); }
  }

  const today = todayStr();
  const overdue = tasks.filter(t => t.due_at && t.due_at.slice(0, 10) < today);
  const dueToday = tasks.filter(t => t.due_at && t.due_at.slice(0, 10) === today);
  const later = tasks.filter(t => !t.due_at || t.due_at.slice(0, 10) > today);

  if (loading) return null;
  if (tasks.length === 0) return null;

  function renderGroup(label: string, color: string, group: LeadTask[]) {
    if (!group.length) return null;
    return (
      <div key={label}>
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 5, marginTop: 10 }}>{label} ({group.length})</div>
        {group.map(t => {
          const name = leadDisplayName(t);
          return (
            <div key={t.id} style={{ background: t.is_overdue ? '#fff0f4' : '#fff', borderRadius: 10, border: `1px solid ${t.is_overdue ? '#fca5a5' : '#e2e8f0'}`, padding: '9px 12px', marginBottom: 5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#1a202c', marginBottom: 2, wordBreak: 'break-word' }}>{t.description}</div>
                {name && (
                  <div
                    style={{ fontSize: 11, color: '#263CD9', cursor: 'pointer', textDecoration: 'underline', marginBottom: 2 }}
                    onClick={() => t.lead_id && setOpenLeadId(t.lead_id)}
                  >
                    Заявка: {name}
                  </div>
                )}
                {t.due_at && <div style={{ fontSize: 11, color: t.is_overdue ? '#ef4444' : '#94a3b8' }}>{t.due_at.slice(0, 10).split('-').reverse().join('.')}{t.is_overdue ? ' — просрочено' : ''}</div>}
              </div>
              <button
                disabled={busy[t.id]}
                onClick={() => markDone(t)}
                style={{ padding: '4px 10px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                {busy[t.id] ? '...' : 'Готово'}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ margin: '0 0 16px', padding: '12px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: '0.04em', flex: 1 }}>Задачи по заявкам</span>
        {isAdmin && appUsers.length > 0 && (
          <select
            value={filterUser}
            onChange={e => handleFilterChange(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}
          >
            <option value="all">Все</option>
            {appUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
        )}
      </div>
      {renderGroup('Просрочено', '#ef4444', overdue)}
      {renderGroup('Сегодня', '#f59e0b', dueToday)}
      {renderGroup('Дальше', '#64748b', later)}

      {openLeadId && (
        <LeadDrawer
          leadId={openLeadId}
          funnels={funnels}
          onClose={() => setOpenLeadId(null)}
          onSaved={() => setOpenLeadId(null)}
          onDeleted={() => { setOpenLeadId(null); setTasks(prev => prev.filter(t => t.lead_id !== openLeadId)); }}
        />
      )}
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
  checkinBlock:  { background: '#fff', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 },
  checkinLabel:  { fontSize: 12, color: '#64748b', fontWeight: 600, flex: 1 },
  btnCheckinIn:  { padding: '8px 20px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  btnCheckinOut: { padding: '8px 20px', background: '#f8fafc', color: '#374151', border: '1.5px solid #e2e8f0', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  ciOverlay:     { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 },
  ciModal:       { background: '#fff', borderRadius: 16, padding: 24, width: 'min(400px,95vw)', maxHeight: '90dvh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,.25)' },
  iconBtn:       { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#64748b', padding: '2px 6px' },
};
