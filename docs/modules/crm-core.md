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
- `crm_clients` — клиенты: ФИО, phone (цифры 7XXXXXXXXXX), birth_date, ad_source_id, referrer_client_id, iin (12 цифр), id_issued_by, id_valid_until, photo_path (bucket `crm-client-photos`), contraindications, profile_complete, source (manual / fitbase_import), fitbase_client_id, is_deleted; **+ gender ('female'|'male'|null), address, skirt_size ('XS'|'S'|'M'|'L'|'XL'|'XXL'|'XXXL'|null), device_settings (jsonb {device_type_code:{vacu,ik}}), important_note, instagram, tiktok, email (task 87)**
- `crm_client_tags` — личные метки клиентов: id, branch_id, name, color, is_active, created_at (task 86)
- `crm_client_tag_links` — id, client_id, tag_id, created_at (task 86)
- `crm_client_comments` — id, client_id, text, author, created_at, updated_at (task 86)
- `crm_payment_methods` — kind: cash / cashless / deposit / bonus (депозит и бонусы системные)
- `crm_device_types` (vacuactiv, infrastep, infrashape, rollshape), `crm_devices` — №, default_phase active/finishing, session_minutes, status working/repair/disabled/broken
- `crm_plans` — kind abonement/service; цена, is_promo («Акция»), is_free_booking, is_system, validity_days, extra_days, freeze_days, guest_visits, auto_activate_days, max_deferred_start_days; **+ allowed_weekdays int[], time_from time, time_to time (ограничение «Когда действует», task 89)**
- `crm_client_plans` — **+ allowed_weekdays, time_from, time_to: копируются из crm_plans по триггеру при продаже** (task 89)
- `crm_plan_items` — состав: вид аппарата + фаза + сеансы; **+ device_type_codes text[] для Cross-пула, is_unlimited bool, daily_limit int** (task 89)
- `crm_suppliers` (+ link), `crm_products`, `crm_product_supplies` (партии: quantity, remaining, закуп, розница, дата), вью `crm_product_stock`
- `crm_promo_codes` (percent/fixed, лимиты, applies_to_all) + `crm_promo_targets` (plan/product)
- `crm_audit_log`
- `crm_visit_history` — визиты из Fitbase: fitbase_reg_id (unique), client_id, fitbase_contract_id, status (строка 'attended'|...), **visit_at** (не visit_date), training_name
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

## Ключевые решения (добавлены)
- **«Когда действует» (task 89, 24.11):** `crm_plans` и `crm_client_plans` хранят `allowed_weekdays int[]` (1=пн–7=вс; null = без ограничения), `time_from time`, `time_to time`. При продаже через `crm_checkout` значения копируются в `crm_client_plans` по триггеру. Шаблон (crm_plans) и проданный абонемент (crm_client_plans) хранят их независимо — изменение шаблона не затрагивает уже выданные абонементы. Lib `planRestriction.ts` на клиенте: `formatPlanRestriction` (строка «пн–пт · 08:00–17:00»), `planMatchesSlot` (проверка по дате+слоту). Серверные ошибки PLAN_WRONG_DAY/PLAN_WRONG_TIME для crm_booking_move возвращают реальные дни/время из абонемента.

## Ключевые решения (добавлены task 90)
- **Фаза строки состава (task 90, 24.11):** у КАЖДОЙ строки состава, включая пул Cross, фаза выбирается вручную (Активная / Завершающая). Значения по умолчанию нет — без фазы не сохранить. Автоподстановки по типу аппарата нет. Для Cross-пула — одно поле фазы на весь пул (рядом с «Сеансов в пуле»). В `validateItems` (сервер) и в форме (клиент) обязательная проверка.
- **Дубли аппаратов в составе (task 90, 24.11):** один аппарат не может повторяться ни внутри пула, ни между пулом и обычной строкой. Проверяется и на клиенте (`savePlan`, `SplitDialog`), и на сервере (`validateItems`, `/split`).

