import { useState, useEffect } from 'react';
import { useRole } from '../../lib/permContext';

export interface ShowIf {
  key: string;
  op: 'eq' | 'neq' | 'contains' | 'not_contains' | 'not_none' | 'in' | 'gte' | 'lte';
  value: string | string[] | number;
}

export interface StageItem {
  key: string; block: string;
  type: 'question' | 'check' | 'text' | 'comment' | 'multi' | 'number' | 'date';
  label: string; hint?: string; required: boolean;
  options?: string[]; who: 'human' | 'auto'; rule?: string | null;
  allow_other?: boolean; none_option?: boolean; min?: number; max?: number; show_if?: ShowIf;
}

export interface StageHelper {
  manager?: string | null; transition?: string | null;
  important?: string | null; agent?: string | null;
}

export interface QualifyResult {
  score: number; temperature: string;
  warnings: { group: 'stop' | 'temporary' | 'attention'; label: string }[];
  flags: string[];
}

export interface PopupStage {
  id: string; name: string; kind: string;
  helper?: StageHelper | null;
  require_comment?: boolean;
  action_label?: string;
  checklist?: StageItem[];
  memo?: string | null;
}

export interface AnswerEntry {
  id: string; item_key: string; kind: string; stage_id: string | null;
  answer_option?: string | null; answer_text?: string | null;
  author: string; created_at: string;
}

interface LostReason { id: string; name: string; }
interface ItemAnswer { item_key: string; kind: string; answer_option?: string; answer_text?: string; }
interface Hint { id: string; stage: string; block: string; title: string; text: string; tone?: 'normal' | 'warning' | 'stop'; }

interface Props {
  mode: 'move' | 'memo';
  stage: PopupStage;
  lostReasons: LostReason[];
  onConfirm: (params: { comment?: string; lost_reason_id?: string; answers?: ItemAnswer[] }) => void;
  onCancel: () => void;
  leadId?: string;
  qualify?: QualifyResult | null;
}

// ID → display label for qualify-mapped item options
const OPT_LABEL: Record<string, string> = {
  near: 'До 15 минут', medium: '15–30 минут', far: '30–60 минут', very_far: 'Больше часа',
  female: 'Женщина', male: 'Мужчина',
  under18: 'До 18', '18-25': '18–25', '26-35': '26–35', '36-45': '36–45', '46-55': '46–55', '56+': '56+',
  yes: 'Да', no: 'Нет',
  lt6w: 'Меньше 6 недель', '6w-6m': '6 недель – 6 месяцев', gt6m: 'Больше 6 месяцев',
  pregnancy: 'Беременность', pacemaker: 'Кардиостимулятор', heart: 'Серьёзные проблемы с сердцем',
  epilepsy: 'Эпилепсия', oncology: 'Онкология', anticoag: 'Приём антикоагулянтов',
  transplant: 'Трансплантация органов', cyst: 'Киста / миома',
  surgery: 'Операция за последние 3 месяца', infection: 'Острая инфекция / простуда',
  pressure: 'Давление (повышенное или пониженное)', diabetes: 'Диабет / инсулинорезистентность',
  hernia: 'Грыжа (поясничная, паховая, живота)', knees: 'Проблемы с коленями',
  circulation: 'Нарушения кровообращения / варикоз', dizziness: 'Головокружения',
  thyroid: 'Заболевания щитовидной железы', lipedema: 'Липедема',
  belly: 'Живот', sides: 'Талия и бока', hips: 'Бёдра и ягодицы', legs: 'Ноги и икры',
  arms: 'Руки', weight: 'Скинуть общий вес', cellulite: 'Целлюлит и тонус кожи', edema: 'Отёки и тяжесть в ногах',
  self: 'Сам(а)', family: 'Посоветоваться с семьёй',
  this_week: 'На этой неделе', next_week: 'На следующей', this_month: 'В течение месяца', later: 'Позже',
};
function optLabel(opt: string) { return OPT_LABEL[opt] ?? opt; }

function stageHintKey(name: string): string | null {
  if (name.includes('B.A.N.T') || name.toLowerCase().includes('bant')) return 'bant';
  if (name.includes('Нет ответа')) return 'no_ans';
  if (name.includes('Записан') || name.includes('Подтвержден')) return 'booked';
  if (name.includes('Пришёл') || name.includes('Пришел')) return 'arrived';
  return null;
}

