# Модуль: CRM — Касса

Чат в claude.ai: «CRM: касса» · Файл: `docs/modules/crm-kassa.md`

## Назначение
Вкладка «Касса»: смены, продажа абонементов/услуг/товаров/депозита, смешанная оплата, бонусы, промокоды, возвраты. Касса не фискальная (фискальный чек пробивают в своей онлайн-кассе).

## Где код
- Сервер: `src/http/crm.ts` — все API `/kviz/api/crm/shifts/*`, `/kviz/api/crm/sales`, `/kviz/api/crm/checkout`, `/kviz/api/crm/refund`, `/kviz/api/crm/clients/:id/balance`, `/kviz/api/crm/clients/:id/plans`, `/kviz/api/crm/clients/:id/balance-ops`, `/kviz/api/crm/lifecycle`, `/kviz/api/crm/promo-codes/validate`
- Сервер lifecycle: `src/index.ts` — `GET/POST /run/crm-lifecycle` (CRON_SECRET)
- Клиент: `kviz/client/src/pages/crm/KassaPage.tsx` — полный UI кассы
- Клиент (карточка клиента): `kviz/client/src/pages/crm/ClientsPage.tsx` — баланс в шапке, вкладки «Абонементы» и «Продажи»
- Роутинг: `kviz/client/src/App.tsx` — маршрут `/crm/cashier` → `KassaPage`

## Таблицы
- `crm_cash_shifts` — одна открытая смена на студию; opening_cash (= counted_cash прошлой закрытой), expected/counted/difference при закрытии
- `crm_cash_movements` — внесение (in) / изъятие-расход (out) с комментарием
- `crm_sales` (number, client_id null = гость, cashier, manager, discount_kind none/promo/admin, status completed/partially_refunded/refunded), `crm_sale_items` (plan/product/deposit), `crm_sale_payments`
- `crm_supply_writeoffs` — списание товара по партиям
- `crm_client_plans` + `crm_client_plan_items` — купленные абонементы/услуги и остаток сеансов по аппаратам; статусы not_activated / active / frozen / expired / refunded / cancelled
- `crm_balance_ops` (wallet deposit/bonus, + / −) + вью `crm_client_balances`
- `crm_promo_usages`, `crm_refunds`, `crm_refund_items`, `crm_refund_payments`
- Функции: `crm_checkout(jsonb)`, `crm_refund(jsonb)` — одна транзакция; `crm_shift_expected_cash(uuid)`. Execute только у сервера.

## Ключевые решения
- Продажа и возврат — только через rpc (в старой CRM продажа могла создаться наполовину).
- Гостю — только товары. Неполная анкета — предупреждение, не блок.
- Старт абонемента: «с первого посещения» или с даты (не дальше max_deferred_start_days). Автоактивация через N дней; ежедневная задача 00:05 активирует/истекает.
- Поле «Менеджер» отдельно от кассира (кассир = залогиненный).
- Смешанная оплата, сумма сходится до тенге. Депозит — произвольная сумма. Нельзя оплатить пополнение депозита с депозита.
- Бонусы: начисляет/списывает только админ с причиной; 1 бонус = 1 ₸; без лимита оплаты бонусами.
- Промокод или скидка админа — не вместе; на пополнение депозита скидки не действуют. Расчёт скидки — на сервере (% до целого тенге, фиксированная — пропорционально).
- Только админ: менять остаток открытия, цену строки, скидка, возврат, бонусы.
- Возврат абонемента: сумму вводит админ, причина обязательна; товар возвращается на склад по партиям.
- Закрытие смены пока простое (ожидаемые / фактические / разница). Существующее «Закрытие смены» из Fitbase не трогаем.
- Тестовые продажи — на клиенте «ТЕСТ Тестов»; чистка — SQL от Claude.
- Параметр RPC `crm_checkout` передаётся как `{ p: payload }`.
- Параметр RPC `crm_refund` передаётся как `{ p: payload }`; `shift_id` добавляется на сервере.
- Параметр RPC `crm_shift_expected_cash` передаётся как `{ p_shift: uuid }`.
- Цены планов и товаров в checkout берутся с сервера (БД), браузерные `price` игнорируются.
- `crm_cash_movements.type` (не `direction`); нет `branch_id` в INSERT.
- `crm_balance_ops.amount` — знаковый (отрицательный для изъятий), нет колонки `direction`.

