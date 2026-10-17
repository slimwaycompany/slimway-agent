import { useState, useEffect, useCallback } from 'react';

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
  weekdays: number[] | null;
}

interface Idea {
  id: string;
  slot: string;
  idea: string;
  caption: string | null;
  sort: number;
  is_active: boolean;
}

type ActiveTab = 'templates' | 'ideas' | 'mission';

const WEEKDAY_LABELS: [string, number][] = [['Пн',1],['Вт',2],['Ср',3],['Чт',4],['Пт',5],['Сб',6],['Вс',7]];

export default function AdminPage() {
  const [tab, setTab]             = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ideas, setIdeas]         = useState<Idea[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editTpl, setEditTpl]     = useState<Partial<Template> | null>(null);
  const [editIdea, setEditIdea]   = useState<Partial<Idea> | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [mission, setMission]     = useState('');
  const [resultsUrl, setResultsUrl] = useState('');
  const [missionSaved, setMissionSaved] = useState(false);

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

  const loadMission = useCallback(async () => {
    const r = await fetch('/kviz/api/results/mission', { credentials: 'include' });
    const d = await r.json();
    setMission(typeof d.mission === 'string' ? d.mission : '');
    setResultsUrl(typeof d.display_url === 'string' ? d.display_url : '');
  }, []);

  useEffect(() => {
    Promise.all([loadTemplates(), loadIdeas(), loadMission()]).finally(() => setLoading(false));
  }, [loadTemplates, loadIdeas, loadMission]);

  const saveMission = async () => {
    setSaving(true); setError(null); setMissionSaved(false);
    try {
      const r = await fetch('/kviz/api/results/mission', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setMission(d.value || ''); setMissionSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

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

  if (loading) return <div style={s.center}>Загрузка...</div>;

  const weekdaysSummary = (wd: number[] | null | undefined) => {
    if (!wd) return '';
    return ' · дни: ' + wd.map(d => WEEKDAY_LABELS[d - 1][0]).join(',');
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <a href="/kviz/manager" style={s.back}>← Назад</a>
        <span style={s.title}>Настройки менеджера</span>
      </div>

      <div style={s.tabsBar}>
        <button style={tabBtnSt(tab === 'templates')} onClick={() => setTab('templates')}>Задачи</button>
        <button style={tabBtnSt(tab === 'ideas')} onClick={() => setTab('ideas')}>Идеи сторисов</button>
        <button style={tabBtnSt(tab === 'mission')} onClick={() => setTab('mission')}>Результаты студии</button>
      </div>

      {tab === 'mission' && <div style={s.section}>
        <div style={s.rowTitle}>Миссия на экране результатов студии</div>
        <textarea value={mission} onChange={e => { setMission(e.target.value); setMissionSaved(false); }} maxLength={500} rows={4}
          style={{ width: '100%', marginTop: 12, padding: 12, border: '1px solid #e2e6ea', borderRadius: 10, font: 'inherit', resize: 'vertical' }} />
        <div style={s.rowMeta}>{mission.length}/500</div>
        {error && <div style={s.errBox}>{error}</div>}
        {missionSaved && <div style={{ color: '#059669', fontSize: 13, marginTop: 8 }}>Миссия сохранена</div>}
        <button style={{ ...s.addBtn, marginTop: 12 }} onClick={saveMission} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить миссию'}</button>
        {resultsUrl ? <a href={resultsUrl} style={{ display: 'block', marginTop: 16, color: '#02BDB6' }}>Открыть экран результатов</a> : <div style={s.rowMeta}>Добавьте RESULTS_DISPLAY_KEY в Environment Render, чтобы открыть экран по ключу.</div>}
      </div>}

      {tab === 'templates' && (
        <div style={s.section}>
          <button style={s.addBtn} onClick={() => setEditTpl({ title: '', category: 'other', slot_time: '09:00', sort: 99, is_active: true, weekdays: null })}>
            + Добавить задачу
          </button>
          {templates.map(t => (
            <div key={t.id} style={rowSt(t.is_active)}>
              <div>
                <div style={s.rowTitle}>{t.sort}. {t.title}</div>
                <div style={s.rowMeta}>
                  {t.slot_time}{t.weekend_time ? ` / вых: ${t.weekend_time}` : ''} · {t.category}
                  {t.stories_slot ? ` · сторис: ${t.stories_slot}` : ''}
                  {weekdaysSummary(t.weekdays)}
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
            <Field label="Дни недели (пусто = все дни)">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                {WEEKDAY_LABELS.map(([label, dow]) => {
                  const checked = editTpl.weekdays ? editTpl.weekdays.includes(dow) : true;
                  return (
                    <label key={dow} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const current = editTpl.weekdays ?? [1,2,3,4,5,6,7];
                          const next = e.target.checked
                            ? [...current, dow].sort((a, b) => a - b)
                            : current.filter(d => d !== dow);
                          setEditTpl(p => ({ ...p!, weekdays: next.length === 7 ? null : (next.length === 0 ? null : next) }));
                        }}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
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

const s: Record<string, React.CSSProperties> = {
  root:     { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" },
  center:   { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontFamily: 'system-ui,sans-serif' },
  header:   { padding: '14px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 },
  back:     { fontSize: 13, color: '#263CD9', textDecoration: 'none' },
  title:    { fontSize: 16, fontWeight: 700 },
  tabsBar:  { display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' },
  section:  { padding: '12px 12px 32px' },
  addBtn:   { marginBottom: 12, padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  rowTitle: { fontSize: 14, fontWeight: 600, color: '#1a202c' },
  rowMeta:  { fontSize: 12, color: '#64748b', marginTop: 2 },
  editBtn:  { padding: '5px 12px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
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
