export const SESSIONS_PER_WEEK_MIN = 2;
export const SESSIONS_PER_WEEK_MAX = 3;
export const SESSIONS_PER_WEEK = SESSIONS_PER_WEEK_MAX;

export const MAX_SCORE = 15; // 3+1+3+1+3+3+1

// ─── Step metadata ────────────────────────────────────────────────────────────
export const STEP_TITLES = [
  'Клиент', 'Где живёт', 'О клиенте', 'Противопоказания', 'Что хочет убрать',
  'Почему сейчас', 'Сроки', 'Параметры и образ жизни', 'Опыт',
  'Время и старт', 'Мотивация и решение', 'Откуда узнали', 'Итог звонка',
];

export const STEP_CONFIG: { skippable?: boolean }[] = [
  {}, {}, {}, {}, {}, {}, {}, { skippable: true }, {}, {}, {}, {}, {},
];

export const STEP_ASK: string[][] = [
  ['Как к вам можно обращаться?', 'Подскажите номер, на который удобно звонить и писать в WhatsApp?'],
  ['Вы в каком районе живёте или работаете?', 'Удобнее приезжать из дома или с работы?', 'Как будете добираться — на машине или общественным транспортом?'],
  ['Подскажите, сколько вам лет? Это нужно, чтобы правильно подобрать нагрузку', 'Были ли роды за последний год?', 'Сейчас кормите грудью?'],
  ['Есть ли хронические заболевания или то, с чем врач просил быть осторожнее?', 'Принимаете постоянно какие-то препараты? Например, разжижающие кровь', 'Были ли операции за последние 3 месяца?', 'Как с давлением, сердцем?', 'Беспокоят колени, спина, вены?'],
  ['Какие зоны беспокоят больше всего?', 'Какой результат для вас будет идеальным?', 'Бывает к вечеру отёчность или тяжесть в ногах?', 'Есть одежда, которую хочется снова носить?', 'Что хотите видеть в зеркале через два месяца?'],
  ['Что вас подтолкнуло именно сейчас?', 'Почему решили заняться этим именно сегодня?'],
  ['Есть дата или событие, к которому хочется прийти в форму?', 'Когда это?', 'Что будет хорошим результатом к этой дате?'],
  ['Рост и вес примерно знаете?', 'Сколько хотели бы скинуть?', 'Как проходит обычный день — много сидите или на ногах?', 'Сейчас есть какая-то активность?'],
  ['Что уже пробовали, чтобы похудеть?', 'Чем закончилось — что, как думаете, не сработало?', 'Бывает, что едите на нервах или от усталости?'],
  ['В какое время вам удобнее приходить?', 'Когда готовы начать?', 'Сможете прийти на диагностику завтра или послезавтра?'],
  ['По шкале от 1 до 10 — насколько важно решить это сейчас?', 'Что будет, если ничего не менять?', 'Решаете сами или нужно с кем-то посоветоваться?'],
  ['Как вы о нас узнали?', 'Что зацепило?', 'Были у нас раньше?'],
  ['Давайте запишу вас на бесплатную диагностику и пробную — вам удобнее [время 1] или [время 2]?'],
];

// ─── Step 1: Где живёт ────────────────────────────────────────────────────────
export const TRAVEL_TIMES = [
  { id: 'near',     label: 'До 15 минут',   score: 3 },
  { id: 'medium',   label: '15–30 минут',   score: 2 },
  { id: 'far',      label: '30–60 минут',   score: 1 },
  { id: 'very_far', label: 'Больше часа',   score: 0 },
];
export const DISTANCES = TRAVEL_TIMES; // backward compat

export const DISTRICTS = [
  { id: 'esil',     label: 'Есиль' },
  { id: 'almaty',   label: 'Алматы' },
  { id: 'saryarka', label: 'Сарыарка' },
  { id: 'baikonur', label: 'Байконур' },
  { id: 'nura',     label: 'Нура' },
  { id: 'suburbs',  label: 'Пригород' },
];