## Сделано
### 25.11.2026 · task 97 · Карточка клиента: цены абонементов, новый макет, PlanDetailModal, лента «Действия», фикс посещений
- **`src/core/permissions.ts`**: добавлен ключ `clients.log` (Системный журнал) в блок `clients`.
- **`src/index.ts`**: функция `runCrmFillPlanPrices` + handler GET/POST `/run/crm-fill-plan-prices?mode=dry|apply` — бэкфилл `price/sale_id/sold_by` для fitbase-планов через `crm_sale_items`.
- **`src/http/crm.ts`**:
  - `POST /kviz/api/crm/clients/:id/checkout` (через RPC `crm_checkout`): после продажи заполняет `price`, `sale_id`, `sold_by` в `crm_client_plans` через `crm_sale_items`.
  - `GET /kviz/api/crm/clients/:id/plans`: добавлены `price,sale_id,sold_by` в select; `crm_plans` теперь включает `extra_days`.
  - `GET /kviz/api/crm/clients/:id/visits`: исправлен баг — `booking_time→starts_at`, `service_name→training_name`.
  - `GET /kviz/api/crm/client-plans/:id/visits`: новый эндпоинт — посещения по конкретному абонементу (crm_bookings.client_plan_id).
  - `GET /kviz/api/crm/clients/:id/feed?kind=actions`: новый вид ленты — человекочитаемые действия из `crm_client_comments` (freeze/unfreeze/break/agreement) + `crm_audit_log`.
- **`kviz/client/src/index.css`**: попап увеличен до `98vw × 98vh` (было 92×92).
- **`kviz/client/src/pages/crm/ClientsPage.tsx`**:
  - `PlanDetailModal`: новый компонент с 4 датами, ценой, составом, историей заморозок, посещениями по плану, кнопками действий.
  - Левая колонка перестроена: ФИО → телефон → депозит+бонусы → ДР → источник/визиты → соцсети → Fitbase+ред. → метки → активные абонементы карточками (клик → PlanDetailModal) → Подробнее.
  - Центр: 2 вкладки Покупки/Посещения (Покупки = Пакеты + Лента); таб «Действия» вместо «Лог».
  - Правая колонка: добавлена секция «Важное» внизу (юбка, аппараты, противопоказания).
  - `feedTab` тип обновлён до `'all'|'comments'|'tasks'|'actions'`.

### 25.11.2026 · хотфикс 94-1 · ReferenceError «Cannot access 'nt' before initialization» — карточка клиента
- **`kviz/client/src/pages/crm/ClientsPage.tsx`**: `reloadPlans` и `loadVisits` (useCallback) перемещены выше первого `useEffect`, который их использовал. При сборке Vite минифицирует имена — `reloadPlans` → `nt`, TDZ-ошибка при рендере. Карточка клиента не открывалась ни во вкладке Клиенты, ни по ПКМ в Расписании.
- `tsc --noEmit` по crm/: ошибок TDZ (TS2448/TS2454) не найдено; прочие ошибки — pre-existing, не относятся к задаче.

### 24.11.2026 · task 94 · Список и карточка клиента: фильтры, посещения, заморозка с причиной, автометки
- **`src/core/clientAutoLabels.ts`**: добавлен `ClientExtraData` (profile_complete, birth_date); `batchAutoLabelsToday` принимает `extras?: Map<string, ClientExtraData>` → вычисляет `incomplete_profile` и `birthday` внутри.
- **`src/http/crm.ts`**:
  - `inChunks<T>` — батч-хелпер: режет `.in()` запросы на куски по 150 (обход ограничения PostgREST URL).
  - GET `/kviz/api/crm/clients` (all-scan): все 5 `.in()` запросов заменены на `inChunks`; добавлены pre-фильтр по личной метке (`filter_tag`) и post-фильтр по автометке (`filter_auto_label`); логирование ошибок Supabase.
  - GET `/kviz/api/crm/clients/:id/summary`: старый ручной `systemTags[]` заменён на `batchAutoLabelsToday` → возвращает `auto_labels: AutoLabelResult[]` вместо `system_tags: string[]`.
  - GET `/kviz/api/crm/clients/:id/visits`: новый эндпоинт; объединяет `crm_bookings` + `crm_visit_history`; параметры `limit`/`offset`/`status`; возвращает `{items, total}`.
  - POST `/kviz/api/crm/client-plans/:id/freeze`: добавлен обязательный параметр `reason`; после RPC вставляет `crm_client_comments` kind='freeze'.
  - POST `/kviz/api/crm/client-plans/:id/unfreeze`: аналогично — `reason` обязателен, вставляет kind='unfreeze'.
