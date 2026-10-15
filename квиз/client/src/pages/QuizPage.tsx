import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost } from '../api';
import {
  STEP_TITLES, STEP_CONFIG,
  TRAVEL_TIMES, DISTRICTS, TRANSPORT, FROM_WHERE,
  GENDERS, AGE_GROUPS, POSTPARTUM_PERIODS,
  CONTRAINDICATIONS, GOALS, WHY_NOW, TIMING_OPTIONS, DEADLINE_FLEX,
  LOSS_RANGE, LIFESTYLE, ACTIVITY, EXPERIENCE, EXPERIENCE_OUTCOME,
  TIME_SLOTS, START_WHEN, DECISION, SOURCES, WHAT_CAUGHT,
  CALL_OUTCOMES, REFUSAL_REASONS,
  TEMP_BADGES, TEMP_COLORS, MAX_SCORE,
  A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, Answers,
  computeResult, buildSummaryText,
} from '../config/qualify';
import { getStepCards, normalizePhone } from '../config/scripts';
import ScriptItem from '../components/ScriptItem';
import QuickReplies from '../components/QuickReplies';
import AskPanel from '../components/AskPanel';
import LiveResult from '../components/LiveResult';
import ExitDialog from '../components/ExitDialog';

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ current, maxVisited, id, readOnly }: {
  current: number; maxVisited: number; id: string; readOnly?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="progress-bar">
      {Array.from({ length: 13 }, (_, i) => i + 1).map(n => (
        <div
          key={n}
          className={`progress-step ${n === current ? 'current' : n <= maxVisited ? 'done' : ''}`}
          onClick={() => n !== current && n <= maxVisited && navigate(`/q/${id}/${n}`)}
          style={{ cursor: n !== current && n <= maxVisited ? 'pointer' : 'default' }}
        >
          {n}
        </div>
      ))}
    </div>
  );
}

// ─── Option button helper ─────────────────────────────────────────────────────
function OptBtn({ label, selected, onClick, disabled }: {
  label: string; selected: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button className={`option-btn ${selected ? 'selected' : ''}`} onClick={onClick} disabled={disabled}>
      {selected && !disabled ? '✓ ' : ''}{label}
    </button>
  );
}

// ─── Step 0 (UI 1): Клиент ────────────────────────────────────────────────────
function StepClient({ answer, onChange, ro, dupWarn }: {
  answer?: A0; onChange: (v: A0) => void; ro?: boolean; dupWarn?: string;
}) {
  const a: A0 = answer ?? { name: '', phone: '' };
  const [phoneError, setPhoneError] = useState('');

  function handlePhone(raw: string) {
    onChange({ ...a, phone: raw });
    setPhoneError('');
  }

  function handlePhoneBlur() {
    if (!a.phone) { setPhoneError(''); return; }
    const norm = normalizePhone(a.phone);
    if (!norm) setPhoneError('Проверьте номер');
    else { onChange({ ...a, phone: norm }); setPhoneError(''); }
  }

  return (
    <>
      <div className="field">
        <label>Имя</label>
        <input type="text" value={a.name} disabled={ro}
          onChange={e => onChange({ ...a, name: e.target.value })}
          placeholder="Как к вам обращаться?" />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Телефон WhatsApp</label>
        <input type="tel" value={a.phone ?? ''} disabled={ro}
          onChange={e => handlePhone(e.target.value)}
          onBlur={handlePhoneBlur}
          placeholder="+7 7XX XXX-XX-XX" />
        {phoneError && (
          <div className="alert alert-warn" style={{ marginTop: 6, fontSize: 13 }}>{phoneError}</div>
        )}
      </div>
      {dupWarn && (
        <div className="alert alert-warn" style={{ marginTop: 10, fontSize: 13 }}>{dupWarn}</div>
      )}
    </>
  );
}