## Сделано
### 29.10.2026 · (текущий) · RPC-фикс, имена колонок, цены с сервера
- `crm_shift_expected_cash`: параметр `{ shift_id }` → `{ p_shift }` (строки ~1190, ~1212); добавлена обработка ошибки при закрытии смены.
- `crm_checkout`: `{ params: payload }` → `{ p: payload }`; цены планов и товаров берутся из БД (`crm_plans.price`, `crm_product_stock.retail_price`), а не из браузера; поле `method_id` в payments переименовано в `payment_method_id` на сервере.
- `crm_refund`: `{ params: payload }` → `{ p: payload }`; `shift_id` открытой смены добавляется на сервере.
- `crm_cash_movements`: поле `direction` → `type`, убран `branch_id` из INSERT; валидация и KassaPage обновлены.
- `crm_sales` SELECT: `total_amount` → `total`, `crm_sale_payments(method_id,...)` → `(payment_method_id,...)`.
- `crm_client_plans` SELECT: `purchase_date` → `purchased_at`, `freeze_used` → `freeze_days_used`, order по `purchased_at`.
- `crm_balance_ops`: убран `direction`, `amount` со знаком (−amount для изъятий).
- `KassaPage.tsx`: интерфейсы `Movement`/`SaleRow` обновлены; убраны инпуты цены для абонементов и товаров (цена только с сервера); поиск клиентов принимает `{items, total}`.
- `RPC_ERROR_MAP`: добавлены `BAD_PAYMENT_METHOD` и `BAD_QTY`.
- `ClientsPage.tsx`: `ClientPlan.purchase_date` → `purchased_at`, `sessions` → `sessions_left`/`sessions_total`; `SaleRow.total_amount` → `total`.

### 28.10.2026 · (следующий) · фикс shift_date + async импорт + phone format
- **Смена открывается**: Сергей добавил `crm_cash_shifts.shift_date date not null default (now() at time zone 'Asia/Yekaterinburg')::date`, код уже передавал это поле.
- **Импорт Fitbase — фоновая задача**: POST `/fitbase-import` запускает фоновый импорт и сразу возвращает `{status:'started'}`. GET `/fitbase-import/status` возвращает прогресс `{status, total, processed, added, updated, skipped, errors}`. Повторный запуск пока идёт — 409. Вставка пачками по 100. Фронт опрашивает раз в 2 сек, показывает прогресс-бар.
- **Phone format fix**: `normalizePhone` в crm.ts теперь возвращает `7XXXXXXXXXX` (без +) — соответствует правилу CLAUDE.md для crm_* таблиц.

### 28.10.2026 · 9574ebf · Этап 2: UI кассы, API смены/продаж/жизненного цикла
- **Сервер** (`src/http/crm.ts`): 19 новых эндпоинтов — смена (current/open/close/expected-cash), движения, продажи списком и детально, checkout, refund, баланс клиента, планы клиента, balance-ops, promo validate, lifecycle trigger.
- **Жизненный цикл** (`src/index.ts`): `GET/POST /run/crm-lifecycle` (CRON_SECRET) — активация `not_activated`, истечение `active` планов.
- **KassaPage** (`kviz/client/src/pages/crm/KassaPage.tsx`): экраны `ShiftClosed` / `ShiftOpen` / `SaleScreen` / `done`. Открытие смены (admin может переопределить остаток), движения наличных, список продаж, полный экран продажи (выбор клиента, вкладки Абонементы/Услуги/Товары/Депозит/Бонусы, корзина, скидки, оплата), возврат (admin).
- **ClientsPage** (`kviz/client/src/pages/crm/ClientsPage.tsx`): баланс (депозит/бонусы) в шапке карточки; вкладки «Анкета» / «Абонементы» / «Продажи» в ClientCard.
- **App.tsx**: маршрут `/crm/cashier` → `KassaPage`.
- **Fitbase import фикс**: читает из `fitbase_clients_cache`; дедупликация по fitbase_client_id (update) и phone (skip); source='fitbase_import'.
- **profile_complete фикс**: вычисляется сервером при POST и PATCH /clients; бэкфилл `/crm/clients/recalculate-profiles`.
- **SQL этапа 2 уже выполнен** (таблицы crm_cash_shifts, crm_cash_movements, crm_sales, crm_sale_items, crm_sale_payments, crm_client_plans, crm_client_plan_items, crm_balance_ops, crm_client_balances, crm_promo_usages, crm_refunds, RPC функции).

### 28.10.2026 · e219a92 · SQL этапа 2 выполнен, ТЗ отдано Claude Code
- Ждём отчёт.

## Открытые баги
- Не проверено: существуют ли в `crm_cash_shifts` колонки `opening_cash_overridden` и `close_comment`. SQL для проверки: `select column_name from information_schema.columns where table_name in ('crm_cash_shifts','crm_client_plans') order by table_name,ordinal_position;`
- Phone format migration: если в crm_clients уже есть записи с форматом `+7XXXXXXXXXX` (старый код), их нужно исправить: `UPDATE crm_clients SET phone = regexp_replace(phone, '^\+', '') WHERE phone LIKE '+%';`

## Следующее
- Проверка на проде: открытие/закрытие смены, продажа тестовому клиенту «ТЕСТ Тестов», возврат.
- Настроить cron на `/run/crm-lifecycle` ежедневно в 00:05 UTC+5 (19:05 UTC).
- Печать квитанции.
- Закрытие смены по шаблону `templates/zakrytie-smeny.xlsx` (купюры, монеты, печать) поверх смен CRM.
- Заморозка абонемента (сдвиг даты окончания на дни заморозки).
- Отчёты по продажам из `crm_sales`.
- Оплата бонусами (сейчас бонусы как payment method — зависит от наличия метода в `crm_payment_methods`).
