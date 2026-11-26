# SQL для Supabase (выполняет Сергей) — 25.11.2026

Выполнять в Supabase → SQL Editor по одному блоку. Все блоки можно запускать повторно, ничего не ломают.

## Блок 1 — перед ТЗ 99 (метки)
```sql
insert into crm_client_auto_labels (code, name, short_name, color, sort, is_active, params) values
  ('payment_needed',  'Нужна оплата',        'Оплата',    '#e11d48', 95, true,  '{}'::jsonb),
  ('payment_overdue', 'Просрочка по оплате', 'Просрочка', '#b91c1c', 96, false, '{}'::jsonb)
on conflict (code) do nothing;
update crm_client_auto_labels set name = 'Частичная оплата' where code = 'debt';
update crm_client_auto_labels set params = coalesce(params,'{}'::jsonb) || '{"days":7}'::jsonb
 where code in ('measure_inbody','measure_body');
select code, name, is_active, params from crm_client_auto_labels order by sort;
```
Если первая строка упадёт с ошибкой про `on conflict` — пришлите текст ошибки, поправлю.

## Блок 2 — Контроль (спор по нарушению и статус «нет данных»)
```sql
alter table control_violations drop constraint if exists control_violations_status_check;
alter table control_violations add constraint control_violations_status_check
  check (status in ('open','fixed','waived','failed','disputed'));

alter table control_shift_scores drop constraint if exists control_shift_scores_result_check;
alter table control_shift_scores add constraint control_shift_scores_result_check
  check (result in ('ok','fixed','pending','fail','not_reviewed','off','no_data'));
```

## Блок 3 — АТС (OnlinePBX)
```sql
create table if not exists pbx_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  branch_id   uuid references crm_branches(id),
  event       text,
  call_uuid   text,
  payload     jsonb,
  processed   boolean not null default false,
  error       text
);
create index if not exists pbx_events_call_uuid_idx on pbx_events(call_uuid);

create table if not exists pbx_calls (
  call_uuid         text primary key,
  branch_id         uuid references crm_branches(id),
  direction         text check (direction in ('inbound','outbound','internal')),
  status            text check (status in ('ringing','answered','ended','missed')),
  client_phone      text,
  phone_digits      text,
  extension         text,
  user_name         text,
  started_at        timestamptz,
  answered_at       timestamptz,
  ended_at          timestamptz,
  talk_seconds      integer,
  record_url        text,
  lead_id           uuid,
  fitbase_client_id bigint,
  raw_last          jsonb,
  updated_at        timestamptz not null default now()
);
create index if not exists pbx_calls_phone_idx on pbx_calls(phone_digits);
create index if not exists pbx_calls_started_idx on pbx_calls(started_at);

create table if not exists pbx_extensions (
  branch_id  uuid not null references crm_branches(id),
  extension  text not null,
  user_name  text not null,
  updated_at timestamptz not null default now(),
  primary key (branch_id, extension)
);

alter table pbx_events     enable row level security;
alter table pbx_calls      enable row level security;
alter table pbx_extensions enable row level security;
```
Если таблицы уже есть, блок их не тронет. Значения `direction` и `status` взяты из кода (`src/http/pbx.ts`).
После SQL добавьте на Render переменную `PBX_WEBHOOK_SECRET` (любая длинная случайная строка).

## Блок 4 — Скриптолог (ошибки напоминаний)
```sql
alter table script_reminders add column if not exists error text;
```

## Блок 5 — Телефоны клиентов CRM в старом формате (+7 → 7)
```sql
select count(*) from crm_clients where phone like '+%';
update crm_clients set phone = regexp_replace(phone, '^\+', '') where phone like '+%';
```

## Блок 5а — Telegram-бот: телефон тестовой клиентки
Номер был записан в имя. В `name` подставьте её настоящее имя.
```sql
update body_clients
   set phone = '+77756802316', name = 'ИМЯ ФАМИЛИЯ'
 where id = '1bf35666-f089-4608-8712-9e1f85b4727e';
select id, name, phone, phone_digits from body_clients where id = '1bf35666-f089-4608-8712-9e1f85b4727e';
```

## Блок 6 — пришлите мне результат (для ТЗ предоплаты, рассрочки и возвратов)
Тут ничего не меняется, это только чтение. Скопируйте результат обоих запросов в чат.
```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('crm_checkout','crm_refund');
```
```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('crm_sales','crm_sale_items','crm_sale_payments','crm_refunds','crm_refund_items',
                     'crm_refund_payments','crm_client_plans','crm_payment_methods','crm_balance_ops')
order by table_name, ordinal_position;
```
