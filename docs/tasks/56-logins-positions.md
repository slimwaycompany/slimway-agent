Модуль: logins

# Задача 56 — Должности, права по каждой вкладке и отчёту, особые действия

**Статус:** в работе (Claude Code, 16.11.2026)

Полный текст ТЗ — в чате Сергея «Логины», сообщение от 16.11.2026.

## Суть

Задача 55 сделала каталог прав грубее ТЗ (Менеджер/Клиенты/Замеры/Квалификация — одной строкой, Отчёты — целиком, Настройки не вошли). Задача 56 делает каталог максимально детальным: каждая вкладка, каждый отчёт, каждый раздел Настроек — отдельная строка. Плюс система должностей.

## Части

1. Проверка базы (SQL уже выполнен)
2. Новый PERM_CATALOG (src/core/permissions.ts)
3. POSITION_PRESETS + seedPositionPresets
4. Как считаются права (позиция → свои → нет)
5. settings.staff для не-админа (серверные проверки)
6. UI: вкладки Сотрудники | Должности в StaffPage
7. Права внутри страниц и на сервере (server-side masking, permission checks)
8. Проверка на проде
9. Документация, build, commit, push

## DB-схема (SQL выполнен)

- `app_positions`: id, code (unique nullable), name (unique), description, sort, is_archived, created_at, updated_at
- Готовые должности: hall_admin, trainer, cleaner, accountant, qa, branch_manager, company_manager
- `app_position_permissions`: (position_id, perm_key) PK, level, see_all, updated_at
- `app_users` + position_id, custom_permissions bool, branch_id uuid→crm_branches, all_branches bool

## Ключи каталога

Формат: блок.строка, действия под родителем.
Полный список в src/core/permissions.ts (PERM_CATALOG).
