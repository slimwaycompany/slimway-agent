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
- Отдельный сервис мониторинга («жив ли агент и CRM», чтобы работал даже если основной упал).
- Окно сотрудников (логины, пароли, данные) — вместе с CRM.
