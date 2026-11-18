Модуль: ui

# Задача 68 (ред. 2): UI Foundation — шаг «а» (фундамент дизайн-системы)

## Часть 0 — Подготовка
Перезаписать этот файл второй редакцией ТЗ.
Прочитать docs/modules/ui.md целиком («Ключевые решения», «Открытые баги»).
Шаг «а» — фундамент, вид экранов не перерисовывать, оболочку не перестраивать (шаги «б» и «в»).
ПКМ-меню, cmdk, свайпы строк, горячие клавиши — шаги «б»/«в», не делать здесь.

## Часть 1 — Дизайн-инструменты и пакеты
Сергей уже установил:
- скиллы в .claude/skills/ и .agents/skills/: impeccable, ui-ux-pro-max, accessibility, best-practices, core-web-vitals, performance, web-quality-audit, web-design-guidelines
- Playwright MCP в .mcp.json
- пакеты в kviz/client: lucide-react, cmdk, @radix-ui/react-{context-menu,dropdown-menu,dialog,popover,tooltip,toast}

Закоммитить: .claude/skills/, .agents/skills/, skills-lock.json, .mcp.json, kviz/client/package.json, kviz/package-lock.json.
npm audit: 5 high (vite/picomatch, body-parser, qs, xlsx). Запустить `npm audit fix` (без --force) для безопасных исправлений. xlsx без исправления. Список в отчёт.
Настроить impeccable: PRODUCT.md и DESIGN.md в корне (источник правил — docs/modules/ui.md).

## Часть 2 — Единый файл токенов tokens.css
Создать public/ui/tokens.css.
Подключить <link rel="stylesheet" href="/ui/tokens.css"> в: shell.ts (LOGIN_HTML + SHELL_HTML), window.ts (HTML_TEMPLATE), kviz/client/index.html.
Добавить прокси /ui → localhost:3000 в kviz/client/vite.config.ts для dev-режима.
Удалить инлайн-переменные :root из shell.ts и window.ts (они теперь в tokens.css).

Цвета светлая тема (:root):
--bg #f2f4f7 | --surface #ffffff | --surface-2 #f7f8fa
--glass rgba(255,255,255,.72) | --glass-blur 16px | --glass-border rgba(255,255,255,0.4)
--border #e5e8ec
--text #0f172a | --text-2 #475569 | --text-3 #94a3b8
--primary #02BDB6 | --primary-hover #01a8a2 | --primary-soft #e0faf9 | --on-primary #fff | --accent #263CD9 | --accent-soft #eef0fd
--danger #dc2626 | --danger-soft #fef2f2 | --success #16a34a | --success-soft #f0fdf4
--warning #d97706 | --warning-soft #fffbeb | --info #2563eb | --info-soft #eff6ff
--chart-1..6: primary / accent / #f59e0b / #16a34a / #ef4444 / #8b5cf6

Цвета тёмная тема ([data-theme="dark"]):
--bg #0b0f14 | --surface #151a21 | --surface-2 #1c222b
--glass rgba(21,26,33,.72) | --glass-border rgba(255,255,255,0.08) | --border #2a313b
--text #e6e9ee | --text-2 #a7b0bd | --text-3 #6b7480
--primary #19cfc8 | --primary-soft rgba(2,189,182,.16) | --on-primary #04211f | --accent #6b7bff | --accent-soft rgba(38,60,217,.2)
--danger #f87171 | --danger-soft rgba(248,113,113,.14) | --success #4ade80 | --success-soft rgba(74,222,128,.14)
--warning #fbbf24 | --warning-soft rgba(251,191,36,.14) | --info #60a5fa | --info-soft rgba(96,165,250,.14)
--sh-1 и --sh-2 слабее (тени в тёмной теме)

Типографика: --font: 'Manrope', system-ui, sans-serif
Размеры: --fs-xs 12px (на ≤1024: 13px) | --fs-sm 14px | --fs-md 16px | --fs-lg 17px | --fs-title 20px | --fs-num 24px
Отступы: --sp-1..8 (4..32px)
Радиусы: --r-sm 8px | --r-md 12px | --r-lg 16px | --r-xl 20px | --r-full 999px
Тени: --sh-1 (лёгкая) | --sh-2 (панель/меню)
Движение: --dur-fast 120ms | --dur 200ms | --dur-slow 300ms | --ease cubic-bezier(.2,.8,.2,1)
prefers-reduced-motion: reduce → все длительности = 0
Высоты: --row 52px | --btn 44px | --btn-lg 48px | --header 56px

@media(max-width:640px): --glass-blur: 8px
@media print: светлый фон, чёрный текст

Алиасы старых переменных: --teal, --blue, --teal-light, --stop, --radius, --shadow, --brand, --red, --orange,
--c-bg, --c-text, --c-muted, --c-border, --card, --radius-panel, --radius-card → новые токены

## Часть 3 — Тема: светлая / тёмная / как в системе
По умолчанию «Как в системе» (prefers-color-scheme).
Inline-скрипт в <head> всех 4 HTML-файлов (нет FOUC): читает localStorage 'sw-theme', ставит data-theme на <html>.
Переключатель в меню пользователя (кружок с инициалом): Светлая / Тёмная / Как в системе.
При смене темы оболочка шлёт postMessage всем открытым iframe; iframe слушает и применяет data-theme.
meta theme-color: два тега с media="(prefers-color-scheme: …)"; при ручном выборе обновлять скриптом.
Всегда светлое: @media print, ТВ (/results, tv), картинки фигуры и InBody.
/r/:token (страница клиента) — следует системной теме.

