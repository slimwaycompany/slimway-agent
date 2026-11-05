import { useState, useEffect, useRef } from 'react';
import { postToParent } from '../../utils/iframe';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stage { id: string; name: string; kind: string; sort: number; is_archived: boolean }
interface Funnel { id: string; name: string; stages: Stage[] }

interface Lead {
  id: string; title: string | null; name: string | null; surname: string | null;
  patronymic: string | null; phone: string | null; email: string | null;
  instagram: string | null; telegram: string | null;
  description: string | null; budget: string | null;
  stage_id: string | null; funnel_id: string | null; ad_source_id: string | null;
  manager_user_id: string | null; fitbase_manager_name: string | null;
  tags: string[]; custom_fields: unknown[]; is_archived: boolean; is_duplicate: boolean;
  utm_campaign: string | null; utm_source: string | null; utm_medium: string | null;
  utm_term: string | null; utm_content: string | null;
  fb_created_at: string | null; fb_updated_at: string | null; origin: string;
}

interface Activity {
  id: string; kind: string; text: string | null; created_at: string; author: string | null;
  meta: Record<string, unknown> | null;
}

interface LeadTask {
  id: string; description: string; status: string; due_at: string | null;
  is_overdue: boolean; closed_at: string | null; closed_by: string | null;
  type_id: string | null; responsible_user_id: string | null;
  type?: { name: string } | null;
}

interface AdSource { id: string; name: string }
interface AppUser  { id: string; display_name: string }
interface TaskType { id: string; name: string }

