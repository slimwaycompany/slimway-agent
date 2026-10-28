# crm-reference — карта модулей и схема

> Только для чтения / источник идей. Код не копировать (Frappe — AGPL).  
> Составлен по `crm-reference/slimway-backend` + `crm-reference/frappe-crm`.

---

## 1. Клиенты (`clients`)

```sql
CREATE TABLE clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  full_name   text NOT NULL,
  phone       text,
  email       text,
  birth_date  date,
  notes       text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
  is_deleted  boolean DEFAULT false,
  freeze_until date,          -- заморозка клиента (отдельно от абонемента)
  ltv         numeric,        -- пересчитывается при каждом чекауте
  last_visit_at timestamptz,  -- обновляется при attended=true на записи
  created_at  timestamptz DEFAULT now()
);
```

**Логика:**  
- `draft` — создан из лида до завершения продажи.  
- `is_deleted` — soft delete, клиент не удаляется физически.  
- LTV считается как сумма `price` всех не-deleted подписок; пересчёт при каждом `POST /sale/checkout`.  
- Полнотекстовый поиск через GIN-индекс по `full_name` (`to_tsvector('russian', ...)`).

---

## 2. Абонементы (`subscriptions` + шаблоны)

```sql
CREATE TABLE subscription_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id             uuid NOT NULL REFERENCES branches(id),
  name                  text NOT NULL,
  slot_1_type           text NOT NULL,   -- vacuactiv | rollshape | infrastep | infrashape
  slot_1_duration_min   int  NOT NULL,
  slot_1_sessions_total int  NOT NULL,
  slot_2_type           text,            -- необязательный второй тип тренажёра
  slot_2_duration_min   int,
  slot_2_sessions_total int,
  -- slot_3, slot_4 — аналогично (добавлены позже в types/index.ts)
  validity_days         int NOT NULL DEFAULT 30,
  price                 numeric(10,2),
  is_active             boolean NOT NULL DEFAULT true,
  is_trial              boolean DEFAULT false,
  finish_slot           int,   -- индекс слота, после которого абонемент завершён
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES clients(id),
  branch_id             uuid NOT NULL REFERENCES branches(id),
  name                  text NOT NULL,
  slot_1_type           text NOT NULL,
  slot_1_duration_min   int  NOT NULL,
  slot_1_sessions_total int  NOT NULL,
  slot_1_sessions_left  int  NOT NULL,
  slot_2_type           text,
  slot_2_duration_min   int,
  slot_2_sessions_total int,
  slot_2_sessions_left  int,
  -- slot_3, slot_4 — аналогично (types/index.ts)
  date_start            date NOT NULL,
  date_end              date,
  price                 numeric(10,2),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'frozen', 'expired', 'cancelled')),
  is_trial              boolean DEFAULT false,
  finish_slot           int,
  frozen_at             timestamptz,
  frozen_until          date,
  freeze_days_used      int DEFAULT 0,
  cancellation_reason   text,
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz DEFAULT now()
);
```

**Логика списания сеансов:**  
При записи (`POST /bookings-v2`) — вычитается 1 из `slot_N_sessions_left` для каждого занятого слота.  
При отмене или reject — сеансы возвращаются через `buildSessionRestorePatch` (восстанавливает все задействованные слоты одной операцией).

**Заморозка:**  
- `PATCH /subscriptions/:id/freeze` → status='frozen', сохраняет `frozen_at`.  
- `PATCH /subscriptions/:id/unfreeze` → считает `daysFreezed = ceil((now - frozen_at) / 86400)`, двигает `date_end` вперёд на столько же дней, накапливает `freeze_days_used`.  
- Пограничный случай: если `date_end = null` — дата не меняется (безлимитный абонемент).

**Перенос (`subscription_transfers`):**  
Только активный абонемент, клиент-получатель должен существовать и не быть удалён. Лог в отдельной таблице.

