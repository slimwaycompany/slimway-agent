Модуль: crm-core

# Задача 84 — Карточка клиента v2: этап 1 — разведка Fitbase (продажи, оплаты, сеансы)

Этап 1 из 4. Только чтение: ничего не пишем в Fitbase, ничего не пишем в Supabase.

## Часть 1 — Зонд Fitbase: продажи, оплаты, сеансы

Зонд `src/jobs/probeClientHistory.ts`, маршрут `GET/POST /run/probe-client-history`.

Параметры: `client_ids` (через запятую) или `phone`. По умолчанию — 8 разных клиентов.
Включая клиента 87767681579.

Что исследовать:
- `/client-contract?client_id=`: поля абонемента (название, цены, даты, статус, состав, visits_left, заморозки)
- `/till-order-steps?client_id=`: оплаты (сумма, способ, кассир, менеджер, дата, item_type, связь с contract_id)
- `/schedule-registration?client_id=`: визиты (статус, связь с абонементом, contract_id в визите)
- Возвраты: где видны (operation_type=refund в till-order-steps?)
- Товары: есть ли отдельный эндпоинт продаж товаров клиенту
- Заморозки: поля в contract или отдельный эндпоинт
- Общий подсчёт: сколько клиентов, абонементов, визитов (для оценки времени полной выгрузки)

## Часть 2 — Связка с InBody и замерами

SELECT-запросами через зонд:
- Количество crm_clients (is_deleted=false)
- Совпадения с body_clients по 10 цифрам телефона
- Дубли в crm_clients по телефону
- Несовпадения (ФИО разные, телефон один)
- inbody_tests без body_clients

## Часть 3 — Отчёт

Результат: `docs/research/fitbase-client-history.md`.
Маппинг: какое поле Fitbase → в какую нашу таблицу. Список недостающих колонок (SQL не писать).

## Часть 4 — Проверка, документация, деплой

```bash
npm run build
git add -A
git commit -m "crm-core: task 84 — зонд истории клиента Fitbase (продажи, оплаты, сеансы) + подсчёт связки с InBody, только чтение"
git push origin main
```
