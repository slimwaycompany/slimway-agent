Модуль: crm-core

# Задача 97 — Карточка клиента: цены абонементов, новый макет, окно абонемента, лента

SQL уже выполнен: `crm_client_plans.price numeric(12,2)`, `crm_client_plans.sale_id uuid → crm_sales(id)`, `crm_client_plans.sold_by text`.
SQL-файлы и миграции не создавать.

Статусы `crm_client_plans`: `'not_activated' | 'active' | 'frozen' | 'expired' | 'refunded' | 'cancelled'`.
`crm_client_comments.kind`: `'comment' | 'break' | 'agreement' | 'wish' | 'other' | 'freeze' | 'unfreeze'`.
Каждый ответ Supabase проверять на error и логировать; ошибки пользователю — по-русски.

## Часть 0 — Подготовка

- Прочитай CLAUDE.md, docs/STATE.md, docs/modules/crm-core.md («Следующее» → «Абонементы в карточке клиента» 25.11 и «task 94, отложено»), docs/modules/crm-kassa.md («Открытые баги»: 515 продаж с 0 ₸), docs/modules/logins.md.
- Сохрани ТЗ в `docs/tasks/97-crm-core-card-layout-plan-window.md`, добавь в `docs/QUEUE.md` (задача 97), статус «в работе».
- Запусти `crm-import-fix-prices` (dry → потом apply); доложи сколько продаж source='fitbase' с total=0 осталось после apply и почему.

## Часть 1 — Цены и продавец у абонементов

`/run/crm-fill-plan-prices?mode=dry|apply` — для планов source='fitbase': найти crm_sales с fitbase_step_id, взять сумму из crm_sale_items, записать price/sale_id/sold_by в crm_client_plans.

Для новых продаж через crm_checkout: после RPC взять plan_id из ответа, найти в crm_sale_items, записать price/sale_id/sold_by.

## Часть 2 — Попап: поля и шрифт

Попап `98vw × 98vh`, весь текст в карточке клиента +1px (базовые 13→14, 12→13, 11→12 и т. д.).

## Часть 3 — Левая колонка

Новый порядок: ФИО → телефон → депозит+бонусы → ДР → источник/визиты → соцсети → Fitbase → метки → активный абонемент с деталями → Подробнее.
Убрать нижний блок информации (Источник, Клиент с, LTV, Визитов, Последний визит, Депозит, Бонусы — эти данные теперь встроены выше).
Несколько активных абонементов — карточками (не «первый + +ещё N»).

## Часть 4 — Центр и правая колонка

Центр: 2 вкладки **Покупки / Посещения**.
- Покупки = абонементы (Пакеты) + лента (всё).
- Посещения — как сейчас.

Баг посещений: `booking_time` не существует — заменить на `starts_at` в `/clients/:id/visits`. Аналогично `service_name` → `training_name` в crm_visit_history.

Важное → переносится в низ правой колонки.

## Часть 5 — Окно абонемента

Клик по абонементу → `PlanDetailModal`:
- 4 даты: куплен (purchased_at) → активирован (activated_at) → предв. окончание (valid_until − 10 дней) → закончился (valid_until, в скобках valid_until + extra_days из crm_plans).
- Цена и продавец (price, sold_by).
- История заморозок из crm_client_comments kind='freeze'/'unfreeze'.
- История посещений по этому абонементу: `GET /kviz/api/crm/client-plans/:id/visits` → crm_bookings.client_plan_id.
- Кнопки: Заморозить / Разморозить / Распределить.

## Часть 6 — Лента событий

Вкладки: **Всё / Комментарии / Задачи / Действия** (вместо «Лог»).
Вкладка «Действия»: человекочитаемые события (checkout → «Продажа №N на M ₸», freeze/unfreeze → «Заморозка/Разморозка абонемента "X"», split → «Распределён абонемент "X"»).
Иконка системного лога (🗒) в правой колонке — видна только при праве `clients.log` (новое право). Добавить `clients.log` в PERM_CATALOG.

## Часть 7 — Проверка, документация, деплой

`npm run build` → ✅. `npm run check:mobile` → 0 новых ошибок.
Проверь на проде конкретных клиентов (после деплоя):
- Клиент с абонементом «VACU 12+RS12» — вкладка Посещения должна показывать визиты.
- Любой клиент с Fitbase-планом — должна показываться цена.
- Клик по абонементу → PlanDetailModal открывается.
Скриншоты 1440px и 375px попапа клиента.
Обнови docs/modules/crm-core.md, docs/STATE.md, docs/QUEUE.md.
