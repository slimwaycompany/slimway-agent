// Server-side qualify catalog — ported from kviz/client/src/config/qualify.ts + prices.ts

export const SESSIONS_PER_WEEK_MIN = 2;
export const SESSIONS_PER_WEEK_MAX = 3;

export const TRAVEL_TIMES = [
  { id: 'near',     label: 'До 15 минут',   score: 3 },
  { id: 'medium',   label: '15–30 минут',   score: 2 },
  { id: 'far',      label: '30–60 минут',   score: 1 },
  { id: 'very_far', label: 'Больше часа',   score: 0 },
];

export const CONTRAINDICATIONS = {
  stop: [
    { id: 'pregnancy',  label: 'Беременность' },
    { id: 'pacemaker',  label: 'Кардиостимулятор' },
    { id: 'heart',      label: 'Серьёзные проблемы с сердцем' },
    { id: 'epilepsy',   label: 'Эпилепсия' },
    { id: 'oncology',   label: 'Онкология' },
    { id: 'anticoag',   label: 'Приём антикоагулянтов' },
    { id: 'transplant', label: 'Трансплантация органов' },
    { id: 'cyst',       label: 'Киста / миома' },
  ],
  temporary: [
    { id: 'surgery',   label: 'Операция за последние 3 месяца' },
    { id: 'infection', label: 'Острая инфекция / простуда' },
  ],
  attention: [
    { id: 'pressure',    label: 'Давление (повышенное или пониженное)' },
    { id: 'diabetes',    label: 'Диабет / инсулинорезистентность' },
    { id: 'hernia',      label: 'Грыжа (поясничная, паховая, живота)' },
    { id: 'knees',       label: 'Проблемы с коленями' },
    { id: 'circulation', label: 'Нарушения кровообращения / варикоз' },
    { id: 'dizziness',   label: 'Головокружения' },
    { id: 'thyroid',     label: 'Заболевания щитовидной железы' },
    { id: 'lipedema',    label: 'Липедема' },
  ],
};

export const GOALS = [
  { id: 'belly',     label: 'Живот' },
  { id: 'sides',     label: 'Талия и бока' },
  { id: 'hips',      label: 'Бёдра и ягодицы' },
  { id: 'legs',      label: 'Ноги и икры' },
  { id: 'arms',      label: 'Руки' },
  { id: 'weight',    label: 'Скинуть общий вес' },
  { id: 'cellulite', label: 'Целлюлит и тонус кожи' },
  { id: 'edema',     label: 'Отёки и тяжесть в ногах' },
];

export const AGE_GROUPS = [
  { id: 'under18', label: 'До 18',  flag: 'minor' },
  { id: '18-25',   label: '18–25' },
  { id: '26-35',   label: '26–35' },
  { id: '36-45',   label: '36–45' },
  { id: '46-55',   label: '46–55' },
  { id: '56+',     label: '56+' },
];

export const POSTPARTUM_PERIODS = [
  { id: 'lt6w',  label: 'Меньше 6 недель' },
  { id: '6w-6m', label: '6 недель – 6 месяцев' },
  { id: 'gt6m',  label: 'Больше 6 месяцев' },
];

export const START_WHEN = [
  { id: 'this_week',  label: 'На этой неделе',  score: 3 },
  { id: 'next_week',  label: 'На следующей',    score: 2 },
  { id: 'this_month', label: 'В течение месяца', score: 1 },
  { id: 'later',      label: 'Позже',            score: 0 },
];

export const DECISION = [
  { id: 'self',   label: 'Сам(а)',                score: 1 },
  { id: 'family', label: 'Посоветоваться с семьёй', score: 0 },
];

export const TEMP_THRESHOLDS = { hot: 11, warm: 6 };

export const TEMP_BADGES: Record<string, string> = {
  hot: '🔥 Горячий', warm: '🌤 Тёплый', cold: '❄️ Холодный', stop: '⛔ Стоп', postpone: '⏸ Отложить',
};

export const TEMP_COLORS: Record<string, string> = {
  hot: '#e65100', warm: '#f59e0b', cold: '#3b82f6', stop: '#dc2626', postpone: '#6b7280',
};

export const GOAL_EQUIPMENT: Record<string, string[]> = {
  belly:     ['Vacu Activ', 'InfraShape'],
  sides:     ['Vacu Activ', 'InfraStep'],
  hips:      ['InfraShape', 'InfraStep'],
  legs:      ['InfraStep', 'InfraShape'],
  arms:      ['Vacu Activ', 'InfraStep'],
  weight:    ['Vacu Activ', 'InfraStep'],
  cellulite: ['RollShape'],
  edema:     ['RollShape'],
};

// ─── Answers types ────────────────────────────────────────────────────────────

