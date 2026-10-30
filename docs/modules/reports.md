# Модуль: Отчёты

Чат в claude.ai: «Замеры и отчёты» · Файл: `docs/modules/reports.md`

## Назначение
Вкладка «Отчёты»: отчёты по колонкам как в Fitbase «Отчёты и аналитика».

## Где код
- `kviz/client/src/pages/reports/ReportsPage.tsx` — главная страница отчётов (колонки: Менеджер, Продажи, Клиенты, Маркетинг)
- `kviz/client/src/pages/reports/OccupancySection.tsx` — секция «Занятия и загруженность»
- `kviz/client/src/pages/MetricsPage.tsx` — вкладка «Воронка»: метрики лидов/визитов/продаж из `fitbase_leads`/`fitbase_visits`
- `src/http/metrics.ts` — API `/kviz/api/metrics/*`: факт дня, дневной такт, данные по воронке

## Таблицы
- `fitbase_operations` — продажи/операции из Fitbase (подтягиваются кнопкой, только новые)
- `fitbase_leads`, `fitbase_visits` — для воронки
- `manager_task_done`, `manager_task_templates` — задачи менеджера (вкладка «Менеджер» в отчётах)
- `cash_closings`, `staff_shifts` — смены (вкладка «Менеджер → Смены»)
- `fitbase_contracts` — абонементы клиентов Fitbase: fitbase_id, client_fitbase_id, name, status, price, payment_date, begin_date, activation_date, end_date, raw. Синхронизируется в `/run/fitbase-crm-sync`.
- `metrics_month_plan` — план месяца: `branch_id uuid`, `month date` (ВСЕГДА первое число месяца `YYYY-MM-01`), `leads_plan integer`, `sales_plan numeric`, `updated_by text`, `updated_at timestamptz`. PK `(branch_id, month)`.
- `metrics_day_input` — настройки дня: `branch_id uuid`, `day date`, `budget numeric`, `leads_plan integer`, `sales_plan numeric`, `is_day_off boolean`, `on_shift text[] NOT NULL DEFAULT '{}'`, `updated_by text`, `updated_at timestamptz`. PK `(branch_id, day)`.
- `sync_state` — метки синхронизации (key=`fitbase_ops_synced_at`).

## Ключевые решения
- Колонки: **Менеджер** (Задачи — менеджер свои, админ свои + все; Смены), **Продажи** (отчёт по продажам), **Клиенты** (замеры тела, InBody, результаты студии со ссылкой на ТВ), **Маркетинг** (Факт дня, Дневной такт). «Настройки» из отчётов перенесены во вкладку Настройки (28.10).
- Отчёт по продажам: фильтры кассир, менеджер, товар, тип оплаты; период день/неделя/месяц/свой; кнопка «Обновить FB».
- Маркетинг: «Факт дня» (лиды дня → **квал** → записи → пришли → продажи) и «Дневной такт» (лиды → квал → записи → пришли → купили). **Квал** = лид с `client_fitbase_id != null` (заведена карточка клиента). **Живые** = текущий `funnel IN ('Новые заявки','Новички','Постоянные') && stage != 'Отказ'` — показывается под карточкой Квал. Фильтр источника и менеджера работает на всех шагах: шаги 1,2 по lead.source/manager; шаги 3,4,trial_sold — по источнику/менеджеру последней карточки клиента (clientLeadMap); шаг 5 — по источнику лида / по op.manager. Рекламные источники Fitbase: Рекомендация клиента клуба, Сайт, Instagram, Проходящий трафик, Входящий звонок, WhatsApp, Блогер бартер, Блогер Зарина, Блогер Хадия, Блогер Ната, 2гис, Таргет, Таргет тикток.
- `fitbase_visits.status` — целое число (0=записан, 1=подтверждён, 2=отказ, 3=пришла, 4=не пришла); колонка переведена в integer SQL'ем 29.10.2026.
- `fitbase_operations.raw` — полный ответ Fitbase API; `raw.client.id` = Fitbase client ID операции (для связки с лидом).
- Отчёт по замерам и по InBody ведут на одну страницу результатов клиента внутри «Отчётов» (фигура слева).
- Боковая панель — слева (переехала с правой стороны).

