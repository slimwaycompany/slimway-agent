import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { apiGet, apiPatch, apiPost } from '../api';
import { isEmbedded, postToParent } from '../utils/iframe';
import {
  TEMP_BADGES, TEMP_COLORS, TEMP_TIPS, STEP_TITLES,
  TRAVEL_TIMES, AGE_GROUPS, POSTPARTUM_PERIODS, CONTRAINDICATIONS, GOALS,
  WHY_NOW, TIMING_OPTIONS, EXPERIENCE, TIME_SLOTS, START_WHEN,
  DECISION, SOURCES, CALL_OUTCOMES, REFUSAL_REASONS, EARLY_CLOSE_REASONS,
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, Answers,
  computeResult, buildSummaryText,
} from '../config/qualify';
import { SCRIPTS } from '../config/scripts';
import ScriptItem from '../components/ScriptItem';
import QuickReplies from '../components/QuickReplies';

interface Session {
  id: string; consultant: string; status: string; answers: Answers;
  score?: number; temperature?: string; bmi?: number; summary_text?: string;
}

const TEMP_SCRIPT_IDS: Record<string, string[]> = {
  hot:      ['close_choice', 'close_goal'],
  warm:     ['close_choice', 'close_goal'],
  cold:     ['s9_low'],
  stop:     ['s3_stop'],
  postpone: ['s3_temp'],
};

