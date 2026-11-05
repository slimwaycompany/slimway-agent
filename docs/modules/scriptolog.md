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
- `script_reminders` — напоминания (kind: 9 значений; status: `pending|sent|skipped|cancelled`; scheduled_at; sent_at)

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
- Аккордеон-панель (`public/scriptolog.html`) не проверена на живом расширении — нужна проверка на проде.
- Схема `script_reminders` предполагает колонку `text` с шаблоном — уточнить при первом использовании; возможно, нужен SQL для добавления колонки если её нет.
- Fitbase booking confirm API не верифицирован — `SCRIPTOLOG_CONFIRM_DRY_RUN=true` пока не менять.

## Следующее
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
