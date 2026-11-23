# Зонд Fitbase: история клиента — продажи, оплаты, сеансы

**Задача 84 · 23.11.2026 · Коммиты 7363f6e, 0fa1920**
Только чтение. Запущен `GET /run/probe-client-history` на проде после деплоя.

---

## Как запустить

```
GET https://slimway-agent.onrender.com/run/probe-client-history?key=<CRON_SECRET>

# Конкретные клиенты:
?client_ids=12,384,608

# По телефону (последние 10 цифр):
?phone=87767681579

# Автовыборка ~8 клиентов (по умолчанию):
(без параметров)
```

---

## Суммарные подсчёты

| Показатель | Значение |
|---|---|
| Клиентов в Fitbase | **787** |
| Контрактов в Fitbase | **595** |
| Клиентов в crm_clients (is_deleted=false) | **750** |
| Клиентов в body_clients | **300** |
| body_clients с fitbase_client_id | 271 |
| Совпадений crm_clients ↔ body_clients (по 10 цифрам) | **270** |
| Клиентов crm без совпадения в body | 452 |
| Клиентов body без совпадения в crm | 30 |
| Дублей телефона в crm_clients | 2 |
| Всего замеров inbody_tests | **661** |
| inbody_tests без body_client_id | 0 |

Итого Fitbase ≈ 787 клиентов, из них ~595 хотя бы с одним контрактом.
При выгрузке per-client (3 запроса × 787 × 250 мс) ≈ **10 минут** минимум — нужна пакетная задача.

---

## Маппинг полей Fitbase → наши таблицы

### `/client/:id` → будущая `crm_clients` (импорт)

Все ключи на `/client`: `id, name, surname, patronymic, birth_date, card, status, photo, tags, contacts, is_archive, manager, advertising_source, purchase_amount, lead_id, analytics, club, allowed_clubs, created_at, updated_at, custom_fields`

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_clients | fitbase_client_id | уже есть |
| `name` + `surname` + `patronymic` | crm_clients | full_name | объединить |
| `birth_date` | crm_clients | birth_date | |
| `contacts[].value` (тип phone) | crm_clients | phone | нормализовать |
| `status` | — | — | 1=активный, 3=в отпуске(?), 6=заблокированный(?) — уточнить |
| `advertising_source.name` | crm_clients | ad_source_id | импорт по имени |
| `purchase_amount` | — | — | сумма всех покупок, вычислимое |
| `manager.name` | — | — | кто ведёт клиента |

**Статус клиента:** видны статусы 1, 3, 6. Статус 3 — по Fitbase «отпуск/freeze»; статус 6 — вероятно «удалён/заблокирован». Нужно уточнить в документации Fitbase.

---

### `/client-contract?client_id=` → будущая `crm_client_contracts`

Все ключи контракта (наши + extra): `id, ticket, manager, freezes, visits_left, price, price_full, payment, payment_date, begin_date, activation_date, end_date, closed, deleted_at, client_id` + extra: `contract_name, card, price_template, amount_of_payment, discount, discount_type, initiator, recurrent, club, created_at, updated_at`

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_client_contracts | fitbase_contract_id | |
| `ticket.contract_item.name` | crm_plans | name | название абонемента |
| `contract_name` | crm_client_contracts | name | дублирует ticket, но проще |
| `ticket.visits` | crm_plans | sessions_total | null = безлимитный (duration_type=months) |
| `ticket.duration_type` | crm_plans | duration_type | "days"/"months"/"visit" |
| `visits_left` | crm_client_contracts | sessions_left | |
| `price` | crm_client_contracts | price_paid | уплачено (может быть < price_full при рассрочке) |
| `price_full` | crm_plans | price | полная стоимость |
| `payment` | crm_client_contracts | is_paid | bool |
| `payment_date` | crm_client_contracts | payment_date | unix timestamp → timestamptz |
| `begin_date` | crm_client_contracts | begin_date | |
| `activation_date` | crm_client_contracts | activated_at | null если не активирован |
| `end_date` | crm_client_contracts | end_date | |
| `closed` | crm_client_contracts | is_closed | bool |
| `deleted_at` | crm_client_contracts | deleted_at | если не null = аннулирован |
| `discount` | crm_client_contracts | discount | скидка при продаже |
| `discount_type` | crm_client_contracts | discount_type | тип скидки |
| `manager.id` | crm_client_contracts | manager_fitbase_id | кто оформил |
| `freezes[]` | crm_contract_freezes (будущая) | — | массив объектов; в выборке все = [] |
| `recurrent` | — | — | рекуррентные платежи (не используется в SlimWay) |

**Заморозки:** поле `freezes` существует в контракте, но в 11 проверенных контрактах пусто. Формат объекта заморозки неизвестен — нужно дополнительно проверить клиентов со статусом 3 (отпуск/замороженные).

**Безлимитные абонементы:** `ticket.visits = null` при `duration_type = "months"` (пример: «Акция VACU 12 + ROLLSHAPE 12» — 12 сеансов + 12 сеансов, но записано как months без счётчика).