- **`kviz/client/src/pages/crm/ClientsPage.tsx`**:
  - `ClientRow.system_tags` → `auto_labels: { code, name, color }[]`; `ClientSummary.system_tags` → `auto_labels`.
  - Удалён `SYSTEM_TAG_LABELS`; renderCell 'tags' и левая колонка попапа рисуют метки динамически по color из API.
  - `FreezeDialog`: обязательное поле «Причина», кнопка отключена пока пусто.
  - Новый `UnfreezeDialog` с обязательным полем «Причина».
  - `ClientPopup`: новые вкладки «Важное» / «Посещения» в центральной колонке; вкладка Посещения фильтруется (Все/Пришла/Не пришла/Отменена), пагинация 30/стр.
  - Соцсети + LTV вынесены в сворачиваемый `<details>` (по умолчанию свёрнут).
  - Тулбар: добавлен фильтр «Метки» — автометки по коду + личные метки через `tag:<id>`.

### 24.11.2026 · task 93 · Автометки клиента — сервер + настройки
- **`src/core/clientAutoLabels.ts`** (новый): `batchAutoLabelsForDay` / `batchAutoLabelsToday` — 2-раундовый пакетный расчёт; используют `crm_client_auto_labels` как источник определений; InBody через `body_clients → inbody_tests`, замеры через `body_measurements`.
- **`src/http/crm.ts`**: `GET /kviz/api/crm/clients/auto-labels?ids=...` (до `clients/:id`); `GET /kviz/api/crm/client-auto-labels`; `PATCH /kviz/api/crm/client-auto-labels/:code` (debt заблокирован, параметры валидируются); `writeAudit` на PATCH.
- **`SettingsPage.tsx`**: раздел «Автометки клиента» в `ClassesSection` — превью-чип, вкл/выкл, цветопикер, inline-поля параметров (days/visits/sessions/kg/per_week/weeks/min_plan_days).
- **Новые таблицы (SQL выполнен Сергеем)**: `crm_client_auto_labels` (code PK, name, short_name, color, sort, is_active, params jsonb); `crm_client_tag_links` (task 86, уже была); системные этикетки `crm_booking_labels` помечены `is_active=false` (archived).

### 24.11.2026 · task 90 · Cross доработки: фаза вручную, дубли, форма состава
- **`SettingsPage.tsx`**: добавлен `crossPhase` state; фаза у каждой обычной строки и у Cross-пула выбирается вручную (empty default «— фаза —», обязательное поле); убрана автоподстановка `defaultPhaseForType`; `addItem` и `updateItem` не меняют фазу автоматически. Выпадающий select аппарата в обычной строке получил `minWidth: 0` (больше не сжимается в стрелку). Дублирование аппаратов проверяется на клиенте перед save.
- **`src/http/crm.ts`**: `validateItems` принимает любую `VALID_PHASES` для пула (не только `'active'`); добавлен `DAILY_LIMIT` в `SCHEDULE_RPC_ERRORS`; `/split` добавил дубль-проверку и использует `i.phase` для пула (ранее хардкод `'active'`).
- **`ClientsPage.tsx`**: `SplitDialog` — добавлено поле `phase: string` в `SplitRow`; select фазы для обычных строк и для Cross-пула; дубль-проверка и проверка заполненности фазы перед submit; payload включает `phase`.