### Структура `/lead` и `/finance-operation`
- `/lead`: `id`, `name`, `surname`, `phone`, `client_id` (Fitbase client id, null для новых), `manager.full_name` (менеджер лида), `advertising_source.name` (источник), `funnel_step.*`, `created_at` (unix-строка)
- `/finance-operation` (через `/till-order-steps`): `id`, `order_id` (все строки одного заказа — один order_id), `item_id` (id абонемента клиента для item_type='contract'), `item_type`, `item.name`, `amount` (отрицательный у возврата), `manager.full_name`, `created_by_user.full_name` (кассир), `client.id`, `payment_type`

### Продажи, возвраты, заказы
- Продажа = один заказ (`order_id`): все строки заказа суммируются. Считаем count distinct order_id.
- Возврат (`op_type='refund'`): учитывается в день возврата (вариант Б). Связь с продажей: для абонементов — по `item_id`; для товаров — `client_id + item_type + item_id`.
- Кассир = `created_by_user.full_name`, менеджер = `manager.full_name`.
- `fitbase_operations.amount` всегда хранится как абсолютное значение (Math.abs).

### Типы покупки абонемента (renewals)
- **Новая** — нет предыдущего платного (price>0, название без «пробн», status≠deleted) контракта строго до даты покупки
- **Продление** — есть такой контракт, и end_date предыдущего >= даты покупки или ≤30 дней после; если end_date null — renewal
- **Вернулась** — >30 дней после end_date предыдущего
- ~~Сразу несколько~~ — **не используется с task 27**: все покупки одного дня классифицируются одинаково (все смотрят на контракты строго до этого дня). Предыдущий = только платный, не пробный, не удалённый, **строго раньше** текущей даты (`< date`).

### Структура записи `/schedule-registration` (Fitbase)
- `id`, `status` (число), `client_id` (верхний уровень — Fitbase client ID), `created_at` (unix)
- `event.date` ("YYYY-MM-DD"), `event.time_start` ("HH:MM:SS" — срезать до HH:MM), `event.time_end`
- `event.place.name` — аппарат (resource), `event.trainers[0].full_name` — тренер/ведущий (manager)
- `event.training.id` / `event.training.name` — вид занятия (service)
- `client_service`, `client_contract` — абонемент клиента (объект `{id, name}` или null); `name` → abonement
- Объекта `client` в записи НЕТ. Полей `manager`, `resource`, `abonement` на верхнем уровне НЕТ.

### Таблица статусов `fitbase_visits.status`
| Код | Значение | Константа |
|-----|----------|-----------|
| 0 | Записан | `VISIT_STATUS_BOOKED` |
| 1 | Подтверждён | `VISIT_STATUS_CONFIRMED` |
| 2 | Отказ/отмена | `VISIT_STATUS_REFUSED` |
| 3 | Пришла | `VISIT_STATUS_VISITED` |
| 4 | Не пришла | `VISIT_STATUS_NOSHOW` |
Источник: из записей Fitbase, `REG_STATUS_*` в `src/config.ts`. `VISIT_CANCELLED_STATUSES = Set([2])`.

### Связка клиент → лид (buildClientLeadMap)
- Ключ Map — `Number(client_fitbase_id)`. Supabase возвращает bigint-колонки как строки; без `Number()` Map.get не находит запись — было 0 по Записям и Пришли в «По источникам» / «По менеджерам».
- `clSrc(id, clm)` и `clMgr(id, clm)` делают `clm.get(Number(id))`.
- Запасной ключ — телефон: если `client_fitbase_id` клиента не находится в map, ищем его телефон через `fitbase_clients_cache` → сравниваем с `fitbase_leads.client_phone` через `digitsOnly` (последние 10 цифр).
- Все запросы Supabase, где строк > 1000, идут через `fetchAll()` (постраничный perебор по 1000). Критичные: `buildClientLeadMap` (все лиды), `visitsAll` в day-rhythm, visits в funnel/fact-day, operации в syncContracts.
- Лок синка `fitbase-crm-sync` снимается в `finally`, каждый шаг синка в своём try/catch.

