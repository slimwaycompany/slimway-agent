# Модуль: Отчёты

Чат в claude.ai: «Замеры и отчёты» · Файл: `docs/modules/reports.md`

## Назначение
Вкладка «Отчёты»: отчёты по колонкам как в Fitbase «Отчёты и аналитика».

## Где код
- `kviz/client/src/pages/reports/ReportsPage.tsx` — главная страница отчётов (колонки: Менеджер, Продажи, Клиенты, Маркетинг)
- `kviz/client/src/pages/reports/OccupancySection.tsx` — секция «Занятия и загруженность»
- `kviz/client/src/pages/MetricsPage.tsx` — вкладка «Воронка»: метрики лидов/визитов/продаж из `fitbase_leads`/`fitbase_visits`
- `src/http/metrics.ts` — API `/kviz/api/metrics/*`: факт дня, дневной такт, данные по воронке

## Таблицы
- `fitbase_operations` — продажи/операции из Fitbase (подтягиваются кнопкой, только новые)
- `fitbase_leads`, `fitbase_visits` — для воронки
- `manager_task_done`, `manager_task_templates` — задачи менеджера (вкладка «Менеджер» в отчётах)
- `cash_closings`, `staff_shifts` — смены (вкладка «Менеджер → Смены»)

## Ключевые решения
- Колонки: **Менеджер** (Задачи — менеджер свои, админ свои + все; Смены), **Продажи** (отчёт по продажам), **Клиенты** (замеры тела, InBody, результаты студии со ссылкой на ТВ), **Маркетинг** (Факт дня, Дневной такт). «Настройки» из отчётов перенесены во вкладку Настройки (28.10).
- Отчёт по продажам: фильтры кассир, менеджер, товар, тип оплаты; период день/неделя/месяц/свой; кнопка «Обновить FB».
- Маркетинг: «Факт дня» (лиды дня → в работе → записи на пробное на этот день и кто записал → пришли → продажи абонементов за день) и «Дневной такт» (новые лиды дня → прошли квалификацию → записались → пришли → купили). Фильтр источника и менеджера работает на всех 5 шагах: шаги 1,2 по lead.source/manager; шаги 3,4,trial_sold — по источнику/менеджеру последней карточки клиента (clientLeadMap); шаг 5 — по источнику лида / по op.manager. Рекламные источники Fitbase: Рекомендация клиента клуба, Сайт, Instagram, Проходящий трафик, Входящий звонок, WhatsApp, Блогер бартер, Блогер Зарина, Блогер Хадия, Блогер Ната, 2гис, Таргет, Таргет тикток.
- `fitbase_visits.status` — целое число (0=записан, 1=подтверждён, 2=отказ, 3=пришла, 4=не пришла); колонка переведена в integer SQL'ем 29.10.2026.
- `fitbase_operations.raw` — полный ответ Fitbase API; `raw.client.id` = Fitbase client ID операции (для связки с лидом).
- Отчёт по замерам и по InBody ведут на одну страницу результатов клиента внутри «Отчётов» (фигура слева).
- Боковая панель — слева (переехала с правой стороны).

### Структура записи `/schedule-registration` (Fitbase)
- `id`, `status` (число), `client_id` (верхний уровень — Fitbase client ID), `created_at` (unix)
- `event.date` ("YYYY-MM-DD"), `event.time_start` ("HH:MM:SS" — срезать до HH:MM), `event.time_end`
- `event.place.name` — аппарат (resource), `event.trainers[0].full_name` — тренер/ведущий (manager)
- `event.training.id` / `event.training.name` — вид занятия (service)
- `client_service`, `client_contract` — абонемент клиента (объект `{id, name}` или null); `name` → abonement
- Объекта `client` в записи НЕТ. Полей `manager`, `resource`, `abonement` на верхнем уровне НЕТ.

### Таблица статусов `fitbase_visits.status`
| Код | Значение | Константа |
|-----|----------|-----------|
| 0 | Записан | `VISIT_STATUS_BOOKED` |
| 1 | Подтверждён | `VISIT_STATUS_CONFIRMED` |
| 2 | Отказ/отмена | `VISIT_STATUS_REFUSED` |
| 3 | Пришла | `VISIT_STATUS_VISITED` |
| 4 | Не пришла | `VISIT_STATUS_NOSHOW` |
Источник: из записей Fitbase, `REG_STATUS_*` в `src/config.ts`. `VISIT_CANCELLED_STATUSES = Set([2])`.

### Определение пробного занятия
`is_trial = true` если: `event.training.id === 16` ИЛИ `isTrialServiceName(training.name)` ИЛИ `isTrialServiceName(abonement)`.
`TRIAL_SERVICE_NAMES = ['Бесплатное пробное занятие', 'Абонемент: Пробное занятие']` (сравнение без учёта регистра).

