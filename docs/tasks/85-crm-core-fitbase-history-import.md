Модуль: crm-core, crm-kassa, zamery

# Задача 85 — Карточка клиента v2: этапы 2–3 — связка с замерами + импорт продаж, абонементов и визитов из Fitbase

**SQL уже выполнен.** SQL-файлы и миграции не создавай. Если не хватает колонки или ограничение мешает — остановись и напиши, какой SQL нужен. В Fitbase ничего не пишем, только GET.

## Новые колонки и таблицы (SQL уже выполнен)

### crm_client_plans (новые колонки):
- `fitbase_contract_id bigint unique` — ID контракта в Fitbase
- `source text check in ('crm','fitbase') default 'crm'`
- `name text` — название для импортированных без crm_plan (plan_id=null)
- `needs_split boolean default false` — нужно ли разделить по аппаратам вручную
- `sessions_total integer` — итого сеансов (из Fitbase ticket.visits)
- `sessions_left integer` — остаток сеансов (из Fitbase visits_left)
- plan_id nullable (убрано NOT NULL для fitbase-импортированных)

### crm_sales (новые колонки):
- `source text check in ('crm','fitbase') default 'crm'`
- `fitbase_order_id bigint` — ID чека в Fitbase (группировка строк)
- `paid_at timestamptz` — pay_date из Fitbase

### crm_sale_items (новые колонки):
- `fitbase_step_id bigint` — ID строки в Fitbase
- `fitbase_item_id bigint` — ID товара/услуги в Fitbase
- `operation_type text` — purchase/refund/correction

### crm_sale_payments (новая колонка):
- `fitbase_step_id bigint`

### crm_refunds (новые колонки):
- `source text check in ('crm','fitbase') default 'crm'`
- `fitbase_step_id bigint unique` — idempotency key
- `client_id uuid` nullable (nullable для прямой вставки)
- `sale_id uuid` nullable (nullable для Fitbase-возвратов без CRM-продажи)
- `shift_id uuid` nullable

### crm_visit_history (новая таблица):
- `id uuid pk default gen_random_uuid()`
- `client_id uuid not null references crm_clients`
- `fitbase_reg_id bigint unique not null`
- `fitbase_contract_id bigint` nullable
- `status integer not null` — 0=?, 1=запись, 2=отмена, 3=посещение, 4=неявка
- `visit_date date` nullable
- `training_name text` nullable
- `created_at timestamptz default now()`

### body_clients (новые колонки):
- `crm_client_id uuid references crm_clients` nullable
- `crm_link_method text check in ('fitbase_id','phone','manual')` nullable

### crm_fitbase_import_runs (новая таблица):
- `id uuid pk default gen_random_uuid()`
- `kind text` — 'full' | 'nightly'
- `status text` — 'running' | 'done' | 'error'
- `started_at timestamptz default now()`
- `finished_at timestamptz` nullable
- `total_clients integer default 0`
- `processed integer default 0`
- `plans_upserted integer default 0`
- `sales_upserted integer default 0`
- `refunds_upserted integer default 0`
- `visits_upserted integer default 0`
- `errors jsonb default '[]'`
- `last_client_fitbase_id integer` nullable

---

## ЧАСТЬ 0 — Подготовка
Сохрани ТЗ в `docs/tasks/85-crm-core-fitbase-history-import.md`, добавь в `docs/QUEUE.md` (задача 85, модули crm-core, crm-kassa, zamery), статус «в работе».

## ЧАСТЬ 1 — Связка body_clients → crm_clients

Функция `linkBodyClients()` в `src/jobs/fitbaseHistoryImport.ts`:
1. Загрузить все body_clients (id, fitbase_client_id, phone, crm_client_id, crm_link_method)
2. Загрузить все crm_clients (id, fitbase_client_id, phone)
3. Сначала совпадение по fitbase_client_id: `UPDATE body_clients SET crm_client_id=..., crm_link_method='fitbase_id'`
4. Оставшиеся: совпадение по последним 10 цифрам телефона — ТОЛЬКО если одно совпадение, `crm_link_method='phone'`
5. **Никогда** не затирать crm_link_method='manual'
6. Вернуть статистику: linked, linked_by_fb, linked_by_phone

**UI в Настройках → «Данные InBody»** (после существующих блоков в InBodySettingsSection):
- Блок «Связь с клиентами CRM»: счётчики (всего привязано / спорных / без пары CRM), список спорных (body_id, телефон, несколько crm_clients → ссылки), кнопки ручной привязки/отвязки через API
- Маршруты: `GET /kviz/api/crm/inbody-link-stats`, `POST /kviz/api/crm/inbody-link-auto`, `POST /kviz/api/crm/body-clients/:id/link`, `POST /kviz/api/crm/body-clients/:id/unlink`

## ЧАСТЬ 2 — Импорт истории клиента из Fitbase

Файл `src/jobs/fitbaseHistoryImport.ts`.

Для каждого crm_client с fitbase_client_id:

**2.1 Контракты → crm_client_plans**
- `rawGet('/client-contract?client_id=...')`
- upsert по fitbase_contract_id
- plan_id: поиск по имени из crm_plans (нечувствительно к регистру), иначе null
- needs_split=true если plan_id найден И crm_plan_items > 1 типа устройства И статус active/not_activated
- Статус: deleted_at → 'cancelled'; closed → 'expired'; activation_date+end_date → проверить expired/active; !activation_date → 'not_activated'
- NO crm_client_plan_items для Fitbase-импортированных

