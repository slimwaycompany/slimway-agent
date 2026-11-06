Модуль: control

# Задача 40-1: Контроль менеджеров — фикс колонок, getOnShift, recheckViolations, история

## Контекст
Задача 40 написала код по выдуманным колонкам и молча глотала ошибки Supabase.
Результат: 0 нарушений, всё зелёное. Задача 40-1 — исправить всё по реальной схеме.
SQL уже выполнен: таблицы `control_*` переименованы под код, `control_shift_marks` создан
(56 записей из Google-формы за 01.10–06.11.2026), `no_data` добавлен в enum result.

## Часть 0 — подготовка
- [x] Закоммитить незакоммиченные docs (ef68a42)
- [ ] Создать этот файл, добавить в QUEUE.md «в работе»
- [ ] Создать `docs/reports/control-schema.md` с реальными колонками

## Часть 1 — правка колонок и ошибок
Исправить в `src/jobs/control.ts`:
- `loadSettings`: добавить `.eq('branch_id', BRANCH_ID)`
- `fitbase_visits`: `client_id → client_fitbase_id`, `time_start → visit_at`, убрать `abonement`
- `fitbase_contracts`: `is('closed', false) → neq('status','closed')`, `eq('closed', true) → eq('status','closed')`
- `fitbase_operations`: `pay_ts → op_date`; клиент из `raw.client.id` — не колонка
- `crm_leads.funnel_id = 1` — funnel_id UUID, а не integer; искать через `crm_funnels.fitbase_id`
- `script_events.client_id = 'phone:...'` — client_id UUID из `script_clients`
- Все вызовы Supabase проверяют `error`; ошибка → стандарт «ошибка проверки»; логируется
- Сырой Postgres-текст ошибки пользователю не отдаём

## Часть 2 — кто на смене
`getOnShift(dateStr)` возвращает `{names, source}`:
1. `control_shift_marks` (branch_id + shift_date)
2. `staff_shifts` (started_at ≥ dayStart И < nextDayStart); только role='manager' из app_users
3. `metrics_day_input.on_shift` (только display_name с role='manager')
Нарушения записываются даже при `names=[]`.
Когда никто не на смене — создаём score-строку `owner_name='(без смены)'` для общих нарушений.

## Часть 3 — recheckOpenViolations
Для каждого `status='open'` нарушения (прошлые дни):
- s1_*: не исправляется; deadline прошёл → `failed`
- s2_*: пропустить (только через чек-лист)
- s3_no_source, s3_no_manager, s3_no_task, s3_no_lost_reason, s3_bad_comment: проверить lead
- s4_task_overdue: проверить task.status == 'done'
- s5_unmarked: проверить visit.status не [0,1]
- Прочие: deadline прошёл → `failed`, не прошёл → оставить `open`
- `waived` — не трогать никогда

## Часть 4 — произвольная дата, история
- `runControl(finalize, date?)`: если `date` задан — работаем за эту дату
- Прошлая дата → finalize=true автоматически
- Экспортировать `runControlRange(from, to)` — цикл по дням
- №4 за прошлые даты: s4_ending/s4_ended/s4_no_visits → `no_data` (нет снимка прошлого)
- `/run/control?date=YYYY-MM-DD` и `?from=&to=` в index.ts
- Эндпоинт `POST /kviz/api/control/recompute`: удалить violations (кроме waived) + scores
  + control_quality_reviews без reviewed_at, затем вызвать runControl(true, date)

## Часть 5 — UI отчёта
- Заголовки: «Скорость», «Качество», «Карточка», «База», «Посещения»
- Тултип с правилом по наведению (уже есть в STD_TIPS — обновить текст)
- Таблица на всю ширину (убрать лишний правый отступ)
- Режим «День»: датапикер + стрелки ← → по дням; значение сохраняется в localStorage
- «Неделя», «Месяц» — стрелки ← → по периоду; «Свой» — два датапикера
- Новые иконки: ⚠️ (error/fail), ▫️ (no_data)
- Строка «Без смены» — если есть owner_name='(без смены)' в данных
- Режим «День»: показать «На смене: Ангелина, Вера · источник: control_shift_marks»

## Часть 6 — деплой и история
После деплоя:
1. GET `/run/control?from=2026-10-01&to=2026-11-06` (с x-cron-secret) → прогон истории
2. Отчёт: таблица дней, 5 примеров нарушений, сравнение №1 с watch_alerts
3. Скриншоты (день / месяц / 375px)
4. Обновить docs (control.md, STATE.md, QUEUE.md)