### 24.11.2026 · task 89 (2) · Ограничение абонемента: «Когда действует» в Настройках + показ везде
- **`src/http/crm.ts`**: POST/PATCH /plans принимают `allowed_weekdays`, `time_from`, `time_to` с валидацией; GET client-options и GET clients/:id/plans возвращают эти поля; suggest фильтрует даты/слоты по ограничению.
- **`SettingsPage.tsx`**: форма абонемента — блок «Когда действует»: 7 кнопок-дней, поля время «с/до», пресеты (Весь день / Дневной / Вечерний / Выходные). Список планов показывает ограничение оранжевым текстом.
- **`KassaPage.tsx`**: карточка абонемента — строка ограничения оранжевым.
- **`ClientsPage.tsx`**: вкладка Абонементы — строка ограничения оранжевым под сеансами.
- **Новый `kviz/client/src/lib/planRestriction.ts`**: `formatPlanRestriction`, `planMatchesSlot`.

### 24.11.2026 · task 89 · Cross (пул) абонементы: itemLabel, SettingsPage, сервер, SplitDialog
- **`kviz/client/src/utils/planItemLabel.ts`** (новый): `itemLabel(item, dtNameMap)` — унифицированное отображение состава (одиночный, пул Cross, безлимит, ×N, из/остаток).
- **`kviz/client/src/pages/crm/SettingsPage.tsx`** — `PlansSection` полностью переписана: `LocalItem` с `is_cross`, `is_unlimited`, `daily_limit`; Cross-строки группируются в синем блоке с одним полем «Сеансов»; в списке состав показывает `itemLabel`.
- **`kviz/client/src/pages/crm/ClientsPage.tsx`** — `SplitDialog`: тип `SplitRow`, переключатель Cross, чекбоксы для выбора аппаратов пула, сервер получает `{ is_pool: true, device_type_codes, sessions }`.
- **`src/http/crm.ts`** — `validateItems` стала async: проверяет device_type_code XOR device_type_codes≥2, дубли, 1 пул макс, фаза пула='active', is_unlimited, daily_limit, коды в БД. POST/PATCH /plans сохраняют `device_type_codes`, `is_unlimited`, `daily_limit`. `/client-plans/:id/split` принимает pool-строки. GET client-options добавляет `device_type_codes,is_unlimited,daily_limit`.

### 24.11.2026 · task 88 · Таблица клиентов: 14 колонок, сортировка, resize/reorder, localStorage, мобиль
- **Сервер `src/http/crm.ts`:** `batchEnrich()` расширен — теперь возвращает `system_tags`, `personal_tags`, `ltv`, `deposit`, `source_name` одним батчем на 100 строк (3 раунда параллельных запросов). Добавлен `getCashPmIds()` кэш. GET `/kviz/api/crm/clients` переработан: новый дефолтный sort=`last_visit` DESC, параметр `dir`; all-scan для сортировок `last_visit/days/ltv/deposit/plan/sessions/source`, ORDER BY для `name/created/birth/profile/fitbase`. Добавлен GET `/kviz/api/crm/clients/junk-report` (только admin): мусорные записи по паттернам, счёт без активности, 10 примеров.
- **Клиент `kviz/client/src/pages/crm/ClientsPage.tsx`:** добавлены `ColDef`/`COLS`/`TableSettings` + localStorage per-login. Компонент `ClientsTable` — `<table>` с sticky thead, resize колонок (pointer events), reorder (HTML5 drag&drop), sortable заголовки со стрелками. Компонент `ColumnsPanel` — показ/скрытие + reorder метками. Desktop/tablet (>640px): таблица; телефон (≤640px): карточки как раньше + мобильный select сортировки. Кнопка «Мусор» (admin) показывает результат junk-report inline.

### 24.11.2026 · 5252c3f · Карточка клиента: DeviceType.is_active фильтр убран (поля VacuActiv/InfraShape не показывались)
- `ClientsPage.tsx`: интерфейс `DeviceType` — убрано поле `is_active` (в БД нет); фильтр `.filter(x => x.is_active)` удалён → теперь все типы аппаратов отображаются в редакторе «Важное».

