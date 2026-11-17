# Модуль: Telegram-бот клиентов

Чат в claude.ai: «Telegram-бот клиентов» · Файл: `docs/modules/telegram-bot.md`

## Назначение
Telegram-бот SlimWay для клиентов студии: клиент нажимает «Старт», подтверждает свой номер через контакт Telegram, и бот подвязывает его к базе. Дальше кнопками он получает замеры тела, результаты InBody, количество оставшихся посещений и данные активного абонемента. Все данные выводятся прямо в боте, ссылки клиентам вручную не отправляются.

## Где код
- Вебхук бота: `POST /tg/webhook` — `src/http/telegram.ts`, подключён в `src/index.ts` через `mountTelegramRoute`.
- Логика бота: `src/telegram/bot.ts` — `handleUpdate`, экраны `screenBody/screenBodyDetail/screenInBody/screenInBodyDetail/screenVisits/screenSub`.
- Нормализация номера: `src/telegram/phone.ts` — `normalizePhone`; тесты: `src/telegram/phone.test.ts`.

## Таблицы
- `telegram_links` — связь Telegram-аккаунта с клиентом. Колонки: `chat_id bigint NOT NULL`, `tg_user_id bigint NOT NULL`, `client_id uuid NOT NULL`, `phone_digits text NOT NULL`, `linked_at timestamptz NOT NULL`, `last_seen_at timestamptz NULL`, `unlinked_at timestamptz NULL`. Отвязка мягкая, через `unlinked_at`. Битых связей с `body_clients.id` нет (проверено 17.11.2026).
- `body_clients` — клиенты замеров: `id uuid`, `name`, `phone`, `phone_digits` (generated: вычисляется из `phone`, вручную не записывать), `fitbase_client_id text`, `share_token text`. Формат: `phone` = `+7XXXXXXXXXX`, `phone_digits` = `7XXXXXXXXXX`. На 17.11.2026: 218 клиентов, у 217 формат верный. У одного (`1bf35666-f089-4608-8712-9e1f85b4727e`) номер записан в `name` (`87756802316`), `phone` пустой. 19 клиентов без `fitbase_client_id`, по номеру в Fitbase не найдены (0 совпадений).
- `body_measurements` — замеры тела: `id uuid`, `client_id uuid` (→ `body_clients.id`), `measure_no`, `measured_at date`, зоны (`neck`, `chest`, `arm_l/r`, `waist`, `belly`, `glutes`, `thigh_l/r`, `shin_l/r`), `total_cm`, `inbody jsonb`, `note`. Колонка `weight` не используется: вес берём только из InBody (см. [zamery.md](zamery.md)). На 17.11.2026: 74 клиента, 101 замер.
- `inbody_tests` — тесты InBody: `id uuid`, `inbody_id text`, `phone`, `phone_digits` (связь с клиентом), `tested_at timestamptz`, `weight`, `pbf`, `smm`, `ffm`, `bmi`, `vfl`, `inbody_score`, `bmr`, `whr`, `source`, `data jsonb`. На 17.11.2026: 198 клиентов, 411 тестов, все совпадают с `body_clients.phone_digits` (orphan = 0).
- `inbody_id_links` — `inbody_id text`, `phone text`, `linked_by`, `linked_at`. Связь теста с номером, если тест появился до привязки. Для бота пока не нужна.
- `fitbase_contracts` — абонементы Fitbase. `visits_left` и `closed` лежат в `raw` (jsonb), отдельных колонок нет. Для кнопки абонемента и посещений решение отложено.
- `fitbase_clients_cache` — клиенты Fitbase с телефоном (см. [reports.md](reports.md)).

