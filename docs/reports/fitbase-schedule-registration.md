# Fitbase /schedule-registration — структура записей

Дата зонда: 2026-11-27  
Скрипт: `src/jobs/probeFitbaseSchedule.ts`

## Топ-уровень (`r.*`)

| Поле | Тип | Пример |
|------|-----|--------|
| `id` | int | 123456 |
| `client_id` | int | Fitbase client id |
| `status` | int | 0–4 |
| `event` | object | см. ниже |
| `client_service` | object \| null | ссылка на услугу |
| `client_contract` | object \| null | `{ id: N }` — fitbase_contract_id |
| `created_at` | str | ISO timestamp |
| `updated_at` | str | ISO timestamp |
| `is_archive` | bool | |
| `auto_delete_time` | str \| null | |

TOP_KEYS: `id, client_id, status, event, client_service, client_contract, created_at, updated_at, is_archive, auto_delete_time`

## Статусы

| Код | Значение |
|-----|----------|
| 0 | booked (записан) |
| 1 | confirmed (подтверждён) |
| 2 | cancelled (отменён / отказ) |
| 3 | attended (посетил) |
| 4 | no_show (не пришёл) |

## Поля события (`r.event.*`)

EVENT_KEYS: `id, training, place, trainers, club, event_type, pay_type, age_type, date, time_start, time_end, duration, cancel, stop_registration, need_register, max_register, created_at, updated_at, transferEvent, registrations_count, is_archive`

| Поле | Тип | Пример |
|------|-----|--------|
| `date` | str | `"2024-03-15"` (UTC+5) |
| `time_start` | str | `"10:00:00"` (UTC+5) |
| `time_end` | str | `"10:30:00"` (UTC+5) |
| `duration` | int | 30 (минуты) |
| `training.name` | str | `"Пробное занятие"`, `"Vacuactiv"`, … |
| `place.name` | str | `"Vacuactiv 1"`, `"Rollshape 2"`, … |
| `place.id` | int | |
| `trainers` | array | тренеры сессии |
| `event_type` | object | тип события |

PLACE_KEYS: `id, name, created_at, updated_at, is_archive, club`

## Определение аппарата (Fitbase place → crm_devices)

Формат: `"<ТипАппарата> <Номер>"`, например `"Vacuactiv 1"`.

| Fitbase place | type_code | number |
|---------------|-----------|--------|
| Vacuactiv 1–3 | vacuactiv | 1–3 |
| Rollshape 1–4 | rollshape | 1–4 |
| Infrashape 1 | infrashape | 1 |
| Infrastep 1 | infrastep | 1 |

Алгоритм: разбить по последнему пробелу → `typeCode = lowercase(часть без числа)`, `number = последнее слово`.  
Если реальный аппарат не найден → первый виртуальный того же типа.

## Определение вида записи

- `event.training.name ILIKE '%пробн%'` → `kind = 'free'`, `plan_id = b86b4718-...` (системный «Пробное занятие»)
- Иначе → `kind = 'regular'`

## Соответствие полей crm_bookings

| crm_bookings | Fitbase |
|---|---|
| `fitbase_reg_id` | `r.id` |
| `booking_date` | `event.date` |
| `starts_at` | `${event.date}T${event.time_start}+05:00` → UTC ISO |
| `ends_at` | `${event.date}T${event.time_end}+05:00` → UTC ISO |
| `device_id` | из маппинга place → crm_devices |
| `device_type_code` | из маппинга |
| `client_id` | crm_clients.fitbase_client_id = r.client_id |
| `status` | 0→booked, 1→confirmed, 2→cancelled, 3→attended, 4→no_show |
| `kind` | free / regular |
| `plan_id` | TRIAL_PLAN_ID для free, null для regular |
| `session_burned` | true если attended |
| `note` | event.training.name |
| `created_by` | 'fitbase_import' |

## Требуемый SQL (если ещё не выполнен)

```sql
ALTER TABLE crm_bookings ADD COLUMN IF NOT EXISTS fitbase_reg_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS crm_bookings_fitbase_reg_id_key
  ON crm_bookings(fitbase_reg_id)
  WHERE fitbase_reg_id IS NOT NULL;
```
