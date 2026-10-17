import { useState, useEffect, useCallback, useMemo } from 'react';

interface Template {
  id: string;
  title: string;
  hint: string | null;
  category: string;
  slot_time: string;
  weekend_time: string | null;
  stories_slot: string | null;
  sort: number;
  is_active: boolean;
}

interface Idea {
  id: string;
  slot: string;
  idea: string;
  caption: string | null;
  sort: number;
  is_active: boolean;
}

interface ShiftRecord {
  id: string;
  user_id: string;
  user_name: string;
  user_login: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  replacing: string | null;
  comment: string | null;
  comment_end: string | null;
  sheet_synced_start: boolean;
  sheet_synced_end: boolean;
  sheet_sync_attempts: number;
}

type ActiveTab = 'templates' | 'ideas' | 'shifts';

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

function calcHours(s: ShiftRecord): string {
  if (!s.started_at || !s.ended_at) return '—';
  return ((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000).toFixed(1);
}

const STATUS_LABEL: Record<string, string> = {
  open: 'открыта', closed: 'закрыта', auto_closed: 'авто',
};

export default function AdminPage() {
  const [tab, setTab]           = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ideas, setIdeas]         = useState<Idea[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editTpl, setEditTpl]     = useState<Partial<Template> | null>(null);
  const [editIdea, setEditIdea]   = useState<Partial<Idea> | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Shifts tab state
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const [shiftFrom, setShiftFrom] = useState(monthStart);
  const [shiftTo, setShiftTo]     = useState(today);
  const [shifts, setShifts]       = useState<ShiftRecord[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [editShift, setEditShift] = useState<Partial<ShiftRecord> | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftError, setShiftError]   = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    const r = await fetch('/kviz/api/manager/templates', { credentials: 'include' });
    const d = await r.json();
    setTemplates(Array.isArray(d) ? d : []);
  }, []);

  const loadIdeas = useCallback(async () => {
    const r = await fetch('/kviz/api/manager/ideas', { credentials: 'include' });
    const d = await r.json();
    setIdeas(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => {
    Promise.all([loadTemplates(), loadIdeas()]).finally(() => setLoading(false));
  }, [loadTemplates, loadIdeas]);

  const loadShifts = useCallback(async () => {
    setShiftsLoading(true);
    try {
      const r = await fetch(`/kviz/api/shifts?from=${shiftFrom}&to=${shiftTo}`, { credentials: 'include' });
      const d = await r.json();
      setShifts(Array.isArray(d) ? d : []);
    } catch {}
    finally { setShiftsLoading(false); }
  }, [shiftFrom, shiftTo]);

  const saveTpl = async () => {
    if (!editTpl) return;
    setSaving(true); setError(null);
    try {
      const isNew = !editTpl.id;
      const url = isNew ? '/kviz/api/manager/templates' : `/kviz/api/manager/templates/${editTpl.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTpl),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setEditTpl(null);
      await loadTemplates();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const saveIdea = async () => {
    if (!editIdea) return;
    setSaving(true); setError(null);
    try {
      const isNew = !editIdea.id;
      const url = isNew ? '/kviz/api/manager/ideas' : `/kviz/api/manager/ideas/${editIdea.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editIdea),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setEditIdea(null);
      await loadIdeas();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const saveShift = async () => {
    if (!editShift?.id) return;
    setShiftSaving(true); setShiftError(null);
    try {
      const body: Record<string, unknown> = {};
      if (editShift.started_at  !== undefined) body.started_at  = editShift.started_at;
      if (editShift.ended_at    !== undefined) body.ended_at    = editShift.ended_at;
      if (editShift.status      !== undefined) body.status      = editShift.status;
      if (editShift.replacing   !== undefined) body.replacing   = editShift.replacing;
      if (editShift.comment     !== undefined) body.comment     = editShift.comment;
      if (editShift.comment_end !== undefined) body.comment_end = editShift.comment_end;
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
      const key = `${sh.user_name}|${sh.date.slice(0, 7)}`;
      const h = (new Date(sh.ended_at).getTime() - new Date(sh.started_at).getTime()) / 3_600_000;
      map.set(key, (map.get(key) ?? 0) + h);
    }
    return [...map.entries()]
      .map(([k, h]) => { const [name, month] = k.split('|'); return { name, month, hours: h }; })
      .sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
  }, [shifts]);

  const exportCSV = () => {
    const fmtYek = (iso: string | null) => {
      if (!iso) return '';
      const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
    };
    const rows = [
      ['Дата','Сотрудник','Логин','Начало','Конец','Часов','Статус','Комментарий','Конец комм.','Замена','Таблица'],
      ...shifts.map(sh => [
        sh.date, sh.user_name, sh.user_login,
        fmtYek(sh.started_at), fmtYek(sh.ended_at),
        calcHours(sh), sh.status,
        sh.comment ?? '', sh.comment_end ?? '', sh.replacing ?? '',
        sh.sheet_synced_end ? '1' : '0',
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `shifts_${shiftFrom}_${shiftTo}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (loading) return <div style={s.center}>Загрузка...</div>;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <a href="/kviz/manager" style={s.back}>← Назад</a>
        <span style={s.title}>Настройки менеджера</span>
      </div>

      <div style={s.tabsBar}>
        <button style={tabBtnSt(tab === 'templates')} onClick={() => setTab('templates')}>Задачи</button>
        <button style={tabBtnSt(tab === 'ideas')} onClick={() => setTab('ideas')}>Идеи сторисов</button>
        <button style={tabBtnSt(tab === 'shifts')} onClick={() => setTab('shifts')}>Смены</button>
      </div>

      {tab === 'templates' && (
        <div style={s.section}>
          <button style={s.addBtn} onClick={() => setEditTpl({ title: '', category: 'other', slot_time: '09:00', sort: 99, is_active: true })}>
            + Добавить задачу
          </button>
          {templates.map(t => (
            <div key={t.id} style={rowSt(t.is_active)}>
              <div>
                <div style={s.rowTitle}>{t.sort}. {t.title}</div>
                <div style={s.rowMeta}>
                  {t.slot_time}{t.weekend_time ? ` / вых: ${t.weekend_time}` : ''} · {t.category}
                  {t.stories_slot ? ` · сторис: ${t.stories_slot}` : ''}
                  {!t.is_active ? ' · неактивна' : ''}
                </div>
              </div>
              <button style={s.editBtn} onClick={() => setEditTpl({ ...t })}>Ред.</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'ideas' && (
        <div style={s.section}>
          <button style={s.addBtn} onClick={() => setEditIdea({ slot: '', idea: '', sort: 99, is_active: true })}>
            + Добавить идею
          </button>
          {ideas.map(i => (
            <div key={i.id} style={rowSt(i.is_active)}>
              <div>
                <div style={s.rowTitle}>{i.slot} · {i.idea}</div>
                {i.caption && <div style={s.rowMeta}>{i.caption.slice(0, 80)}{i.caption.length > 80 ? '…' : ''}</div>}
                {!i.is_active && <div style={s.rowMeta}>неактивна</div>}
              </div>
              <button style={s.editBtn} onClick={() => setEditIdea({ ...i })}>Ред.</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'shifts' && (
        <div style={s.section}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input type="date" style={s.dateInp} value={shiftFrom} onChange={e => setShiftFrom(e.target.value)} />
            <span style={{ color: '#64748b', fontSize: 13 }}>—</span>
            <input type="date" style={s.dateInp} value={shiftTo} onChange={e => setShiftTo(e.target.value)} />
            <button style={s.addBtn} onClick={loadShifts} disabled={shiftsLoading}>
              {shiftsLoading ? '...' : 'Загрузить'}
            </button>
            {shifts.length > 0 && (
              <button style={s.csvBtn} onClick={exportCSV}>CSV</button>
            )}
          </div>

          {shifts.length === 0 && !shiftsLoading && (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Нет данных за период</div>
          )}

          {shifts.map(sh => (
            <div key={sh.id} style={shiftRowSt(sh)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.rowTitle}>
                  {sh.date.split('-').reverse().join('.')} · {sh.user_name}
                  {sh.replacing ? <span style={{ fontWeight: 400, color: '#64748b' }}> (замена: {sh.replacing})</span> : null}
                </div>
                <div style={s.rowMeta}>
                  {fmtHHMM(sh.started_at)} — {fmtHHMM(sh.ended_at)} · {calcHours(sh)} ч
                  {' · '}{STATUS_LABEL[sh.status] ?? sh.status}
                  {sh.ended_at && !sh.sheet_synced_end && (
                    <span style={{ color: '#ef4444', marginLeft: 6 }}>! не в таблице</span>
                  )}
                </div>
                {(sh.comment || sh.comment_end) && (
                  <div style={{ ...s.rowMeta, marginTop: 2 }}>
                    {sh.comment && <span>Начало: {sh.comment}</span>}
                    {sh.comment && sh.comment_end && ' · '}
                    {sh.comment_end && <span>Конец: {sh.comment_end}</span>}
                  </div>
                )}
              </div>
              <button style={s.editBtn} onClick={() => setEditShift({ ...sh })}>Ред.</button>
            </div>
          ))}

          {monthlyTotals.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Итого по месяцам</div>
              {monthlyTotals.map(mt => (
                <div key={mt.month + mt.name} style={s.totalRow}>
                  <span style={{ color: '#374151' }}>{mt.month} · {mt.name}</span>
                  <span style={{ fontWeight: 700, color: '#02BDB6' }}>{mt.hours.toFixed(1)} ч</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Template modal */}
      {editTpl && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={s.mh3}>{editTpl.id ? 'Редактировать задачу' : 'Новая задача'}</h3>
            {error && <div style={s.errBox}>{error}</div>}
            <Field label="Название">
              <input style={s.inp} value={editTpl.title ?? ''} onChange={e => setEditTpl(p => ({ ...p!, title: e.target.value }))} />
            </Field>
            <Field label="Подсказка">
              <input style={s.inp} value={editTpl.hint ?? ''} onChange={e => setEditTpl(p => ({ ...p!, hint: e.target.value || null }))} />
            </Field>
            <Field label="Время (будни)">
              <input style={s.inp} value={editTpl.slot_time ?? ''} placeholder="09:00" onChange={e => setEditTpl(p => ({ ...p!, slot_time: e.target.value }))} />
            </Field>
            <Field label="Время (выходные)">
              <input style={s.inp} value={editTpl.weekend_time ?? ''} placeholder="необязательно" onChange={e => setEditTpl(p => ({ ...p!, weekend_time: e.target.value || null }))} />
            </Field>
            <Field label="Категория">
              <input style={s.inp} value={editTpl.category ?? 'other'} onChange={e => setEditTpl(p => ({ ...p!, category: e.target.value }))} />
            </Field>
            <Field label="Слот сторисов">
              <input style={s.inp} value={editTpl.stories_slot ?? ''} placeholder="необязательно" onChange={e => setEditTpl(p => ({ ...p!, stories_slot: e.target.value || null }))} />
            </Field>
            <Field label="Сортировка">
              <input style={s.inp} type="number" value={editTpl.sort ?? 99} onChange={e => setEditTpl(p => ({ ...p!, sort: Number(e.target.value) }))} />
            </Field>
            <label style={s.chk}>
              <input type="checkbox" checked={editTpl.is_active !== false} onChange={e => setEditTpl(p => ({ ...p!, is_active: e.target.checked }))} />
              {' '}Активна
            </label>
            <div style={s.mBtns}>
              <button style={s.cancelBtn} onClick={() => { setEditTpl(null); setError(null); }}>Отмена</button>
              <button style={s.saveBtn} disabled={saving} onClick={saveTpl}>{saving ? '...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Idea modal */}
      {editIdea && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={s.mh3}>{editIdea.id ? 'Редактировать идею' : 'Новая идея'}</h3>
            {error && <div style={s.errBox}>{error}</div>}
            <Field label="Слот (напр. stories_19)">
              <input style={s.inp} value={editIdea.slot ?? ''} onChange={e => setEditIdea(p => ({ ...p!, slot: e.target.value }))} />
            </Field>
            <Field label="Идея">
              <input style={s.inp} value={editIdea.idea ?? ''} onChange={e => setEditIdea(p => ({ ...p!, idea: e.target.value }))} />
            </Field>
            <Field label="Подпись">
              <textarea style={{ ...s.inp, height: 80, resize: 'vertical' }} value={editIdea.caption ?? ''} onChange={e => setEditIdea(p => ({ ...p!, caption: e.target.value || null }))} />
            </Field>
            <Field label="Сортировка">
              <input style={s.inp} type="number" value={editIdea.sort ?? 99} onChange={e => setEditIdea(p => ({ ...p!, sort: Number(e.target.value) }))} />
            </Field>
            <label style={s.chk}>
              <input type="checkbox" checked={editIdea.is_active !== false} onChange={e => setEditIdea(p => ({ ...p!, is_active: e.target.checked }))} />
              {' '}Активна
            </label>
            <div style={s.mBtns}>
              <button style={s.cancelBtn} onClick={() => { setEditIdea(null); setError(null); }}>Отмена</button>
              <button style={s.saveBtn} disabled={saving} onClick={saveIdea}>{saving ? '...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Shift edit modal */}
      {editShift && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={s.mh3}>Редактировать смену</h3>
            {shiftError && <div style={s.errBox}>{shiftError}</div>}
            <Field label="Начало (время Екб)">
              <input
                style={s.inp} type="datetime-local"
                value={toYekLocal(editShift.started_at)}
                onChange={e => setEditShift(p => ({ ...p!, started_at: fromYekLocal(e.target.value) }))}
              />
            </Field>
            <Field label="Конец (время Екб)">
              <input
                style={s.inp} type="datetime-local"
                value={toYekLocal(editShift.ended_at)}
                onChange={e => setEditShift(p => ({ ...p!, ended_at: e.target.value ? fromYekLocal(e.target.value) : null }))}
              />
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
            <Field label="Комментарий (начало)">
              <input style={s.inp} value={editShift.comment ?? ''} onChange={e => setEditShift(p => ({ ...p!, comment: e.target.value || null }))} />
            </Field>
            <Field label="Комментарий (конец)">
              <input style={s.inp} value={editShift.comment_end ?? ''} onChange={e => setEditShift(p => ({ ...p!, comment_end: e.target.value || null }))} />
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

const tabBtnSt = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px', border: 'none', background: 'none', fontFamily: 'inherit',
  fontSize: 14, fontWeight: active ? 700 : 400,
  color: active ? '#02BDB6' : '#64748b',
  borderBottom: active ? '2px solid #02BDB6' : '2px solid transparent',
  cursor: 'pointer',
});

const rowSt = (active: boolean): React.CSSProperties => ({
  background: active ? '#fff' : '#f1f5f9',
  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
});

const shiftRowSt = (sh: ShiftRecord): React.CSSProperties => ({
  background: sh.ended_at && !sh.sheet_synced_end ? '#fef9f9' : '#fff',
  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  borderLeft: `4px solid ${sh.status === 'open' ? '#22c55e' : sh.status === 'auto_closed' ? '#f59e0b' : '#94a3b8'}`,
});

const s: Record<string, React.CSSProperties> = {
  root:     { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" },
  center:   { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontFamily: 'system-ui,sans-serif' },
  header:   { padding: '14px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 },
  back:     { fontSize: 13, color: '#263CD9', textDecoration: 'none' },
  title:    { fontSize: 16, fontWeight: 700 },
  tabsBar:  { display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' },
  section:  { padding: '12px 12px 32px' },
  addBtn:   { marginBottom: 12, padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:   { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  dateInp:  { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  rowTitle: { fontSize: 14, fontWeight: 600, color: '#1a202c' },
  rowMeta:  { fontSize: 12, color: '#64748b', marginTop: 2 },
  editBtn:  { padding: '5px 12px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f1f5f9' },
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal:    { background: '#fff', borderRadius: 16, padding: 24, width: 'min(440px,96vw)', maxHeight: '90vh', overflow: 'auto' },
  mh3:      { fontSize: 16, fontWeight: 700, margin: '0 0 16px' },
  inp:      { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  chk:      { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 12, cursor: 'pointer' },
  mBtns:    { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn:{ padding: '8px 16px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:  { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  errBox:   { background: '#fef2f2', color: '#ef4444', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
};
