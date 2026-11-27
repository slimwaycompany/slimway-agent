# Модуль: CRM — Лиды и воронка

Чат в claude.ai: «CRM: лиды и воронка» · Файл: `docs/modules/crm-leads.md`

## Назначение
Своя воронка лидов в CRM (таблицы `crm_*`), вкладка «Воронка» в оболочке. Путь лида: заявка → квалификация → запись на пробное (Расписание) → пришла → покупка (Касса) → клиент. Пока каркас: вся работа идёт в Fitbase, наша воронка с Fitbase не синхронизируется и ничего в Fitbase не пишет.

## Сделано

### 27.11.2026 · task 112 · автоматизация воронок — движок на данных CRM, раздел Автоматизация

**`src/core/automation/conditions.ts`** (новый):
- `CONDITION_CATALOG` — 9 типов условий: `has_active_plan`, `plan_days_left_lte`, `plan_sessions_left_lte`, `plan_ended_days`, `trial_attended_no_purchase`, `days_on_stage_gte`, `no_future_task`, `days_since_last_visit`, `days_since_created`.
- `loadAutomationSettings()` — читает `crm_settings` ключи `automation.min_plan_price` / `automation.manual_hold_hours`.
- `loadClientData()` — батч-загрузка абонементов, визитов, последнего посещения, пробного плана для массива `clientIds`.
- `loadLeadTasks()` — открытые задачи по массиву `leadIds`.
- `evalCondition()` — вычисляет одно условие по загруженным данным.

**`src/core/automation/engine.ts`** (новый):
- `runAutomation(opts)`: `dry` — превью без записи; `ruleId` — прогон одного правила; `clientIds` — fire-and-forget по конкретным клиентам (после продажи/возврата/записи/заморозки).
- Загружает правила → настройки → лиды → данные клиентов батчем → задачи → множество ручных удержаний → карту «последний лид на клиента» → имена этапов/воронок → клиентов без лида.
- Действия: `move` (сдвиг этапа + activity), `create_lead_if_missing` (только с условием на абонемент), `task` (задача с дедупом по `meta`).
- Запись в `crm_automation_log` (test/live), обновление `last_run_at` + `last_run_stats`, pruning старше 30 дней.
- `emitLive({ topic: 'leads', action: 'automation' })` вызывается синхронно (не async).

**`src/http/crmAutomation.ts`** (новый):
- Роуты `/kviz/api/crm/automation/*` (требуют `settings.automation`): настройки GET/PUT, правила CRUD + reorder + preview, run, log.
- Валидация: целевой этап принадлежит целевой воронке; типы условий из каталога; параметры целые ≥ 0; from ≤ to.

**`src/http/kviz.ts`**: подключён `buildCrmAutomationRouter()`.

**`src/index.ts`**: cron-эндпоинт `/run/crm-automation` (GET + POST) — `acquireLock(10 мин)`, `runAutomation()` в фоне с `releaseLock` в `finally`.

**`src/http/crm.ts`**: 5 fire-and-forget триггеров `runAutomation({ clientIds: [...] })`:
- после `crm_checkout` (client_id из payload),
- после `crm_refund` (client_id по sale_id из `crm_sales`),
- после заморозки и разморозки абонемента (client_id из `crm_client_plans`),
- после смены статуса брони на `attended`/`no_show` (client_id из `crm_bookings`).

**`src/core/permissions.ts`**: добавлено право `settings.automation` (Автоматизация воронок), в пресет `company_manager`.

**`kviz/client/src/pages/crm/settings/AutomationSettings.tsx`** (новый, ~500 строк):
- `RuleCard` + DnD-переупорядочение (dnd-kit), `ModeBadge` (3-сегментный toggle off/test/live), `RuleEditor` (боковая панель десктоп, bottom-sheet ≤640), `LogModal`.
- `LeadRulesBlock` внизу — два правила `crm_lead_rules` вместо сырого JSON.
- Переход в режим `live` → превью-счётчик заявок + `showConfirm`.

**`kviz/client/src/pages/crm/SettingsPage.tsx`**: группа «Автоматизация» с разделом «Правила воронок» (Cpu, `settings.automation`); старая метка «Задачи по заявкам» (CheckSquare, `settings.funnels`).

**`scripts/check-mobile.js`**: добавлена секция `'automation'` в список настроек для мобильной проверки.

### 27.11.2026 · task 111.1 · разовый перенос заявок Fitbase по этапам

**`src/jobs/fitbaseLeadsImport.ts`** (новый):
- `previewFitbaseLeadsImport()` — загружает `/purchase-funnel`, `/purchase-funnel-step`, `/lead` параллельно; группирует лиды по Fitbase-этапу; автоматически сопоставляет с нашими этапами по имени (нормальные) или `kind` (системные); кэш 15 мин.
- `runFitbaseLeadsImportBg(mapping)` — запускает импорт в фоне; `upsert` с `ignoreDuplicates:true` (повторный запуск безопасен); activity-запись `kind='system'` только для реально вставленных; запись в `crm_audit_log`; пауза 300–500 мс между батчами 100.
- `importRunStatus` — глобальный статус (idle/running/done/error) для поллинга.

**`src/jobs/crmLeadsSync.ts`**: экспортированы `BRANCH_ID`, `SKIP_FUNNEL_FB_IDS`, `toISO`, `FbLeadMaps` (интерфейс), `buildFbLeadRow()` (общий конструктор строки лида из Fitbase-данных). Вызывается и из `syncLeads()`, и из импорта.

**`src/http/crmLeads.ts`**: добавлены 3 admin-only роута:
- `POST /kviz/api/crm/fitbase-leads-import/preview` — превью-таблица с автосопоставлением.
- `POST /kviz/api/crm/fitbase-leads-import/run` — запуск импорта (409 если уже идёт).
- `GET /kviz/api/crm/fitbase-leads-import/status` — опрос статуса.

**`kviz/client/src/pages/crm/FunnelsSettings.tsx`**: компонент `FbImportModal` (фазы loading/mapping/running/done/error); таблица сопоставления на десктопе, карточки на мобиле ≤640; жёлтая подсветка несопоставленных строк; поллинг статуса каждые 2 с; пункт «Перенести заявки из Fitbase» в меню ⋯ каждой воронки.

### 27.11.2026 · task 111 · настройки воронок, realtime SSE, карточка клиента

**`src/http/crmLeads.ts`**:
- `GET /funnels`: параллельный запрос лидов для подсчёта `leads_count` per stage; `hidden_system_kinds` из `crm_funnels.*`.
- `PATCH /funnels/reorder`, `PATCH /funnel-stages/reorder` — обновление `sort` последовательно по массиву.
- `PATCH /funnels/:id` — поддержка `hidden_system_kinds` (валидация: подмножество `['inbox','success','fail']`).
- `DELETE /funnel-stages/:id` — 409 для системных этапов (kind≠'normal'); поддержка `move_to` для миграции лидов.
- `DELETE /funnels/:id` — 409 если есть лиды без `move_funnel_id`; перенос лидов в inbox целевой воронки, удаление этапов потом воронки.
- `POST /leads/bulk-move` — смена этапа+воронки для массива lead_ids (пачками по 100).
- `PATCH /settings/sync` с `enabled:true` → 409 (синхронизация Fitbase отключена).

