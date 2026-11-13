# Модуль: Скриптолог (расширение для чата Fitbase)

Чат в claude.ai: «Скриптолог» · Файл: `docs/modules/scriptolog.md`

## Назначение
Chrome-расширение: боковая панель рядом с чатом Fitbase, менеджер идёт по дереву скриптов продаж, вставляет фразы в поле ввода одной кнопкой, отмечает ответы клиентки; история и факты о клиентке пишутся в нашу базу.

## Где код
- `extension/` — расширение MV3 (manifest, sidepanel, `easychat.js`, `fitbase.js`, `selectors.js`, README)
- `public/scriptolog.html` — страница панели (embed в iframe), API `/api/scriptolog/*`
- `docs/sales-tree.md` — исходник дерева; `scripts/sales-tree.json` — дерево для панели; `scripts/check-tree.js` — 10 проверок; `npm run check-tree`
- `docs/reports/sales-tree-kk-review.md` — отчёт по KZ-переводам

## Таблицы
- `script_clients` — клиентка (client_key: `phone:7XXXXXXXXXX` или `chat:<канал>:<имя>`), current_node, status (`active|confirmed_trial`), facts jsonb, vars jsonb, менеджеры, merged_into
- `script_events` — события (start / insert / copy / sent / answer / fact / jump / confirm / merge и др.)
- `script_promo` — текущая акция (name, valid_from/to, is_active, rule_text, credit_text)
- `script_promo_packages` — пакеты (kind: `vacu|cross`; main_phase: `vacu_fixed|choice`; payment_methods jsonb; goals jsonb; is_archived)
- `script_materials` — ресурсы (key: 7 фиксированных значений; kind: `video|file|link`; url; label); bucket `scriptolog-materials`
- `script_reminders` — напоминания; status: `pending|scheduled|sent|skipped|cancelled|failed`; kind: 9 значений (trial_24h/trial_3h/trial_1h/after_trial_*/silent_*/material); dedupe_key: `kind:visit_id:YYYYMMDDHHmm`; колонки: client_key, kind, status, lang, dedupe_key, due_at, send_at, message_text, fitbase_visit_id, easychat_delayed_id, easychat_dialogue_id, error

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Чат Fitbase = EasyChat (`chat.easychat.ru`) во фрейме `#easychatIframe`; контент-скрипт работает внутри фрейма (all_frames).
- Селекторы (классы хэшированные): поле `textarea[placeholder="Введите текст сообщения"]`; имя `[class*="_name-row_"] h4`; телефон `[class*="_bio_"] [class*="_status_"]`; сообщения `[class*="_message-list_"]` / `[class*="_message-item_"]` / `[class*="_own_"]`. URL при смене диалога не меняется → MutationObserver.
- Вставка: нативный setter value + событие input. Расширение НИКОГДА не отправляет сообщение само.
- Вход в панели по Bearer-токену (cookie в iframe расширения ненадёжны), frame-ancestors для chrome-extension.
- Блок 5 и узлы 6.1–6.9 — только справочник. Узлы 6.1, 6.7 и бонус в 7.6 — «уточняется».
- Факты: цель, опыт, причина неудачи, ограничения, удобное время, дата окончания у конкурента, кто порекомендовал, причина отказа.
- RU/KZ: `S.lang` в панели, `vars.lang` в базе. KZ-текст из `text_kk` / `variants[].text_kk` / `answers[].reply_kk`. Под KZ — мелкий серый RU-оригинал.
- Хабы: 1.1, 3.1, 6.1 имеют `hub: true`. Кнопка «↩ К развилке» всегда в узле, открывает меню из 3 развилок.
- Чтение переписки: MutationObserver в easychat.js → `chrome.runtime.sendMessage(chat-message)` → background (storage queue) → sidepanel → iframe. Текст в базу не пишется.
- Автостарт: первое входящее сообщение → предложение «Начать с N?» на экране выбора входа.
- KZ-детект: буквы әғқңөұүһі в входящем → плашка в панели.
- Sent detection: вставленный текст сопоставляется с исходящим сообщением → автопереход к выбору ответа.
- Диагностика: вкладка «Диагностика» видна только admin-роли (decoded из JWT), показывает последние 20 сообщений.
- Звонковая «Квалификация» отдельно, не трогаем.

## Мобильная версия
Задача 34 (04.11.2026): Скриптолог открывается в iframe расширения Chrome. Вёрстка `/scriptolog` не затрагивалась. Расширение использует фиксированную ширину боковой панели браузера — адаптив здесь не актуален.

