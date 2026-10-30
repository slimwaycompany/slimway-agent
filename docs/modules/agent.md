# Модуль: Агент воронки Fitbase

Чат в claude.ai: «Агент и овчарка» · Файл: `docs/modules/agent.md`

## Назначение
Правиловый агент (без платного ИИ) для воронки «Новые заявки» в Fitbase: двигает карточки пробных, ставит задачи, считает бюджет, шлёт сводки.

## Где код
- `src/http/fitbase.ts` — единственное место обращений к Fitbase API (rawGet, rawPost, пагинация, circuit breaker)
- `src/jobs/trial.ts` — агент пробных (`/run/trial`) — боевой
- `src/jobs/budget.ts` — модуль бюджета (`/run/budget`) — боевой
- `src/jobs/dailySummary.ts` — ежедневная сводка на email (`/run/daily-summary`)
- `src/jobs/watch.ts` — тревоги менеджерам (`/run/watch`): новые лиды, неявки, абонементы
- `src/jobs/watchBrief.ts` — утренняя сводка задач (`/run/watch-brief`)
- `src/jobs/newLeads.ts` — быстрый intake новых лидов (`/run/new-leads`, каждую минуту)
- `src/jobs/inactive.ts` — эскалация неактивных клиентов (`/run/inactive`)
- `src/jobs/lifecyclePlan.ts` — план жизненного цикла лидов Fitbase (`/run/lifecycle-plan`)
- `src/jobs/fitbaseOps.ts` — синхронизация операций Fitbase (`/run/fitbase-ops`)
- `src/jobs/fitbaseCrmSync.ts` — синхронизация лидов и визитов (`/run/fitbase-crm-sync`)
- `src/jobs/probeLtv.ts`, `probeContracts.ts`, `probeUnsorted.ts`, `probeTasks.ts` — диагностические зонды
- `src/core/events.ts` — `logEvent` → `agent_events`

## Таблицы
- `agent_events` — лента действий агента (dry / боевые), все типы событий
- `lifecycle_plan` — план агента жизненного цикла (карточки Fitbase)
- `fitbase_clients_cache` — кэш клиентов Fitbase (phone, phone_digits, name, fitbase_client_id)
- `fitbase_leads` — лиды из Fitbase (для синхронизации и метрик)
- `fitbase_visits` — визиты из Fitbase (для синхронизации и метрик)
- `fitbase_operations` — операции кассы Fitbase (продажи, возвраты, внесения)
- `watch_alerts` — тревоги для менеджеров
- `sync_state` — метки последней синхронизации (key/value)
- `job_runs`, `job_locks` — запуски задач

## Ключевые решения
- Агент пробных и бюджет — боевой режим. Бюджет: 69 000 для «Новые заявки» / «Реактивация»; LTV = purchase_amount клиента для «Новички» / «Постоянные».
- Fitbase: `page_size` ≤ 100, пагинация до пустой страницы, пауза 300–500 мс между страницами, 4xx не ретраить, circuit breaker.
- DRY-флаги: `TRIAL_AGENT_DRY_RUN`, `BUDGET_DRY_RUN`, `INACTIVE_DRY_RUN` — ничего не менять в Fitbase.
- Агент жизненного цикла (`lifecyclePlan`) — без DRY-флага, не запускать без явной просьбы Сергея.
- Менеджер клиента в сводке = залогиненный пользователь (display_name из сессии).

## Сделано
### до 28.10.2026 · 5ef230a · базовый сервер + агент пробных (DRY)
- Stage 1A: сервер, Supabase, агент пробных в DRY.

### до 28.10.2026 · dd065c3 · бюджет
- Budget module, LTV probe, боевой режим бюджета.

### до 28.10.2026 · 2175134 · улучшения агента пробных
- Дедупликация задач на стороне Fitbase, короткие имена, фикс дат.

### до 28.10.2026 · e048fb3 · тревоги Watch
- Watch: NO_SHOW только сегодня, CONTRACT_ENDED за 14 дней, имена клиентов, flood guard.

### до 28.10.2026 · 6a264e0 · синхронизация операций Fitbase
- `fitbaseOps.ts`, `/run/fitbase-ops`, sync_state.

### 30.10.2026 · 55dc7a4 · syncLeads fix + syncContracts
- `syncLeads`: `manager = l.manager.full_name` (был `responsible` → всегда null); `client_fitbase_id = l.client_id` (был `client.id` → null); `client_name = l.name + l.surname`; `client_phone = normalizePhone(l.phone)`.
- Новая функция `syncContracts`: собирает уникальные client_fitbase_id из `fitbase_operations` (raw.item_type='contract'), для каждого запрашивает `GET /client-contract?client_id=…`, upsert в `fitbase_contracts`. Пауза 300–500 мс между запросами, 4xx не ретраит.
- `runFitbaseCrmSync` теперь возвращает `{ leads, visits, contracts }`.

### 29.10.2026 · (предыдущий) · syncVisits fix — client_id, time, resource, manager, abonement
- `syncVisits`: `client_fitbase_id = v.client_id` (не `v.client.id`); `time_start "08:00:00"` → slice 0..5 (был RangeError); `resource = event.place.name`; `manager = event.trainers[0].full_name`; `abonement` из `client_service`/`client_contract`; `is_trial` через `isTrialServiceName()`; batch-fetch имён из `fitbase_clients_cache`.

### до 28.10.2026 · 44f8e05 · fitbaseCrmSync
- Синхронизация лидов и визитов; MetricsPage воронка.

## Открытые баги
- (нет известных)

## Следующее (по порядку из дорожной карты)
1. Надёжность: сторож «агент жив» (письмо, если trial не запускался 30+ мин в рабочее время), circuit breaker на повторные ошибки Fitbase.
2. Логика агента пробных: задачи менеджеру карточки, а не всем троим; учитывать свежий комментарий; перезапись «Не пришёл» → «Записался»; покупка ≥ 40 000 → «Успех» с бюджетом.
3. Агент жизненного цикла: исправить план (60 карточек ошибочно в «Вечность» и др.), потом боевой.
4. Поиск дублей; синхронизация TikTok на сервер; вебхуки Fitbase (если появятся).
- Эскалация неактивных клиентов: день 7 — задача «Звонок» кассиру; день 10 — всем троим менеджерам; день 14 — в сводку Сергея.
