# Схема таблиц для модуля Контроль менеджеров

Получено из реального кода (`src/http/metrics.ts`, `src/http/shifts.ts`,
`src/http/crmLeads.ts`, `src/http/scriptolog.ts`, `src/jobs/crmLeadsSync.ts`).
Дата: 06.11.2026.

## fitbase_visits
PK: `fitbase_id` (text, строка с числом). **НЕТ колонки `id`**.
Колонки: `fitbase_id, client_fitbase_id, client_name, client_phone, is_trial, booked_at, visit_at, visit_date, status, service, manager, raw, synced_at, resource, abonement`
- `client_fitbase_id` — integer (не `client_id`)
- `visit_at` — timestamp with timezone (не `time_start`)
- `status` — integer: 0=записан (не подтверждено), 1=подтверждён, 2=отказ, 3=пришёл, 4=не пришёл
- Есть колонка `abonement` (nullable text)

## fitbase_contracts
Колонки: `id, fitbase_id, client_fitbase_id, name, payment_date, begin_date, end_date, status, price, raw`
- `status` — text: 'closed' = завершён; активный = не 'closed' (не булев `closed`)
- НЕТ колонки `closed`
- Для активных: `.neq('status','closed')`
- Для завершённых: `.eq('status','closed')`

## fitbase_operations
Колонки: `id, fitbase_id, amount, op_date, client_name, manager, cashier, raw`
- `op_date` — date (не `pay_ts`)
- `cashier` — text (ФИО кассира из Fitbase)
- Клиент: `(raw->'client'->>'id')` → integer fitbase_id клиента (нет отдельной колонки)
- НЕТ колонок `client_id`, `pay_ts`

## crm_leads
Колонки: `id, branch_id, fitbase_id, funnel_id, stage_id, phone, fitbase_manager_id, fitbase_manager_name, manager_user_id, ad_source_id, lost_reason_id, fb_created_at, is_archived, raw, ...`
- `funnel_id` — UUID FK → `crm_funnels.id` (НЕ integer!)
- Для «Новые заявки» (Fitbase funnel 1): найти UUID через `crm_funnels WHERE fitbase_id=1`

## crm_funnels
Колонки: `id (UUID), branch_id, name, fitbase_id (integer), is_archived, sort, ...`
- `fitbase_id=1` = «Новые заявки», 2 = «Новички», 3 = «Постоянные», 4 = «Реактивация»
- Для UUID по Fitbase-ID: `SELECT id FROM crm_funnels WHERE branch_id=... AND fitbase_id=N`

## crm_funnel_stages
Колонки: `id (UUID), funnel_id (UUID FK → crm_funnels.id), name, kind, fitbase_id, sort, is_archived`
- `funnel_id` — UUID FK (не integer)

## staff_shifts
Колонки: `id, user_id, user_name, status, started_at, ended_at, comment, sheet_synced_start, sheet_synced_end`
- НЕТ колонки `shift_date`
- Фильтр по дате через: `started_at >= 'YYYY-MM-DDT00:00:00+05:00' AND started_at <= 'YYYY-MM-DDT23:59:59+05:00'`

## control_shift_marks
Колонки: `branch_id, shift_date (date), user_name (text), marked_at, replacing, source, created_at`
- Основной источник «кто на смене» (из Google-формы за 01.10–06.11.2026)
- Только менеджеры (admin не вносится)
- Нет `id`, уникальный ключ: `(branch_id, shift_date, user_name)`

## control_shift_schedule
Колонки: `id, branch_id, shift_date (date), user_name (text), plan_start (time HH:MM), plan_end (time HH:MM), fact_start (time HH:MM), fact_end (time HH:MM), is_fact (boolean), created_at, updated_at`
- Загружается из Google-таблицы через `syncControlSheet()`
- Уникальный ключ: `(branch_id, shift_date, user_name)`
- Если `is_fact=true` — использует fact_start/fact_end; иначе plan_start/plan_end

## fitbase_clients_cache
Колонки: `fitbase_client_id (text, PK), name, phone (+7format), synced_at, fitbase_updated_at, raw (jsonb), phone_digits (generated)`
- PK = `fitbase_client_id` (string с числом, совпадает с `fitbase_visits.client_fitbase_id`)
- `phone_digits` — генерируется триггером из `phone`

## script_events
Колонки: `id, client_id (UUID FK → script_clients.id), event_type, node_id, text, manager, fact_key, fact_value, meta, created_at`
- `client_id` — UUID (не строка `phone:...`)
- Для поиска по телефону: сначала `script_clients WHERE phone='7XXXXXXXXXX'` → `.id`

## script_clients
Колонки: `id (UUID), client_key, name, phone (7XXXXXXXXXX), channel, facts, vars, status, first_manager, last_manager, current_node, merged_into`

## crm_lead_activity
Колонки: `id, branch_id, lead_id (UUID), kind, text, author, meta, created_at`
- Для вставки: `{branch_id, lead_id, kind, text, author, meta}`

## crm_lead_tasks
Колонки: `id, branch_id, lead_id, responsible_user_id, description, due_at, status (open/done), is_overdue, closed_at, closed_by, created_by, created_at`

## control_violations
Колонки: `id, branch_id, dedup_key (unique), shift_date, standard_num, check_code, owner_name, is_shared, entity_type, entity_id, entity_label, entity_link, details, how_to_fix, minutes_late, status (open/fixed/waived/failed), fix_deadline, fixed_at, detected_at, waived_by, waived_reason, waived_at, updated_at`

## control_shift_scores
**НЕТ колонки `id`**. Уникальный ключ: `(branch_id, shift_date, owner_name, standard_num)`.
Колонки: `branch_id, shift_date, owner_name, standard_num, result (ok/fixed/pending/fail/not_reviewed/off/no_data), violations_count, amount, is_final, computed_at, updated_at`

## control_quality_reviews
Колонки: `id, branch_id, shift_date, manager_name, client_key, pick_reason (random/flagged), flag_no_facts, flag_no_outcome, flag_abandoned, c1_needs, c2_presented, c3_objections, c4_outcome, comment, reviewed_by, reviewed_at, created_at, updated_at`
- Уникальный ключ: `(branch_id, shift_date, manager_name, client_key)`

## control_settings
Колонки: `key (PK), value (jsonb), branch_id, updated_by, updated_at`
- Уникальный ключ: `key` (+ branch_id)
- Фильтровать по `branch_id` при чтении!

## app_users
Колонки: `id, login, display_name, role (admin/manager), branch_id, is_active, ...`

## metrics_day_input
Колонки: `id, branch_id, day (date), on_shift (text[]), ...`
