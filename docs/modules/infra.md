# Модуль: Инфраструктура, вход, оболочка

Чат в claude.ai: «Агент и овчарка» · Файл: `docs/modules/infra.md`

## Назначение
Сервер, деплой, cron, вход сотрудников и оболочка рабочего окна (вкладки, боковые кнопки).

## Где код
- `src/index.ts` — точка входа: все `/run/*` и `/health`, подключение middleware и роутеров
- `src/http/auth.ts` — `makeToken`, `getSession`, `requireAuth`, rate limiter (10 попыток / 15 мин), cookie `swtoken`, Bearer-токен для расширения
- `src/http/shell.ts` — `/` (оболочка), `/login`, `/kviz/api/me`, `/kviz/api/logout`; рендер HTML пэйнов с 10 вкладками; инъекция Настроек (admin only)
- `public/shell-app.js` — клиентский JS оболочки: `showTab`, боковые кнопки, badge'и, повторный клик по активной вкладке = домой
- `src/db/supabase.ts` — клиент Supabase (`service_role`)
- `src/core/` — helpers: `alertError`, `shortName`, `almatyNow`, `isInWorkWindow`, `isInWatchWindow`
- `kviz/client/src/App.tsx` — React роутинг всех вкладок; `RequireAuth` wrapper
- `kviz/client/src/utils/iframe.ts` — `isEmbedded`, `postToParent`

## Таблицы
- `app_users` — сотрудники, `display_name`, роль `admin` / `manager`; пароль проверяет `app_check_login` (PostgreSQL function)
- `job_runs`, `job_locks` — запуски и блокировки задач

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Render free (512 МБ), автодеплой из `main`; cron-job.org будит и запускает задачи. Часовой пояс Asia/Yekaterinburg (UTC+5).
- Cron: `/health` 7:25, 7:35, 7:45, 7:55; trial каждые 5 мин 8–22; budget в 8,10,…,22; daily-summary 22:25 будни / 20:55 выходные.
- Cookie `swtoken`: HMAC-SHA256 (ключ `WINDOW_SECRET || CRON_SECRET`), 30 дней, HttpOnly, Secure, SameSite=Lax. Bearer — для iframe расширения.
- Экран выбора — только сразу после входа; при перезагрузке — та же вкладка (localStorage `sw_tab`).
- 10 вкладок (28.10): Менеджер → Агент → Расписание → Клиенты → Воронка → Касса → Квалификация → Замеры → Отчёты → Настройки (только admin). Боковые кнопки по этому порядку.
- Повторный клик по активной вкладке = возврат на начальный экран.
- `/api/*` без входа → 401 JSON, никогда не редирект. Прямой заход на `/window`, `/kviz/*` → редирект на `/`.
- Батник `slimway_start.bat` у Сергея открывает Chrome с рабочими вкладками.

## Мобильная версия
Задача 34 (04.11.2026):
- **Оболочка (`shell.ts`, `shell-app.js`)**: логин-карточка `width:min(320px,100%)`, input `font-size:16px`, вкладки с `overflow-x:auto` + `scrollIntoView` при переключении, боковые кнопки скрыты на ≤1023px, аватар-меню пользователя на мобиле.
- **Общие UI-компоненты** (`kviz/client/src/components/ui/`): `Modal` (bottom sheet ≤640px), `ResponsiveTable` (cards на телефоне / table на десктопе), `FilterBar` (кнопка + нижняя панель на телефоне), `PageHeader` (flex-column на телефоне).
- **Брейкпоинты**: ≤640px — телефон, 641–1024px — планшет, >1024px — десктоп; объявлены в `index.css`.
- CSS для safe-area insets, `100dvh`, `font-size:16px` на input.

## Сделано
### 27.11.2026 · task 111 · SSE realtime: liveBus, /kviz/api/live, relay в shell-app.js

**`src/core/liveBus.ts`** (новый): `EventEmitter` с `setMaxListeners(300)`, функция `emitLive({topic, id?, action?, by?})`.

**`src/http/kviz.ts`**:
- `GET /kviz/api/live` (SSE, auth required): `text/event-stream`, ping каждые 25 сек, `retry: 3000`, лимит 5 потоков на сессию (429). Подписывается на `liveBus` → пишет `event: live\ndata: {...}\n\n`. Cleanup по `req.on('close')`.
- Post-mutation middleware: после каждого успешного POST/PUT/PATCH/DELETE по URL-паттерну вычисляет топик (`topicFromPath`) и вызывает `emitLive`. Топики: `leads`, `funnels`, `lead_tasks`, `schedule`, `clients`, `kassa`, `plans`, `measure`, `settings`.

