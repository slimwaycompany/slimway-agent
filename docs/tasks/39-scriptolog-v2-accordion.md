Модуль: scriptolog

# Задача 39 — Скриптолог v2: аккордеон 7 этапов

Источник: чат «Скриптолог» 05.11.2026. Главный источник текстов — `docs/sales-tree-v2-draft.md` (все тексты брать дословно).

SQL уже выполнен: таблицы `script_promo`, `script_promo_packages`, `script_materials`, `script_reminders`, bucket `scriptolog-materials`.

## ЧАСТЬ 0 — Подготовка

- Прочитать CLAUDE.md, docs/STATE.md, docs/modules/scriptolog.md, docs/QUEUE.md.
- `git pull --rebase origin main` → `git status` — папка должна быть чистой.
- Рабочая папка грязная: `docs/modules/crm-schedule.md`, `docs/modules/manager.md` изменены; `docs/modules/ui.md`, `probe_result.json` не закоммичены. Это работа других чатов — не трогать.
- Файлы `docs/sales-tree-v2-draft.md` и `docs/modules/scriptolog.md` закоммитить отдельным коммитом:
  `docs: scriptolog — дерево v2 утверждено (RU+KZ)`
- Перед работой проверить реальные колонки и check-constraints таблиц:
  `script_promo`, `script_promo_packages`, `script_materials`, `script_reminders`
  (запросы из раздела 2 CLAUDE.md).

Допустимые значения (из check-constraints):
- `script_promo_packages.kind`: `vacu | cross`
- `script_promo_packages.main_phase`: `vacu_fixed | choice`
- `script_promo_packages.payment_methods` (jsonb array): `cash, card, installment, bonus`
- `script_promo_packages.goals` (jsonb array): `lose_weight, zones, tone, cellulite`
- `script_materials.key`: `video_trial, video_inbody, memo, gis2, guide_newbie, menu_pdf, nutrition_chat`
- `script_materials.kind`: `video | file | link`
- `script_reminders.kind`: `trial_24h, trial_3h, trial_1h, after_trial_1d, after_trial_3d, after_trial_7d, silent_1d, silent_3d, silent_7d`
- `script_reminders.status`: `pending | sent | skipped | cancelled`
- Телефон: только `7XXXXXXXXXX` (цифры без +)

## ЧАСТЬ 1 — Фикс ввода переменных

Файл: `public/scriptolog.html`, функция `setVar`.

Баг: `setVar` вызывает `renderNodeText(node)` на каждую букву → перебирается `varsEl.innerHTML` → теряется фокус; каждая буква пишется событием `insert` в базу.

Чинить:
1. `setVar` обновляет `S.vars[varName]` и только перестраивает preview-span в тексте (без пересоздания input-ов).
2. Инпуты вставить в DOM один раз; при смене узла — обновлять только `value`.
3. Сохранять vars в базу по `blur` / паузе 1 с — одним событием `fact` (не `insert`).

## ЧАСТЬ 2 — Фикс CSS-селекторов EasyChat

Файл: `extension/selectors.js`.

Реальные классы (проверено 05.11):
- `msgList`: контейнер не `_message-list_` — сообщения приходят через WebSocket, контейнер надо уточнить.
- `msgItem`: `[class*="_message_"]`
- `msgText`: `[class*="_message-text_"]`
- `msgOwn`: `[class*="_wrapper_"][class*="_mine_"]`
- Дополнить: `msgTime: '[class*="_time_"]'`, `msgBlock: '[class*="_block_"]'`

Обновить `easychat.js` так, чтобы MutationObserver цеплялся к правильному контейнеру.

## ЧАСТЬ 3 — Дерево v2 JSON

Создать `scripts/sales-tree-v2.json` из `docs/sales-tree-v2-draft.md`.

Структура:
```json
{
  "stages": [/* 7 этапов */],
  "refs": { "objections": [], "questions": [], "silent": [] },
  "bridge_map": {/* {Мост} по причине */},
  "imt_hints": [/* подсказки по ИМТ */],
  "constants": { "Адрес": "ЖК Qazyna, Ахмет Байтұрсынұлы 2, НП14", "2гис": "https://go.2gis.com/3GEQG" },
  "variables": [/* список всех переменных с описанием */]
}
```

Этап:
```json
{
  "id": 1, "title": "Запрос", "close_when": "Есть {Имя} и {Цель}",
  "steps": [
    { "id": "1.1", "cond": "no_name|has_name", "title": "...", "text": "...", "text_kk": "..." }
  ]
}
```

Справочные тексты (возражения/вопросы/молчит) — массивы объектов `{id, title, text, text_kk}`.

Переписать `scripts/check-tree.js` под структуру v2:
1. Все 7 этапов с ID 1–7 присутствуют
2. Нет пустых text у непендинговых шагов
3. text_kk присутствует у всех непендинговых
4. Переменные {…} в RU и KZ совпадают
5. Latin вне брендов в KZ отсутствует
6. Все 3 справочника (objections/questions/silent) непустые
7. `npm run check-tree` — ноль ошибок

## ЧАСТЬ 4 — Аккордеон-панель

Переписать `public/scriptolog.html`. Оставить: логин, статус-бар, клиентскую карточку, RU/KZ переключатель, Ж/М переключатель. Убрать: табы Скрипт/Возражения/Справочник/История/Диагностика (заменить на аккордеон + кнопки-справочники).

