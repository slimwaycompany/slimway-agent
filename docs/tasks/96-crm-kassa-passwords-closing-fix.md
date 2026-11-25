Модуль: crm-kassa, manager, reports, logins

# Задача 96 — Пароли кассы, покупюрная ведомость, фикс импорта цен

## Часть 0 — SQL (нужно выполнить в Supabase SQL Editor до запуска)

```sql
alter table crm_branches
  add column if not exists kassa_sales_pass_hash text,
  add column if not exists kassa_full_pass_hash text,
  add column if not exists kassa_failed_attempts integer not null default 0,
  add column if not exists kassa_locked_at timestamptz;

alter table crm_cash_shifts
  add column if not exists closing_no integer,
  add column if not exists closing_doc jsonb,
  add column if not exists closing_doc_at timestamptz,
  add column if not exists cash_count jsonb;

create table if not exists crm_kassa_auth_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  branch_id uuid references crm_branches(id),
  user_login text,
  user_name text,
  mode text,
  event text not null
);
```

## Часть 1 — Пароли кассы

Вкладка «Касса» открывается с оверлеем ввода пароля (`KassaAuthOverlay`).

Режимы доступа:
- `sales` — открытие/закрытие смены (с покупюрной ведомостью), продажа
- `full` — все функции кассы
- `master` — то же что full + сбрасывает локаут

Сервер:
- POST `/kviz/api/crm/kassa/auth` — сравнение bcryptjs, возвращает HMAC-токен (12ч, `kv:1`, подпись с `kassa.` prefix)
- POST `/kviz/api/crm/kassa/set-password` — требует `settings.kassa_passwords` edit
- GET `/kviz/api/crm/kassa/status` — статус блокировки
- POST `/kviz/api/crm/kassa/unlock` — сброс блокировки (только full/master)

Безопасность:
- Пароль открытым текстом **нигде** в коде, логах, документации и тестах не писать
- Нет `KASSA_MASTER_PASSWORD_HASH` в env — мастер-пароль просто не работает, без ошибок
- Клиент хранит токен **только в памяти React** (не localStorage/sessionStorage/cookie)
- 5 неверных попыток → `kassa_locked_at` устанавливается; разблокирует только full/master

Режим `sales` блокирует на сервере (403): движения, возвраты, бонусы.

## Часть 2 — Покупюрная ведомость при закрытии смены

`CloseShiftWithDoc` вместо `CloseShiftModal`:
- Купюры: 20000, 10000, 5000, 2000, 1000, 500
- Монеты: 200, 100, 50, 20, 10, 5, 2, 1
- Ожидаемая наличность с сервера: `GET /shifts/:id/closing-data`
- Сохраняет `closing_doc` JSON, `cash_count`, `closing_no`, `closing_doc_at`
- Печать через `iframe.srcdoc`
- Excel-шаблон: `GET /kviz/api/cash/closing-template`

`closing_no` = max(crm_cash_shifts.closing_no, cash_closings.number) + 1

Перенесено из ManagerPage — кнопка «Закрытие смены» удалена из Менеджера.

Раздел «Закрытия кассы» в Отчётах (право `kassa.closings`):
- Список закрытых смен (дата, номер, итоги)
- Детальный модал с покупюрной ведомостью
- Кнопка печати

## Часть 3 — Фикс импорта цен (~515 продаж с total=0)

Эндпоинт `/run/crm-import-fix-prices?mode=dry|apply`:
- Находит `crm_sales` с `total=0` и `fitbase_order_id IS NOT NULL`
- Связывает с `fitbase_operations` через `(raw->>'order_id')::bigint = fitbase_order_id`
- Обновляет `total`, `items`, `payments` если не dry

## Часть 4 — Настройки, права, документация, сборка, коммит

- Раздел «Пароли кассы» в Настройках (группа «money», право `settings.kassa_passwords`)
- Права `kassa.closings` и `settings.kassa_passwords` в PERM_CATALOG и пресетах
- `npm run build` без ошибок
- Обновлены docs/modules/crm-kassa.md, manager.md, reports.md, logins.md, STATE.md, QUEUE.md