**`kviz/client/src/pages/crm/FunnelsSettings.tsx`** (новый, ~400 строк):
- Две панели: список воронок (левая) ↔ этапы выбранной (правая). Мобиль ≤640: последовательно с кнопкой «← Назад».
- Drag-and-drop порядка воронок и этапов через `@dnd-kit/core` (useDraggable + useDroppable, без sortable-пакета).
- Inline-переименование по двойному клику; ⋯ меню (переименовать, активировать/деактивировать, удалить).
- Пикер цвета этапа (20 пресетов, кнопка «×» без цвета).
- Архивирование/показ обычных этапов; скрытие системных (inbox/success/fail) per-funnel через `hidden_system_kinds`.
- Диалог миграции: при удалении этапа/воронки с лидами — выбор целевого этапа/воронки.
- «Скрытые (N)» — сворачиваемый `<details>` внизу списка этапов.
- `useLive(['funnels'], load)` для авто-обновления.

**`kviz/client/src/pages/crm/SettingsPage.tsx`**: `FunnelsSection` заменена на `<FunnelsSettings />`.

**`kviz/client/src/pages/crm/FunnelPage.tsx`**: убраны `syncEnabled`, `handleSync`, кнопка «Синхр. FB»; интервал auto-refresh 60s → 5 мин; `useLive(['leads','funnels','lead_tasks'], ...)`.

### 26.11.2026 · task 108В · фильтры, дебаунс поиск, сумма бюджета, режим Список, мобильная доска, дубли, Не удобно говорить, ноты Fitbase

**`src/http/crmLeads.ts`**:
- `GET /crm/leads`: новые серверные фильтры `manager_user_id`, `ad_source_id`, `tag` (`.contains`), `created_from`/`created_to` (gte/lte по `fb_created_at`).
- `GET /crm/leads/check-phone?phone=`: возвращает открытые заявки и клиентов CRM с этим телефоном для предупреждения о дублях.
- `POST /crm/leads/:id/move`: если ответ `inbox_contact_result = 'not_convenient'` и этап inbox → автоперенос в «Отложенное решение» + задача «Перезвонить» на завтра 10:00 UTC+5.

**`src/core/leadStageContent.ts`**: `inbox_contact_result` → `type: "question"` с 6 вариантами (Ответил / Нет ответа / Занят / Сбросил / Просит перезвонить / **Не удобно говорить** `{id:"not_convenient"}`). Тип `options` расширен до `Array<string | {id,label}>`.

**`src/jobs/crmLeadsSync.ts`**: `syncNotes()` — батч 50 заявок за раз (ротация через `sync_state.crm_notes_offset`), Fitbase `/note?client_id=X`, дедуп по `fitbase_note_id`, вставка в `crm_lead_activity` с `kind='comment'` и `meta.source='fitbase'`. Пауза 300–500 мс. Вызывается в `runCrmLeadsSync()`.

**`kviz/client/src/pages/crm/FunnelPage.tsx`** переписан:
- Фильтр-панель: менеджер, источник, тег, пресет даты (сегодня/вчера/7д/30д/свой период). Сохраняются в localStorage. Счётчик активных фильтров. Кнопка «Сбросить».
- Поиск: дебаунс 300 мс, от 2 символов, `AbortController` отменяет предыдущий запрос.
- Шапка колонки: кол-во и сумма бюджета «12 · 840 000 ₸».
- Переключатель «⊞ Доска / ☰ Список», сохраняется в localStorage, по умолчанию «Список» на мобиле ≤640.
- Режим «Список»: таблица с сортировкой; на мобиле — карточки.
- Мобильная доска (≤640): scroll-snap по колонкам, полоса навигации по этапам, кнопка «Этап ▾» в карточке → bottom sheet выбора этапа → StagePopup подтверждения.
- CreateLeadModal: проверка телефона на 11 цифр → `GET /check-phone` → жёлтое предупреждение со ссылками на найденные заявки/клиентов.

**`kviz/client/src/pages/crm/LeadDrawer.tsx`**:
- iOS fix: `height: 100dvh` вместо `bottom: 0` у drawer-контейнера — фиксирует прыжок при открытии клавиатуры.
- Вкладка «Произвольные поля»: показывает `custom_fields[]` из Fitbase в виде таблицы name→value. Пустые данные — подсказка с SQL.

**Часть 15 — нужен SQL** (если хотим редактируемые поля): `CREATE TABLE crm_custom_field_defs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid REFERENCES crm_branches(id), name text NOT NULL, field_type text CHECK (field_type IN ('text','number','date','list')), list_options jsonb DEFAULT '[]', sort int DEFAULT 0, is_active bool DEFAULT true, funnel_id uuid REFERENCES crm_funnels(id))` + `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS custom_fields_v2 jsonb DEFAULT '{}'`.

### 21.11.2026 · task 81 · единый формат вариантов (объект id/label), none_option и not_none, сохранение чек-листа без потерь

**Причина:** React #31 — objects are not valid as React child: `bant_contra.options` в БД хранился как `{id,label}[]` (после редактирования в UI), StagePopup рендерил `{opt}` как строку → краш.

**`kviz/client/src/pages/crm/StagePopup.tsx`**:
- `StageItem.options` — `Array<string | {id: string; label: string}>`.
- `StageItem.none_option` — `string | null` (ID исключающего варианта).
- `normOpt(o)` — нормализует строку или объект в `{id, label}`.
- `noneOptId(val)` — нормализует `boolean true` (легаси) → `'__none__'`; строку → строку.
- `toggleMulti(key, optId, noneId)` — исключающая логика через noneId.
- `isVisible()` / `not_none` — исключает none_option ID из подсчёта реальных выборов.
- Number input: красный бордер + сообщение при выходе за min/max; блокирует «Подтвердить».
- `allow_other` — чекбокс «Другое» с текстовым полем.

**`src/core/checklistRules.ts`** (новый): `evalShowIf(cond, answerByKey, multiByKey, noneByKey)` — общая логика show_if на сервере; `not_none` правильно исключает none_option ID.

**`src/core/leadStageContent.ts`**: `none_option` тип `string | null`; `bant_contra.none_option` → `'no_contra'`; `'no_contra'` добавлен в options (первым).

**`src/http/crmLeads.ts`**:
- Импорт `evalShowIf` из `checklistRules.ts`; POST /move строит `noneByKey` и передаёт в `evalShowIf`.
- PATCH `/crm/funnel-stages/:id` checklist: теперь сохраняет `show_if`, `none_option`, `min`, `max`, `allow_other`, `options` для `multi`-типа; лимит 25 пунктов; проверка уникальности `key`; `none_option` должен быть в `options`.

**`src/http/window.ts`**: sw.js — убран fetch-обработчик (только push), убраны console-ошибки при перехвате запросов.

**`src/http/shell.ts`**: убран `notifications` из `allow` агент-iframe (лишнее разрешение).

**`docs/modules/control.md`**: решение от 19.11 о вкладке B.A.N.T. с `crm_bant` помечено «отменено 21.11».

**После деплоя:** запустить `POST /kviz/api/crm/funnels/:id/reset-content` (admin) — обновит `bant_contra.none_option` и options в БД до нового формата.