export const TRANSPORT = [
  { id: 'car',     label: 'Машина' },
  { id: 'public',  label: 'Общественный транспорт' },
  { id: 'taxi',    label: 'Такси' },
  { id: 'walking', label: 'Пешком' },
];

export const FROM_WHERE = [
  { id: 'home', label: 'Из дома' },
  { id: 'work', label: 'С работы' },
];

// ─── Step 2: О клиенте ────────────────────────────────────────────────────────
export const GENDERS = [
  { id: 'female', label: 'Женщина' },
  { id: 'male',   label: 'Мужчина' },
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

// ─── Step 3: Противопоказания ─────────────────────────────────────────────────
export const CONTRAINDICATIONS = {
  stop: [
    { id: 'pregnancy',  label: 'Беременность' },
    { id: 'pacemaker',  label: 'Кардиостимулятор' },
    { id: 'heart',      label: 'Серьёзные проблемы с сердцем (недостаточность, тяжёлая аритмия, тяжёлая гипертензия)' },
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
    { id: 'pressure',  label: 'Давление (повышенное или пониженное)' },
    { id: 'diabetes',  label: 'Диабет / инсулинорезистентность' },
    { id: 'hernia',    label: 'Грыжа (поясничная, паховая, живота)' },
    { id: 'knees',     label: 'Проблемы с коленями' },
    { id: 'circulation', label: 'Нарушения кровообращения / варикоз' },
    { id: 'dizziness', label: 'Головокружения' },
    { id: 'thyroid',   label: 'Заболевания щитовидной железы' },
    { id: 'lipedema',  label: 'Липедема' },
  ],
};

// ─── Step 4: Что хочет убрать ─────────────────────────────────────────────────
export const GOALS = [
  { id: 'belly',     label: 'Живот',                  score: 1 },
  { id: 'sides',     label: 'Талия и бока',            score: 1 },
  { id: 'hips',      label: 'Бёдра и ягодицы',        score: 1 },
  { id: 'legs',      label: 'Ноги и икры',             score: 1 },
  { id: 'arms',      label: 'Руки',                    score: 1 },
  { id: 'weight',    label: 'Скинуть общий вес',       score: 1 },
  { id: 'cellulite', label: 'Целлюлит и тонус кожи',  score: 1 },
  { id: 'edema',     label: 'Отёки и тяжесть в ногах', score: 1 },
];

// ─── Step 5: Почему сейчас ────────────────────────────────────────────────────
export const WHY_NOW = [
  { id: 'event',        label: 'Важное событие' },
  { id: 'clothes',      label: 'Одежда стала мала' },
  { id: 'mirror',       label: 'Не нравится отражение или фото' },
  { id: 'health',       label: 'Самочувствие, здоровье' },
  { id: 'postpartum',   label: 'После родов' },
  { id: 'winter',       label: 'Набрал(а) за зиму' },
  { id: 'doctor',       label: 'Совет врача' },
  { id: 'example',      label: 'Пример знакомых' },
  { id: 'just_decided', label: 'Просто решил(а)' },
];

// ─── Step 6: Сроки ────────────────────────────────────────────────────────────
export const TIMING_OPTIONS = [
  { id: 'birthday', label: 'К дню рождения' },
  { id: 'wedding',  label: 'К свадьбе' },
  { id: 'vacation', label: 'К отпуску' },
  { id: 'date',     label: 'К конкретной дате' },
  { id: 'none',     label: 'Без конкретного срока', score: 0 },
];

export const DEADLINE_FLEX = [
  { id: 'strict', label: 'Точная, не сдвинется' },
  { id: 'approx', label: 'Примерная' },
];

// ─── Step 7: Параметры ────────────────────────────────────────────────────────
export const LOSS_RANGE = [
  { id: 'lt5',     label: 'До 5 кг' },
  { id: '5-10',    label: '5–10 кг' },
  { id: '10-20',   label: '10–20 кг' },
  { id: 'gt20',    label: 'Больше 20 кг' },
  { id: 'unknown', label: 'Не знает' },
];

export const LIFESTYLE = [
  { id: 'sedentary', label: 'Сидячая работа' },
  { id: 'active',    label: 'На ногах' },
  { id: 'mixed',     label: 'Смешанный' },
];

export const ACTIVITY = [
  { id: 'none', label: 'Нет' },
  { id: '1-2',  label: '1–2 раза в неделю' },
  { id: '3+',   label: '3+ раз в неделю' },
];

// ─── Step 8: Опыт ─────────────────────────────────────────────────────────────
export const EXPERIENCE = [
  { id: 'gym',      label: 'Зал' },
  { id: 'diet',     label: 'Диеты' },
  { id: 'hardware', label: 'Аппаратные процедуры' },
  { id: 'massage',  label: 'Массаж' },
  { id: 'pills',    label: 'Таблетки, чаи' },
  { id: 'online',   label: 'Марафоны, онлайн-программы' },
  { id: 'nothing',  label: 'Ничего не пробовал(а)' },
];

export const EXPERIENCE_OUTCOME = [
  { id: 'regained',  label: 'Вес вернулся' },
  { id: 'no_result', label: 'Не было результата' },
  { id: 'quit',      label: 'Бросил(а), не хватило времени' },
  { id: 'partial',   label: 'Нормально, но хочется большего' },
];

// ─── Step 9: Время и старт ────────────────────────────────────────────────────
export const TIME_SLOTS = [
  { id: 'morning', label: 'Утро до 10' },
  { id: 'day',     label: 'День 10–16' },
  { id: 'evening', label: 'Вечер после 16' },
  { id: 'weekend', label: 'Выходные' },
];

export const START_WHEN = [
  { id: 'this_week',  label: 'На этой неделе',     score: 3 },
  { id: 'next_week',  label: 'На следующей',        score: 2 },
  { id: 'this_month', label: 'В течение месяца',    score: 1 },
  { id: 'later',      label: 'Позже',               score: 0 },
];

// ─── Step 10: Мотивация и решение ─────────────────────────────────────────────
export const DECISION = [
  { id: 'self',   label: 'Сам(а)',                       score: 1 },
  { id: 'family', label: 'Посоветоваться с семьёй',       score: 0 },
];

// ─── Step 11: Откуда узнали ───────────────────────────────────────────────────
export const SOURCES = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: '2gis',      label: '2ГИС' },
  { id: 'referral',  label: 'Рекомендация знакомых' },
  { id: 'passing',   label: 'Проходил(а) мимо' },
  { id: 'website',   label: 'Сайт' },
  { id: 'ad',        label: 'Реклама' },
  { id: 'other',     label: 'Другое' },
];

