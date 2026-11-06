Модуль: control

# Задача 40 — Контроль менеджеров: «5п»

Дата постановки: 06.11.2026  
Статус: в работе

## Части

| # | Часть | Файлы |
|---|-------|-------|
| 0 | Подготовка, чтение docs, SQL уже выполнен | — |
| 1 | Зонд Fitbase API | `src/jobs/probeControl.ts`, `docs/reports/control-fitbase-probe.md` |
| 2 | Настройки «Контроль менеджеров» | `src/http/control.ts` (GET/PUT /settings), SettingsPage.tsx |
| 3 | Движок: общее | `src/jobs/control.ts`, `src/index.ts` |
| 4 | Пять стандартов | `src/jobs/control.ts` |
| 5 | Итог смены | `src/jobs/control.ts` |
| 6 | Отчёт «Контроль 5п» | `src/http/control.ts` (API), `ReportsPage.tsx` |
| 7 | Скриптолог: шаблон комментария | `public/scriptolog.html` |
| 8 | Расписание, документация, коммит | docs |

## Расписание для cron-job.org (добавить Сергею вручную)

- **POST** `/run/control` — каждые 10 мин, 08:00–23:00 Almaty; заголовок `x-cron-secret: <CRON_SECRET>`
- **POST** `/run/control?finalize=1` — каждый день в 07:55 Almaty; заголовок `x-cron-secret: <CRON_SECRET>`
- Часовой пояс: `Asia/Yekaterinburg` (UTC+5)
