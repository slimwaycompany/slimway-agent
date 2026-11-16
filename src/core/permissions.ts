export interface PermTab {
  key: string;
  label: string;
  hasSeeAll: boolean;
}

export interface PermBlock {
  key: string;    // matches shell tab name
  label: string;
  icon: string;
  tabs: PermTab[];
}

export const PERM_CATALOG: PermBlock[] = [
  {
    key: 'manager',
    label: 'Менеджер',
    icon: '👔',
    tabs: [{ key: 'tab:manager', label: 'Задачи и смены', hasSeeAll: true }],
  },
  {
    key: 'agent',
    label: 'Агент',
    icon: '🐕',
    tabs: [{ key: 'tab:agent', label: 'Агент (овчарка)', hasSeeAll: false }],
  },
  {
    key: 'schedule',
    label: 'Расписание',
    icon: '📅',
    tabs: [{ key: 'tab:schedule', label: 'Расписание', hasSeeAll: false }],
  },
  {
    key: 'clients',
    label: 'Клиенты',
    icon: '👥',
    tabs: [{ key: 'tab:clients', label: 'Клиенты', hasSeeAll: false }],
  },
  {
    key: 'funnel',
    label: 'Воронка',
    icon: '📈',
    tabs: [{ key: 'tab:funnel', label: 'Воронка', hasSeeAll: true }],
  },
  {
    key: 'cashier',
    label: 'Касса',
    icon: '💰',
    tabs: [
      { key: 'tab:cashier',       label: 'Касса (продажи)',        hasSeeAll: false },
      { key: 'cashier:refunds',   label: 'Возвраты',               hasSeeAll: false },
      { key: 'cashier:discounts', label: 'Скидки и смена цены',    hasSeeAll: false },
      { key: 'cashier:bonuses',   label: 'Бонусы',                 hasSeeAll: false },
    ],
  },
  {
    key: 'kviz',
    label: 'Квалификация',
    icon: '📝',
    tabs: [{ key: 'tab:kviz', label: 'Квалификация', hasSeeAll: false }],
  },
  {
    key: 'measure',
    label: 'Замеры',
    icon: '📏',
    tabs: [{ key: 'tab:measure', label: 'Замеры', hasSeeAll: false }],
  },
  {
    key: 'reports',
    label: 'Отчёты',
    icon: '📊',
    tabs: [
      { key: 'tab:reports', label: 'Отчёты',               hasSeeAll: false },
      { key: 'tab:control', label: 'Контроль менеджеров',   hasSeeAll: true },
    ],
  },
];

// Settings is admin-only and not in catalog.

export const DEFAULT_MANAGER_PERMISSIONS: Array<{ perm_key: string; level: 'view' | 'edit'; see_all: boolean }> = [
  { perm_key: 'tab:agent',   level: 'view', see_all: false },
  { perm_key: 'tab:kviz',    level: 'edit', see_all: false },
  { perm_key: 'tab:measure', level: 'edit', see_all: false },
  { perm_key: 'tab:cashier', level: 'edit', see_all: false },
  { perm_key: 'tab:manager', level: 'view', see_all: false },
];
