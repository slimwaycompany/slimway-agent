# Задача 06: Синхронизация операций Fitbase, закрытие смены, приближение зоны

## Контекст

Отчёт по продажам и закрытие смены показывают ВСЕ операции без фильтра по дате (620 операций и 3,7 млн наличными «за день»), потому что Fitbase игнорирует параметр даты в `/till-order-steps`. Решение — хранить операции у себя и фильтровать в Supabase.

**SQL уже выполнен:** таблица `fitbase_operations`; в `cash_closings` добавлены `noncash_out`, `shift_start`, `shift_end`, `remarks`; нумерация закрытий с 89.

**Закрытие и открытие смены — ТЕСТОВЫЕ.** В Fitbase ничего не отправлять.

## Часть 1 — Синхронизация операций Fitbase → fitbase_operations

- `/till-order-steps` — продажи и возвраты
- Попробовать `/till-income` и `/till-outcome` — если нет, описать в отчёте
- Классификация по `item_type` и знаку суммы → `op_type`: sale/refund/deposit/withdrawal/other
- `op_date` = дата по Asia/Yekaterinburg
- Первая загрузка: с `FITBASE_OPS_SINCE` (по умолчанию 2026-01-01)
- Инкрементально: курсор = MAX(op_at), перечитывать последние 2 дня; upsert по fitbase_id
- `/run/fitbase-ops` — cron-endpoint (CRON_SECRET)
- `POST /kviz/api/cash/sync` — кнопка «Обновить» в UI (только admin)

## Часть 2 — Отчёт по продажам из Supabase

- `/kviz/api/reports/sales` — только из `fitbase_operations` по `op_date`
- Те же разрезы: менеджер, кассир, тип, способ оплаты

## Часть 3 — Закрытие смены по шаблону

- `/kviz/api/cash/today` — операции из `fitbase_operations` за сегодня
- Шапка окна: «⚠️ Тестовый режим — в Fitbase ничего не отправляется»
- Кнопка «Обновить» рядом с меткой времени последней синхронизации
- Начало/конец смены: из `staff_shifts` за сегодня, иначе 08:00/22:00 (сб/вс 20:00)
- Поля: `noncash_out` (возвраты по карте), `shift_start`, `shift_end`, `remarks`
- Excel: по шаблону `templates/zakrytie-smeny.xlsx` (закоммитить)
- Печать: HTML по структуре шаблона, скрытый iframe

## Часть 4 — Клик по зоне фигуры: сильное приближение + попап

- Масштаб: ×2.8-3.5 в зависимости от позиции зоны (CSS custom property --zoom-scale)
- Анимация: transition 0.6s ease
- ZoneDetailPanel overlay: `backdrop-filter: blur(8px)` + `background: rgba(0,0,0,0.4)`
- Приближенная фигура видна (блюром) за попапом
- Мобильный: bottom sheet, фон размыт

## Часть 5 — Проверка и финал

- `npm run build` без ошибок
- Деплой на прод, скриншоты