**`public/shell-app.js`**: `EventSource('/kviz/api/live')` → relay каждого события (`event: live`) в `postMessage({type:'live', topic, ...})` всем iframe.frame. Visibility change: если вкладка была скрыта >60 сек — при возврате рассылает `{type:'live', topic:'*'}` всем iframe для форс-обновления.

**`kviz/client/src/lib/live.ts`** (новый): `useLive(topics, onChange)` — слушает `window.addEventListener('message')`, фильтрует по topic-set, дебаунс 400 мс.

### 19.11.2026 · 957ffa7 · task 71 — меню кружка поверх iframe, закрытие по blur

- `src/http/shell.ts`: `#top-bar` → `position:relative;z-index:10` (корень проблемы: `backdrop-filter` создавал stacking context с `z-index:auto=0`; `#panes` шёл позже в DOM на том же уровне и его iframe-ы перекрывали `.ua-menu`; теперь `#top-bar` z=10 > `#panes` z=auto). `/api/logout`: четыре заголовка `Set-Cookie` — `Path=/` (Secure + plain), `Path=/window`, `Path=/kviz` — гарантированная очистка при любом браузере.
- `public/shell-app.js`: `uaMenu.addEventListener('click', stopPropagation)` — клик по кнопкам темы внутри меню не закрывает его; `window.addEventListener('blur', closeMenu)` — клик в любой iframe закрывает меню (iframe не передаёт события в родительский document).

### 19.11.2026 · f7d896f · task 70 — фикс TypeError #logout-btn, кружок профиля, Выйти

- `public/shell-app.js`: убран мёртвый блок `$('logout-btn').onclick` (строка 362) — элемента `#logout-btn` нет с задачи 68, TypeError крашил весь скрипт ниже (drawer, Alt+1–0, ua-btn click, тема, восстановление вкладки). Убран стейл-блок `logoutBtnEl` для инициала (инициал уже в HTML). Добавлен обработчик `type:'logout'` в postMessage (→ `/login`). Esc закрывает и меню кружка.
- `src/http/shell.ts`: `z-index:50` на `.ua-wrap` — поверх полосы вкладок.

### 04.11.2026 · b8b36a6 · task 35 — гамбургер-drawer, 2-кол выбор, PWA