### 24.11.2026 · 3c4fcc9 · Карточка клиента: Важное без important_note, InBody без tbw, переход через router
- **Важное (важное/device_settings):** `important_note` убран из редактора и просмотра (данные в БД не тронуты). Вместо вертикального списка аппаратов — одна строка из двух пар: VacuActiv и InfraShape бок о бок (`flex-wrap: wrap`, на телефоне переносятся). Только `contraindications` и `skirt_size` остались.
- **InBody — `tbw` → `whr,data`:** в `src/http/crm.ts` summary-запрос `inbody_tests` убрана несуществующая колонка `tbw`; добавлены `whr,data`. Добавлен `console.error` при ошибке запроса.
- **Переход на отчёт через router:** `ClientsPage.tsx` — `<a href>` и `window.location.href` заменены на `navigate('/reports/client/:id', { state: { fromCrmClientId } })`. Добавлен `useNavigate` в импорт и в `ClientPopup`.
- **Кнопка «← К клиенту»:** в `ClientPage.tsx` читается `location.state.fromCrmClientId`; если задан — показывается кнопка, которая делает `navigate('/crm/clients#client=<id>')` — возвращает в список и открывает попап.

### 24.11.2026 · (task 87.2) · Карточка клиента: фиксы task 87
- **device_settings NOT NULL:** `saveImportant` отправляет `{}` вместо `null`; сервер PATCH заменяет null/не-объект на `{}`.
- **InBody регрессия:** summary использует `client.phone` как fallback если `body_clients.phone_digits` null.
- **ДР из ИИН:** исправлен век в `iinToDob` — 1–2→1800-е, 3–4→1900-е, 5–6→2000-е (было инвертировано); `ageFromDate` не показывает возраст при дате рождения в будущем.
- **Таймер замеров:** `timerLabel` теперь использует чистые даты в UTC+5 (`toLocaleDateString('sv-SE', {timeZone:'Asia/Yekaterinburg'})`) без округления миллисекунд — исправляет сдвиг на 1 день.
- **Аватар удалён:** кружок с буквой и фото убраны из левой колонки; ФИО сразу первой строкой.
- **Нижняя информация:** fontSize 13→14 в блоке Источник/Клиент с/LTV/Визитов/Последний визит/Депозит.
- **Аппараты (device_settings):** только VacuActiv и InfraShape в форме (filter по `['vacuactiv','infrashape']`); label «Vacu» (не «Вакуум»); max=99; просмотр формат «DeviceName — Vacu N · ИК M».
- **Замеры тела:** заголовок «Замеров: N, первый ДД.ММ.ГГГГ»; крупный total_cm с дельтой со старта; SVG спарклайн (inline, без библиотеки); список всех зон с дельтой; клик по блоку → отчёт клиента. Сервер: добавлены zone-колонки в measure_latest/first, `measure_count`, `measure_points`.

### 23.11.2026 · (task 87) · Карточка клиента: доработки по замечаниям
- **Part 1:** `src/http/crm.ts`: `normSocial()` хелпер (убирает @, домен, trailing slash); PATCH добавлены `gender` (валидация 'female'|'male'|null, '' → null), `instagram`/`tiktok` через normSocial, `email` (toLower); POST: gender default 'female' (не ''), те же поля.
- **Part 1 UI:** `ClientsPage.tsx`: `fmtPhone()` форматирует `+7 777 618 61 87`; левая колонка: 22px bold ФИО, отдельная строка телефона с кнопками WhatsApp/Позвонить, строка ДР+возраст, строка соцсетей (instagram/tiktok/email если заполнены); `ClientForm`: поля instagram/tiktok/email, gender select 'female'/'male'/null; gender display 'female'→'Женский'.
- **Part 2:** `src/http/crm.ts` summary: `crm_visit_history` фильтр исправлен на `status === 'attended'` (было `=== 3`) и колонка `visit_at` (было `visit_date`); добавлен счётчик из `crm_bookings status='attended'`; `visits_attended_total = history + bookings`.
- **Part 3:** `POST /kviz/api/crm/clients/fill-fitbase-data` — загружает crm_ad_sources, клиентов без ad_source_id c fitbase_client_id, fitbase_leads по client_fitbase_id; сопоставляет source по имени без регистра; обновляет только пустые; возвращает `{updated, not_found_sources}`. Кнопка «Дозаполнить данные» в FitbaseImport.
- **Part 4:** skirt_size → `<select>` XS…XXXL; device_settings: 2 input (Вакуум + ИК) на аппарат вместо текстового поля; старые строковые значения → пустая структура при init.
- **Part 5:** `body_measurements` вместо `measurements`, lookup по `body_client_id`; таймер 7 дней в InBody и Замерах: `timerLabel(lastIso)` — прогресс-бар + цветовые метки ≤2/'Сегодня'/просрочено; InBody header: «Тестов: N, первый ДД.ММ.ГГГГ»; новые поля: bfm, bmi (ИМТ), bmr, tbw (Вода), inbody_score (Баллы).
- **Part 6:** `batchEnrich()` добавляет `plan_name`, `extra_plans_count`, `sessions_summary`, `last_visit_at`, `days_since_visit`; sort=days_without_visit (all-scan + сортировка в памяти); min_days фильтр; toolbar: 2 новых select; список: правая колонка абонемент + сеансы + «N дн. назад» (цвет по порогам 14/30 дней).
- **Part 7:** build чистый, check:mobile без новых ошибок.

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
- **[25.11.2026, срочно] Карточка клиента не открывается** — «Не удалось открыть карточку», консоль: `ReferenceError: Cannot access 'nt' before initialization` (index-14vw575R.js:588). Ломает и вкладку Клиенты, и ПКМ по брони в Расписании (ClientPopup). Появилось после задачи 94 (7f05121); до неё работало. Вероятно, переменная/функция используется до объявления (TDZ) в ClientPopup или циклический импорт.
- (нет известных)