## Сделано

### 13.11.2026 · задача 48-1 · /schedule-registration, токен EasyChat из background
- **`src/jobs/scriptologReminders.ts`**: `/visit` → `/schedule-registration` (тот же fallback на окна при 400 что в syncVisits); добавлено логирование первой записи для отладки полей; текст тревоги токена уточнён.
- **`extension/background.js`**: `trySendEasyToken(authToken, ecToken)` — отправляет токен на сервер если токен изменился или с последней отправки > 30 мин; обработчик `easychat-token` вызывает `trySendEasyToken` напрямую из background; обработчик `login` отправляет накопленный токен сразу при входе.
- **`extension/easychat.js`**: `setInterval(extractAndSendToken, 10 мин)` — периодическое обновление.
- **`extension/sidepanel.js`**: убраны `sendEasyTokenToServer` и ветка `changes.easychatToken` — токен теперь идёт через background, не через sidepanel.
- **`src/http/scriptolog.ts`**: POST easychat-token: если тот же токен — только `updated_at`, не перезаписывать value; лог без самого токена.
- **`extension/manifest.json`**: version 1.0.1.
- **`extension/README.md`**: обновлён раздел EasyChat-токен.

### 13.11.2026 · задача 48 · Напоминания пробных: фикс DRY, статусы, имя, ночной перенос
- **`src/jobs/scriptologReminders.ts`** полный рерайт:
  - **DRY**: не пишем строки в `script_reminders`; возвращаем `planned[]` в ответе (имя, вид, send_at, язык, есть ли диалог).
  - **Статусы**: реально созданное в EasyChat → `scheduled`; дедуп только по `scheduled|sent`; одноразовая чистка `pending` без `easychat_delayed_id` при старте.
  - **Только неподтверждённым**: `status 1/2/3/4` → отменить все `scheduled` → cancelled → `continue`.
  - **Пропавшие/изменённые визиты**: `dedupe_key = kind:visit_id:YYYYMMDDHHmm` (включает время визита); orphan scheduled-строки (не в expected set текущих визитов) → cancel in EasyChat → cancelled.
  - **trial_1h выключен**: константа `TRIAL_1H_ENABLED = false`.
  - **trial_3h ночной перенос**: `visitAt − 3h` попадает в 22:00–07:00 YEK → отправить в 21:00 вечером предыдущего дня с вечерним текстом; если 21:00 уже прошло → немедленно если до визита > 1ч.
  - **Имя**: 1) `script_clients.vars.Имя`; 2) `fitbase_clients_cache.name` → первое слово совпадающее с именем диалога, иначе второе слово; 3) без имени — «Здравствуйте!» вариант.
  - **Язык**: `vars.lang`; если нет — KZ-детект по буквам әғқңөұүһі в имени диалога + последнем входящем.
  - **Нет диалога**: `failed` строка + `watch_alert SCRIPT_NO_DIAL` (один раз на запись).
  - **Токен 401/403**: `watch_alert SCRIPT_TOKEN_ERR` один раз в сутки → job стоп.
  - **Ответ**: `{ trialVisits, planned, scheduled, cancelled, failed, skipped, dry, dialogues }`.
  - **Эндпоинт Fitbase**: `/schedule-registration` (не `/visit`, которого нет).
  - **Токен EasyChat**: обновляется из background при каждом открытии чата и раз в 10 мин; не зависит от открытой боковой панели.

### 06.11.2026 · задача 41 · EasyChat-интеграция, автопрофиль, умные напоминания