### Определение пробного занятия
`is_trial = true` если: `event.training.id === 16` ИЛИ `isTrialServiceName(training.name)` ИЛИ `isTrialServiceName(abonement)`.
`TRIAL_SERVICE_NAMES = ['Бесплатное пробное занятие', 'Абонемент: Пробное занятие']` (сравнение без учёта регистра).

## Сделано
### 30.10.2026 · (task 30) · Фикс схемы metrics таблиц, строки по кассирам, admin-check API продаж
- `src/http/metrics.ts` GET `/daily`: чтение из `metrics_day_input` по колонке `day` (не `date`); план месяца запрашивается по `from` (= `YYYY-MM-01`); ошибки планRes/dayInputRes логируются в `console.error`.
- `src/http/metrics.ts` PUT `/month-plan`: `month` сохраняется как `YYYY-MM-01` (DATE тип в БД); добавлены `updated_by`/`updated_at`; `onConflict: 'branch_id,month'` (правильный порядок PK).
- `src/http/metrics.ts` PUT `/day-input`: поле сохраняется как `day` (не `date`); добавлены `updated_by`/`updated_at`; `on_shift` всегда пишется (`[]` если не передан, т. к. NOT NULL); `onConflict: 'branch_id,day'`; ошибки Postgres → лог, пользователю — русский текст.
- `src/http/cash.ts`: добавлена проверка `admin` в `GET /kviz/api/cash/sync-time` (было без проверки роли).
- `kviz/client/src/pages/reports/ReportsPage.tsx` `DailyMetricsSection`: строки кассиров под «Выручка факт ₸» (мелкий шрифт, отступ, итого); хелпер `row` получил 6-й параметр `totOverride`; исправлены итоги для Накопл./Прогноз/Бюджет.

### 30.10.2026 · (task 29) · Метрики по дням: экран, таблица по дням, план, редактор дня, chart
- `src/http/metrics.ts`: добавлены три эндпоинта:
  - `GET /kviz/api/metrics/daily?month=YYYY-MM&buy=all|new` — все дни месяца одним ответом; поля: leads/qual/booked/visited/bought/funnel_sales_amt (с buy-фильтром), sales_fact (студийный итог), by_cashier, orders_count, sales_cumulative, sales_forecast (накопительная / прошедшие рабочие дни × рабочих дней); план распределяется пропорционально на рабочие дни (1-е число = выходной по умолчанию) с учётом переопределений.
  - `PUT /kviz/api/metrics/month-plan` — сохранить/обновить общий план месяца (leads_plan, sales_plan).
  - `PUT /kviz/api/metrics/day-input` — сохранить настройки дня (is_day_off, budget, on_shift, leads_plan override, sales_plan override).
- `ReportsPage.tsx`:
  - `Section` type расширен: добавлен `'daily-metrics'`.
  - `REPORT_COLUMNS` Маркетинг: добавлен пункт «Метрики по дням» (adminOnly).
  - `FactDaySection` получает prop `onOpenDailyMetrics(month: string)` — кнопка «📅 Метрики по дням» в шапке (только если prop передан); переход сохраняет месяц в sessionStorage и открывает секцию.
  - Новый компонент `DailyMetricsSection`: навигация по месяцам, чипы buy=all|new, форма плана месяца, транспонированная таблица (строки = метрики, колонки = дни), клик на заголовок дня → модал настройки дня (выходной, бюджет, на смене, переопределения плана), BarChart план vs факт.