### 21.11.2026 · task 80 · логика квалификации в этапах, предупреждения, подсказки, скрыта вкладка Квалификация

**`src/core/featureFlags.ts`** (новый): `KVIZ_TAB_VISIBLE = false` — управляет видимостью вкладки.

**`src/http/shell.ts`**: вкладка Квалификация скрыта через флаг; плейсхолдеры и навигационные ссылки пересчитаны (Касса→Замеры напрямую).

**`src/core/permissions.ts`**: блок kviz условно исключён из PERM_CATALOG при `KVIZ_TAB_VISIBLE=false`.

**`public/shell-app.js`**: null-guard для всех элементов kviz; обработчики навигации адаптированы к динамическому набору кнопок.

**`src/core/priceCatalog.ts`** (новый): `PRICE_PACKS`, `selectPackage()`, `fmtPrice()` — прайс-каталог на сервере.

**`src/core/qualifyCatalog.ts`** (новый): `CONTRAINDICATIONS`, `GOALS`, `AGE_GROUPS`, `TRAVEL_TIMES`, `HINTS[]`, `computeResult(QualifyAnswers)`, `answerRowsToAnswers(AnswerRow[])` — вся логика квалификации на сервере.

**`src/core/leadStageContent.ts`**: новые типы `multi/number/date`; `ShowIf` interface с операторами `eq/neq/contains/not_none/in/gte/lte`; новые поля `none_option/allow_other/min/max/show_if`; этап B.A.N.T. получил 15 пунктов с маппингом на QualifyAnswers; «Пришел» — `arr_height/arr_weight`.

**`src/http/crmLeads.ts`** расширен:
- `GET /crm/hints?stage=<key>` — фильтрует HINTS по ключу этапа.
- `GET /crm/leads` — батч-вычисляет `qualify_temperature` для каждой заявки (1 доп. запрос на пачку).
- `GET /crm/leads/:id` — возвращает `qualify: {score,temperature,warnings,flags}`.
- `POST /crm/leads/:id/move` — валидирует только видимые required пункты (show_if), проверяет стоп-противопоказания (`contra_stop` 400 → `bant_contra_warned`), проверяет диапазоны number-пунктов.
- Допустимые типы чеклиста расширены: `multi/number/date`.

**`kviz/client/src/pages/crm/StagePopup.tsx`** переписан:
- `StageItem` — новые типы multi/number/date; `ShowIf`, `allow_other`, `none_option`, `min/max`.
- Рендер: multi — чекбоксы с взаимоисключающей «Нет»; number — input[type=number] с min/max; date — input[type=date].
- show_if: оценивается по текущим ответам — скрытые пункты не валидируются.
- OPT_LABEL: ID → русская метка для qualify-mapped опций.
- Warnings block: цветные бейджи ⛔/⏸/ℹ️ сверху над пунктами (из qualify.warnings).
- Hints accordion: `GET /crm/hints?stage=<key>` → аккордеон в правой колонке (макс. 2 блока, цвет по tone).
- Self-fetch qualify: если prop не передан, сам загружает `/crm/leads/:id`.
- Лог ответов: ID-опции маппятся в читаемые метки через OPT_LABEL.

**`kviz/client/src/pages/crm/FunnelPage.tsx`**:
- Интерфейс `StageItem` обновлён (новые типы + show_if).
- `Lead.qualify_temperature` добавлен.
- `LeadCard`: температурный бейдж 🔥/🌤/❄️/⛔/⏸ из `qualify_temperature`.

**После задачи нужно:** запустить `POST /kviz/api/crm/funnels/:id/reset-content` (admin) для обновления checklist в БД — чтобы серверная show_if-валидация и новые типы пунктов работали корректно.

### 21.11.2026 · task 79 · контент этапов из таблицы, checklist v2, StagePopup v2, настройки этапов v2

**`src/core/leadStageContent.ts`** (новый, сгенерирован `gen_stage_content.py`):  
`STAGE_CONTENT[12]` — 12 этапов (inbox/funnel×9/fail/success), каждый с `name`, `scope`, `require_comment`, `helper{manager,transition,important,agent}` из xlsx, `items[]` — чеклист пунктов новой структуры `{key,block,type,label,required,who,options?,rule?}`.

**`src/http/crmLeads.ts`** расширен:  
- `PATCH /crm/funnel-stages/:id`: принимает `helper` (объект 4 ключа, до 4000 символов каждый), `require_comment` (boolean), `checklist` в новом формате `{key,block,type,label,hint,required,options,who,rule}`.
- `POST /crm/funnels/:id/reset-content` (admin): сопоставляет этапы по kind (inbox/fail/success) или имени, обновляет helper/require_comment/checklist из STAGE_CONTENT.
- `POST /crm/leads/:id/move`: валидирует required-пункты (возврат `{error:'required_missing',missing:[...]}` 400), require_comment (400), пишет ответы в `crm_lead_answers` с `move_activity_id`.
- `GET /crm/leads/:id/answers` и `POST /crm/leads/:id/answers` — журнал ответов.
- `GET /crm/leads/:id/activity`: мержит ответы из `crm_lead_answers` как `kind='answer'` по move_activity_id.

**`StagePopup.tsx`** переписан (3 колонки ≥1025px: пункты | подсказки | лог; на мобиле — вкладки):  
- Поддерживает типы `question` (радиокнопки+текст), `check` (чекбокс), `text`/`comment` (textarea); блоки по `item.block`; валидация required; список пропущенных ниже кнопки.  
- Загружает лог ответов `GET /answers`, фильтр по этапу.

**`FunnelPage.tsx`**: интерфейс Stage/StageItem расширен новыми полями; `confirmMove` передаёт `answers[]`; сортировка inbox → funnel → success → fail; `leadId` передаётся в StagePopup.

**`SettingsPage.tsx`**: `StageEditor` — 4 textarea подсказок (manager/transition/important/agent), `require_comment`, редактор пунктов с type/block/hint/required/options/rule; кнопка «Вернуть к таблице» per-stage; кнопка «Загрузить из таблицы» per-funnel; `funnelId` передаётся в StageEditor.

**`LeadDrawer.tsx`**: интерфейс Stage обновлён — поля helper/require_comment/checklist нового формата (обратная совместимость через опциональные ключи).

**Таблицы:** SQL выполнен до задачи — колонки `helper jsonb`, `require_comment boolean` в `crm_funnel_stages`; таблица `crm_lead_answers`.

### 20.11.2026 · fix · исправление сборки — экспорт isFitbaseSyncEnabled

- `src/jobs/crmLeadsSync.ts`: функция `isFitbaseSyncEnabled()` была в рабочем дереве, но не попала в коммит 150e224 (stash/pop без git add). Добавлена в коммит и теперь деплоится правильно.

### 20.11.2026 · task 78 · popup подтверждения перехода, ручное создание заявки, автоматика, настройки этапов