**Рассрочка / Разбитая оплата:** `price < price_full` возможно. При одном контракте могут быть несколько строк в till-order-steps (пример: клиент #758 — 40 000 ₸ наличными + 13 100 ₸ картой за один контракт 53 100 ₸).

---

### `/till-order-steps?client_id=` → `crm_sales` / `crm_sale_items`

Все ключи (наши + extra): `id, amount, item_type, operation_type, payment_type, cashier, manager, contract_id, created_at, item` + extra: `pay_date, priceDeposit, priceBonus, paid_minus_commission, commission_fee, commission, item_id, order_id, till_id, client, source_id, club, created_by_user, initiator, legal_entity, payment_method, payment_channel, updated_at`

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_sale_items | fitbase_step_id | |
| `amount` | crm_sale_items | total | отрицательное = возврат |
| `item_type` | crm_sale_items | item_type | contract / product / deposit / service |
| `operation_type` | — | — | purchase / refund / correction |
| `payment_type.name` | crm_payment_methods | name | «Карта», «Наличные» — названия совпадают с нашими |
| `created_by_user.name` | crm_sales | cashier_name | кассир (не поле `cashier` — оно может быть null) |
| `manager.name` | crm_sales | manager_name | менеджер-продавец |
| `contract_id` | crm_sale_items | contract_fitbase_id | связь с абонементом (если покупка абонемента) |
| `created_at` | crm_sales | created_at | unix timestamp → timestamptz |
| `pay_date` | crm_sales | paid_at | дата оплаты (extra, отличается от created_at?) |
| `item.name` | crm_sale_items | name | название товара/услуги |
| `item_id` | crm_sale_items | fitbase_item_id | id товара/услуги в Fitbase |
| `order_id` | crm_sales | fitbase_order_id | группировка строк одного чека |
| `priceBonus` | crm_sale_items | bonus_amount | сумма бонусами |
| `priceDeposit` | crm_sale_items | deposit_amount | сумма с депозита |
| `payment_method` | — | — | способ оплаты (дубль payment_type или доп. детализация?) |

**Возвраты:** `amount < 0` + `operation_type = 'refund'`. Оба признака присутствуют одновременно.
**Товары:** `item_type = 'product'` в till-order-steps (отдельного эндпоинта нет). Пример: «Полотенце D» за 1 000 ₸.
**Депозит:** `item_type = 'deposit'` — пополнение депозита клиента.
**Несколько строк = один чек:** группировать по `order_id`.

---

### `/schedule-registration?client_id=` → будущая `crm_visits`

Все ключи визита (наши + extra): `id, status, contract_id, event` + extra: `client_service, client_contract, created_at, updated_at, is_archive, auto_delete_time`

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_visits | fitbase_reg_id | |
| `status` | crm_visits | status | 0=?, 1=запись, 2=отмена, 3=посещение, 4=неявка |
| `client_contract` | crm_visits | contract_fitbase_id | связь с абонементом (объект, не прямой ID!) |
| `client_service` | crm_visits | service_fitbase_id | связь с услугой |
| `event.date` | crm_visits | visit_date | |
| `event.training.name` | crm_visits | training_name | |

**ВАЖНО:** В визите нет прямого поля `contract_id` — связь с абонементом хранится в `client_contract` (объект). Нужно брать `client_contract.id`.

**Статус 0:** обнаружен в данных — значение неизвестно. Вероятно «ожидает» или «неопределён». Уточнить в документации.

---

## Недостающие колонки (нужен SQL — будущие задачи)

Перечислено без SQL — только список того, чего нет в текущей схеме.

### Новые таблицы:
1. `crm_client_contracts` — контракты клиента (сейчас есть только `crm_sales/crm_sale_items`)
2. `crm_contract_freezes` — заморозки (begin_date, end_date, manager_fitbase_id)
3. `crm_visits` — история визитов (fitbase_reg_id, status, visit_date, training_name, contract_fitbase_id)

### Колонки к существующим таблицам:
4. `crm_sale_items.fitbase_step_id` — id строки в Fitbase
5. `crm_sale_items.fitbase_item_id` — id товара/услуги в Fitbase
6. `crm_sale_items.operation_type` — purchase/refund/correction
7. `crm_sales.fitbase_order_id` — id чека в Fitbase (группировка строк)
8. `crm_sales.paid_at` — дата оплаты (pay_date из Fitbase)

### Уже есть:
- `crm_clients.fitbase_client_id` ✓
- `body_clients.fitbase_client_id` ✓ (271 из 300 заполнены)
- Связка body_clients ↔ crm_clients через phone_digits ✓ (270 совпадений)
- `inbody_tests.body_client_id` ✓ (все 661 теста привязаны)

---

## Выводы и риски

1. **Phone в body_clients:** формат `+77784670104` (11 цифр с `+`). В cross-match нужно брать последние 10 цифр — реализовано в зонде.
2. **452 crm_clients без body_client:** это клиенты, у которых нет замеров InBody. Нормально.
3. **30 body_clients без crm_client:** обратить внимание — клиенты с замерами, которых нет в CRM.
4. **2 дубля телефона в crm_clients** — нужно найти и исправить вручную.
5. **Пагинация визитов:** у активного клиента (fitbase_id=12) 20 визитов без пагинации. При большом числе визитов (>100) нужна пагинация через `paginateGet`. Текущий зонд использует `rawGet` для визитов — исправить при полной выгрузке.
6. **Скорость полной выгрузки:** 787 клиентов × 3 запроса × 250 мс = ~10 минут. Нужна фоновая задача с чекпоинтами, не cron.
7. **Заморозки:** поле `freezes[]` в контракте, но ни у кого нет данных. Нужно найти замороженного клиента и проверить структуру.
8. **Статус клиента 6:** два клиента без контрактов и без оплат — удалённые/заблокированные? Уточнить у Сергея.
