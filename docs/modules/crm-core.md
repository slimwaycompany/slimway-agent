# Модуль: CRM — Настройки и Клиенты

Чат в claude.ai: «CRM: настройки и клиенты» · Файл: `docs/modules/crm-core.md`

## Назначение
Ядро своей CRM (для переезда с Fitbase): справочники во вкладке «Настройки» (только админ) и база клиентов во вкладке «Клиенты». Сейчас каркас: с Fitbase не синхронизируется, в Fitbase не пишет.

## Где код
- `kviz/client/src/pages/crm/SettingsPage.tsx` — вкладка «Настройки»: аппараты, абонементы/услуги (с составом), товары и поставки, поставщики, промокоды, виды оплаты, рекламные источники, занятия, сервис (crm_settings)
- `kviz/client/src/pages/crm/ClientsPage.tsx` — вкладка «Клиенты»: список клиентов, анкета, карточка клиента (вкладки Анкета / Абонементы / Продажи), баланс депозита и бонусов
- `src/http/crm.ts` — единственный серверный файл CRM (`buildCrmRouter`): все маршруты `/kviz/api/crm/*`, `runCrmLifecycle()`
- `src/jobs/fitbaseHistoryImport.ts` — импорт истории Fitbase: `linkBodyClients`, `getLinkStats`, `startHistoryImport`, `runFitbaseHistoryImport`; маршруты `/run/fitbase-history-import` в `src/index.ts`

## Таблицы
- `crm_branches` — филиалы (сейчас один `00000000-0000-0000-0000-000000000001`)
- `crm_settings` — key/value настройки (`lessons.no_show_burns_session`, `schedule.day_start` 07:00, `schedule.day_end` 23:00, `schedule.step_minutes` 30)
- `crm_ad_sources` — рекламные источники (`requires_referrer`)
- `crm_clients` — клиенты: ФИО, phone (цифры 7XXXXXXXXXX), birth_date, ad_source_id, referrer_client_id, iin (12 цифр), id_issued_by, id_valid_until, photo_path (bucket `crm-client-photos`), contraindications, profile_complete, source (manual / fitbase_import), fitbase_client_id, is_deleted; **+ gender (M/F), address, skirt_size, device_settings, important_note (task 86)**
- `crm_client_tags` — личные метки клиентов: id, branch_id, name, color, is_active, created_at (task 86)
- `crm_client_tag_links` — id, client_id, tag_id, created_at (task 86)
- `crm_client_comments` — id, client_id, text, author, created_at, updated_at (task 86)
- `crm_payment_methods` — kind: cash / cashless / deposit / bonus (депозит и бонусы системные)
- `crm_device_types` (vacuactiv, infrastep, infrashape, rollshape), `crm_devices` — №, default_phase active/finishing, session_minutes, status working/repair/disabled/broken
- `crm_plans` — kind abonement/service; цена, is_promo («Акция»), is_free_booking, is_system, validity_days, extra_days, freeze_days, guest_visits, auto_activate_days, max_deferred_start_days
- `crm_plan_items` — состав: вид аппарата + фаза + сеансы
- `crm_suppliers` (+ link), `crm_products`, `crm_product_supplies` (партии: quantity, remaining, закуп, розница, дата), вью `crm_product_stock`
- `crm_promo_codes` (percent/fixed, лимиты, applies_to_all) + `crm_promo_targets` (plan/product)
- `crm_audit_log`
- `crm_visit_history` — визиты из Fitbase: fitbase_reg_id (unique), client_id, fitbase_contract_id, status (0–4), visit_date, training_name
- `crm_fitbase_import_runs` — прогресс и чекпоинты импорта истории: kind, status, total_clients, processed, планы/продажи/возвраты/визиты, errors, last_client_fitbase_id
- `body_clients` — добавлены `crm_client_id` (FK crm_clients) + `crm_link_method` ('fitbase_id'|'phone'|'manual')

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Обязательные поля клиента: ФИО, телефон, дата рождения (из ИИН), рекламный источник (+ кто порекомендовал), ИИН, кем выдано, действует до. Фото и противопоказания — необязательно. Импортированные из Fitbase — с пометкой «Анкета неполная».
- ИИН маскируется в списках (9203••••••45), просмотр анкеты пишется в журнал.
- Фаза хранится в составе абонемента (RollShape может быть завершающей в одном абонементе и активной в другом); на аппарате — только по умолчанию.
- «Пробное занятие» и «Замер InBody» — системные бесплатные услуги, запись без кассы.
- Склад: карточка товара + поставки партиями; цена продажи = розница последней поставки; себестоимость — сначала старые партии.
- Промокод действует на выбранные абонементы/услуги/товары (быстрые кнопки «все акционные», «все с аппаратом X»); со скидкой админа не суммируется. Скидки — только админ.
- Удаление и архив во всех справочниках; удалять только неиспользуемое.
- `profile_complete` пересчитывается при импорте из Fitbase и при сохранении анкеты (исправлено в `9574ebf`).

