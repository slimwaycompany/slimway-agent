import {
  GOALS, TIMING_OPTIONS, SESSIONS_PER_WEEK_MIN, SESSIONS_PER_WEEK_MAX,
  CONTRAINDICATIONS, EXPERIENCE, WHY_NOW, GOAL_EQUIPMENT,
  Answers, A1, A2, A3, A4, A6, A8, A9, A10, A11, A12,
  computeResult,
} from './qualify';
import { PRICE_PACKS, formatFromRecommendation, selectPackage, fmtPrice } from './prices';

export interface Script {
  id: string;
  title: string;
  category: string;
  text: string;
  step?: number;
  group?: string;
  when?: (answers: Answers) => boolean;
  tone?: 'normal' | 'warning' | 'stop';
  fields?: { key: string; placeholder: string }[];
  mergedIds?: string[]; // set on dynamically composed/merged cards
}

// ─── Phone normalization (shared) ────────────────────────────────────────────
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  return null;
}

// ─── Substitution helper ──────────────────────────────────────────────────────
function seasonPhrase(): string {
  const m = new Date().getMonth();
  if (m === 0) return 'Сейчас самое время — пока есть настрой';
  if (m <= 2) return 'К 8 марта и Наурызу успеете прийти в форму';
  if (m <= 4) return 'К лету результат будет виден';
  if (m <= 7) return 'Отпуск — не повод откладывать, наоборот';
  if (m === 8) return 'После отпусков — самое время вернуться в форму';
  if (m <= 10) return 'У нас полгода зима, движения минимум — вес набирается сам собой. Начать сейчас проще, чем весной откапываться';
  return 'К праздникам ещё успеваем';
}

