Модуль: crm-core, reports, crm-kassa

# Задача 18 — Исправления crm-core, reports, crm-kassa

## crm-kassa — КРИТИЧНО (продакшен сломан)

### Часть 1 — Исправить вызовы RPC в src/http/crm.ts

- `crm_shift_expected_cash`: `{ shift_id }` → `{ p_shift: ... }` (строки ~1190 и ~1212); добавить обработку ошибки
- `crm_checkout`: `{ params: payload }` → `{ p: payload }` (строка ~1309)
- `crm_refund`: `{ params: payload }` → `{ p: payload }` (строка ~1323); добавить shift_id открытой смены
- В `RPC_ERROR_MAP` добавить `BAD_PAYMENT_METHOD` и `BAD_QTY`

### Часть 2 — Исправить имена колонок в src/http/crm.ts

- `crm_cash_movements`: `direction` → `type`, убрать `branch_id` из INSERT
- `crm_sales` SELECT: `total_amount` → `total`, `crm_sale_payments(method_id,...)` → `crm_sale_payments(payment_method_id,...)`
- `crm_client_plans` SELECT: `purchase_date` → `purchased_at`, `freeze_used` → `freeze_days_used`, order по `purchased_at`
- `crm_balance_ops` INSERT: убрать `direction`, `amount` со знаком (отрицательный для изъятий)
- Checkout: смотреть цены из БД (crm_plans.price, crm_product_stock.retail_price), не из браузера; переименовать `method_id` → `payment_method_id` в payments

### Часть 3 — Исправить KassaPage.tsx

- Интерфейс `Movement`: `direction` → `type`
- Интерфейс `SaleRow`: `total_amount` → `total`, `crm_sale_payments.method_id` → `payment_method_id`
- `MovementModal.submit`: `{ direction: dir }` → `{ type: dir }`
- Отображение движений: `m.direction` → `m.type`
- Отображение продаж: `sale.total_amount` → `sale.total`
- Убрать поля ввода цены абонемента и товара (только для admin) из корзины
- Поиск клиента: принять `{items, total}` (после исправления списка клиентов)

## crm-core

### Часть 4 — Пагинация списка клиентов

- `GET /kviz/api/crm/clients`: вернуть `{items, total}` вместо массива; добавить `branch_id` в запрос; нормализовать поиск по телефону (search → цифры → последние 10)
- `runFitbaseImport`: добавить `.limit(10000)` на `fitbase_clients_cache` и `crm_clients` (обход лимита 1000 строк Supabase)
- `recalculate-profiles`: добавить `.limit(10000)` на `crm_clients`
- `ClientsPage.tsx`: принять `{items, total}`, показать счётчик из сервера, кнопка «Показать ещё»
- `ClientsPage.tsx searchReferrer`: принять `{items}` вместо массива
- `ClientsPage.tsx ClientPlan`: `purchase_date` → `purchased_at`, `sessions` → `sessions_left`/`sessions_total`
- `ClientsPage.tsx SaleRow`: `total_amount` → `total`
- `KassaPage.tsx` поиск клиента: принять `{items}` вместо массива

### Часть 5 — Кнопка «Отчёт по замерам» в карточке клиента

Добавить сервер-эндпоинт `GET /kviz/api/crm/clients/:id/report-link`, который по телефону
клиента ищет `body_clients` и возвращает `{url}` или `{url: null}`.
В ClientCard добавить кнопку «Отчёт по замерам» рядом с «Редактировать».

## reports

### Часть 6 — is_trial fix + async sync

- `src/config.ts`: добавить `TRIAL_SERVICE_NAME = 'Бесплатное пробное занятие'`
- `src/jobs/fitbaseCrmSync.ts`: `is_trial` проверять также по `training?.name === TRIAL_SERVICE_NAME`
- `src/http/metrics.ts`: POST `/metrics/sync` — асинхронный запуск (немедленный ответ), GET `/metrics/sync` — статус
- `ReportsPage.tsx`: FactDay и DayRhythm — автозагрузка при монтировании, убрать кнопку «Показать»; обновить `doSync` для опроса статуса

### Часть 7 — Отметки времени данных Fitbase (reports Task 2)

- `src/http/metrics.ts` и `runFitbaseOps`: записывать в `sync_state` при каждой синхронизации
- `ReportsPage.tsx`: показывать «Данные Fitbase на ЧЧ:ММ» в заголовке секций
- Асинхронный `/cash/sync` с опросом статуса