## Мобильная версия
Задача 34 (04.11.2026):
- `ClientsPage`: список скрывается при открытом клиенте (`clients-list--detail`); кнопка `← Список` в заголовке детали (только ≤640px).
- `ClientForm`: 2-колоночная сетка → 1 колонка на ≤640px (`client-form-grid`).
- `SettingsPage`: sidebar скрывается при выборе раздела (`settings-sidebar--hidden`), кнопка `← Назад` в заголовке контента.

## Сделано
### 23.11.2026 · (task 86 доработка) · Карточка клиента — попап 92vw/vh, 3 равных колонки, левая колонка полная
- `ClientsPage.tsx`: удалена шапка (`cp-header`), закрытие — крестик `cp-close-btn` (absolute top-right); аватар/ФИО/телефон (кнопка копирования)/Fitbase-бейдж/кнопка «Редактировать»/метки перенесены в верх ЛЕВОЙ колонки; добавлены строки: Дата рождения+возраст, Источник+реферер, Клиент с, LTV, Визитов, Депозит/Бонусы; активный абонемент берётся из `plans` (не из summary), показывается первый по valid_until + «+ещё N»; сеансы по аппарату: pool (`device_type_codes`) и unlimited (`is_unlimited`) — с именами аппаратов через `dtNameMap`.
- InBody: исправлены поля `pbf` (не body_fat_percent) и `ffm` (не visceral_fat); показываются вес, % жира, жир кг (weight-ffm), мышцы (smm) + дельта к предыдущему тесту (`inbody_prev`); ссылка исправлена на `/reports/client/:body_client_id`.
- Замеры: показывает total_cm + изменение со старта (`measure_first.total_cm`); добавлены `cp-delta-pos/neg` классы.
- `src/http/crm.ts`: summary возвращает `inbody_prev` (2-й InBody ряд по дате убывания), `measure_first` (первый замер по дате возрастания для дельты со старта).
- `index.css`: popup 92vw×92vh, закрыт overflow, добавлен `cp-close-btn`, header скрыт, body `1fr 1fr 1fr`.

### 23.11.2026 · (task 86) · Карточка клиента v2 — попап, метки, заморозка, лента
- `ClientsPage.tsx` полностью переписан (~780 строк): правая панель заменена на `ClientPopup` (overlay, 3 колонки: лево=клиент, центр=3 окна, право=InBody+замеры); URL-синхронизация через hash `#client=:id`; новые компоненты `FreezeDialog`, `SplitDialog`; inline-редактирование «Важного»; лента с вкладками и полем для комментариев.
- `index.css`: добавлены `.cp-*` классы (`.cp-overlay`, `.cp-popup`, `.cp-body` 3-col grid, `.cp-window`, `.cp-feed-*`, `.cp-timer`); адаптив ≤1024px (2 col) и ≤640px (1 col, bottom sheet).
- `src/http/crm.ts`: новые эндпоинты — `POST/DELETE /client-plans/:id/freeze|unfreeze|split`; `GET/POST/PATCH/DELETE` для client-tags и client-comments; `GET /clients/:id/feed?kind=&before=` (cursor-based, 30 items, объединяет comments+tasks+log); `GET/POST/PATCH/DELETE /client-tags` (CRUD системных и личных). Перепсано `GET /clients/:id/summary`: LTV через `crm_sale_payments - crm_refund_payments` (cash/cashless), добавлены system_tags (6 видов), personal_tags, inbody_latest, measure_latest.
- `SettingsPage.tsx`: добавлена секция `ClientTagsSection` (Настройки → группа «Заявки» → «Метки клиентов»), цветовой picker, CRUD через `/client-tags`.
- RPCs: `crm_plan_freeze(p_plan_id, p_days)`, `crm_plan_unfreeze(p_plan_id)` — выполнены в SQL Editor.
- Новые поля `crm_clients`: gender, address, skirt_size, device_settings, important_note — добавлены в PATCH + ClientForm.

