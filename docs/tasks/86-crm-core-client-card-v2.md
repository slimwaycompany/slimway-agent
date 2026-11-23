Модуль: crm-core, zamery, crm-leads
# Задача 86: Карточка клиента v2 — Этап 4: интерфейс попапа

Статус: 🔧 в работе

## Что делаем
Заменяем правую боковую панель с клиентом на попап (оверлей поверх списка).
SQL уже выполнен (новые поля crm_clients, таблицы crm_client_tags/links/comments, RPCs crm_plan_freeze/unfreeze).

## Части

### Часть 0: Инфраструктура
- Сохранить ТЗ в этот файл, добавить в QUEUE.md

### Часть 1: Попап
- Удалить правую панель, открывать ClientPopup (оверлей) при клике по строке
- Ширина до 1400px; на телефоне — полный экран снизу
- URL-синхронизация через hash `#client=:id`

### Часть 2: Метки
- Системные метки (вычисляются сервером): new_client, incomplete_profile, subscription_ending, measure_soon, measure_overdue, birthday
- Личные метки (crm_client_tags): CRUD в Настройках → группа «Заявки» → «Метки клиентов»
- Фильтр по меткам в списке клиентов (позже)

### Часть 3: Левая колонка
- ФИО, д.р., телефон, источник, LTV
- Активный абонемент с кнопкой «Заморозить»
- Аккордеон «Подробнее»: ИИН (маскировать), документ, адрес, пол
- ИСПРАВИТЬ GET /clients/:id/summary: LTV через crm_sale_payments/crm_refund_payments

### Часть 4: Центр
- Окно «Важное»: skirt_size, device_settings, important_note (редактировать inline)
- Окно «Пакеты»: фильтр Все/Активные/Закрытые, кнопки заморозки/разморозки/распределения

### Часть 5: Лента (центр, нижнее окно)
- GET /clients/:id/feed?kind=all|comments|tasks|log&before=<cursor>
- Комментарии (crm_client_comments) + задачи (crm_lead_tasks) + лог (crm_audit_log)
- Вкладки: Всё / Комментарии / Задачи / Лог

### Часть 6: Правая колонка
- InBody: последний тест, ключевые показатели, 7-дневный таймер
- Замеры: последний замер, ключевые показатели, 7-дневный таймер

### Часть 7: Права
- Просмотр — все
- Редактирование — clients.edit
- Принудительная заморозка (сверх лимита) — только admin

### Часть 8: Сборка, документация, деплой
- npm run build без ошибок
- npm run check:mobile
- Обновить docs/
- git push + проверить на проде

## Таблицы (SQL выполнен)
- crm_clients: новые колонки gender, address, skirt_size, device_settings, important_note
- crm_client_tags: id, branch_id, name, color, is_active, created_at
- crm_client_tag_links: id, client_id, tag_id, created_at
- crm_client_comments: id, client_id, text, author, created_at, updated_at
- RPCs: crm_plan_freeze(p_plan_id, p_days), crm_plan_unfreeze(p_plan_id)
