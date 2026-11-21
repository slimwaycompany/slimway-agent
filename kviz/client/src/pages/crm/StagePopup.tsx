import { useState, useEffect } from 'react';
import { useRole } from '../../lib/permContext';

export interface StageItem {
  key: string; block: string;
  type: 'question' | 'check' | 'text' | 'comment';
  label: string; hint?: string; required: boolean;
  options?: string[]; who: 'human' | 'auto'; rule?: string | null;
}

export interface StageHelper {
  manager?: string | null; transition?: string | null;
  important?: string | null; agent?: string | null;
}

export interface PopupStage {
  id: string; name: string; kind: string;
  helper?: StageHelper | null;
  require_comment?: boolean;
  action_label?: string;
  checklist?: StageItem[];
  // legacy format support
  memo?: string | null;
}

export interface AnswerEntry {
  id: string; item_key: string; kind: string; stage_id: string | null;
  answer_option?: string | null; answer_text?: string | null;
  author: string; created_at: string;
}

interface LostReason { id: string; name: string; }

interface ItemAnswer { item_key: string; kind: string; answer_option?: string; answer_text?: string; }

interface Props {
  mode: 'move' | 'memo';
  stage: PopupStage;
  lostReasons: LostReason[];
  onConfirm: (params: { comment?: string; lost_reason_id?: string; answers?: ItemAnswer[] }) => void;
  onCancel: () => void;
  leadId?: string;
}

function groupBy<T>(arr: T[], fn: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ??= []).push(x); return acc; }, {} as Record<string, T[]>);
}