### 23.11.2026 · 2680116 · task 85 · Импорт истории Fitbase: связка InBody↔CRM, абонементы/продажи/возвраты/визиты, сводный API
- `src/jobs/fitbaseHistoryImport.ts`: `linkBodyClients()` (по fitbase_client_id → crm_link_method='fitbase_id', затем по 10 цифрам телефона → 'phone'; manual не трогаем); `getLinkStats()` (linked/no_crm_pair/disputed); `startHistoryImport(kind)` / `runFitbaseHistoryImport(kind)`.
- Импорт для каждого crm_client с fitbase_client_id: контракты → `crm_client_plans` (source='fitbase', fitbase_contract_id, upsert by fitbase_contract_id, needs_split, sessions_total/left); продажи → `crm_sales`+`crm_sale_items`+`crm_sale_payments` (grouped by order_id, source='fitbase', shift_id=null, fitbase_step_id); возвраты (amount<0) → `crm_refunds` (source='fitbase', upsert by fitbase_step_id); визиты → `crm_visit_history` (upsert by fitbase_reg_id, date windowing).
- Checkpoint каждые 10 клиентов → `crm_fitbase_import_runs`; nightly-режим только активных клиентов + linkBodyClients; guard против двойного запуска.
- `src/index.ts`: `POST/GET /run/fitbase-history-import` (CRON_SECRET), `/status`.
- `src/http/crm.ts`: `POST /kviz/api/crm/fitbase-history-import` (admin, UI-триггер), `/status`; `GET /inbody-link-stats`, `POST /inbody-link-auto`; `POST /body-clients/:id/link|unlink`; `GET /clients/:id/summary` (ltv, active_plan, visits_attended_total, last_visit_at, inbody_last, measure_last, body_client_id); `/clients/:id/plans` теперь передаёт source, name, needs_split, sessions_total/left; lifecycle-auto-activate пропускает планы без plan_id.
- `ClientsPage.tsx`: null-safe cashier/number в «Продажах», метка «Fitbase», cp.name/needs_split/sessions для Fitbase-планов.
- `SettingsPage.tsx` (InBodySettingsSection): блок «Связь замеров с клиентами CRM» (счётчики, спорные, кнопка автопривязки); блок «Импорт истории из Fitbase» (полный / только активные, прогресс-бар, статистика).

### 23.11.2026 · (task 84) · Зонд Fitbase: история клиента — продажи, оплаты, сеансы + связка с InBody
- `src/jobs/probeClientHistory.ts`: GET `/run/probe-client-history?client_ids=...` или `?phone=...`; по умолчанию авто-выборка ~8 клиентов (включая 87767681579) из fitbase_operations + fitbase_clients_cache.
- Для каждого клиента: `/client/:id`, `/client-contract?client_id=`, `/till-order-steps?client_id=`, `/schedule-registration?client_id=&date_from=&date_to=`; суммирует контракты, оплаты, возвраты (amount<0), продажи товаров (item_type=product), визиты.
- Глобальные счётчики Fitbase: `/client?page_size=1`, `/client-contract?page_size=1`.
- Supabase (только SELECT): кол-во crm_clients / body_clients, совпадения по 10 цифрам телефона в памяти, дубли телефонов в crm_clients, inbody_tests без body_client_id.
- Результат: зонд возвращает JSON с masked именами/телефонами; отчёт-заготовка `docs/research/fitbase-client-history.md` (заполнить после запуска на проде).
- Маршрут в `src/index.ts` после probe-control.

### 23.11.2026 · (task 83-1) · BranchSection: socials как 4 поля, NOT NULL поля-списки, валидации БИН/телефона/часов
- `BranchSection` (`SettingsPage.tsx`): 4 отдельных поля Instagram/WhatsApp/TikTok/Telegram вместо текстового JSON; `save()` собирает объект `{}` минимум (никогда не null); `formKey` для remount после load; поля timezone/currency/language как `<select>` (список казахстанских поясов / KZT-RUB-USD / ru-kk); поле `name` обязательное; `ss()` хелпер для чтения подполей socials.
- `PUT /kviz/api/crm/branch` (`src/http/crm.ts`): `name` добавлен в allowed; БИН: пусто или ровно 12 цифр (400); телефон: `normalizePhone()` → `7XXXXXXXXXX` (400 при неверном); timezone/currency/language: пустая строка → не обновлять (NOT NULL в базе); socials: если не объект или null → записывать `{}`; часы: close_time > open_time для открытых дней (400 с именем дня); все ошибки базы → `console.error` + общий текст.