```sql
CREATE TABLE subscription_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  from_client_id  uuid NOT NULL REFERENCES clients(id),
  to_client_id    uuid NOT NULL REFERENCES clients(id),
  transferred_by  uuid NOT NULL REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Тестовый абонемент (trial):**  
Клиент может использовать только один trial-абонемент за всё время. Проверяется при создании через `/subscriptions` и через `/sale/checkout`.

---

## 3. Продажи / касса (`sale`, `cash_shifts`, `audit_log`)

```sql
-- Явной таблицы "sale" нет — продажа — это транзакционный эндпоинт.
-- Касса:
CREATE TABLE cash_shifts (
  id              uuid PRIMARY KEY,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  opened_by       uuid REFERENCES profiles(id),
  opened_at       timestamptz,
  closed_at       timestamptz,
  opening_balance numeric,
  closing_balance numeric,
  status          text CHECK (status IN ('open', 'closed'))
);
```

**Логика `POST /sale/checkout`:**  
1. Проверить клиента и items (subscription-шаблоны + warehouse-товары).  
2. Посчитать subtotal из цен шаблонов и складских позиций.  
3. Применить промокод (fixed или percent; проверки: активен, не истёк, не превышен лимит использований, не превышен лимит на клиента).  
4. `total = max(0, subtotal - discount)`.  
5. Для каждого subscription-item — создать подписку из шаблона (date_end = today + validity_days).  
6. Для каждого warehouse-item — вставить движение `type='out'` и уменьшить `quantity`; проверка остатка перед продажей.  
7. Записать применение промокода в `promo_code_usages`, инкрементировать `uses_count`.  
8. Пересчитать LTV клиента.  
9. Записать в `audit_log` (entity_type='sale', action='checkout') с полем `total`, `discount`, `payment_method`.

**Итоги кассовой смены** берутся из `audit_log` (не отдельная таблица транзакций): выбираются записи `entity_type='sale', action='checkout'` с `created_at >= shift.opened_at`.

**Пограничный случай:** нет изоляции транзакций между шагами 5–7. Если упадёт на шаге 6, абонемент уже создан, откат ручной. В исходнике не решено.

---

## 4. Склад (`warehouse_items`, `warehouse_movements`, `catalog_items`)

```sql
CREATE TABLE catalog_items (   -- общий справочник товаров (не per-branch)
  id       uuid PRIMARY KEY,
  name     text NOT NULL,
  category text,
  unit     text,
  sku      text,
  price    numeric
);

CREATE TABLE warehouse_items (  -- остатки per-branch
  id              uuid PRIMARY KEY,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  catalog_item_id uuid REFERENCES catalog_items(id),
  name            text NOT NULL,
  sku             text,
  category        text DEFAULT 'other',
  unit            text,
  quantity        int DEFAULT 0,
  min_quantity    int,           -- порог "low_stock"
  price           numeric,
  deleted_at      timestamptz
);