**Бэкенд `src/http/crmLeads.ts`:**
- `POST /crm/leads` переписан для ручного создания: находит активную воронку «Новые заявки» (`is_active=true`, name ilike), системный inbox-этап (`kind='inbox'`, `funnel_id IS NULL`), проверяет дубль по phone (409 `{error:'duplicate',lead_id}`), `force:true` обходит проверку; `origin='manual'`, `title=name+surname`, `budget='0'`, `tags=[]`; после создания запускает `runLeadRules({type:'lead_created'})` fire-and-forget.
- `PATCH /crm/funnel-stages/:id`: добавлены поля `memo` (≤1000), `action_label` (1–30), `checklist` (массив ≤20 пунктов, каждый `{text,who,rule?}`).
- `POST /crm/leads/:id/move`: принимает `comment` (пишет в activity), вызывает `runLeadRules({type:'stage_enter',...})` fire-and-forget.
- `GET /kviz/api/crm/lead-rules` (admin): возвращает правила из `crm_lead_rules`.
- `PATCH /kviz/api/crm/lead-rules/:id` (admin): обновляет `is_enabled` и `params`.
- `PATCH /kviz/api/crm/settings/sync` (admin): переключает флаг `leads.fitbase_sync_enabled` в `crm_settings`.

**Новый файл `src/core/leadRules.ts`:** `runLeadRules(event)` — загружает включённые правила, вызывает `applyRule` для каждого; правила `lead_first_contact` (на `lead_created`, создаёт задачу+activity) и `stage_task` (на `stage_enter`, создаёт задачу+activity); дублирование защищено через `crm_lead_activity.meta.rule_code`; все задачи `[АВТО]` с `created_by=null`.

**Новый компонент `kviz/client/src/pages/crm/StagePopup.tsx`:** попап подтверждения перехода (`mode='move'`) и просмотра памятки (`mode='memo'`); показывает memo, checklist «Делаете вы», admin-collapsible «Автоматика», comment, lost_reason (обязательно при kind=fail), кнопка action_label; bottom sheet на ≤640px.

**`FunnelPage.tsx` обновлён:** интерфейс Stage/Funnel с новыми полями; загружает `syncEnabled`/`lostReasons` при монтировании; фильтрует только `is_active` воронки; drag end открывает StagePopup вместо PATCH; `confirmMove()` → POST /move с comment+lost_reason_id; кнопка «+ Заявка» → CreateLeadModal (дублирование со ссылкой); auto-refresh каждые 60с (пауза при попапе/дрэге); колонки с `alignItems:'stretch'` и собственным вертикальным скроллом; кнопка «Синхр. FB» скрыта если `!syncEnabled`.

**`LeadDrawer.tsx` обновлён:** интерфейс Stage с `memo/action_label/checklist`; после загрузки лида проверяет memo текущего этапа и показывает StagePopup `mode='memo'` один раз.

**`SettingsPage.tsx` обновлён:** `Section` + `'lead-rules'`; `CrmStage` с `memo/action_label/checklist`; `StageEditor` — inline-редактор memo/action_label/checklist внутри FunnelsSection; `FunnelsSection` добавлен sync-переключатель сверху; `LeadRulesSection` — список правил из `crm_lead_rules` с галочками и редактором params; раздел «Автоматизация» в группе «Заявки».

### 18.11.2026 · 8f16595 · task 67 · syncLeads() создаёт body_clients для заявок с телефоном

- **crmLeadsSync.ts** `syncLeads()`: после upsert всех заявок собирает телефоны (normPhone → `7XXXXXXXXXX`), фильтрует по `body_clients.phone_digits` (SELECT IN), вставляет только новых в батчах по 100 (`{name: «Имя Фамилия», phone: «+7XXXXXXXXXX»}`); всё в try/catch — ошибка не прерывает синк; логирует `[crm-leads-sync] body_clients: добавлено N`.
- Не затрагивает: `fitbase_clients_cache`, кнопку «Перенести клиентов InBody», существующих клиентов в `body_clients`.

### 05.11.2026 · task 38 — fix sync (budget/title not-null, user_id map, stage kind), resilient batches, missing sync steps, board/drawer/settings/manager gaps

- **crmLeadsSync.ts полностью переписан:** `toNum()` → budget NOT NULL (null→0); title NOT NULL (null→''); stage_id NOT NULL (нет этапа/не найден → skip + счётчик skipped); `user_id` вместо `app_user_id` в `crm_fitbase_user_map`; этапы — UPDATE existing (только имя/воронку/цвет/сорт, не трогает kind и is_personal) + INSERT новых; skip funnel 5/6/7; пачки по 100, try/catch, retry per-row, лог до 20 примеров ошибок; каждый шаг независим; итог: `{ leads: { total, upserted, skipped, failed }, tasks: { total, upserted, failed } }`.
- **Новые шаги синхронизации:** `syncDicts()` раз в сутки (`sync_state.crm_leads_dicts_at`) — /user → upsert crm_fitbase_user_map (только fitbase_full_name, user_id не трогает), /advertising-source → crm_ad_sources.fitbase_id по имени; `stage_changed_at` = now() при смене этапа + activity stage_change, при первом импорте → fb_updated_at; deleted leads → is_archived=true + activity system «Заявка удалена в Fitbase»; `syncClientStatuses()` раз в сутки → crm_clients.fitbase_status.
- **crmLeads.ts:** лок 5→10 мин; `user_id` во всех fitbase-user-map эндпоинтах (GET/POST/PATCH); `GET /crm/leads/sync/status` + `POST /crm/leads/sync` (409 если уже идёт) как каноничные пути; `POST /crm/leads/:id/move` (без lost_reason_id при fail → 400); `GET /crm/leads/:id/notes` → Fitbase `/note?client_id=X`; `POST /crm/fitbase-user-map/recalculate` → пересчитать manager_user_id в leads и responsible_user_id в tasks; фильтр `responsible_user_id` в GET /lead-tasks.
- **LeadDrawer.tsx:** `body→text` fix (Activity.text, отправка {text:...}, чтение a.text/a.author); подгрузка Fitbase-комментариев при открытии (`GET .../notes`); кнопки «Продать» (→ open-cashier) и «Записать на пробное» (→ open-schedule) через postToParent; тост «только в нашей CRM» для Fitbase-заявок (вместо alert).
- **SettingsPage.tsx:** FbUsersSection: `app_user_id→user_id` в интерфейсе, в POST/PATCH, в value select.
- **ManagerPage.tsx:** LeadTasksSection — группы Просрочено/Сегодня/Дальше; admin-фильтр пользователей; клик по заявке → LeadDrawer; импорт Funnel/LeadDrawer.
- **shell-app.js:** обработчики `open-cashier` → showTab('kassa'), `open-schedule` → showTab('schedule').

### 05.11.2026 · текущий · task 37 — синхронизация, kanban-доска, карточка заявки, Настройки, задачи в Менеджере

