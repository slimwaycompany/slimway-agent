# slimway-agent

Сервер агентов SlimWay. Этап 1А: агент пробных в DRY-режиме.

Стек: Node.js 20, TypeScript, Express, Supabase, nodemailer.
Хостинг: Render (free web service, будится через cron-job.org).

---

## Быстрый старт

```bash
npm install
cp .env.example .env   # заполнить значения
npm run build
npm start
```

---

## 1. Supabase — выполнить схему

В Supabase → SQL Editor → New query вставьте содержимое `supabase/schema.sql` и нажмите Run.

После выполнения:
- Включите Realtime для таблицы `agent_events`:
  **Supabase → Database → Replication → Tables → agent_events → Enable**.

---

## 2. Переменные окружения

| Переменная | Описание |
|---|---|
| `FITBASE_TOKEN` | Bearer-токен Fitbase API |
| `FITBASE_CLUB` | Клуб Fitbase (default: `slimway`) |
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role ключ Supabase |
| `CRON_SECRET` | Секрет для аутентификации cron-запросов |
| `AGENT_USER_ID` | ID пользователя «AI agent» в Fitbase (default: `40`) |
| `TASK_RESPONSIBLE_IDS` | Ответственные за задачи через запятую (default: `33,39,35`) |
| `TRIAL_AGENT_DRY_RUN` | `true` — не писать в Fitbase, только логировать (default: `true`) |
| `ALERT_EMAIL` | Адрес для алертов (default: `sergey.revnivcev@gmail.com`) |
| `SMTP_USER` | Gmail-аккаунт для отправки писем |
| `SMTP_PASS` | Пароль приложения Gmail |

---

## 3. Расписание cron-job.org

Все запросы используют заголовок `X-Cron-Secret: <CRON_SECRET>` или параметр `?key=<CRON_SECRET>`.

| Время (Almaty) | Расписание | URL | Назначение |
|---|---|---|---|
| 07:25 ежедневно | `25 2 * * *` (UTC) | `GET /health` | Разбудить Render |
| Каждые 5 мин, пн–пт 07:30–22:30 | настройте в cron-job.org | `GET /run/trial?key=...` | Агент пробных |
| Каждые 5 мин, сб–вс 07:30–21:00 | настройте в cron-job.org | `GET /run/trial?key=...` | Агент пробных (выходные) |
| Каждые 10 мин в рабочем окне | | `GET /health` | Не давать Render уснуть |
| 22:25 пн–пт | `25 17 * * 1-5` (UTC) | `GET /run/daily-summary?key=...` | Ежедневная сводка |
| 20:55 сб–вс | `55 15 * * 0,6` (UTC) | `GET /run/daily-summary?key=...` | Ежедневная сводка (выходные) |

> Сервер сам проверяет рабочее окно (07:30–22:30 будни, 07:30–21:00 выходные, Asia/Almaty).
> Запросы вне окна возвращают `{"status":"skipped"}` и записываются в `job_runs` со статусом `skipped`.

---

## 4. API

```
GET  /health              — проверка живости: { ok: true, time: "..." }
GET  /run/:job            — запуск задачи (X-Cron-Secret или ?key=)
POST /run/:job            — то же, POST-вариант
```

Ответы:
- `202 { status: "accepted" }` — задача принята, выполняется в фоне
- `200 { status: "already_running" }` — задача уже идёт (блокировка)
- `200 { status: "skipped" }` — вне рабочего окна
- `401` — неверный секрет
- `404` — неизвестная задача

---

## 5. Перенос памяти агента

1. Из Google Таблицы экспортировать лист `trial_state` как CSV.
2. Положить файл в `./import/trial_state.csv` (папка в `.gitignore`).
3. Запустить:

```bash
npm run import:trial-state
```

Скрипт выполняет upsert в `agent_state` и `agent_acted` — безопасно запускать повторно.

---

## 6. DRY-режим и сравнение решений

В DRY-режиме (`TRIAL_AGENT_DRY_RUN=true`) сервер:
- **Не пишет** в Fitbase (нет переходов, задач, комментариев)
- Пишет события в `agent_events` с `dry=true` и текстом `[DRY] Перевёл бы ...`

Сравнение с Apps Script:
- Сервер: `SELECT * FROM agent_events WHERE dry=true ORDER BY created_at DESC`
- Apps Script: лист `trial_log` в Google Таблице

---

## 7. Переключение на боевой режим

**Шаг 1 — Отключить Apps Script:**
```javascript
// В Apps Script: Config → TRIAL_AGENT_DRY_RUN → "true"
// Удалить триггеры: Setup.removeTrialTriggers()
```

**Шаг 2 — Включить сервер в боевом режиме:**
```
TRIAL_AGENT_DRY_RUN=false   # в Render → Environment
```

---

## 8. Деплой на Render

```bash
git init
git add .
git commit -m "Stage 1A: server skeleton, Supabase, trial agent (DRY), event log"
git branch -M main
git remote add origin https://github.com/slimwaycompany/slimway-agent.git
git push -u origin main
```

Render подхватит `render.yaml` автоматически при подключении репозитория.