export const WHAT_CAUGHT = [
  { id: 'results',   label: 'Результаты до/после' },
  { id: 'reviews',   label: 'Отзывы' },
  { id: 'no_diet',   label: 'Без диет и спорта' },
  { id: 'free_diag', label: 'Бесплатная диагностика' },
  { id: 'nearby',    label: 'Рядом с домом' },
  { id: 'price',     label: 'Цена' },
];

// ─── Step 12: Итог звонка ─────────────────────────────────────────────────────
export const CALL_OUTCOMES = [
  { id: 'booked',   label: 'Записан(а) на диагностику' },
  { id: 'callback', label: 'Перезвонить' },
  { id: 'thinking', label: 'Подумает' },
  { id: 'refused',  label: 'Отказ' },
];

export const REFUSAL_REASONS = [
  { id: 'far',               label: 'Далеко' },
  { id: 'expensive',         label: 'Дорого' },
  { id: 'no_time',           label: 'Нет времени' },
  { id: 'contraindications', label: 'Противопоказания' },
  { id: 'not_interested',    label: 'Не интересно' },
  { id: 'other',             label: 'Другое' },
];

export const EARLY_CLOSE_REASONS = [
  { id: 'no_answer',     label: 'Не дозвонились' },
  { id: 'busy',          label: 'Клиент занят, перезвонить' },
  { id: 'not_interested', label: 'Не интересно' },
  { id: 'not_our',       label: 'Не наш клиент (далеко, противопоказания)' },
];

