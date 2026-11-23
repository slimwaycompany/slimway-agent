Модуль: crm-core

# Задача 87 — Карточка клиента: доработки по замечаниям

SQL уже выполнен:
- crm_clients.instagram, tiktok, email — text
- crm_clients.skirt_size — 'XS'|'S'|'M'|'L'|'XL'|'XXL'|'XXXL'|null
- crm_clients.gender — 'female'|'male'|null; всем существующим проставлено 'female'
- crm_clients.device_settings — jsonb

## Часть 1 — Левая колонка карточки

- ФИО 22px bold, 2 строки
- Телефон отдельной строкой: «+7 777 618 61 87», кнопки «WhatsApp» и «Позвонить»
- Дата рождения + возраст: «12.03.1990 · 36 лет»; из ИИН если нет даты; «не указана» серым
- Соцсети: Instagram / TikTok / email (только если заполнены)
- Порядок: аватар+ФИО → телефон → ДР → соцсети → Fitbase+кнопки → метки → источник+реферер → Клиент с/LTV/Визиты/Депозит/Бонусы → Активный абонемент → Подробнее
- Форма: поля Instagram/TikTok/email; нормализация (убрать @, ссылку); пол → 'female'/'male'/null
- БАГ: gender не в PATCH allowed fields → добавить; '' → null при создании; gender check
- Сервер: добавить instagram/tiktok/email в PATCH и POST; исправить gender валидацию

## Часть 2 — Визиты = 0

- crm_visit_history.visit_at (не visit_date), status строка 'attended' (не число 3)
- Визиты = crm_visit_history status='attended' + crm_bookings status='attended'
- Отчёт распределения status_raw (сколько каких значений)

## Часть 3 — Импорт из Fitbase: источник

- runFitbaseImport не заполняет ad_source_id
- Источник из fitbase_leads.source (где client_fitbase_id совпадает)
- Сопоставление с crm_ad_sources по названию без регистра
- Не найденные — в отчёт; не создавать; заполнять только пустые
- Маршрут POST /kviz/api/crm/clients/fill-fitbase-data

## Часть 4 — Окно «Важное»

- skirt_size — select XS/S/M/L/XL/XXL/XXXL/«не указан»
- device_settings — структурированные поля {vacu, ik} per device type (формат jsonb)
- Старые текстовые значения → пустые поля (не ронять данные)

## Часть 5 — Правая колонка: InBody, замеры, таймер

- БАГ замеров: `measurements` → `body_measurements`, lookup по body_client_id не phone_digits
- Таймер 7 дней в обоих блоках (InBody и Замеры): следующий = последний + 7 дней
  - «Следующий через N дн.»; ≤2 — «Скоро» жёлтым; «Сегодня»; прошло — «Просрочено на N дн.» красным
  - Полоска прогресса 7 дней
- InBody подробнее: bfm, bmi, bmr, tbw, inbody_score + изменение к прошлому тесту и со старта
- «Тестов: N, первый ДД.ММ.ГГГГ» в шапке InBody-блока

## Часть 6 — Список клиентов: новые колонки

- Текущий абонемент (ближайший по окончанию + «+N»), сеансы, последний визит, дней с него
- Сортировка «дней без визита» и фильтр «не было N+ дней» (7/14/30)
- Серверный расчёт одним батч-запросом на страницу
- Мобиле: компактно (абонемент + «N дн. назад» второй строкой)

## Часть 7 — Проверка, документация, деплой

- npm run build, check:mobile без ошибок
- Скриншоты 1440 и 375, светлая и тёмная тема
- Обновить docs/modules/crm-core.md, STATE.md, QUEUE.md, zamery.md
