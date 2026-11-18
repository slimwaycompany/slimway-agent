Модуль: control

# Задача 66 — Control 2.0 этап 2

## Части

### Ч.1 Отметка: фото только при старте
- «Пришла»: фото обязательно
- «Ушла»: только подтверждение, без камеры и фото

### Ч.2 Каталог типов проверок
- `src/control/catalog.ts`
- Статус ready: lateness_arrival, lateness_leave, measure_inbody_trial, measure_first_visit, measure_last_visit, measure_inbody_weekly, measure_body_monthly, schedule_unmarked, schedule_wrong_abonement, schedule_deleted, schedule_double_booking, manual
- Статус soon: cc_speed_queue, cc_bant_required, cc_booking_window, cc_funnel_outcome, cc_funnel_tasks, cc_followup_materials, cc_followup_circle, cc_followup_live_message
- GET /kviz/api/control2/catalog

### Ч.3 Версии линеек
- Получить версию по роли+дата, сид при первом запуске

### Ч.4 Конструктор в Настройках
- Настройки → Контроль → «Линейки ролей»
- Вкладки Call center / Консультант
- Редактор черновика: деньги, формула, пункты, проверки
- «Сохранить с даты…»

### Ч.5 Движок v2
- `src/jobs/control2.ts` + `/run/control2`
- Роль: staff_shifts.role → control_shift_schedule.role → «без роли»
- evaluate по каждому check_type, upsert violations, scores, pay

### Ч.6 API + temp экран
- GET /kviz/api/control2/summary, /violations, /reviews
- POST /kviz/api/control2/reviews/:id, /violations/:id/waive|dispute
- Временный admin-экран «Контроль 2.0 (тест)» в Отчёты

### Ч.7 Сборка, документация, коммит

## SQL (уже выполнен)
- control_line_versions, control_manual_reviews, control_point_scores, control_shift_pay
- control_violations: снят check на check_code, добавлены role, point_key, check_key, version_id, evidence, dispute_*
- staff_shifts: role, device_id, photo_in_path, late_minutes, left_early_minutes (этап 1)