CREATE TABLE warehouse_movements (
  id          uuid PRIMARY KEY,
  item_id     uuid NOT NULL REFERENCES warehouse_items(id),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  type        text CHECK (type IN ('in', 'out')),
  quantity    int NOT NULL,
  notes       text,
  supplier    text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now()
);
```

**Логика остатков:**  
- `quantity` хранится денормализованно в `warehouse_items` — при каждом движении обновляется напрямую.  
- `/warehouse/intake` — приход: если позиция уже есть в этом филиале (по `catalog_item_id`) — суммируется, иначе создаётся новая.  
- `low_stock` = вычисляется на лету: `quantity <= min_quantity`.  
- Защита от ухода в минус: при `out` проверяется `newQty < 0` → 400.

**Поставщики:**
```sql
CREATE TABLE suppliers (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  name         text NOT NULL,
  contact_name text,
  phone        text,
  email        text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE supplier_orders (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  supplier_id  uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  status       text CHECK (status IN ('pending','confirmed','delivered','cancelled')),
  notes        text,
  total_amount numeric,
  ordered_at   date NOT NULL DEFAULT CURRENT_DATE,
  delivered_at date,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE supplier_order_items (
  id         uuid PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  item_name  text NOT NULL,
  quantity   int NOT NULL DEFAULT 1,
  unit_price numeric,
  created_at timestamptz DEFAULT now()
);
```

---

## 5. Расписание и записи (`schedule_slots`, `bookings_v2`, `devices`)

```sql
CREATE TABLE devices (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  type         text NOT NULL CHECK (type IN ('vacuactiv','rollshape','infrastep','infrashape')),
  number       text NOT NULL,
  device_group text NOT NULL DEFAULT 'A' CHECK (device_group IN ('A','B')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','disabled')),
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE schedule_slots (
  id         uuid PRIMARY KEY,
  branch_id  uuid NOT NULL REFERENCES branches(id),
  device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  date       date NOT NULL,
  time_start time NOT NULL,
  time_end   time NOT NULL,
  status     text NOT NULL DEFAULT 'free'
             CHECK (status IN ('free','booked','blocked','maintenance')),
  booking_id uuid,   -- FK без constraint (избежать circular dep)
  created_at timestamptz DEFAULT now(),
  UNIQUE(device_id, date, time_start)
);

CREATE TABLE bookings_v2 (
  id                       uuid PRIMARY KEY,
  client_id                uuid NOT NULL REFERENCES clients(id),
  subscription_id          uuid NOT NULL REFERENCES subscriptions(id),
  branch_id                uuid NOT NULL REFERENCES branches(id),
  date                     date NOT NULL,
  slot_1_schedule_slot_id  uuid NOT NULL REFERENCES schedule_slots(id),
  slot_2_schedule_slot_id  uuid REFERENCES schedule_slots(id),
  slot_3_schedule_slot_id  uuid REFERENCES schedule_slots(id),
  slot_4_schedule_slot_id  uuid REFERENCES schedule_slots(id),
  created_by               uuid NOT NULL REFERENCES profiles(id),
  status                   text CHECK (status IN ('pending','confirmed','cancelled')),
  attended                 boolean,
  confirmed_by             uuid REFERENCES profiles(id),
  confirmed_at             timestamptz,
  source                   text,   -- 'crm' | 'client_portal'
  created_at               timestamptz DEFAULT now()
);
```

**Логика бронирования:**  
- Слот 2 ищется автоматически: `time_start = slot1.time_end`, та же дата, свободный device подходящего типа.  
- Если слот 2 нужен, но не найден — возвращается `next_available` (ближайшая свободная дата + время).  
- `single_slot_index` позволяет создать запись только для одного слота (когда у клиента есть слот 2, но он хочет только слот 1).  
- Trial-абонемент: специальный эндпоинт `/bookings-v2/trial` — бронирует все слоты сразу по одному времени.

**Отмена:**  
- За 24 ч — `cancel_early`; менее 24 ч — `cancel_late` (требует права или настройки филиала `allow_cancel_within_24h`).  
- При любой отмене: слоты освобождаются (`status='free'`), сеансы возвращаются.  
- Перенос (`/reschedule`): освобождает старые слоты, занимает новые, сессии не трогает.

---

## 6. Промокоды и скидки

```sql
CREATE TABLE promo_codes (
  id                  uuid PRIMARY KEY,
  branch_id           uuid NOT NULL REFERENCES branches(id),
  code                text NOT NULL,
  discount_type       text NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed','percent')),
  discount_value      numeric NOT NULL DEFAULT 0,
  max_uses            int,        -- null = безлимит
  uses_count          int NOT NULL DEFAULT 0,
  max_uses_per_client int NOT NULL DEFAULT 1,
  expires_at          date,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE TABLE promo_code_usages (
  id            uuid PRIMARY KEY,
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**Пограничные случаи, уже решённые:**  
- Глобальный лимит (`max_uses`) + лимит на клиента (`max_uses_per_client`) проверяются оба.  
- Просроченный промокод → `PROMO_EXPIRED`.  
- Скидка `fixed` не уходит в минус: `discount = min(subtotal, discount_value)`.  
- `percent` — округление через `Math.round`.

---

## 7. Лиды

```sql
CREATE TABLE leads (
  id          uuid PRIMARY KEY,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  full_name   text NOT NULL,
  phone       text,
  source      text DEFAULT 'manual',
  status      text DEFAULT 'new'
              CHECK (status IN ('new','in_work','waiting','success','fail')),
  assigned_to uuid REFERENCES profiles(id),
  notes       text,
  client_id   uuid REFERENCES clients(id),  -- ссылка после конвертации
  created_by  uuid REFERENCES profiles(id),
  archived_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE lead_comments (
  id         uuid PRIMARY KEY,
  lead_id    uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES profiles(id),
  text       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

**Воронка:** статусы фиксированные, не кастомные. Есть `lead_funnels` и `lead_funnel_columns` (в роутах фронта) — кастомные воронки kanban, но их схема не в миграциях.

**Конвертация:** при успехе лид получает `client_id`, клиент создаётся со статусом `active`.

**Pipeline клиента (v1.8.4):**
```sql
CREATE TABLE client_pipeline (
  id         uuid PRIMARY KEY,
  branch_id  uuid NOT NULL REFERENCES branches(id),
  client_id  uuid NOT NULL REFERENCES clients(id),
  status     text NOT NULL DEFAULT 'new_client'
             CHECK (status IN ('new_client','active','frozen','expiring_soon','not_renewed')),
  position   int NOT NULL DEFAULT 0,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, client_id)
);
```

---

## 8. Сотрудники (`employees`, `profiles`, смены)

```sql
-- Профили (Supabase Auth users):
CREATE TABLE profiles (
  id        uuid PRIMARY KEY REFERENCES auth.users(id),
  branch_id uuid REFERENCES branches(id),
  role      text NOT NULL CHECK (role IN ('owner','franchisee','admin','trainer')),
  -- в types/index.ts расширено: 'developer' | 'staff' | 'technical'
  full_name text,
  phone     text,
  created_at timestamptz DEFAULT now()
);

-- Сотрудники (операционные данные):
CREATE TABLE employees (
  id            uuid PRIMARY KEY,
  branch_id     uuid NOT NULL REFERENCES branches(id),
  full_name     text NOT NULL,
  profile_id    uuid REFERENCES profiles(id),  -- связь с аккаунтом
  salary_rate   numeric,
  payment_type  text CHECK (payment_type IN ('hourly','fixed','percent')),
  -- ещё поля: position, phone, email — из роута /employees
  created_at    timestamptz DEFAULT now()
);
```

**Смены и табель:**
- `shifts` — рабочие смены сотрудника (дата, статус).
- `timesheet_entries` — детализация отработанного времени.
- `task_activity` — лента событий по задачам (action, meta jsonb).

---

## 9. Депозиты и бонусы

**Отсутствуют** в slimway-backend — ни таблицы, ни роутов. Это часть не была реализована.

---

## 10. Прочие таблицы

```sql
-- Аудит всех действий:
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY,
  branch_id   uuid REFERENCES branches(id),
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  actor_id    uuid REFERENCES auth.users(id),
  actor_name  text,
  details     jsonb,
  created_at  timestamptz DEFAULT now()
);

-- Список ожидания на слот:
CREATE TABLE slot_waitlist (
  id         uuid PRIMARY KEY,
  branch_id  uuid,
  device_id  uuid,
  date       date,
  time_start time,
  client_id  uuid,
  created_at timestamptz DEFAULT now()
);

-- Настройки филиала:
CREATE TABLE branch_settings (
  id                      uuid PRIMARY KEY,
  branch_id               uuid UNIQUE REFERENCES branches(id),
  allow_cancel_within_24h boolean DEFAULT false
);

-- Правила автоматизации (триггеры по событиям):
CREATE TABLE automation_rules (
  id         uuid PRIMARY KEY,
  branch_id  uuid REFERENCES branches(id),
  -- event, conditions, actions — jsonb
  created_at timestamptz DEFAULT now()
);
```

---

## 11. Frappe CRM — идеи (не код)

### Модель лида
- Статусы — отдельная таблица `CRMLeadStatus` с полем `type` (Open/Lost/Qualified); это позволяет расширять статусы без миграций схемы.
- `lead_temperature`: Cold/Warm/Hot — дополнительная ось квалификации.
- `lead_score` (int) — скоринг, может обновляться автоматикой.
- `sla` / `sla_status` / `first_response_time` — SLA на первый ответ, трекается автоматически.
- При конвертации лид → сделка: копируются все поля через маппинг, создаётся Contact + Organization отдельно.

### Лента активности в карточке
Frappe собирает ленту из разных источников в одном запросе:
- изменения полей (из `Version` — doctype-level changelog),
- комментарии,
- письма / звонки / задачи,
- создание/конвертация как отдельный элемент.

Ключевая идея: **единый endpoint `get_activities(name)`** отдаёт хронологически упорядоченный список событий с `activity_type` (creation/field_change/comment/call/note/task). Фронт рендерит каждый тип своим компонентом.

### Канбан
- `column_field` + `title_field` + `kanban_fields` — конфиг через JSON в модели, без отдельной таблицы.
- Статусы — колонки канбана. Перетаскивание карточки = смена статуса.
- В SlimwayCRM это реализовано через `lead_funnels` (кастомные воронки) + `lead_funnel_columns`.

---

## 12. Что стоит взять vs что лишнее

### Взять (полезно для одного филиала)

| Что | Откуда | Почему |
|-----|--------|--------|
| Заморозка абонемента с продлением date_end | subscriptions.routes.ts | Точная логика уже написана, легко перенести |
| `buildSessionRestorePatch` — атомарный возврат сеансов при отмене | bookings-v2.routes.ts | Правильно обрабатывает все 4 слота за раз |
| Проверки промокода (обе: global + per-client) | sale.routes.ts | Оба кейса нужны |
| Каталог + intake (upsert на catalog_item_id) | warehouse.routes.ts | Не дублирует позиции склада при повторном приходе |
| Защита от минуса при списании склада | warehouse.routes.ts | Простая, надёжная |
| `client_pipeline` с 5 статусами | migration 033 | Хорошая замена тяжёлому kanban для одного менеджера |
| `audit_log` как источник итогов кассы | cash-shifts.routes.ts | Не нужна отдельная таблица транзакций |
| Идея единого `get_activities` endpoint | frappe-crm | Лента событий в карточке клиента — полезно |

### Лишнее для одного филиала

| Что | Почему |
|-----|--------|
| `branches` / мультифилиальность | Один филиал — лишний join везде |
| `subscription_transfers` (таблица) | Редкий кейс, можно логировать в audit_log |
| `automation_rules` / webhooks / api_keys | Избыточно для внутренней системы |
| SLA (frappe) | Нет SLA-требований у студии |
| `slot_waitlist` | Не реализована логика уведомлений |
| Разделение `profiles` и `employees` | Одна таблица `app_users` (уже есть в агенте) покрывает оба |
| `lead_temperature` / `lead_score` | Для одного менеджера избыточно |
| Frappe Contact + Organization как отдельные сущности | Клиент StudyWay = одна запись, нет B2B |
| `timesheet_entries` | Если табель ведётся вручную в смене |

---

## Приложение: схема SQL целиком (из миграций, без изменений)

Ниже — дословная копия CREATE TABLE из всех миграций slimway-backend, без правок и без запуска.

```sql
-- === 001_initial_schema ===
create extension if not exists "uuid-ossp";

create table branches (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  city          text,
  owner_id      uuid references auth.users(id),
  is_franchise  boolean default false,
  created_at    timestamptz default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  branch_id   uuid references branches(id),
  role        text not null check (role in ('owner','franchisee','admin','trainer')),
  full_name   text,
  phone       text,
  created_at  timestamptz default now()
);

create table clients (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id),
  full_name   text not null,
  phone       text,
  email       text,
  birth_date  date,
  notes       text,
  is_deleted  boolean default false,
  created_at  timestamptz default now()
);

create table memberships (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  branch_id       uuid not null references branches(id),
  type            text not null check (type in ('sessions', 'unlimited', 'period')),
  total_sessions  int,
  used_sessions   int default 0,
  start_date      date not null,
  end_date        date,
  price           numeric(10,2),
  status          text default 'active' check (status in ('active', 'frozen', 'expired')),
  created_at      timestamptz default now()
);

create table schedule (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id),
  trainer_id    uuid references profiles(id),
  title         text not null,
  starts_at     timestamptz not null,
  duration_min  int default 60,
  capacity      int default 10,
  created_at    timestamptz default now()
);

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid not null references schedule(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  membership_id   uuid references memberships(id),
  status          text default 'booked' check (status in ('booked', 'attended', 'cancelled')),
  created_at      timestamptz default now(),
  unique(schedule_id, client_id)
);

-- === 002_v1_2_0_schema ===
create table devices (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id) on delete cascade,
  type         text not null check (type in ('vacuactiv', 'rollshape', 'infrastep', 'infrashape')),
  number       text not null,
  device_group text not null default 'A' check (device_group in ('A', 'B')),
  status       text not null default 'active' check (status in ('active', 'maintenance', 'disabled')),
  created_at   timestamptz default now()
);

create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  branch_id             uuid not null references branches(id),
  name                  text not null,
  slot_1_type           text not null check (slot_1_type in ('vacuactiv', 'rollshape', 'infrastep', 'infrashape')),
  slot_1_duration_min   int  not null,
  slot_1_sessions_total int  not null,
  slot_1_sessions_left  int  not null,
  slot_2_type           text check (slot_2_type in ('vacuactiv', 'rollshape', 'infrastep', 'infrashape')),
  slot_2_duration_min   int,
  slot_2_sessions_total int,
  slot_2_sessions_left  int,
  date_start            date not null,
  date_end              date,
  price                 numeric(10,2),
  status                text not null default 'active' check (status in ('active', 'frozen', 'expired')),
  created_at            timestamptz default now()
);