// ─── Score / temperature ──────────────────────────────────────────────────────
export const TEMP_THRESHOLDS = { hot: 11, warm: 6 };

export const TEMP_TIPS: Record<string, string> = {
  hot:      'Записывай на бесплатный замер и пробную прямо сейчас, предложи ближайшее время',
  warm:     'Запиши на бесплатный замер, сделай акцент на сроке и результате',
  cold:     'Не дави. Предложи бесплатный замер без обязательств, договорись о повторном контакте',
  stop:     'Не записывать. Мягко объяснить противопоказание, предложить вернуться после консультации врача',
  postpone: 'Договориться о дате, когда можно будет прийти, поставить напоминание',
};

export const TEMP_BADGES: Record<string, string> = {
  hot: '🔥 Горячий', warm: '🌤 Тёплый', cold: '❄️ Холодный', stop: '⛔ Стоп', postpone: '⏸ Отложить',
};

export const TEMP_COLORS: Record<string, string> = {
  hot: '#e65100', warm: '#f59e0b', cold: '#3b82f6', stop: '#dc2626', postpone: '#6b7280',
};

// ─── Equipment ────────────────────────────────────────────────────────────────
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

// ─── Answer types ─────────────────────────────────────────────────────────────
export type A0 = { name: string; phone: string };

export type A1 = {
  travel_time: string;
  district?: string;
  transport?: string;
  from?: string;
  value?: string; // backward compat with old sessions
};

export type A2 = {
  gender?: string;
  value: string; // age group id
  postpartum?: boolean;
  postpartum_period?: 'lt6w' | '6w-6m' | 'gt6m';
  breastfeeding?: boolean;
};

export type A3 = { selected: string[]; none: boolean; other: string };

export type A4 = { selected: string[]; main_zone?: string; other?: string; goal_words?: string };

export type A5 = { selected: string[]; other?: string };

export type A6 = { type: string; date?: string; deadline_flex?: string };

export type A7 = {
  height: number | '';
  weight: number | '';
  goal_weight?: number | '';
  loss_range?: string;
  lifestyle?: string;
  activity?: string;
  skipped?: boolean;
};

export type A8 = {
  selected: string[];
  outcome?: string;
  stress_eating?: boolean;
  what_failed?: string;
};

export type A9 = { selected: string[]; start_when?: string };

export type A10 = { value: number; decision?: string };

export type A11 = { value: string; what_caught?: string[]; was_before?: boolean };

export type A12 = {
  outcome: string;
  visit_date?: string;
  visit_time?: string;
  callback_date?: string;
  callback_time?: string;
  refusal_reason?: string;
  comment?: string;
};

export interface Answers {
  [key: number]: unknown;
  used_scripts?: string[];
  asked?: Record<string, boolean[]>;
  closed_early?: { reason: string; comment?: string; at_step: number };
}

