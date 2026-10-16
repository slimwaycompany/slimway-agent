import { useState } from 'react';
import { EARLY_CLOSE_REASONS } from '../config/qualify';

interface Props {
  onCancel: () => void;
  onExit: () => void;
  onEarlyClose: (reason: string, comment: string) => void;
}

export default function ExitDialog({ onCancel, onExit, onEarlyClose }: Props) {
  const [mode, setMode] = useState<'main' | 'early'>('main');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        {mode === 'main' ? (
          <>
            <h3>Завершить звонок?</h3>
            <button className="dialog-btn" onClick={onExit}>
              Выйти, продолжу позже
            </button>
            <button className="dialog-btn danger" onClick={() => setMode('early')}>
              Закрыть досрочно
            </button>
            <button className="dialog-btn cancel" onClick={onCancel}>
              Отмена
            </button>
          </>
        ) : (
          <>
            <h3>Причина закрытия</h3>
            {EARLY_CLOSE_REASONS.map(r => (
              <button
                key={r.id}
                className={`dialog-btn${reason === r.id ? ' selected' : ''}`}
                style={reason === r.id ? { borderColor: 'var(--teal)', background: 'var(--teal-light)' } : {}}
                onClick={() => setReason(r.id)}
              >
                {r.label}
              </button>
            ))}
            <div className="field" style={{ marginTop: 8 }}>
              <label>Другое / комментарий</label>
              <input type="text" value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Необязательно" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setMode('main')}>
                ← Назад
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!reason && !comment}
                onClick={() => onEarlyClose(reason || 'other', comment)}
              >
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