- **Джоб синхронизации** `src/jobs/crmLeadsSync.ts`: `runCrmLeadsSync()` → syncFunnels → syncLeads → syncTasks; upsert по `fitbase_id`; системные этапы (0,−1,−2) сохраняют `funnel_id` из предыдущей синхронизации; поля `is_archived/lost_reason_id/lost_comment` синхронизацией не затрагиваются.
- **API** `src/http/crmLeads.ts` (`buildCrmLeadsRouter()`): 30+ эндпоинтов — sync (GET/POST leads-sync), funnels (GET+POST+PATCH), funnel-stages (POST+PATCH+DELETE), leads (GET+POST+GET/:id+PATCH+DELETE), activity (GET+POST), lead-tasks (GET+POST+PATCH+DELETE), lead-tags (CRUD), task-types (CRUD), lost-reasons (CRUD), fitbase-users, fitbase-user-map (GET+POST+PATCH+DELETE), app-users. Смонтирован в `src/http/kviz.ts`.
- **Cron-эндпоинт** `/run/crm-leads-sync` (GET+POST, CRON_SECRET, лок 5 мин, 202 Accepted) — `src/index.ts`.
- **Kanban-доска** `kviz/client/src/pages/crm/FunnelPage.tsx`: выбор воронки, поиск, Показать архивные, кнопка «Синхр. FB»; @dnd-kit/core drag & drop (PointerSensor+TouchSensor); карточки с бюджетом/датой/менеджером/тегами/is_overdue (розовый фон); PATCH stage_id на drop; горизонтальный скролл колонок на мобиле. Маршрут `/crm/funnel`.
- **Карточка заявки** `kviz/client/src/pages/crm/LeadDrawer.tsx`: фиксированная панель справа 480px (100vw на мобиле); вкладки Основное / Произвольные поля (заглушка); все поля лида (title/name/surname/phone/email/instagram/telegram/description/budget/funnel/stage/source/manager/UTM); список задач + форма создания + отметка выполнена/удалить; лента активности + форма комментария; кнопки Сохранить / В архив / (admin) Удалить.
- **Настройки** `SettingsPage.tsx`: 5 новых секций — Воронки CRM (создать воронку + управление этапами), Теги заявок, Типы задач, Причины отказа, Сопоставление FB (fitbase_manager_name → app_user_id).
- **ManagerPage** `kviz/client/src/pages/manager/ManagerPage.tsx`: секция «Задачи по заявкам» — показывает открытые today+overdue задачи из `crm_lead_tasks`, кнопка «Готово» — PATCH status=done.
- **@dnd-kit/core** установлен в `kviz/client/node_modules` через hoisting.

### 05.11.2026 · 2076c1f · task 36 — зонд Fitbase leads API
- Зонд `src/jobs/probeLeadsApi.ts`, эндпоинт `GET /run/probe-leads-api`. Отчёт: `docs/reports/fitbase-leads-api.md`.
- Результат: 936 лидов, 7 воронок, 62 этапа, 1252 задачи. Фильтры по воронке/архиву/дате не работают — только полный sync.

## Где код
- **Джоб синхронизации:** `src/jobs/crmLeadsSync.ts` → `runCrmLeadsSync()`
- **API воронок и лидов:** `src/http/crmLeads.ts` → `buildCrmLeadsRouter()`, смонтирован в `kviz.ts` после `buildCrmRouter()`
- **Cron-эндпоинт:** `src/index.ts` → `handleCrmLeadsSync`, `/run/crm-leads-sync`
- **Kanban-доска:** `kviz/client/src/pages/crm/FunnelPage.tsx`, маршрут `/crm/funnel`
- **Попап этапа:** `kviz/client/src/pages/crm/StagePopup.tsx` (mode=move и mode=memo)
- **Карточка заявки:** `kviz/client/src/pages/crm/LeadDrawer.tsx`
- **Правила автоматики:** `src/core/leadRules.ts`, `runLeadRules(event)`
- **Настройки CRM-разделов:** `kviz/client/src/pages/crm/SettingsPage.tsx` (секции funnels/lead-rules/lead-tags/task-types/lost-reasons/fb-users)
- **Задачи в Менеджере:** `kviz/client/src/pages/manager/ManagerPage.tsx` → `LeadTasksSection`
- Зонд API Fitbase — `src/jobs/probeLeadsApi.ts`, эндпоинт `GET /run/probe-leads-api` (`2076c1f`). Только rawGet. Отчёт: `docs/reports/fitbase-leads-api.md`.
- Не путать: `kviz/client/src/pages/MetricsPage.tsx` + `src/http/metrics.ts` — отчёты по воронке Fitbase (Отчёты → Маркетинг: Факт дня, Дневной такт), модуль `reports.md`.

## Таблицы
SQL **выполнен** 05.11.2026 (проверка: 4 воронки, 44 этапа, 3 тега, 15 правил; по отчёту `docs/reports/fitbase-leads-api.md`). Все с `branch_id`, RLS без политик.
- `crm_funnels` — воронки: name, sort, is_active, fitbase_id (1 Новые заявки, 2 Новички, 3 Постоянные клиенты, 4 Реактивация; тестовые 5–7 не переносим).
- `crm_funnel_stages` — этапы: funnel_id (null = системный общий этап), name, kind `normal / inbox / success / fail`, is_personal (Ангелина, Вера, Назерке), is_archived (старые «Архив: …»), color / background_color / text_color, sort, fitbase_id. Системные: 0 Неразобранные (inbox), −1 Успешно реализована (success), −2 Отказ (fail).
- `crm_leads` — заявки: title, name/surname/patronymic, phone (цифры 7XXXXXXXXXX), email, instagram, telegram, description, budget, funnel_id, stage_id, stage_changed_at, ad_source_id, manager_user_id, fitbase_manager_id/name, client_id, fitbase_client_id, utm_campaign/source/medium/term/content, tags jsonb (массив строк), custom_fields jsonb, is_duplicate, is_archived/archived_at, lost_reason_id/lost_comment, origin `fitbase / manual`, fitbase_id, fitbase_stage_id, fb_created_at/fb_updated_at, synced_at, raw.
- `crm_lead_tags` — справочник тегов (name, color, is_system, is_active, sort); системные `tiktok`, `manual_import`, `no_phone` — удалять нельзя.
- `crm_task_types` — типы задач (Звонок fitbase 2, Задание fitbase 5).
- `crm_lead_tasks` — задачи: lead_id, client_id, type_id, description, result, due_at, is_allday, status `open / done`, is_overdue (из Fitbase), closed_at, closed_by, created_by, responsible_user_id, fitbase_responsible jsonb, fitbase_id, raw.
- `crm_lead_activity` — лента карточки: kind `created / comment / stage_change / field_change / task / system`, text, meta jsonb, author, fitbase_note_id.
- `crm_lead_lost_reasons` — причины отказа (справочник в Настройках).
- `crm_fitbase_user_map` — сопоставление пользователей Fitbase (/user) с `app_users`.
- `crm_lead_rules` — правила логики воронок с галочкой is_enabled (все выключены до переезда), params jsonb.
- Доп. колонки: `crm_ad_sources.fitbase_id`, `crm_clients.fitbase_status` (код статуса клиента Fitbase).

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Своя воронка — каркас, с Fitbase только чтение (импорт), ничего не пишем (04.11.2026, CLAUDE.md).

### Цель и общие решения (05.11.2026)
- Цель — **полный перенос всех воронок Fitbase вместе с логикой** (правила агента, переходы между воронками) в нашу CRM.
- Доска как в Fitbase: колонки-этапы, **drag & drop** карточек между этапами, тот же визуал (цвет полосы этапа, счётчик и сумма в шапке).
- Воронки и этапы **добавляет и удаляет админ в Настройках**. Все текущие воронки и этапы Fitbase переносим как стартовые.
- **Карточки (заявки) переносим из Fitbase**, по возможности с постоянной синхронизацией.

