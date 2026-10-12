export type AlertPh = {
  name?:   string;
  time?:   string;
  source?: string;
  left?:   number;
  visits?: string;
  task?:   string;
};

const POOL: Record<string, { title: string; bodies: string[] }> = {
  UNCONFIRMED_3H: {
    title: 'Запись не подтверждена',
    bodies: [
      '{name}: пробное занятие в {time} не подтверждено. Свяжитесь с клиентом для подтверждения.',
      'Запись {name} на пробное в {time} ожидает подтверждения. Рекомендуем позвонить.',
      'До пробного занятия {name} осталось менее 3 часов, запись пока не подтверждена.',
      'Пробное в {time}: {name} — подтверждение не получено. Уточните, состоится ли визит.',
      'Требуется подтверждение: {name}, пробное занятие в {time}.',
      'По записи {name} на {time} нет подтверждения. Свяжитесь, чтобы визит не сорвался.',
      'Напоминание: подтвердите пробное занятие {name} в {time}.',
      'Пробное занятие {name} в {time} пока без подтверждения. Рекомендуется связаться заранее.',
    ],
  },
  NO_SHOW_UNCONFIRMED: {
    title: 'Визит не состоялся',
    bodies: [
      '{name}: запись на {time} не была подтверждена, визит не отмечен. Свяжитесь с клиентом и предложите новое время.',
      'По записи {name} на {time} не было ни подтверждения, ни визита. Рекомендуем перезаписать.',
      'Визит {name} в {time} не состоялся, запись оставалась неподтверждённой.',
      'Занятие {name} в {time} прошло без визита; подтверждения по записи не было.',
      'Неподтверждённая запись {name} на {time}: визит не отмечен. Уточните планы клиента.',
      '{time}: {name} — запись без подтверждения, отметки визита нет. Требуется звонок.',
      'Запись {name} на {time} не подтверждалась, визит не отмечен. Предложите удобное время.',
      '{name}: визит в {time} не зафиксирован, запись не была подтверждена заранее.',
    ],
  },
  NO_SHOW_NO_MARK: {
    title: 'Нет отметки визита',
    bodies: [
      'Запись {name} на {time} была подтверждена, но визит не отмечен. Проверьте и отметьте в расписании.',
      'Визит {name} в {time} не отмечен в расписании. Если клиент был — поставьте отметку, если нет — свяжитесь.',
      'По подтверждённой записи {name} на {time} нет отметки визита.',
      '{time}: {name} — запись подтверждена, отметка о визите отсутствует. Уточните и отметьте.',
      'Проверьте визит {name} в {time}: запись подтверждена, статус в расписании не обновлён.',
      'Отметка визита отсутствует: {name}, {time}. Запись была подтверждена.',
      '{name}, занятие в {time}: требуется отметка «пришёл» или «не пришёл».',
      'Подтверждённая запись {name} на {time} осталась без отметки. Обновите статус в расписании.',
    ],
  },
  NO_SHOW_MARKED: {
    title: 'Неявка',
    bodies: [
      '{name} — неявка на занятие в {time}. Свяжитесь с клиентом, уточните причину и предложите новое время.',
      'Зафиксирована неявка: {name}, {time}. Рекомендуем позвонить и перезаписать.',
      'Занятие в {time} пропущено: {name}. Уточните причину.',
      'Неявка {name} на {time}. Важно связаться в течение дня.',
      '{time}: {name} — отмечена неявка. Предложите перенос на удобное время.',
      'По записи {name} на {time} отмечена неявка. Требуется звонок клиенту.',
      'Занятие {name} в {time} не посещено. Уточните причину и договоритесь о новом визите.',
      'Неявка зафиксирована: {name}, {time}. Свяжитесь, пока интерес к занятиям сохраняется.',
    ],
  },
  NEW_LEAD: {
    title: 'Новая заявка',
    bodies: [
      'Новая заявка: {name}, источник — {source}. Возьмите в работу.',
      'Поступила заявка от {name} ({source}). Свяжитесь в ближайшее время.',
      '{source}: новая заявка — {name}. Чем быстрее контакт, тем выше шанс записи.',
      'Новый клиент в воронке: {name}, {source}. Требуется первый контакт.',
      'Заявка от {name} через {source}. Назначьте ответственного и свяжитесь.',
      'Входящая заявка: {name} ({source}). Ожидает обработки.',
      'Новое обращение: {name}, канал — {source}. Рекомендуется связаться в течение 5 минут.',
      'В «Новые заявки» поступила карточка {name} ({source}). Возьмите в работу.',
    ],
  },
  NEW_LEAD_NO_TASK: {
    title: 'Заявка без ответа',
    bodies: [
      'Заявка {name} ({source}) 5 минут без ответа. Возьмите в работу и поставьте задачу.',
      '{name}: заявка ожидает обработки уже 5 минут.',
      'По заявке {name} пока нет задачи. Пожалуйста, свяжитесь с клиентом.',
      'Заявка {name} остаётся без ответственного. Требуется срочный контакт.',
      'Прошло 5 минут: заявка {name} ({source}) не обработана.',
      'Клиент {name} ждёт ответа. По заявке не поставлена задача.',
      'Необработанная заявка: {name}. Возьмите её в работу.',
      '{name} ({source}) — заявка без задачи более 5 минут. Не теряйте контакт.',
    ],
  },
  CONTRACT_ENDING: {
    title: 'Заканчивается абонемент',
    bodies: [
      'У {name} осталось {left} {visits}. Предложите продление абонемента.',
      'Абонемент {name} подходит к концу: {left} {visits}. Самое время обсудить продление.',
      '{name}: в абонементе осталось {left} {visits}. Рекомендуем предложить следующий курс.',
      'Остаток по абонементу {name} — {left} {visits}. Подготовьте предложение о продлении.',
      '{name} завершает курс: {left} {visits} до окончания абонемента.',
      'Скоро закончится абонемент {name} ({left} {visits}). Обсудите продолжение занятий.',
      'На следующем визите предложите {name} продление: осталось {left} {visits}.',
      '{name} — финальные занятия по абонементу ({left} {visits}). Уточните планы на продолжение.',
    ],
  },
  CONTRACT_ENDED: {
    title: 'Абонемент закончился',
    bodies: [
      'Абонемент {name} закончился. Свяжитесь и предложите продление.',
      'Курс {name} завершён, активных абонементов нет. Предложите продолжить занятия.',
      'У {name} не осталось занятий по абонементу. Рекомендуем связаться.',
      'Абонемент {name} исчерпан. Обсудите с клиентом следующий курс.',
      '{name}: абонемент завершён, новая покупка не оформлена. Требуется звонок.',
      'Занятия по абонементу {name} закончились. Пригласите продолжить курс.',
      'Окончание абонемента: {name}. Предложите продление, пока сохраняется мотивация.',
      'У {name} нет активного абонемента. Свяжитесь и уточните планы.',
    ],
  },
};

