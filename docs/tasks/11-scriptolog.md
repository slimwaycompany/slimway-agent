# Задача 11 — Скриптолог SlimWay

Chrome-расширение + страница на сервере агента для работы по дереву скриптов продаж.

## Части

Полный текст ТЗ — в сообщении Сергея от 26.10.2026 (Parts 0–9).

### Часть 1 — как устроен чат Fitbase (исследование, проверено)
- Уже описано в ТЗ, используется при написании контент-скрипта.

### Часть 2 — Дерево скриптов → JSON
- `docs/sales-tree.md` → `scripts/sales-tree.json`
- Сервер: `GET /api/scriptolog/tree`
- **⛔ БЛОКИРУЕТ**: файл `docs/sales-tree.md` отсутствует в репозитории. Нужен от Сергея.

### Часть 3 — Факты о клиентке
- Хранятся в `script_clients.facts` (jsonb) + события типа `fact` в `script_events`
- Ключи: goal, experience, experience_fail_reason, limitations, time_of_day, competitor_end_date, referrer_name, refusal_reason

### Часть 4 — Сервер API
- `POST /api/scriptolog/login` — вход, возвращает токен в теле ответа
- `GET /api/scriptolog/tree` — дерево скриптов
- `POST /api/scriptolog/client` — получить/создать клиентку
- `POST /api/scriptolog/event` — записать событие
- `POST /api/scriptolog/bind-phone` — привязать телефон / слить

### Часть 5 — UI страница `/scriptolog`
- Панель ~360–450 px, glassmorphism
- Вкладки: Скрипт | Возражения | Справочник | История

### Часть 6 — Авторизация
- Bearer токен (не cookie) — для iframe в расширении
- `/api/scriptolog/login` совместим с `makeToken` из `src/http/auth.ts`
- CSP `frame-ancestors 'self' chrome-extension://*` только на `/scriptolog`

### Часть 7 — Расширение (Manifest V3)
- `extension/` в репозитории, не в сборку сервера
- Файлы: manifest.json, background.js, selectors.js, easychat.js, fitbase.js, sidepanel.html, sidepanel.js, README.md

### Часть 8 — НЕ реализовывать сейчас
- Автоопределение стартового узла
- Авто-шаг по факту отправленного сообщения
- Таймеры, автопостановка этапов в Fitbase
- Подстановка свободных окон, редактор скриптов

## SQL (уже выполнен Сергеем)
- Таблицы `script_clients` и `script_events` — уже в Supabase

## Статус
🔧 в работе (Claude, 26.10.2026)