function groupBy<T>(arr: T[], fn: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ??= []).push(x); return acc; }, {} as Record<string, T[]>);
}

export default function StagePopup({ mode, stage, lostReasons, onConfirm, onCancel, leadId, qualify }: Props) {
  const role = useRole();
  const isAdmin = role === 'admin';

  const [comment, setComment]           = useState('');
  const [lostReasonId, setLostId]       = useState('');
  const [answers, setAnswers]           = useState<Record<string, ItemAnswer>>({});
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  const [answerLog, setAnswerLog]       = useState<AnswerEntry[]>([]);
  const [logStageFilter, setLogFilter]  = useState('');
  const [logStages, setLogStages]       = useState<{ id: string; name: string }[]>([]);
  const [autoOpen, setAutoOpen]         = useState(false);
  const [tab, setTab]                   = useState<'items' | 'hint' | 'log'>('items');
  const [hints, setHints]               = useState<Hint[]>([]);
  const [selfQualify, setSelfQualify]   = useState<QualifyResult | null>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  const activeQualify = qualify ?? selfQualify;

  const checklist   = stage.checklist ?? [];
  const humanItems  = checklist.filter(it => it.who !== 'auto');
  const autoItems   = checklist.filter(it => it.who === 'auto');
  const helper      = stage.helper ?? {};
  const needLost    = stage.kind === 'fail';
  const reqComment  = stage.require_comment && mode === 'move';
  const hintKey     = stageHintKey(stage.name);

  // Self-fetch qualify when not passed as prop
  useEffect(() => {
    if (qualify !== undefined || !leadId) return;
    fetch(`/kviz/api/crm/leads/${leadId}`, { credentials: 'include' })
      .then(r => r.json()).then(d => { if (d?.qualify) setSelfQualify(d.qualify); }).catch(() => {});
  }, [leadId, qualify]);

  // Load hints by stage key
  useEffect(() => {
    if (!hintKey) { setHints([]); return; }
    fetch(`/kviz/api/crm/hints?stage=${encodeURIComponent(hintKey)}`, { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setHints(d); }).catch(() => {});
  }, [hintKey]);

  // Load answer log + stage names
  useEffect(() => {
    if (!leadId) return;
    fetch(`/kviz/api/crm/leads/${leadId}/answers`, { credentials: 'include' })
      .then(r => r.json()).then((d: AnswerEntry[]) => {
        if (!Array.isArray(d)) return;
        setAnswerLog(d);
        const seen = new Map<string, string>();
        for (const a of d) if (a.stage_id) seen.set(a.stage_id, a.stage_id);
        setLogStages([...seen.entries()].map(([id]) => ({ id, name: id })));
      }).catch(() => {});
  }, [leadId]);

  function setAnswer(key: string, kind: string, patch: Partial<ItemAnswer>) {
    setAnswers(prev => ({ ...prev, [key]: { ...prev[key], item_key: key, kind, ...patch } }));
  }

  function toggleMulti(key: string, opt: string, isNone?: boolean) {
    setMultiAnswers(prev => {
      const cur = prev[key] ?? [];
      if (isNone) return { ...prev, [key]: cur.includes(opt) ? [] : [opt] };
      const without = cur.filter(o => o !== '__none__');
      const idx = without.indexOf(opt);
      return { ...prev, [key]: idx >= 0 ? without.filter(o => o !== opt) : [...without, opt] };
    });
  }

  // Show-if evaluation
  function isVisible(it: StageItem): boolean {
    if (!it.show_if) return true;
    const { key, op, value } = it.show_if;
    const a = answers[key];
    const sel = multiAnswers[key] ?? [];
    const opt = a?.answer_option ?? '';
    const txt = a?.answer_text ?? '';
    switch (op) {
      case 'eq':           return opt === String(value);
      case 'neq':          return opt !== String(value);
      case 'contains':     return sel.includes(String(value)) || opt === String(value);
      case 'not_contains': return !sel.includes(String(value)) && opt !== String(value);
      case 'not_none':     return !!a || sel.length > 0;
      case 'in':           return Array.isArray(value) && value.includes(opt);
      case 'gte':          return Number(txt || opt) >= Number(value);
      case 'lte':          return Number(txt || opt) <= Number(value);
    }
    return true;
  }

  const visibleHumanItems = humanItems.filter(it => isVisible(it));
  const missingRequired = visibleHumanItems.filter(it => {
    if (!it.required) return false;
    const a = answers[it.key];
    if (it.type === 'check')   return !a;
    if (it.type === 'question') return !a?.answer_option;
    if (it.type === 'text' || it.type === 'comment') return !a?.answer_text?.trim();
    if (it.type === 'multi')   return (multiAnswers[it.key] ?? []).length === 0;
    if (it.type === 'number')  return !a?.answer_text?.trim();
    if (it.type === 'date')    return !a?.answer_text?.trim();
    return false;
  });

  const canConfirm = mode !== 'move' || (
    (!needLost || !!lostReasonId) &&
    missingRequired.length === 0 &&
    (!reqComment || !!comment.trim())
  );

  function handleConfirm() {
    const ans: ItemAnswer[] = Object.values(answers);
    for (const [key, opts] of Object.entries(multiAnswers)) {
      if (!opts.length) continue;
      const kind = checklist.find(it => it.key === key)?.type ?? 'multi';
      for (const opt of opts) ans.push({ item_key: key, kind, answer_option: opt });
    }
    onConfirm({
      comment:        comment.trim() || undefined,
      lost_reason_id: lostReasonId || undefined,
      answers:        ans.length ? ans : undefined,
    });
  }

  const filteredLog   = logStageFilter ? answerLog.filter(a => a.stage_id === logStageFilter) : answerLog;
  const itemsByBlock  = groupBy(visibleHumanItems, it => it.block || '');
  const hintsByBlock  = groupBy(hints, h => h.block || '');
  const hintBlocks    = Object.keys(hintsByBlock).slice(0, 2);

  // ── Warnings ──────────────────────────────────────────────────────────────
  function renderWarnings() {
    if (!activeQualify?.warnings?.length) return null;
    const C = {
      stop:      { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', label: '⛔ Стоп' },
      temporary: { bg: '#fff7ed', border: '#fed7aa', text: '#ea580c', label: '⏸ Временно' },
      attention: { bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb', label: 'ℹ️ Внимание' },
    } as const;
    return (
      <div style={{ marginBottom: 12 }}>
        {activeQualify!.warnings.map((w, i) => {
          const c = C[w.group] ?? C.attention;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 7, padding: '6px 10px', marginBottom: 4, fontSize: 12 }}>
              <span style={{ color: c.text, fontWeight: 700, flexShrink: 0 }}>{c.label}</span>
              <span style={{ color: c.text }}>{w.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render items panel ──────────────────────────────────────────────────
  function renderItems() {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
        {renderWarnings()}
        {Object.entries(itemsByBlock).map(([block, items]) => (
          <div key={block} style={{ marginBottom: 16 }}>
            {block && (
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{block}</div>
            )}
            {items.map(it => (
              <div key={it.key} style={{ marginBottom: 12 }}>

                {it.type === 'check' && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: mode === 'memo' ? 'default' : 'pointer', fontSize: 13, color: 'var(--text)' }}>
                    <input
                      type="checkbox" disabled={mode === 'memo'}
                      checked={!!answers[it.key]}
                      onChange={e => { if (e.target.checked) setAnswer(it.key, 'check', {}); else setAnswers(p => { const n = {...p}; delete n[it.key]; return n; }); }}
                      style={{ marginTop: 1, flexShrink: 0 }}
                    />
                    <span>{it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}</span>
                  </label>
                )}

                {it.type === 'question' && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                      {it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
                    </div>
                    {(it.options ?? []).map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text)', marginBottom: 4, cursor: mode === 'memo' ? 'default' : 'pointer' }}>
                        <input type="radio" name={it.key} disabled={mode === 'memo'}
                          checked={answers[it.key]?.answer_option === opt}
                          onChange={() => setAnswer(it.key, 'question', { answer_option: opt })}
                        />
                        {optLabel(opt)}
                      </label>
                    ))}
                    {mode !== 'memo' && (
                      <input type="text" placeholder="Свободный ответ..."
                        value={answers[it.key]?.answer_text ?? ''}
                        onChange={e => setAnswer(it.key, 'question', { answer_text: e.target.value || undefined })}
                        style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                      />
                    )}
                  </div>
                )}

                {(it.type === 'text' || it.type === 'comment') && (
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                      {it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
                    </label>
                    <textarea disabled={mode === 'memo'}
                      value={answers[it.key]?.answer_text ?? ''}
                      onChange={e => setAnswer(it.key, it.type, { answer_text: e.target.value })}
                      rows={2} placeholder={mode === 'memo' ? '' : 'Введите текст...'}
                      style={{ width: '100%', padding: '7px 9px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>
                )}

                {it.type === 'multi' && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                      {it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
                    </div>
                    {it.none_option && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text)', marginBottom: 4, cursor: mode === 'memo' ? 'default' : 'pointer' }}>
                        <input type="checkbox" disabled={mode === 'memo'}
                          checked={(multiAnswers[it.key] ?? []).includes('__none__')}
                          onChange={() => toggleMulti(it.key, '__none__', true)}
                        />
                        Нет противопоказаний
                      </label>
                    )}
                    {(it.options ?? []).map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text)', marginBottom: 4, cursor: mode === 'memo' ? 'default' : 'pointer' }}>
                        <input type="checkbox" disabled={mode === 'memo'}
                          checked={(multiAnswers[it.key] ?? []).includes(opt)}
                          onChange={() => toggleMulti(it.key, opt)}
                        />
                        {optLabel(opt)}
                      </label>
                    ))}
                  </div>
                )}

                {it.type === 'number' && (
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                      {it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
                    </label>
                    <input type="number" disabled={mode === 'memo'}
                      value={answers[it.key]?.answer_text ?? ''}
                      min={it.min} max={it.max}
                      onChange={e => setAnswer(it.key, 'number', { answer_text: e.target.value })}
                      placeholder={it.min != null && it.max != null ? `${it.min}–${it.max}` : ''}
                      style={{ width: '100%', padding: '7px 9px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>
                )}

                {it.type === 'date' && (
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                      {it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
                    </label>
                    <input type="date" disabled={mode === 'memo'}
                      value={answers[it.key]?.answer_text ?? ''}
                      onChange={e => setAnswer(it.key, 'date', { answer_text: e.target.value })}
                      style={{ width: '100%', padding: '7px 9px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>
                )}

                {it.hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{it.hint}</div>}
              </div>
            ))}
          </div>
        ))}

        {mode === 'move' && needLost && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>Причина отказа <span style={{ color: 'var(--danger)' }}>*</span></label>
            <select value={lostReasonId} onChange={e => setLostId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
              <option value="">Выберите причину...</option>
              {lostReasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        {mode === 'move' && (
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
              Комментарий{reqComment ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
            </label>
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              rows={2} placeholder={reqComment ? 'Обязательно...' : 'Необязательно...'}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
        )}

        {isAdmin && autoItems.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => setAutoOpen(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-3)', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {autoOpen ? '▾' : '▸'} Автоматика ({autoItems.length})
            </button>
            {autoOpen && (
              <div style={{ marginTop: 6, paddingLeft: 10 }}>
                {autoItems.map(it => (
                  <div key={it.key} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {it.rule ? <><strong>{it.rule}:</strong> {it.label}</> : it.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'move' && !canConfirm && missingRequired.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
            Не заполнено: {missingRequired.map(it => it.label).join(', ')}
          </div>
        )}
      </div>
    );
  }

  // ── Render helper panel ──────────────────────────────────────────────────
  function renderHelper() {
    const sections: { key: keyof StageHelper; title: string }[] = [
      { key: 'manager', title: 'Что делает менеджер' },
      { key: 'transition', title: 'Переход' },
      { key: 'important', title: 'Важно' },
    ];
    if (isAdmin) sections.push({ key: 'agent', title: 'Автоматика' });
    const memo = (stage as Record<string, unknown>).memo as string | null;
    const toneColor = { stop: '#dc2626', warning: '#f59e0b', normal: 'var(--primary)' };
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {memo && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)', marginBottom: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{memo}</div>
        )}
        {sections.map(({ key, title }) => {
          const text = helper[key];
          if (!text) return null;
          return (
            <details key={key} style={{ marginBottom: 8 }}>
              <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer', userSelect: 'none', padding: '6px 0' }}>{title}</summary>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', paddingTop: 6, paddingLeft: 2 }}>{text}</div>
            </details>
          );
        })}
        {hintBlocks.map(block => (
          <details key={block} open style={{ marginBottom: 8 }}>
            <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', cursor: 'pointer', userSelect: 'none', padding: '6px 0' }}>💬 {block}</summary>
            <div style={{ paddingTop: 4 }}>
              {hintsByBlock[block].map(h => (
                <div key={h.id} style={{ borderLeft: `3px solid ${toneColor[h.tone ?? 'normal']}`, paddingLeft: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{h.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{h.text}</div>
                </div>
              ))}
            </div>
          </details>
        ))}
        {!memo && sections.every(s => !helper[s.key]) && hintBlocks.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Подсказки не заданы</div>
        )}
      </div>
    );
  }

  // ── Render answer log ────────────────────────────────────────────────────
  function renderLog() {
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {logStages.length > 0 && (
          <select value={logStageFilter} onChange={e => setLogFilter(e.target.value)}
            style={{ width: '100%', marginBottom: 8, padding: '5px 8px', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}>
            <option value="">Все этапы</option>
            {logStages.map(s => <option key={s.id} value={s.id}>{s.id.slice(0, 8)}…</option>)}
          </select>
        )}
        {filteredLog.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Ответов пока нет</div>}
        {filteredLog.map(a => (
          <div key={a.id} style={{ background: 'var(--surface-2)', borderRadius: 7, padding: '7px 10px', marginBottom: 6, fontSize: 12 }}>
            <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{a.author} · {new Date(a.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{a.item_key}</div>
            {a.answer_option && <div style={{ color: 'var(--primary)' }}>{optLabel(a.answer_option)}</div>}
            {a.answer_text   && <div style={{ color: 'var(--text)' }}>{a.answer_text}</div>}
          </div>
        ))}
      </div>
    );
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
  };

  const title = (
    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 12 }}>
      {mode === 'move' ? `Перейти: ${stage.name}` : stage.name}
    </div>
  );

  const buttons = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexShrink: 0 }}>
      <button type="button" onClick={onCancel}
        style={{ padding: '8px 16px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        Отмена
      </button>
      {mode === 'move' && (
        <button type="button" disabled={!canConfirm} onClick={handleConfirm}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: canConfirm ? 'var(--primary)' : 'var(--border)', color: canConfirm ? '#fff' : 'var(--text-3)', fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          {stage.action_label || 'Подтвердить'}
        </button>
      )}
      {mode === 'memo' && (
        <button type="button" onClick={() => onConfirm({})}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Понятно
        </button>
      )}
    </div>
  );

  if (isMobile) {
    const tabs: { key: 'items' | 'hint' | 'log'; label: string }[] = [
      { key: 'items', label: 'Пункты' },
      { key: 'hint',  label: 'Подсказка' },
      { key: 'log',   label: 'Лог' },
    ];
    return (
      <div style={overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
        <div style={{ width: '100%', background: 'var(--surface)', borderRadius: '16px 16px 0 0', padding: '16px 16px 20px', boxSizing: 'border-box', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          {title}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexShrink: 0 }}>
            {tabs.map(t => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                style={{ padding: '5px 12px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', background: tab === t.key ? 'var(--primary)' : 'var(--surface-2)', color: tab === t.key ? '#fff' : 'var(--text-2)' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {tab === 'items' && renderItems()}
            {tab === 'hint'  && renderHelper()}
            {tab === 'log'   && renderLog()}
          </div>
          {buttons}
        </div>
      </div>
    );
  }

  const hasHelper = !!(helper.manager || helper.transition || helper.important || (isAdmin && helper.agent) || (stage as Record<string,unknown>).memo) || !!hintKey;
  const hasLog    = !!leadId;
  const colCount  = 1 + (hasHelper ? 1 : 0) + (hasLog ? 1 : 0);
  const widths    = colCount === 3 ? ['1fr', '1fr', '260px'] : colCount === 2 ? ['1fr', '300px'] : ['1fr'];

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{
        background: 'var(--surface)', borderRadius: 14, padding: '20px 20px 16px',
        width: colCount === 3 ? 940 : colCount === 2 ? 680 : 460,
        maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        {title}
        <div style={{ display: 'grid', gridTemplateColumns: widths.join(' '), gap: 16, flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {renderItems()}
          </div>
          {hasHelper && (
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', paddingLeft: 16, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Подсказка</div>
              {renderHelper()}
            </div>
          )}
          {hasLog && (
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', paddingLeft: 16, overflow: 'hidden' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Лог ответов</div>
              {renderLog()}
            </div>
          )}
        </div>
        {buttons}
      </div>
    </div>
  );
}