## Следующее
- **(записано 26.11.2026) Окно абонемента — визуальная пересборка → ТЗ 109 (`docs/tasks/109-crm-core-plan-window-redesign.md`), выполнять ПОСЛЕ ТЗ 108.** Решения:
  - Окно больше: `Modal size="xl"` ≈ min(1200px, 96vw) × min(860px, 92vh); на телефоне bottom sheet. Компонент выносится в `PlanWindow.tsx` (режимы client / template), старый `PlanDetailModal` удаляется.
  - Две колонки: слева — название, **цена крупно (32px)**, **вид оплаты** (из продажи: способы и суммы из `crm_sale_payments` + `crm_payment_methods`, номер чека, кассир; если в чеке были другие позиции — «оплата за весь чек»), **состав крупно** (аппарат 18px, остаток 24px + полоса прогресса), 4 даты, «Когда действует», заморозки, кнопки. Справа — **посещения списком сверху вниз** на всю высоту со счётчиками по статусам.
  - Посещения Fitbase-абонементов брать из `crm_visit_history` по `fitbase_contract_id` (иначе всегда пусто). История заморозок — только этого абонемента (сейчас показывает заморозки всех абонементов клиента — баг), через `crm_audit_log` + причина из `crm_client_comments`. Новый эндпоинт `GET /client-plans/:id/detail`. SQL не нужен.
  - Окно открывается по клику на **любой** абонемент в «Покупки → Пакеты» (все статусы, Fitbase тоже); кнопки в строке — stopPropagation.
  - **Окно-шаблон в Настройках → Абонементы и Услуги:** клик по строке → то же окно без данных клиента: цена и состав крупно, справа «Условия» (срок, доп. срок, заморозка, гостевые, автоактивация, отложенный старт), кнопка «Редактировать» → существующая форма; ✎ остаётся.
  - «Составь намного больше» прочитано как «Состав крупнее» (уточнить у Сергея, если имелось в виду другое).
  - Право на изменение дат абонемента (`crm.plan_edit_dates`) в ТЗ 109 не входит — остаётся ниже.
