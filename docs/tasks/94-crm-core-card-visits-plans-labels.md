Модуль: crm-core

# Задача 94 — Карточка клиента и список: фильтры, посещения, абонементы, заморозка с причиной

## ЧАСТЬ 0 — Подготовка
- SQL выполнен: `crm_client_comments.kind` теперь 'comment'|'break'|'agreement'|'wish'|'other'|'freeze'|'unfreeze'; в `crm_client_tags` заведена личная метка «Проблемный клиент» (#dc2626).
- Нужен SQL для новых автометок `incomplete_profile` и `birthday` в `crm_client_auto_labels` (см. раздел «Нужен SQL»).

## ЧАСТЬ 1 — БАГ: фильтры в списке клиентов
- Подозрение: all-scan в `GET /kviz/api/crm/clients` делает `.in('client_id', allIds)` по `crm_visit_history` / `crm_bookings` на ~786 клиентов — длинный URL PostgREST, error не проверяется. Разбить `.in()` на пачки по 150 id, проверять error.
- Добавить фильтр по меткам (автометки + личные) в тулбар и backend.
- Каждый ответ Supabase проверять на error и логировать.

## ЧАСТЬ 2 — Автометки в списке и карточке
- Заменить старые `system_tags` из `batchEnrich` (задача 86) на вызов `batchAutoLabelsToday` из `clientAutoLabels.ts`.
- Добавить в `batchAutoLabelsToday` расчёт `incomplete_profile` (если !profile_complete) и `birthday` (если birth_date.slice(5) === сегодня MM-DD).
- «Проблемный клиент» остаётся личной меткой.
- Обновить отображение меток в списке клиентов и карточке (column «Метки» и попап).

## ЧАСТЬ 3 — Вкладка «Посещения»
- Новая вкладка «Посещения» в `ClientPopup` (рядом с «Лентой»).
- Объединяет `crm_bookings` (attended/no_show/cancelled/late_cancel) + `crm_visit_history` (Fitbase).
- Колонки: дата+время, тип (CRM/Fitbase), статус, аппарат/тренировка.
- Загрузка по 30 за раз; фильтр: Все / Пришла / Не пришла / Отменена.
- GET /kviz/api/crm/clients/:id/visits?limit=30&offset=0&status=all|attended|no_show|cancelled

## ЧАСТЬ 4 — Абонементы
- Показывать цену в строке абонемента (из `crm_client_plans.price` если колонка есть, иначе из `crm_sale_items`).
- Клик по строке абонемента → модальное окно `PlanDetailModal` с: состав + остаток, даты активации/окончания, история заморозки (комментарии клиента kind='freeze'/'unfreeze'), визиты по этому абонементу, кнопки Заморозить/Разморозить/Распределить.

## ЧАСТЬ 5 — Заморозка с причиной
- В `FreezeDialog` добавить обязательное поле «Причина» (кнопка отключена пока пусто).
- После freeze: RPC `crm_plan_freeze` + вставка в `crm_client_comments` (kind='freeze', text=причина).
- Разморозка: аналогичный диалог с полем причины → RPC `crm_plan_unfreeze` + comment kind='unfreeze'.
- Записи freeze/unfreeze в ленте не редактируются и не удаляются.

## ЧАСТЬ 6 — Левая колонка
- Соцсети (instagram, tiktok, email) + LTV вынести в сворачиваемый блок (по умолчанию свёрнут).

## ЧАСТЬ 7 — Build, mobile check, docs
- `npm run build` без ошибок.
- `npm run check:mobile` (только новые экраны).
- Обновить `docs/modules/crm-core.md`, `docs/modules/crm-schedule.md`, `docs/STATE.md`, `docs/QUEUE.md`.
- Коммит и push.

## Нужен SQL
```sql
-- Новые автометки incomplete_profile и birthday
INSERT INTO crm_client_auto_labels (code, name, short_name, color, sort, is_active, params)
VALUES
  ('incomplete_profile', 'Анкета неполная', 'Анкета', '#d97706', 20, true, '{}'),
  ('birthday', 'День рождения', 'ДР', '#db2777', 25, true, '{}')
ON CONFLICT (code) DO NOTHING;

-- Опционально: колонка price в crm_client_plans (для отображения стоимости)
-- ALTER TABLE crm_client_plans ADD COLUMN IF NOT EXISTS price numeric(10,2) DEFAULT NULL;
```