// ─── Compute result ───────────────────────────────────────────────────────────
export function computeResult(answers: Answers) {
  const a1 = answers[1] as A1 | undefined;
  const a2 = answers[2] as A2 | undefined;
  const a3 = answers[3] as A3 | undefined;
  const a4 = answers[4] as A4 | undefined;
  const a6 = answers[6] as A6 | undefined;
  const a7 = answers[7] as A7 | undefined;
  const a8 = answers[8] as A8 | undefined;
  const a9 = answers[9] as A9 | undefined;
  const a10 = answers[10] as A10 | undefined;
  const a11 = answers[11] as A11 | undefined;

  let score = 0;

  // Travel time (3 max)
  const travelId = a1?.travel_time ?? a1?.value; // backward compat
  score += TRAVEL_TIMES.find(d => d.id === travelId)?.score ?? 0;

  // Goal zones (1 max — any selection)
  const goalIds = a4?.selected ?? [];
  if (goalIds.length > 0) score += 1;

  // Timing (3 max)
  let weeks_left = 0;
  let sessions_possible = 0;
  let sessions_min = 0;
  // backward compat: old sessions stored timing in step 5
  const timingAns = a6 ?? (answers[5] as A6 | undefined);
  if (timingAns?.type && timingAns.type !== 'none' && timingAns.date) {
    const diffMs = new Date(timingAns.date).getTime() - Date.now();
    weeks_left = Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
    sessions_possible = weeks_left * SESSIONS_PER_WEEK_MAX;
    sessions_min = weeks_left * SESSIONS_PER_WEEK_MIN;
    score += weeks_left <= 12 ? 3 : 2;
  }

  // Time slots (1 max — any selection)
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
  if (a8?.stress_eating) flags.push('Ест на стрессе — сказать про эндорфины и график');
  if (a10?.decision === 'family') flags.push('Решение с семьёй — пригласить вместе на диагностику');
  if (a11?.was_before) flags.push('Был(а) раньше — уточнить, почему ушёл(ла)');
  if (a7?.lifestyle === 'sedentary' && goalIds.includes('edema'))
    flags.push('Сидячая работа + отёки — акцент на RollShape');
  if (a2?.gender === 'male' && goalIds.includes('belly'))
    flags.push('Мужчина + живот — InfraStep: акцент на живот');

  return {
    score, temperature, bmi, weeks_left, sessions_possible, sessions_min,
    recommendation: Array.from(eq), flags, format_recommendation,
  };
}