// step here is UI step (1–13); answer is at answers[step-1]
function getAnswerLabel(step: number, answers: Answers): string {
  const a = answers[step - 1];
  if (!a) return '—';
  switch (step) {
    case 1: {
      const c = a as A0;
      const parts: string[] = [];
      if (c.name) parts.push(c.name);
      if (c.phone) parts.push(c.phone);
      return parts.join(', ') || '—';
    }
    case 2: {
      const c = a as A1;
      return TRAVEL_TIMES.find(d => d.id === (c.travel_time ?? c.value))?.label ?? '—';
    }
    case 3: {
      const c = a as A2;
      const age = AGE_GROUPS.find(g => g.id === c.value)?.label ?? '—';
      if (!c.postpartum) return `${c.gender === 'male' ? 'М, ' : ''}${age}`;
      const period = POSTPARTUM_PERIODS.find(p => p.id === c.postpartum_period)?.label ?? '';
      return `${age}, после родов${period ? ': ' + period : ''}${c.breastfeeding ? ', ГВ' : ''}`;
    }
    case 4: {
      const c = a as A3;
      if (c.none) return 'Противопоказаний нет';
      const all = [...CONTRAINDICATIONS.stop, ...CONTRAINDICATIONS.temporary, ...CONTRAINDICATIONS.attention];
      const labels = all.filter(x => c.selected.includes(x.id)).map(x => x.label);
      if (c.other) labels.push(c.other);
      return labels.join(', ') || '—';
    }
    case 5: {
      const g = a as A4;
      const labels = GOALS.filter(x => g.selected.includes(x.id)).map(x => x.label);
      if (g.other) labels.push(g.other);
      if (g.goal_words) labels.push(`«${g.goal_words}»`);
      return labels.join(', ') || '—';
    }
    case 6: {
      const w = a as A5;
      const labels = WHY_NOW.filter(x => (w.selected ?? []).includes(x.id)).map(x => x.label);
      if (w.other) labels.push(w.other);
      return labels.join(', ') || '—';
    }
    case 7: {
      const t = a as A6;
      const opt = TIMING_OPTIONS.find(o => o.id === t.type)?.label ?? '—';
      if (t.type !== 'none' && t.date) return `${opt}: ${new Date(t.date).toLocaleDateString('ru-RU')}`;
      return opt;
    }
    case 8: {
      const p = a as A7;
      if (p.skipped || (!p.height && !p.weight)) return 'Не указаны';
      return `${p.height} см, ${p.weight} кг${p.goal_weight ? `, цель ${p.goal_weight} кг` : ''}`;
    }
    case 9: {
      const e = a as A8;
      const labels = EXPERIENCE.filter(x => (e.selected ?? []).includes(x.id)).map(x => x.label);
      if (e.what_failed) labels.push(`(${e.what_failed})`);
      return labels.join(', ') || '—';
    }
    case 10: {
      const t = a as A9;
      const slots = TIME_SLOTS.filter(x => (t.selected ?? []).includes(x.id)).map(x => x.label);
      const start = START_WHEN.find(s => s.id === t.start_when)?.label;
      return [...slots, start ? `Старт: ${start}` : ''].filter(Boolean).join(', ') || '—';
    }
    case 11: {
      const m = a as A10;
      const dec = DECISION.find(d => d.id === m.decision)?.label;
      return `${m.value}/10${dec ? `, ${dec}` : ''}`;
    }
    case 12: return SOURCES.find(s => s.id === (a as A11).value)?.label ?? '—';
    case 13: {
      const o = a as A12;
      const label = CALL_OUTCOMES.find(x => x.id === o.outcome)?.label ?? '—';
      if (o.outcome === 'booked' && o.visit_date) return `${label}: ${o.visit_date}`;
      if ((o.outcome === 'callback' || o.outcome === 'thinking') && o.callback_date)
        return `${label}: ${o.callback_date}`;
      if (o.outcome === 'refused' && o.refusal_reason)
        return `${label}: ${REFUSAL_REASONS.find(r => r.id === o.refusal_reason)?.label ?? o.refusal_reason}`;
      return label;
    }
    default: return '—';
  }
}

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet(`/api/sessions/${id}`).then(s => {
      setSession(s);
      postToParent({ type: 'kviz:title', text: (s as { client_name?: string }).client_name ?? '' });
    });
  }, [id, location.key]);

  if (!session) return <div className="page">Загрузка…</div>;

  const answers = session.answers ?? {};
  const result = computeResult(answers);
  const summaryText = buildSummaryText(answers, result);
  const a0  = answers[0]  as A0  | undefined;
  const a4  = answers[4]  as A4  | undefined;
  const a6  = answers[6]  as A6  | undefined;
  const a7  = answers[7]  as A7  | undefined;
  const a12 = answers[12] as A12 | undefined;
  const paramsSkipped = !a7 || !!a7.skipped || (!a7.height && !a7.weight);
  const readOnly = session.status === 'done';
  const color = TEMP_COLORS[result.temperature] ?? '#6b7280';
  const usedScripts = answers.used_scripts ?? [];

  const closingScripts = SCRIPTS.filter(s =>
    TEMP_SCRIPT_IDS[result.temperature]?.includes(s.id) && (!s.when || s.when(answers))
  );

  function editStep(n: number) {
    navigate(`/q/${id}/${n}?back=summary`);
  }

  function goBack() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function complete() {
    setSaving(true);
    await apiPost(`/api/sessions/${id}/complete`, {
      score: result.score, temperature: result.temperature,
      bmi: result.bmi, weeks_left: result.weeks_left,
      sessions_possible: result.sessions_possible,
      recommendation: result.recommendation,
      summary_text: summaryText,
    });
    setSaving(false);
    postToParent({ type: 'kviz:done', sessionId: id, temperature: result.temperature });
    navigate('/');
  }

  async function markScript(scriptId: string, mergedIds?: string[]) {
    if (readOnly) return;
    const ids = mergedIds ?? [scriptId];
    const current = answers.used_scripts ?? [];
    const anyUsed = ids.some(id => current.includes(id));
    const next = anyUsed
      ? current.filter(id => !ids.includes(id))
      : [...new Set([...current, ...ids])];
    const newAnswers = { ...answers, used_scripts: next };
    setSession(prev => prev ? { ...prev, answers: newAnswers } : prev);
    await apiPatch(`/api/sessions/${id}`, { answers: newAnswers });
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={goBack}>
          ← Назад
        </button>
        <span style={{ color: '#9ca3af', fontSize: 14 }}>{session.consultant}</span>
        {!isEmbedded && <a href="/window" style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280', textDecoration: 'none' }}>← Овчарка</a>}
      </div>

      {readOnly && (
        <div className="readonly-banner">🔒 Просмотр — изменения недоступны</div>
      )}

      {(a0?.name || a0?.phone) && (
        <div className="summary-section" style={{ paddingBottom: 8 }}>
          {a0.name && <div style={{ fontWeight: 700, fontSize: 16 }}>{a0.name}</div>}
          {a0.phone && <div style={{ fontSize: 14, color: '#6b7280' }}>{a0.phone}</div>}
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div className="badge" style={{ background: color, fontSize: 24 }}>
          {TEMP_BADGES[result.temperature]}
        </div>
        <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>Счёт: {result.score} баллов</div>
      </div>

      {a12?.outcome && (
        <div className="summary-section" style={{ borderLeft: `4px solid ${color}` }}>
          <h3>Итог звонка</h3>
          <p style={{ fontWeight: 600, fontSize: 15 }}>
            {CALL_OUTCOMES.find(o => o.id === a12.outcome)?.label}
          </p>
          {a12.outcome === 'booked' && a12.visit_date && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>{a12.visit_date} {a12.visit_time}</p>
          )}
          {(a12.outcome === 'callback' || a12.outcome === 'thinking') && a12.callback_date && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Перезвон: {a12.callback_date} {a12.callback_time}</p>
          )}
          {a12.outcome === 'refused' && a12.refusal_reason && (
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              {REFUSAL_REASONS.find(r => r.id === a12!.refusal_reason)?.label}
            </p>
          )}
          {a12.comment && <p style={{ fontSize: 13, color: '#6b7280' }}>{a12.comment}</p>}
        </div>
      )}

      {answers.closed_early && (
        <div className="summary-section">
          <h3>Закрыта досрочно</h3>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            {EARLY_CLOSE_REASONS.find(r => r.id === answers.closed_early!.reason)?.label ?? answers.closed_early.reason}
            {answers.closed_early.comment ? ` — ${answers.closed_early.comment}` : ''}
          </p>
        </div>
      )}

      {!readOnly && closingScripts.length > 0 && (
        <div className="summary-section" style={{ borderLeft: `4px solid ${color}` }}>
          <h3>💬 Что сказать сейчас</h3>
          {closingScripts.map(s => {
            const isUsed = s.mergedIds
              ? s.mergedIds.some(mid => usedScripts.includes(mid))
              : usedScripts.includes(s.id);
            return (
              <ScriptItem key={s.id} script={s} answers={answers}
                used={isUsed} onMark={markScript} />
            );
          })}
        </div>
      )}

      <div className="summary-section" style={{ borderLeft: `4px solid ${color}` }}>
        <h3>Подсказка консультанту</h3>
        <p style={{ fontSize: 15 }}>{TEMP_TIPS[result.temperature]}</p>
      </div>

      {result.recommendation.length > 0 && (
        <div className="summary-section">
          <h3>Рекомендованные аппараты</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {result.recommendation.map(eq => (
              <span key={eq} style={{ background: 'var(--teal-light)', color: '#065f5a', padding: '6px 12px', borderRadius: 8, fontWeight: 600, fontSize: 14 }}>
                {eq}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
            {result.format_recommendation}
            <br />
            <span style={{ opacity: .7 }}>Окончательно — после диагностики и пробной</span>
          </p>
        </div>
      )}

      {a4?.goal_words && (
        <div className="summary-section">
          <h3>Своими словами</h3>
          <p style={{ fontSize: 15, fontStyle: 'italic', color: '#1a1a2e' }}>«{a4.goal_words}»</p>
        </div>
      )}

      {a6?.type !== 'none' && a6?.date && (
        <div className="summary-section">
          <h3>Срок</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
            <Stat label="Дата" value={new Date(a6.date).toLocaleDateString('ru-RU')} />
            <Stat label="Недель" value={String(result.weeks_left)} />
            <Stat label="Сеансов" value={`~${result.sessions_min}–${result.sessions_possible}`} />
          </div>
        </div>
      )}

      <div className="summary-section">
        <h3>Параметры</h3>
        {paramsSkipped
          ? <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Не указаны</p>
          : result.bmi > 0
            ? (() => {
                const diff = a7?.goal_weight && a7?.weight ? Number(a7.weight) - Number(a7.goal_weight) : null;
                return (
                  <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                    <Stat label="ИМТ" value={String(result.bmi)} />
                    {diff && diff > 0 && <Stat label="Цель" value={`−${diff} кг`} />}
                  </div>
                );
              })()
            : <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>Не заполнены</p>
        }
      </div>

      {result.flags.length > 0 && (
        <div className="summary-section">
          <h3>Флаги</h3>
          <div style={{ marginTop: 4 }}>
            {result.flags.map((f, i) => <div key={i} className="flag-item">{f}</div>)}
          </div>
        </div>
      )}

      <div className="summary-section">
        <h3>Все ответы</h3>
        {Array.from({ length: 13 }, (_, i) => i + 1).map(n => (
          <div key={n} className="summary-row">
            <span className="label">{STEP_TITLES[n - 1]}</span>
            <span className="value" style={{ maxWidth: '55%' }}>{getAnswerLabel(n, answers)}</span>
            {!readOnly && <button className="edit-link" onClick={() => editStep(n)}>изменить</button>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={copyToClipboard}>
          {copied ? '✓ Скопировано!' : 'Скопировать для Fitbase'}
        </button>
        {!readOnly && (
          <button className="btn btn-primary" disabled={saving} onClick={complete}>
            {saving ? 'Сохраняем…' : 'Завершить квалификацию'}
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          {readOnly ? 'Закрыть' : 'Главная'}
        </button>
      </div>

      {!readOnly && <QuickReplies answers={answers} usedScripts={usedScripts} onMark={markScript} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>{label}</div>
    </div>
  );
}