export default function StagePopup({ mode, stage, lostReasons, onConfirm, onCancel, leadId }: Props) {
  const role = useRole();
  const isAdmin = role === 'admin';

  const [comment, setComment]       = useState('');
  const [lostReasonId, setLostId]   = useState('');
  const [answers, setAnswers]       = useState<Record<string, ItemAnswer>>({});
  const [answerLog, setAnswerLog]   = useState<AnswerEntry[]>([]);
  const [logStageFilter, setLogFilter] = useState('');
  const [logStages, setLogStages]   = useState<{ id: string; name: string }[]>([]);
  const [autoOpen, setAutoOpen]     = useState(false);
  const [tab, setTab]               = useState<'items' | 'hint' | 'log'>('items');
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  const checklist = stage.checklist ?? [];
  const humanItems = checklist.filter(it => it.who !== 'auto');
  const autoItems  = checklist.filter(it => it.who === 'auto');
  const helper = stage.helper ?? {};
  const needLost  = stage.kind === 'fail';
  const reqComment = stage.require_comment && mode === 'move';

  // Load answer log
  useEffect(() => {
    if (!leadId) return;
    fetch(`/kviz/api/crm/leads/${leadId}/answers`, { credentials: 'include' })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setAnswerLog(d); }).catch(() => {});
  }, [leadId]);

  // Load stage names for filter
  useEffect(() => {
    if (!leadId) return;
    fetch(`/kviz/api/crm/leads/${leadId}/answers`, { credentials: 'include' })
      .then(r => r.json()).then((d: AnswerEntry[]) => {
        if (!Array.isArray(d)) return;
        const seen = new Map<string, string>();
        for (const a of d) if (a.stage_id) seen.set(a.stage_id, a.stage_id);
        setLogStages([...seen.entries()].map(([id]) => ({ id, name: id })));
      }).catch(() => {});
  }, [leadId]);

  function setAnswer(key: string, kind: string, patch: Partial<ItemAnswer>) {
    setAnswers(prev => ({ ...prev, [key]: { ...prev[key], item_key: key, kind, ...patch } }));
  }

  // Validation
  const missingRequired = humanItems.filter(it => {
    if (!it.required) return false;
    const a = answers[it.key];
    if (it.type === 'check') return !a;
    if (it.type === 'question') return !a?.answer_option;
    if (it.type === 'text' || it.type === 'comment') return !a?.answer_text?.trim();
    return false;
  });
  const canConfirm = mode !== 'move' || (
    (!needLost || !!lostReasonId) &&
    missingRequired.length === 0 &&
    (!reqComment || !!comment.trim())
  );

  function handleConfirm() {
    const ans = Object.values(answers);
    onConfirm({
      comment:        comment.trim() || undefined,
      lost_reason_id: lostReasonId || undefined,
      answers:        ans.length ? ans : undefined,
    });
  }

  const filteredLog = logStageFilter
    ? answerLog.filter(a => a.stage_id === logStageFilter)
    : answerLog;

  const itemsByBlock = groupBy(humanItems, it => it.block || '');

  // ── Render items panel ──────────────────────────────────────────────────────
  function renderItems() {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
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
                      type="checkbox"
                      disabled={mode === 'memo'}
                      checked={!!answers[it.key]}
                      onChange={e => { if (e.target.checked) setAnswer(it.key, 'check', {}); else setAnswers(p => { const n = {...p}; delete n[it.key]; return n; }); }}
                      style={{ marginTop: 1, flexShrink: 0 }}
                    />
                    <span>{it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}</span>
                  </label>
                )}
                {it.type === 'question' && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}</div>
                    {(it.options ?? []).map(opt => (
                      <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text)', marginBottom: 4, cursor: mode === 'memo' ? 'default' : 'pointer' }}>
                        <input
                          type="radio"
                          name={it.key}
                          disabled={mode === 'memo'}
                          checked={answers[it.key]?.answer_option === opt}
                          onChange={() => setAnswer(it.key, 'question', { answer_option: opt })}
                        />
                        {opt}
                      </label>
                    ))}
                    {mode !== 'memo' && (
                      <input
                        type="text"
                        placeholder="Свободный ответ..."
                        value={answers[it.key]?.answer_text ?? ''}
                        onChange={e => setAnswer(it.key, 'question', { answer_text: e.target.value || undefined })}
                        style={{ marginTop: 4, width: '100%', padding: '6px 8px', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                      />
                    )}
                  </div>
                )}
                {(it.type === 'text' || it.type === 'comment') && (
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>{it.label}{it.required && mode === 'move' ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}</label>
                    <textarea
                      disabled={mode === 'memo'}
                      value={answers[it.key]?.answer_text ?? ''}
                      onChange={e => setAnswer(it.key, it.type, { answer_text: e.target.value })}
                      rows={2}
                      placeholder={mode === 'memo' ? '' : 'Введите текст...'}
                      style={{ width: '100%', padding: '7px 9px', border: '1.5px solid var(--input-border)', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                  </div>
                )}
                {it.hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{it.hint}</div>}
              </div>
            ))}
          </div>
        ))}

        {/* Fail: lost reason */}
        {mode === 'move' && needLost && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>Причина отказа <span style={{ color: 'var(--danger)' }}>*</span></label>
            <select
              value={lostReasonId} onChange={e => setLostId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}
            >
              <option value="">Выберите причину...</option>
              {lostReasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        {/* Comment */}
        {mode === 'move' && (
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
              Комментарий{reqComment ? <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span> : null}
            </label>
            <textarea
              value={comment} onChange={e => setComment(e.target.value)}
              rows={2} placeholder={reqComment ? 'Обязательно...' : 'Необязательно...'}
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
        )}

        {/* Admin: Automation */}
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

        {/* Missing required hint */}
        {mode === 'move' && !canConfirm && missingRequired.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
            Не заполнено: {missingRequired.map(it => it.label).join(', ')}
          </div>
        )}
      </div>
    );
  }

  // ── Render helper panel ─────────────────────────────────────────────────────
  function renderHelper() {
    const sections: { key: keyof StageHelper; title: string }[] = [
      { key: 'manager', title: 'Что делает менеджер' },
      { key: 'transition', title: 'Переход' },
      { key: 'important', title: 'Важно' },
    ];
    if (isAdmin) sections.push({ key: 'agent', title: 'Автоматика' });
    // legacy: also show memo
    const memo = (stage as Record<string, unknown>).memo as string | null;
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
        {!memo && sections.every(s => !helper[s.key]) && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Подсказки не заданы</div>
        )}
      </div>
    );
  }

  // ── Render answer log ───────────────────────────────────────────────────────
  function renderLog() {
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {logStages.length > 0 && (
          <select
            value={logStageFilter} onChange={e => setLogFilter(e.target.value)}
            style={{ width: '100%', marginBottom: 8, padding: '5px 8px', border: '1px solid var(--input-border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="">Все этапы</option>
            {logStages.map(s => <option key={s.id} value={s.id}>{s.id.slice(0, 8)}…</option>)}
          </select>
        )}
        {filteredLog.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Ответов пока нет</div>}
        {filteredLog.map(a => (
          <div key={a.id} style={{ background: 'var(--surface-2)', borderRadius: 7, padding: '7px 10px', marginBottom: 6, fontSize: 12 }}>
            <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{a.author} · {new Date(a.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{a.item_key}</div>
            {a.answer_option && <div style={{ color: 'var(--primary)' }}>{a.answer_option}</div>}
            {a.answer_text   && <div style={{ color: 'var(--text)' }}>{a.answer_text}</div>}
          </div>
        ))}
      </div>
    );
  }

  // ── Layout ──────────────────────────────────────────────────────────────────
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
    // Mobile: full-screen sheet with tabs
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

  // Desktop: 3-column layout
  const hasHelper = helper.manager || helper.transition || helper.important || (isAdmin && helper.agent) || (stage as Record<string,unknown>).memo;
  const hasLog = !!leadId;

  const colCount = 1 + (hasHelper ? 1 : 0) + (hasLog ? 1 : 0);
  const widths = colCount === 3 ? ['1fr', '1fr', '260px'] : colCount === 2 ? ['1fr', '300px'] : ['1fr'];

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