### Синхронизация с Fitbase и уточнения (05.11.2026)
- Синхронизация **только Fitbase → наша CRM**, в Fitbase ничего не пишем. Наша доска — зеркало, пока менеджеры работают в Fitbase.
- **Автосинхронизация раз в 5 минут** + **кнопка «Синхронизировать с FB»** (ручной запуск сразу).
- Правки в нашей доске разрешены для теста, но в Fitbase не уходят.
- Переносим **все** карточки всех 4 воронок, включая «Отказ» и архив, вся история.
- Мессенджеры, рассылки, СМС, звонки в ленте — **другой чат/модуль**, здесь не делаем.
- Поля карточки — ровно те, что на скриншоте (до UTM-Контент включительно), больше нет. Вкладка «Произвольные поля» — пока заглушка.
- **Теги** — ручной список в Настройках. Теги `tiktok`, `manual_import`, `no_phone` — системные, обязательны (на них завязана синхронизация TikTok), удалять нельзя.
- **Клиент:** если клиента нет в нашей базе — заявка переносится без клиента (клиента автоматически не создаём).
- **Менеджеры:** все пользователи создаются в Настройках; менеджера Fitbase (ФИО) сопоставляем с нашим пользователем вручную.
- Этапы «Ангелина», «Вера», «Назерке» — **личные этапы менеджеров**, карточки туда переносят вручную (агент их не трогает).
- **Розовый фон карточки** — у задачи подошёл срок или она просрочена.
- **Бюджет** — по правилу агента: 69 000 ₸ в «Новых заявках» и «Реактивации», LTV клиента в «Новичках» и «Постоянных».

### Логика, задачи, отказ, дубли (05.11.2026)
- **Вариант А:** Fitbase главный, автосинхронизация перезаписывает правки в нашей доске. После переезда синхронизацию просто выключаем.
- Правила агента (пришла → «Принимает решение», не пришла → «Не пришёл», покупка ≥ 40 000 → «Успех», переходы Новички / Постоянные / Реактивация) переносим как правила нашей CRM, но **включаем только после переезда**; до этого доска — зеркало Fitbase.
- Автозадачи (агента и Fitbase) — тоже правила, **с галочками вкл/выкл в Настройках**.
- **Типы задач** — список в Настройках (сейчас в Fitbase: «Звонок», «Задание»).
- Задачи видны **и в карточке заявки, и во вкладке «Менеджер»** (там общие задачи).
- **Отказ:** при переносе в «Отказ» — обязательная причина из списка в Настройках.
- **Архив:** не этап, а кнопка «В архив» на карточке; фильтр «Показать архивные».
- **Распределение** новых заявок между менеджерами — пока вручную.
- **Дубли:** при создании заявки с телефоном, который уже есть в открытой заявке, — предупреждение «уже есть заявка» со ссылкой на неё.
- **Цветная точка у клиента** на карточке — статус клиента: Закрыт / Открыт / Новый / Потенциальный (цвета — как в Fitbase, уточнить соответствие).

### Статус клиента, закрепление, кнопки (05.11.2026)
- **Статус клиента** (Закрыт / Открыт / Новый / Потенциальный) тянем из Fitbase при синхронизации и храним у клиента; цвет точки на карточке — как в Fitbase (соответствие цветов определить по данным).
- **Закрепление карточки** за менеджером делаем сразу, подсветкой на доске: карточка «своя», пока есть задача не дальше 7 дней и полный комментарий; дата прошла и сутки без комментария — карточка свободна.
- В карточке заявки — кнопки **«Записать на пробное»** (→ Расписание) и **«Продать»** (→ Касса с выбранным клиентом), **пока тестово**: в Fitbase ничего не пишут.
- В шапке доски **нет** «Выгрузить в Excel» и «Аналитики»: все выгрузки и аналитика — в «Отчётах», не дублируем.
- Порядок работ: сначала проверка API Fitbase (воронки, этапы, теги, задачи, комментарии, статусы клиента — только чтение, отчёт со структурой), по отчёту — SQL таблиц, потом основное ТЗ.

### По итогам зонда API (05.11.2026)
- Синхронизация — **полная** раз в 5 минут (инкрементальной в API нет): все заявки и задачи, upsert по fitbase_id. Воронки/этапы — раз в час, пользователи и источники — раз в сутки.
- Системные этапы Fitbase (0, −1, −2) без воронки: воронку заявки на таком этапе берём из прошлой синхронизации; если неизвестна — показываем в «Новых заявках».
- Старые этапы «Архив: …» переносим скрытыми (is_archived), заявки в них видны по «Показать архивные».
- Архив заявки — своя галочка `is_archived` (в Fitbase признака архива у заявки нет).
- Комментарии Fitbase (`/note`) только по клиенту — подтягивать в ленту по client_id отдельным шагом; мессенджеры — не здесь.
- Статус клиента — код `status` из `/client/:id`, соответствие кодов и цветов уточнить по данным.

### Обновление доски и нагрузка (16.11.2026, записано, ТЗ не собрано)
- Обновлять **только изменения**, запросов — как можно меньше: Render жаловался на трафик. За ноябрь на 16.11 — 7,8 ГБ, из них 7,5 ГБ исходящие запросы самого сервиса (к Fitbase и Supabase), ответы пользователям — 0,3 ГБ.
- Синк: из Fitbase по-прежнему забирает всё (иначе API не умеет), но **в базу пишет только изменённые заявки и задачи** (сравнение с тем, что уже лежит), `updated_at` — только при реальном изменении.
- Доска: опрос сервера «что изменилось с прошлого раза» — сервер отдаёт только новые и изменённые карточки, доска подменяет их на месте. Карточку, которую перетаскивают или держат открытой, не трогать.
- Чтобы запросов было меньше: опрос только когда вкладка «Воронка» видна (не в фоне), интервал не чаще 60 с; пустой ответ, если изменений нет.
- Вместе с этим — свой вертикальный скролл у каждой колонки (баг 16.11).
- На подумать при сборке ТЗ: проверить, какие задачи сервера дают основной исходящий трафик (синк заявок каждые 5 мин, агент пробных, сводки), и не тянуть из Fitbase задачи/статусы чаще, чем нужно.

### Карточка заявки — окно справа (05.11.2026, образец «Изменить заявку» в Fitbase)
- Клик по карточке открывает панель **справа**. Переносим **все поля**; ненужные потом отключим (значит, нужна настройка видимости полей).
- Левая часть, вкладки «Основное» / «Произвольные поля».
  - Основное: Название*, Клиент, Телефон (+ кнопка «Написать в ФитБейс Чат»), Описание, Бюджет, Теги, Менеджер, Воронка*, Этап воронки, Источник*, UTM-Компания, UTM-Источник, UTM-Канал, UTM-Фраза, UTM-Контент (и что ниже — уточнить).
  - Кнопки: «Сменить клиента», «Сохранить».
- Правая часть — лента активности:
  - поиск по содержимому;
  - фильтры: Все / Комментарии / Мессенджеры / Задачи / Рассылки / Звонки;
  - поле комментария, кнопки «Задача», «СМС», «Отправить».
  - Задача в ленте: тип («Задание»), текст, дата и время, исполнитель; кнопки «выполнено», «перенести дату», «удалить».
  - Сообщения мессенджера в ленте (WhatsApp, метка «Диалог», интеграция fitbase_chat, дата).