interface A1 { travel_time: string; district?: string; transport?: string; from?: string }
interface A2 { gender?: string; value: string; postpartum?: boolean; postpartum_period?: string; breastfeeding?: boolean }
interface A3 { selected: string[]; none: boolean; other: string }
interface A4 { selected: string[]; main_zone?: string; other?: string; goal_words?: string }
interface A6 { type: string; date?: string }
interface A7 { height: number | ''; weight: number | ''; goal_weight?: number | ''; skipped?: boolean }
interface A9 { selected: string[]; start_when?: string }
interface A10 { value: number; decision?: string }

export interface QualifyAnswers {
  [key: number]: unknown;
}

// ─── computeResult ─────────────────────────────────────────────────────────────

export function computeResult(answers: QualifyAnswers) {
  const a1  = answers[1]  as A1  | undefined;
  const a2  = answers[2]  as A2  | undefined;
  const a3  = answers[3]  as A3  | undefined;
  const a4  = answers[4]  as A4  | undefined;
  const a6  = answers[6]  as A6  | undefined;
  const a7  = answers[7]  as A7  | undefined;
  const a9  = answers[9]  as A9  | undefined;
  const a10 = answers[10] as A10 | undefined;

  let score = 0;

  // Travel time (3 max)
  const travelId = a1?.travel_time;
  score += TRAVEL_TIMES.find(d => d.id === travelId)?.score ?? 0;

  // Goal zones (1 max)
  const goalIds = a4?.selected ?? [];
  if (goalIds.length > 0) score += 1;

  // Timing (3 max)
  let weeks_left = 0;
  let sessions_possible = 0;
  let sessions_min = 0;
  if (a6?.type && a6.type !== 'none' && a6.date) {
    const diffMs = new Date(a6.date).getTime() - Date.now();
    weeks_left = Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
    sessions_possible = weeks_left * SESSIONS_PER_WEEK_MAX;
    sessions_min      = weeks_left * SESSIONS_PER_WEEK_MIN;
    score += weeks_left <= 12 ? 3 : 2;
  }

  // Time slots (1 max)
  if ((a9?.selected ?? []).length > 0) score += 1;

  // Start readiness (3 max)
  score += START_WHEN.find(s => s.id === a9?.start_when)?.score ?? 0;

  // Motivation (3 max)
  const mot = a10?.value ?? 0;
  if (mot >= 8) score += 3;
  else if (mot >= 5) score += 2;

  // Decision (1 max)
  score += DECISION.find(d => d.id === a10?.decision)?.score ?? 0;

  // BMI
  let bmi = 0;
  if (!a7?.skipped && a7?.height && a7?.weight) {
    const h = Number(a7.height) / 100;
    bmi = Math.round((Number(a7.weight) / (h * h)) * 10) / 10;
  }

  // Temperature
  const stopIds = new Set(CONTRAINDICATIONS.stop.map(c => c.id));
  const tempIds = new Set(CONTRAINDICATIONS.temporary.map(c => c.id));
  const sel = a3?.none ? [] : (a3?.selected ?? []);
  let temperature: string;
  if (sel.some(s => stopIds.has(s))) temperature = 'stop';
  else if (sel.some(s => tempIds.has(s))) temperature = 'postpone';
  else if (score >= TEMP_THRESHOLDS.hot) temperature = 'hot';
  else if (score >= TEMP_THRESHOLDS.warm) temperature = 'warm';
  else temperature = 'cold';

  // Postpartum override
  if (temperature !== 'stop' && a2?.postpartum && a2.postpartum_period === 'lt6w') {
    temperature = 'postpone';
  }

  // Equipment
  const eq = new Set<string>();
  for (const g of goalIds) for (const e of GOAL_EQUIPMENT[g] ?? []) eq.add(e);

  // Format recommendation
  const complexGoals = ['cellulite', 'edema'];
  const format_recommendation = goalIds.some(g => complexGoals.includes(g))
    ? 'SlimWay Complex (активная фаза + RollShape)'
    : 'Кросс-пакет (Vacu Activ, InfraShape, InfraStep)';

  // Flags
  const flags: string[] = [];
  if (a2?.value === 'under18') flags.push('Нужно присутствие/согласие родителя');
  if (a2?.postpartum && a2.postpartum_period === 'lt6w')
    flags.push('Допуск после родов: от 6 нед. (кесарево — от 8), только с разрешения врача');
  else if (a2?.postpartum && a2.postpartum_period === '6w-6m')
    flags.push('Уточнить разрешение врача (после кесарева — от 8 недель)');
  if (a2?.breastfeeding) flags.push('Грудное вскармливание — особое внимание, сказать тренеру');
  for (const s of sel) {
    const item = CONTRAINDICATIONS.attention.find(c => c.id === s);
    if (item) flags.push(`Сказать тренеру: ${item.label}`);
  }
  if (sel.includes('knees') && goalIds.length > 0)
    flags.push('Проблемы с коленями — на старте мягче: InfraShape');
  if (weeks_left > 0 && weeks_left < 2) flags.push('Очень мало времени — обсудить реалистичный результат');
  if (bmi >= 35) flags.push('ИМТ ≥ 35 — обсудить с тренером нагрузку');
  if (a10?.decision === 'family') flags.push('Решение с семьёй — пригласить вместе на диагностику');

  // Contraindication warnings structured by group
  const warnings: { group: 'stop' | 'temporary' | 'attention'; label: string }[] = [];
  for (const s of sel) {
    for (const [group, items] of [
      ['stop',      CONTRAINDICATIONS.stop]      as const,
      ['temporary', CONTRAINDICATIONS.temporary] as const,
      ['attention', CONTRAINDICATIONS.attention] as const,
    ]) {
      const found = items.find(c => c.id === s);
      if (found) warnings.push({ group, label: found.label });
    }
  }
  if (a2?.postpartum && a2.postpartum_period === 'lt6w')
    warnings.push({ group: 'temporary', label: 'После родов менее 6 недель' });

  return {
    score, temperature, bmi, weeks_left, sessions_possible, sessions_min,
    recommendation: Array.from(eq), flags, format_recommendation, warnings,
  };
}