- **`src/core/easychat.ts`** — новый клиент EasyChat API: `listDialogues`, `findDialogueByFitbaseClient`, `scheduleMessage`, `listDelayed`, `deleteDelayed`, `addComment`, `deleteComment`, `listComments`, `uploadFile`. Auth `Authorization: <token>` БЕЗ Bearer. `EASYCHAT_DRY_RUN=true` по умолчанию — DRY только логирует запись/удаление, чтение работает.
- **`src/core/scriptologParse.ts`** — парсер ответа клиентки: извлекает Имя / Возраст / Рост / Вес / Цель / Опыт / «Почему не подошло» из свободного текста с уровнем `sure|guess`.
- **`src/jobs/scriptologReminders.ts`** — полная перезапись: получает будущие пробные визиты из Fitbase API (`/visit?date_from...`), по каждому ищет диалог EasyChat по `crm_client_id`, создаёт 3 отложенных сообщения (24ч/3ч/1ч), dedup по `dedupe_key = kind:fitbase_visit_id`, ночное окно (22:00–07:00 YEK сдвигается на 09:00 след.дня), отмена напоминаний при статусе 2/4 или подтверждении (1). Автоподтверждение: last_message клиента содержит согласие → `SCRIPTOLOG_CONFIRM_DRY_RUN=true` защищает от записи в Fitbase; при отключённом DRY создаёт `watch_alert` и EasyChat-комментарий.
- **Расширение**: `easychat.js` — извлекает 20-символьный токен из URL фрейма и шлёт `chrome.runtime.sendMessage({type:'easychat-token',...})`; `background.js` — сохраняет в `chrome.storage`; `sidepanel.js` — при изменении или восстановлении состояния отправляет `POST /api/scriptolog/easychat-token` на сервер.
- **Сервер** `src/http/scriptolog.ts`: `POST /api/scriptolog/easychat-token` (сохраняет токен в `script_settings`); `GET /api/scriptolog/settings/token-status` (статус без самого токена); `POST /api/scriptolog/profile` (автозаполнение vars из Fitbase: имя/возраст/рост/вес/ИМТ/время/абонемент); `POST /api/scriptolog/parse` (парсер ответа); `POST /api/scriptolog/materials/:key/send` (отправка материала клиентке через EasyChat с кешированием `easychat_file_url`); `POST /api/scriptolog/questionnaire` (формирует и пишет комментарий `[СКРИПТОЛОГ] Анкета:` в EasyChat); `GET /api/scriptolog/reminders?fitbase_client_id=`, `DELETE /api/scriptolog/reminders/:id`.
- **Менеджер**: `GET /kviz/api/manager/trials-today` → `TrialsTodaySection` в `ManagerPage.tsx` — список пробных сегодня с временем, именем, статусом напоминания.
- **SettingsPage**: вкладка «EasyChat-токен» в секции «Скриптолог» — показывает «есть / обновлён в HH:MM DD.MM (Автор)» без самого токена, с подсказкой как обновить.
- **Панель** `public/scriptolog.html`: кнопки «🔄 Автопрофиль» и «📋 Анкета → EasyChat» в client-card; «авто» лейбл у переменных с `_src=auto`; блок «📅 Напоминания» в этапе 6 с кнопкой «✕» для отмены; зелёный бейдж «✅ Подтвердила» если `status=confirmed_trial`.
- **`docs/reports/fitbase-registration-confirm-probe.md`**: задокументировано что Fitbase `PATCH /visit/{id}` не верифицировано; `SCRIPTOLOG_CONFIRM_DRY_RUN=true` пока.

### 06.11.2026 · задача 40 · кнопка «📝 Комментарий для карточки»
- В блоке `#client-card` (`public/scriptolog.html`) добавлена кнопка «📝 Комментарий для карточки».
- Функция `copyCommentTemplate()`: берёт `S.vars` (Имя, Цель, Дата, Время) и название текущего этапа `S.tree.stages.find(s.id===S.activeStage).title`, собирает 4 строки «Сделано / Результат / Дальше / Когда», копирует в буфер через `navigator.clipboard.writeText`, показывает тост «Скопировано» 2 сек.
- В Fitbase ничего не пишем.

### 05.11.2026 · задача 39 · аккордеон 7 этапов, дерево v2, фикс EasyChat, Акция/Материалы, напоминания
- **Дерево v2**: `scripts/sales-tree-v2.json` — 7 этапов × шаги, refs (8 возражений, 5 вопросов, 3 молчит), bridge_map (6 причин), imt_hints, constants. `scripts/check-tree.js` переписан под v2 (9 проверок). `docs/sales-tree-v2-draft.md` — утверждённый источник текстов.
- **Панель**: `public/scriptolog.html` переписана с нуля — аккордеон-секции 7 этапов; Ж/М авто/ручной (авто по имени); ИМТ-подсказка; `setVar` без потери фокуса (обновляет только preview-span, не инпуты); переменные дебаунс 1 с → `fact` событие; drawer-справочники (Возражения/Вопросы/Молчит); блок дожима (step 7.4 — напоминания); история/диагностика внутри аккордеона; кнопка «✅ Подтвердил(а)» в этапе 6 при получении «+»/«да».
- **EasyChat**: `selectors.js` — реальные селекторы из живого UI (msgList `[class*="_chat_"]`, msgItem/msgText/msgOwn/msgTime/msgBlock). `easychat.js` — `el.closest(SEL.msgOwn)` вместо `el.querySelector` (обёртка _mine_ — предок, не дочерний).
- **Сервер** `src/http/scriptolog.ts`: дерево теперь `sales-tree-v2.json`; добавлены `POST /api/scriptolog/confirm` (Part 7, флаг `SCRIPTOLOG_CONFIRM_DRY_RUN`); `GET/PUT /api/scriptolog/settings/promo`; `GET/POST/PATCH /api/scriptolog/settings/packages`; `GET/PATCH/POST /api/scriptolog/settings/materials/:key` (upsert by key, Supabase Storage upload).
- **SettingsPage** `kviz/client/src/pages/crm/SettingsPage.tsx`: секция «Скриптолог» (admin) — подсекция «Акция и пакеты» (форма акции + CRUD пакетов со всеми полями из check-constraints) + «Материалы» (7 позиций, inline-edit, загрузка файла base64→Storage).
- **Напоминания** `src/jobs/scriptologReminders.ts` + `/run/scriptolog-reminders` в `src/index.ts`: выборка `script_reminders` где `status=pending AND scheduled_at<=now()`, подстановка vars клиента, лог/обновление статуса. `SCRIPTOLOG_REMINDERS_DRY_RUN=true` по умолчанию.

