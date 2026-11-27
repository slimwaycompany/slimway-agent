Модуль: crm-schedule, crm-core, crm-leads

ТЗ 113 — Перенос всех записей Fitbase в наше Расписание (с расстановкой по аппаратам и виртуальным аппаратам) + раздел Настроек «Синк с FB»

═══════════════════════════════════════════

ЧАСТЬ 0 — Подготовка

- `git pull --rebase origin main`, `git status` — чисто (кроме `.claude/settings.local.json` и `caller/`).
- Прочитать `CLAUDE.md`, `docs/STATE.md`, `docs/modules/crm-schedule.md`, `docs/modules/crm-core.md`, `docs/modules/crm-leads.md`, `src/jobs/fitbaseHistoryImport.ts` (как уже тянутся `/schedule-registration` и абонементы).
- SQL выполнен (чат 27.11): +2 виртуальных аппарата каждого вида (стало по 5), `crm_bookings.fitbase_reg_id bigint` + уникальный индекс.
- Проверить колонки, check-ограничения, exclusion-ограничения и **триггеры** `crm_bookings` (`select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='crm_bookings'::regclass and not tgisinternal`), а также `crm_devices`, `crm_client_plans`, `crm_client_plan_items`, `crm_visit_history`.
- Допустимые значения: `crm_bookings.status` — `booked` / `confirmed` / `attended` / `no_show` / `late_cancel` / `cancelled`; `crm_bookings.kind` — `plan` / `free`; `crm_devices.default_phase` — `active` / `finishing`.
- **Важно:** остатки занятий абонементов уже пришли из Fitbase. Импорт броней не должен ничего списывать или возвращать в `crm_client_plans` / `crm_client_plan_items`. Если вставка в `crm_bookings` триггером меняет остатки — не обходить молча: вставлять так, чтобы триггер не срабатывал на импорт, только если это можно сделать чисто (например, условие `fitbase_reg_id is null` в триггере — но это SQL), иначе остановиться и написать, какой SQL нужен.
- В Fitbase ничего не писать. `page_size` 100, пауза 300–500 мс, 4xx не ретраить.

═══════════════════════════════════════════

ЧАСТЬ 1 — Зонд (сначала, перед импортом)

- Разово снять 2–3 записи `/schedule-registration` (по одному клиенту) и одно занятие (`event`) и записать в `docs/reports/fitbase-schedule-registration.md`: где в записи дата/время начала, длительность, **зал/место** (название аппарата: «Vacuactiv 1», «Rollshape 3» и т. д.), тренировка, статус (все встретившиеся коды и их смысл), связь с абонементом (`client_contract.id`). Телефоны и ФИО маскировать.
- По зонду — таблица соответствия, использовать её в части 2:
  - статусы Fitbase → наши: не подтверждено → `booked`, подтверждено → `confirmed`, отказался → `cancelled`, пришёл → `attended`, не пришёл → `no_show`, поздняя отмена → `late_cancel`, в ожидании / ожидает оплаты → `booked`; неизвестный код — пропуск с записью в отчёт импорта.
  - зал Fitbase → наш реальный аппарат по виду и номеру (`crm_devices.type_code` + `number`, `is_virtual=false`), без учёта регистра. Зал без соответствия — запись в отчёт, бронь не создавать.

═══════════════════════════════════════════

ЧАСТЬ 2 — Импорт записей (сервер)

Новый файл `src/jobs/fitbaseBookingsImport.ts`, маршруты в `src/http/crm.ts` (или отдельный роутер), только admin, всё в `crm_audit_log`.

- Источник: все клиенты `crm_clients` с `fitbase_client_id`, для каждого `/schedule-registration` за **всю историю и будущее** (с 2020-01-01 до +180 дней), с разбивкой по окнам, как `fetchVisitsForClient()` в `fitbaseHistoryImport.ts` (вынести в общую функцию).
- Каждая запись Fitbase → одна бронь `crm_bookings`:
  - `client_id`, `branch_id`, `fitbase_reg_id`, `status` (по таблице), `starts_at` = время из Fitbase как есть (UTC в базе, пояс UTC+5), `ends_at` = начало + длительность занятия из Fitbase (нет — `session_minutes` аппарата), `booking_date` по UTC+5, `device_type_code`, `phase='active'` (завершающая фаза в Fitbase не бронировалась — не создаём), `note` = «Перенесено из Fitbase».
  - Пробное (тренировка «Бесплатное пробное занятие» / «Пробное занятие») → `kind='free'`, `plan_id` системной услуги «Пробное занятие».
  - По абонементу → `kind='plan'`, `client_plan_id` по `crm_client_plans.fitbase_contract_id`; пункт `client_plan_item_id` — по виду аппарата, если однозначно, иначе null. Не нашли абонемент — `kind='plan'` без привязки (если ограничения не дают — `free` с пометкой в `note`), в отчёт.
  - `session_burned`: для `attended` / `no_show` / `late_cancel` — как это считается у нас (смотри существующую логику статусов), но без изменения остатков (см. Часть 0).
