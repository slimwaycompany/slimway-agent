import { useState } from 'react';
import { useRole } from '../../lib/permContext';

export interface ChecklistItem { text: string; who: 'human' | 'auto'; rule?: string; }

export interface PopupStage {
  id: string; name: string; kind: string;
  memo: string | null; action_label: string; checklist: ChecklistItem[];
}

interface LostReason { id: string; name: string; }

interface Props {
  mode: 'move' | 'memo';
  stage: PopupStage;
  lostReasons: LostReason[];
  onConfirm: (params: { comment?: string; lost_reason_id?: string }) => void;
  onCancel: () => void;
}

export default function StagePopup({ mode, stage, lostReasons, onConfirm, onCancel }: Props) {
  const role = useRole();
  const isAdmin = role === 'admin';

  const [comment, setComment]     = useState('');
  const [lostReasonId, setLostId] = useState('');
  const [checkedDone, setDone]    = useState(false);
  const [autoOpen, setAutoOpen]   = useState(false);

  const humanItems = stage.checklist.filter(it => it.who === 'human');
  const autoItems  = stage.checklist.filter(it => it.who === 'auto');
  const needLost   = stage.kind === 'fail';
  const needCheck  = mode === 'move' && humanItems.length > 0;

  const canConfirm = (!needLost || !!lostReasonId) && (!needCheck || checkedDone);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1200,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: isMobile ? 'flex-end' : 'center',
    justifyContent: 'center',
  };

  const box: React.CSSProperties = isMobile ? {
    width: '100%', background: 'var(--surface)', borderRadius: '16px 16px 0 0',
    padding: '20px 16px 24px', boxSizing: 'border-box' as const, maxHeight: '85vh', overflowY: 'auto',
  } : {
    background: 'var(--surface)', borderRadius: 14, padding: '24px 24px 20px',
    width: 420, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={box}>
        {/* Title */}
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
          {mode === 'move' ? `Перейти: ${stage.name}` : stage.name}
        </div>

        {/* Memo */}
        {stage.memo && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {stage.memo}
          </div>
        )}

        {/* Human checklist */}
        {humanItems.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Делаете вы</div>
            {humanItems.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 1 }}>•</span>
                <span>{it.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Admin: Автоматика */}
        {isAdmin && autoItems.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setAutoOpen(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-3)', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {autoOpen ? '▾' : '▸'} Автоматика ({autoItems.length})
            </button>
            {autoOpen && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {autoItems.map((it, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {it.rule ? <><strong>{it.rule}:</strong> {it.text}</> : it.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lost reason (required for fail stage) */}
        {mode === 'move' && needLost && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Причина отказа *</label>
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
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Комментарий</label>
            <textarea
              value={comment} onChange={e => setComment(e.target.value)}
              rows={2} placeholder="Необязательно..."
              style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--input-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
        )}

        {/* Checklist checkbox */}
        {needCheck && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={checkedDone} onChange={e => setDone(e.target.checked)} />
            Выполнил(а) действия этапа
          </label>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button" onClick={onCancel}
            style={{ padding: '8px 16px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Отмена
          </button>
          {mode === 'move' && (
            <button
              type="button" disabled={!canConfirm}
              onClick={() => onConfirm({ comment: comment.trim() || undefined, lost_reason_id: lostReasonId || undefined })}
              style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: canConfirm ? 'var(--primary)' : 'var(--border)', color: canConfirm ? '#fff' : 'var(--text-3)', fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'default', fontFamily: 'inherit' }}
            >
              {stage.action_label || 'Подтвердить'}
            </button>
          )}
          {mode === 'memo' && (
            <button
              type="button" onClick={() => onConfirm({})}
              style={{ padding: '8px 18px', border: 'none', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Понятно
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