create table schedule_slots (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id),
  device_id  uuid not null references devices(id) on delete cascade,
  date       date not null,
  time_start time not null,
  time_end   time not null,
  status     text not null default 'free' check (status in ('free', 'booked', 'blocked', 'maintenance')),
  booking_id uuid,
  created_at timestamptz default now(),
  unique(device_id, date, time_start)
);

create table bookings_v2 (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references clients(id),
  subscription_id          uuid not null references subscriptions(id),
  branch_id                uuid not null references branches(id),
  date                     date not null,
  slot_1_schedule_slot_id  uuid not null references schedule_slots(id),
  slot_2_schedule_slot_id  uuid references schedule_slots(id),
  created_by               uuid not null references profiles(id),
  created_at               timestamptz default now()
);

-- === 002_v1_4_x ===
-- subscriptions: soft delete
alter table subscriptions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);

-- clients: status
alter table clients
  add column if not exists status text not null default 'active'
    check (status in ('active', 'draft'));

create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid references branches(id),
  entity_type  text not null,
  entity_id    uuid not null,
  action       text not null,
  actor_id     uuid references auth.users(id),
  actor_name   text,
  details      jsonb,
  created_at   timestamptz default now()
);

-- === 003_subscription_templates ===
create table subscription_templates (
  id                    uuid primary key default gen_random_uuid(),
  branch_id             uuid not null references branches(id) on delete cascade,
  name                  text not null,
  slot_1_type           text not null check (slot_1_type in ('vacuactiv','rollshape','infrastep','infrashape')),
  slot_1_duration_min   int  not null,
  slot_1_sessions_total int  not null,
  slot_2_type           text check (slot_2_type in ('vacuactiv','rollshape','infrastep','infrashape')),
  slot_2_duration_min   int,
  slot_2_sessions_total int,
  validity_days         int  not null default 30,
  price                 numeric(10,2),
  is_active             boolean not null default true,
  created_at            timestamptz default now()
);