const AGENT_TASK_BODIES = [
  ' Агент уже поставил задачу «{task}».',
  ' Задача «{task}» уже создана агентом.',
  ' В карточке уже есть задача «{task}» от агента.',
  ' Агент добавил задачу «{task}» — выполните её.',
];

// Per-rule round-robin index, persists in process memory across calls
const lastIdxByRule = new Map<string, number>();

function fill(tpl: string, ph: AlertPh): string {
  return tpl
    .replace(/\{name\}/g,   ph.name   ?? '')
    .replace(/\{time\}/g,   ph.time   ?? '')
    .replace(/\{source\}/g, ph.source ?? '')
    .replace(/\{left\}/g,   ph.left   != null ? String(ph.left) : '')
    .replace(/\{visits\}/g, ph.visits ?? '')
    .replace(/\{task\}/g,   ph.task   ?? '');
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) - h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getTitle(rule: string): string {
  return POOL[rule]?.title ?? rule;
}

// Pick a body template for a NEW alert.
// Uses round-robin in process memory; falls back to hash(alertKey) after restart.
export function pickBody(rule: string, alertKey: string, ph: AlertPh): string {
  const pool = POOL[rule];
  if (!pool) return ph.name ?? '';
  const bodies = pool.bodies;
  const last   = lastIdxByRule.get(rule);
  const idx    = last != null ? (last + 1) % bodies.length : simpleHash(alertKey) % bodies.length;
  lastIdxByRule.set(rule, idx);
  return fill(bodies[idx], ph);
}

// Append the agent-task note to an existing body string.
export function appendAgentTask(body: string, taskCategory: string): string {
  const last = lastIdxByRule.get('AGENT_TASK');
  const idx  = last != null ? (last + 1) % AGENT_TASK_BODIES.length : simpleHash(taskCategory) % AGENT_TASK_BODIES.length;
  lastIdxByRule.set('AGENT_TASK', idx);
  return body + fill(AGENT_TASK_BODIES[idx], { task: taskCategory });
}

// True if body already contains an agent task note (all pool items contain «агент»)
export function hasAgentTaskNote(body: string): boolean {
  return /агент/i.test(body);
}
