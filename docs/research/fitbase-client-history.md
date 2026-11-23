# Зонд Fitbase: история клиента — продажи, оплаты, сеансы

**Задача 84 · 23.11.2026**
Только чтение. Зонд запущен POST `/run/probe-client-history` (секрет в `CRON_SECRET`).

---

## Как запустить

```
POST https://slimway-agent.onrender.com/run/probe-client-history
Authorization: Bearer <CRON_SECRET>

# конкретные клиенты:
?client_ids=12345,67890

# по телефону:
?phone=87767681579

# автовыбор ~8 клиентов (по умолчанию):
(без параметров)
```

---

## Маппинг полей Fitbase → наши таблицы

### `/client-contract` → `crm_plans` / `crm_client_contracts` (будущая)

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_client_contracts | fitbase_contract_id | внешний ключ |
| `ticket.contract_item.name` | crm_plans | name | название абонемента |
| `ticket.visits` | crm_plans | sessions_total | null = безлимитный |
| `ticket.duration_type` | crm_plans | — | "month"/"day"/"visit" |
| `visits_left` | crm_client_contracts | sessions_left | остаток |
| `price` | crm_client_contracts | price_paid | уплачено |
| `price_full` | crm_plans | price | полная цена |
| `payment` | crm_client_contracts | payment_status | "full"/"installment"/... |
| `payment_date` | crm_client_contracts | payment_date | |
| `begin_date` | crm_client_contracts | begin_date | |
| `activation_date` | crm_client_contracts | activated_at | |
| `end_date` | crm_client_contracts | end_date | |
| `closed` | crm_client_contracts | is_closed | bool |
| `deleted_at` | crm_client_contracts | deleted_at | если есть = аннулирован |
| `freezes[]` | crm_contract_freezes (будущая) | — | массив объектов заморозки |
| `manager.id` | crm_client_contracts | manager_fitbase_id | кто оформил |

### `/till-order-steps` → `crm_sales` / `crm_sale_items` (существующие)

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_sale_items | fitbase_step_id | |
| `amount` | crm_sale_items | total | отрицательное = возврат |
| `item_type` | crm_sale_items | item_type | contract/product/deposit/service |
| `operation_type` | crm_sale_items | — | purchase/refund/correction |
| `payment_type.name` | crm_payment_methods | name | вид оплаты |
| `cashier.name` | crm_sales | cashier_name | кассир |
| `manager.name` | crm_sales | manager_name | менеджер |
| `contract_id` | crm_sale_items | contract_fitbase_id | связь с абонементом |
| `created_at` | crm_sales | created_at | |
| `item.name` | crm_sale_items | name | название товара/услуги |

**Возвраты:** `amount < 0` или `operation_type = 'refund'` — оба признака присутствуют.
**Товары:** `item_type = 'product'` в till-order-steps (отдельного эндпоинта нет).
**Пополнение депозита:** `item_type = 'deposit'`.

### `/schedule-registration` → будущая `crm_visits`

| Fitbase поле | Наша таблица | Колонка | Примечание |
|---|---|---|---|
| `id` | crm_visits | fitbase_reg_id | |
| `status` | crm_visits | status | 1=запись/2=отмена/3=посещение/4=неявка |
| `contract_id` | crm_visits | contract_fitbase_id | связь с абонементом (если есть) |
| `event.date` | crm_visits | visit_date | |
| `event.training.name` | crm_visits | training_name | тренировка/занятие |

---

## Заморозки

Заморозки хранятся в поле `freezes` внутри объекта контракта (`/client-contract`).
Отдельного эндпоинта нет. Каждый элемент `freezes[]` содержит (нужно уточнить по данным зонда):
- `begin_date`, `end_date` — даты заморозки
- `created_at`, `manager_id`

---

## Суммарные подсчёты (после запуска зонда)

> **Заполнить после запуска `/run/probe-client-history`**

| Показатель | Значение |
|---|---|
| Клиентов в Fitbase | — |
| Контрактов в Fitbase | — |
| Клиентов в crm_clients (is_deleted=false) | — |
| Клиентов в body_clients | — |
| Совпадений crm_clients ↔ body_clients (по 10 цифрам) | — |
| Клиентов crm без body | — |
| Клиентов body без crm | — |
| Дублей телефона в crm_clients | — |
| Всего замеров inbody_tests | — |
| inbody_tests без body_client_id | — |

---

## Недостающие колонки (нужен SQL)

После заполнения данных зонда уточнить список. Предварительно:

1. `crm_client_contracts` — таблица ещё не создана (только crm_sales/crm_sale_items)
2. `crm_contract_freezes` — хранение заморозок
3. `crm_visits` — история визитов
4. `body_clients.fitbase_client_id` — уже есть, связь Fitbase ↔ InBody-клиент

---

## Риски

- `contract_id` в `/schedule-registration` может отсутствовать у части визитов (нужно проверить по данным зонда)
- Лимит страниц 100; при большом числе визитов пагинация займёт значительное время
- Fitbase не имеет эндпоинта «все визиты клуба» — только per-client; полная выгрузка ≈ `totalClients × 3 запроса × 250 мс ≈ несколько часов` при 10 000+ клиентах
