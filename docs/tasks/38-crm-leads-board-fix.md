Модуль: crm-leads

# Задача 38: CRM Воронка — доделка задачи 37 (синк падает, части ТЗ пропущены)

## SQL

Уже выполнен. Не менять схему. Claude Code SQL-файлы не создаёт.

## Часть 1 — Починить синхронизацию (src/jobs/crmLeadsSync.ts)

Ошибка на проде (лог Render 05.11): null value in column "budget" — из 939 заявок не сохраняется ни одна.

- budget (not null, default 0) → toNum: null/undefined/''/"не число" → 0
- title (not null) → null → ''
- stage_id (not null) → этап не найден → пропустить заявку, итог «пропущено: неизвестный этап»
- crm_fitbase_user_map: колонка user_id (не app_user_id) — исправить везде
- Этапы: update+insert раздельно; не трогать kind и is_personal; skip funnel 5,6,7
- Устойчивость: пачки по 100, try/catch, построчный повтор, лог (до 20 примеров)
- Ошибка одного шага не останавливает другие
- Лок 10 мин, снимать в finally
- Итог: leads total/upserted/skipped/failed, tasks total/upserted/failed

## Часть 2 — Недостающие шаги синка

- Справочники раз в сутки (sync_state → crm_leads_dicts_at):
  /user → upsert crm_fitbase_user_map (fitbase_user_id PK, fitbase_full_name), user_id не трогать
  /advertising-source → crm_ad_sources.fitbase_id по названию (без регистра)
- Воронка системного этапа → прежний funnel_id или «Новые заявки»
- stage_changed_at = now() + лента (stage_change) при смене этапа; при первом импорте → fb_updated_at
- Не трогать is_archived, archived_at, lost_reason_id, lost_comment, origin=manual
- Удалённые в Fitbase → is_archived = true + лента system «Заявка удалена в Fitbase» (если все страницы загружены без ошибок)
- Задачи: lead_id через crm_leads.fitbase_id, fitbase_responsible — массив ФИО, user_id для map
- Статус клиента раз в сутки: /client постранично → crm_clients.fitbase_status
- Комментарии Fitbase: при открытии карточки, если fitbase_client_id, GET /note?client_id → crm_lead_activity
- GET /kviz/api/crm/leads/sync/status — идёт ли синк, время последнего удачного, итоги
- POST /kviz/api/crm/leads/sync — ручной запуск, любой вошедший, 409 если уже идёт

## Часть 3 — Доска (что пропущено в задаче 37)

- Шапка: «Колонки / Список», «Создать заявку», «Синхр. FB» + «обновлено N мин назад»
- Фильтры: заявка (title/name/surname/phone/email), этап, теги, дата (период), источник, менеджер; «Только без задач», «Показать архивные»; применить/сбросить; localStorage; debounce 300ms
- Колонки: «Неразобранные» первой; шапка с цветной полосой и «N заявок · сумма ₸»; личные этапы с пометкой
- Карточка: дата+время создания, клиент с точкой статуса, телефон +7 7XX, бюджет, менеджер, теги
- Подсветка: розовый = задача просрочена или срок сегодня; «Закреплена» = задача ≤7 дней; «Свободна» = нет задач
- Drag & drop: зона «Отказ» и «В архив»; «Отказ» → модал с обязательной причиной
- POST /leads/:id/move: без lost_reason_id при fail → 400
- «Создать заявку» → LeadDrawer в режиме создания, предупреждение о дубле
- Режим «Список» — ResponsiveTable
- Тост «только в нашей CRM» для Fitbase-заявок

## Часть 4 — LeadDrawer (что пропущено)

- Размер: ≈60% ширины на десктопе, 100% на планшете, bottom sheet 100dvh на телефоне
- Лента: фильтры «Все / Комментарии / Задачи / История», поиск
- Задача: тип, описание, срок (дата+время или весь день), исполнитель; «Выполнено» с результатом, «Перенести», «Удалить» (автор или admin)
- «Сменить клиента» — поиск по crm_clients
- «Продать» → postToParent open-cashier; «Записать на пробное» → open-schedule
- При открытии — подгрузка Fitbase-комментариев
- Исправить activity: отправлять {text:…} не {body:…}, читать a.text не a.body

## Часть 5 — Настройки и «Менеджер»

- Настройки → «Правила воронки»: список crm_lead_rules, переключатель is_enabled, плашка «правила не выполняются до переезда»
- Настройки → «Менеджеры Fitbase»: crm_fitbase_user_map с user_id; после сохранения пересчитать manager_user_id в leads и responsible_user_id в tasks
- Настройки → «Воронки и этапы»: системные и fitbase-этапы read-only
- «Менеджер» → блок задач: группы Просрочено/Сегодня/Дальше; admin видит всех + фильтр; клик → LeadDrawer

## Часть 6 — Мобильная версия

- Телефон: одна колонка на экран, кнопки переключения колонок; смена этапа через поле, не DnD; FilterBar под кнопкой
- font-size:16px на input ≤640; npm run check:mobile

## Часть 7 — Проверка на проде

После деплоя запустить синк, дать цифры (939 лидов, 1252 задач), сверить с отчётом зонда.

## Часть 8 — Документация

Обновить crm-leads.md, STATE.md, QUEUE.md. Если трогали ManagerPage/SettingsPage/shell → manager.md, crm-core.md, infra.md.