### 30.10.2026 · (task 28) · Квал = client_fitbase_id != null; Живые; по источникам/менеджерам
- `metrics.ts` `Lead` interface: добавлено поле `funnel: string | null` (из `fitbase_leads.funnel`).
- `metrics.ts` `buildFunnel`: `in_work` считается как `client_fitbase_id != null` (раньше `status != null && status !== '0'`).
- `metrics.ts` fact-day: SELECT добавлен `funnel`; вместо `inWork` — `qual` (`client_fitbase_id != null`) и `alive` (funnel IN Новые заявки/Новички/Постоянные && stage != Отказ); ответ `in_work` содержит `alive_count` + `alive_items`; `by_source`/`by_manager` дополнены `alive_count`.
- `metrics.ts` day-rhythm: `qualified` = `client_fitbase_id != null`; `by_source`/`by_manager` — тот же фикс.
- `ReportsPage.tsx`: `FD_LABELS.in_work` = 'Квал'; `CONV_LABELS` — тоже; карточка «Квал» — строка «Живые: N» (кликабельная, открывает дрилл-модал клиент/воронка/этап/менеджер); таблицы «По источникам» и «По менеджерам» — колонка «Живые» после «Лидов».

### 30.10.2026 · (task 27) · classifyPurchase: same_day убран, «Вернулась» в карточке Продления, проценты 100%
- `metrics.ts` `classifyPurchase`: фильтр изменён с `<= date` на `< date` — теперь контракты того же дня не учитываются как «предыдущие», тип `same_day` удалён из возвращаемых значений. Все покупки одного клиента в один день получают одну категорию (new или renewal).
- `metrics.ts` renewals endpoint: аналогичный фикс — `prevContracts` фильтруется строго `< purchaseDate`, тип `PType` без `same_day`, cards без `same_day`.
- `metrics.ts` fact-day: удалены `sameDayOrders`/`sameDayAmt`/`same_day` из ответа; `totalSalesAmt` = new + renewal + returned + goods.
- `ReportsPage.tsx` `FactDayCards`: карточка «Продления» показывает `renewal.amount + returned.amount` как сумму, подстрочник «из них вернулись: N / X ₸» если returned > 0; строка «Сразу несколько / Вернулись» под карточками убрана. Проценты теперь в сумме 100% (Новые + Продления-с-вернулась + Товары = totalSalesAmt).
- `ReportsPage.tsx` `RenewalsSection`: `same_day` убран из `RENEWAL_LABELS`, `RenCards`, `CARD_COLORS`, списка карточек и фильтра типа.