interface Props {
  leadId: string;
  funnels: Funnel[];
  onClose: () => void;
  onSaved:   (lead: Lead) => void;
  onDeleted: (id: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.parent?.postMessage({ type: 'auth-required' }, '*'); throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPhone(raw: string | null) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `+7 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`;
  return raw;
}

const KIND_LABELS: Record<string, string> = { created: 'Создан', comment: 'Комментарий', stage_change: 'Смена этапа', field_change: 'Изменение поля', task: 'Задача', system: 'Система' };

// ── Task item ──────────────────────────────────────────────────────────────────

function TaskItem({ task, onToggle, onDelete }: { task: LeadTask; onToggle: () => void; onDelete: () => void }) {
  const done = task.status === 'done';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
      <input type="checkbox" checked={done} onChange={onToggle} style={{ marginTop: 2, flexShrink: 0, accentColor: '#02BDB6' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: done ? '#94a3b8' : '#1a202c', textDecoration: done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{task.description}</div>
        {task.due_at && (
          <div style={{ fontSize: 11, color: task.is_overdue && !done ? '#ef4444' : '#94a3b8', marginTop: 2 }}>
            {fmtDate(task.due_at)}{task.is_overdue && !done ? ' — просрочено' : ''}
          </div>
        )}
        {task.type && <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{task.type.name}</div>}
      </div>
      <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────────────

export default function LeadDrawer({ leadId, funnels, onClose, onSaved, onDeleted }: Props) {
  const [lead, setLead]           = useState<Lead | null>(null);
  const [activity, setActivity]   = useState<Activity[]>([]);
  const [tasks, setTasks]         = useState<LeadTask[]>([]);
  const [adSources, setAdSources] = useState<AdSource[]>([]);
  const [appUsers, setAppUsers]   = useState<AppUser[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [tab, setTab]             = useState<'main' | 'custom'>('main');
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');
  const [comment, setComment]     = useState('');
  const [taskDesc, setTaskDesc]   = useState('');
  const [taskDue, setTaskDue]     = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [isAdmin, setIsAdmin]     = useState(false);
  const [origin, setOrigin]       = useState('');
  const [toast, setToast]         = useState('');
  const drawerRef = useRef<HTMLDivElement>(null);

  // form fields (controlled)
  const [title, setTitle]         = useState('');
  const [name, setName]           = useState('');
  const [surname, setSurname]     = useState('');
  const [phone, setPhone]         = useState('');
  const [email, setEmail]         = useState('');
  const [instagram, setInstagram] = useState('');
  const [telegram, setTelegram]   = useState('');
  const [description, setDesc]    = useState('');
  const [budget, setBudget]       = useState('');
  const [funnelId, setFunnelId]   = useState('');
  const [stageId, setStageId]     = useState('');
  const [adSourceId, setAdSourceId] = useState('');
  const [managerUserId, setManagerUserId] = useState('');

  useEffect(() => {
    // Check admin
    fetch('/kviz/api/me', { credentials: 'include' }).then(r => r.json()).then(d => setIsAdmin(d?.role === 'admin')).catch(() => {});

    Promise.all([
      api('GET', `/kviz/api/crm/leads/${leadId}`),
      api('GET', `/kviz/api/crm/leads/${leadId}/activity`),
      api('GET', `/kviz/api/crm/lead-tasks?lead_id=${leadId}`),
      api('GET', '/kviz/api/crm/app-users'),
      api('GET', '/kviz/api/crm/task-types'),
    ]).then(([ld, act, tk, users, types]) => {
      if (ld.ok) {
        const l: Lead = ld.data;
        setLead(l);
        setTitle(l.title ?? '');
        setName(l.name ?? '');
        setSurname(l.surname ?? '');
        setPhone(l.phone ?? '');
        setEmail(l.email ?? '');
        setInstagram(l.instagram ?? '');
        setTelegram(l.telegram ?? '');
        setDesc(l.description ?? '');
        setBudget(l.budget ?? '');
        setFunnelId(l.funnel_id ?? '');
        setStageId(l.stage_id ?? '');
        setAdSourceId(l.ad_source_id ?? '');
        setManagerUserId(l.manager_user_id ?? '');
      }
      if (act.ok) setActivity(Array.isArray(act.data) ? act.data : []);
      setOrigin((ld.data as Record<string, unknown>)?.origin as string ?? '');
      if (tk.ok) setTasks(Array.isArray(tk.data) ? tk.data : []);
      if (users.ok) setAppUsers(Array.isArray(users.data) ? users.data : []);
      if (types.ok) setTaskTypes(Array.isArray(types.data) ? types.data : []);
    });

    // Ad sources
    api('GET', '/kviz/api/crm/ad-sources').then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setAdSources(data);
    });

    // Fitbase notes (shown as activity items)
    api('GET', `/kviz/api/crm/leads/${leadId}/notes`).then(({ ok, data }) => {
      if (ok && Array.isArray(data) && data.length > 0) {
        const notes = data.map((n: Record<string, unknown>) => ({
          id: `fb-note-${n.id ?? Math.random()}`,
          kind: 'comment',
          text: (n.text ?? n.content ?? n.body ?? '') as string,
          created_at: (n.created_at ?? n.date ?? new Date().toISOString()) as string,
          author: `Fitbase: ${n.author ?? n.user ?? ''}`,
          meta: {},
        }));
        setActivity(prev => [...prev, ...notes.filter(n => n.text)]);
      }
    }).catch(() => {});
  }, [leadId]);

  // Close on outside click
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    if (!lead) return;
    setSaving(true); setErr('');
    const body: Record<string, unknown> = { title, name, surname, phone, email, instagram, telegram, description, budget: budget || null, funnel_id: funnelId || null, stage_id: stageId || null, ad_source_id: adSourceId || null, manager_user_id: managerUserId || null };
    const { ok, data } = await api('PATCH', `/kviz/api/crm/leads/${lead.id}`, body);
    setSaving(false);
    if (!ok) { setErr(data?.error ?? 'Ошибка сохранения'); return; }
    onSaved({ ...lead, ...data });
  }

  async function handleArchive() {
    if (!lead) return;
    setSaving(true); setErr('');
    const { ok, data } = await api('PATCH', `/kviz/api/crm/leads/${lead.id}`, { is_archived: !lead.is_archived });
    setSaving(false);
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    onSaved({ ...lead, ...data });
  }

  async function handleDelete() {
    if (!lead) return;
    if (!confirm('Удалить заявку? Это действие необратимо.')) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/leads/${lead.id}`);
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    onDeleted(lead.id);
  }

  async function handleComment() {
    if (!comment.trim() || !lead) return;
    const { ok, data } = await api('POST', `/kviz/api/crm/leads/${lead.id}/activity`, { text: comment });
    if (ok) { setActivity(prev => [data, ...prev]); setComment(''); }
  }

  async function handleTaskCreate() {
    if (!taskDesc.trim() || !lead) return;
    const body: Record<string, unknown> = { lead_id: lead.id, description: taskDesc };
    if (taskDue) body.due_at = taskDue + 'T00:00:00+05:00';
    if (taskTypeId) body.type_id = taskTypeId;
    const { ok, data } = await api('POST', '/kviz/api/crm/lead-tasks', body);
    if (ok) { setTasks(prev => [...prev, data]); setTaskDesc(''); setTaskDue(''); setTaskTypeId(''); }
  }

  async function handleTaskToggle(task: LeadTask) {
    const newStatus = task.status === 'done' ? 'open' : 'done';
    const { ok, data } = await api('PATCH', `/kviz/api/crm/lead-tasks/${task.id}`, { status: newStatus });
    if (ok) setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...data } : t));
  }

  async function handleTaskDelete(id: string) {
    const { ok } = await api('DELETE', `/kviz/api/crm/lead-tasks/${id}`);
    if (ok) setTasks(prev => prev.filter(t => t.id !== id));
  }

  const selFunnel = funnels.find(f => f.id === funnelId);
  const stages = (selFunnel?.stages ?? []).filter(s => !s.is_archived).sort((a, b) => a.sort - b.sort);

  return (
    <>
      {/* Overlay */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }} onClick={onClose} />

      {/* Drawer */}
      <div
        ref={drawerRef}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(100vw, 480px)',
          background: '#fff', zIndex: 101,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          fontFamily: "'Manrope',system-ui,sans-serif",
          overflowY: 'auto',
        }}
      >
        {/* Drawer header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, gap: 8 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead ? (lead.title ?? [lead.name, lead.surname].filter(Boolean).join(' ') ?? 'Заявка') : 'Загрузка...'}
          </div>
          {lead && <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{lead.origin === 'manual' ? 'Вручную' : 'Fitbase'}</span>}
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#64748b', cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          {(['main', 'custom'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '9px 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t ? 700 : 500, color: tab === t ? '#02BDB6' : '#64748b', borderBottom: tab === t ? '2px solid #02BDB6' : '2px solid transparent', marginBottom: -1 }}>
              {t === 'main' ? 'Основное' : 'Произвольные поля'}
            </button>
          ))}
        </div>

        {err && <div style={{ background: '#fef2f2', color: '#ef4444', fontSize: 13, padding: '8px 16px', flexShrink: 0 }}>{err}</div>}

        {!lead && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Загрузка...</div>}

        {lead && tab === 'custom' && (
          <div style={{ padding: 16, flex: 1, color: '#94a3b8', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 36, marginBottom: 8 }}>🚧</div>В разработке</div>
          </div>
        )}

        {lead && tab === 'main' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
            {/* Two-column layout on wide screens, single column on mobile */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left — lead fields */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', borderRight: '1px solid #f1f5f9', minWidth: 0 }}>
                <Field label="Заголовок"><input style={S.inp} value={title} onChange={e => setTitle(e.target.value)} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Имя"><input style={S.inp} value={name} onChange={e => setName(e.target.value)} /></Field>
                  <Field label="Фамилия"><input style={S.inp} value={surname} onChange={e => setSurname(e.target.value)} /></Field>
                </div>
                <Field label="Телефон">
                  <input style={S.inp} value={phone} onChange={e => setPhone(e.target.value)} type="tel" />
                  {lead.phone && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatPhone(lead.phone)}</div>}
                </Field>
                <Field label="Email"><input style={S.inp} value={email} onChange={e => setEmail(e.target.value)} type="email" /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Instagram"><input style={S.inp} value={instagram} onChange={e => setInstagram(e.target.value)} /></Field>
                  <Field label="Telegram"><input style={S.inp} value={telegram} onChange={e => setTelegram(e.target.value)} /></Field>
                </div>
                <Field label="Описание">
                  <textarea style={{ ...S.inp, minHeight: 60, resize: 'vertical' }} value={description} onChange={e => setDesc(e.target.value)} />
                </Field>
                <Field label="Бюджет (₸)"><input style={S.inp} value={budget} onChange={e => setBudget(e.target.value)} type="number" /></Field>

                <Field label="Воронка">
                  <select style={S.inp} value={funnelId} onChange={e => { setFunnelId(e.target.value); setStageId(''); }}>
                    <option value="">— не выбрана —</option>
                    {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>
                <Field label="Этап">
                  <select style={S.inp} value={stageId} onChange={e => setStageId(e.target.value)}>
                    <option value="">— не выбран —</option>
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Источник">
                  <select style={S.inp} value={adSourceId} onChange={e => setAdSourceId(e.target.value)}>
                    <option value="">— не выбран —</option>
                    {adSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Менеджер">
                  <select style={S.inp} value={managerUserId} onChange={e => setManagerUserId(e.target.value)}>
                    <option value="">— не назначен —</option>
                    {appUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                  </select>
                  {lead.fitbase_manager_name && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>FB: {lead.fitbase_manager_name}</div>}
                </Field>

                {(lead.utm_source || lead.utm_campaign) && (
                  <div style={{ marginTop: 12, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>UTM</div>
                    {lead.utm_source   && <div style={{ fontSize: 12, color: '#374151' }}>source: {lead.utm_source}</div>}
                    {lead.utm_campaign && <div style={{ fontSize: 12, color: '#374151' }}>campaign: {lead.utm_campaign}</div>}
                    {lead.utm_medium   && <div style={{ fontSize: 12, color: '#374151' }}>medium: {lead.utm_medium}</div>}
                    {lead.utm_term     && <div style={{ fontSize: 12, color: '#374151' }}>term: {lead.utm_term}</div>}
                    {lead.utm_content  && <div style={{ fontSize: 12, color: '#374151' }}>content: {lead.utm_content}</div>}
                  </div>
                )}

                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
                  Создан: {fmtDateTime(lead.fb_created_at)} · Обновлён: {fmtDateTime(lead.fb_updated_at)}
                </div>
              </div>

              {/* Right — tasks + activity */}
              <div style={{ width: 220, flexShrink: 0, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Tasks */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Задачи</div>
                  {tasks.map(t => (
                    <TaskItem key={t.id} task={t} onToggle={() => handleTaskToggle(t)} onDelete={() => handleTaskDelete(t.id)} />
                  ))}
                  {/* New task form */}
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <input
                      style={{ ...S.inp, fontSize: 12 }} placeholder="Описание задачи"
                      value={taskDesc} onChange={e => setTaskDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleTaskCreate(); }}
                    />
                    <input style={{ ...S.inp, fontSize: 12 }} type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} />
                    {taskTypes.length > 0 && (
                      <select style={{ ...S.inp, fontSize: 12 }} value={taskTypeId} onChange={e => setTaskTypeId(e.target.value)}>
                        <option value="">Тип задачи</option>
                        {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    <button onClick={handleTaskCreate} style={{ ...S.addBtn, fontSize: 12, padding: '5px 10px' }}>+ Задача</button>
                  </div>
                </div>

                {/* Activity */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Лента</div>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                    <input
                      style={{ ...S.inp, flex: 1, fontSize: 12 }} placeholder="Комментарий..."
                      value={comment} onChange={e => setComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleComment(); }}
                    />
                    <button onClick={handleComment} style={{ ...S.addBtn, fontSize: 12, padding: '5px 10px', flexShrink: 0 }}>↵</button>
                  </div>
                  {activity.map(a => (
                    <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#374151' }}>{KIND_LABELS[a.kind] ?? a.kind}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>{fmtDateTime(a.created_at)}</span>
                      </div>
                      {a.author && <div style={{ color: '#64748b', fontSize: 11 }}>{a.author}</div>}
                      {a.text && <div style={{ color: '#374151', marginTop: 2, wordBreak: 'break-word' }}>{a.text}</div>}
                    </div>
                  ))}
                  {activity.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>История пуста</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer buttons */}
        {lead && (
          <>
            <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: '1px solid #e2e8f0', flexShrink: 0, flexWrap: 'wrap' }}>
              <button onClick={handleSave} disabled={saving} style={{ ...S.saveBtn, flex: 1 }}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={handleArchive} disabled={saving}
                style={{ padding: '8px 14px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#64748b', fontWeight: 500 }}>
                {lead.is_archived ? 'Восстановить' : 'В архив'}
              </button>
              {isAdmin && (
                <button onClick={handleDelete}
                  style={{ padding: '8px 14px', background: 'none', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#ef4444', fontWeight: 500 }}>
                  Удалить
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px', flexShrink: 0, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  if (origin === 'fitbase') { setToast('Продажа доступна только для заявок в нашей CRM'); setTimeout(() => setToast(''), 3000); return; }
                  postToParent({ type: 'open-cashier' });
                }}
                style={{ padding: '7px 14px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Продать
              </button>
              <button
                onClick={() => {
                  if (origin === 'fitbase') { setToast('Запись доступна только для заявок в нашей CRM'); setTimeout(() => setToast(''), 3000); return; }
                  postToParent({ type: 'open-schedule' });
                }}
                style={{ padding: '7px 14px', background: 'none', border: '1.5px solid #02BDB6', color: '#02BDB6', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Записать на пробное
              </button>
              {toast && <div style={{ width: '100%', background: '#fef3c7', color: '#92400e', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 500 }}>{toast}</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  inp:    { width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff' },
  saveBtn:{ padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  addBtn: { padding: '6px 12px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
};
