import { KVIZ_TAB_VISIBLE } from './featureFlags';

export type PermLevel = 'view' | 'edit';
export interface PermEntry { level: PermLevel; see_all: boolean }

export type PermRowKind = 'row' | 'action';
export interface PermRow {
  key: string;
  label: string;
  kind: PermRowKind;
  hasSeeAll?: boolean;
  parent?: string; // action parent row key
}
export interface PermBlock { key: string; label: string; icon: string; rows: PermRow[] }

export const PERM_CATALOG: PermBlock[] = [
  {
    key: 'manager', label: 'Менеджер', icon: '👔',
    rows: [
      { key: 'manager.tasks',        label: 'Задачи',           kind: 'row', hasSeeAll: true },
      { key: 'manager.shift',        label: 'Отметка на смене', kind: 'row' },
      { key: 'manager.cash_closing', label: 'Закрытие смены',   kind: 'row' },
      { key: 'manager.templates',    label: 'Шаблоны задач',    kind: 'row' },
    ],
  },
  {
    key: 'agent', label: 'Агент', icon: '🐕',
    rows: [
      { key: 'agent.window', label: 'Овчарка', kind: 'row' },
    ],
  },
  {
    key: 'schedule', label: 'Расписание', icon: '📅',
    rows: [
      { key: 'schedule.main',   label: 'Расписание',              kind: 'row' },
      { key: 'schedule.book',   label: 'Записывать и переносить', kind: 'action', parent: 'schedule.main' },
      { key: 'schedule.attend', label: 'Отмечать «Пришёл»',      kind: 'action', parent: 'schedule.main' },
    ],
  },
  {
    key: 'clients', label: 'Клиенты', icon: '👥',
    rows: [
      { key: 'clients.list',      label: 'Список и анкета',       kind: 'row' },
      { key: 'clients.phone',     label: 'Видит телефон',         kind: 'action', parent: 'clients.list' },
      { key: 'clients.documents', label: 'Видит ИИН и документы', kind: 'action', parent: 'clients.list' },
      { key: 'clients.export',    label: 'Выгрузка в Excel',      kind: 'action', parent: 'clients.list' },
      { key: 'clients.delete',    label: 'Удаление клиента',      kind: 'action', parent: 'clients.list' },
      { key: 'clients.plans',     label: 'Абонементы клиента',    kind: 'row' },
      { key: 'clients.sales',     label: 'Продажи клиента',       kind: 'row' },
      { key: 'clients.import',    label: 'Импорт из Fitbase',     kind: 'row' },
    ],
  },
  {
    key: 'funnel', label: 'Воронка', icon: '📈',
    rows: [
      { key: 'funnel.leads', label: 'Заявки', kind: 'row', hasSeeAll: true },
    ],
  },
  {
    key: 'kassa', label: 'Касса', icon: '💰',
    rows: [
      { key: 'kassa.sale',      label: 'Продажи',             kind: 'row' },
      { key: 'kassa.shift',     label: 'Смена',               kind: 'row' },
      { key: 'kassa.refunds',   label: 'Возвраты',            kind: 'row' },
      { key: 'kassa.discounts', label: 'Скидки и смена цены', kind: 'row' },
      { key: 'kassa.bonus',     label: 'Бонусы',              kind: 'row' },
    ],
  },
  {
    key: 'measure', label: 'Замеры', icon: '📏',
    rows: [
      { key: 'measure.new',          label: 'Новый замер',      kind: 'row' },
      { key: 'measure.delete',       label: 'Удалять замер',    kind: 'action', parent: 'measure.new' },
      { key: 'measure.inbody_import', label: 'Импорт InBody',   kind: 'row' },
      { key: 'measure.client',       label: 'Карточка клиента', kind: 'row' },
    ],
  },
  {
    key: 'reports', label: 'Отчёты', icon: '📊',
    rows: [
      { key: 'reports.tasks',         label: 'Задачи',                   kind: 'row', hasSeeAll: true },
      { key: 'reports.shifts',        label: 'Смены',                    kind: 'row', hasSeeAll: true },
      { key: 'reports.control',            label: 'Контроль 5п',              kind: 'row', hasSeeAll: true },
      { key: 'reports.control_cc',         label: 'Контроль call center',     kind: 'row', hasSeeAll: true },
      { key: 'reports.control_consultant', label: 'Контроль консультант',     kind: 'row', hasSeeAll: true },
      { key: 'reports.sales',         label: 'Отчёт по продажам',        kind: 'row' },
      { key: 'reports.renewals',      label: 'Продления',                kind: 'row' },
      { key: 'reports.payroll',       label: 'Зарплата',                 kind: 'row' },
      { key: 'reports.tbu',           label: 'ТБУ',                      kind: 'row' },
      { key: 'reports.measures',      label: 'Отчёт по замерам тела',    kind: 'row' },
      { key: 'reports.inbody',        label: 'Отчёт по InBody',          kind: 'row' },
      { key: 'reports.studio',        label: 'Результаты студии',         kind: 'row' },
      { key: 'reports.occupancy',     label: 'Занятия и загруженность',  kind: 'row' },
      { key: 'reports.fact_day',      label: 'Факт дня',                 kind: 'row' },
      { key: 'reports.day_rhythm',    label: 'Дневной такт',             kind: 'row' },
      { key: 'reports.daily_metrics', label: 'Метрики по дням',          kind: 'row' },
    ],
  },
  ...(KVIZ_TAB_VISIBLE ? [{
    key: 'kviz', label: 'Квалификация', icon: '📝',
    rows: [
      { key: 'kviz.new',     label: 'Новая квалификация', kind: 'row' as const },
      { key: 'kviz.history', label: 'История',            kind: 'row' as const, hasSeeAll: true },
    ],
  }] : []),
  {
    key: 'settings', label: 'Настройки', icon: '⚙️',
    rows: [
      { key: 'settings.staff',        label: 'Сотрудники',          kind: 'row' },
      { key: 'settings.devices',      label: 'Аппараты',            kind: 'row' },
      { key: 'settings.abonements',   label: 'Абонементы',          kind: 'row' },
      { key: 'settings.services',     label: 'Услуги',              kind: 'row' },
      { key: 'settings.products',     label: 'Товары и склад',      kind: 'row' },
      { key: 'settings.suppliers',    label: 'Поставщики',          kind: 'row' },
      { key: 'settings.promos',       label: 'Промокоды',           kind: 'row' },
      { key: 'settings.payments',     label: 'Виды оплаты',         kind: 'row' },
      { key: 'settings.sources',      label: 'Рекламные источники', kind: 'row' },
      { key: 'settings.classes',      label: 'Занятия',             kind: 'row' },
      { key: 'settings.branch',       label: 'Филиал',              kind: 'row' },
      { key: 'settings.service',      label: 'Сервис',              kind: 'row' },
      { key: 'settings.finance',      label: 'Финансы',             kind: 'row' },
      { key: 'settings.funnels',      label: 'Воронки CRM',         kind: 'row' },
      { key: 'settings.lead_tags',    label: 'Теги заявок',         kind: 'row' },
      { key: 'settings.task_types',   label: 'Типы задач',          kind: 'row' },
      { key: 'settings.lost_reasons', label: 'Причины отказа',      kind: 'row' },
      { key: 'settings.fb_users',     label: 'Сопоставление FB',    kind: 'row' },
      { key: 'settings.scriptolog',   label: 'Скриптолог',          kind: 'row' },
      { key: 'settings.control',          label: 'Контроль менеджеров',       kind: 'row' },
      { key: 'settings.control_schedule', label: 'График смен',               kind: 'row' },
      { key: 'settings.control_devices',  label: 'Доверенные компьютеры',     kind: 'row' },
      { key: 'settings.pbx',              label: 'АТС',                       kind: 'row' },
      { key: 'control.review',            label: 'Проверки ОКК',              kind: 'action', parent: 'settings.control' },
      { key: 'settings.tv',           label: 'ТВ-экран',            kind: 'row' },
    ],
  },
];