### 29.10.2026 · (задача 22) · лояльное дерево, блок 8, KZ-тексты, RU/KZ, ↩К развилке, чтение переписки
- **Дерево**: новые узлы 2.8 «Что Вас ждёт», 3.11 «Мягкий выход», блок 8 (8.1–8.8 «Частые вопросы»). Изменены 1.1, 3.1, 3.2, 3.3–3.9 (2-е возражение → 3.11), 3.10, 4.7, 6.10, 7.1. Новые правила: схема ответа, {Цель}, убрать давление, правило 2-го возражения, эмодзи. Итого 66 узлов.
- **KZ-тексты**: `text_kk`, `variants[].text_kk`, `answers[].reply_kk` на всех 55 неpending chat/bot-узлах. Константа `Адрес_kk`. Отчёт `docs/reports/sales-tree-kk-review.md`.
- **check-tree**: 10 проверок — добавлены: все переходы на существующие ID, наличие text_kk, совпадение {переменных} RU/KZ, нет латиницы вне брендов, ровно 3 хаб-узла.
- **Панель** `public/scriptolog.html`: RU/KZ переключатель в шапке; KZ-mode использует text_kk/reply_kk, под KZ — мелкий серый RU-оригинал; кнопка «↩ К развилке» с выпадающим меню 3 хабов; KZ-банер при казахских буквах; автостарт-кнопка «Начать с N?»; sent detection; подсветка вариантов ответа по ключевым словам; вкладка «Диагностика» (admin); блок 8 → hub menu после ответа.
- **Extension**: `selectors.js` — новые селекторы msgList/msgItem/msgText/msgOwn; `easychat.js` — MutationObserver на контейнер сообщений, отправляет `chat-message` с direction in/out (текст не в базу); `background.js` — queue в storage; `sidepanel.js` — форвард в iframe.

### 26.10.2026 · d53a0e6 · полное дерево + check-tree + фикс кнопок и канала
- Полный JSON дерева (56 узлов) из `docs/sales-tree.md`; `npm run check-tree`; фикс заблокированных кнопок и определения канала (был «unknown» у WhatsApp).

### 26.10.2026 · 948e2f0 · базовая версия Скриптолога
- Расширение MV3 (manifest, sidepanel, easychat.js, fitbase.js, selectors.js), страница `/scriptolog`, Bearer-вход, история клиенток, привязка телефона, определение канала.

## Открытые баги
- (13.11, задача 48) Колонка `error` в `script_reminders` предполагается существующей (нужна для `failed`-строк); если её нет — insert при отсутствии диалога упадёт в лог. SQL: `ALTER TABLE script_reminders ADD COLUMN IF NOT EXISTS error text;`
- (06.11, после 41) Панель почти не изменилась: добавлены только кнопки «Автопрофиль», «Анкета → EasyChat», «Напоминания». Причины: (1) `setVar` сохраняет поле событием `fact` → в `facts`, а при открытии чата панель читает `vars` → имя и остальное «забываются»; (2) `onChatMessage` не вызывает `/api/scriptolog/parse` — входящие не разбираются; (3) автопрофиль только по кнопке, не при открытии чата; (4) подтверждение в панели ловит только «+/да/ок» целиком.
- EasyChat-токен: расширение извлекает первый 18–24 симв. параметр из URL фрейма; если токен в другом формате — нужна корректировка регулярки в `easychat.js`.
- Fitbase booking confirm API не верифицирован — `SCRIPTOLOG_CONFIRM_DRY_RUN=true` пока не менять (см. `docs/reports/fitbase-registration-confirm-probe.md`).
- Парсер `/api/scriptolog/parse` реализован, но не вызывается автоматически — нужна интеграция в панель (кнопка «Разобрать ответ» или автовызов при получении входящего сообщения).
- `autoProfile` в панели: кнопка работает, но поля `height`/`weight`/`birthday` могут отсутствовать в Fitbase client API — проверить на реальных данных.