- **Расстановка по аппаратам:** сначала реальный аппарат из зала Fitbase. Если на нём в это время уже есть пересекающаяся бронь (exclusion по аппарату) — первый свободный **виртуальный** аппарат того же вида (по номеру по возрастанию). Нет свободного виртуального — пропуск, в отчёт «нет свободного аппарата» (дата, время, вид).
- Пересечение по клиенту (тот же клиент уже стоит в это время на другом аппарате — Fitbase это позволял): бронь не создавать, запись должна остаться в `crm_visit_history` (upsert по `fitbase_reg_id`, как в импорте истории), в отчёт.
- Отменённые (`cancelled`) — тоже переносим (они не занимают аппарат: проверить, как exclusion-ограничение учитывает статус; если отменённые участвуют в exclusion — ставить их на исходный аппарат только если свободно, иначе на виртуальный, иначе пропуск).
- Повторный запуск: существующий `fitbase_reg_id` — обновить только `status` (если в Fitbase изменился), аппарат и время не трогать.
- Порядок обработки — по времени начала, чтобы расстановка на виртуальные была детерминированной.
- Пачки, фон, статус как в импорте истории: `POST /kviz/api/crm/fb-sync/bookings/run`, `GET /kviz/api/crm/fb-sync/bookings/status` → `{ status, clients_total, clients_done, created, updated, to_virtual, skipped_no_device, skipped_client_overlap, skipped_unknown_status, errors[≤20] }`. Лок — один запуск за раз. Чекпоинт по клиентам, чтобы при рестарте Render продолжить, а не начинать заново.
- После импорта для каждого клиента — запуск автоматизации воронок по этому клиенту (`runAutomation({ clientIds })`, ТЗ 112) в конце всего импорта одним вызовом.

Карточка клиента
- `GET /clients/:id/visits` и `/bookings`: строки `crm_visit_history`, у которых `fitbase_reg_id` уже есть в `crm_bookings`, не показывать (не дублировать). Условие автоматизации `days_since_last_visit` и счётчик «Визитов» — так же без двойного счёта.

═══════════════════════════════════════════

ЧАСТЬ 3 — Раздел Настроек «Синк с FB»

- Новая группа/пункт в меню Настроек «Синк с FB» (`GroupedNav`), право `settings.fb_sync` (добавить в `PERM_CATALOG`, admin по умолчанию). Файл `kviz/client/src/pages/crm/settings/FbSyncSettings.tsx`.
- Здесь собираются все кнопки переезда. Сейчас — карточки:
  - «Записи и посещения» — описание («Все записи клиентов из Fitbase за всю историю и будущие, со статусами; лишние на одно время — на виртуальные аппараты»), кнопка «Перенести», прогресс (клиенты N из M), итог по счётчикам из статуса, список проблем (до 20) с раскрытием.
  - «Заявки» — перенести сюда существующий разовый импорт заявок из ТЗ 111.1 (тот же `FbImportModal`), из меню ⋯ воронок пункт убрать.
  - «Клиенты, продажи, абонементы, визиты (история)» — существующий импорт истории (`/run/fitbase-history-import`, `fitbaseHistoryImport.ts`): кнопка запуска и его статус, если эндпоинт для админа уже есть; если нет — только статус последнего прогона из `crm_fitbase_import_runs`.
- Каждая карточка: «Последний запуск: <дата, кто>, результат».
- Мобильная версия обязательна.

Расписание
- `extraVirtual` в `SchedulePage.tsx`: допустимо 0–5 (кнопки +1…+5), колонка с бронью видна всегда (как сейчас).

═══════════════════════════════════════════

ЧАСТЬ 4 — Сборка, документация, коммит

- `npm run build` без ошибок; `npm run check:mobile` для нового экрана.
- Обнови docs/modules/crm-schedule.md, docs/modules/crm-core.md, docs/modules/logins.md (право `settings.fb_sync`), docs/STATE.md и docs/QUEUE.md по разделу 8 CLAUDE.md. Зонд — `docs/reports/fitbase-schedule-registration.md`.
```bash
git add -A -- src kviz/client/src docs
git commit -m "task 113: перенос записей Fitbase в Расписание (виртуальные аппараты), раздел Синк с FB"
git push origin main
```
- Отчёт по разделу 5 CLAUDE.md. Сам импорт на проде не запускать — запускает Сергей кнопкой.