- **(записано 25.11.2026, сводка незакрытых задач, решения Сергея)**
  - **Метки — все в Настройках.** Системные (их ставит система): новый клиент, замеры InBody, замеры тела, редко ходит, нужна оплата, кончился абонемент, кончается абонемент, давно не ходит, частичная оплата, просрочка по оплате. У каждой в Настройках: **название задаётся вручную**, вкл/выкл, цвет. Ручные метки (теги клиента) — там же: создать / название / цвет / архив. Сейчас таблица `crm_client_auto_labels` уже есть (task 93: is_active, color, params), но название не редактируется и нет «нужна оплата» / «частичная оплата» / «просрочка по оплате» (две последние — после рассрочки в Кассе).
  - Метки, которых нет в списке Сергея (last_session, weight_plateau, incomplete_profile, birthday) — остаются в Настройках, по умолчанию выключены (предложение Claude).
  - **Интервал замеров — настройка:** InBody и замер тела раз в неделю; в Настройках задаётся «через сколько дней делать замер» (отдельно InBody и тело). Таймер в карточке и метки measure_inbody / measure_body берут эти значения.
  - Карточка: task 97 в работе (новый макет, окно абонемента, лента «Действия», фикс посещений, право clients.log) — эти пункты из таблицы не дублировать.
  - Раздел «Записи» в карточке с «сгоревшими» — после task 97.
- **(записано 25.11.2026, пришло в чат «CRM: расписание») Абонементы в карточке клиента:**
  - **Стоимость** на каждом абонементе — сколько клиент заплатил (из продажи).
  - **4 даты на каждом абонементе** (сейчас частично есть только у активного): дата покупки → дата активации → дата предварительного окончания (за 10 дней до реального; для напоминаний) → дата окончания и в скобках окончание с доп. сроком (у Сергея доп. срок 2 месяца, задаётся в Настройках, в шаблоне абонемента).
  - **Баг: посещения не попадают во вкладку «Посещения»** — у абонемента «VACU 12+RS12» использовано 1 из 12 (11/12), а во вкладке «Нет посещений». Проверить GET /clients/:id/visits (task 94): брони attended из crm_bookings не находятся.
  - **Окно абонемента (модальное)** — клик по абонементу в карточке клиента открывает его окно (сейчас не открывается): состав и остатки, все даты, стоимость, заморозки, история посещений именно по этому абонементу; изменение срока действия (даты окончания / доп. срока) — только у тех, кому разрешено правом в Настройках (новое право, например crm.plan_edit_dates), с записью в журнал и в комментарии клиента.
  - **Такое же окно в Настройках → Абонементы** (шаблон): без посещений, общие настройки шаблона; изменения действуют только на новые продажи — проданные абонементы клиентов не меняются (все параметры копируются в абонемент клиента при продаже: состав, сроки, доп. срок, заморозка, ограничение по дням/времени, цена).
- **(task 94, отложено) Абонементы в карточке:** у каждого — **стоимость** (сколько заплатил, из продажи) и **открытие абонемента** (клик → модальное окно PlanDetailModal: состав, остатки, сроки, история заморозок из crm_client_comments kind='freeze'/'unfreeze', история посещений по абонементу, кнопки Заморозить/Разморозить/Распределить). Нужна колонка `price` в `crm_client_plans` или join с `crm_sale_items`.
- **(task 94, отложено) Метки клиента:** «Неполный платёж» НЕ входит — делать вместе с рассрочкой/долгами отдельной задачей.
- **Профиль клиента: раздел «Записи» (перенесено из crm-schedule.md, требования 23.11.2026, ТЗ не собирать до команды)** — в карточке клиента CRM: дата и время записи, выбранные аппараты по времени (напр. 14:00 Vacu, 14:40 Rollshape), статус посещения, история записей включая «сгоревшие».

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
- Вкладка «Воронка» (сейчас заглушка) и лента активности в карточке клиента — идеи из Frappe (`docs/crm-reference-map.md`).
- **(записано 24.11.2026) Хвосты справочника и импорта (делает Сергей, без кода):** цена «Безлимита», дни заморозки у абонементов, партии товаров с розничной ценой (Шоппер — 1000 ₸); ночной импорт истории в cron-job.org (`/run/fitbase-history-import?kind=nightly`, 03:00); выяснить статус визита Fitbase **8** (сейчас пишется как unknown).
- **(записано 24.11.2026) Мусорные записи клиентов:** отчёт есть (`GET /kviz/api/crm/clients/junk-report`, только admin) — ждёт решения Сергея: архив / переименование / оставить.