## Следующее
- ЗАПИСАНО (13.11): проверка напоминаний — запись 2543 («12.11 Зарина», 14.11 18:00, не подтверждено) агент молча пропустил; ТЗ `docs/tasks/48-2-scriptolog-reminders-debug.md` (журнал решений, поиск чата глубже 500, имя из Fitbase с очисткой «12.11», «заявка», комментарий «Подтвердила» один раз, отказ только по явным словам).
- ЗАПИСАНО (13.11): токен EasyChat МЕНЯЕТСЯ; расширение шлёт его на сервер только при открытой боковой панели → на сервере устаревает («EasyChat token invalid»). ТЗ `docs/tasks/48-1-scriptolog-easychat-token-refresh.md` (отправка из background) — войдёт в общее ТЗ после проверки напоминаний.
- **SQL** (если нет колонки): `ALTER TABLE script_reminders ADD COLUMN IF NOT EXISTS error text;`
- **Добавить в Render env**: `EASYCHAT_DRY_RUN=true` (пока DRY), `SCRIPTOLOG_CONFIRM_DRY_RUN=true`.
- **Добавить `/run/scriptolog-reminders` в cron-job.org**: каждые 5 мин, 07:00–22:00 Yekaterinburg (если уже стоит 15 мин — изменить на 5).
- После проверки DRY-прогона на проде — переключить `EASYCHAT_DRY_RUN=false`.
- `TRIAL_1H_ENABLED = false` вынести в `script_settings` (добавить key/value).
- Добавить `/run/scriptolog-reminders` в cron-job.org (каждые **5 мин**, 07:00–22:00 Yekaterinburg); изменить если уже стоит 15 мин.
- Добавить в Render env: `EASYCHAT_DRY_RUN=true`, `SCRIPTOLOG_CONFIRM_DRY_RUN=true`.
- Проверить на живом расширении: EasyChat-токен извлекается и попадает в настройки, `EASYCHAT_DRY_RUN=true` → ожидать лог в `job_runs`.
- Верифицировать Fitbase `PATCH /visit/{id}` → переключить `SCRIPTOLOG_CONFIRM_DRY_RUN=false`.
- Интеграция парсера в панель: кнопка «Разобрать» или автовызов при входящем сообщении.
- РЕШЕНО (05.11, реализовано в 41): напоминания пробных — ПОЛНОСТЬЮ автоматически, без менеджера. Агент каждые 5 мин: записи на пробное со статусом НЕ «подтверждено» → ставит отложенные сообщения EasyChat (24ч / 3ч / 1ч). Подтверждено (девочки поставили сами ИЛИ клиент ответил согласием: +, да, приду, буду, хорошо, ок, помню, иә, ия, келемін…) → агент ставит статус «подтверждено» в Fitbase и удаляет оставшиеся отложенные (за 1 ч не уходит). Правило «расширение никогда не отправляет само» для этого случая снято Сергеем.
- РЕШЕНО (05.11): анкета клиента — и в комментарий EasyChat/Fitbase, и консультанту в нашем окне. Отчёт «Работа с клиентами» — следующим шагом.
- Найдено 05.11 (EasyChat внутренний API `chat_api.easychat.ru/v1`): заголовок `Authorization: <token>` — тот же 20-символьный token из URL фрейма `#easychatIframe`, БЕЗ «Bearer». `GET /v1/dialogue?page&pageSize` → `data[]` с `dialogue_id`, `name`, `crm_client_id` (id клиента Fitbase), `crm_client_status`, `unread_count`, `last_message{message, message_type, operator_id (null = клиент), created_at, author}`, `last_message_at`. `GET /v1/delayed_message?dialogue_id=` → `{success, data[]}`. API неофициальный. Снято вживую 05.11 (тест на диалоге Сергея, всё удалено):
  - создать отложенное: `POST /v1/delayed_message` JSON `{"message_text": "...", "send_at": <unix сек>, "dialogue_id": <id>}`;
  - список: `GET /v1/delayed_message?dialogue_id=<id>` → `data[]{delayed_message_id, channel_id, dialogue_id, message_text, operator_id, file_id, status (1 = ждёт), send_at}`;
  - удалить: `DELETE /v1/delayed_message/<delayed_message_id>`;
  - комментарий: `POST /v1/dialogue/<id>/comment` JSON `{"text": "...", "is_pinned": 0}`; список `GET /v1/dialogue/<id>/comment?page&pageSize` (поля `dialogue_comment_id`, `crm_comment_id` — синхронизируется в карточку Fitbase); удалить `DELETE /v1/comment/<dialogue_comment_id>`;
  - загрузка файла: `POST /v1/file` multipart (`file`, `dialogue_id`) → `data{file_id, file_url, name, type, size, extension}` (проверено 05.11);
  - отложенное сообщение С ФАЙЛОМ: в `POST /v1/delayed_message` передать `file_url` (из ответа `/v1/file`) — `file_id` и прочие поля игнорируются. Проверено end-to-end 06.11 на диалоге Сергея: отложенное «тест отложенный с файлом» + PNG ушло точно в назначенную минуту;
  - обычная отправка: WebSocket `wss://chat_wss.easychat.ru/?chat_token=<тот же token>`, кадр `{"action":"message.send","data":{"message_text":"...","dialogue_id":<id>,"file_url":"..."}}` (проверено 06.11). Для сервера проще и надёжнее отправлять «сейчас» через отложенное с `send_at` = текущая минута + 1;
  - история сообщений — только по WebSocket (`message.get`), REST нет; для «+» хватает `last_message` из списка диалогов (operator_id = null → писал клиент).