// ─── Map crm_lead_answers rows → QualifyAnswers ────────────────────────────────
// item_key names match keys defined in STAGE_CONTENT (leadStageContent.ts)

export interface AnswerRow {
  item_key: string;
  kind: string;
  answer_option: string | null;
  answer_text: string | null;
  stage_id?: string | null;
}

export function answerRowsToAnswers(rows: AnswerRow[]): QualifyAnswers {
  const answers: QualifyAnswers = {};
  const a1: A1 = { travel_time: '' };
  const a2: A2 = { value: '' };
  const a3: A3 = { selected: [], none: false, other: '' };
  const a4: A4 = { selected: [] };
  const a7: A7 = { height: '', weight: '' };
  const a9: A9 = { selected: [] };
  const a10: A10 = { value: 0 };

  for (const row of rows) {
    const opt = row.answer_option ?? '';
    const txt = row.answer_text ?? '';
    switch (row.item_key) {
      // BANT stage mappings
      case 'bant_travel_time': a1.travel_time = opt; break;
      case 'bant_gender':      a2.gender = opt || undefined; break;
      case 'bant_age':         a2.value = opt; break;
      case 'bant_postpartum':
        if (opt === 'yes') a2.postpartum = true;
        break;
      case 'bant_postpartum_period': a2.postpartum_period = opt || undefined; break;
      case 'bant_goals':
        if (opt && opt !== '__none__') a4.selected.push(opt);
        break;
      case 'bant_contra':
        if (opt === '__none__') a3.none = true;
        else if (opt) a3.selected.push(opt);
        break;
      case 'bant_start_when': a9.start_when = opt || undefined; break;
      case 'bant_motivation':  a10.value = Number(txt) || 0; break;
      case 'bant_decision':    a10.decision = opt || undefined; break;
      // "Пришел" stage measurements
      case 'arr_height': a7.height = Number(txt) || ''; break;
      case 'arr_weight': a7.weight = Number(txt) || ''; break;
    }
  }

  if (a1.travel_time) answers[1] = a1;
  if (a2.value || a2.gender) answers[2] = a2;
  if (a3.selected.length || a3.none) answers[3] = a3;
  if (a4.selected.length) answers[4] = a4;
  if (a7.height || a7.weight) answers[7] = a7;
  if (a9.start_when || a9.selected.length) answers[9] = a9;
  if (a10.value || a10.decision) answers[10] = a10;

  return answers;
}

// ─── HINTS catalog ─────────────────────────────────────────────────────────────
// Extracted from scripts.ts for use in StagePopup right panel

export interface Hint {
  id: string;
  stage: string;    // stage name key: 'bant', 'no_ans', 'booked', etc.
  block: string;
  title: string;
  text: string;
  tone?: 'normal' | 'warning' | 'stop';
}