### 29.10.2026 · (текущий) · пагинация клиентов, bypass 1000-row, нормализация поиска
- `GET /kviz/api/crm/clients`: теперь возвращает `{items, total}` (вместо массива); добавлен `branch_id` фильтр; поиск по телефону нормализован (strip non-digits, последние 10 цифр).
- `runFitbaseImport` + `recalculate-profiles`: добавлен `.limit(10000)` на запросы к `fitbase_clients_cache` и `crm_clients` — обход лимита Supabase 1000 строк по умолчанию.
- `ClientsPage.tsx`: принимает `{items, total}`; кнопка «Показать ещё»; счётчик «N из M клиентов»; `ClientPlan` → `purchased_at`, `sessions_left/total`; `SaleRow.total` (не `total_amount`); `searchReferrer` принимает `{items}`.

### 28.10.2026 · (следующий) · async импорт клиентов + phone fix
- Импорт Fitbase теперь фоновый (не зависает на 500 клиентах): прогресс-бар, опрос каждые 2 сек, пачки по 100.
- `normalizePhone` для crm_clients теперь возвращает `7XXXXXXXXXX` (без +).

### 28.10.2026 · 9574ebf · CRM Касса этап 2
- Импорт из Fitbase пишет в `crm_clients` (исправлен баг с `fitbase_clients_cache`).
- `profile_complete` пересчитывается при каждом импорте и сохранении.
- Карточка клиента: вкладки Анкета / Абонементы / Продажи, баланс депозита и бонусов.

### 28.10.2026 · e219a92 · правки форм Настроек
- Формы по схеме базы, состав аппаратов в абонементах/услугах, удаление + архив, поставщик со ссылкой, типы оплаты нал/безнал.

### 27–28.10.2026 · 03df169 · этап 1
- Вкладка Настройки — 7 групп: **Моё** (Оформление), **Студия** (Аппараты, Занятия и расписание, ТВ-экран), **Что продаём** (Абонементы, Услуги, Промокоды, Товары и склад, Поставщики), **Деньги** (Виды оплаты, Финансы), **Заявки** (Воронки CRM, Рекламные источники, Причины отказа, Теги заявок, Типы задач, Скриптолог), **Команда** (Сотрудники, График смен, Контроль менеджеров, Линейки ролей, Дов. компьютеры), **Связи и данные** (Сопоставление FB, АТС, Данные InBody). Переименования: «Занятия» → «Занятия и расписание», «Сервис» → «Данные InBody». Поиск с синонимами в верхней части меню. Каждый раздел виден только при праве `settings.<раздел>`; «Оформление» — без прав, всем. Вкладка Клиенты (список, анкета, карточка).

## Открытые баги
- **(записано 23.11.2026)** Рекламный источник не подтянулся ни у одного клиента из Fitbase: импорт (runFitbaseImport, src/http/crm.ts ~стр. 192) не заполняет ad_source_id. В Fitbase источник есть (`advertising_source.name` — так его уже читает fitbaseCrmSync.ts:60 для лидов; проверить, есть ли он у клиента в fitbase_clients_cache.raw, иначе брать из лида клиента). Нужно: сопоставить по названию с crm_ad_sources (без учёта регистра), не найденные — списком в отчёт (создавать или нет — решает Сергей), заполнять только пустой ad_source_id, ручной выбор не перетирать. Вручную источник выбирается нормально.
- **(записано 23.11.2026)** Пол: не стоит ни у кого и в форме не выбирается. В PATCH /kviz/api/crm/clients/:id (src/http/crm.ts ~стр. 1055) в списке разрешённых полей нет `gender` — значение отбрасывается. Плюс ошибка check ниже. Предложение Claude: студия сейчас только женская — всем существующим клиентам поставлен gender = 'female' одним SQL (решение Сергея 23.11); двух мужчин (учётка Сергея и один клиент) Сергей меняет сам. Новым клиентам по умолчанию — 'female'.
- **(записано 23.11.2026)** Сохранение клиента падает: `new row for relation "crm_clients" violates check constraint "crm_clients_gender_check"`. Допустимо только `gender` = 'female' | 'male' | null. Форма, скорее всего, шлёт пустую строку или русское значение («Женский»). Нужно: '' → null, «Женский» → 'female', «Мужской» → 'male'; ошибку показывать по-русски, не сырой Postgres.
- (нет активных)

