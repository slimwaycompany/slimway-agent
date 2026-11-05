Модуль: crm-leads

# CRM Воронка — шаг 2. Синхронизация с Fitbase, доска drag & drop, карточка заявки, Настройки воронки, задачи в «Менеджере»

## SQL

Выполнен 05.11.2026 (см. docs/modules/crm-leads.md «Таблицы»).

## Часть 1 — Джоб синхронизации

Файл: `src/jobs/crmLeadsSync.ts`

- `runCrmLeadsSync()`: шаги syncFunnels → syncLeads → syncTasks
- Воронки+этапы: `GET /purchase-funnel`, `/purchase-funnel-step`, upsert в crm_funnels, crm_funnel_stages
- Лиды: `GET /lead` (paginated), upsert в crm_leads по fitbase_id; Fitbase=мастер; не трогаем is_archived/lost_reason_id/lost_comment
- Задачи: `GET /task` (paginated), upsert в crm_lead_tasks по fitbase_id
- Маппинг: stage→crm_funnel_stages.fitbase_id; ad_source→crm_ad_sources.fitbase_id; manager→crm_fitbase_user_map; client→crm_clients.fitbase_client_id
- Системные этапы (0, −1, −2) без воронки: берём funnel_id из прошлой синхронизации; если неизвестна — оставляем null

Эндпоинт `/run/crm-leads-sync` (CRON_SECRET, GET/POST):
- Лок 5 мин, fire-and-forget, 202 Accepted
- Добавить в cron-job.org каждые 5 минут

Ручной запуск:
- `POST /kviz/api/crm/leads-sync` — старт (сессия обязательна)
- `GET /kviz/api/crm/leads-sync` — статус (in-memory)

## Часть 2 — API

Файл: `src/http/crmLeads.ts`, монтировать в `src/http/kviz.ts`

- `GET /kviz/api/crm/funnels` — воронки + этапы (вложенные)
- `GET /kviz/api/crm/leads?funnel_id&stage_id&search&is_archived` — список (до 1000)
- `POST /kviz/api/crm/leads` — создать вручную (origin=manual)
- `GET /kviz/api/crm/leads/:id` — деталь
- `PATCH /kviz/api/crm/leads/:id` — обновить (этап, поля)
- `DELETE /kviz/api/crm/leads/:id` — удалить (admin)
- `GET /kviz/api/crm/lead-tasks?lead_id&today` — задачи
- `POST /kviz/api/crm/lead-tasks` — создать задачу
- `PATCH /kviz/api/crm/lead-tasks/:id` — обновить задачу
- `DELETE /kviz/api/crm/lead-tasks/:id` — удалить задачу
- `GET /kviz/api/crm/leads/:id/activity` — лента
- `POST /kviz/api/crm/leads/:id/activity` — добавить комментарий
- CRUD /kviz/api/crm/lead-tags (admin для POST/PATCH/DELETE)
- CRUD /kviz/api/crm/task-types (admin для POST/PATCH/DELETE)
- CRUD /kviz/api/crm/lost-reasons (admin для POST/PATCH/DELETE)
- GET /kviz/api/crm/fitbase-users (admin, distinct fitbase_manager_name из leads)
- CRUD /kviz/api/crm/fitbase-user-map (admin)
- GET /kviz/api/crm/app-users

## Часть 3 — Доска (канбан)

Файл: `kviz/client/src/pages/crm/FunnelPage.tsx`
Маршрут: `/crm/funnel` (заменяет PlaceholderPage)
DnD: @dnd-kit/core (установить)

- Шапка: выбор воронки, поиск, «Показать архивные», кнопка «Синхронизировать с FB»
- Колонки = не-архивные этапы выбранной воронки
- Карточка: title/name, дата, бюджет, менеджер, теги, is_overdue (розовый фон)
- Drag & drop: перетащить карточку в другую колонку → PATCH leads/:id {stage_id}
- Мобиль: горизонтальный скролл колонок

## Часть 4 — Карточка заявки (LeadDrawer)

Файл: `kviz/client/src/pages/crm/LeadDrawer.tsx`

- Панель справа (480px на десктопе, fullscreen на телефоне)
- Вкладки: Основное / Произвольные поля (заглушка)
- Основное: title, name/surname, phone, description, budget, tags, manager, funnel, stage, source, UTM-поля
- Правая часть: задачи (список + форма создания), комментарии в ленте
- Кнопки: Сохранить, В архив, (admin) Удалить

## Часть 5 — Настройки

Добавить в `SettingsPage.tsx` разделы:
- `funnels` — воронки и этапы (создать, переименовать, is_active/is_archived)
- `lead-tags` — теги (создать/удалить, системные нельзя удалять)
- `task-types` — типы задач
- `lost-reasons` — причины отказа
- `fb-users` — сопоставление Fitbase-пользователей с app_users

## Часть 6 — Задачи в «Менеджере»

Добавить в `ManagerPage.tsx` секцию «Задачи по заявкам»:
- GET /kviz/api/crm/lead-tasks?today=1&status=open
- Показывает просроченные и сегодняшние задачи по лидам

## Часть 7 — Мобильная версия

- FunnelPage: горизонтальный скролл колонок, карточки на весь экран; @dnd-kit TouchSensor
- LeadDrawer: position:fixed, inset:0 на телефоне (полный экран)
- SettingsPage: новые секции следуют существующей мобильной логике (← Назад)

## Часть 8 — Сборка и деплой

- npm run build (без ошибок)
- git push origin main
- Дождаться деплоя на Render
- Проверить: кнопка «Синхронизировать с FB», карточки появились, DnD работает
- Добавить cron-job.org: POST /run/crm-leads-sync каждые 5 минут

## Env/cron

- Новых env не нужно
- cron-job.org: POST https://slimway-agent.onrender.com/run/crm-leads-sync каждые 5 минут (с x-cron-secret)