export const HINTS: Hint[] = [
  // Нет ответа / попытка связи
  { id: 'h_no_ans_far',    stage: 'no_ans', block: 'Скрипт', title: 'Далеко ехать',       text: 'Сам сеанс — 30 минут, 2–3 раза в неделю. Многие ездят к нам с другого конца города: всё равно выходит быстрее, чем два часа в зале с дорогой и душем' },
  { id: 'h_no_ans_near',   stage: 'no_ans', block: 'Скрипт', title: 'Рядом — удобно',     text: 'Вам вообще рядом — удобно заходить до или после работы' },

  // B.A.N.T.
  { id: 'h_bant_older',    stage: 'bant', block: 'О клиенте',       title: 'После 45',           text: 'После сорока пяти процесс действительно идёт иначе — метаболизм замедляется, и то, что работало раньше, перестаёт давать результат. Это про физиологию, а не про вас лично. Поэтому мы и не работаем одним аппаратом.' },
  { id: 'h_bant_male',     stage: 'bant', block: 'О клиенте',       title: 'Мужчина — живот',    text: 'Для мужчин главная зона почти всегда живот — тут хорошо работает InfraStep, он даёт самую активную нагрузку' },
  { id: 'h_bant_post',     stage: 'bant', block: 'О клиенте',       title: 'После родов',        text: 'После родов тело переживает второе начало — это не возврат к прежнему, а новая точка отсчёта. Скажите, сколько времени прошло и есть ли разрешение врача?' },
  { id: 'h_bant_post_w',   stage: 'bant', block: 'О клиенте',       title: 'Допуск после родов', text: 'Не говорить «вернём прежнюю фигуру». Допуск: от 6 недель после естественных родов и от 8 после кесарева, только с разрешения врача', tone: 'warning' },
  { id: 'h_bant_att',      stage: 'bant', block: 'Противопоказания', title: 'Есть особенности',   text: 'Спасибо, что сказали. Это не повод не приходить: ударной нагрузки у нас нет. Вакуум и прогрев регулируются, вплоть до полного отключения. Посмотрим вместе на диагностике' },
  { id: 'h_bant_knees',    stage: 'bant', block: 'Противопоказания', title: 'Проблемы с коленями', text: 'Нагрузка идёт не на суставы, а на мышцы. Плюс во время сеанса работает инфракрасный прогрев — двигаться в тепле комфортнее. Многие отмечают, что заниматься так легче, чем в зале' },
  { id: 'h_bant_temp',     stage: 'bant', block: 'Противопоказания', title: 'Временные противопоказания', text: 'Давайте немного подождём, чтобы организм восстановился — так будет безопаснее и результат лучше. Давайте сразу договоримся, когда я вам наберу', tone: 'warning' },
  { id: 'h_bant_stop',     stage: 'bant', block: 'Противопоказания', title: 'Стоп-фактор',        text: 'Не записываем. Мягко объяснить противопоказание. Предложить вернуться после консультации врача. Не давить.', tone: 'stop' },
  { id: 'h_bant_timing',   stage: 'bant', block: 'Сроки',            title: 'Нет срока — норм',   text: 'Если нет конкретного события — не страшно. Сейчас самое время начать, пока есть настрой. Предложи ближайшее время.' },
  { id: 'h_bant_price_q',  stage: 'bant', block: 'Цена',             title: 'Дорого?',            text: 'Разбивается на сеансы — от 5 500 ₸ за визит. Это меньше, чем один поход к массажисту. И результат накапливается, а не сбрасывается.' },
  { id: 'h_bant_family',   stage: 'bant', block: 'Решение',          title: 'Решает с семьёй',    text: 'Пригласи вместе на бесплатную диагностику — пусть сам(а) увидит результаты других и пообщается с тренером. Визуальный аргумент лучше любых слов.' },

  // Записан
  { id: 'h_app_remind',    stage: 'booked', block: 'Напоминание', title: 'Напомнить о записи', text: 'Отправить подтверждение сразу, напоминание утром и за час до визита.' },
  { id: 'h_app_no_show',   stage: 'booked', block: 'Не пришёл',   title: 'Если не пришёл',    text: 'Позвонить спокойно, без упрёка. Выяснить причину. Предложить два новых времени. Если не готов — переставить в «Отложенное решение».' },

  // Пришел / оффер
  { id: 'h_arr_zones',     stage: 'arrived', block: 'Аппараты',   title: 'Объяснить аппараты', text: 'Vacu Activ — запускает общий расход по всему телу. InfraShape — точечно живот/бёдра/ягодицы. InfraStep — самая активная нагрузка: ягодицы, ноги, талия.' },
  { id: 'h_arr_offer_obj', stage: 'arrived', block: 'Возражения', title: 'Дорого',             text: 'Разбей по сеансам. Первый шаг — диагностика бесплатно. Программа подбирается под результат, не под пакет.' },
  { id: 'h_arr_close',     stage: 'arrived', block: 'Закрытие',   title: 'Закрытие',           text: 'Два вопроса: «Что вам понравилось?» и «Что мешает начать сегодня?» Ответ на второй — реальное возражение, работай с ним.' },
];