## Сделано
### 29.10.2026 · (текущий) · фильтр источника и менеджера на всех шагах, by_source/by_manager таблицы
- `metrics.ts`: добавлен `buildClientLeadMap()` — все лиды без фильтра по дате, группировка по `client_fitbase_id`, последняя запись (по created_at ascending). Хелперы `clSrc`, `clMgr`, `opCid` (из `raw.client.id`). Лиды в period теперь загружаются без SQL фильтра по source/manager — фильтрация в JS, чтобы `by_source`/`by_manager` всегда показывали полный разрез. Шаги 3,4 (визиты) и trial_sold фильтруются через `clientLeadMap`. Шаг 5 (продажи): source через clientLeadMap, manager через `op.manager`. `by_source` расширен до 6 колонок (source, leads, in_work, trial_booked, visited, trial_sold_count, sales_amount). Добавлен `by_manager` 8 колонок с `items[]` для дрилла. `availableManagers` объединяет `fitbase_leads.manager` + `fitbase_operations.manager`. Аналогично для `day-rhythm` (by_source и by_manager с 5 шагами воронки).
- `ReportsPage.tsx`: исправлен `chipActive` (border вместо borderColor). Dropdown менеджера показывается всегда. Таблицы by_source и by_manager с прокруткой; by_manager — клик открывает DrillModal.

### 29.10.2026 · (предыдущий) · syncVisits fix, TRIAL_SERVICE_NAMES, статусы визитов, fact-day trial_sold
- `src/config.ts`: `TRIAL_SERVICE_NAME` → массив `TRIAL_SERVICE_NAMES` + хелпер `isTrialServiceName()`. Добавлены `VISIT_STATUS_*` числовые константы и `VISIT_CANCELLED_STATUSES = Set([2])`.
- `fitbaseCrmSync.ts` `syncVisits()`: исправлен главный баг — `time_start "08:00:00"` → срезается до `"08:00"` (был `RangeError: Invalid time value`); `client_fitbase_id` = `v.client_id` (верхний уровень, не `v.client.id`); batch-fetch имени/телефона из `fitbase_clients_cache`; `resource` = `event.place.name`; `manager` = `event.trainers[0].full_name`; `abonement` из `client_service`/`client_contract`; `is_trial` через `isTrialServiceName()`.
- `metrics.ts`: `buildFunnel` и `day-rhythm` — заменены хардкодные `[0,1,3]`/`=== 3` на `notCancelled()` + `VISIT_STATUS_VISITED`. `fact-day` — шаг 3 исключает `VISIT_CANCELLED_STATUSES`; добавлен запрос `trialSalesData` по `item IN TRIAL_SERVICE_NAMES` (фильтр по item, не op_type/amount); в ответе `trial_sold_count`, `visit_at` и `resource` у шага `trial_booked`.
- `ReportsPage.tsx`: `DrillItem` + `resource`; `FunnelStep` + `trial_sold_count`; DrillModal и карточка воронки показывают аппарат и «Продано услуг: N».

### 29.10.2026 · da948c1 · is_trial fix, async sync, auto-load
- `src/config.ts`: добавлен `TRIAL_SERVICE_NAME = 'Бесплатное пробное занятие'`.
- `fitbaseCrmSync.ts`: `is_trial` теперь проверяет и `training?.name === TRIAL_SERVICE_NAME` — исправляет нулевые «Записи на пробное».
- `metrics.ts`: `POST /metrics/sync` стал асинхронным (мгновенный ответ, фоновая задача); добавлен `GET /metrics/sync` для опроса статуса.
- `ReportsPage.tsx`: FactDay и DayRhythm автоматически загружаются при монтировании (убрана кнопка «Показать»); кнопка «↺ Обновить Fitbase» опрашивает GET /metrics/sync каждые 2 сек; общий хук `useSyncButton`.

### до 28.10.2026 · c7cb5ae · факт дня, дневной такт, скрытый отчёт
- FactDay / DayRhythm завершены; скрытая страница клиента с фигурой.

### до 28.10.2026 · 443e6bd · доска отчётов, замеры, InBody, студия
- Колонки отчётов (Менеджер / Продажи / Клиенты / Маркетинг), секции замеров и InBody.

### до 28.10.2026 · 04aa468 · доска отчётов для всех пользователей
- Отчёты доступны всем (не только admin), синхронизация авторизации.

## Открытые баги
- «Занятия и загруженность» — пусто (0 за 21–23.10); причина: visit_date был null у всех 1753 записей (баг syncVisits исправлен — нужен прогон синка).
- Боковая панель в «Отчётах» справа — должна быть слева.

## Следующее
- Новый отчёт для админа: Менеджер → «Работа с клиентами» (по истории скриптолога `script_events`) — чтобы проверять работу менеджеров.
- «Занятия и загруженность»: сколько записано за период, на каких аппаратах, по каким абонементам/услугам, фильтры списками.
- Позже отчёты по продажам из своей Кассы (`crm_sales`).