- `shell.ts`: `#ham-btn` + `#tab-label` в `#top-bar`; drawer (`#drawer`, `#drawer-backdrop`) со списком вкладок; `.choice-greeting` на мобиле. CSS: drawer slide-in, backdrop blur, ≤1024px скрыть `.tabs`, показать `#ham-btn`.
- `shell-app.js`: `openDrawer/closeDrawer`, `buildDrawer` (динамически из pane-id), swipe-to-close, Esc-to-close, `updateDrawerState` (активный item + tab label), `updateDrawerBadges` (ham-dot).
- Part 2: `choice-greeting` = «Привет, name 👋» (JS из ua-menu); 2-кол grid на ≤640px вместо одной колонки.
- Part 6 (PWA): `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `<link rel="manifest">` + apple-touch-icon в shell.ts. `express.static('/public')` в index.ts (без serviceWorker).

### 04.11.2026 · 8120059 · task 34 part 3 — мобильная вёрстка всех экранов
- `index.css`: CSS-классы для KassaPage, ReportsPage, CashClosing, SettingsPage, ClientsPage, ClientForm.
- `KassaPage.tsx`: ShiftOpen sidebar + SaleScreen right panel стекаются вертикально; submit sticky.
- `ReportsPage.tsx`: board columns стекаются вертикально.
- `CashClosing.tsx`: Row label min-width, bill-grid 1 колонка.
- `SettingsPage.tsx`: sidebar скрывается на мобиле, ← Назад в заголовке.
- `ClientsPage.tsx`: список скрывается при открытом клиенте, ← Список; `ClientForm` grid 1 колонка.

### 04.11.2026 · (task 33) · allow="camera" для iframe вкладок /kviz/*
- `public/shell-app.js`: `allow` у всех трёх мест создания /kviz/-iframe обновлён с `"clipboard-write"` на `"camera; clipboard-write"` — `lazyIframe()`, inline Замеры, inline Отчёты. Iframe агента (`/window`) не трогали (у него другой allow).

### 28.10.2026 · 9574ebf · 10 вкладок + боковые кнопки
- `shell-app.js` и `shell.ts` полностью переписаны под 10 вкладок с полным набором боковых кнопок.

### до 28.10.2026 · 20f59e9 · личные логины
- Вход по личным логинам, экран выбора, cookie-сессия.

### до 28.10.2026 · adc8810 · оболочка с вкладками
- Базовая оболочка: iframe-вкладки, боковые кнопки, badge'и Агент/Менеджер.

### до 28.10.2026 · 5ef230a · базовая инфраструктура
- Сервер, Supabase, cron, `job_runs` / `job_locks`, `/health`.

## Открытые баги
- **48 ошибок `tsc --noEmit`** в несвязанных модулях (выявлено хотфикс 89b-1, 24.11.2026): `App.tsx`, `kviz/client/src/components/tv/` (ImageBox, TvBackground, TvScreen, TvScreenEditor, tvScreenLayout.ts), `src/pages/ResultsPage.tsx`, `SummaryPage.tsx`, `src/pages/crm/FunnelPage.tsx`, `StagePopup.tsx`, `src/pages/manager/ManagerPage.tsx`, `src/pages/crm/ClientPage.tsx` (если есть), `src/pages/measure/NewMeasurePage.tsx`, `src/pages/reports/ReportsPage.tsx`, `src/utils/inbody.ts`, `parseLookinBodyCSV.ts`. Не добавлять `tsc --noEmit` в `npm run build` — слишком много, в чужих модулях. Чинить по одному при работе с соответствующим модулем.

## Следующее
- Планшет 768–1024: гамбургер или вкладки сверху — не решено.
- Нижняя панель быстрого доступа (4 вкладки + «Ещё») — не реализована.
- Свайп между вкладками — не реализован.
- FAB-кнопка «главное действие» (+ Замер / + Продажа / Закрыть смену) — не реализована.
- Отдельный сервис мониторинга («жив ли агент и CRM», чтобы работал даже если основной упал).
- Окно сотрудников (логины, пароли, данные) — вместе с CRM.

## Переезд с Fitbase (решения 21.11.2026)
- Переезд полностью на свою CRM — за 36 часов (одно окно переключения).
- Чаты (WhatsApp, Telegram, Instagram, TikTok) — открытый вопрос, Сергей думает.
- Render и Supabase — платные тарифы оплачиваются сразу, до переезда.
- Все синхронизации с Fitbase переключаются на свою CRM (агент воронки, Скриптолог, лиды TikTok, отметки и т.д.).
- Каждый модуль готовится к переезду поэтапно; затем общая миграция.

### Модули для переезда (записано 21.11.2026, ждём Сергея)
Порядок по зависимостям, решения по чатам и импорту истории ещё не приняты.
1. CRM: клиенты и касса — продажи, возвраты, внесения пишутся в `crm_*` (`crm-kassa.md`, статус 🟡).
2. CRM: лиды и воронка — правила агента в `crm_lead_rules` включить, `leads.fitbase_sync_enabled` выключить (`crm-leads.md`).
3. CRM: расписание — записи, визиты, пробные (`crm-schedule.md`, статус ⚪).
4. Агент воронки и бюджет — `trial.ts`, `budget.ts`, `inactive.ts`, `newLeads.ts`, `lifecyclePlan.ts` (`agent.md`).
5. Скриптолог — напоминания и подтверждения пробных (`scriptolog.md`).
6. Овчарка и контроль — `watch.ts`, `watchBrief.ts`, `control*.ts` (`ovcharka.md`, `control.md`).
7. Чаты — EasyChat внутри Fitbase, API нет (`chats.md`). Блокер.
8. TikTok-лиды — поток Apps Script → Fitbase перенаправить в CRM (`tiktok.md`).
9. Отчёты и метрики — `metrics.ts`, `reports.md` перевести на `crm_*`.
10. Аналитика, кассиры, зарплата — Google-таблица, `payroll.ts`, `fin.ts`.
11. АТС OnlinePBX — `pbx.ts` перевязать на CRM (`slimway-pbx`).
12. Инфраструктура — выключить Fitbase-джобы, платный Render (`infra.md`).

Открытые вопросы:
- Чаты: переносим всё, кроме чатов, и оставляем чаты на переходный период?
- История: переносим операции и визиты из Fitbase (импорт клиентов уже есть, `runFitbaseImport`)?
