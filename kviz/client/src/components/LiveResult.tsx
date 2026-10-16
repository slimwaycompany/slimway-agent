import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TEMP_BADGES, TEMP_COLORS, TEMP_TIPS, STEP_TITLES,
  DISTANCES, AGE_GROUPS, CONTRAINDICATIONS, GOALS, TIMING_OPTIONS,
  EXPERIENCE, TIME_SLOTS, SOURCES, CALL_OUTCOMES,
  A0, A1, A2, A3, A4, A6, A8, A9, A10, A11, A12, Answers,
  MAX_SCORE, computeResult, buildSummaryText,
  POSTPARTUM_PERIODS, EARLY_CLOSE_REASONS,
} from '../config/qualify';
import {
  PRICE_PACKS, PRICE_NAMES, PRICE_CONDITIONS, PriceFormat,
  formatFromRecommendation, selectPackage, fmtPrice,
} from '../config/prices';

function shortLabel(step: number, answers: Answers): string {
  const a = answers[step - 1];
  if (!a) return '';
  switch (step) {
    case 1: {
      const c = a as A0;
      return c.name || '';
    }
    case 2: {
      const c = a as A1;
      return DISTANCES.find(d => d.id === (c.travel_time ?? c.value))?.label ?? '';
    }
    case 3: return AGE_GROUPS.find(g => g.id === (a as A2).value)?.label ?? '';
    case 4: {
      const c = a as A3;
      if (c.none) return 'Без противопоказаний';
      const n = c.selected?.length ?? 0;
      return n ? `${n} отмечено` : '';
    }
    case 5: {
      const g = a as A4;
      const labels = GOALS.filter(x => (g.selected ?? []).includes(x.id)).map(x => x.label);
      return labels.slice(0, 2).join(', ') + (labels.length > 2 ? '…' : '');
    }
    case 6: {
      const sel = (a as { selected?: string[] }).selected ?? [];
      return sel.length ? `${sel.length} причин` : '';
    }
    case 7: {
      const t = a as A6;
      const opt = TIMING_OPTIONS.find(o => o.id === t.type)?.label ?? '';
      if (t.type !== 'none' && t.date) return `${opt}: ${new Date(t.date).toLocaleDateString('ru-RU')}`;
      return opt;
    }
    case 8: {
      const p = a as { height?: unknown; weight?: unknown; skipped?: boolean };
      if (p.skipped) return 'Пропущено';
      return p.height && p.weight ? `${p.height}см ${p.weight}кг` : '';
    }
    case 9: {
      const e = a as A8;
      const labels = EXPERIENCE.filter(x => (e.selected ?? []).includes(x.id)).map(x => x.label);
      return labels.slice(0, 2).join(', ') + (labels.length > 2 ? '…' : '');
    }
    case 10: {
      const t = a as A9;
      const labels = TIME_SLOTS.filter(x => (t.selected ?? []).includes(x.id)).map(x => x.label);
      return labels.join(', ');
    }
    case 11: return (a as A10).value ? `${(a as A10).value}/10` : '';
    case 12: return SOURCES.find(s => s.id === (a as A11).value)?.label ?? '';
    case 13: return CALL_OUTCOMES.find(o => o.id === (a as A12).outcome)?.label ?? '';
    default: return '';
  }
}