export function fillScript(text: string, answers: Answers): string {
  const a4  = answers[4]  as A4  | undefined;
  const a6  = answers[6]  as A6  | undefined;
  const a12 = answers[12] as A12 | undefined;

  // backward compat: timing may be in step 5 for old sessions
  const timingAns = a6 ?? (answers[5] as A6 | undefined);

  const eventMap: Record<string, string> = {
    birthday: 'ДР', wedding: 'свадьбы', vacation: 'отпуска', date: 'нужной даты',
  };
  const event = eventMap[timingAns?.type ?? ''] ?? '';

  let date = '';
  let weeks = 0;
  let sessions_min = 0;
  let sessions_max = 0;
  if (timingAns?.date) {
    const d = new Date(timingAns.date);
    date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const diffMs = d.getTime() - Date.now();
    weeks = Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
    sessions_min = weeks * SESSIONS_PER_WEEK_MIN;
    sessions_max = weeks * SESSIONS_PER_WEEK_MAX;
  }

  const pain = GOALS.filter(g => (a4?.selected ?? []).includes(g.id)).map(g => g.label).join(', ');
  const goal_words = a4?.goal_words ?? '';

  const visit_date  = a12?.visit_date ?? '';
  const visit_time  = a12?.visit_time ?? '';
  const callback_date = a12?.callback_date ?? '';
  const callback_time = a12?.callback_time ?? '';

  // Price substitutions
  const result = computeResult(answers);
  const fmt = formatFromRecommendation(result.format_recommendation);
  const packs = PRICE_PACKS[fmt];
  const single = packs.find(p => p.isSingle);
  const pkg = selectPackage(fmt, result.sessions_min);
  const price_single = single ? fmtPrice(single.price) : '';
  const nonSingle = packs.filter(p => !p.isSingle);
  const price_per_session_min = nonSingle.length
    ? fmtPrice(Math.min(...nonSingle.map(p => p.perSession)))
    : '';
  const package_count = String(pkg.sessions);
  const package_price = fmtPrice(pkg.price);
  const package_per_session = fmtPrice(pkg.perSession);

  return text
    .replace(/{event}/g, event)
    .replace(/{date}/g, date)
    .replace(/{weeks}/g, String(weeks))
    .replace(/{sessions_min}/g, String(sessions_min))
    .replace(/{sessions_max}/g, String(sessions_max))
    .replace(/{pain}/g, pain)
    .replace(/{goal_words}/g, goal_words)
    .replace(/{season_phrase}/g, seasonPhrase())
    .replace(/{visit_date}/g, visit_date)
    .replace(/{visit_time}/g, visit_time)
    .replace(/{callback_date}/g, callback_date)
    .replace(/{callback_time}/g, callback_time)
    .replace(/{price_single}/g, price_single)
    .replace(/{price_per_session_min}/g, price_per_session_min)
    .replace(/{package_count}/g, package_count)
    .replace(/{package_price}/g, package_price)
    .replace(/{package_per_session}/g, package_per_session)
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Zones composition (step 5) ───────────────────────────────────────────────
const EQUIP_ROLES: Record<string, string> = {
  'Vacu Activ': 'запускает общий расход по всему телу',
  'InfraShape': 'точечно работает с животом, бёдрами и ягодицами, без нагрузки на колени и спину',
  'InfraStep':  'самая активная нагрузка: ягодицы, ноги, талия',
};
const EQUIP_ORDER = ['Vacu Activ', 'InfraShape', 'InfraStep'];

export function composeZonesScript(answers: Answers): Script | null {
  const a4 = answers[4] as A4 | undefined;
  const a2 = answers[2] as A2 | undefined;
  const selected = a4?.selected ?? [];
  if (!selected.length) return null;

  const zoneLabels = GOALS.filter(g => selected.includes(g.id)).map(g => g.label);
  const zonesText = zoneLabels.length === 1
    ? zoneLabels[0]
    : zoneLabels.slice(0, -1).join(', ') + ' и ' + zoneLabels[zoneLabels.length - 1];

  const lines: string[] = [];
  lines.push(`${zonesText} — поработаем комплексно, а не одним аппаратом.`);

  const activeGoals = selected.filter(id => id !== 'cellulite' && id !== 'edema');
  const equipSet = new Set<string>();
  for (const g of activeGoals) {
    for (const eq of GOAL_EQUIPMENT[g] ?? []) {
      if (eq !== 'RollShape') equipSet.add(eq);
    }
  }
  const equipArr = EQUIP_ORDER.filter(eq => equipSet.has(eq));
  if (equipArr.length > 0) {
    const parts = equipArr.map(eq => `${eq}, который ${EQUIP_ROLES[eq]}`);
    if (parts.length === 1) lines.push(`Под это подойдёт ${parts[0]}.`);
    else if (parts.length === 2) lines.push(`Под это подойдут ${parts[0]}, и ${parts[1]}.`);
    else lines.push(`Под это подойдут ${parts.slice(0, -1).join(', ')}, и ${parts[parts.length - 1]}.`);
  }

  if (selected.includes('cellulite') || selected.includes('edema')) {
    lines.push('А после активной фазы — RollShape: рельеф кожи и лёгкость в ногах. Это формат SlimWay Complex.');
  }

  if (selected.includes('weight')) {
    lines.push('Начнём с бесплатной диагностики — анализатор покажет, из чего состоит ваш вес, и под эти цифры подберём программу.');
  } else {
    lines.push('Точнее подберём после бесплатной диагностики.');
  }

  if (a2?.gender === 'male' && selected.includes('belly')) {
    lines.push('Для живота у мужчин особенно хорошо работает InfraStep.');
  }

  return {
    id: 'zones_composed',
    title: 'Аппараты под зоны',
    category: 'Окно',
    step: 5,
    text: lines.join(' '),
  };
}

// ─── Merged step cards ────────────────────────────────────────────────────────
export function getStepCards(step: number, answers: Answers): Script[] {
  if (step === 5) {
    const c = composeZonesScript(answers);
    return c ? [c] : [];
  }
  const matching = SCRIPTS.filter(s => s.step === step && (!s.when || s.when(answers)));
  const ungrouped: Script[] = [];
  const groups = new Map<string, Script[]>();
  for (const s of matching) {
    if (!s.group) { ungrouped.push(s); continue; }
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  const cards: Script[] = [];
  for (const [, scripts] of groups) {
    if (scripts.length === 1) { cards.push(scripts[0]); continue; }
    // merge: deduplicate sentences
    const seen = new Set<string>();
    const sentences: string[] = [];
    for (const s of scripts) {
      for (const sent of s.text.split(/(?<=[.!?…])\s+/)) {
        const key = sent.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
        if (key && !seen.has(key)) { seen.add(key); sentences.push(sent); }
      }
    }
    cards.push({ ...scripts[0], text: sentences.join(' '), mergedIds: scripts.map(s => s.id) });
  }
  cards.push(...ungrouped);
  const idx = new Map(SCRIPTS.map((s, i) => [s.id, i]));
  cards.sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
  return cards.slice(0, 2);
}

// ─── Helper conditions ────────────────────────────────────────────────────────
const stopIds = new Set(CONTRAINDICATIONS.stop.map(c => c.id));
const tempIds = new Set(CONTRAINDICATIONS.temporary.map(c => c.id));
const attIds  = new Set(CONTRAINDICATIONS.attention.map(c => c.id));

function contrSel(a: Answers): string[] {
  const a3 = a[3] as A3 | undefined;
  return a3?.none ? [] : (a3?.selected ?? []);
}

// ─── Scripts ──────────────────────────────────────────────────────────────────
export const SCRIPTS: Script[] = [

  // ── Окно 2: Где живёт ────────────────────────────────────────────────────────
  {
    id: 's1_far',
    title: 'Далеко ехать',
    category: 'Окно',
    step: 2,
    group: 'travel',
    when: a => ['far', 'very_far'].includes((a[1] as A1 | undefined)?.travel_time ?? (a[1] as any)?.value ?? ''),
    text: 'Сам сеанс — 30 минут, 2–3 раза в неделю. Многие ездят к нам с другого конца города: всё равно выходит быстрее, чем два часа в зале с дорогой и душем',
  },
  {
    id: 's1_near',
    title: 'Рядом — удобно',
    category: 'Окно',
    step: 2,
    group: 'travel',
    when: a => ['near', 'medium'].includes((a[1] as A1 | undefined)?.travel_time ?? (a[1] as any)?.value ?? ''),
    text: 'Вам вообще рядом — удобно заходить до или после работы',
  },
  {
    id: 's1_car',
    title: 'На машине — парковка',
    category: 'Окно',
    step: 2,
    when: a => (a[1] as A1 | undefined)?.transport === 'car',
    text: 'Парковка рядом есть — удобно заезжать по пути',
  },
  {
    id: 's1_work',
    title: 'С работы — удобно',
    category: 'Окно',
    step: 2,
    when: a => (a[1] as A1 | undefined)?.from === 'work',
    text: 'Многие заходят прямо после работы — 30 минут, и дальше по своим делам',
  },

  // ── Окно 3: О клиенте ────────────────────────────────────────────────────────
  {
    id: 's2_older',
    title: 'После 45',
    category: 'Окно',
    step: 3,
    when: a => ['46-55', '56+'].includes((a[2] as A2 | undefined)?.value ?? ''),
    text: 'После сорока пяти процесс действительно идёт иначе — метаболизм замедляется, и то, что работало раньше, перестаёт давать результат. Это про физиологию, а не про вас лично. Поэтому мы и не работаем одним аппаратом. Что беспокоит больше: общий вес или конкретные зоны?',
  },
  {
    id: 's2_male',
    title: 'Мужчина — живот',
    category: 'Окно',
    step: 3,
    when: a => (a[2] as A2 | undefined)?.gender === 'male',
    text: 'Для мужчин главная зона почти всегда живот — тут хорошо работает InfraStep, он даёт самую активную нагрузку',
  },
  {
    id: 's2_postpartum',
    title: 'После родов',
    category: 'Окно',
    step: 3,
    when: a => !!(a[2] as A2 | undefined)?.postpartum,
    text: 'После родов тело переживает второе начало — это не возврат к прежнему, а новая точка отсчёта. Самое частое, с чем приходят, — низ живота. Скажите, сколько времени прошло и есть ли разрешение врача на нагрузку?',
  },
  {
    id: 's2_postpartum_warn',
    title: 'Допуск после родов',
    category: 'Окно',
    step: 3,
    tone: 'warning',
    when: a => !!(a[2] as A2 | undefined)?.postpartum,
    text: 'Не говорить «вернём прежнюю фигуру». Допуск: от 6 недель после естественных родов и от 8 после кесарева, только с разрешения врача',
  },

  // ── Окно 4: Противопоказания ─────────────────────────────────────────────────
  {
    id: 's3_attention',
    title: 'Есть особенности здоровья',
    category: 'Окно',
    step: 4,
    when: a => !(a[3] as A3 | undefined)?.none && contrSel(a).some(s => attIds.has(s)) && !contrSel(a).some(s => stopIds.has(s)),
    text: 'Спасибо, что сказали. Это не повод не приходить: ударной нагрузки у нас нет, вы не бежите и не прыгаете. Вакуум и прогрев регулируются, вплоть до полного отключения. С такими особенностями у нас занимаются постоянно — посмотрим вместе на диагностике',
  },
  {
    id: 's3_knees',
    title: 'Проблемы с коленями',
    category: 'Окно',
    step: 4,
    when: a => contrSel(a).includes('knees') && !contrSel(a).some(s => stopIds.has(s)),
    text: 'Нагрузка идёт не на суставы, а на мышцы. Плюс во время сеанса работает инфракрасный прогрев — двигаться в тепле комфортнее. Это не лечение, честно говорю, но многие отмечают, что заниматься так легче, чем в обычном зале',
  },
  {
    id: 's3_temp',
    title: 'Временные противопоказания',
    category: 'Окно',
    step: 4,
    tone: 'warning',
    when: a => contrSel(a).some(s => tempIds.has(s)) && !contrSel(a).some(s => stopIds.has(s)),
    text: 'Давайте немного подождём, чтобы организм восстановился — так будет безопаснее и результат лучше. Давайте сразу договоримся, когда я вам наберу, чтобы записать',
  },
  {
    id: 's3_stop',
    title: 'Стоп-противопоказание',
    category: 'Окно',
    step: 4,
    tone: 'stop',
    when: a => contrSel(a).some(s => stopIds.has(s)),
    text: 'Спасибо, что предупредили. С этим аппаратные сеансы, к сожалению, нельзя — ваша безопасность для нас важнее. Если врач разрешит, будем очень рады вас видеть',
  },

  // ── Окно 5: зоны → через composeZonesScript, SCRIPTS здесь не нужны ──────────

  // ── Окно 6: Почему сейчас ────────────────────────────────────────────────────
  {
    id: 's5_clothes',
    title: 'Одежда стала мала',
    category: 'Окно',
    step: 6,
    group: 'why_now',
    when: a => ((a[5] as { selected?: string[] } | undefined)?.selected ?? []).includes('clothes'),
    text: 'Иногда дело даже не в весе. Важно открыть шкаф и надеть то, что хочется, а не то, что налезет',
  },
  {
    id: 's5_mirror',
    title: 'Не нравится отражение',
    category: 'Окно',
    step: 6,
    group: 'why_now',
    when: a => ((a[5] as { selected?: string[] } | undefined)?.selected ?? []).includes('mirror'),
    text: 'Важна не цифра, а разница в зеркале. И её видно раньше, чем цифру на весах',
  },
  {
    id: 's5_health',
    title: 'Самочувствие',
    category: 'Окно',
    step: 6,
    group: 'why_now',
    when: a => ((a[5] as { selected?: string[] } | undefined)?.selected ?? []).includes('health'),
    text: 'Результат будем смотреть не по ощущениям, а по цифрам — каждую неделю повторная диагностика',
  },
  {
    id: 's5_winter',
    title: 'Набрал(а) за зиму',
    category: 'Окно',
    step: 6,
    group: 'why_now',
    when: a => ((a[5] as { selected?: string[] } | undefined)?.selected ?? []).includes('winter'),
    text: 'У нас полгода зима, движения минимум — вес набирается сам собой. Начать сейчас проще, чем весной',
  },
  {
    id: 's5_example',
    title: 'Пример знакомых',
    category: 'Окно',
    step: 6,
    group: 'why_now',
    when: a => ((a[5] as { selected?: string[] } | undefined)?.selected ?? []).includes('example'),
    text: 'Здорово, когда видишь результат у знакомых — значит, и система понятна. На диагностике покажу, как это будет у вас',
  },

  // ── Окно 7: Сроки ────────────────────────────────────────────────────────────
  {
    id: 's6_date',
    title: 'Есть конкретный срок',
    category: 'Окно',
    step: 7,
    when: a => { const a6 = a[6] as A6 | undefined; return !!(a6?.type && a6.type !== 'none' && a6.date); },
    text: 'До {event} {weeks} нед. — это примерно {sessions_min}–{sessions_max} сеансов. Если начать на этой неделе — к {date} придёте уже с результатом. А «с понедельника» — в лучшем случае только начнёте',
  },
  {
    id: 's6_strict',
    title: 'Точная дата — не терять',
    category: 'Окно',
    step: 7,
    when: a => (a[6] as A6 | undefined)?.deadline_flex === 'strict',
    text: 'Раз дата не сдвинется, давайте не терять неделю — каждая неделя это ещё 2–3 сеанса',
  },
  {
    id: 's6_tight',
    title: 'Очень мало времени',
    category: 'Окно',
    step: 7,
    tone: 'warning',
    when: a => {
      const a6 = a[6] as A6 | undefined;
      if (!a6?.date || a6.type === 'none') return false;
      const w = Math.floor((new Date(a6.date).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000));
      return w >= 0 && w < 2;
    },
    text: 'Времени немного, но начать всё равно стоит — давайте на диагностике посмотрим, что реально успеем к {date}',
  },
  {
    id: 's6_no_date',
    title: 'Без конкретного срока',
    category: 'Окно',
    step: 7,
    when: a => (a[6] as A6 | undefined)?.type === 'none',
    text: '{season_phrase}',
  },

  // ── Окно 8: Параметры ────────────────────────────────────────────────────────
  {
    id: 's7_goal_weight',
    title: 'Указан желаемый вес',
    category: 'Окно',
    step: 8,
    when: a => {
      const a7 = a[7] as { goal_weight?: unknown } | undefined;
      return !!(a7?.goal_weight && Number(a7.goal_weight) > 0);
    },
    text: 'Важна не только цифра на весах. На диагностике увидим, сколько там жира, а сколько воды — часто объёмы уходят быстрее, чем вес',
  },
  {
    id: 's7_sedentary',
    title: 'Сидячая работа',
    category: 'Окно',
    step: 8,
    when: a => (a[7] as { lifestyle?: string } | undefined)?.lifestyle === 'sedentary',
    text: 'При сидячей работе к вечеру часто тяжесть в ногах — это как раз задача для RollShape',
  },
  {
    id: 's7_no_activity',
    title: 'Активности нет',
    category: 'Окно',
    step: 8,
    when: a => (a[7] as { activity?: string } | undefined)?.activity === 'none',
    text: 'Ничего страшного — подготовка не нужна. Начнём с мягких стартовых настроек',
  },
  {
    id: 's7_active',
    title: 'Активность 3+',
    category: 'Окно',
    step: 8,
    when: a => (a[7] as { activity?: string } | undefined)?.activity === '3+',
    text: 'Отлично, база есть — можно сразу дать InfraStep, он самый интенсивный',
  },

  // ── Окно 9: Опыт ─────────────────────────────────────────────────────────────
  {
    id: 's8_tried',
    title: 'Уже что-то пробовали',
    category: 'Окно',
    step: 9,
    group: 'experience',
    when: a => {
      const a8 = a[8] as A8 | undefined;
      return !!(a8?.selected?.length) && !a8.selected.includes('nothing');
    },
    text: 'Многие приходят с той же историей: пробовали, какое-то время получалось, потом всё возвращалось. Сомнение понимаю. Здесь подход другой: сначала смотрим ваши показатели, подбираем программу и отслеживаем изменения по цифрам. А что именно пробовали и почему, как думаете, не сработало?',
  },
  {
    id: 's8_regained',
    title: 'Вес вернулся',
    category: 'Окно',
    step: 9,
    group: 'experience',
    when: a => (a[8] as A8 | undefined)?.outcome === 'regained',
    text: 'Так бывает почти у всех, кто худел резко. Мы не гоним темп — поэтому результат держится дольше',
  },
  {
    id: 's8_diet',
    title: 'Пробовала диеты',
    category: 'Окно',
    step: 9,
    group: 'experience',
    when: a => ((a[8] as A8 | undefined)?.selected ?? []).includes('diet'),
    text: 'Голодать и изводить себя здесь не нужно. Дело не в силе воли, а в системе — её мы и даём',
  },
  {
    id: 's8_pills',
    title: 'Таблетки, чаи',
    category: 'Окно',
    step: 9,
    when: a => ((a[8] as A8 | undefined)?.selected ?? []).includes('pills'),
    text: 'Здесь никаких таблеток — только работа тела и цифры, которые видно каждую неделю',
  },
  {
    id: 's8_nothing',
    title: 'Ничего не пробовала',
    category: 'Окно',
    step: 9,
    when: a => ((a[8] as A8 | undefined)?.selected ?? []).includes('nothing'),
    text: 'Отлично — значит, начнём сразу правильно: с диагностики и системы',
  },
  {
    id: 's8_stress',
    title: 'Ест на стрессе',
    category: 'Окно',
    step: 9,
    when: a => !!(a[8] as A8 | undefined)?.stress_eating,
    text: 'Это очень частая история — есть не от голода, а когда устала. Многие замечают, что после сеансов первым меняется настроение, а тянуть на еду становится меньше. И когда есть график и цель, срываться сложнее',
  },

  // ── Окно 10: Время и старт ────────────────────────────────────────────────────
  {
    id: 's9_time',
    title: 'График без переломов',
    category: 'Окно',
    step: 10,
    text: 'Сеанс — 30 минут, 2–3 раза в неделю. Подберём время, чтобы не ломать ваш график',
  },
  {
    id: 's9_later',
    title: 'Старт позже',
    category: 'Окно',
    step: 10,
    when: a => (a[9] as A9 | undefined)?.start_when === 'later',
    text: 'Давайте хотя бы диагностику сделаем сейчас — она бесплатная и недолгая. Начнёте, когда будете готовы, а цифры у вас уже будут',
  },
  {
    id: 's9_this_week',
    title: 'Готов(а) на этой неделе',
    category: 'Окно',
    step: 10,
    when: a => (a[9] as A9 | undefined)?.start_when === 'this_week',
    text: 'Отлично, тогда давайте сразу подберём время — завтра или послезавтра?',
  },

  // ── Окно 11: Мотивация и решение ─────────────────────────────────────────────
  {
    id: 's10_low',
    title: 'Мотивация низкая (1–4)',
    category: 'Окно',
    step: 11,
    when: a => { const v = (a[10] as A10 | undefined)?.value ?? 0; return v >= 1 && v <= 4; },
    text: 'Давайте без обязательств: просто приходите на бесплатную диагностику — узнаете свои цифры, попробуете аппараты, а решать будете потом',
  },
  {
    id: 's10_high',
    title: 'Мотивация высокая (8–10)',
    category: 'Окно',
    step: 11,
    when: a => { const v = (a[10] as A10 | undefined)?.value ?? 0; return v >= 8; },
    text: 'Тогда не будем откладывать — давайте подберём время на этой неделе',
  },
  {
    id: 's10_family',
    title: 'Посоветоваться с семьёй',
    category: 'Окно',
    step: 11,
    when: a => (a[10] as A10 | undefined)?.decision === 'family',
    text: 'Конечно, посоветуйтесь. А приходите на диагностику вместе — вдвоём увидите цифры, попробуете аппараты и решите',
  },

  // ── Окно 12: Откуда узнали ───────────────────────────────────────────────────
  {
    id: 's11_reviews',
    title: 'Отзывы',
    category: 'Окно',
    step: 12,
    when: a => ((a[11] as A11 | undefined)?.what_caught ?? []).includes('reviews'),
    text: 'Отзывы — это хорошо, но лучше увидеть свои цифры. Диагностика бесплатная',
  },
  {
    id: 's11_results',
    title: 'Результаты до/после',
    category: 'Окно',
    step: 12,
    when: a => ((a[11] as A11 | undefined)?.what_caught ?? []).includes('results'),
    text: 'На визите покажу настоящие листы замеров — с датами, от руки',
  },
  {
    id: 's11_was_before',
    title: 'Был(а) раньше',
    category: 'Окно',
    step: 12,
    when: a => !!(a[11] as A11 | undefined)?.was_before,
    text: 'Рады, что вернулись! Подскажите, что тогда помешало продолжить — чтобы в этот раз сделать удобнее',
  },

  // ── Окно 13: Итог звонка ─────────────────────────────────────────────────────
  {
    id: 's12_booked',
    title: 'Записан(а)',
    category: 'Окно',
    step: 13,
    when: a => (a[12] as A12 | undefined)?.outcome === 'booked',
    text: 'Записала вас на {visit_date} в {visit_time}. Адрес: ул. Ахмета Байтурсынова, 2, ЖК Qazyna, НП14. Возьмите сменную обувь — в бахилах на аппараты нельзя, полотенце и удобную одежду, лучше прилегающую к телу — так прогрев работает в полную силу. И желательно не плотно есть прямо перед диагностикой',
  },
  {
    id: 's12_callback',
    title: 'Перезвонить',
    category: 'Окно',
    step: 13,
    when: a => (a[12] as A12 | undefined)?.outcome === 'callback',
    text: 'Хорошо, наберу вас {callback_date} в {callback_time}. Удобно?',
  },
  {
    id: 's12_thinking',
    title: 'Подумает',
    category: 'Окно',
    step: 13,
    when: a => (a[12] as A12 | undefined)?.outcome === 'thinking',
    text: 'Конечно, подумайте. Я напишу вам {callback_date} — если появятся вопросы, пишите в любое время',
  },
  {
    id: 's12_refused',
    title: 'Отказ — не дожимать',
    category: 'Окно',
    step: 13,
    tone: 'warning',
    when: a => (a[12] as A12 | undefined)?.outcome === 'refused',
    text: 'Не дожимать. Поблагодарить и оставить дверь открытой: "Если надумаете — бесплатная диагностика остаётся за вами"',
  },

  // ── Панель: Открытие ─────────────────────────────────────────────────────────
  {
    id: 'open_us',
    title: 'О нас за 30 секунд',
    category: 'Открытие',
    text: 'Скажу главное: здесь не нужно голодать и изводить себя. Вы ложитесь или спокойно идёте пешком — работает оборудование. 30 минут, 2–3 раза в неделю. Сначала диагностика показывает, из чего состоит ваш вес, потом под эти цифры подбираем программу и каждую неделю смотрим, что меняется',
  },
  {
    id: 'open_first_visit',
    title: 'Что будет на первом визите',
    category: 'Открытие',
    text: 'Сначала диагностика — буквально несколько минут. Потом попробуете каждый аппарат примерно по 5 минут и спокойно разберём результаты. Диагностика и пробная — бесплатно',
  },

  // ── Панель: Возражения ───────────────────────────────────────────────────────
  {
    id: 'obj_price',
    title: '«Сколько стоит?»',
    category: 'Возражения',
    text: 'Разовое занятие — {price_single}, а в пакете выходит от {price_per_session_min} за занятие. Какой пакет подойдёт именно вам — скажу точно после бесплатной диагностики',
  },
  {
    id: 'obj_expensive',
    title: '«Дорого»',
    category: 'Возражения',
    text: 'Понимаю, сумма ощутимая. Давайте посчитаем на одно занятие: в пакете на {package_count} сеансов это {package_per_session} за занятие, а разовое — {price_single}. И это не только аппарат: настройки под вас, регулярная диагностика и сопровождение. А первый визит вообще бесплатный',
  },
  {
    id: 'obj_think',
    title: '«Подумаю»',
    category: 'Возражения',
    text: 'Конечно, подумайте. Только один вопрос: сколько раз вы уже откладывали решение заняться собой? Давайте так: приходите на бесплатную диагностику — это ни к чему не обязывает, просто узнаете свои цифры',
  },
  {
    id: 'obj_no_time',
    title: '«Нет времени»',
    category: 'Возражения',
    text: 'Тридцать минут два раза в неделю — это час в неделю, меньше одного сериала. Не нужно переодеваться на два часа, тренироваться, душ, дорога. Пришли, полчаса — и дальше своими делами',
  },
  {
    id: 'obj_far',
    title: '«Далеко ехать»',
    category: 'Возражения',
    text: 'Сам сеанс — 30 минут, 2–3 раза в неделю. Многие ездят с другого конца города — всё равно быстрее, чем зал. Давайте подберём время по пути с работы',
  },
  {
    id: 'obj_works',
    title: '«А это точно работает?»',
    category: 'Возражения',
    text: 'Система работает — это проверено. От вас нужно одно: ходить 2–3 раза в неделю и не саботировать себя едой. Всё остальное — наша забота. На визите покажу листы замеров тех, кто уже прошёл программу',
  },
  {
    id: 'obj_tried',
    title: '«Уже пробовала — не помогло»',
    category: 'Возражения',
    text: 'Понимаю, и не спорю. Здесь другой подход: не надеемся на результат, а смотрим цифры каждую неделю и подстраиваем программу. Это не последняя остановка, а новое начало',
  },
  {
    id: 'obj_late',
    title: '«Мне уже поздно»',
    category: 'Возражения',
    text: 'Слышу это часто. У нас занимаются женщины и в пятьдесят, и в пятьдесят семь. Процесс идёт спокойнее — и это даже плюс: результат держится дольше. Давайте посмотрим ваши цифры на диагностике, и я скажу конкретно по вам',
  },
  {
    id: 'obj_health',
    title: '«Боюсь из-за здоровья»',
    category: 'Возражения',
    text: 'Это совершенно нормально — большинство наших клиентов начинают с той же тревогой, а потом говорят, что зря тянули. Ударной нагрузки нет, настройки полностью под вас, консультант рядом весь сеанс',
  },
  {
    id: 'obj_starve',
    title: '«Не хочу голодать»',
    category: 'Возражения',
    text: 'И не нужно. Здесь не нужно голодать и изводить себя. Дело не в силе воли, а в системе',
  },
  {
    id: 'obj_stress_eat',
    title: '«Ем на нервах»',
    category: 'Возражения',
    text: 'Это очень частая история — есть не от голода, а когда устала. Многие замечают, что после сеансов первым меняется настроение, а тянуть на еду становится меньше. И когда есть график и цель, срываться сложнее',
  },
  {
    id: 'obj_one_device',
    title: '«Хочу только один аппарат»',
    category: 'Возражения',
    text: 'Можно и так — есть пакет только на Vacu, он дешевле. Но на диагностике покажу, почему чаще рекомендую чередовать аппараты: тело не привыкает к одной нагрузке. Пакет Vacu на 16 сеансов — 125 000 ₸, кросс-пакет — 150 000 ₸, разница около 1 500 ₸ за занятие',
  },
  {
    id: 'obj_not_ready',
    title: '«Не готова записываться сейчас»',
    category: 'Возражения',
    text: 'Понимаю. Давайте я просто забронирую за вами время — если не получится, напишете мне, и перенесём',
  },

  // ── Панель: Закрытие ─────────────────────────────────────────────────────────
  {
    id: 'close_choice',
    title: 'Выбор из двух',
    category: 'Закрытие',
    fields: [
      { key: 'time1', placeholder: 'Время 1, например «завтра в 11:00»' },
      { key: 'time2', placeholder: 'Время 2, например «послезавтра в 15:00»' },
    ],
    text: 'Давайте запишу вас на бесплатную диагностику и пробную. Вам удобнее {time1} или {time2}?',
  },
  {
    id: 'close_goal',
    title: 'Возврат к цели',
    category: 'Закрытие',
    when: a => !!((a[4] as A4 | undefined)?.goal_words),
    text: 'Вы же сами сказали про {goal_words}. Вот ради этого и стоит начать',
  },
  {
    id: 'close_warm',
    title: 'Тёплое завершение',
    category: 'Закрытие',
    text: 'Дело же не в цифре на весах. А в том, чтобы утром открыть шкаф и надеть то, что хочется, а не то, что налезет',
  },
];

// ─── Dont say ─────────────────────────────────────────────────────────────────
export const DONT_SAY: string[] = [
  'Не обещать конкретные килограммы и сантиметры',
  'Не говорить «в вашем возрасте» — говорить «после сорока пяти процесс идёт иначе»',
  'Не говорить «вернём прежнюю фигуру» после родов — говорить «второе начало»',
  'Прогрев — это комфорт, а не лечение. Не называть аппараты лечебными',
  'Не обещать, что переедание пройдёт',
  'Не спорить с прошлым опытом и с «у меня гормоны» — признать и показать другой подход',
];