// Shell tab name → PERM_CATALOG block key (cashier tab → kassa block)
export const TAB_BLOCK: Record<string, string> = {
  manager:  'manager',
  agent:    'agent',
  schedule: 'schedule',
  clients:  'clients',
  funnel:   'funnel',
  cashier:  'kassa',
  kviz:     'kviz',
  measure:  'measure',
  reports:  'reports',
  settings: 'settings',
};

export type PresetPerm = { perm_key: string; level: 'view' | 'edit'; see_all: boolean };

function e(k: string, sa = false): PresetPerm { return { perm_key: k, level: 'edit', see_all: sa }; }
function v(k: string, sa = false): PresetPerm { return { perm_key: k, level: 'view', see_all: sa }; }

export const POSITION_PRESETS: Record<string, PresetPerm[]> = {
  hall_admin: [
    e('manager.tasks'), e('manager.shift'), e('manager.cash_closing'),
    e('schedule.main'), e('schedule.book'), e('schedule.attend'),
    e('clients.list'), e('clients.phone'), e('clients.plans'), e('clients.sales'),
    e('funnel.leads'), e('kassa.sale'), e('kassa.shift'),
    e('kviz.new'), e('kviz.history'), e('measure.new'), e('measure.inbody_import'), e('measure.client'),
    v('agent.window'),
    v('reports.tasks'), v('reports.shifts'), v('reports.measures'), v('reports.inbody'), v('reports.studio'),
  ],
  trainer: [
    e('manager.tasks'), e('manager.shift'),
  ],
  cleaner: [
    e('manager.tasks'), e('manager.shift'),
  ],
  accountant: [
    e('manager.tasks'), e('manager.shift'), e('settings.finance'), e('settings.payments'),
    v('kassa.sale'), v('kassa.shift'), v('kassa.refunds'),
    v('reports.sales'), v('reports.renewals'), v('reports.payroll'), v('reports.tbu'),
    v('reports.shifts', true),
    v('settings.suppliers'), v('settings.products'),
  ],
  qa: [
    e('manager.tasks'), e('manager.shift'), e('reports.control', true),
    v('reports.tasks', true), v('reports.shifts', true), v('funnel.leads', true), v('kviz.history', true),
    v('clients.list'), e('clients.phone'),
    v('settings.scriptolog'), v('settings.control'),
  ],
  okk: [
    e('manager.tasks'), e('manager.shift'),
    v('reports.control', true), v('reports.control_cc', true), v('reports.control_consultant', true),
    v('reports.shifts', true), v('reports.tasks', true),
    e('control.review'),
    v('settings.control_schedule'),
  ],
  branch_manager: [
    e('manager.tasks', true), e('manager.shift'), e('manager.cash_closing'), e('manager.templates'),
    e('schedule.main'), e('schedule.book'), e('schedule.attend'),
    e('clients.list'), e('clients.phone'), e('clients.documents'), e('clients.export'),
    e('clients.plans'), e('clients.sales'), e('clients.import'),
    e('funnel.leads', true),
    e('kassa.sale'), e('kassa.shift'), e('kassa.refunds'), e('kassa.discounts'), e('kassa.bonus'),
    e('kviz.new'), e('kviz.history', true),
    e('measure.new'), e('measure.delete'), e('measure.inbody_import'), e('measure.client'),
    v('agent.window'),
    v('reports.tasks', true), v('reports.shifts', true), v('reports.control', true),
    v('reports.sales'), v('reports.renewals'), v('reports.payroll'), v('reports.tbu'),
    v('reports.measures'), v('reports.inbody'), v('reports.studio'), v('reports.occupancy'),
    v('reports.fact_day'), v('reports.day_rhythm'), v('reports.daily_metrics'),
    e('settings.devices'), e('settings.abonements'), e('settings.services'),
    e('settings.products'), e('settings.promos'), e('settings.classes'), e('settings.branch'), e('settings.tv'),
  ],
  company_manager: [
    v('manager.tasks', true), v('manager.shift'), v('manager.cash_closing'), v('manager.templates'),
    v('agent.window'),
    v('schedule.main'), v('schedule.book'), v('schedule.attend'),
    v('clients.list'), v('clients.phone'), v('clients.documents'), v('clients.export'),
    v('clients.plans'), v('clients.sales'), v('clients.import'),
    v('funnel.leads', true),
    v('kassa.sale'), v('kassa.shift'), v('kassa.refunds'), v('kassa.discounts'), v('kassa.bonus'),
    v('kviz.new'), v('kviz.history', true),
    v('measure.new'), v('measure.delete'), v('measure.inbody_import'), v('measure.client'),
    v('reports.tasks', true), v('reports.shifts', true), e('reports.control', true),
    v('reports.sales'), v('reports.renewals'), v('reports.payroll'), v('reports.tbu'),
    v('reports.measures'), v('reports.inbody'), v('reports.studio'), v('reports.occupancy'),
    v('reports.fact_day'), v('reports.day_rhythm'), v('reports.daily_metrics'),
    e('settings.devices'), e('settings.abonements'), e('settings.services'),
    e('settings.products'), e('settings.suppliers'), e('settings.promos'), e('settings.payments'),
    e('settings.sources'), e('settings.classes'), e('settings.branch'), e('settings.service'), e('settings.finance'),
    e('settings.funnels'), e('settings.lead_tags'), e('settings.task_types'), e('settings.lost_reasons'),
    e('settings.fb_users'), e('settings.scriptolog'), e('settings.control'), e('settings.tv'),
  ],
};