## Следующее
- **(записано 23.11.2026) Список клиентов — новые колонки:** текущий абонемент (название; если несколько активных — ближайший по окончанию и «+N»), количество сеансов (остаток / всего; по аппаратам или пулу — коротко, безлимит — «∞»), последний визит (дата) и сколько дней с него прошло (crm_visit_history attended + crm_bookings attended). Считать на сервере одним запросом для страницы списка, не по клиенту. Желательно сортировка и фильтр по «дней без визита». Пока только эти поля.
- **Мультифилиальность — план переезда (оценка 23.11.2026, делаем позже, отдельным чатом «Мультифилиальность»):** объём — 2–3 задачи Claude Code + 1 SQL.
  - Уже есть: `branch_id` во всех таблицах CRM; `app_users.branch_id` и `all_branches`; карточка филиала (`crm_branches`) и часы работы по дням (`crm_branch_hours`, задача 83).
  - Переделать:
    - константа `BRANCH_ID` на сервере (~200 мест в 15 файлах: crm, crmLeads, control, control2, manager, pbx, checkin, jobs…) → филиал из выбора сотрудника / сессии;
    - SQL-функции с вшитым первым филиалом и часовым поясом `Asia/Yekaterinburg` (`crm_pick_device`, `crm_day_hours`, `crm_booking_*`) → филиал параметром, пояс из `crm_branches.timezone`;
    - `crm_settings` сейчас общие → решить, какие настройки свои у филиала (правила отмены, этикетки, шаг сетки);
    - синк Fitbase и агент воронки привязаны к одному клубу;
    - переключатель филиала в шапке + правило «сотрудник видит только свой филиал, если не all_branches»;
    - кнопка «Добавить филиал» в Настройки → Филиал.
  - Решить до старта: (1) общая ли база клиентов; (2) работает ли абонемент одного филиала в другом; (3) общий ли склад; (4) своя ли кассовая смена у филиала (скорее да).
  - Правило до переезда: в новых ТЗ не вшивать филиал и часовой пояс заново.
- **Карточка клиента v2 (task 86 выполнена 23.11.2026):** попап сделан. Следующее: кнопка «Отчёт по замерам» → страница результатов клиента из модуля «Замеры»; фильтрация списка по меткам клиентов; ручная привязка «спорных» body_clients через карточку.
- **Справочники под переезд (записано 23.11.2026):** абонементы/услуги и товары, которые продаются в Fitbase, должны быть заведены в Настройках (crm_plans + состав crm_plan_items, crm_products), иначе импортированные пакеты и позиции остаются с plan_id / product_id = null и без разбивки по аппаратам. После заведения — перепривязать импорт по названию (plan_id, product_id, needs_split). Сначала — список названий из импорта (SQL в чате), решить: заводить руками или импортировать каталог из Fitbase.
  - **Ответы Сергея по справочнику (23.11.2026):** заводим только абонементы с активными пакетами (27 названий), историю (11 названий без активных) не заводим. CROSS = любой из VacuActiv / InfraShape / InfraStep на выбор. «INFRASHAPE / INFRASTEP / VACU - N» = N общих сеансов, клиентка каждый раз выбирает любой из трёх аппаратов → в составе абонемента нужен ПУЛ (группа аппаратов с общим счётчиком) — доработка схемы, кассы (crm_checkout), расписания и форм; делать ДО заведения справочника. «Акция Х2 …» (цена 0) — подарок, больше не продаётся: в справочник не заводим, активные — ручное распределение сеансов в карточке. Двойники «8/12 CROSS + ROLL» с разной ценой и «C Акция 12 CROSS + 12 ROLL» — одна акция, цену меняли: один абонемент по текущей (последней) цене. «Безлимит» — срок 2 года. Товары — все 7; «Шоппер» продан со скидкой 100% по промокоду, в справочник — с реальной ценой. Названия сопоставлять без учёта регистра и пробелов по краям.
- Карточка клиента: кнопка «Отчёт по замерам» → страница результатов клиента из модуля «Замеры». Связка по телефону (crm `7XXXXXXXXXX` → body_clients `+7XXXXXXXXXX`).
- **Мультифилиальность (записано 28.10):** переключатель филиалов в Настройках; создание филиала со всей информацией — ТОО, БИН, адрес, время работы, часовой пояс, телефон, соцсети, валюта, язык, страна, город; при создании абонемента/услуги — кнопка «Создать во всех филиалах». Решить: общая ли база клиентов, общий ли склад, работают ли абонементы между филиалами.
- Связать клиентов CRM с базой InBody (по телефону, спорные — ручное подтверждение).
- Вкладка «Воронка» (сейчас заглушка) и лента активности в карточке клиента — идеи из Frappe (`docs/crm-reference-map.md`).
- Окно сотрудников (логины, пароли, данные) — консультанты для расписания.