### 30.10.2026 · (task 26) · Классификация покупок: goods/new/same_day/renewal/returned, тест-возвраты, редизайн карточек
- `metrics.ts`: `OrderRow` + `groupOrders` — добавлены `itemType` (из `raw.item_type`) и `itemId` (из `raw.item_id`).
- `metrics.ts`: новая функция `classifyPurchase(o, contractsByClient)` — единая классификация для fact-day и renewals. `goods` = item_type != 'contract'. Предыдущий «валидный» абонемент = price>0 + name не содержит 'пробн' + status!='deleted' + fitbase_id!=текущему. `new` = нет валидных предыдущих. `same_day` = предыдущий куплен в тот же день. `renewal` = предыдущий active (end_date≥дата покупки) или ≤30 дней после end_date. `returned` = >30 дней. Исправлена корневая причина ошибки: пробные/бесплатные абонементы теперь не считаются «предыдущими».
- `metrics.ts` fact-day: тест-детекция — продажа+возврат одного (cid, itemId, date) исключаются из всех счётчиков и сумм (`testKeys`). `cleanSaleOrders`/`cleanRefundOrders`/`testSaleOrders`. В ответе добавлены `steps.same_day`, `steps.returned`, `steps.goods`, `steps.total_net` (с `test_count`, `test_amount`). `steps.sales`/`steps.renewals` содержат `test_items`, `refund_items`.
- `metrics.ts` fact-day: `by_source`/`by_manager` — Л→П% теперь считается как `unique buyers (клиенты с заказами) ∩ period leads / leads count`, а не по `lead.status='-1'`. Тест-заказы исключены.
- `metrics.ts` renewals: фильтр предыдущих контрактов теперь тоже применяет price>0 и not 'пробн'.
- `ReportsPage.tsx`: `FdTotalNet` тип. Новый компонент `FactDayCards` — двухрядный макет (Воронка: Лиды/В работе/Записи/Пришли; Деньги: Новые/Продления/Товары/Итог). Деньги-карточки кликабельны (Новые, Продления → `SalesDrillModal`). Строка «Сразу несколько / Вернулись» под Деньги-рядом.
- `ReportsPage.tsx`: `SalesDrillModal` — 3-колоночный попап (Покупки / Чистые возвраты / Тест) с вкладками на 375px. Итог-строка: покупки − возвраты = итог. Кнопки переключения колонок.
- `ReportsPage.tsx`: `CrossConvPanel` расширен — второй селект теперь включает «Продления» и «Купили (всего)». Типы `ConvStageFrom`/`ConvStageTo`.
- `ReportsPage.tsx`: таблицы — числа выравнены вправо, нули → '—', строки через строку (#f8fafc), строка «Итого» в конце каждой таблицы. Charts: менеджеры показываются по первым двум словам (не только имя), добавлена Legend.

### 30.10.2026 · 3711ac3 · Факт дня: продления, сквозная конверсия, фильтры, графики (задача 25)
- `metrics.ts` fact-day: разделение продаж на новые/продления через `fitbase_contracts` (isRenew = client_fitbase_id имеет предыдущий payment_date). Карточка `steps.renewals` (новая). `steps.sales` = только новые, поля `from_period_leads`/`from_old_leads`.
- `metrics.ts` fact-day: фильтр `manager` на продажах теперь по lead-map (clMgr), не op.manager. Фильтр `cashier` распространяется на лиды/визиты через `cashierCids` (client_id всех продаж кассира). `by_manager` теперь keyed по clMgr (не op.manager). Перемещён fetch ops перед filter leads/visits.
- `metrics.ts` fact-day: `by_source`/`by_manager` добавлены `new_count`, `renewal_count`, `new_amount`, `renewal_amount`, `lead_to_buy_pct` (% лидов со статусом '-1' / всего лидов).
- `ReportsPage.tsx`: FunnelView показывает 6 карточек (порядок `FD_STEP_ORDER`). Панель «Сквозная конверсия» — два селекта, норма (В работе→Записи 60-70%, Записи→Пришли 85%+, Пришли→Купили 50-80%), цветовой бар. Двухколоночный макет: таблицы 44% + графики recharts 55%. Сворачиваемые таблицы (CollapsibleTable, localStorage, «Свернуть всё»). Новые колонки: Новые ₸, Продл. ₸, Итог ₸, Л→П%. Панель ChartsPanel 4 вкладки: Менеджеры (stacked bar новые/продления), Источники (лидов/продажи), Где проседаем (horizontal bar), Кассиры.
- Установлен `recharts@3.10.1`.

### 30.10.2026 · (задача 24) · clSrc/clMgr Number(), fetchAll лимит 1000, лок finally, phone fallback
- `metrics.ts`: `clSrc()`/`clMgr()` исправлены: `clm.get(Number(id))` вместо `clm.get(id)` — bigint из Supabase приходит как строка, Map имеет числовые ключи → записи и приходы уходили в «(без источника)».
- `metrics.ts`: добавлен хелпер `fetchAll(build)` — постраничный перебор по 1000 строк до конца. Применён к: `buildClientLeadMap` (все лиды), visits в fact-day/funnel, visitsAll в day-rhythm, srcRows/mgrRows (all-time), operации и контракты в renewals. `syncContracts` в fitbaseCrmSync.ts — тоже `fetchAll` для all operations.
- `buildClientLeadMap`: phone fallback — для клиентов без лида по client_fitbase_id ищет телефон в `fitbase_clients_cache` → сравнивает с `fitbase_leads.client_phone` через `digitsOnly`. Возвращает тот же `Map<number, {source,manager}>`, callers не меняются.
- Лок синка снимается в `finally` (не зависит от ошибки). Каждый шаг (`syncLeads`/`syncVisits`/`syncContracts`) в своём try/catch — ошибка одного шага не отменяет остальные. При `!locked` — «Обновление уже идёт, подождите». Фронт показывает count + ошибки шагов.

### 30.10.2026 · 55dc7a4 · продажи=заказы+возвраты, кассир, абонементы, продления
- `fitbaseCrmSync`: `syncLeads` — исправлен маппинг (`l.manager`, `l.client_id`, `l.phone` вместо `responsible`/`client`). Добавлен `syncContracts` — `GET /client-contract?client_id=…` для клиентов с операциями item_type='contract', upsert в `fitbase_contracts`.
- `metrics.ts`: `fact-day` — запрос sale+refund-операций, группировка по `raw.order_id`; карточка «5. Продажи» возвращает `net_amount`/`refund_count`/`refund_amount`; фильтр `cashier`; `by_source`/`by_manager` содержат `sales_count`/`net_amount`; `by_cashier` таблица; `availableManagers`/`availableCashiers` фильтруются по выбранному периоду.
- `metrics.ts`: новый `GET /kviz/api/metrics/renewals` — классифицирует покупки абонементов (new/renewal/same_day/returned) по данным `fitbase_contracts`; карточки, таблица, by_manager.
- `ReportsPage.tsx`: FunnelView — продажи показывают нетто + «Продажи N шт / X ₸ · Возвраты M шт / Y ₸» с кнопкой дрилла; кассир-dropdown в FactDay; таблица по кассирам; by_source с «Продаж / Итог ₸»; новая секция «Продления» в колонке Продажи.

### 29.10.2026 · (предыдущий) · фильтр источника и менеджера на всех шагах, by_source/by_manager таблицы
- `metrics.ts`: добавлен `buildClientLeadMap()` — все лиды без фильтра по дате, группировка по `client_fitbase_id`, последняя запись (по created_at ascending). Хелперы `clSrc`, `clMgr`, `opCid` (из `raw.client.id`). Лиды в period теперь загружаются без SQL фильтра по source/manager — фильтрация в JS, чтобы `by_source`/`by_manager` всегда показывали полный разрез. Шаги 3,4 (визиты) и trial_sold фильтруются через `clientLeadMap`. Шаг 5 (продажи): source через clientLeadMap, manager через `op.manager`. `by_source` расширен до 6 колонок (source, leads, in_work, trial_booked, visited, trial_sold_count, sales_amount). Добавлен `by_manager` 8 колонок с `items[]` для дрилла. `availableManagers` объединяет `fitbase_leads.manager` + `fitbase_operations.manager`. Аналогично для `day-rhythm` (by_source и by_manager с 5 шагами воронки).
- `ReportsPage.tsx`: исправлен `chipActive` (border вместо borderColor). Dropdown менеджера показывается всегда. Таблицы by_source и by_manager с прокруткой; by_manager — клик открывает DrillModal.

### 29.10.2026 · (предыдущий) · syncVisits fix, TRIAL_SERVICE_NAMES, статусы визитов, fact-day trial_sold
- `src/config.ts`: `TRIAL_SERVICE_NAME` → массив `TRIAL_SERVICE_NAMES` + хелпер `isTrialServiceName()`. Добавлены `VISIT_STATUS_*` числовые константы и `VISIT_CANCELLED_STATUSES = Set([2])`.
- `fitbaseCrmSync.ts` `syncVisits()`: исправлен главный баг — `time_start "08:00:00"` → срезается до `"08:00"` (был `RangeError: Invalid time value`); `client_fitbase_id` = `v.client_id` (верхний уровень, не `v.client.id`); batch-fetch имени/телефона из `fitbase_clients_cache`; `resource` = `event.place.name`; `manager` = `event.trainers[0].full_name`; `abonement` из `client_service`/`client_contract`; `is_trial` через `isTrialServiceName()`.
- `metrics.ts`: `buildFunnel` и `day-rhythm` — заменены хардкодные `[0,1,3]`/`=== 3` на `notCancelled()` + `VISIT_STATUS_VISITED`. `fact-day` — шаг 3 исключает `VISIT_CANCELLED_STATUSES`; добавлен запрос `trialSalesData` по `item IN TRIAL_SERVICE_NAMES` (фильтр по item, не op_type/amount); в ответе `trial_sold_count`, `visit_at` и `resource` у шага `trial_booked`.
- `ReportsPage.tsx`: `DrillItem` + `resource`; `FunnelStep` + `trial_sold_count`; DrillModal и карточка воронки показывают аппарат и «Продано услуг: N».

### 29.10.2026 · da948c1 · is_trial fix, async sync, auto-load
- `src/config.ts`: добавлен `TRIAL_SERVICE_NAME = 'Бесплатное пробное занятие'`.
- `fitbaseCrmSync.ts`: `is_trial` теперь проверяет и `training?.name === TRIAL_SERVICE_NAME` — исправляет нулевые «Записи на пробное».
- `metrics.ts`: `POST /metrics/sync` стал асинхронным (мгновенный ответ, фоновая задача); добавлен `GET /metrics/sync` для опроса статуса.
- `ReportsPage.tsx`: FactDay и DayRhythm автоматически загружаются при монтировании (убрана кнопка «Показать»); кнопка «↺ Обновить Fitbase» опрашивает GET /metrics/sync каждые 2 сек; общий хук `useSyncButton`.

### до 28.10.2026 · c7cb5ae · факт дня, дневной такт, скрытый отчёт
- FactDay / DayRhythm завершены; скрытая страница клиента с фигурой.

### до 28.10.2026 · 443e6bd · доска отчётов, замеры, InBody, студия
- Колонки отчётов (Менеджер / Продажи / Клиенты / Маркетинг), секции замеров и InBody.

### до 28.10.2026 · 04aa468 · доска отчётов для всех пользователей
- Отчёты доступны всем (не только admin), синхронизация авторизации.

### Квал и Живые (task 28)
- **Квал** = лид периода, у которого `client_fitbase_id IS NOT NULL` в `fitbase_leads` — по лиду заведена карточка клиента. Это событие: цифра не меняется при последующем изменении этапа.
- **Живые** = лиды периода, у которых `funnel IN ('Новые заявки','Новички','Постоянные') AND stage != 'Отказ'` на момент запроса. Сверка: Новые заявки 171 + Новички 17 = 188 за октябрь 2026.
- В «Метриках по дням» строка Квал в воронке лидов — то же правило `client_fitbase_id != null`.
- `fitbase_leads.funnel` = `funnel_step.purchase_funnel.name` из Fitbase API (синкается в `fitbaseCrmSync.ts`).

## Открытые баги
- «Занятия и загруженность» — пусто (0 за 21–23.10); причина: visit_date был null (баг syncVisits исправлен — нужен прогон синка).
- Renewals: `type='returned'` — «вопрос открытый», показывается как отдельный тип.

## Следующее
- Одним ТЗ: автозагрузка отчётов Замеры / InBody / Продажи + крон Fitbase (/run/fitbase-ops 15 мин, /run/fitbase-crm-sync 30 мин, 08–23) + отчёт «Товары»
- После деплоя: запустить «Обновить Fitbase» → синк лидов/визитов/абонементов → проверить Факт дня 01.10–30.10 (итог = 4 920 000 ₸, возвраты = 642 000 ₸).
- Проверить select count(*), count(manager), count(client_fitbase_id) from fitbase_leads where created_date >= '2026-10-01'.
- Проверить select count(*), count(end_date) from fitbase_contracts.
- Новый отчёт для админа: Менеджер → «Работа с клиентами» (по `script_events`).
- «Занятия и загруженность»: по аппаратам, абонементам, фильтры.
- Отчёты из своей Кассы (`crm_sales`).
- Отчёт «Товары» (записано 30.10, обсуждаем, ТЗ не собирать): в колонке отчётов между «Факт дня» и «Дневной такт». Сколько продано товаров (шт, ₸) за период. Сразу проектировать под будущий переезд на свою CRM: источник данных — слой-адаптер (сейчас fitbase_operations item_type = 'product', потом crm_sales / sale_items / product_supplies), расчёт и интерфейс от источника не зависят. Детали — обсудить.