// ─── Step 1 (UI 2): Где живёт ─────────────────────────────────────────────────
function Step1({ answer, onChange, ro }: { answer?: A1; onChange: (v: A1) => void; ro?: boolean }) {
  const a: A1 = answer ?? { travel_time: '' };
  const set = (k: keyof A1, v: string) => onChange({ ...a, [k]: v });
  return (
    <>
      <div className="options">
        {TRAVEL_TIMES.map((d, i) => (
          <button key={d.id} className={`option-btn ${(a.travel_time ?? a.value) === d.id ? 'selected' : ''}`}
            onClick={() => !ro && set('travel_time', d.id)} disabled={ro}>
            <span style={{ opacity: .45, marginRight: 8 }}>{i + 1}.</span>{d.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <div className="field">
          <label>Район</label>
          <select value={a.district ?? ''} disabled={ro} onChange={e => set('district', e.target.value)}
            style={{ padding: '10px 12px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 14, background: '#fff' }}>
            <option value="">—</option>
            {DISTRICTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Откуда удобнее</label>
          <select value={a.from ?? ''} disabled={ro} onChange={e => set('from', e.target.value)}
            style={{ padding: '10px 12px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 14, background: '#fff' }}>
            <option value="">—</option>
            {FROM_WHERE.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Как добирается</label>
          <select value={a.transport ?? ''} disabled={ro} onChange={e => set('transport', e.target.value)}
            style={{ padding: '10px 12px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 14, background: '#fff' }}>
            <option value="">—</option>
            {TRANSPORT.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}

// ─── Step 2 (UI 3): О клиенте ─────────────────────────────────────────────────
function Step2({ answer, onChange, ro }: { answer?: A2; onChange: (v: A2) => void; ro?: boolean }) {
  const a: A2 = answer ?? { value: '' };
  return (
    <>
      <div className="options" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {GENDERS.map(g => (
          <button key={g.id} className={`option-btn ${a.gender === g.id ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ ...a, gender: g.id })} disabled={ro}>{g.label}</button>
        ))}
      </div>
      <div className="options" style={{ marginTop: 12 }}>
        {AGE_GROUPS.map((g, i) => (
          <button key={g.id} className={`option-btn ${a.value === g.id ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ ...a, value: g.id })} disabled={ro}>
            <span style={{ opacity: .45, marginRight: 8 }}>{i + 1}.</span>{g.label}
          </button>
        ))}
      </div>
      {(a.value === 'under18' || a.gender === 'under18') && (
        <div className="alert alert-warn" style={{ marginTop: 8 }}>Нужно присутствие/согласие родителя</div>
      )}
      <div className="field" style={{ marginTop: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: ro ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={!!a.postpartum} disabled={ro}
            onChange={e => onChange({ ...a, postpartum: e.target.checked, postpartum_period: undefined, breastfeeding: false })} />
          После родов (только для женщин)
        </label>
      </div>
      {a.postpartum && (
        <>
          <div className="options" style={{ marginTop: 10 }}>
            {POSTPARTUM_PERIODS.map(p => (
              <button key={p.id} className={`option-btn ${a.postpartum_period === p.id ? 'selected' : ''}`}
                onClick={() => !ro && onChange({ ...a, postpartum_period: p.id as A2['postpartum_period'] })} disabled={ro}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: ro ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={!!a.breastfeeding} disabled={ro}
                onChange={e => onChange({ ...a, breastfeeding: e.target.checked })} />
              Грудное вскармливание
            </label>
          </div>
        </>
      )}
    </>
  );
}

// ─── Step 3 (UI 4): Противопоказания ──────────────────────────────────────────
function Step3({ answer, onChange, ro }: { answer?: A3; onChange: (v: A3) => void; ro?: boolean }) {
  const a: A3 = answer ?? { selected: [], none: false, other: '' };
  const stopIds = new Set(CONTRAINDICATIONS.stop.map(c => c.id));
  const tempIds = new Set(CONTRAINDICATIONS.temporary.map(c => c.id));
  const hasStop = a.selected.some(s => stopIds.has(s));
  const hasTemp = !hasStop && a.selected.some(s => tempIds.has(s));

  function toggle(id: string) {
    if (ro) return;
    const sel = a.selected.includes(id) ? a.selected.filter(s => s !== id) : [...a.selected, id];
    onChange({ ...a, selected: sel, none: false });
  }
  function toggleNone() {
    if (ro) return;
    onChange({ selected: [], none: !a.none, other: '' });
  }

  const groups = [
    { key: 'stop' as const,      label: '🛑 СТОП',     items: CONTRAINDICATIONS.stop },
    { key: 'temporary' as const, label: '⏳ ВРЕМЕННО', items: CONTRAINDICATIONS.temporary },
    { key: 'attention' as const, label: '⚠️ ВНИМАНИЕ', items: CONTRAINDICATIONS.attention },
  ];

  return (
    <>
      {hasStop && <div className="alert alert-stop">Аппараты запрещены</div>}
      {hasTemp && <div className="alert alert-warn">Пробную отложить</div>}
      {groups.map(g => (
        <div key={g.key} className={`contra-group ${g.key}`}>
          <h4>{g.label}</h4>
          <div className="options" style={{ gap: 6 }}>
            {g.items.map(item => (
              <button key={item.id}
                className={`option-btn ${a.selected.includes(item.id) ? (g.key === 'stop' ? 'selected-stop' : 'selected') : ''}`}
                onClick={() => toggle(item.id)} disabled={ro}
                style={{ padding: '10px 14px', fontSize: 14 }}>
                {a.selected.includes(item.id) ? '☑ ' : '☐ '}{item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <hr className="contra-divider" />
      <button className={`option-btn none-btn ${a.none ? 'selected' : ''}`} onClick={toggleNone} disabled={ro}>
        {a.none ? '✓ ' : ''}Противопоказаний нет
      </button>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Другое</label>
        <input type="text" value={a.other} disabled={ro}
          onChange={e => onChange({ ...a, other: e.target.value })} placeholder="Укажите если есть" />
      </div>
    </>
  );
}

// ─── Step 4 (UI 5): Что хочет убрать ──────────────────────────────────────────
function Step4({ answer, onChange, ro }: { answer?: A4; onChange: (v: A4) => void; ro?: boolean }) {
  const a: A4 = answer ?? { selected: [] };
  function toggle(id: string) {
    if (ro) return;
    const sel = a.selected.includes(id) ? a.selected.filter(s => s !== id) : [...a.selected, id];
    const main = a.main_zone && !sel.includes(a.main_zone) ? undefined : a.main_zone;
    onChange({ ...a, selected: sel, main_zone: main });
  }
  return (
    <>
      <div className="options">
        {GOALS.map(g => (
          <button key={g.id} className={`option-btn ${a.selected.includes(g.id) ? 'selected' : ''}`}
            onClick={() => toggle(g.id)} disabled={ro}>
            {a.selected.includes(g.id) ? '✓ ' : ''}{g.label}
          </button>
        ))}
      </div>
      {a.selected.length > 1 && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Главная зона (необязательно)</label>
          <select value={a.main_zone ?? ''} disabled={ro}
            onChange={e => onChange({ ...a, main_zone: e.target.value || undefined })}
            style={{ padding: '10px 12px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 14, background: '#fff' }}>
            <option value="">—</option>
            {GOALS.filter(g => a.selected.includes(g.id)).map(g => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Другое</label>
        <input type="text" value={a.other ?? ''} disabled={ro}
          onChange={e => onChange({ ...a, other: e.target.value })} placeholder="Что-то ещё?" />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Своими словами — дословно</label>
        <input type="text" value={a.goal_words ?? ''} disabled={ro}
          onChange={e => onChange({ ...a, goal_words: e.target.value })}
          placeholder="Что клиент сказал о своей цели…" />
      </div>
    </>
  );
}

// ─── Step 5 (UI 6): Почему сейчас ─────────────────────────────────────────────
function Step5({ answer, onChange, ro }: { answer?: A5; onChange: (v: A5) => void; ro?: boolean }) {
  const a: A5 = answer ?? { selected: [] };
  function toggle(id: string) {
    if (ro) return;
    const sel = a.selected.includes(id) ? a.selected.filter(s => s !== id) : [...a.selected, id];
    onChange({ ...a, selected: sel });
  }
  return (
    <>
      <div className="options">
        {WHY_NOW.map(w => (
          <button key={w.id} className={`option-btn ${a.selected.includes(w.id) ? 'selected' : ''}`}
            onClick={() => toggle(w.id)} disabled={ro}>
            {a.selected.includes(w.id) ? '✓ ' : ''}{w.label}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Другое</label>
        <input type="text" value={a.other ?? ''} disabled={ro}
          onChange={e => onChange({ ...a, other: e.target.value })} placeholder="Своими словами…" />
      </div>
    </>
  );
}

// ─── Step 6 (UI 7): Сроки ──────────────────────────────────────────────────────
function Step6({ answer, onChange, ro }: { answer?: A6; onChange: (v: A6) => void; ro?: boolean }) {
  const a: A6 = answer ?? { type: '', date: '' };
  const today = new Date().toISOString().split('T')[0];
  const needsDate = a.type && a.type !== 'none';
  let weeks = 0;
  let sMin = 0;
  let sMax = 0;
  if (a.date) {
    const diff = new Date(a.date).getTime() - Date.now();
    weeks = Math.max(0, Math.floor(diff / (7 * 24 * 60 * 60 * 1000)));
    sMin = weeks * 2;
    sMax = weeks * 3;
  }
  return (
    <>
      <div className="options">
        {TIMING_OPTIONS.map((opt, i) => (
          <button key={opt.id} className={`option-btn ${a.type === opt.id ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ type: opt.id, date: opt.id === 'none' ? '' : a.date })} disabled={ro}>
            <span style={{ opacity: .45, marginRight: 8 }}>{i + 1}.</span>{opt.label}
          </button>
        ))}
      </div>
      {needsDate && (
        <>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Выберите дату</label>
            <input type="date" min={today} value={a.date ?? ''} disabled={ro}
              onChange={e => onChange({ ...a, date: e.target.value })} />
          </div>
          {a.date && weeks >= 0 && (
            <div className="alert alert-info" style={{ marginTop: 8 }}>
              {weeks} {plural(weeks, 'неделя', 'недели', 'недель')} — ~{sMin}–{sMax} сеансов
            </div>
          )}
          {a.date && weeks < 2 && (
            <div className="alert alert-warn">Очень мало времени — обсудить реалистичный результат</div>
          )}
          <div className="field" style={{ marginTop: 12 }}>
            <label>Насколько дата жёсткая</label>
            <div className="options" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {DEADLINE_FLEX.map(f => (
                <button key={f.id} className={`option-btn ${a.deadline_flex === f.id ? 'selected' : ''}`}
                  onClick={() => !ro && onChange({ ...a, deadline_flex: f.id })} disabled={ro}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Step 7 (UI 8): Параметры ──────────────────────────────────────────────────
function isOutOfBounds(val: unknown, min: number, max: number): boolean {
  if (val === '' || val === undefined || val === null) return false;
  const n = Number(val);
  return isNaN(n) || n < min || n > max;
}

function Step7({ answer, onChange, ro }: { answer?: A7; onChange: (v: A7) => void; ro?: boolean }) {
  const a: A7 = answer ?? { height: '', weight: '', goal_weight: '' };

  let bmi = 0;
  if (!a.skipped && a.height && a.weight) {
    const h = Number(a.height) / 100;
    bmi = Math.round((Number(a.weight) / (h * h)) * 10) / 10;
  }
  const goalDiff = !a.skipped && a.goal_weight && a.weight && Number(a.goal_weight) > 0
    ? Number(a.weight) - Number(a.goal_weight) : null;

  function handleField(field: keyof A7, val: string) {
    if (ro) return;
    const num = val === '' ? '' : parseFloat(val);
    onChange({ ...a, [field]: num, skipped: false });
  }

  const heightErr = !a.skipped && isOutOfBounds(a.height, 120, 220);
  const weightErr = !a.skipped && isOutOfBounds(a.weight, 30, 250);
  const goalErr   = !a.skipped && isOutOfBounds(a.goal_weight, 30, 250);

  if (a.skipped && !ro) {
    return (
      <div className="alert alert-info" style={{ marginTop: 16 }}>
        Параметры пропущены.
        <div className="field" style={{ marginTop: 12 }}>
          <label>Рост (см)</label>
          <input type="number" min={120} max={220} placeholder="170"
            onChange={e => handleField('height', e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Вес (кг)</label>
          <input type="number" min={30} max={250} placeholder="70"
            onChange={e => handleField('weight', e.target.value)} />
        </div>
      </div>
    );
  }

  return (
    <>
      {a.skipped && <p style={{ color: '#9ca3af', fontSize: 14 }}>Параметры пропущены</p>}
      {!a.skipped && (
        <>
          <div className="field">
            <label>Рост (см)</label>
            <input type="number" value={a.height} min={120} max={220} placeholder="170" disabled={ro}
              style={{ borderColor: heightErr ? 'var(--stop)' : undefined }}
              onChange={e => handleField('height', e.target.value)} />
            {heightErr && <div style={{ color: 'var(--stop)', fontSize: 12, marginTop: 4 }}>120–220 см</div>}
          </div>
          <div className="field">
            <label>Вес (кг)</label>
            <input type="number" value={a.weight} min={30} max={250} placeholder="70" disabled={ro}
              style={{ borderColor: weightErr ? 'var(--stop)' : undefined }}
              onChange={e => handleField('weight', e.target.value)} />
            {weightErr && <div style={{ color: 'var(--stop)', fontSize: 12, marginTop: 4 }}>30–250 кг</div>}
          </div>
          <div className="field">
            <label>Желаемый вес (кг, необязательно)</label>
            <input type="number" value={a.goal_weight ?? ''} min={30} max={250} placeholder="60" disabled={ro}
              style={{ borderColor: goalErr ? 'var(--stop)' : undefined }}
              onChange={e => handleField('goal_weight', e.target.value)} />
            {goalErr && <div style={{ color: 'var(--stop)', fontSize: 12, marginTop: 4 }}>30–250 кг</div>}
          </div>
          {bmi > 0 && (
            <div className="bmi-badge">
              ИМТ: {bmi}{goalDiff !== null && goalDiff > 0 ? ` · цель: −${goalDiff} кг` : ''}
            </div>
          )}
          {!ro && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Сколько хочет скинуть (если вес не указан)</label>
              <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {LOSS_RANGE.map(l => (
                  <button key={l.id} className={`option-btn ${a.loss_range === l.id ? 'selected' : ''}`}
                    style={{ fontSize: 13, padding: '8px 10px' }}
                    onClick={() => onChange({ ...a, loss_range: l.id })}>{l.label}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div className="field" style={{ marginTop: 14 }}>
        <label>Образ жизни</label>
        <div className="options" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {LIFESTYLE.map(l => (
            <button key={l.id} className={`option-btn ${a.lifestyle === l.id ? 'selected' : ''}`}
              style={{ fontSize: 13, padding: '8px 10px' }} disabled={ro}
              onClick={() => !ro && onChange({ ...a, lifestyle: l.id })}>{l.label}</button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Активность сейчас</label>
        <div className="options" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {ACTIVITY.map(l => (
            <button key={l.id} className={`option-btn ${a.activity === l.id ? 'selected' : ''}`}
              style={{ fontSize: 13, padding: '8px 10px' }} disabled={ro}
              onClick={() => !ro && onChange({ ...a, activity: l.id })}>{l.label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Step 8 (UI 9): Опыт ──────────────────────────────────────────────────────
function Step8({ answer, onChange, ro }: { answer?: A8; onChange: (v: A8) => void; ro?: boolean }) {
  const a: A8 = answer ?? { selected: [] };
  function toggle(id: string) {
    if (ro) return;
    const sel = a.selected.includes(id) ? a.selected.filter(s => s !== id) : [...a.selected, id];
    onChange({ ...a, selected: sel });
  }
  const hasTried = (a.selected ?? []).length > 0 && !a.selected.includes('nothing');
  return (
    <>
      <div className="options">
        {EXPERIENCE.map(e => (
          <button key={e.id} className={`option-btn ${a.selected.includes(e.id) ? 'selected' : ''}`}
            onClick={() => toggle(e.id)} disabled={ro}>
            {a.selected.includes(e.id) ? '✓ ' : ''}{e.label}
          </button>
        ))}
      </div>
      {hasTried && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Чем закончилось</label>
          <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {EXPERIENCE_OUTCOME.map(o => (
              <button key={o.id} className={`option-btn ${a.outcome === o.id ? 'selected' : ''}`}
                style={{ fontSize: 13, padding: '8px 10px' }} disabled={ro}
                onClick={() => !ro && onChange({ ...a, outcome: o.id })}>{o.label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: ro ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={!!a.stress_eating} disabled={ro}
            onChange={e => onChange({ ...a, stress_eating: e.target.checked })} />
          Ест на стрессе / от усталости
        </label>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Что не сработало (необязательно)</label>
        <input type="text" value={a.what_failed ?? ''} disabled={ro}
          onChange={e => onChange({ ...a, what_failed: e.target.value })} placeholder="Подробности…" />
      </div>
    </>
  );
}

// ─── Step 9 (UI 10): Время и старт ────────────────────────────────────────────
function Step9({ answer, onChange, ro }: { answer?: A9; onChange: (v: A9) => void; ro?: boolean }) {
  const a: A9 = answer ?? { selected: [] };
  function toggle(id: string) {
    if (ro) return;
    const sel = a.selected.includes(id) ? a.selected.filter(s => s !== id) : [...a.selected, id];
    onChange({ ...a, selected: sel });
  }
  return (
    <>
      <div className="options" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {TIME_SLOTS.map(t => (
          <button key={t.id} className={`option-btn ${a.selected.includes(t.id) ? 'selected' : ''}`}
            onClick={() => toggle(t.id)} disabled={ro}>
            {a.selected.includes(t.id) ? '✓ ' : ''}{t.label}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Когда готов(а) начать</label>
        <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {START_WHEN.map((s, i) => (
            <button key={s.id} className={`option-btn ${a.start_when === s.id ? 'selected' : ''}`}
              onClick={() => !ro && onChange({ ...a, start_when: s.id })} disabled={ro}>
              <span style={{ opacity: .45, marginRight: 6 }}>{i + 1}.</span>{s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Step 10 (UI 11): Мотивация и решение ──────────────────────────────────────
function Step10({ answer, onChange, ro }: { answer?: A10; onChange: (v: A10) => void; ro?: boolean }) {
  const a: A10 = answer ?? { value: 0 };
  return (
    <>
      <p style={{ color: '#6b7280', marginTop: 8 }}>Насколько важно решить это сейчас?</p>
      <div className="scale-grid">
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <button key={n} className={`scale-btn ${a.value === n ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ ...a, value: n })} disabled={ro}>{n}</button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 16 }}>
        <label>Принимает решение</label>
        <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {DECISION.map(d => (
            <button key={d.id} className={`option-btn ${a.decision === d.id ? 'selected' : ''}`}
              onClick={() => !ro && onChange({ ...a, decision: d.id })} disabled={ro}>{d.label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Step 11 (UI 12): Откуда узнали ───────────────────────────────────────────
function Step11({ answer, onChange, ro }: { answer?: A11; onChange: (v: A11) => void; ro?: boolean }) {
  const a: A11 = answer ?? { value: '' };
  function toggleCaught(id: string) {
    if (ro) return;
    const curr = a.what_caught ?? [];
    const next = curr.includes(id) ? curr.filter(c => c !== id) : [...curr, id];
    onChange({ ...a, what_caught: next });
  }
  return (
    <>
      <div className="options">
        {SOURCES.map((s, i) => (
          <button key={s.id} className={`option-btn ${a.value === s.id ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ ...a, value: s.id })} disabled={ro}>
            <span style={{ opacity: .45, marginRight: 8 }}>{i + 1}.</span>{s.label}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Что зацепило (множественный выбор)</label>
        <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {WHAT_CAUGHT.map(w => (
            <button key={w.id} className={`option-btn ${(a.what_caught ?? []).includes(w.id) ? 'selected' : ''}`}
              style={{ fontSize: 13, padding: '8px 10px' }} disabled={ro}
              onClick={() => toggleCaught(w.id)}>
              {(a.what_caught ?? []).includes(w.id) ? '✓ ' : ''}{w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: ro ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={!!a.was_before} disabled={ro}
            onChange={e => onChange({ ...a, was_before: e.target.checked })} />
          Был(а) у нас раньше
        </label>
      </div>
    </>
  );
}

// ─── Step 12 (UI 13): Итог звонка ──────────────────────────────────────────────
function Step12({ answer, onChange, ro }: { answer?: A12; onChange: (v: A12) => void; ro?: boolean }) {
  const a: A12 = answer ?? { outcome: '' };
  return (
    <>
      <div className="options">
        {CALL_OUTCOMES.map(o => (
          <button key={o.id} className={`option-btn ${a.outcome === o.id ? 'selected' : ''}`}
            onClick={() => !ro && onChange({ outcome: o.id })} disabled={ro}>{o.label}</button>
        ))}
      </div>
      {a.outcome === 'booked' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <div className="field">
            <label>Дата</label>
            <input type="date" value={a.visit_date ?? ''} disabled={ro}
              onChange={e => onChange({ ...a, visit_date: e.target.value })} />
          </div>
          <div className="field">
            <label>Время</label>
            <input type="time" value={a.visit_time ?? ''} disabled={ro}
              onChange={e => onChange({ ...a, visit_time: e.target.value })} />
          </div>
        </div>
      )}
      {(a.outcome === 'callback' || a.outcome === 'thinking') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <div className="field">
            <label>Дата перезвона</label>
            <input type="date" value={a.callback_date ?? ''} disabled={ro}
              onChange={e => onChange({ ...a, callback_date: e.target.value })} />
          </div>
          <div className="field">
            <label>Время</label>
            <input type="time" value={a.callback_time ?? ''} disabled={ro}
              onChange={e => onChange({ ...a, callback_time: e.target.value })} />
          </div>
        </div>
      )}
      {a.outcome === 'refused' && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>Причина отказа</label>
          <div className="options" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {REFUSAL_REASONS.map(r => (
              <button key={r.id} className={`option-btn ${a.refusal_reason === r.id ? 'selected' : ''}`}
                style={{ fontSize: 13, padding: '8px 10px' }} disabled={ro}
                onClick={() => !ro && onChange({ ...a, refusal_reason: r.id })}>{r.label}</button>
            ))}
          </div>
        </div>
      )}
      {a.outcome && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>Комментарий</label>
          <input type="text" value={a.comment ?? ''} disabled={ro}
            onChange={e => onChange({ ...a, comment: e.target.value })} placeholder="Необязательно" />
        </div>
      )}
    </>
  );
}

// ─── Validation ───────────────────────────────────────────────────────────────
function canProceed(step: number, answers: Answers): boolean {
  switch (step) {
    case 1: {
      const c = answers[0] as A0 | undefined;
      return !!(c?.name?.trim() && c?.phone && normalizePhone(c.phone) !== null);
    }
    case 2: {
      const a = answers[1] as A1 | undefined;
      return !!(a?.travel_time ?? (a as any)?.value);
    }
    case 3: {
      const c = answers[2] as A2 | undefined;
      if (!c?.value) return false;
      if (c.postpartum && !c.postpartum_period) return false;
      return true;
    }
    case 4: {
      const c = answers[3] as A3 | undefined;
      return !!(c?.none || (c?.selected?.length ?? 0) > 0);
    }
    case 5: return !!((answers[4] as A4 | undefined)?.selected?.length ?? 0);
    case 6: return true; // why_now optional
    case 7: {
      const c = answers[6] as A6 | undefined;
      return !!(c?.type && (c.type === 'none' || c.date));
    }
    case 8: {
      // optional: "Далее" always active unless entered value is out of bounds
      const c = answers[7] as A7 | undefined;
      if (!c || c.skipped) return true;
      if (isOutOfBounds(c.height, 120, 220)) return false;
      if (isOutOfBounds(c.weight, 30, 250)) return false;
      if (isOutOfBounds(c.goal_weight, 30, 250)) return false;
      return true;
    }
    case 9:  return !!((answers[8] as A8 | undefined)?.selected?.length ?? 0);
    case 10: return !!(answers[9] as A9 | undefined)?.start_when;
    case 11: return !!((answers[10] as A10 | undefined)?.value ?? 0);
    case 12: return !!(answers[11] as A11 | undefined)?.value;
    case 13: return !!(answers[12] as A12 | undefined)?.outcome;
    default: return true;
  }
}

// ─── Single-select keyboard mapping ──────────────────────────────────────────
const SINGLE_SELECT: Record<number, { id: string }[]> = {
  2:  TRAVEL_TIMES,
  3:  AGE_GROUPS,
  7:  TIMING_OPTIONS,
  10: START_WHEN,
  12: SOURCES,
};

// ─── Main component ───────────────────────────────────────────────────────────
interface SessionMeta {
  id: string; status: string; completed_at?: string; created_at: string;
  temperature?: string; consultant: string;
}

export default function QuizPage() {
  const { id, step } = useParams<{ id: string; step: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fromSummary = searchParams.get('back') === 'summary';
  const stepNum = parseInt(step ?? '1', 10);

  const [session, setSession] = useState<{ status: string } | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [maxVisited, setMaxVisited] = useState(stepNum);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showExit, setShowExit] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [copiedFitbase, setCopiedFitbase] = useState(false);
  const [dupWarn, setDupWarn] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet(`/api/sessions/${id}`).then(s => {
      setSession(s);
      setAnswers(s.answers ?? {});
      setMaxVisited(Math.max(s.current_step ?? stepNum, stepNum));
    });
  }, [id]);

  useEffect(() => {
    setMaxVisited(mv => Math.max(mv, stepNum));
  }, [stepNum]);

  const readOnly = session?.status === 'done';

  // Duplicate phone check on step 1
  const phone0 = (answers[0] as A0 | undefined)?.phone ?? '';
  useEffect(() => {
    if (stepNum !== 1 || readOnly) { setDupWarn(''); return; }
    const norm = normalizePhone(phone0);
    if (!norm) { setDupWarn(''); return; }
    const timer = setTimeout(async () => {
      const data: SessionMeta[] = await apiGet(`/api/sessions?phone=${encodeURIComponent(norm)}`);
      const others = data.filter(s => s.id !== id && s.status === 'done');
      if (others.length) {
        const d = others[0];
        const dateStr = new Date(d.completed_at ?? d.created_at).toLocaleDateString('ru-RU');
        const temp = TEMP_BADGES[d.temperature ?? ''] ?? '';
        setDupWarn(`Этот клиент уже квалифицирован: ${dateStr}${temp ? ', ' + temp : ''}, ${d.consultant}`);
      } else {
        setDupWarn('');
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [stepNum, phone0, readOnly, id]);

  function autoSave(newAnswers: Answers) {
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const patch: Record<string, unknown> = { answers: newAnswers, current_step: stepNum };
      if (stepNum === 1) {
        const a0 = newAnswers[0] as A0 | undefined;
        const normPhone = a0?.phone ? normalizePhone(a0.phone) : null;
        if (a0?.name?.trim()) patch.client_name = a0.name.trim().replace(/^\S/, c => c.toUpperCase());
        if (normPhone) patch.client_phone = normPhone;
      }
      await apiPatch(`/api/sessions/${id}`, patch);
      setSaving(false);
      setSavedAt(new Date());
    }, 500);
  }

  function update(value: unknown) {
    if (readOnly) return;
    const next = { ...answers, [stepNum - 1]: value };
    setAnswers(next);
    autoSave(next);
  }

  function markScript(scriptId: string, mergedIds?: string[]) {
    if (readOnly) return;
    const ids = mergedIds ?? [scriptId];
    const current = answers.used_scripts ?? [];
    const anyUsed = ids.some(id => current.includes(id));
    const next = anyUsed
      ? current.filter(id => !ids.includes(id))
      : [...new Set([...current, ...ids])];
    const newAnswers = { ...answers, used_scripts: next };
    setAnswers(newAnswers);
    autoSave(newAnswers);
  }

  function toggleAsked(qIdx: number) {
    if (readOnly) return;
    const key = String(stepNum);
    const curr = (answers.asked?.[key] ?? []) as boolean[];
    const next = [...curr];
    next[qIdx] = !next[qIdx];
    const newAnswers = { ...answers, asked: { ...answers.asked, [key]: next } };
    setAnswers(newAnswers);
    autoSave(newAnswers);
  }

  function goNext() {
    if (!readOnly && !canProceed(stepNum, answers)) return;
    if (fromSummary || stepNum === 13) navigate(`/q/${id}/summary`);
    else navigate(`/q/${id}/${stepNum + 1}`);
  }

  function goBack() {
    if (fromSummary) navigate(`/q/${id}/summary`);
    else if (stepNum > 1) navigate(`/q/${id}/${stepNum - 1}`);
    else navigate('/');
  }

  async function handleEarlyClose(reason: string, comment: string) {
    if (!id) return;
    const newAnswers = { ...answers, closed_early: { reason, comment, at_step: stepNum } };
    const result = computeResult(newAnswers);
    await apiPatch(`/api/sessions/${id}`, { answers: newAnswers });
    await apiPost(`/api/sessions/${id}/complete`, {
      score: result.score, temperature: result.temperature,
      bmi: result.bmi, weeks_left: result.weeks_left,
      sessions_possible: result.sessions_possible,
      recommendation: result.recommendation,
      summary_text: buildSummaryText(newAnswers, result),
    });
    navigate('/');
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Enter') { goNext(); return; }
      if (e.key === 'Backspace') { goBack(); return; }
      if (e.key === 'Escape') { if (!readOnly) setShowExit(true); else navigate('/'); return; }
      if (readOnly) return;
      const n = parseInt(e.key, 10);
      if (isNaN(n) || n < 1) return;
      const opts = SINGLE_SELECT[stepNum];
      if (opts && n <= opts.length) update({ value: opts[n - 1].id });
      if (stepNum === 11 && n >= 1 && n <= 9) update({ ...(answers[10] as A10 ?? { value: 0 }), value: n });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepNum, answers, readOnly]);

  const proceed = readOnly || canProceed(stepNum, answers);
  const isSkippable = STEP_CONFIG[stepNum - 1]?.skippable;
  const isSkipped = stepNum === 8 && !!(answers[7] as A7 | undefined)?.skipped;
  const usedScripts = answers.used_scripts ?? [];
  const result = computeResult(answers);

  function skip() {
    update({ skipped: true, height: '', weight: '', goal_weight: '' } as A7);
  }

  const stepCards = getStepCards(stepNum, answers);

  const stepContent = (
    <div className="step-enter">
      {stepNum === 1  && <StepClient answer={answers[0]  as A0}  onChange={update} ro={readOnly} dupWarn={dupWarn} />}
      {stepNum === 2  && <Step1  answer={answers[1]  as A1}  onChange={update} ro={readOnly} />}
      {stepNum === 3  && <Step2  answer={answers[2]  as A2}  onChange={update} ro={readOnly} />}
      {stepNum === 4  && <Step3  answer={answers[3]  as A3}  onChange={update} ro={readOnly} />}
      {stepNum === 5  && <Step4  answer={answers[4]  as A4}  onChange={update} ro={readOnly} />}
      {stepNum === 6  && <Step5  answer={answers[5]  as A5}  onChange={update} ro={readOnly} />}
      {stepNum === 7  && <Step6  answer={answers[6]  as A6}  onChange={update} ro={readOnly} />}
      {stepNum === 8  && <Step7  answer={answers[7]  as A7}  onChange={update} ro={readOnly} />}
      {stepNum === 9  && <Step8  answer={answers[8]  as A8}  onChange={update} ro={readOnly} />}
      {stepNum === 10 && <Step9  answer={answers[9]  as A9}  onChange={update} ro={readOnly} />}
      {stepNum === 11 && <Step10 answer={answers[10] as A10} onChange={update} ro={readOnly} />}
      {stepNum === 12 && <Step11 answer={answers[11] as A11} onChange={update} ro={readOnly} />}
      {stepNum === 13 && <Step12 answer={answers[12] as A12} onChange={update} ro={readOnly} />}
      {!readOnly && stepCards.length > 0 && (
        <div className="scripts-card">
          <h4>💬 Что сказать</h4>
          {stepCards.map(s => {
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
    </div>
  );

  const navPanel = (
    <div className="nav-btns nav-sticky">
      {!readOnly ? (
        <>
          <button className="btn btn-secondary" style={{ padding: '14px 12px', fontSize: 14 }}
            onClick={() => setShowExit(true)}>✕</button>
          <button className="btn btn-secondary" onClick={goBack}>
            {fromSummary ? '← К итогу' : stepNum === 1 ? 'Главная' : '← Назад'}
          </button>
          {isSkippable && !isSkipped && (
            <button className="btn btn-secondary" onClick={skip} style={{ color: '#9ca3af' }}>Пропустить</button>
          )}
          <button className="btn btn-primary" disabled={!proceed} onClick={goNext}>
            {stepNum === 13 || fromSummary ? 'Завершить →' : 'Далее →'}
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-secondary" onClick={goBack}>← Назад</button>
          {stepNum < 13 && (
            <button className="btn btn-secondary" onClick={() => navigate(`/q/${id}/${stepNum + 1}`)}>
              Вперёд →
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate(-1)}>Закрыть</button>
        </>
      )}
    </div>
  );

  const leftPanel = (
    <>
      <AskPanel step={stepNum} answers={answers} onToggle={toggleAsked} readOnly={readOnly} />
      <div className="col-panel" style={{ marginTop: 0 }}>
        <h4>💬 Что сказать</h4>
        {stepCards.length === 0
          ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Нет подсказок</p>
          : stepCards.map(s => {
              const isUsed = s.mergedIds
                ? s.mergedIds.some(mid => usedScripts.includes(mid))
                : usedScripts.includes(s.id);
              return (
                <ScriptItem key={s.id} script={s} answers={answers}
                  used={isUsed} onMark={markScript} readOnly={readOnly} />
              );
            })
        }
      </div>
    </>
  );

  return (
    <div className="quiz-layout">
      {/* Left column — desktop */}
      <div className="col-left">
        {leftPanel}
      </div>

      {/* Overlay for tablet */}
      <div className={`left-overlay${leftOpen ? ' open' : ''}`} onClick={() => setLeftOpen(false)} />
      {leftOpen && (
        <div className="col-left open" style={{ padding: 16 }}>
          <button className="btn btn-secondary" style={{ marginBottom: 12, fontSize: 13 }}
            onClick={() => setLeftOpen(false)}>✕ Закрыть</button>
          {leftPanel}
        </div>
      )}

      {/* Center column */}
      <div className="col-center">
        <div style={{ padding: '0 0 12px' }}>
          <button className="questions-toggle-btn" onClick={() => setLeftOpen(true)}>
            ❓ Вопросы
          </button>

          {readOnly && (
            <div className="readonly-banner">
              🔒 Просмотр — изменения недоступны
            </div>
          )}

          <ProgressBar current={stepNum} maxVisited={maxVisited} id={id!} readOnly={readOnly} />
          {saving && <div className="save-indicator">Сохранение…</div>}
          {!saving && savedAt && <div className="save-indicator">Сохранено</div>}

          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{STEP_TITLES[stepNum - 1]}</h2>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 8 }}>Шаг {stepNum} из 13</p>

          <details className="mobile-accordion">
            <summary>❓ Вопросы и подсказки <span>▾</span></summary>
            <div className="accordion-body">{leftPanel}</div>
          </details>

          {stepContent}
        </div>

        {navPanel}
      </div>

      {/* Right column */}
      <div className="col-right">
        <LiveResult
          sessionId={id!}
          answers={answers}
          readOnly={readOnly}
          onCopy={() => { setCopiedFitbase(true); setTimeout(() => setCopiedFitbase(false), 2000); }}
        />
        {copiedFitbase && <div className="save-indicator">✓ Скопировано</div>}
      </div>

      {/* Mobile sticky temp bar */}
      <div className="mobile-temp-bar">
        <div className="live-badge" style={{ background: TEMP_COLORS[result.temperature] ?? '#6b7280', margin: 0 }}>
          {TEMP_BADGES[result.temperature]}
        </div>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{result.score} / {MAX_SCORE} пт</span>
      </div>

      {!readOnly && <QuickReplies answers={answers} usedScripts={usedScripts} onMark={markScript} />}

      {showExit && !readOnly && (
        <ExitDialog
          onCancel={() => setShowExit(false)}
          onExit={() => navigate('/')}
          onEarlyClose={handleEarlyClose}
        />
      )}
    </div>
  );
}


function plural(n: number, one: string, few: string, many: string) {
  const m = Math.abs(n) % 100;
  const m2 = m % 10;
  if (m > 10 && m < 20) return many;
  if (m2 === 1) return one;
  if (m2 >= 2 && m2 <= 4) return few;
  return many;
}