-- === 004_leads ===
CREATE TABLE IF NOT EXISTS leads (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id),
  full_name     text not null,
  phone         text,
  source        text default 'manual',
  status        text default 'new' check (status in ('new','in_work','waiting','success','fail')),
  assigned_to   uuid references profiles(id),
  notes         text,
  client_id     uuid references clients(id),
  created_by    uuid references profiles(id),
  archived_at   timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

CREATE TABLE IF NOT EXISTS lead_comments (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  author_id   uuid references profiles(id),
  text        text not null,
  created_at  timestamptz default now()
);

-- === 010_suppliers ===
CREATE TABLE IF NOT EXISTS suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name         text NOT NULL,
  contact_name text NULL,
  phone        text NULL,
  email        text NULL,
  notes        text NULL,
  created_at   timestamptz DEFAULT now()
);

-- === 012_client_freeze ===
ALTER TABLE clients ADD COLUMN IF NOT EXISTS freeze_until date NULL;

-- === 013_promo_codes ===
CREATE TABLE IF NOT EXISTS promo_codes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code           text        NOT NULL,
  discount_type  text        NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed', 'percent')),
  discount_value numeric     NOT NULL DEFAULT 0,
  max_uses       int         NULL,
  uses_count     int         NOT NULL DEFAULT 0,
  expires_at     date        NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

