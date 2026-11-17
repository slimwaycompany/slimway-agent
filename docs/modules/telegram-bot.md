# Модуль: Telegram-бот клиентов

Чат в claude.ai: «Telegram-бот клиентов» · Файл: `docs/modules/telegram-bot.md`

## Назначение
Telegram-бот SlimWay для клиентов студии: клиент нажимает «Старт», подтверждает свой номер через контакт Telegram, и бот подвязывает его к базе. Дальше кнопками он получает замеры тела, результаты InBody, количество оставшихся посещений и данные активного абонемента. Все данные выводятся прямо в боте, ссылки клиентам вручную не отправляются.

## Где код
- Вебхук бота: `POST /tg/webhook` — `src/http/telegram.ts`, подключён в `src/index.ts` через `mountTelegramRoute`.
- Логика бота: `src/telegram/bot.ts` — `handleUpdate`, экраны `screenBody/screenBodyDetail/screenInBody/screenInBodyDetail/screenVisits/screenSub`.
- Нормализация номера: `src/telegram/phone.ts` — `normalizePhone`; тесты: `src/telegram/phone.test.ts`.
- Вспомогательные функции InBody: `src/telegram/inbodyView.ts` — `extractDataFields`, `beforeTarget`, `delta`, `formatValue`; тесты: `src/telegram/inbodyView.test.ts`.

## Таблицы
- `telegram_links` — связь Telegram-аккаунта с клиентом. Колонки: `chat_id bigint NOT NULL`, `tg_user_id bigint NOT NULL`, `client_id uuid NOT NULL`, `phone_digits text NOT NULL`, `linked_at timestamptz NOT NULL`, `last_seen_at timestamptz NULL`, `unlinked_at timestamptz NULL`. Отвязка мягкая, через `unlinked_at`. Битых связей с `body_clients.id` нет (проверено 17.11.2026).
- `body_clients` — клиенты замеров: `id uuid`, `name`, `phone`, `phone_digits` (generated: вычисляется из `phone`, вручную не записывать), `fitbase_client_id text`, `share_token text`. Формат: `phone` = `+7XXXXXXXXXX`, `phone_digits` = `7XXXXXXXXXX`. На 17.11.2026: 218 клиентов, у 217 формат верный. У одного (`1bf35666-f089-4608-8712-9e1f85b4727e`) номер записан в `name` (`87756802316`), `phone` пустой. 19 клиентов без `fitbase_client_id`, по номеру в Fitbase не найдены (0 совпадений).
- `body_measurements` — замеры тела: `id uuid`, `client_id uuid` (→ `body_clients.id`), `measure_no`, `measured_at date`, зоны (`neck`, `chest`, `arm_l/r`, `waist`, `belly`, `glutes`, `thigh_l/r`, `shin_l/r`), `total_cm`, `inbody jsonb`, `note`. Колонка `weight` не используется: вес берём только из InBody (см. [zamery.md](zamery.md)). На 17.11.2026: 74 клиента, 101 замер.
- `inbody_tests` — тесты InBody: `id uuid`, `inbody_id text`, `phone`, `phone_digits` (связь с клиентом), `tested_at timestamptz`, `weight`, `pbf`, `smm`, `ffm`, `bmi`, `vfl`, `inbody_score`, `bmr`, `whr`, `source`, `data jsonb`. На 17.11.2026: 198 клиентов, 411 тестов, все совпадают с `body_clients.phone_digits` (orphan = 0). Поля рекомендаций в `data`: `weight_control`, `bfm_control`, `ffm_control`, `target_weight`, `ideal_weight`. Поле `recommended_kcal` не используется и в боте не выводится.
- `inbody_id_links` — `inbody_id text`, `phone text`, `linked_by`, `linked_at`. Связь теста с номером, если тест появился до привязки. Для бота пока не нужна.
- `fitbase_contracts` — абонементы Fitbase. `visits_left` и `closed` лежат в `raw` (jsonb), отдельных колонок нет. Для кнопки абонемента и посещений решение отложено.
- `fitbase_clients_cache` — клиенты Fitbase с телефоном (см. [reports.md](reports.md)).

