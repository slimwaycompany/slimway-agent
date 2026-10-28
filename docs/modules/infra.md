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

## Сделано
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