## Ключевые решения
- Вход: кнопка «Старт» → клиент присылает номер только кнопкой «Поделиться контактом» (Telegram contact), ручной ввод номера не принимается.
- Сверка номера: «+7», «7» и «8» в начале считаются одним номером. Совпадение строгое: все цифры после кода страны должны совпасть. Пример: в базе 8705…, клиент присылает 7705… или +7705… — доступ есть.
- Первая версия простая: если номер найден в базе, бот подвязывает клиента автоматически, без подтверждения вручную.
- Все данные выводятся текстом в самом боте (не ссылкой на `/r/:token`). Клиенту ничего не отправляется вручную.
- Замеры тела: кнопка «Замеры тела» → inline-кнопки с датами (`measured_at`) → по нажатию данные замера текстом. Источник: `body_measurements.client_id = telegram_links.client_id`.
- InBody: кнопка «InBody» → inline-кнопки с датами (`tested_at`) → по нажатию данные теста текстом. Источник: `inbody_tests.phone_digits = telegram_links.phone_digits`.
- Telegram поддерживает inline-кнопки. `callback_data` не больше 64 байт: в callback передаём короткий префикс и uuid записи (`m:<uuid>` для замера, `i:<uuid>` для InBody). Превышение логируется, кнопка откатывается на `m_menu`.
- Список дат (замеры и InBody): показываем последние 10 кнопками с датами, дальше кнопка «Ещё» с `mp:<offset>` / `ip:<offset>` (подтверждено Сергеем 17.11.2026).
- Вес в замерах тела не показываем, вес берём только из InBody.
- Ссылка «🔗 Полный отчёт» в боте не показывается — все данные текстом прямо в боте.
- Посещения и абонемент (`m_visits`, `m_sub`): экраны есть, данные из `fitbase_contracts`. Решение: отложено, будет отдельной задачей.
- Бота ведёт Сергей сам, техническая часть (токен, вебхук) настраивается в Render и BotFather.

## Окружение (настроено Сергеем)
- Бот создан в @BotFather, токен получен.
- В Render добавлены env: `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TG_PUBLIC_URL` = https://slimway-agent.onrender.com.
- В Supabase выполнен SQL создания таблицы `telegram_links`.

## Мобильная версия
- Не применимо: это Telegram-бот, без вкладок сервера. Экран клиента — сам Telegram.

## Сделано
### 17.11.2026 · (task 59) · задача 59 — сверка номера по 11 цифрам, замеры и InBody кнопками
- `phone.ts`: `phoneTail` заменён на `normalizePhone` — берёт последние 10 цифр, добавляет `'7'`, возвращает 11-значный `phone_digits`. Баг «Номер не найден» закрыт.
- `bot.ts`: поиск клиента и сохранение в `telegram_links` по 11-значному `phone_digits` (тот же формат, что в `body_clients`).
- `screenBody`: список последних 10 замеров кнопками с датами (`m:<uuid>`), пагинация `mp:<offset>`, детали замера (`screenBodyDetail`) — все зоны, `total_cm`, `note`; вес не выводится.
- `screenInBody`: список последних 10 тестов кнопками (`i:<uuid>`), пагинация `ip:<offset>`, детали теста (`screenInBodyDetail`) — `weight, pbf, smm, ffm, bmi, vfl, inbody_score, bmr, whr`, null-поля пропускаются.
- Ссылка «🔗 Полный отчёт» и вызов `getOrCreateShareToken` из бота удалены.
- 5 тестов `phone.test.ts` обновлены под `normalizePhone`, все проходят.

### 17.11.2026 · d3267d8 · задача 58 — вебхук бота
- Добавлен вебхук `POST /tg/webhook`. Проверка секрета: без секрета возвращает 401 (проверено на проде).
- Для запуска нужно (делает Сергей): в Render добавить `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET` (любая случайная строка), `TG_PUBLIC_URL`; после деплоя зарегистрировать вебхук через `setWebhook` с `secret_token`.

## Открытые баги
- (нет)

## Следующее
- Клиент `1bf35666-…`: записать `phone = '+77756802316'` (в `phone_digits` значение подставится автоматически из `phone`). Имя клиента заменить с номера на настоящее, имя запрошено у Сергея.
- Решить правило абонемента и посещений позже (отложено).
- Проверить сценарий на проде: `/start` → поделиться контактом → замеры тела → InBody.