### Воронки и этапы (решено 04.11.2026)
Переносим из Fitbase **все 4 воронки со всеми живыми этапами**, в том же порядке (скриншоты Fitbase 04.11):
1. **Новые заявки:** Неразобранные → Квалификация → Долгий срок (квал) → Проконсультирован → Не пришёл на пробную → Записался на пробную → Визит подтверждён → Принимает решение (Дожим) → Ангелина → Вера → Назерке → Успех.
2. **Новички:** Неразобранные → Купил первый абонемент → Выполнен сервис 1 → Ожидание продления → Отстойник.
3. **Постоянные клиенты:** Неразобранные → Только купил абонемент → Выполнен сервис 2 → Ожидание продления → Отстойник.
4. **Реактивация:** Неразобранные → До 30 дней → От 31д до 90д → От 91д до 180д → От 181д до года → Вечность.
- У каждого этапа свой цвет полосы в шапке колонки (как в Fitbase).

### Как выглядит в Fitbase сейчас (образец, 04.11.2026)
- Шапка: выбор воронки, «Настройки», выгрузка в Excel, «Аналитика», переключатель «Колонки / Список», «Создать заявку».
- Фильтры: заявка (название, ФИО, контакты), этап, теги, дата создания, источник, клиент, менеджер, «Только без задач», «Показать архивные».
- Колонка: название этапа, количество заявок и сумма бюджета в ₸.
- Карточка: название заявки, дата и время создания, клиент (цветная точка — статус клиента), телефон + значок чата, бюджет ₸, менеджер, теги (tiktok, manual_import, no_phone). Розовый фон у части карточек (уточнить значение).

### Перенесено из других модулей (04.11.2026)
**Как сейчас устроено в Fitbase** (`agent.md`, `reports.md`, `docs/reports/funnels-check.md`, `src/config.ts`)
- Воронка «Новые заявки» (funnel_id 1). Этапы, которые трогает агент: 3 «Записался на пробную», 52 «Визит подтверждён», 50 «Принимает решение (Дожим)», 55 «Не пришёл на пробную»; этап 0 — неразобранные; есть «Отказ» и архив.
- Другие воронки жизненного цикла: «Новички», «Постоянные», «Реактивация» (+ «Отстойник», «Ожидание продления», «Выполнен сервис 1/2»).
- Агент пробных: через 2 ч от начала записи проверяет визит → пришла → «Принимает решение», не пришла → «Не пришёл на пробную».
- Пробное = услуга «Бесплатное пробное занятие» / «Абонемент: Пробное занятие» (training.id 16). В нашей CRM — системная бесплатная услуга, запись без кассы (`crm-core.md`, `crm-schedule.md`).
- Статусы записи: 0 записан, 1 подтверждён, 2 отказ/отмена, 3 пришла, 4 не пришла (`reports.md`).

**Источники** (`reports.md`, `crm-core.md`, `tiktok.md`)
- Рекламные источники Fitbase: Рекомендация клиента клуба, Сайт, Instagram, Проходящий трафик, Входящий звонок, WhatsApp, Блогер бартер, Блогер Зарина, Блогер Хадия, Блогер Ната, 2гис, Таргет, Таргет тикток. В CRM — справочник `crm_ad_sources`; «Рекомендация» требует «кто порекомендовал».
- TikTok: лиды из Leads Center → Google Таблица → Apps Script → Fitbase. Лид без телефона всё равно создаётся (вместо номера — имя в TikTok). Клиентов автоматически не создаём (дубли) — менеджер создаёт сам. Проблема: TikTok отдаёт старый номер профиля. План: при переезде лиды TikTok — в нашу «Воронку»; тот же поток для Instagram и WhatsApp.

**Метрики, которые воронка должна давать** (`reports.md`)
- Факт дня: лиды дня → Квал → записи на пробное на этот день → пришли → продажи. Дневной такт: лиды → Квал → записались → пришли → купили.
- **Квал** = по лиду заведена карточка клиента (в Fitbase `client_fitbase_id != null`); событие, не меняется при смене этапа.
- **Живые** = лид сейчас в «Новые заявки» / «Новички» / «Постоянные» и не в «Отказ».
- Источник и менеджер для записей и продаж берутся из последней карточки лида клиента (связка клиент ↔ лид по id, запасной ключ — телефон).
- Нормы конверсии: В работе→Записи 60–70 %, Записи→Пришли 85 %+, Пришли→Купили 50–80 %.
- Типы покупки: новая / продление / вернулась (>30 дней после окончания).

**Правила менеджеров и агента** (`agent.md`, `ovcharka.md`, дорожная карта)
- Покупка засчитывается, если полная цена абонемента (до скидок/промокодов) ≥ 40 000 ₸; до 39 999 (в т. ч. пробное) — не покупка. Покупка → свой этап «Успешно реализовано».
- Перезапись: карточка в «Не пришёл» получила новую запись на пробное → назад в «Записался» с комментарием.
- Клиент из «Реактивации» записан на пробное → карточку в «Новые заявки» (агент, если менеджер забыл).
- Агент карточки сам не создаёт — их создают консультанты.
- Задачи — менеджеру карточки, а не всем троим; учитывать свежий комментарий менеджера.
- Овчарка: новый лид — сразу уведомление; тревога, если через 5 мин нет задачи. Задача максимум на 7 дней вперёд.
- Закрепление карточки: карточка «своя», только пока есть задача в будущем (≤7 дней) и полный комментарий (что сделано, результат, следующий шаг и когда). Дата прошла и сутки нет комментария — карточка свободна для любого менеджера. Касается лидов, «Реактивации» и закончившихся абонементов; продажа абонемента засчитывается менеджеру карточки.
- Сейчас менеджер клиента = кассир, который продал. В Кассе CRM поле «Менеджер» отдельно от кассира (`crm-kassa.md`).
- Распределение новых лидов между менеджерами — не решено (идея Сергея: чётные/нечётные номера карточек).
- Отмена записи — через статус «Отказался» в расписании.
- Эскалация неактивных (купили, не ходят): день 7 — «Звонок» кассиру-продавцу, день 10 — всем троим, день 14 — в сводку Сергея.

## Открытые баги / ограничения
- **16.11.2026: у колонок доски нет своего скролла** — колонки растут по высоте карточек (`alignItems: flex-start` у доски, у колонки нет высоты), внутренний `overflowY: auto` не срабатывает, нижние карточки обрезаны. Нужно: у каждой колонки свой вертикальный скролл, шапка колонки остаётся на месте.
- **16.11.2026: доска сама не обновляется** — список заявок грузится целиком один раз (при открытии, смене воронки/фильтра, после ручного синка); после автосинка раз в 5 мин изменения видны только после перезагрузки. Синк каждый раз перезаписывает все ~940 заявок в базе, даже без изменений.
- **05.11.2026: синк падает на проде** — `null value in column "budget" ... violates not-null` (Fitbase отдаёт лиды без бюджета), ни один из 939 лидов не сохраняется, задачи не доходят. Исправление — в ТЗ доделки задачи 37 (ЧАСТЬ 1: null → 0, title null → '', неизвестный этап — пропуск, `user_id` вместо `app_user_id`).
- Комментарии из Fitbase `/note` (по client_id) не синхронизируются в ленту активности — отдельный шаг.
- Вкладка «Произвольные поля» в LeadDrawer — заглушка (будет по запросу Сергея).
- LeadDrawer на мобиле: панель 100vw, overflow-y: auto — нужна проверка на iOS что fixed позиция не прыгает.
- Поиск по лидам работает через like на name/surname/phone на сервере (не debounced полностью на клиенте — query каждый keystroke).
- Шапка колонки: нет суммы бюджета (только количество) — не критично.