## Ключевые решения
- Вход: кнопка «Старт» → клиент присылает номер только кнопкой «Поделиться контактом» (Telegram contact), ручной ввод номера не принимается.
- Сверка номера: «+7», «7» и «8» в начале считаются одним номером. `normalizePhone(input)` → берёт последние 10 цифр и добавляет `'7'` → 11-значный `phone_digits`. Пример: `+77767681579`, `87767681579`, `77767681579` → все в `77767681579`.
- Первая версия простая: если номер найден в базе, бот подвязывает клиента автоматически, без подтверждения вручную.
- Все данные выводятся текстом в самом боте (не ссылкой на `/r/:token`). Клиенту ничего не отправляется вручную.
- Замеры тела: кнопка «Замеры тела» → inline-кнопки с датами (`measured_at`) → по нажатию данные замера текстом. Источник: `body_measurements.client_id = telegram_links.client_id`.
- InBody: кнопка «InBody» → inline-кнопки с датами (`tested_at`) → по нажатию детальный экран теста текстом. Источник: `inbody_tests.phone_digits = telegram_links.phone_digits`.
- Telegram поддерживает inline-кнопки. `callback_data` не больше 64 байт: в callback передаём короткий префикс и uuid записи (`m:<uuid>` для замера, `i:<uuid>` для InBody). Превышение логируется, кнопка откатывается на `m_menu`.
- Список дат (замеры и InBody): показываем последние 10 кнопками с датами, дальше кнопка «Ещё» с `mp:<offset>` / `ip:<offset>`.
- Вес в замерах тела не показываем, вес берём только из InBody.
- Ссылка «🔗 Полный отчёт» в боте не показывается — все данные текстом прямо в боте.
- Посещения и абонемент (`m_visits`, `m_sub`): экраны есть, данные из `fitbase_contracts`. Решение: отложено, будет отдельной задачей.
- Бота ведёт Сергей сам, техническая часть (токен, вебхук) настраивается в Render и BotFather.
- Экран одного теста InBody (решения Сергея 17.11.2026):
  - блок «До цели» показывается только если `beforeTarget(weight, weight_control, target_weight)` — т.е. `|weight + weight_control − target_weight| ≤ 0.1`;
  - `ideal_weight` показывается всегда когда задан (внутри «До цели» или отдельной строкой);
  - блок «С прошлого теста» — дельта weight/pbf/smm с предыдущим тестом;
  - блок «Со старта» — дельта weight/pbf с первым тестом; скрыт, если тест единственный;
  - навигация: «‹ Предыдущий» / «Следующий ›» (только если есть сосед), «← К списку дат» (ip:0), «← Меню»;
  - null-поля в «Состав тела» выводятся как «—»; в дельта-блоках строки с null не выводятся.

## Окружение (настроено Сергеем)
- Бот создан в @BotFather, токен получен.
- В Render добавлены env: `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_PUBLIC_URL` = https://slimway-agent.onrender.com.
- В Supabase выполнен SQL создания таблицы `telegram_links`.

## Мобильная версия
- Не применимо: это Telegram-бот, без вкладок сервера. Экран клиента — сам Telegram.

## Сделано
### 17.11.2026 · (task 60) · задача 60 — InBody: блоки рекомендаций, сравнение, навигация
- `inbodyView.ts`: чистые функции `extractDataFields` (читает `weight_control/bfm_control/ffm_control/target_weight/ideal_weight` из jsonb), `beforeTarget` (gate для блока «До цели»), `delta` (разница с 1 знаком), `formatValue` (1 десятичный знак, null → «—»). 6 тестов.
- `bot.ts screenInBodyDetail`: новая реализация — 4 параллельных запроса (тест + пред. + след. + первый), 4 блока (состав тела / до цели / с прошлого теста / со старта), `arrow()` для знаковых строк, `ideal_weight` всегда когда задан.
- Навигация: «‹ Предыдущий», «Следующий ›», «← К списку дат», «← Меню».
- `package.json test`: запускает `phone.test.ts` + `inbodyView.test.ts`, 11 тестов проходят.

### 17.11.2026 · b8cbf1f · задача 59 — сверка номера по 11 цифрам, замеры и InBody кнопками
- `phone.ts`: `phoneTail` заменён на `normalizePhone` — берёт последние 10 цифр, добавляет `'7'`, возвращает 11-значный `phone_digits`. Баг «Номер не найден» закрыт.
- `bot.ts`: поиск клиента и сохранение в `telegram_links` по 11-значному `phone_digits`.
- `screenBody`: список последних 10 замеров кнопками (`m:<uuid>`), пагинация `mp:<offset>`, детали `screenBodyDetail` — все зоны, `total_cm`, `note`.
- `screenInBody`: список последних 10 тестов кнопками (`i:<uuid>`), пагинация `ip:<offset>`.

### 17.11.2026 · d3267d8 · задача 58 — вебхук бота
- Добавлен вебхук `POST /tg/webhook`. Без секрета возвращает 401 (проверено на проде).
- Для запуска нужно (делает Сергей): в Render `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_PUBLIC_URL`; зарегистрировать вебхук через `setWebhook` с `secret_token`.

## Открытые баги
- (нет)

## Следующее
- Клиент `1bf35666-…`: записать `phone = '+77756802316'` (в `phone_digits` значение подставится автоматически из `phone`). Имя клиента заменить с номера на настоящее, имя запрошено у Сергея.
- Решить правило абонемента и посещений позже (отложено).
- Уточнить поле рекомендаций в `inbody_tests.data` (пока Сергей смотрит запросом).