-- === 014_subscription_transfers ===
CREATE TABLE IF NOT EXISTS subscription_transfers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  from_client_id  uuid        NOT NULL REFERENCES clients(id),
  to_client_id    uuid        NOT NULL REFERENCES clients(id),
  transferred_by  uuid        NOT NULL REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- === 015_slot_waitlist ===
CREATE TABLE IF NOT EXISTS slot_waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- полная структура не видна в прочитанных файлах
  created_at timestamptz DEFAULT now()
);

-- === 019_supplier_orders ===
CREATE TABLE IF NOT EXISTS supplier_orders (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  supplier_id  uuid        NULL REFERENCES suppliers(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'delivered', 'cancelled')),
  notes        text        NULL,
  total_amount numeric     NULL,
  ordered_at   date        NOT NULL DEFAULT CURRENT_DATE,
  delivered_at date        NULL,
  created_by   uuid        NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid        NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  item_name  text        NOT NULL,
  quantity   int         NOT NULL DEFAULT 1,
  unit_price numeric     NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- === 025_promo_code_usages ===
ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS max_uses_per_client int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS promo_code_usages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id  uuid        NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  client_id      uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- === 033_client_pipeline ===
CREATE TABLE IF NOT EXISTS client_pipeline (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'new_client'
             CHECK (status IN ('new_client', 'active', 'frozen', 'expiring_soon', 'not_renewed')),
  position   INT NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, client_id)
);
```

> **Примечание:** таблицы `employees`, `tasks`, `shifts`, `cash_shifts`, `warehouse_items`, `warehouse_movements`, `catalog_items`, `timesheet_entries`, `branch_settings`, `automation_rules`, `api_keys` присутствуют в коде роутов и типах, но их `CREATE TABLE` находится в миграциях, которые не вошли в список файлов (или созданы в Supabase напрямую). Структура восстановлена из роутов и типов выше.