function PriceBlock({ answers, result }: {
  answers: Answers; result: ReturnType<typeof computeResult>;
}) {
  const recFmt = formatFromRecommendation(result.format_recommendation);
  const [fmt, setFmt] = useState<PriceFormat>(recFmt);

  const packs = PRICE_PACKS[fmt];
  const selected = selectPackage(fmt, result.sessions_min);
  const single = packs.find(p => p.isSingle);

  return (
    <div className="col-panel">
      <h4>Цены</h4>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {(Object.keys(PRICE_NAMES) as PriceFormat[]).map(f => (
          <button key={f} onClick={() => setFmt(f)}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1.5px solid', cursor: 'pointer',
              borderColor: f === fmt ? 'var(--teal)' : '#e2e6ea',
              background: f === fmt ? 'var(--teal-light)' : '#fff',
              color: f === fmt ? '#065f5a' : '#374151',
              fontWeight: f === fmt ? 600 : 400,
            }}>
            {PRICE_NAMES[f]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {packs.filter(p => !p.isSingle).map(p => {
          const isSel = p.sessions === selected.sessions;
          return (
            <div key={p.sessions} style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 12,
              background: isSel ? 'var(--teal-light)' : '#f9fafb',
              border: `1.5px solid ${isSel ? 'var(--teal)' : '#e2e6ea'}`,
              color: isSel ? '#065f5a' : '#374151',
            }}>
              <div style={{ fontWeight: 600 }}>{p.label}{isSel ? (result.sessions_min > 0 ? ' (под срок)' : ' (популярный)') : ''}</div>
              <div>{fmtPrice(p.price)} · {fmtPrice(p.perSession)}/сеанс</div>
            </div>
          );
        })}
      </div>
      {single && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
          Разовый: {fmtPrice(single.price)}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
        {PRICE_CONDITIONS[0]}
      </div>
    </div>
  );
}

export default function LiveResult({ sessionId, answers, readOnly, onCopy }: {
  sessionId: string;
  answers: Answers;
  readOnly?: boolean;
  onCopy?: () => void;
}) {
  const navigate = useNavigate();
  const result = computeResult(answers);
  const color = TEMP_COLORS[result.temperature] ?? '#6b7280';

  const pct = Math.min(100, Math.round((result.score / MAX_SCORE) * 100));

  const a0 = answers[0] as A0 | undefined;
  const a12 = answers[12] as A12 | undefined;
  const closedEarly = answers.closed_early;

  function copyText() {
    const text = buildSummaryText(answers, result);
    navigator.clipboard.writeText(text);
    onCopy?.();
  }

  return (
    <div className="live-result">
      {(a0?.name || a0?.phone) && (
        <div className="col-panel" style={{ paddingBottom: 8 }}>
          {a0.name && <div style={{ fontWeight: 600, fontSize: 14 }}>{a0.name}</div>}
          {a0.phone && <div style={{ fontSize: 13, color: '#6b7280' }}>{a0.phone}</div>}
        </div>
      )}

      <div className="col-panel">
        <h4>Итог</h4>
        <div className="live-badge" style={{ background: color }}>
          {TEMP_BADGES[result.temperature]}
        </div>
        <div className="score-bar-wrap">
          <div style={{ fontSize: 12, color: '#6b7280' }}>{result.score} из {MAX_SCORE} баллов</div>
          <div className="score-bar-bg">
            <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
        <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>{TEMP_TIPS[result.temperature]}</p>
      </div>

      {result.flags.length > 0 && (
        <div className="col-panel">
          <h4>Флаги</h4>
          {result.flags.map((f, i) => (
            <div key={i} className="flag-item" style={{ marginBottom: 4, fontSize: 13 }}>{f}</div>
          ))}
        </div>
      )}

      {result.recommendation.length > 0 && (
        <div className="col-panel">
          <h4>Аппараты</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {result.recommendation.map(eq => (
              <span key={eq} style={{ background: 'var(--teal-light)', color: '#065f5a', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                {eq}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#6b7280' }}>{result.format_recommendation}</p>
        </div>
      )}

      <PriceBlock answers={answers} result={result} />

      {result.weeks_left > 0 && (
        <div className="col-panel">
          <h4>Срок</h4>
          <p style={{ fontSize: 13 }}>{result.weeks_left} нед. · ~{result.sessions_min}–{result.sessions_possible} сеансов</p>
        </div>
      )}

      {result.bmi > 0 && (
        <div className="col-panel">
          <h4>ИМТ</h4>
          <p style={{ fontSize: 13 }}>{result.bmi}</p>
        </div>
      )}

      {a12?.outcome && (
        <div className="col-panel">
          <h4>Итог звонка</h4>
          <p style={{ fontSize: 13, fontWeight: 600 }}>
            {CALL_OUTCOMES.find(o => o.id === a12.outcome)?.label}
          </p>
          {a12.outcome === 'booked' && a12.visit_date && (
            <p style={{ fontSize: 12, color: '#6b7280' }}>{a12.visit_date} {a12.visit_time}</p>
          )}
          {(a12.outcome === 'callback' || a12.outcome === 'thinking') && a12.callback_date && (
            <p style={{ fontSize: 12, color: '#6b7280' }}>Перезвон: {a12.callback_date} {a12.callback_time}</p>
          )}
        </div>
      )}

      {closedEarly && (
        <div className="col-panel">
          <h4>Закрыта досрочно</h4>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {EARLY_CLOSE_REASONS.find(r => r.id === closedEarly.reason)?.label ?? closedEarly.reason}
            {closedEarly.comment ? ` — ${closedEarly.comment}` : ''}
          </p>
        </div>
      )}

      <div className="col-panel">
        <h4>Ответы</h4>
        <div className="live-answers-list">
          {Array.from({ length: 13 }, (_, i) => i + 1).map(n => {
            const lbl = shortLabel(n, answers);
            return (
              <div key={n} className="live-answer-row"
                onClick={() => !readOnly && navigate(`/q/${sessionId}/${n}`)}>
                <span className="live-answer-label">{n}. {STEP_TITLES[n - 1]?.split(' ')[0]}</span>
                <span className="live-answer-value">{lbl || '—'}</span>
              </div>
            );
          })}
        </div>
      </div>

      <button className="btn btn-outline" style={{ width: '100%', fontSize: 14, padding: '10px 0' }} onClick={copyText}>
        Скопировать для Fitbase
      </button>
    </div>
  );
}
