Модуль: scriptolog

Статус: 13.11.2026 — общее ТЗ: эндпоинт Fitbase в напоминаниях + обновление токена EasyChat.

═══════════════════════════════════════

ЧАСТЬ 0 — Подготовка

- Прочитай CLAUDE.md, docs/STATE.md, docs/modules/scriptolog.md, docs/QUEUE.md, extension/background.js, extension/sidepanel.js, extension/easychat.js.
- SQL не нужен.

═══════════════════════════════════════

ЧАСТЬ 1 — Напоминания: неверный эндпоинт Fitbase

- Проверка 13.11 (job_runs 41210): `GET /visit?date_from=…&date_to=…` → 404 «Страница не найдена». Такого эндпоинта в Fitbase нет.
- В src/jobs/scriptologReminders.ts заменить '/visit' на '/schedule-registration' с теми же параметрами (page_size ≤ 100, date_from, date_to) — так же, как syncVisits в src/jobs/fitbaseCrmSync.ts (включая разбивку на окна при 400).
- Поля записи брать как в syncVisits: client_id, status (строка/число: '0' записан, '1' подтверждён, '2' отменён, '3' пришла, '4' не пришла — REG_STATUS_* в src/config.ts), event.date, event.time_start, event.training. Сравнивать статус через Number() или константы REG_STATUS_*.
- Если поле в ответе отличается от ожидаемого — вывести один пример записи (без телефона) в лог и подогнать код под реальный ответ.

═══════════════════════════════════════

ЧАСТЬ 2 — Токен уходит на сервер из background, а не из боковой панели

- Найдено 13.11: токен EasyChat меняется (на сервере был от 11.11, в чате уже другой). sidepanel.js отправляет токен только на storage.onChanged и только пока открыта панель. Если токен сменился при закрытой панели — сохраняется в chrome.storage, но на сервер не уходит (sendStateToPage серверу его не шлёт).
- extension/background.js, обработчик easychat-token:
  - сохранить в chrome.storage.local.easychatToken;
  - если токен ≠ easychatTokenSent ИЛИ с последней отправки > 30 мин → POST https://slimway-agent.onrender.com/api/scriptolog/easychat-token с Authorization: Bearer <authToken> прямо из background;
  - 200 → easychatTokenSent = token, easychatTokenSentAt = now; ошибка → не записывать (повтор при следующем сообщении);
  - нет authToken → только сохранить, отправить при входе.
- При входе в скриптолог (сообщение login) → если есть неотправленный easychatToken — отправить сразу.
- easychat.js — слать токен в background при загрузке фрейма и раз в 10 минут (setInterval).
- sidepanel.js — убрать sendEasyTokenToServer и ветку changes.easychatToken.
- manifest.json — host_permissions для slimway-agent.onrender.com, если нужно; version +0.0.1.

═══════════════════════════════════════

ЧАСТЬ 3 — Сервер

- POST /api/scriptolog/easychat-token: тот же токен — не перезаписывать value, только updated_at. В лог — без токена.
- scriptologReminders: при «EasyChat token invalid» тревога с текстом «Токен EasyChat устарел. Откройте ФитБейс Чат в браузере с расширением Скриптолог».

═══════════════════════════════════════

ЧАСТЬ 4 — Документация, коммит

- npm run build без ошибок.
- extension/README.md: «После обновления — ⟳ в chrome://extensions. Токен EasyChat обновляется сам, когда открыт ФитБейс Чат и выполнен вход в Скриптолог».
- Обнови docs/modules/scriptolog.md, docs/STATE.md и docs/QUEUE.md по разделу 8 CLAUDE.md. В «Ключевые решения»: токен EasyChat меняется, обновляется из background при каждом открытии чата.
