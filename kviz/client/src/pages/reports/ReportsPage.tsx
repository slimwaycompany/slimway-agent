import { useState, useCallback, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShiftRecord {
  id: string;
  user_id: string;
  user_name: string;
  shift_date: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  replacing: string | null;
  comment: string | null;
  sheet_synced_start: boolean;
  sheet_synced_end: boolean;
}

interface TaskDone {
  id: string;
  template_id: string;
  task_date: string;
  done_by: string;
  done_by_name: string;
  done_at: string;
  manager_task_templates: { title: string; slot_time: string; category: string };
}

type ActiveTab = 'shifts' | 'tasks' | 'studio';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toYekLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

function fromYekLocal(val: string): string {
  if (!val) return '';
  return new Date(new Date(val + ':00Z').getTime() - 5 * 3600_000).toISOString();
}

function fmtHHMM(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

function fmtDate(iso: string): string {
  return iso.split('-').reverse().join('.');
}

function calcHoursNum(s: ShiftRecord): number {
  if (!s.started_at || !s.ended_at) return 0;
  return (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000;
}

function calcHours(s: ShiftRecord): string {
  if (!s.started_at || !s.ended_at) return '—';
  return calcHoursNum(s).toFixed(1);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 7) + '-01';

const SHIFT_STATUS: Record<string, string> = {
  open: 'открыта', closed: 'закрыта', auto_closed: 'авто',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [tab, setTab] = useState<ActiveTab>('shifts');

  // Shifts
  const [shiftFrom, setShiftFrom] = useState(monthStart);
  const [shiftTo, setShiftTo]     = useState(today);
  const [shifts, setShifts]       = useState<ShiftRecord[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [editShift, setEditShift] = useState<Partial<ShiftRecord> | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftError, setShiftError]   = useState<string | null>(null);

  // Tasks
  const [taskFrom, setTaskFrom] = useState(monthStart);
  const [taskTo, setTaskTo]     = useState(today);
  const [tasks, setTasks]       = useState<TaskDone[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  // Studio
  const [studio, setStudio]           = useState<Record<string, unknown>[]>([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioLoaded, setStudioLoaded]   = useState(false);

  const loadShifts = useCallback(async () => {
    setShiftsLoading(true);
    try {
      const r = await fetch(`/kviz/api/shifts?from=${shiftFrom}&to=${shiftTo}`, { credentials: 'include' });
      setShifts(r.ok ? await r.json() : []);
    } catch {} finally { setShiftsLoading(false); }
  }, [shiftFrom, shiftTo]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const r = await fetch(`/kviz/api/reports/tasks?from=${taskFrom}&to=${taskTo}`, { credentials: 'include' });
      setTasks(r.ok ? await r.json() : []);
    } catch {} finally { setTasksLoading(false); }
  }, [taskFrom, taskTo]);

  const loadStudio = useCallback(async () => {
    if (studioLoaded) return;
    setStudioLoading(true);
    try {
      const r = await fetch('/kviz/api/reports/studio', { credentials: 'include' });
      setStudio(r.ok ? await r.json() : []);
    } catch {} finally { setStudioLoading(false); setStudioLoaded(true); }
  }, [studioLoaded]);

  const saveShift = async () => {
    if (!editShift?.id) return;
    setShiftSaving(true); setShiftError(null);
    try {
      const body: Record<string, unknown> = {};
      if (editShift.started_at !== undefined) body.started_at = editShift.started_at;
      if (editShift.ended_at   !== undefined) body.ended_at   = editShift.ended_at;
      if (editShift.status     !== undefined) body.status     = editShift.status;
      if (editShift.replacing  !== undefined) body.replacing  = editShift.replacing;
      if (editShift.comment    !== undefined) body.comment    = editShift.comment;
      const r = await fetch(`/kviz/api/shifts/${editShift.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setEditShift(null);
      await loadShifts();
    } catch (e) { setShiftError(String(e)); }
    finally { setShiftSaving(false); }
  };

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const sh of shifts) {
      if (!sh.started_at || !sh.ended_at) continue;
      const key = `${sh.user_name}|${sh.shift_date.slice(0, 7)}`;
      map.set(key, (map.get(key) ?? 0) + calcHoursNum(sh));
    }
    return [...map.entries()]
      .map(([k, h]) => { const [name, month] = k.split('|'); return { name, month, hours: h }; })
      .sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
  }, [shifts]);

  const tasksByPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) map.set(t.done_by_name, (map.get(t.done_by_name) ?? 0) + 1);
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [tasks]);

  const exportShiftsCSV = () => {
    const fmtYek = (iso: string | null) => {
      if (!iso) return '';
      const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
    };
    const rows = [
      ['Дата','Сотрудник','Начало','Конец','Часов','Статус','Комментарий','Замена','Таблица'],
      ...shifts.map(sh => [
        sh.shift_date, sh.user_name,
        fmtYek(sh.started_at), fmtYek(sh.ended_at),
        calcHours(sh), sh.status,
        sh.comment ?? '', sh.replacing ?? '',
        sh.sheet_synced_end ? '1' : '0',
      ]),
    ];
    downloadCSV(rows, `shifts_${shiftFrom}_${shiftTo}.csv`);
  };

  const exportTasksCSV = () => {
    const rows = [
      ['Дата','Задача','Слот','Выполнил','Время'],
      ...tasks.map(t => [
        t.task_date,
        t.manager_task_templates?.title ?? '',
        t.manager_task_templates?.slot_time ?? '',
        t.done_by_name,
        fmtTime(t.done_at),
      ]),
    ];
    downloadCSV(rows, `tasks_${taskFrom}_${taskTo}.csv`);
  };

  function downloadCSV(rows: (string | number)[][], filename: string) {
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.title}>Отчёты</span>
      </div>

      <div style={s.tabsBar}>
        <button style={tabBtnSt(tab === 'shifts')} onClick={() => setTab('shifts')}>Смены</button>
        <button style={tabBtnSt(tab === 'tasks')} onClick={() => setTab('tasks')}>Задачи</button>
        <button style={tabBtnSt(tab === 'studio')} onClick={() => { setTab('studio'); loadStudio(); }}>Результаты студии</button>
      </div>

      {/* ── Shifts ── */}
      {tab === 'shifts' && (
        <div style={s.section}>
          <div style={s.filterRow}>
            <input type="date" style={s.dateInp} value={shiftFrom} onChange={e => setShiftFrom(e.target.value)} />
            <span style={s.dash}>—</span>
            <input type="date" style={s.dateInp} value={shiftTo} onChange={e => setShiftTo(e.target.value)} />
            <button style={s.loadBtn} onClick={loadShifts} disabled={shiftsLoading}>{shiftsLoading ? '...' : 'Загрузить'}</button>
            {shifts.length > 0 && <button style={s.csvBtn} onClick={exportShiftsCSV}>CSV</button>}
          </div>

          {shifts.length === 0 && !shiftsLoading && <div style={s.empty}>Нет данных за период</div>}

          {shifts.map(sh => (
            <div key={sh.id} style={shiftRowSt(sh)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.rowTitle}>
                  {fmtDate(sh.shift_date)} · {sh.user_name}
                  {sh.replacing && <span style={s.muted}> (замена: {sh.replacing})</span>}
                </div>
                <div style={s.rowMeta}>
                  {fmtHHMM(sh.started_at)} — {fmtHHMM(sh.ended_at)} · {calcHours(sh)} ч
                  {' · '}{SHIFT_STATUS[sh.status] ?? sh.status}
                  {sh.ended_at && !sh.sheet_synced_end && <span style={s.warn}> ! не в таблице</span>}
                </div>
                {sh.comment && (
                  <div style={{ ...s.rowMeta, marginTop: 2 }}>{sh.comment}</div>
                )}
              </div>
              <button style={s.editBtn} onClick={() => setEditShift({ ...sh })}>Ред.</button>
            </div>
          ))}

          {monthlyTotals.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={s.sectionTitle}>Итого по месяцам</div>
              {monthlyTotals.map(mt => (
                <div key={mt.month + mt.name} style={s.totalRow}>
                  <span>{mt.month} · {mt.name}</span>
                  <span style={{ fontWeight: 700, color: '#02BDB6' }}>{mt.hours.toFixed(1)} ч</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tasks ── */}
      {tab === 'tasks' && (
        <div style={s.section}>
          <div style={s.filterRow}>
            <input type="date" style={s.dateInp} value={taskFrom} onChange={e => setTaskFrom(e.target.value)} />
            <span style={s.dash}>—</span>
            <input type="date" style={s.dateInp} value={taskTo} onChange={e => setTaskTo(e.target.value)} />
            <button style={s.loadBtn} onClick={loadTasks} disabled={tasksLoading}>{tasksLoading ? '...' : 'Загрузить'}</button>
            {tasks.length > 0 && <button style={s.csvBtn} onClick={exportTasksCSV}>CSV</button>}
          </div>

          {tasks.length === 0 && !tasksLoading && <div style={s.empty}>Нет данных за период</div>}

          {tasks.length > 0 && (
            <>
              {tasksByPerson.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={s.sectionTitle}>По сотрудникам</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {tasksByPerson.map(p => (
                      <div key={p.name} style={s.personChip}>{p.name}: {p.count}</div>
                    ))}
                  </div>
                </div>
              )}
              {tasks.map(t => (
                <div key={t.id} style={s.taskRow}>
                  <div style={s.taskDate}>{fmtDate(t.task_date)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.rowTitle}>{t.manager_task_templates?.title ?? t.template_id}</div>
                    <div style={s.rowMeta}>{t.done_by_name} · {fmtTime(t.done_at)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Studio results ── */}
      {tab === 'studio' && (
        <div style={s.section}>
          {studioLoading && <div style={s.empty}>Загрузка...</div>}
          {!studioLoading && studio.length === 0 && <div style={s.empty}>Нет данных</div>}
          {studio.map((row, i) => (
            <div key={String(row.id ?? i)} style={s.studioRow}>
              {Object.entries(row).filter(([k]) => k !== 'id').map(([k, v]) => (
                <div key={k} style={s.studioField}>
                  <span style={s.studioKey}>{k}:</span>
                  <span style={s.studioVal}>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Shift edit modal */}
      {editShift && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={s.mh3}>Редактировать смену</h3>
            {shiftError && <div style={s.errBox}>{shiftError}</div>}
            <Field label="Начало (Екб)">
              <input style={s.inp} type="datetime-local" value={toYekLocal(editShift.started_at)}
                onChange={e => setEditShift(p => ({ ...p!, started_at: fromYekLocal(e.target.value) }))} />
            </Field>
            <Field label="Конец (Екб)">
              <input style={s.inp} type="datetime-local" value={toYekLocal(editShift.ended_at)}
                onChange={e => setEditShift(p => ({ ...p!, ended_at: e.target.value ? fromYekLocal(e.target.value) : null }))} />
            </Field>
            <Field label="Статус">
              <select style={s.inp} value={editShift.status ?? 'closed'} onChange={e => setEditShift(p => ({ ...p!, status: e.target.value }))}>
                <option value="open">открыта</option>
                <option value="closed">закрыта</option>
                <option value="auto_closed">авто-закрыта</option>
              </select>
            </Field>
            <Field label="Замена">
              <input style={s.inp} value={editShift.replacing ?? ''} onChange={e => setEditShift(p => ({ ...p!, replacing: e.target.value || null }))} />
            </Field>
            <Field label="Комментарий">
              <input style={s.inp} value={editShift.comment ?? ''} onChange={e => setEditShift(p => ({ ...p!, comment: e.target.value || null }))} />
            </Field>
            <div style={s.mBtns}>
              <button style={s.cancelBtn} onClick={() => { setEditShift(null); setShiftError(null); }}>Отмена</button>
              <button style={s.saveBtn} disabled={shiftSaving} onClick={saveShift}>{shiftSaving ? '...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 12 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const tabBtnSt = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px', border: 'none', background: 'none', fontFamily: 'inherit',
  fontSize: 14, fontWeight: active ? 700 : 400,
  color: active ? '#02BDB6' : '#64748b',
  borderBottom: active ? '2px solid #02BDB6' : '2px solid transparent',
  cursor: 'pointer',
});

const shiftRowSt = (sh: ShiftRecord): React.CSSProperties => ({
  background: sh.ended_at && !sh.sheet_synced_end ? '#fef9f9' : '#fff',
  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  borderLeft: `4px solid ${sh.status === 'open' ? '#22c55e' : sh.status === 'auto_closed' ? '#f59e0b' : '#94a3b8'}`,
});

const s: Record<string, React.CSSProperties> = {
  root:        { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" },
  header:      { padding: '14px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 },
  title:       { fontSize: 16, fontWeight: 700 },
  tabsBar:     { display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' },
  section:     { padding: '12px 12px 32px' },
  filterRow:   { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  dateInp:     { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  dash:        { color: '#64748b', fontSize: 13 },
  loadBtn:     { padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:      { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  empty:       { color: '#94a3b8', fontSize: 13 },
  rowTitle:    { fontSize: 14, fontWeight: 600, color: '#1a202c' },
  rowMeta:     { fontSize: 12, color: '#64748b', marginTop: 2 },
  muted:       { fontWeight: 400, color: '#64748b' },
  warn:        { color: '#ef4444', marginLeft: 6 },
  editBtn:     { padding: '5px 12px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  sectionTitle:{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 },
  totalRow:    { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f1f5f9' },
  taskRow:     { background: '#fff', borderRadius: 10, padding: '8px 12px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  taskDate:    { fontSize: 12, fontWeight: 600, color: '#64748b', width: 60, flexShrink: 0, paddingTop: 2 },
  personChip:  { background: '#e0f2fe', color: '#0369a1', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 600 },
  studioRow:   { background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  studioField: { display: 'flex', gap: 6, fontSize: 13, padding: '1px 0' },
  studioKey:   { color: '#64748b', flexShrink: 0 },
  studioVal:   { color: '#1a202c' },
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal:       { background: '#fff', borderRadius: 16, padding: 24, width: 'min(440px,96vw)', maxHeight: '90vh', overflow: 'auto' },
  mh3:         { fontSize: 16, fontWeight: 700, margin: '0 0 16px' },
  inp:         { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  mBtns:       { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn:   { padding: '8px 16px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:     { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  errBox:      { background: '#fef2f2', color: '#ef4444', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
};
