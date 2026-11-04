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
- (нет — боковые кнопки исправлены в 9574ebf)

## Следующее
- Планшет 768–1024: гамбургер или вкладки сверху — не решено.
- Нижняя панель быстрого доступа (4 вкладки + «Ещё») — не реализована.
- Свайп между вкладками — не реализован.
- FAB-кнопка «главное действие» (+ Замер / + Продажа / Закрыть смену) — не реализована.
- Отдельный сервис мониторинга («жив ли агент и CRM», чтобы работал даже если основной упал).
- Окно сотрудников (логины, пароли, данные) — вместе с CRM.
