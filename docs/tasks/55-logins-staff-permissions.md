Модуль: logins

═══════════════════════════════════════
ЗАДАЧА 55 — Окно «Сотрудники» и права по блокам и вкладкам
═══════════════════════════════════════

## Часть 0 — Подготовка
Сохрани ТЗ в `docs/tasks/55-logins-staff-permissions.md`, добавь в очередь со статусом «в работе».

## Часть 1 — Проверка БД (SQL уже выполнен)
Проверить реальные колонки `app_users`, `app_user_permissions`, `app_login_log`.
Проверить RPC `app_check_login` (должна возвращать `auth_version`), `app_create_user`, `app_set_password`.
**Таблицы:**
- `app_users`: id, login, display_name, role, password_hash, is_active, phone, fired_at, auth_version(int), last_login_at, created_at, updated_at
- `app_user_permissions`: user_id, perm_key, level CHECK('view','edit'), see_all bool, updated_at; PK (user_id, perm_key)
- `app_login_log`: id, user_id, login, ok bool, reason text, ip, user_agent, created_at

## Часть 2 — `src/core/permissions.ts`: каталог прав
Блок → вкладки. У каждой вкладки: key, label, hasSeeAll.
Экспортировать `PERM_CATALOG: PermBlock[]` и `DEFAULT_MANAGER_PERMISSIONS`.
Settings — admin-only, не в каталоге.

Блоки: manager, agent, schedule, clients, funnel, cashier, kviz, measure, reports.
Cashier sub-tabs: tab:cashier, cashier:refunds, cashier:discounts, cashier:bonuses.
Reports sub-tabs: tab:reports, tab:control.
Manager/funnel/control — hasSeeAll=true.

DEFAULT_MANAGER_PERMISSIONS: tab:agent(view), tab:kviz(edit), tab:measure(edit), tab:cashier(edit), tab:manager(view).

## Часть 3 — `src/http/auth.ts`: версия входа, getSessionWithPerms, DB rate limiter
- Добавить `v: number` в TokenPayload. Старые токены без `v` → невалидны (parseToken → null).
- `makeToken` принимает `v` в user-объекте.
- `getSessionWithPerms(req): Promise<ExtendedSession | null>` — 30-секундный кэш в памяти по user_id.
  Проверяет: is_active, fired_at, auth_version === token.v. Загружает perms из app_user_permissions.
  Для admin: кэшируется без perms (can() обрабатывает admin).
- Экспортировать: `can()`, `seeAll()`, `invalidateUserCache(userId)`.
- Экспортировать `requireAdmin(req, res)` — sync, заменяет локальные копии во всех HTTP-файлах.
- DB rate limiter: `checkLoginRate(login, ip)` async, считает failure-записи в app_login_log за 15 мин.
  `writeLoginLog(userId, login, ok, reason, ip, ua)` async. Убрать in-memory failMap.
- Экспортировать `requireAuth` (уже есть, оставить).

## Часть 4 — `src/http/shell.ts`: вход, /api/me, SW_PERMS
- POST /api/login: auth_version в токен, `writeLoginLog`, update `last_login_at`, check `is_active`/`fired_at`, DB rate limiter (`checkLoginRate`).
- GET /api/me: добавить `perms` в ответ (через `getSessionWithPerms`).
- GET /: embed `window.SW_PERMS = {...}` перед shell-app.js. Для admin — SW_PERMS со всеми блоками+settings; для manager — только их perms из DB.

## Часть 5 — `src/http/kviz.ts`: /kviz/api/me с правами
Добавить `perms` в ответ (через `getSessionWithPerms`). Для не-authed — { authed: false }.

## Часть 6 — `src/http/staff.ts`: API управления сотрудниками (admin only)
GET    /api/staff              — список (id, login, display_name, role, phone, is_active, fired_at, last_login_at)
POST   /api/staff              — создать (login, display_name, role, phone, password) → через app_create_user
PATCH  /api/staff/:id          — изменить (display_name, phone, login, role)
POST   /api/staff/:id/password — сменить пароль → через app_set_password → invalidateUserCache
GET    /api/staff/:id/permissions — получить права [{perm_key, level, see_all}]
PUT    /api/staff/:id/permissions — заменить всё permissions (array) → invalidateUserCache
POST   /api/staff/:id/permissions/copy — скопировать с другого user_id
POST   /api/staff/:id/fire     — уволить (is_active=false, fired_at=now) → invalidateUserCache
DELETE /api/staff/:id/fire     — восстановить (is_active=true, fired_at=null)
DELETE /api/staff/:id          — удалить физически (только если нет записей в crm/logs)
POST   /api/staff/:id/logout-all — +1 к auth_version → invalidateUserCache
GET    /api/staff/:id/login-log — последние 100 записей из app_login_log
GET    /api/permissions/catalog — возвращает PERM_CATALOG (для клиента)

## Часть 7 — `src/index.ts`: mount staff routes + seeder
Импортировать и монтировать `mountStaffRoutes(app)`.
На старте: `seedDefaultPermissions()` — для всех managers без permissions вставить DEFAULT_MANAGER_PERMISSIONS.

## Часть 8 — Рефакторинг requireAdmin/isAdmin
Убрать локальные функции `requireAdmin`/`isAdmin` из: manager.ts, metrics.ts, fin.ts, payroll.ts, control.ts, crm.ts, crmLeads.ts, shifts.ts, cash.ts, kviz.ts.
Добавить в импорт: `requireAdmin` (и `requireAuth` где нужно) из `'./auth'`.

## Часть 9 — `public/shell-app.js`: SW_PERMS-фильтрация
Читать `window.SW_PERMS` при инициализации.
Для каждого блока: если нет view-permission → скрыть tab-btn, choice-btn, drawer-item.
Side buttons: скрывать кнопки, которые ведут к недоступному блоку.
При переходе на недоступную вкладку (из localStorage или hash) → перейти на первую доступную.
Для admin (SW_PERMS === 'admin') — показывать всё.

## Часть 10 — React: PermContext, App.tsx, StaffPage
- `kviz/client/src/lib/permContext.tsx`: PermContext, usePerm(key, level?): boolean хук.
  Данные из /kviz/api/me (поле perms). Admin role → все true.
- `kviz/client/src/App.tsx`: провайдер PermContext из /kviz/api/me.
- `kviz/client/src/pages/crm/StaffPage.tsx`: полный UI управления сотрудниками.
  Список + карточка. Создание, редактирование, пароль, permissions tree, увольнение, удаление, журнал входов.
  Дерево прав: блоки из /kviz/api/permissions/catalog, у каждого вкладки с чекбоксами view/edit/see_all.
  Кнопка «Скопировать права с…» в карточке.
- `kviz/client/src/pages/crm/SettingsPage.tsx`: добавить 'staff' в Section, первый элемент NAV, рендер `<StaffPage />`.

## Часть 11 — Сборка, тесты, документация
`npm run build` — без ошибок.
Обновить docs/modules/logins.md, docs/STATE.md, docs/QUEUE.md, docs/modules/infra.md (если изменились вход/сессия).
Коммит: `"logins: task 55 — окно Сотрудники, права по блокам и вкладкам, версия входа, журнал входов"`.
Деплой на Render, проверить на проде.