// ─── Build summary text ───────────────────────────────────────────────────────
export function buildSummaryText(answers: Answers, result: ReturnType<typeof computeResult>): string {
  const a0  = answers[0]  as A0  | undefined;
  const a2  = answers[2]  as A2  | undefined;
  const a3  = answers[3]  as A3  | undefined;
  const a4  = answers[4]  as A4  | undefined;
  const a6  = answers[6]  as A6  | undefined;
  const a7  = answers[7]  as A7  | undefined;
  const a8  = answers[8]  as A8  | undefined;
  const a9  = answers[9]  as A9  | undefined;
  const a10 = answers[10] as A10 | undefined;
  const a11 = answers[11] as A11 | undefined;
  const a12 = answers[12] as A12 | undefined;

  // backward compat: timing in step 5 for old sessions
  const timingAns = a6 ?? (answers[5] as A6 | undefined);

  const lines: string[] = [];

  // Client info first
  if (a0?.name) lines.push(`Клиент: ${a0.name}`);
  if (a0?.phone) lines.push(`Телефон: ${a0.phone}`);

  // Call outcome
  if (a12?.outcome) {
    const outLabel = CALL_OUTCOMES.find(o => o.id === a12.outcome)?.label ?? a12.outcome;
    let outLine = `Итог звонка: ${outLabel}`;
    if (a12.outcome === 'booked' && a12.visit_date) outLine += ` — ${a12.visit_date} ${a12.visit_time ?? ''}`.trimEnd();
    else if ((a12.outcome === 'callback' || a12.outcome === 'thinking') && a12.callback_date) {
      outLine += ` — перезвон ${a12.callback_date} ${a12.callback_time ?? ''}`.trimEnd();
    } else if (a12.outcome === 'refused' && a12.refusal_reason) {
      outLine += `: ${REFUSAL_REASONS.find(r => r.id === a12!.refusal_reason)?.label ?? a12.refusal_reason}`;
    }
    if (a12.comment) outLine += ` (${a12.comment})`;
    lines.push(outLine);
  }

  if (answers.closed_early) {
    const { reason, comment } = answers.closed_early;
    const rLabel = EARLY_CLOSE_REASONS.find(r => r.id === reason)?.label ?? reason;
    lines.push(`Закрыта досрочно: ${rLabel}${comment ? ` (${comment})` : ''}`);
  }

  lines.push(`Температура: ${TEMP_BADGES[result.temperature]}`);

  const goalLabels = GOALS.filter(g => (a4?.selected ?? []).includes(g.id)).map(g => g.label);
  if (a4?.other) goalLabels.push(a4.other);
  if (goalLabels.length) lines.push(`Запрос: ${goalLabels.join(', ')}`);
  if (a4?.goal_words) lines.push(`Своими словами: ${a4.goal_words}`);

  if (timingAns?.type !== 'none' && timingAns?.date) {
    const d = new Date(timingAns.date).toLocaleDateString('ru-RU');
    lines.push(`Срок: до ${d} (${result.weeks_left} нед, ~${result.sessions_min}–${result.sessions_possible} сеансов)`);
  }

  if (!a7 || a7.skipped || (!a7.height && !a7.weight)) lines.push('Рост/вес: не указаны');
  else if (result.bmi) {
    const goalDiff = a7?.goal_weight && a7?.weight ? Number(a7.weight) - Number(a7.goal_weight) : null;
    lines.push(`ИМТ: ${result.bmi}` + (goalDiff && goalDiff > 0 ? `, цель: −${goalDiff} кг` : ''));
  }

  const allContra = [...CONTRAINDICATIONS.stop, ...CONTRAINDICATIONS.temporary, ...CONTRAINDICATIONS.attention];
  const sel = a3?.none ? [] : (a3?.selected ?? []);
  const contrLabels = allContra.filter(c => sel.includes(c.id)).map(c => c.label);
  if (a3?.other) contrLabels.push(a3.other);
  lines.push(contrLabels.length ? `Противопоказания: ${contrLabels.join(', ')}` : 'Противопоказаний нет');

  const ageLabel = AGE_GROUPS.find(a => a.id === a2?.value)?.label;
  if (ageLabel) lines.push(`Возраст: ${ageLabel}${a2?.gender === 'male' ? ' (мужчина)' : ''}`);
  if (a2?.postpartum) {
    const periodLabel = POSTPARTUM_PERIODS.find(p => p.id === a2.postpartum_period)?.label ?? '';
    lines.push(`После родов: ${periodLabel}${a2.breastfeeding ? ', грудное вскармливание' : ''}`);
  }

  const timeLabels = TIME_SLOTS.filter(t => (a9?.selected ?? []).includes(t.id)).map(t => t.label);
  if (timeLabels.length) lines.push(`Время: ${timeLabels.join(', ')}`);
  const startLabel = START_WHEN.find(s => s.id === a9?.start_when)?.label;
  if (startLabel) lines.push(`Старт: ${startLabel}`);

  if (a10?.value) lines.push(`Мотивация: ${a10.value}/10`);
  const decLabel = DECISION.find(d => d.id === a10?.decision)?.label;
  if (decLabel) lines.push(`Решение: ${decLabel}`);

  const sourceLabel = SOURCES.find(s => s.id === a11?.value)?.label;
  if (sourceLabel) lines.push(`Источник: ${sourceLabel}`);

  if (result.recommendation.length) lines.push(`Аппараты: ${result.recommendation.join(', ')}`);
  lines.push(`Формат: ${result.format_recommendation}`);
  lines.push('(Окончательно — после диагностики и пробной)');

  const expLabels = EXPERIENCE.filter(e => (a8?.selected ?? []).includes(e.id)).map(e => e.label);
  if (expLabels.length) lines.push(`Опыт: ${expLabels.join(', ')}`);

  return lines.join('\n');
}