- Найдено 05.11: в EasyChat есть «Отложенная отправка сообщения» (дата + время + текст, кнопка-часы рядом с «Отправить»), отправляет сам в назначенное время. Использовать для напоминаний 24ч/3ч/1ч: панель на этапе 5 заполняет отложенные сообщения, менеджер подтверждает. Также в карточке контакта EasyChat есть «Комментарии» и вкладки Задачи/Заявки/Покупки/Записи.
- В обсуждении 05.11: сбор информации о клиентке (анкета для консультанта, карточка, отчёт).
- Добавить `/run/scriptolog-reminders` в cron-job.org (каждые 15 мин).
- Переключить `SCRIPTOLOG_REMINDERS_DRY_RUN=false` в Render после проверки на проде.
- Переключить `SCRIPTOLOG_CONFIRM_DRY_RUN=false` когда Fitbase API для подтверждения записи подтверждён.
- Механизм уведомлений в «Овчарку» при напоминаниях (сейчас только лог).
- Создание напоминаний: нужна логика в панели или сервере для `INSERT INTO script_reminders` при переходе на этап 7.
- В обсуждении (05.11): упрощаем дерево до ОДНОГО стандарта консультации из 7 этапов (знакомство → запрос → почему SlimWay → приглашение → запись → подтверждение «+» за 3 ч → после пробного), этапы аккордеоном, этап закрывается сам по ответу клиентки. Возражения, частые вопросы, «молчит» — кнопки-справочники внутри этапа. Образец — BodyRoom (линейка, отдают материалы, подтверждение «+»).
- РЕШЕНО (05.11): крючок — пришла на пробное в день записи → бесплатный InBody (стоит 5000 ₸).
- РЕШЕНО (05.11): на этапе «Запрос» спрашиваем рост и вес → считаем ИМТ.
- РЕШЕНО (05.11): материалы есть — видео замера InBody, видео пробного посещения, памятка «что взять», ссылка 2ГИС.
- Wazzup — в планах, не подключён. EasyChat имеет внутренний API `chat_api.easychat.ru/v1` (dialogue, channel, message_template, delayed_message, tag, task, comment, fitbase/user) — неофициальный, токен из URL фрейма к нему напрямую не подходит (401).
- Проверить и скорректировать CSS-селекторы сообщений EasyChat после тестирования.
- Завершить тексты узлов 8.5–8.8 (pending), добавить KZ после утверждения.
- Уточнить узлы 6.1, 6.7 и бонус 7.6 (pending).
- Таймеры касаний через овчарку, автопостановка этапов/тегов в Fitbase, свободные окна из расписания в {Время1}/{Время2}, редактор скриптов.
- Отчёт «Работа с клиентами» для админа (модуль Отчёты).
- KZ-тексты проверить с носителем языка.
