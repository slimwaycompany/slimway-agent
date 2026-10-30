# Очередь задач SlimWay Agent

Общая очередь для всех агентов (Claude Code, Codex). Правила работы — в `CLAUDE.md` / `AGENTS.md`.

**Как работать с очередью:**
1. Перед началом: `git pull --rebase origin main`, открыть этот файл.
2. Взять первую задачу со статусом `⏳ ждёт` (или ту, что назвал Сергей). Полный текст ТЗ — в `docs/tasks/<файл>`.
3. Поставить ей статус `🔧 в работе (<агент>, <дата>)`, закоммитить этот файл.
4. Сделать задачу по правилам, проверить на проде.
5. Поставить `✅ готово (<коммит>)` или `🟡 частично (<что не сделано>)`, дописать строку в «Журнал».
6. Если задача требует SQL — не делать обходных путей, поставить `⛔ нужен SQL` и написать SQL текстом в «Журнал».

Статусы: ⏳ ждёт · 🔧 в работе · ✅ готово · 🟡 частично · ⛔ заблокировано · ❓ проверить

## Очередь

| № | Модуль | Задача | ТЗ | Статус |
|---|--------|--------|----|--------|
| 1 | zamery | Замеры: карточка клиента «фигура слева на всю высоту — справа Потеряно / график / все замеры», страница на всю ширину вкладки, печать бланка без нового окна, блок «Потеряно» + «Отправить в результаты студии», экран /results | `docs/tasks/01-measurements-layout.md` | ✅ готово (039631f, 51cd5db + сессия 21.10) |
| 2 | ovcharka | Векторный «Кабинет агента» (девушка + овчарка) вместо пиксельного | — | ✅ готово (4c67966) |
| 3 | agent | Флаг `LIFECYCLE_DRY_RUN` для агента жизненного цикла | — | ✅ готово (ниже) |
| 4 | kviz | Квалификация: привязка к клиенту/лиду Fitbase | — | ⛔ ждёт решения Сергея |
| 5 | manager | Х-отчёт при «Закрыть кассу» — перенесён в 04-3 | — | ⛔ заменено задачей 04-3 |
| 6 | zamery | InBody — перенесён в 04-5 | — | ⛔ заменено задачей 04-5 |
| 04-0 | infra | Подготовка: gitignore, правила, очередь | `docs/tasks/04-now-list.md` | ✅ готово (84ecc3b) |
| 04-1 | zamery | Печать бланка замеров: сдвиг цифр + кнопка «Результаты студии» | `docs/tasks/04-now-list.md#часть-1` | ✅ готово (коммиты 039631f, 51cd5db + текущая сессия) |
| 04-2 | manager | Задачи менеджера: shared / personal | `docs/tasks/04-now-list.md#часть-2` | ✅ готово (144c938 + 4a0e724) |
| 04-3 | manager | Закрытие смены (Х-отчёт): Fitbase + cash_closings + печать + Excel | `docs/tasks/04-now-list.md#часть-3` | ✅ готово (ниже) |
| 04-4 | reports | Отчёт по продажам (admin, Fitbase, Excel) | `docs/tasks/04-now-list.md#часть-4` | ✅ готово (ниже) |
| 04-5 | zamery | InBody: сканирование QR, парсер, сохранение, привязка к замеру | `docs/tasks/04-now-list.md#часть-5` | ✅ готово (812b79c) |
| 04-6 | zamery | Клик по зоне фигуры: анимированное приближение + панель | `docs/tasks/04-now-list.md#часть-6` | ✅ готово (8539a64) |
| 04-7 | zamery | Внешняя ссылка клиента /r/:token | `docs/tasks/04-now-list.md#часть-7` | ✅ готово (f0b6ad5) |
| 04-8 | ovcharka | Кабинет агента: клики (собака, девушка) | `docs/tasks/04-now-list.md#часть-8` | ✅ готово (33da1bd) |
| 04-9 | reports | Вкладка «Метрики» (заглушка) | `docs/tasks/04-now-list.md#часть-9` | ✅ готово (386111d) |
| 04-10 | agent | Проверка агента по воронкам (только отчёт, ничего не менять) | `docs/tasks/04-now-list.md#часть-10` | ✅ готово (docs/reports/funnels-check.md) |
| 04-11 | infra | Финал: проверка прода по всем частям, QUEUE.md | `docs/tasks/04-now-list.md#часть-11` | ✅ готово (ced059b) |
| 05 | zamery | InBody: таблица тестов, импорт CSV, показ в карточке | `docs/tasks/05-inbody-import.md` | ✅ готово (fc718a7, e0ff09e, cd1730c) |
| 06 | agent, zamery | Операции Fitbase в Supabase, закрытие смены по шаблону, приближение зоны | `docs/tasks/06-ops-closing-zoom.md` | 🟡 частично (6a264e0, 5656a1d, af77e4b; fitbase_operations колонки исправлены; серый экран карточки исправлен; InBody привязка добавлена; InBody исследование API — см. Журнал) |
| 07 | zamery, agent, reports | InBody CSV-парсер по номеру колонки, пересчёт, полный лист, попап зоны, синхронизация лидов/записей Fitbase, вкладка Метрики | `docs/tasks/07-inbody-metrics.md` | 🟡 частично (3905f22, 44f8e05; ч.1-6 готовы; проверка на проде — на стороне Сергея; нужен cron для /run/fitbase-crm-sync каждые 15 мин) |
| 08 | reports, manager | Кнопки обновления (auth-fix), закрытие смены (авто-синхрон, 375px), Отчёты для всех (доска, воронки, продажи, занятия), фильтры продаж, загруженность по часам, вкладка после перезагрузки | `docs/tasks/08-reports-board.md` | ✅ готово (04aa468, 199235b) |
| 09 | reports, zamery | Отчёты колонками, клиент внутри замеров/InBody, воронка (фикс нулей), занятия (фикс нулей) | `docs/tasks/09-reports-columns.md` (устарело) | 🟡 частично — ч.1 (колонки) готова; ч.2-8 переведены в обновлённое ТЗ 09-reports-client-flow.md (задача 10) |
| 10 | reports, zamery | Ревизия Отчётов: скрытый отчёт клиента, Факт дня, Дневной такт, перенос клиентов InBody, выгрузка результатов, фикс занятий | `docs/tasks/09-reports-client-flow.md` | 🟡 частично (c7cb5ae, b8435e1; ч.1-8+10 реализованы; проверка UI+воронки+занятий на проде — на стороне Сергея) |
| 11 | scriptolog | Скриптолог SlimWay: Chrome-расширение + страница + API скриптов продаж | `docs/tasks/11-scriptolog.md` | ✅ готово (948e2f0, d20238c, d53a0e6) |
| 12 | crm-core | CRM этап 1: вкладки (Расписание/Клиенты/Воронка/Касса/Настройки), страница Настройки, страница Клиенты | `docs/tasks/12-crm-stage1.md` | ✅ готово (03df169) |
| 13 | crm-core | CRM Настройки — фикс схемы: enum-ы, атомарный план+состав, inline поставщик, системные виды оплаты, архив/удаление | `docs/tasks/13-crm-settings-fix.md` | ✅ готово (e219a92) |
| 14 | crm-kassa | CRM Касса этап 2: хвосты этапа 1, смена, продажа, возврат, активация абонементов, карточка клиента | ТЗ в чате | 🟡 частично (9574ebf + следующий; проверка на проде — на стороне Сергея) |
| 16 | crm-kassa, crm-core | shift_date fix, async fitbase-import, phone format | ТЗ в чате | 🔧 в работе (Claude, 28.10.2026) |
| 17 | zamery | Фикс from/to_measure_no в studio_results | ТЗ в чате | ✅ готово (текущий) |
| 15 | infra | Документация: синхронизировать все docs/modules/*.md с кодом (пути, хэши, таблицы), добавить модуль в очередь | ТЗ в чате | ✅ готово (cd3025c + следующий коммит) |
| 18 | crm-core, reports, crm-kassa | crm-kassa RPC-фикс (продакшен), колонки, пагинация клиентов, is_trial, async sync | `docs/tasks/18-crm-reports-kassa.md` | 🟡 частично (da948c1; ч.5 «Отчёт по замерам» не сделана; ч.7 timestamps отложены) |
| 19 | crm-kassa | checkout/refund payload: явная сборка, правильные ключи RPC, ответ {sale_id,number,total} | ТЗ в чате | ✅ готово (1b45146) |
| 20 | reports, agent | syncVisits fix (RangeError time, client_id, resource, manager); TRIAL_SERVICE_NAMES; fact-day trial_sold, статусы визитов | ТЗ в чате | ✅ готово (74f4a78) |
| 21 | reports | clientLeadMap; фильтр источника+менеджера на всех 5 шагах; by_source 6 кол.; by_manager 8 кол. с дриллом | ТЗ в чате | ✅ готово (текущий) |
| 22 | scriptolog | Лояльное дерево, блок 8, KZ-тексты, RU/KZ, ↩К развилке, чтение переписки | `docs/tasks/22-scriptolog-loyal-kk.md` | ✅ готово |
| 23 | reports, agent | Синк лидов/абонементов, продажи=заказы+возвраты, кассир, продления, контроль 4 920 000 ₸ | ТЗ в чате | ✅ готово (55dc7a4, 497ab40) |
| 24 | reports, agent | clSrc/clMgr Number(); fetchAll лимит 1000; лок синка в finally; шаги синка независимы; phone fallback через fitbase_clients_cache | ТЗ в чате | ✅ готово (8995ef4) |
| 25 | reports | Факт дня: карточка «Продления», isRenew через fitbase_contracts, фильтр менеджера→clm, фильтр кассира→leads/visits, сквозная конверсия, графики recharts, 2-колонки, сворачиваемые таблицы | ТЗ в чате | ✅ готово (3711ac3) |
| 26 | reports | classifyPurchase: goods/new/same_day/renewal/returned; тест-возвраты исключены; двухрядные карточки; SalesDrillModal 3 кол.; CrossConv+Купили(всего)+Продления; таблицы: right-align/Итого/stripe; полные имена в графиках | ТЗ в чате | ✅ готово (532449e) |
| 27 | reports | classifyPurchase: фикс same_day (строгий <); «Сразу несколько» не категория — входит в new/renewal; «Вернулась» в карточке «Продления»; проценты от суммарных продаж 100% | ТЗ в чате | ✅ готово (bc6d822) |
| 28 | reports | Квал = client_fitbase_id != null; «Живые» под карточкой Квал + дрилл-модал; колонка Живые в По источникам / По менеджерам | ТЗ в чате | ✅ готово (текущий) |
| 29 | reports | Метрики по дням: экран, транспонированная таблица воронка+продажи, план месяца, редактор дня, BarChart | ТЗ в чате | ✅ готово (текущий) |
| 30 | reports, manager | Фикс схемы metrics (day/month DATE, PK-порядок, updated_by/at, on_shift NOT NULL), строки кассиров в DailyMetrics, admin-check /cash/sync-time | ТЗ в чате | ✅ готово (текущий) |

## Сделано недавно (для контекста)

- Единый вход по личным логинам (`app_users`), экран выбора, вкладки Менеджер | Агент | Квалификация | Замеры | Отчёты (admin).
- Квалификатор (kviz) перенесён в агента под `/kviz`.
- Замеры: ввод, отчёты, Excel, фигура, чекбоксы зон, график, синхронизация клиентов Fitbase (`fitbase_clients_cache`, каждые 10 мин + кнопка).
- Менеджер: ежедневные задачи, дни недели, рилсы недели, отметка на смене + Google Таблица, вкладка «Отчёты» (коммиты `6a35eee`, `bdaba34`, `6f6cacf`).
- InBody QR: сканирование (камера/файл/вставка URL), парсер `inbody.ts`, сохранение в `body_measurements.inbody`, жир-кг в «Потеряно».
- Клик по зоне фигуры: зум + панель (история, спарклайн, тренд, сегмент InBody), Esc/клик мимо закрывает, mobile bottom-sheet.
- Ссылка для клиента `/r/:token` (без входа): фигура, потеряно, график, InBody-оценка; WhatsApp, перевыпуск токена.
- Кабинет агента: клик по собаке → Гав! + звук (🔈/🔇), клик по девушке → статус агента.
- Вкладка «Метрики» (заглушка, только admin, Alt+6).
- X-отчёт закрытия смены: `cash_closings`, Excel, печать.
- Отчёт по продажам: Fitbase + Excel (admin).
- `LIFECYCLE_DRY_RUN` в конфиге агента жизненного цикла.

## Журнал

| Дата | Агент | Задача | Результат / коммит | Примечание |
|------|-------|--------|--------------------|------------|
| 26.10.2026 | Claude | 11: Скриптолог — API + страница + расширение | 948e2f0 | ⛔ нужен docs/sales-tree.md (файл с фразами скриптов) — предоставить Сергею. Схема таблиц: см. ниже. |
| 17.10.2026 | — | файл очереди создан | — | — |
| 17.10.2026 | Codex | Замеры: карточка, печать, результаты студии | 039631f, 51cd5db | Сборка и локальная проверка 1440/1024/375 прошли; push остановлен: нет GitHub auth, прод не проверен |
| 21.10.2026 | Claude | 04-0: gitignore, правила crm-reference, ТЗ 04, очередь | 84ecc3b | — |
| 21.10.2026 | Claude | 02: векторный кабинет агента — проверен по git log, уже в main | 4c67966 | — |
| 21.10.2026 | Claude | 03: LIFECYCLE_DRY_RUN добавлен в config + блок в handler | 6c7fd44 | LIFECYCLE_DRY_RUN=true в Render env |
| 21.10.2026 | Claude | 04-2: shared/personal задачи — код готов, нужен SQL | 144c938 | SQL: ALTER TABLE manager_task_done DROP CONSTRAINT manager_task_done_template_id_task_date_key; ALTER TABLE manager_task_done ADD CONSTRAINT manager_task_done_template_date_user_key UNIQUE (template_id, task_date, done_by); |
| 21.10.2026 | Claude | 04-3: X-отчёт — cash.ts, CashClosing, ManagerPage button | ниже | Внесения/изъятия ручные (Fitbase API нет); templates/zakrytie-smeny.xlsx не существовало — Excel из нуля |
| 21.10.2026 | Claude | 04-5: InBody — парсер inbody.ts + selfCheck, InBodyDialog (камера/файл/вставка), POST /inbody, fat_kg_lost в «Потеряно» | 812b79c | Если body_measurements.inbody NOT NULL или обхваты NOT NULL — сервер вернёт 409 с нужным SQL |
| 21.10.2026 | Claude | 04-7: Ссылка для клиента /r/:token — SharePage, ShareLinkDialog, token generate/refresh, rate limiter | f0b6ad5 | — |
| 21.10.2026 | Claude | 04-9: Метрики-заглушка — MetricsPage + вкладка в shell (admin, Alt+6) | 386111d | — |
| 21.10.2026 | Claude | 04-10: Аудит воронок — только анализ кода, ничего не запускалось | docs/reports/funnels-check.md | lifecycle-plan всегда DRY; budget на воронке 1 может сбрасывать бюджет |
| 21.10.2026 | Claude | 04-8: клики в кабинете агента — dog bark+bubble+sound, girl popup с данными | 33da1bd | звук выкл по умолчанию, кнопка 🔈/🔇 сохраняется в localStorage |
| 21.10.2026 | Claude | 04-6: клик по зоне фигуры — зум изображения, панель с историей/трендом/InBody-сегментом | 8539a64 | мобильный bottom-sheet; Esc/клик мимо закрывает |
| 22.10.2026 | Claude | 04-11: финал — прод index-DB1n0qCC.js совпадает с локальной сборкой; /health ok; задача 04-2 остаётся ⛔ нужен SQL | ced059b | визуальная проверка UI (1440/1024/375) — на стороне Сергея |
| 22.10.2026 | Claude | 04-2: SQL выполнен Сергеем; сервер POST /done → limit(1), сообщение «уже сделал(а) X в HH:MM»; тост на клиенте | 4a0e724 | — |
| 22.10.2026 | Claude | 05: inbody_tests — POST /inbody/qr, GET /inbody/clients/:id, CSV-парсер, импорт, InBodyBlock в карточке, InBody колонка в отчётах, SharePage обновлён | fc718a7, e0ff09e | проверка на проде с реальным CSV — на стороне Сергея |
| 22.10.2026 | Claude | 05 bugfix: CSV import 413 — express.json({limit:'2mb'}) для csv-import/preview; preview шлёт только id+date+phone; import — пачками по 50 | 2dae0f5 | — |
| 22.10.2026 | Claude | 05 bugfix2: убран client_id из inbody_tests (его нет в схеме); связь тест↔клиент только по phone_digits; csv-preview проверяет body_clients+fitbase_clients_cache; GET /counts через phone_digits | cd1730c | — |
| 22.10.2026 | Claude | 06: fitbase ops sync (fitbaseOps.ts, /run/fitbase-ops), отчёт и закрытие из Supabase, тестовый баннер, Excel по шаблону, зум зоны ×2.8-3.5 + backdrop-filter | 6a264e0, 5656a1d | Нужен SQL sync_state (см. ниже); FITBASE_OPS_SINCE в Render env; cron /run/fitbase-ops каждые 15 мин; проверка данных за 21.10.2026 — на стороне Сергея |
| 22.10.2026 | Claude | 06 bugfix: fitbase_operations колонки cashier/manager/item (были cashier_name и т. д.); серый экран карточки (inbody ответ не-массив → ErrorBlock); InBody привязка через inbody_id_links; alert() → плашки в CashClosing | af77e4b | Часть 2 (исследование Fitbase API) — ниже в журнале |
| 22.10.2026 | Claude | 06 Ч2 Fitbase API: /till-order-steps отдаёт всегда 620 записей (~7 стр по 100) без фильтра по дате — это ВСЕ операции текущей незакрытой кассовой смены (смену в Fitbase никогда не закрывали). /till-income и /till-outcome — 404. Других методов с оплатами в v2 не найдено. История операций копится в fitbase_operations с момента запуска синхронизации — это нормально. | — | Для старых данных (до запуска синхронизации) — только ручной ввод |
| 23.10.2026 | Claude | 07 ч.1-4: parseLookinBodyCSV переписан по номеру колонки (1-103); reParseRawRow; POST /inbody/recalculate; кнопка «Пересчитать InBody»; InBody full sheet; метрики с нормами и стрелками; IB-график 6 линий; попап зоны с Δ старт + % сегментов + trunk extra; blur вместо zoom | 3905f22 | «Квалификация» в воронке не реализована — нет прямой связи лидов и kviz-сессий |
| 23.10.2026 | Claude | 07 ч.5-6: fitbaseCrmSync.ts (leads+visits); /run/fitbase-crm-sync; metrics.ts (funnel API); MetricsPage (воронка, фильтры, разбивка) | 44f8e05 | Нужен cron на /run/fitbase-crm-sync каждые 15 мин (09:00-22:00 Ек); проверка данных 87767681579 на проде — на стороне Сергея |
| 23.10.2026 | Claude | 08 ч.1-6: fix sync auth; CashClosing авто-синхрон+375px; Отчёты доска для всех; OccupancySection; SalesSection фильтры; fitbaseCrmSync resource+abonement; убрать Метрики; tab persistence; /r/:token fix | 04aa468 | /health ok; новые эндпоинты → 401 без сессии (корректно) |
| 23.10.2026 | Claude | 08 ч.6.3: Настройки → Импорт InBody CSV + Пересчёт InBody + InBody без клиента; убрать вкладку «Импорт InBody» из Замеры | 199235b | Проверка UI на проде — на стороне Сергея |
| 23.10.2026 | Claude | 10 (09-финал): скрытый отчёт клиента /reports/client/:id; FactDay/DayRhythm разделы; MigrateInBody + BulkResults в Настройках; StudioSection счётчики+fullscreen+клик; InBody имена из fitbase_clients_cache; кнопка «Перейти в отчёт» в NewMeasure; убрана подпись «скоро с InBody»; fallback visit_date в Занятиях | c7cb5ae | Воронки/Занятия — данные зависят от синхронизации; проверка цифр за 22.09–22.10.2026 — на стороне Сергея |
| 23.10.2026 | Claude | 10 ч.1-4 (новые): убрана вкладка «Отчёты» из Замеры (Part 1); вес убран из формы/таблицы/печати, кг из InBody (Part 2); фигура без замеров — плашки «—» (Part 3); повторный клик по вкладке → домой (Part 4); gitignore img/png/result.md | b8435e1 | Проверка на проде — на стороне Сергея; тест Айгуль Габдуллина E70DD6 (0 замеров, 12 InBody) — плашки должны показывать «—» |
| 26.10.2026 | Claude | 11 ч.2-3: полный JSON дерева (56 узлов, 1:1 из sales-tree.md), docs/sales-tree.md закоммичен, check-tree.js (все 56 ✅), фикс кнопок Вставить/Копировать на TODO/пустых узлах, расширена детекция канала (Viber, channelLabel fallback) | d53a0e6 | Проверка расширения в Chrome — на стороне Сергея |
| 28.10.2026 | Claude | 12 CRM этап 1: новые вкладки shell (Расписание/Клиенты/Воронка/Касса/Настройки), PlaceholderPage, SettingsPage (10 разделов + Сервис из Отчётов), ClientsPage (список+форма+фото+IIN→DOB+реферер+Fitbase-импорт), API /kviz/api/crm/* (устройства, абонементы, услуги, товары, поставщики, промокоды, виды оплаты, рекламные источники, клиенты), Настройки column убрана из Отчётов | 03df169 | Проверка на проде — на стороне Сергея |
| 28.10.2026 | Claude | 13 CRM Настройки фикс: enum-ы фазы/статуса аппарата; авто-номер; атомарный план+состав (crm_plan_items); inline «+Новый поставщик»; только cash/cashless для создания вида оплаты; системные виды оплаты — только is_active; ConfirmModal+архив+удаление с проверкой использования для всех разделов; n0/nNull хелперы; VALID_* Set-ы на сервере; дружелюбные ошибки | e219a92 | Проверка на проде — на стороне Сергея |
| 28.10.2026 | Claude | 14 CRM Касса этап 2: KassaPage (ShiftClosed/ShiftOpen/SaleScreen/RefundDialog), lifecycle /run/crm-lifecycle, баланс+вкладки в ClientCard, фикс fitbase-import и profile_complete | 9574ebf | Проверка на проде + верификация имён параметров RPC — на стороне Сергея |
| 28.10.2026 | Claude | 15 Документация: все docs/modules/*.md сверены с кодом; добавлены реальные хэши, пути файлов, таблицы; модуль в очередь; Модуль-колонка в QUEUE.md | b8a3620 | Код не менялся. |
| 29.10.2026 | Claude | 17 zamery: from/to_measure_no в studio_results — calcAllResults + одиночная кнопка, null для клиентов без замеров; дружелюбные ошибки upsert; ClientPage.tsx interface fix | текущий | SQL уже выполнен Сергеем (nullable колонки). Проверка на проде — на стороне Сергея |
| 29.10.2026 | Claude | 18 crm-kassa: RPC params (p_shift, p), имена колонок (type/total/payment_method_id/purchased_at), цены с сервера, signed amount balance_ops; crm-core: пагинация клиентов {items,total}, .limit(10000), нормализация поиска; reports: is_trial+TRIAL_SERVICE_NAME, async /metrics/sync, auto-load FactDay/DayRhythm | da948c1 | Ч.5 (кнопка отчёт по замерам) и ч.7 (timestamps) отложены |
| 29.10.2026 | Claude | 19 crm-kassa: checkout payload явный (type/unit_price/start_date); refund payload явный; method_id integer; ответ {sale_id,number,total}/{refund_id,amount}; GENERIC_CRM_ERROR; «Чек #N» на done-экране | 1b45146 | Проверка на проде с «ТЕСТ Тестов» — на стороне Сергея |
| 29.10.2026 | Claude | 20 reports/agent: syncVisits — RangeError fix (time_start slice 0..5), client_fitbase_id=v.client_id, resource/manager/abonement из event, batch cache lookup; TRIAL_SERVICE_NAMES+isTrialServiceName(); VISIT_STATUS_* константы; fact-day: trial_sold_count, notCancelled(), time+resource в items; day-rhythm/funnel: notCancelled() | текущий | После деплоя: запустить синк, проверить visit_date + is_trial по SQL из ч.3 |
| 28.10.2026 | Claude | 16 crm-kassa fix: async fitbase-import (прогресс-бар, poll 2 сек, batch 100), phone 7XXXXXXXXXX, shift_date подтверждён | 62b3db3 | Нужно на проде: 1) проверить открытие смены; 2) запустить импорт; 3) SQL phone migration если есть старые +7 записи; 4) выполнить information_schema SQL (см. отчёт) |
| 29.10.2026 | Claude | 21 reports: clientLeadMap; фильтр source+manager на шагах 3,4,5 через карточку клиента; by_source 6 колонок; by_manager 8 колонок с дриллом; chipActive border fix; всегда-видимый dropdown менеджера; day-rhythm: аналогичные таблицы | текущий | Проверка на проде — на стороне Сергея. Нет SQL. |
| 29.10.2026 | Claude | 22 scriptolog: дерево (66 узлов, 2.8/3.11/блок 8), KZ-тексты (55 узлов), check-tree +5 проверок, RU/KZ переключатель, hub «↩ К развилке», чтение переписки (MutationObserver), диагностика (admin), автостарт, KZ-детект, sent detection | текущий | SQL не нужен. Селекторы сообщений EasyChat нужно проверить на живом интерфейсе. |
| 30.10.2026 | Claude | 27 reports: classifyPurchase strict < (same_day убран); renewals endpoint — prevContracts < date; FactDayCards — «Вернулась» в карточке Продления, проценты 100%; RenewalsSection — same_day убран | bc6d822 | SQL не нужен. Проверка на проде — на стороне Сергея. |
| 30.10.2026 | Claude | 28 reports: Квал=client_fitbase_id!=null (Lead.funnel добавлен); isAlive=funnel in Новые заявки/Новички/Постоянные && stage!=Отказ; alive_count+alive_items в fact-day; alive_count в by_source/by_manager; day-rhythm qualified; «Живые:N» кнопка под карточкой Квал + дрилл-модал; колонка Живые в таблицах | текущий | SQL не нужен. Проверка на проде — на стороне Сергея. |
| 30.10.2026 | Claude | 29 reports: GET /daily (воронка+продажи по дням), PUT /month-plan, PUT /day-input; DailyMetricsSection (транспонированная таблица, навигация по месяцам, buy all/new, план, редактор дня, BarChart); кнопка «Метрики по дням» в FactDaySection | текущий | Нужен SQL: см. ниже. Проверка на проде — на стороне Сергея. |
| 30.10.2026 | Claude | 30 reports/manager: фикс метрик (day/month DATE, PK branch_id+day, updated_by/at, on_shift NOT NULL всегда []); строки кассиров под «Выручка факт» (row totOverride); admin-check GET /cash/sync-time | текущий | SQL не нужен. Проверка на проде — на стороне Сергея. |
