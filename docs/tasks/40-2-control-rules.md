Модуль: control

# Задача 40-2 — Контроль: Google Таблица, новые правила S3, фикс S4/S5, клики

Выдана: 06.11.2026. Статус: в работе.

## Часть 0 — Подготовка
- Закоммитить незакоммиченные `docs/modules/control.md` (от чата).
- Добавить `probe_result.json` и `/*.txt` в `.gitignore`.
- Сохранить это ТЗ в `docs/tasks/40-2-control-rules.md`, добавить в очередь «в работе».
- SQL уже выполнен: `control_shift_schedule` (plan/fact часы по дням), новые check_code в s3.

## Часть 1 — Синхронизация Google Таблицы
- Новый файл: `src/jobs/controlSheetSync.ts` + `/run/control-sheet-sync` (CRON_SECRET).
- API: `GET ${CONTROL_SHEET_URL}?key=${CONTROL_SHEET_SECRET}` → `{ok, marks: string[][], schedule: string[][]}`.
- Marks: строка = timestamp|филиал|ФИО|замена|фото → upsert `control_shift_marks`.
- Schedule: 2-строчная шапка (план B-D / факт E-G) + данные → upsert `control_shift_schedule`.
- Сопоставление ФИО → display_name: `staff_name_map` из настроек → fin_staff → первое имя из app_users.
- Вызывается в начале `/run/control` если последняя синхронизация >30 мин назад.
- Env: `CONTROL_SHEET_URL`, `CONTROL_SHEET_SECRET`.

## Часть 2 — getOnShift с часами
- Приоритет: `control_shift_schedule` (факт, потом план с часами HH:MM) → `control_shift_marks` (весь день) → `staff_shifts` → `metrics_day_input`.
- OnShiftResult расширяется: `schedule: Record<string, {start,end,is_fact,source}>`.
- Общие нарушения раздаются только тем, у кого время события T попадает в часы смены (helper getManagersAtTime).
- UI в режиме «День»: показывать инфо о расписании (часы + источник), жёлтый если расхождение график/отметка.

## Часть 3 — Переписать checkS3
Новые правила (вместо s3_client_card):
- `s3_no_client_card`: crm_leads.fitbase_client_id IS NULL (нет карточки клиента в Fitbase).
- `s3_no_booking`: активный лид (не success/fail) + нет пробного визита + нет открытой задачи.
- `s3_no_next_step`: пробный завершён (visit status=3, is_trial=true), нет действия через session_minutes+s3_after_minutes; и для trial-посетителя без лида вообще.
- `s3_client_fields`: после покупки (есть контракт) — проверить имя+телефон в fitbase_clients_cache.
- `s3_bad_name`: стоп-слова | цифры в имени | одно слово (нет фамилии).
- Оставить: s3_no_source, s3_no_manager, s3_no_task, s3_no_lost_reason, s3_bad_comment.
- Персистентные нарушения (без даты в dedup_key): s3_no_client_card, s3_bad_name, s3_client_fields, s3_no_next_step.
- Новые настройки: `staff_name_map` (jsonb), `name_stop_words` (jsonb array), `session_minutes` (30), `s3_after_minutes` (30). Добавить в SettingsPage.

## Часть 4 — Фикс S4 и визитов
- S4: перед созданием нарушения проверить, был ли контакт сегодня (crm_lead_activity/crm_lead_tasks по fitbase_client_id, или script_events по телефону). Нарушение только если НЕТ контакта.
- syncVisits: добавить `date_from = 7 дней назад` для обновления статусов.
- Иконка: `no_data` → ▫️ (уже в RESULT_ICON — проверить).

## Часть 5 — Фикс клика на нарушения
- Баг `.or()` в violations API для спецсимволов (особенно `(без смены)`): обернуть значение в кавычки.
- Многодневный клик: передавать `from`/`to`, API violations поддерживает `from`/`to` вместо одиночного `date`.
- Мобильно: клик по строке → bottom sheet (Modal).

## Часть 6 — Приёмка на живых примерах
Движок обязан поймать:
1. `s5_unmarked`: 04.11.2026 12:00, Кунанбаева Рашиля, +7 705 517 2013, статус «Не подтверждено».
2. `s5_unmarked + s3_bad_name`: 05.11.2026 13:00, «тт заявка 04.11 Ирина», +7 702 497 2225.
3. `s3_no_next_step + s3_bad_name`: 05.11.2026 20:00, «дочка Суниты», +7 700 662 6590 — нет лида, пришла на пробное.
4. `s3_no_task + s3_bad_name`: «Сауле, Подруга Марины», +7 775 142 5407, нет открытой задачи.
5. S4: все CONTRACT_ENDED/CONTRACT_ENDING клиенты из овчарки без контакта.

## Часть 7 — Документация и коммит
- `docs/modules/control.md`: запись в «Сделано», обновить таблицы, убрать из «Следующее» выполненное.
- `docs/STATE.md`, `docs/QUEUE.md`.
- `npm run build` без ошибок.
- `npm run check:mobile`.
- Коммит → push → деплой → проверить на проде.

## Режим: ТЕСТОВЫЙ
В Fitbase ничего не пишем. В watch_alerts ничего. Менеджерам ничего не видно.
