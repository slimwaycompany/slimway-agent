# slimway-agent

Сервер студии SlimWay: агент воронки Fitbase, рабочее окно для сотрудников, скриптолог для чата и своя CRM (касса, клиенты, расписание), на которую студия позже переедет с Fitbase.

Стек: Node.js 20, TypeScript, Express, Supabase (Postgres), React (Vite) для вкладок, nodemailer.
Хостинг: Render (free web service, будится через cron-job.org). Адрес: https://slimway-agent.onrender.com

---

## Где что описано

| Файл | Что там |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Правила проекта для ИИ-агентов (одинаковые). Читать первым. |
| `docs/STATE.md` | Карта модулей: статус, последнее изменение, какой чат отвечает |
| `docs/modules/*.md` | Подробно по каждому модулю: где код, таблицы, решения, что сделано, баги, что дальше |
| `docs/QUEUE.md` | Очередь задач и журнал |
| `docs/tasks/` | Полные ТЗ |
| `docs/crm-reference-map.md` | Сводка по старой SlimWay CRM и Frappe CRM (только идеи) |
| `docs/sales-tree.md` | Дерево скриптов продаж (исходник для скриптолога) |
| `extension/README.md` | Установка расширения «Скриптолог» для менеджеров |

---

## Быстрый старт

```bash
npm install
cp .env.example .env   # заполнить значения
npm run build
npm start
```

---

## Переменные окружения

| Переменная | Описание |
|---|---|
| `FITBASE_TOKEN` | Bearer-токен Fitbase API |
| `FITBASE_CLUB` | Клуб Fitbase (default: `slimway`) |
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role ключ Supabase |
| `CRON_SECRET` | Секрет для cron-запросов |
| `AGENT_USER_ID` | ID пользователя «AI agent» в Fitbase (default: `40`) |
| `TASK_RESPONSIBLE_IDS` | Ответственные за задачи через запятую |
| `TRIAL_AGENT_DRY_RUN`, `BUDGET_DRY_RUN`, `INACTIVE_DRY_RUN` | `true` — ничего не писать в Fitbase, только логировать |
| `WATCH_RULES`, `WATCH_REG_SCOPE` | Правила и область проверки овчарки |
| `ALERT_EMAIL`, `SMTP_USER`, `SMTP_PASS` | Письма-алерты |
| `SHIFTS_SHEET_WEBHOOK_URL`, `SHIFTS_SHEET_SECRET` | Выгрузка отметок смены в Google Таблицу |
| `RESULTS_DISPLAY_KEY` | Ключ экрана результатов студии (ТВ) |

---

## Расписание cron-job.org

Все запросы с заголовком `X-Cron-Secret: <CRON_SECRET>` или параметром `?key=<CRON_SECRET>`. Время — Asia/Yekaterinburg (UTC+5).

| Время | URL | Назначение |
|---|---|---|
| 07:25, 07:35, 07:45, 07:55 | `GET /health` | Разбудить Render |
| каждые 5 мин, 08:00–22:00 | `GET /run/trial` | Агент пробных |
| каждые 5 мин в рабочее время | `GET /run/watch` | Овчарка: тревоги |
| 08:00 | `GET /run/watch-brief` | Утренний брифинг |
| 8, 10, …, 22 ч | `GET /run/budget` | Бюджет карточек |
| 22:25 пн–пт, 20:55 сб–вс | `GET /run/daily-summary` | Ежедневная сводка |

Сервер сам проверяет рабочее окно: запросы вне окна возвращают `{"status":"skipped"}` и пишутся в `job_runs`.

---

## Рабочее окно

- `/login` — вход по личному логину (`app_users`, роли admin / manager).
- `/` — вкладки: Менеджер → Агент → Расписание → Клиенты → Воронка → Касса → Квалификация → Замеры → Отчёты → Настройки (только admin).
- Подробности по каждой вкладке — `docs/modules/`.

---

## API (служебное)

```
GET  /health      — проверка живости
GET  /run/:job    — запуск задачи (X-Cron-Secret или ?key=)
POST /run/:job    — то же
```

Ответы: `202 accepted` — принята; `200 already_running` — уже идёт; `200 skipped` — вне окна; `401` — неверный секрет; `404` — неизвестная задача.

---

## DRY-режим

При `*_DRY_RUN=true` сервер не пишет в Fitbase, а пишет события в `agent_events` с `dry=true` и текстом `[DRY] Перевёл бы ...`.

---

## Деплой

`git push origin main` → Render подхватывает автоматически (`render.yaml`). Проверять результат на живом сайте.