Новый интерфейс:
- 7 аккордеон-секций. Открыта текущая, остальные свёрнуты. У пройденных галочка ✅ и одна строка итога.
- Кнопки-справочники в каждой секции: **Возражения** / **Вопросы** / **Молчит** — открывают боковую панель (drawer) со списком.
- Секция закрывается по условию «Закрыт, когда» → следующая открывается. Запасная кнопка «Этап пройден».
- Переключатель Ж/М: авто по имени (мужское — если нет «а»/«я» на конце), вручную. Хранить `S.gender` ('f'|'m'), писать в `vars.gender`. Варианты `[ж:...|м:...]` → отображать нужный.
- Переменные: инпуты строго БЕЗ потери фокуса (см. ч.1). `{ИМТ}` — панель считает автоматически и показывает подсказку менеджеру, клиенту НЕ называет. Поля `[уточнить]` не показывать.

ИМТ-подсказка (только менеджеру, под полями Рост/Вес):
- < 25: «Акцент: подтянуть тело, убрать объёмы»
- 25–30: «Снизить вес и объёмы»
- ≥ 30: «Бережно снижать вес без нагрузки на суставы»

История → вкладка внутри аккордеона или отдельная маленькая панель.
Диагностика (admin) → иконка ⚙ в статус-баре.

Мобильная вёрстка: расширение открывается в боковой панели браузера — фиксированная ширина ~400px, адаптив не нужен.

## ЧАСТЬ 5 — Настройки: Акция и Материалы

### 5а — Сервер API

Новые эндпоинты в `src/http/scriptolog.ts` (Bearer-авторизация):

**Акция:**
- `GET /api/scriptolog/settings/promo` → текущая акция + пакеты
- `PUT /api/scriptolog/settings/promo` → обновить акцию (поля: name, valid_from, valid_to, is_active, rule_text, credit_text)
- `GET /api/scriptolog/settings/packages` → список пакетов (активных + архивных)
- `POST /api/scriptolog/settings/packages` → создать пакет
- `PATCH /api/scriptolog/settings/packages/:id` → изменить пакет
- `PATCH /api/scriptolog/settings/packages/:id/archive` → в архив

**Материалы:**
- `GET /api/scriptolog/settings/materials` → список (7 позиций, upsert-based)
- `PATCH /api/scriptolog/settings/materials/:key` → обновить (url, label)
- Upload: `POST /api/scriptolog/settings/materials/:key/upload` → Supabase Storage bucket `scriptolog-materials`, вернуть URL

### 5б — Клиент SettingsPage

В `kviz/client/src/pages/crm/SettingsPage.tsx` добавить секцию «Скриптолог» (только admin) с двумя подсекциями:
1. **Акция** — поля: название, даты, включена/выключена, текст правила, текст рассрочки. Пакеты — таблица с CRUD.
2. **Материалы** — 7 строк с key/label/kind и кнопкой «Загрузить файл» или полем «Ссылка».

Поля пакета в форме:
- Название, Короткая строка, Название для клиента
- Тип (`vacu` | `cross` → «VACU» / «CROSS»)
- Цена ₸, Визитов, Сеансов за визит (за визит и за сеанс считаются)
- Темп (2/нед или 3/нед), Срок действия, Заморозка
- Основная фаза (`vacu_fixed` | `choice`)
- Механизм (список строк), Что включено (список строк), Что нельзя (список строк)
- Оплата (мультиселект: cash/card/installment/bonus)
- Цели (мультиселект: lose_weight/zones/tone/cellulite)
- Показывать в чате (да/нет), Порядок

## ЧАСТЬ 6 — Очередь напоминаний

Создать `src/jobs/scriptologReminders.ts`.

Логика (запускается по расписанию, каждые 15 мин в 09:00–22:00 Алматы):
1. Выбрать `script_reminders` где `status=pending` и `scheduled_at <= now()`.
2. Для каждого — загрузить клиента и подставить переменные в текст (из `script_clients.vars`).
3. Вывести в «Овчарку» уведомление с кнопкой «Открыть чат» (если Fitbase client_id известен — ссылка на диалог).
4. Поставить `status=sent`, записать `sent_at`.
5. env: `SCRIPTOLOG_REMINDERS_DRY_RUN` (по умолчанию `true` — только лог).

Новый маршрут `/run/scriptolog-reminders` в `src/index.ts`.

## ЧАСТЬ 7 — Обработка «+» (подтверждение)

Новый эндпоинт `POST /api/scriptolog/confirm`:
- Body: `{ client_id, booking_date, booking_time, confirmed_at }`
- Записать активность клиента: «Подтвердила пробное {Дата} {Время} — ответ в чате {время ответа}»
- Поставить статус клиента `confirmed_trial`
- Отправить уведомление в овчарку: «✅ {Имя} подтвердила пробное на {Время}»
- Проверить Fitbase API: может ли агент поменять статус записи → документировать в коде (сейчас только лог; API-вызов под флагом `SCRIPTOLOG_CONFIRM_DRY_RUN`, по умолчанию `true`)

Панель: при получении входящего «+» / «да» в чате → показать кнопку «✅ Подтвердил(а) пробное» в текущем узле этапа 6.

## ЧАСТЬ 8 — Тесты, документация, деплой

1. `npm run check-tree` — 0 ошибок
2. `npm run build` — 0 ошибок TypeScript
3. `npm run check:mobile` — если применимо
4. Обновить `docs/modules/scriptolog.md` (Сделано, Таблицы, Следующее, Открытые баги)
5. Обновить `docs/STATE.md`
6. Обновить `docs/QUEUE.md`
7. Коммит → push → дождаться деплоя → проверить на проде
