import { useState, useEffect, useCallback, useRef } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core';
import { toast } from '../../../lib/toast';
import { showConfirm } from '../../../lib/confirm';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Stage  { id: string; name: string; funnel_id: string; color?: string }
interface Funnel { id: string; name: string }
interface TaskType { id: string; name: string }
interface AutoRule {
  id: string; name: string; mode: 'off' | 'test' | 'live'; priority: number;
  target_funnel_id: string; target_stage_id: string;
  source_scope: { funnel_ids?: string[]; stage_ids?: string[] };
  match: 'all' | 'any';
  conditions: Condition[];
  actions: { create_lead_if_missing?: boolean; task?: TaskAction | null };
  last_run_at?: string | null; last_run_stats?: RunStats | null;
}
interface Condition { type: string; params: Record<string, string | number> }
interface TaskAction { type_id: string | null; text: string; due_in_hours: number; responsible: string }
interface RunStats { matched: number; moved: number; created: number; skipped: number }
interface AutoSettings { min_plan_price: number; manual_hold_hours: number }
interface LogEntry {
  id: string; rule_id: string; rule_name: string; lead_id: string | null;
  lead_title: string | null; action: string; mode: string;
  from_stage_id?: string | null; to_stage_id?: string | null;
  skip_reason?: string | null; created_at: string;
}

// ── Condition catalog ──────────────────────────────────────────────────────────

const COND_CATALOG = [
  { type: 'has_active_plan',           label: 'Есть купленный абонемент',                paramDefs: [] },
  { type: 'plan_days_left_lte',        label: 'До конца абонемента ≤ … дней',            paramDefs: [{ key: 'days',     unit: 'дн.' }] },
  { type: 'plan_sessions_left_lte',    label: 'Осталось занятий ≤ …',                    paramDefs: [{ key: 'sessions', unit: 'зан.' }] },
  { type: 'plan_ended_days',           label: 'Абонемент закончился от … до … дней назад', paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }] },
  { type: 'trial_attended_no_purchase',label: 'Пришла на пробное и не купила',           paramDefs: [] },
  { type: 'days_on_stage_gte',         label: 'На этапе ≥ … дней',                       paramDefs: [{ key: 'days',     unit: 'дн.' }] },
  { type: 'no_future_task',            label: 'Нет задачи с датой в будущем',             paramDefs: [] },
  { type: 'days_since_last_visit',     label: 'Последний визит от … до … дней назад',    paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }] },
  { type: 'days_since_created',        label: 'Заявка создана от … до … дней назад',     paramDefs: [{ key: 'from', label: 'от', unit: 'дн.' }, { key: 'to', label: 'до', unit: 'дн.' }] },
];

function condLabel(c: Condition): string {
  const def = COND_CATALOG.find(d => d.type === c.type);
  if (!def) return c.type;
  let lbl = (c.type === 'days_since_last_visit' && c.params.fallback_created)
    ? 'Последний визит (или дата заявки) от … до … дней назад'
    : def.label;
  for (const pd of def.paramDefs) {
    const v = c.params[pd.key];
    const fallback = pd.key === 'to' ? '∞' : '?';
    lbl = lbl.replace('…', v !== undefined && v !== '' ? String(v) : fallback);
  }
  return lbl;
}

const ABONEMENT_TYPES = new Set(['has_active_plan','plan_days_left_lte','plan_sessions_left_lte','plan_ended_days']);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtStats(stats: RunStats | null | undefined, mode: string) {
  if (!stats) return 'Ещё не запускалось';
  if (mode === 'test') return `Тест: подошло бы ${stats.moved}`;
  return `Подошло ${stats.matched}, перенесено ${stats.moved}${stats.created ? `, создано ${stats.created}` : ''}${stats.skipped ? `, пропущено ${stats.skipped}` : ''}`;
}

// ── Drag handle + droppable row ───────────────────────────────────────────────

function DragRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id });
  return (
    <div ref={(el) => { dragRef(el); dropRef(el); }}
      style={{ opacity: isDragging ? 0.4 : 1, outline: isOver ? '2px dashed var(--primary)' : 'none', borderRadius: 10 }}
    >
      <span {...attributes} {...listeners} style={{ cursor: 'grab', padding: '0 6px', color: 'var(--text-3)', fontSize: 16, userSelect: 'none' }} title="Перетащить">⠿</span>
      {children}
    </div>
  );
}

// ── Mode badge ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = { off: 'Выкл', test: 'Тест', live: 'Боевой' };
const MODE_BG:    Record<string, string> = {
  off:  'var(--surface-2)', test: '#fff8e1', live: '#e8f5e9',
};
const MODE_COLOR: Record<string, string> = {
  off:  'var(--text-3)', test: '#f57c00', live: '#388e3c',
};

function ModeBadge({ mode, onChange }: { mode: 'off' | 'test' | 'live'; onChange: (m: 'off' | 'test' | 'live') => void }) {
  const modes: ('off' | 'test' | 'live')[] = ['off', 'test', 'live'];
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
      {modes.map(m => (
        <button key={m} onClick={() => onChange(m)} style={{
          padding: '3px 10px', fontSize: 12, fontWeight: mode === m ? 700 : 500, border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', background: mode === m ? MODE_BG[m] : 'var(--surface)', color: mode === m ? MODE_COLOR[m] : 'var(--text-2)',
          borderRight: m !== 'live' ? '1px solid var(--border)' : 'none',
        }}>
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

// ── Rule card ─────────────────────────────────────────────────────────────────

function RuleCard({ rule, funnels, stages, onEdit, onPreview, onLog, onDuplicate, onDelete, onModeChange }:
  { rule: AutoRule; funnels: Funnel[]; stages: Stage[]; onEdit: () => void; onPreview: () => void;
    onLog: () => void; onDuplicate: () => void; onDelete: () => void; onModeChange: (m: 'off' | 'test' | 'live') => void }
) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tStage  = stages.find(s => s.id === rule.target_stage_id);
  const tFunnel = funnels.find(f => f.id === rule.target_funnel_id);
  const srcFunnels = rule.source_scope?.funnel_ids ?? [];

  useEffect(() => {
    function outside(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  const condsText = rule.conditions.length === 0 ? 'Нет условий' :
    rule.conditions.map(condLabel).join(rule.match === 'all' ? ' И ' : ' ИЛИ ');

  const menuItems = [
    { label: 'Изменить',       fn: onEdit },
    { label: 'Проверить сейчас', fn: onPreview },
    { label: 'Журнал',         fn: onLog },
    { label: 'Дублировать',    fn: onDuplicate },
    { label: 'Удалить',        fn: onDelete, danger: true },
  ];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{rule.name}</span>
            <ModeBadge mode={rule.mode} onChange={onModeChange} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 3 }}>
            → {tFunnel?.name ?? '?'} / <span style={{ color: tStage?.color ?? 'var(--primary)' }}>{tStage?.name ?? '?'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 2 }} title={condsText}>
            {condsText.length > 90 ? condsText.slice(0, 87) + '…' : condsText}
            {srcFunnels.length ? ` · из ${srcFunnels.length} вор.` : ' · из всех воронок'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {rule.last_run_at ? `Прогон: ${fmtTime(rule.last_run_at)} · ` : ''}{fmtStats(rule.last_run_stats, rule.mode)}
          </div>
        </div>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button onClick={() => setMenuOpen(o => !o)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 15, color: 'var(--text-2)', fontFamily: 'inherit' }}>⋯</button>
          {menuOpen && (
            <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 20, minWidth: 160 }}>
              {menuItems.map(({ label, fn, danger }) => (
                <button key={label} onClick={() => { setMenuOpen(false); fn(); }} style={{
                  display: 'block', width: '100%', padding: '9px 14px', border: 'none', background: 'none',
                  textAlign: 'left', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                  color: danger ? 'var(--danger)' : 'var(--text)',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rule editor ───────────────────────────────────────────────────────────────

function RuleEditor({ rule, funnels, stages, taskTypes, onSave, onCancel }:
  { rule: Partial<AutoRule>; funnels: Funnel[]; stages: Stage[]; taskTypes: TaskType[];
    onSave: (data: Partial<AutoRule>) => void; onCancel: () => void }
) {
  const isNew = !rule.id;
  const [form, setForm] = useState<Partial<AutoRule>>({
    name: '', mode: 'off', match: 'all',
    target_funnel_id: funnels[0]?.id ?? '', target_stage_id: '',
    source_scope: { funnel_ids: [], stage_ids: [] },
    conditions: [], actions: {},
    ...rule,
  });
  const [preview, setPreview] = useState<{ total: number; already_on_target: number; no_client_or_visit: number; items: { lead_id: string; title: string | null; from: string; to: string }[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const setF = (patch: Partial<AutoRule>) => setForm(f => ({ ...f, ...patch }));

  const targetStages = stages.filter(s => s.funnel_id === form.target_funnel_id);

  function addCond() {
    setF({ conditions: [...(form.conditions ?? []), { type: 'days_on_stage_gte', params: { days: 7 } }] });
  }
  function removeCond(i: number) {
    setF({ conditions: (form.conditions ?? []).filter((_, idx) => idx !== i) });
  }
  function updateCond(i: number, patch: Partial<Condition>) {
    const conds = [...(form.conditions ?? [])];
    conds[i] = { ...conds[i], ...patch };
    if (patch.type) conds[i].params = {};
    setF({ conditions: conds });
  }
  function updateCondParam(i: number, key: string, val: string) {
    const conds = [...(form.conditions ?? [])];
    conds[i] = { ...conds[i], params: { ...conds[i].params, [key]: val } };
    setF({ conditions: conds });
  }

  const hasAbonementCond = (form.conditions ?? []).some(c => ABONEMENT_TYPES.has(c.type));

  async function runPreview() {
    if (!form.id) return;
    setPreviewLoading(true);
    const { ok, data } = await api('POST', `/kviz/api/crm/automation/rules/${form.id}/preview`);
    setPreviewLoading(false);
    if (ok) setPreview(data);
    else toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка');
  }

  async function save() {
    if (!form.name?.trim()) { toast.error('Укажите название'); return; }
    if (!form.target_funnel_id || !form.target_stage_id) { toast.error('Выберите целевой этап'); return; }
    setSaving(true);
    onSave(form);
  }

  const isMobile = window.innerWidth <= 640;

  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
    background: 'var(--surface)', borderRadius: '16px 16px 0 0',
    boxShadow: '0 -4px 24px rgba(0,0,0,.18)', maxHeight: '90vh', overflowY: 'auto',
    padding: '20px 16px 32px',
  } : {
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 400, zIndex: 100,
    background: 'var(--surface)', borderLeft: '1px solid var(--border)',
    boxShadow: '-4px 0 24px rgba(0,0,0,.12)', overflowY: 'auto',
    padding: 20,
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border)',
    borderRadius: 7, fontSize: 16, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)',
    boxSizing: 'border-box',
  };
  const sel: React.CSSProperties = { ...inp };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, marginTop: 12 };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 99 }} onClick={onCancel} />
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{isNew ? 'Новое правило' : 'Правило'}</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3)' }}>✕</button>
        </div>

        <label style={lbl}>Название</label>
        <input style={inp} value={form.name ?? ''} onChange={e => setF({ name: e.target.value })} placeholder="Название правила" />

        <label style={lbl}>Куда переносить — воронка</label>
        <select style={sel} value={form.target_funnel_id ?? ''} onChange={e => setF({ target_funnel_id: e.target.value, target_stage_id: '' })}>
          {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

        <label style={lbl}>Куда переносить — этап</label>
        <select style={sel} value={form.target_stage_id ?? ''} onChange={e => setF({ target_stage_id: e.target.value })}>
          <option value="">— выберите этап —</option>
          {targetStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label style={lbl}>Откуда забирать</label>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
          {!(form.source_scope?.funnel_ids?.length) ? 'Из всех воронок' : `Из ${form.source_scope.funnel_ids.length} вор.`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {funnels.map(f => {
            const sel2 = form.source_scope?.funnel_ids ?? [];
            const checked = sel2.includes(f.id);
            return (
              <button key={f.id} onClick={() => {
                const next = checked ? sel2.filter(x => x !== f.id) : [...sel2, f.id];
                setF({ source_scope: { ...form.source_scope, funnel_ids: next } });
              }} style={{
                padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12,
                cursor: 'pointer', fontFamily: 'inherit',
                background: checked ? 'var(--primary-soft)' : 'var(--surface-2)',
                color: checked ? 'var(--primary)' : 'var(--text-2)',
              }}>{f.name}</button>
            );
          })}
        </div>

        <label style={lbl}>Условия</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['all','any'] as const).map(m => (
            <button key={m} onClick={() => setF({ match: m })} style={{
              padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
              background: form.match === m ? 'var(--primary-soft)' : 'var(--surface-2)',
              color: form.match === m ? 'var(--primary)' : 'var(--text-2)',
            }}>{m === 'all' ? 'Все условия' : 'Любое из условий'}</button>
          ))}
        </div>

        {(form.conditions ?? []).map((c, i) => {
          const def = COND_CATALOG.find(d => d.type === c.type);
          return (
            <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: def?.paramDefs.length ? 6 : 0 }}>
                <select style={{ ...sel, flex: 1, fontSize: 12, padding: '5px 8px' }} value={c.type} onChange={e => updateCond(i, { type: e.target.value })}>
                  {COND_CATALOG.map(d => <option key={d.type} value={d.type}>{d.label}</option>)}
                </select>
                <button onClick={() => removeCond(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16, padding: '0 2px' }}>✕</button>
              </div>
              {def?.paramDefs.map(pd => (
                <div key={pd.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 24 }}>{'label' in pd ? (pd as { key: string; label: string; unit: string }).label : pd.key}</label>
                  <input style={{ ...inp, width: 80, padding: '4px 6px', fontSize: 16 }} type="number" min="0"
                    value={String(c.params[pd.key] ?? '')}
                    onChange={e => updateCondParam(i, pd.key, e.target.value)}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{pd.unit}</span>
                </div>
              ))}
              {c.type === 'days_since_last_visit' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: 'var(--text-2)', marginTop: 2 }}>
                  <input type="checkbox" checked={!!c.params.fallback_created}
                    onChange={e => updateCondParam(i, 'fallback_created', e.target.checked ? '1' : '')} />
                  Если нет визита — использовать дату создания заявки
                </label>
              )}
            </div>
          );
        })}
        <button onClick={addCond} style={{ padding: '5px 12px', background: 'none', border: '1px dashed var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--accent)', marginBottom: 12 }}>+ Условие</button>

        <label style={lbl}>Действия</label>
        {hasAbonementCond && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={!!form.actions?.create_lead_if_missing}
              onChange={e => setF({ actions: { ...form.actions, create_lead_if_missing: e.target.checked } })} />
            Создать заявку, если нет
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={!!form.actions?.task}
            onChange={e => setF({ actions: { ...form.actions, task: e.target.checked
              ? { type_id: null, text: '', due_in_hours: 1, responsible: 'lead_manager' }
              : null } })} />
          Поставить задачу
        </label>
        {form.actions?.task && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
            <label style={{ ...lbl, marginTop: 0 }}>Тип задачи</label>
            <select style={sel} value={form.actions.task.type_id ?? ''} onChange={e => setF({ actions: { ...form.actions, task: { ...form.actions!.task!, type_id: e.target.value || null } } })}>
              <option value="">— без типа —</option>
              {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label style={lbl}>Текст задачи</label>
            <input style={inp} value={form.actions.task.text} onChange={e => setF({ actions: { ...form.actions, task: { ...form.actions!.task!, text: e.target.value } } })} placeholder="Описание задачи" />
            <label style={lbl}>Срок через (ч)</label>
            <input style={{ ...inp, width: 80 }} type="number" min="0"
              value={form.actions.task.due_in_hours}
              onChange={e => setF({ actions: { ...form.actions, task: { ...form.actions!.task!, due_in_hours: Number(e.target.value) } } })} />
            <label style={lbl}>Ответственный</label>
            <select style={sel} value={form.actions.task.responsible} onChange={e => setF({ actions: { ...form.actions, task: { ...form.actions!.task!, responsible: e.target.value } } })}>
              <option value="lead_manager">Менеджер заявки</option>
              <option value="all_managers">Все менеджеры</option>
            </select>
          </div>
        )}

        {!isNew && (
          <button onClick={runPreview} disabled={previewLoading} style={{ width: '100%', padding: '8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: previewLoading ? 'wait' : 'pointer', fontFamily: 'inherit', color: 'var(--accent)', marginBottom: 8 }}>
            {previewLoading ? 'Проверка…' : 'Проверить (не менять данные)'}
          </button>
        )}
        {preview && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Подойдут: {preview.total} заявок{preview.total > 100 ? ` (показано 100)` : ''}</div>
            {preview.already_on_target > 0 && (
              <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Уже на целевом этапе: {preview.already_on_target}</div>
            )}
            {preview.no_client_or_visit > 0 && (
              <div style={{ color: 'var(--text-3)', marginBottom: 6 }}>Без клиента/визита: {preview.no_client_or_visit}</div>
            )}
            {preview.items.map(it => (
              <div key={it.lead_id} style={{ color: 'var(--text-2)', marginBottom: 2 }}>
                {it.title ?? 'Без названия'} &nbsp;{it.from} → {it.to}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={save} disabled={saving} style={{ flex: 1, padding: '10px', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button onClick={onCancel} style={{ padding: '10px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>Отмена</button>
        </div>
      </div>
    </>
  );
}

// ── Log modal ─────────────────────────────────────────────────────────────────

function LogModal({ ruleId, onClose }: { ruleId: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = ruleId ? `/kviz/api/crm/automation/log?rule_id=${ruleId}&limit=200` : '/kviz/api/crm/automation/log?limit=200';
    api('GET', url).then(({ ok, data }) => {
      if (ok && Array.isArray(data)) setEntries(data);
      setLoading(false);
    });
  }, [ruleId]);

  const ACTION_LABEL: Record<string, string> = { move: 'Перенос', create_lead: 'Создана заявка', task: 'Задача', skip: 'Пропущено' };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'var(--surface)', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.18)', padding: 20, width: 'min(700px, 95vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Журнал автоматизации</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3)' }}>✕</button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {loading ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Загрузка…</div> :
           entries.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Журнал пуст</div> :
           entries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-3)', minWidth: 110 }}>{fmtTime(e.created_at)}</span>
              <span style={{ padding: '1px 6px', borderRadius: 5, background: e.mode === 'test' ? '#fff8e1' : 'var(--surface-2)', color: e.mode === 'test' ? '#f57c00' : 'var(--text-2)' }}>{e.mode}</span>
              <span style={{ color: 'var(--text)' }}>{e.lead_title ?? e.lead_id ?? '—'}</span>
              <span style={{ color: e.action === 'skip' ? 'var(--danger)' : 'var(--success)' }}>{ACTION_LABEL[e.action] ?? e.action}</span>
              {e.skip_reason && <span style={{ color: 'var(--text-3)' }}>{e.skip_reason}</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AutomationSettings() {
  const [rules, setRules]       = useState<AutoRule[]>([]);
  const [funnels, setFunnels]   = useState<Funnel[]>([]);
  const [stages, setStages]     = useState<Stage[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [settings, setSettings] = useState<AutoSettings>({ min_plan_price: 40000, manual_hold_hours: 24 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<AutoSettings | null>(null);
  const [editRule, setEditRule]   = useState<Partial<AutoRule> | null>(null);
  const [logRuleId, setLogRuleId] = useState<string | false>(false);
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{ total: number; already_on_target: number; no_client_or_visit?: number } | null>(null);
  const [running, setRunning]   = useState(false);
  const [dragActive, setDragActive] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor));

  const load = useCallback(async () => {
    const [rulesR, ttR] = await Promise.all([
      api('GET', '/kviz/api/crm/automation/rules'),
      api('GET', '/kviz/api/crm/task-types'),
    ]);
    if (rulesR.ok) {
      const d = rulesR.data as { rules: AutoRule[]; stages: Stage[]; funnels: Funnel[] };
      setRules(d.rules ?? []);
      setFunnels(d.funnels ?? []);
      setStages(d.stages ?? []);
    }
    if (ttR.ok && Array.isArray(ttR.data)) setTaskTypes(ttR.data);
    const { ok, data } = await api('GET', '/kviz/api/crm/automation/settings');
    if (ok) setSettings(data as AutoSettings);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setRunning(true);
    const { ok, data } = await api('POST', '/kviz/api/crm/automation/run');
    setRunning(false);
    if (ok) toast.success('Запущено'); else toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка');
    setTimeout(load, 3000);
  }

  async function saveRule(form: Partial<AutoRule>) {
    const url = form.id ? `/kviz/api/crm/automation/rules/${form.id}` : '/kviz/api/crm/automation/rules';
    const method = form.id ? 'PATCH' : 'POST';
    const { ok, data } = await api(method, url, form);
    if (!ok) { toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setEditRule(null);
    toast.success('Сохранено');
    load();
  }

  async function changeMode(rule: AutoRule, mode: 'off' | 'test' | 'live') {
    if (mode === 'live' && rule.mode !== 'live') {
      // Fetch preview count
      const { ok, data } = await api('POST', `/kviz/api/crm/automation/rules/${rule.id}/preview`);
      const count = ok ? (data as { total: number }).total : 0;
      const confirmed = await showConfirm(`Правило начнёт переносить заявки. Последняя проверка: ${count} заявок. Включить?`);
      if (!confirmed) return;
    }
    const { ok, data } = await api('PATCH', `/kviz/api/crm/automation/rules/${rule.id}`, { mode });
    if (!ok) { toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, mode } : r));
  }

  async function duplicateRule(rule: AutoRule) {
    const { name, ...rest } = rule;
    const { ok, data } = await api('POST', '/kviz/api/crm/automation/rules', { ...rest, name: name + ' (копия)', mode: 'off', id: undefined });
    if (!ok) { toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    toast.success('Правило скопировано');
    load();
  }

  async function deleteRule(rule: AutoRule) {
    const confirmed = await showConfirm(`Удалить правило «${rule.name}»?`);
    if (!confirmed) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/automation/rules/${rule.id}`);
    if (!ok) { toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setRules(rs => rs.filter(r => r.id !== rule.id));
    toast.success('Удалено');
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    const { ok, data } = await api('PUT', '/kviz/api/crm/automation/settings', settingsDraft);
    setSettingsSaving(false);
    if (!ok) { toast.error((data as Record<string,unknown>)?.error as string ?? 'Ошибка'); return; }
    setSettings(settingsDraft); setSettingsDraft(null); setSettingsOpen(false);
    toast.success('Сохранено');
  }

  function handleDragStart(e: DragStartEvent) { setDragActive(String(e.active.id)); }
  async function handleDragEnd(e: DragEndEvent) {
    setDragActive(null);
    if (!e.over || e.active.id === e.over.id) return;
    const ids = rules.map(r => r.id);
    const from = ids.indexOf(String(e.active.id));
    const to   = ids.indexOf(String(e.over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(e.active.id));
    setRules(rules.slice().sort((a, b) => next.indexOf(a.id) - next.indexOf(b.id)));
    await api('PATCH', '/kviz/api/crm/automation/rules/reorder', { ids: next });
  }

  // Group rules by target funnel
  const groups = funnels.map(f => ({
    funnel: f,
    rules: rules.filter(r => r.target_funnel_id === f.id),
  })).filter(g => g.rules.length > 0);
  // Rules without matching funnel
  const orphans = rules.filter(r => !funnels.some(f => f.id === r.target_funnel_id));

  const lastRun = rules.reduce((best, r) => {
    if (!r.last_run_at) return best;
    return !best || r.last_run_at > best ? r.last_run_at : best;
  }, null as string | null);

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 16, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '16px 20px 60px', fontFamily: "'Manrope',system-ui,sans-serif", maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>
          Запуск: каждые 15 мин и после продажи · последний прогон: {fmtTime(lastRun)}
        </div>
        <button onClick={runNow} disabled={running} style={{ padding: '7px 16px', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: running ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {running ? 'Запускаю…' : 'Запустить сейчас'}
        </button>
      </div>

      {/* Collapsible settings */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
        <button onClick={() => { setSettingsOpen(o => !o); setSettingsDraft(settings); }} style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: 'var(--text)', gap: 8 }}>
          <span style={{ flex: 1, textAlign: 'left' }}>Общие параметры</span>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{settingsOpen ? '▲' : '▼'}</span>
        </button>
        {settingsOpen && settingsDraft && (
          <div style={{ padding: '0 14px 14px' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Абонемент считается купленным от (₸)</label>
            <input style={{ ...inp, width: 160 }} type="number" min="0"
              value={settingsDraft.min_plan_price}
              onChange={e => setSettingsDraft(d => d ? { ...d, min_plan_price: Number(e.target.value) } : d)} />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, marginTop: 10 }}>Не трогать заявку (ч) после ручного переноса</label>
            <input style={{ ...inp, width: 100 }} type="number" min="0"
              value={settingsDraft.manual_hold_hours}
              onChange={e => setSettingsDraft(d => d ? { ...d, manual_hold_hours: Number(e.target.value) } : d)} />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={saveSettings} disabled={settingsSaving} style={{ padding: '7px 16px', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: settingsSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{settingsSaving ? '…' : 'Сохранить'}</button>
              <button onClick={() => setSettingsOpen(false)} style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>Отмена</button>
            </div>
          </div>
        )}
      </div>

      {/* Rules list */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {groups.map(g => (
          <div key={g.funnel.id} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{g.funnel.name}</div>
            {g.rules.map(rule => (
              <DragRow key={rule.id} id={rule.id}>
                <RuleCard
                  rule={rule} funnels={funnels} stages={stages}
                  onEdit={() => setEditRule(rule)}
                  onPreview={async () => {
                    const { ok, data } = await api('POST', `/kviz/api/crm/automation/rules/${rule.id}/preview`);
                    if (ok) {
                      const d = data as { total: number; already_on_target: number; no_client_or_visit: number; items: { lead_id: string; title: string | null; from: string; to: string }[] };
                      setPreviewResult({ total: d.total, already_on_target: d.already_on_target, no_client_or_visit: d.no_client_or_visit });
                      const parts = [`Подойдут ${d.total} заявок`];
                      if (d.already_on_target) parts.push(`уже на этапе ${d.already_on_target}`);
                      if (d.no_client_or_visit) parts.push(`без визита ${d.no_client_or_visit}`);
                      toast.info(parts.join(' · '));
                    } else toast.error('Ошибка');
                  }}
                  onLog={() => setLogRuleId(rule.id)}
                  onDuplicate={() => duplicateRule(rule)}
                  onDelete={() => deleteRule(rule)}
                  onModeChange={m => changeMode(rule, m)}
                />
              </DragRow>
            ))}
          </div>
        ))}
        {orphans.map(rule => (
          <DragRow key={rule.id} id={rule.id}>
            <RuleCard rule={rule} funnels={funnels} stages={stages}
              onEdit={() => setEditRule(rule)} onPreview={async () => { await api('POST', `/kviz/api/crm/automation/rules/${rule.id}/preview`); }}
              onLog={() => setLogRuleId(rule.id)} onDuplicate={() => duplicateRule(rule)}
              onDelete={() => deleteRule(rule)} onModeChange={m => changeMode(rule, m)} />
          </DragRow>
        ))}
        <DragOverlay>{dragActive ? <div style={{ opacity: 0.8, background: 'var(--surface)', border: '2px solid var(--primary)', borderRadius: 10, padding: 10 }}>Перемещение…</div> : null}</DragOverlay>
      </DndContext>

      <button onClick={() => setEditRule({})} style={{ padding: '8px 18px', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}>+ Правило</button>

      {/* Lead rules section */}
      <div style={{ marginTop: 40 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>Задачи по заявкам</div>
        <LeadRulesBlock />
      </div>

      {/* Editor panel */}
      {editRule !== null && (
        <RuleEditor
          rule={editRule} funnels={funnels} stages={stages} taskTypes={taskTypes}
          onSave={saveRule} onCancel={() => setEditRule(null)} />
      )}

      {/* Log modal */}
      {logRuleId !== false && <LogModal ruleId={logRuleId === true ? null : logRuleId} onClose={() => setLogRuleId(false)} />}
    </div>
  );
}

// ── Lead rules block (задачи по заявкам) ──────────────────────────────────────

interface LeadRule { id: string; code: string; is_enabled: boolean; params: Record<string, unknown> }

const RULE_LABELS: Record<string, string> = {
  lead_first_contact: 'Первый контакт (при создании заявки)',
  stage_task: 'Задача при входе в этап',
};
const RULE_PARAM_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  lead_first_contact: [
    { key: 'funnel_name',    label: 'Воронка (содержит)',      type: 'text' },
    { key: 'task_type',      label: 'Тип задачи',              type: 'text' },
    { key: 'due_in_minutes', label: 'Срок через (мин)',        type: 'number' },
    { key: 'text',           label: 'Текст задачи',            type: 'text' },
  ],
  stage_task: [
    { key: 'funnel_name',    label: 'Воронка (содержит)',      type: 'text' },
    { key: 'stage_name',     label: 'Этап (содержит)',         type: 'text' },
    { key: 'task_type',      label: 'Тип задачи',              type: 'text' },
    { key: 'due_in_minutes', label: 'Срок через (мин, 0=без)', type: 'number' },
    { key: 'text',           label: 'Текст задачи',            type: 'text' },
  ],
};

function LeadRulesBlock() {
  const [rules, setRules] = useState<LeadRule[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    const { ok, data } = await api('GET', '/kviz/api/crm/lead-rules');
    if (ok && Array.isArray(data)) setRules(data);
  }
  useEffect(() => { load(); }, []);

  async function toggleEnabled(rule: LeadRule) {
    const { ok } = await api('PATCH', `/kviz/api/crm/lead-rules/${rule.id}`, { is_enabled: !rule.is_enabled });
    if (ok) load(); else toast.error('Ошибка');
  }

  async function saveParams(rule: LeadRule) {
    setSaving(true);
    const { ok } = await api('PATCH', `/kviz/api/crm/lead-rules/${rule.id}`, { params });
    setSaving(false);
    if (ok) { setEditId(null); load(); } else toast.error('Ошибка');
  }

  const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 16, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' };

  if (!rules.length) return <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Правила не настроены</div>;

  return (
    <div>
      {rules.map(rule => (
        <div key={rule.id} style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8, background: 'var(--surface-2)', borderRadius: '10px 10px 0 0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{RULE_LABELS[rule.code] ?? rule.code}</div>
            </div>
            <button onClick={() => toggleEnabled(rule)} style={{ padding: '4px 12px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: rule.is_enabled ? 'var(--primary)' : 'var(--surface-2)', color: rule.is_enabled ? '#fff' : 'var(--text-2)' }}>
              {rule.is_enabled ? 'Включено' : 'Выключено'}
            </button>
            <button onClick={() => { setEditId(editId === rule.id ? null : rule.id); setParams({ ...rule.params }); }} style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>
              {editId === rule.id ? 'Скрыть' : 'Параметры'}
            </button>
          </div>
          {editId === rule.id && (
            <div style={{ padding: '12px 14px' }}>
              {(RULE_PARAM_FIELDS[rule.code] ?? []).map(f => (
                <div key={f.key} style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>{f.label}</label>
                  <input style={inp} type={f.type ?? 'text'} value={String(params[f.key] ?? '')}
                    onChange={e => setParams(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} />
                </div>
              ))}
              <button onClick={() => saveParams(rule)} disabled={saving} style={{ padding: '7px 16px', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {saving ? '…' : 'Сохранить'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
