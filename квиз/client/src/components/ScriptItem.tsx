import { useState } from 'react';
import { Script, fillScript } from '../config/scripts';
import { Answers } from '../config/qualify';

const TONE_BORDER: Record<string, string> = { warning: '#f59e0b', stop: '#dc2626' };

export default function ScriptItem({ script, answers, used, onMark, readOnly }: {
  script: Script; answers: Answers; used: boolean;
  onMark: (id: string, mergedIds?: string[]) => void; readOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  let text = fillScript(script.text, answers);
  if (script.fields) {
    for (const f of script.fields) {
      text = text.replace(new RegExp(`\\{${f.key}\\}`, 'g'), fields[f.key] || `[${f.placeholder}]`);
    }
  }

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const borderColor = script.tone ? (TONE_BORDER[script.tone] ?? '#e2e6ea') : '#e2e6ea';

  return (
    <div className="script-item" style={{ borderLeftColor: borderColor }}>
      <div className="script-title">{script.title}</div>
      {script.fields && (
        <div className="script-fields">
          {script.fields.map(f => (
            <input key={f.key} className="script-field-input" placeholder={f.placeholder}
              value={fields[f.key] ?? ''}
              onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))} />
          ))}
        </div>
      )}
      <div className="script-text">{text}</div>
      <div className="script-actions">
        <button className="script-btn" onClick={copy}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
        {!readOnly && (
          <button className={`script-btn${used ? ' script-btn-used' : ''}`}
            onClick={() => onMark(script.id, script.mergedIds)}>
            {used ? '✓ Сказал(а)' : 'Сказал(а)'}
          </button>
        )}
        {readOnly && used && <span className="script-btn script-btn-used">✓ Сказал(а)</span>}
      </div>
    </div>
  );
}
