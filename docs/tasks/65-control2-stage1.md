Модуль: control

# Control 2.0 — Этап 1: фундамент

ТЗ получено 18.11.2026. SQL уже выполнен.

## Часть 1 — Роль на смене в графике (CRM ↔ Google-таблица)
- Формат ячейки: `ЧЧ:ММ-ЧЧ:ММ КЦ` / `ЧЧ:ММ-ЧЧ:ММ КОНС` (суффикс без учёта регистра, CC и К допускаются)
- controlSheetSync.ts: при разборе «Графика работы» вытаскивать role и sheet_value
- Двусторонняя синхронизация (Google побеждает при расхождении sheet_value)
- Экран «График смен» в Настройки → Контроль (settings.control_schedule)
- Мобильная версия: список дней с карточками сотрудников

## Часть 2 — Отметка прихода и ухода v2
- Доверенные компьютеры: Настройки → Контроль → «Доверенные компьютеры» (settings.control_devices)
  - Cookie sw_device (HttpOnly, Secure, SameSite=Lax, 2 года), хранить только token_hash
- «Пришла» / «Ушла» во вкладке Менеджер (только с доверенного ПК)
- Фото с веб-камеры обязательно — JPEG ~300 КБ → bucket shift-photos
- Роль при «Пришла» из графика; если нет — выбор обязательный
- late_minutes и left_early_minutes по часам «Факта»/«Плана» графика
- Запись в Google: doPost action:'mark' (время, филиал, ФИО, фото-URL, тип, роль)
- control_shift_marks пополняется из staff_shifts (source='staff_shifts')
- Отчёт «Смены»: миниатюра фото, роль, опоздание/ранний уход

## Часть 3 — Должность ОКК и права
- Новые ключи в PERM_CATALOG: reports.control_cc, reports.control_consultant, control.review, settings.control_schedule, settings.control_devices, settings.pbx
- Должность «ОКК» в POSITION_PRESETS
- В Настройки → Контроль: переключатель show_my_shift, мультивыбор checkin_mobile_hidden_positions

## Часть 4 — Приёмник АТС OnlinePBX
- POST/GET /hooks/onlinepbx?key=PBX_WEBHOOK_SECRET
- Принимает JSON и form-urlencoded, отвечает 200 сразу
- Всё событие → pbx_events до разбора
- Разбор → pbx_calls (upsert по call_uuid), привязка к лиду/клиенту
- Опциональный джоб /run/pbx-sync (если ONLINEPBX_DOMAIN + ONLINEPBX_API_KEY)
- Настройки → «АТС» (settings.pbx): ссылка вебхука, таблица расширений, последние 30 событий/звонков

## SQL выполнен
- control_shift_schedule: + role, sheet_value, updated_by, updated_at
- staff_shifts: + role, device_id, photo_in_path, photo_out_path, ip, late_minutes, left_early_minutes
- Новые таблицы: control_trusted_devices, pbx_events, pbx_calls, pbx_extensions
- Bucket: shift-photos (приватный)
- control_settings: arrive_before_minutes (15), fix_seconds_after_call (30), show_my_shift (false), checkin_mobile_hidden_positions ([])
