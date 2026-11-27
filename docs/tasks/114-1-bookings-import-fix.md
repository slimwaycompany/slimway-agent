Модуль: crm-schedule

ТЗ 114.1 — Исправление переноса записей Fitbase (ошибки plan_id и crm_bookings_check1, порядок клиентов в чекпоинте)

═══════════════════════════════════════════

ЧАСТЬ 0 — Подготовка

- `git pull --rebase origin main`, `git status`. Прочитать `CLAUDE.md`, `docs/modules/crm-schedule.md`, `src/jobs/fitbaseBookingsImport.ts`.
- Ограничения `crm_bookings` (проверено в базе 27.11):
  - `crm_bookings_check`: `ends_at > starts_at`;
  - `crm_bookings_check1`: (`kind='plan'` И `client_plan_id` не null И `client_plan_item_id` не null И `phase` не null) ИЛИ (`kind='free'` И `client_plan_id` null И `client_plan_item_id` null);
  - `plan_id` — NOT NULL для любой брони;
  - `kind`: `plan` / `free`; `phase`: `active` / `finishing`; `status`: `booked` / `confirmed` / `attended` / `no_show` / `late_cancel` / `cancelled`.
- Проверить реальные колонки `crm_client_plans` (`plan_id`) и `crm_client_plan_items` (как хранится вид аппарата: `device_type_code` и/или `device_type_codes` для пула Cross, `is_unlimited`). Не придумывать.

═══════════════════════════════════════════

ЧАСТЬ 1 — Правильная бронь по абонементу

- Кэш абонементов клиента: `fitbase_contract_id` → `{ client_plan_id, plan_id, items: [{ id, device_type_code(s) }] }`.
- Бронь `kind='plan'` создаётся только если найдены все три: `client_plan_id`, `plan_id` (из `crm_client_plans.plan_id`), `client_plan_item_id` — пункт, чей вид аппарата совпадает с видом аппарата записи (или пул, в который этот вид входит). Если подходящих пунктов несколько — первый с фазой `active`.
- Пробное: `kind='free'`, `plan_id` = id системной услуги «Пробное занятие» — найти один раз в начале прогона (`crm_plans`, системная/бесплатная, имя ilike '%пробн%'); не нашли — прогон не начинать, ошибка «Нет системной услуги «Пробное занятие»». `client_plan_id` и `client_plan_item_id` = null.
- Не удалось собрать корректную бронь (абонемент из Fitbase у нас не найден, нет пункта под этот вид аппарата, нет `ends_at > starts_at`) → бронь не создавать, а записать визит в `crm_visit_history` (upsert по `fitbase_reg_id`, как уже сделано для пересечения клиента), счётчик `to_history` с причиной (`no_plan`, `no_item`, `bad_time`). В `errors` такие случаи не писать — это не ошибка.
- Переиспользовать одну функцию «записать в историю» для всех причин (сейчас это `void supabase...upsert` внутри ветки — сделать `await` и проверять ошибку).

═══════════════════════════════════════════

ЧАСТЬ 2 — Чекпоинт и статус

- Клиенты — `.order('fitbase_client_id')`, иначе чекпоинт `fid <= last_fid` пропускает необработанных.
- Чекпоинт писать `await`, не `void`.
- В статусе и в карточке «Записи и посещения» (`FbSyncSettings.tsx`) — счётчик «В историю: N» (с разбивкой по причинам в подсказке).
- Кнопка «Сбросить прогресс» в карточке (удаляет `bookings_import_checkpoint`) — с подтверждением.

═══════════════════════════════════════════

ЧАСТЬ 3 — Сборка, документация, коммит

- `npm run build` без ошибок.
- Обнови docs/modules/crm-schedule.md, docs/STATE.md и docs/QUEUE.md по разделу 8 CLAUDE.md (убрать запись о баге чекпоинта из «Следующее»).
```bash
git add -A -- src kviz/client/src docs
git commit -m "task 114.1: перенос записей — plan_id/пункт абонемента, визиты в историю, порядок клиентов в чекпоинте"
git push origin main
```
- Отчёт по разделу 5 CLAUDE.md. Перенос на проде не запускать.