## Часть 4 — Перевод цветов на токены
Цель: в тёмной теме нет белых пятен и нечитаемого текста.
Где: kviz/client/src/index.css, shell.ts (CSS), window.ts (CSS). public/*.js — нет цветов, пропустить.
Замены (см. полный список в тексте ТЗ):
#02BDB6 → var(--primary), #263CD9 → var(--accent)
#0f172a #111827 #1a202c #1a1a2e #374151 → var(--text)
#475569 #64748b #6b7280 → var(--text-2)
#94a3b8 #9ca3af #cbd5e1 → var(--text-3)
#e2e8f0 #e2e6ea #e5e7eb → var(--border)
#f1f5f9 #f8fafc #f7f8fc #eef2f7 → var(--surface-2) или var(--bg) по смыслу
#fff/#ffffff/white в background → var(--surface); на кнопке → var(--on-primary)
#ef4444 #dc2626 → var(--danger); фоны красного → var(--danger-soft)
#16a34a #22c55e → var(--success); фоны → var(--success-soft)
#f59e0b #d97706 → var(--warning); фоны → var(--warning-soft)
#2563eb #3b82f6 → var(--info); фоны → var(--info-soft)
Цвета recharts → var(--chart-N)
Не трогать: этапы воронки, теги, аппараты, ТВ-экран.
В отчёте: сколько hex-цветов было и осталось с причинами.

## Часть 5 — Шрифт, иконки, точки перелома, viewport
Manrope в kviz/client/src/index.css (вместо системного шрифта -apple-system).
Иконки: компонент Icon в components/ui/ на lucide-react (размеры 16/20/24, stroke 1.75, currentColor).
SVG-иконки Lucide для оболочки и Агента (non-React) — inline SVG в shell.ts, shell-app.js.
Одна карта «вкладка → иконка»: заменить эмодзи в shell.ts (вкладки, drawer, choice screen):
  Менеджер→clipboard-check, Агент→bell, Расписание→calendar, Клиенты→users,
  Воронка→filter, Касса→wallet, Квалификация→message-circle-question, Замеры→ruler,
  Отчёты→bar-chart-3, Настройки→settings.
Нормализовать breakpoints в index.css: только max-width:640px / 641-1024 / min-width:1025px.
Хук useBreakpoint() в kviz/client/src/lib/ (phone/tablet/desktop, те же границы).
Вместо innerWidth<480 в ReportsPage → useBreakpoint().
viewport-fit=cover: добавить в meta viewport в shell.ts, window.ts, kviz/client/index.html.

## Часть 6 — Служебные компоненты на Radix
Все в kviz/client/src/components/ui/. Поведение Radix, вид — токены, без Tailwind.

Modal — переделать на @radix-ui/react-dialog:
  фокус внутри, Esc и клик по фону закрывают; компьютер — по центру; телефон — лист снизу с safe-area.
  API для экранов не ломать.

Toast + useToast() на @radix-ui/react-toast:
  один провайдер в корне; виды success/error/info; компьютер — справа снизу, телефон — сверху;
  автозакрытие 3с (ошибка 5с); стопка; смахивание на телефоне.
  Заменить собственные тосты в ManagerPage и др.

ConfirmDialog + useConfirm() (через Modal/Dialog):
  возвращает Promise<boolean>; заголовок, текст, кнопки Отмена / действие;
  вариант danger (красная кнопка); фокус по умолчанию на Отмена.

PromptDialog — поле ввода + валидация (для prompt()).
Tooltip на @radix-ui/react-tooltip: для кнопок-иконок; на телефоне aria-label.

Заменить ВСЕ alert() / confirm() / prompt() в kviz/client/src (~18 мест: SettingsPage, ClientsPage, LeadDrawer):
  сообщения → тост; подтверждения удаления → ConfirmDialog.
  Проверка: grep -rn "alert(\|confirm(\|prompt(" kviz/client/src public пусто.

Для оболочки и /window (non-React): public/ui/ui.js — маленький тост и confirm на тех же токенах.

Состояния: Loading (спиннер inline/page) + Skeleton, EmptyState, ErrorState.
Текст «Загрузка…» (~16 файлов) → Loading/Skeleton; пустые таблицы → EmptyState; сырые ошибки → ErrorState.

Обновить ResponsiveTable, FilterBar, PageHeader на токены (цвета, радиусы, тени).
Панель «Фильтры (N)» на телефоне — через новый Modal (лист снизу).

## Часть 7 — Лёгкие анимации и стекло
CSS-классы на токенах --dur* / --ease:
  .animate-slide-in (лист снизу), .animate-fade-in (тост), .animate-scale-in (модалка).
  Transition :active на кнопках (scale .98).
  Смена вкладки — fade 120ms.
Стекло у шапки, боковой панели, листов, меню (--glass, --glass-blur).
prefers-reduced-motion: все анимации отключаются.

## Часть 8 — CLAUDE.md / AGENTS.md
Раздел «Интерфейс» дополнить правилами: tokens.css, темы, Lucide, Toast/Confirm, breakpoints, Playwright.
docs/modules/ui.md: таблица токенов + список компонентов со строкой «когда использовать».

## Часть 9 — Проверка, документация, коммит, пуш
npm run build без ошибок, npm run check:mobile чистый.
Размер сборки до/после.
Playwright MCP: все вкладки светлая/тёмная 375 и 1440.
web-design-guidelines: Modal, Toast, ConfirmDialog — клавиатура, фокус, Esc.
Печать — по-прежнему светлая; ТВ-экран не изменился.
Скриншоты в отчёт (оболочка с меню темы, Менеджер/Касса/Клиенты/Замеры/Отчёты/Настройки, тост/ConfirmDialog, Loading/EmptyState/ErrorState).
Обновить docs/modules/ui.md, docs/STATE.md, docs/QUEUE.md.

После каждой части: npm run build, npm run check:mobile, git add ., git commit, git pull --rebase, git push.