## Следующее
- **27.11.2026 — решения Сергея по автоматизации (ТЗ 112 выдано):** у каждого этапа своё условие, по которому он забирает заявку; логика редактируется в Настройках (отдельная группа «Автоматизация»), в коде только каталог условий. Агент ЖЦ — на данных нашей CRM, без Fitbase, сразу боевой (стартовые правила заведены в режиме «Тест», переключение одним кликом). Правила: есть купленный абонемент → «Сопровождение / Активный абонемент»; ≤10 дней или ≤3 занятий → «Сопровождение / Заканчивается абонемент»; закончился <14 дней назад → «Сопровождение / Ожидает продления»; ≥14 дней → «Реактивация / Абонемент завершен - без продления»; купил снова — возвращается в «Активный абонемент». «Отложенное решение» (в Fitbase «Свалка/отложенные») — кто не купил после пробного и висит >14 дней в «После пробного - решение» без задачи с датой. Агент пробных (Fitbase, тревоги) уже боевой — не трогаем. Грейд «Отложенного решения» (27.11, подтвердил Сергей) — этапы по давности последнего визита (пробного): До 30 дней / От 31д до 90д / От 91д до 180д / От 181д до года / Вечность; правила приоритет 60–100, забирают только из воронок «Отложенное решение» и «Свалка» (SQL-112-grade).
- **27.11.2026 — автоматизация (обсуждение, ТЗ не собирать до «собирай»).** Сергей: простое автоперемещение «заявка попала в воронку/этап X → переезжает в воронку/этап Y», вкладку «Автоматизация» переделать под лёгкий визуал; подключить агента жизненного цикла. Разведка: в `crm_lead_rules` 15 строк, но в коде (`src/core/leadRules.ts`) работают только 2 кода — `lead_first_contact` (задача при создании) и `stage_task` (задача при входе на этап); остальные — заглушки. Агент ЖЦ (`src/jobs/lifecyclePlan.ts`, `/run/lifecycle-plan`, флаг `LIFECYCLE_DRY_RUN`) целиком на API Fitbase (заявки, договоры, визиты), воронки по id Fitbase 1–4 и именам этапов Fitbase, только пишет план в `lifecycle_plan`, ничего не двигает даже в боевом режиме. К нашей CRM не подключён — его правила нужно переписать на наши данные (`crm_client_plans`, `crm_bookings`, `crm_visit_history`, `crm_sales`). Предложение: правила «Когда → Что сделать» с режимами Выкл / Тест / Боевой.
- **27.11.2026 — ТЗ 111 выдано** (`docs/tasks/111-...`): редизайн настроек воронок (порядок, переименование, удаление этапа с переносом заявок, скрытие системных этапов в воронке через `crm_funnels.hidden_system_kinds`), переключатель синхронизации Fitbase убран из воронок, realtime через SSE.
- **27.11.2026 — расстановка заявок Fitbase по этапам:** заявки уже лежат в `crm_leads` (синк Fitbase, `raw.funnel_step` хранит имя этапа и воронки Fitbase). Из Fitbase заново не тянем. Сергей создаёт этапы с именами точь-в-точь как в Fitbase, проверка 27.11 показала: заявок Fitbase в базе нет (в `crm_leads` 2 ручные). Поэтому в ТЗ 111 добавлена часть 2А — разовый импорт из Fitbase (только чтение) с окном сопоставления «этап Fitbase → наш этап» (автоматически по одинаковому названию).
- Системные этапы (Неразобранные/Успех/Отказ) общие для всех воронок, удалять нельзя (на них завязаны создание заявки, причина отказа, покупка) — только скрывать в конкретной воронке.
- Добавить cron-job.org: POST https://slimway-agent.onrender.com/run/crm-leads-sync каждые 5 минут с заголовком x-cron-secret.
- Правила воронки (`crm_lead_rules`) — включить после переезда с Fitbase.
- Комментарии из Fitbase `/note` → лента активности (по client_id).
- Создание лида вручную (кнопка «+ Заявка» в шапке доски).
- Фильтры на доске: по менеджеру, по тегу, по источнику, по дате создания.
- Автоматическое предупреждение о дублях при создании заявки.
- Список-режим (переключатель Колонки / Список) для мобиле.

**Скриптолог** (`scriptolog.md`)
- Факты по клиентке из переписки: цель, опыт, причина неудачи, ограничения, удобное время, дата окончания у конкурента, кто порекомендовал, причина отказа — кандидаты в поля карточки лида.

**Идеи из справочников** (`docs/crm-reference-map.md`, только идеи)
- Старая SlimWay CRM: `leads` (статусы new / in_work / waiting / success / fail, assigned_to, notes, client_id после конвертации, archived_at) + `lead_comments`; клиент со статусом `draft`, созданный из лида до продажи.
- Frappe: статусы отдельной таблицей с типом (Open / Lost / Qualified) — этапы без переделки схемы; канбан (колонки = этапы, перетаскивание = смена этапа); единая лента активности в карточке (создание, смена полей, комментарии, звонки, задачи).
- По карте признано лишним для студии: SLA, «температура» и скоринг лида.

## Мобильная версия
<!-- Брейкпоинты: ≤640 телефон · 641–1024 планшет · >1024 десктоп -->

## Сделано
<!-- новые записи сверху -->
### 05.11.2026 · 2076c1f · зонд Fitbase leads API (задача 36)
- `src/jobs/probeLeadsApi.ts` + `GET /run/probe-leads-api`. Только rawGet; PII маскируются.
- Исследованы: 7 воронок (4 рабочих), 62 этапа, 936 лидов, 1252 задачи, 17 пользователей, 14 источников, /note, /client/:id.
- Ключевые находки: фильтры воронки/архив/updated_from не работают → только полный sync; теги = строки; analytics.is_overdue = розовый фон; /note требует client_id; detail-запрос лида не добавляет полей.
- Отчёт: `docs/reports/fitbase-leads-api.md`.

### 04.11.2026 · — · модуль создан
- Файл модуля, перенесены решения из agent, reports, tiktok, crm-core, crm-kassa, crm-schedule, ovcharka, scriptolog, crm-reference-map. Идёт сбор требований в чате.

## Открытые вопросы (собираем)
- (все закрыты 05.11.2026; новые — по итогам проверки API Fitbase)

## Открытые баги
- (нет)

## Следующее
- SQL таблиц воронки по отчёту `docs/reports/fitbase-leads-api.md` — напишет Claude в чате.
- Затем ТЗ доски, карточки, синхронизации и Настроек — по команде «собирай».
- Уточнить маппинг кодов статуса клиента (status=0/1/2/3 → Новый/Открыт/Закрыт/Потенциальный).
- Проверить мессенджеры в ленте: приходят ли WA/fitbase_chat через `/note?client_id=X`.