**2.2 Продажи → crm_sales/crm_sale_items/crm_sale_payments**
- `getTillOrderSteps({ client_id })`, группировать по order_id
- Только amount > 0 (не возвраты)
- upsert crm_sales по fitbase_order_id; shift_id=null, source='fitbase'
- Для каждого step: crm_sale_items (fitbase_step_id, fitbase_item_id, operation_type)
- Для каждого step: crm_sale_payments (fitbase_step_id, amount > 0 constraint)
- priceDeposit > 0 → отдельная payment строка с wallet deposit method
- priceBonus > 0 → отдельная payment строка с wallet bonus method
- item_type='deposit' → также crm_balance_ops (wallet='deposit', amount=step.amount)
- Cashier = created_by_user.name (не поле cashier)

**2.3 Возвраты → crm_refunds**
- Steps где amount<0 или operation_type='refund'
- upsert по fitbase_step_id
- source='fitbase', client_id, amount=Math.abs(step.amount), reason='Возврат из Fitbase'
- sale_id: пытаемся найти matching crm_sales по fitbase_order_id; если нет → null
- shift_id=null

**2.4 Визиты → crm_visit_history**
- `rawGet('/schedule-registration?client_id=...')` с date windowing (как syncVisits в fitbaseCrmSync.ts)
- date_from='2020-01-01', date_to=сегодня
- upsert по fitbase_reg_id
- fitbase_contract_id = client_contract.id (это объект, берём .id)
- status = Number(visit.status)
- visit_date = event.date
- training_name = event.training.name

**2.5 Механика**
- На каждого клиента — отдельный try/catch; ошибка клиента пишется в список ошибок, импорт продолжается
- Пауза 300–500 мс между Fitbase запросами
- Checkpoint каждые 10 клиентов → запись в crm_fitbase_import_runs
- Resume: при запуске full-импорта проверить незавершённый run → продолжить с last_client_fitbase_id
- Один одновременный импорт (guard через `historyImportJob` в памяти + статус в crm_fitbase_import_runs)

## ЧАСТЬ 3 — Запуск

**Серверные маршруты:**
- `POST /run/fitbase-history-import?kind=full|nightly` — CRON_SECRET, запуск в фоне
- `GET /run/fitbase-history-import/status` — CRON_SECRET, возвращает состояние из памяти + DB
- `POST /kviz/api/crm/fitbase-history-import` — admin-сессия, из UI
- `GET /kviz/api/crm/fitbase-history-import/status` — admin-сессия, из UI

**Nightly** (kind=nightly): только клиенты, у которых есть продажи/визиты за последние 90 дней (by payment_date/visit_date в crm_client_plans/crm_visit_history), + обновить active/not_activated/frozen планы + запустить linkBodyClients().

**UI в Настройках → «Данные InBody»** или отдельный блок:
- Кнопка «Импорт истории из Fitbase» (полный / только активные)
- Прогресс-бар (clients processed / total)
- Статистика: планы, продажи, возвраты, визиты
- Список последних ошибок (до 10)

## ЧАСТЬ 4 — Данные для карточки (API, без интерфейса)

**GET /kviz/api/crm/clients/:id/summary**
Возвращает:
- `ltv` = SUM crm_sale_payments.amount (cash+cashless) − SUM crm_refund_payments.amount (для этого клиента, все источники)
- `active_plan` = первый active/not_activated crm_client_plan для этого клиента (имя, статус, valid_until, sessions_left)
- `visits_attended_total` = COUNT crm_visit_history WHERE client_id=... AND status=3
- `last_visit_at` = MAX visit_date WHERE status=3
- `inbody_last` = последний inbody_test для этого клиента (через body_clients.crm_client_id)
- `measure_last` = последний замер тела (из measurements, по phone)
- `body_client_id` = body_clients.id где crm_client_id = client.id

**Фиксы существующих вкладок «Абонементы» и «Продажи»:**
- Вкладка «Абонементы» (ClientsPage.tsx): если plan=null, показывать cp.name вместо cp.plan_id (UUID)
- Вкладка «Продажи» (ClientsPage.tsx): cashier может быть null → показывать «—» или пропускать
- Вкладка «Продажи»: number может быть null → показывать fitbase_order_id или «Из Fitbase»

**Kassa / Reports — исключить source='fitbase' из расчётов смены:**
- GET /kviz/api/crm/shifts/:id/sales: уже фильтрует по shift_id, Fitbase-продажи (shift_id=null) не попадают
- GET /kviz/api/crm/sales: добавить .neq('source', 'fitbase') при выборке для смены ИЛИ явно отображать из какого источника
- Проверить crm_shift_expected_cash RPC — она работает с crm_cash_movements и shift_id, Fitbase не затрагивает

## ЧАСТЬ 5 — Проверка, документация, деплой

1. `npm run build` — без ошибок
2. Тест на 3 клиентах:
   - Клиент по phone 87767681579 (из задачи 84)
   - Клиент #758 из Fitbase (split payment: 40 000 нал + 13 100 карта)
   - Любой клиент с возвратом
3. Проверить idempotency: запустить импорт этих 3 клиентов дважды → счётчики не растут
4. Проверить kassa: открыть смену, создать тестовую продажу — суммы в смене не включают Fitbase-продажи
5. Скриншоты 1440px и 375px (карточка клиента — вкладки Абонементы/Продажи до и после импорта)
6. Обновить docs: crm-core.md, crm-kassa.md, zamery.md, STATE.md, QUEUE.md
