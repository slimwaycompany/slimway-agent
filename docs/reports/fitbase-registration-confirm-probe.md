# Fitbase: проверка API подтверждения записи

**Дата:** 06.11.2026  
**Статус:** ⚠️ НЕ верифицировано

## Задача

Автоматически подтверждать пробную запись в Fitbase, когда клиентка ответила «+» в EasyChat.

## Кандидат на эндпоинт

```
PATCH https://api.fitbase.io/api/v2/visit/{fitbase_visit_id}
Content-Type: application/x-www-form-urlencoded
Authorization: Bearer {FITBASE_TOKEN}
club: {FITBASE_CLUB}

status=1
```

Статусы визита:
- 0 = записан (не подтверждён)
- 1 = подтверждён
- 2 = отказ
- 3 = пришла
- 4 = не пришла

## Что нужно проверить

1. Создать тестовую запись в Fitbase (или найти реальную запись со статусом 0).
2. Выполнить `PATCH /visit/{id}` → `{"status": 1}` (или form-encoded `status=1`).
3. Убедиться что в интерфейсе Fitbase статус изменился на «Подтверждён».
4. Проверить ответ API: должен быть `success: true`.

## Текущее состояние в коде

`src/jobs/scriptologReminders.ts`, функция `runScriptologReminders`:
```typescript
// shortcut: Fitbase PATCH /visit/{id} status=1 not yet verified
// see docs/reports/fitbase-registration-confirm-probe.md
console.log(`[scriptolog] CONFIRM: ... — Fitbase update skipped (not verified)`);
```

## Когда включать

После успешной проверки:
1. Раскомментировать/добавить вызов `rawPatch('/visit/' + visitId, { status: 1 })` в `runScriptologReminders`.
2. Выставить в Render: `SCRIPTOLOG_CONFIRM_DRY_RUN=false`.

Пока не проверено — `SCRIPTOLOG_CONFIRM_DRY_RUN=true` по умолчанию.
