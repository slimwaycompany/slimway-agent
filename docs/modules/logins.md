# Модуль: Логины, сотрудники, роли

Чат в claude.ai: «Логины» · Файл: `docs/modules/logins.md`

## Назначение
Вход сотрудников, личные логины, роли и права, данные сотрудников. Сейчас — вход в рабочее окно; дальше — окно сотрудников для CRM (консультанты в расписании, кассиры, менеджеры).

## Где код
- `src/http/auth.ts` — `makeToken`, `getSession`, `requireAuth`, `requireAdmin`; `getSessionWithPerms` (кэш 30 с); `requirePerm` (type predicate); `can`, `seeAll`; `invalidatePositionCache`; cookie `swtoken`; Bearer для iframe
- `src/http/staff.ts` — CRUD сотрудников + должностей + логи входов; `/api/staff/*` и `/api/positions/*`; `requireStaffAccess` (settings.staff для не-админа); `permsNotWider`, `auditLog`
- `src/core/permissions.ts` — `PERM_CATALOG` (10 блоков, формат `block.row`); `POSITION_PRESETS` (7 должностей); `TAB_BLOCK`; хелперы `e()`/`v()`
- `src/index.ts` — `seedPositionPresets()` при старте; `cleanLegacyPermKeys()` убирает старые `tab:*`/`cashier:*`
- `src/http/shell.ts` — `/login`; вход→`app_login_log`/`last_login_at`; `window.SW_PERMS`; вкладка «Настройки» видна если есть `settings.*`
- `public/shell-app.js` — `TAB_BLOCK`, `canTab()` (префиксный поиск по блоку), `applyPermissions()`
- `kviz/client/src/lib/permContext.tsx` — React `PermContext`, `usePerm()`, `useSeeAll()`
- `kviz/client/src/pages/crm/StaffPage.tsx` — 2 вкладки: Сотрудники | Должности; `PermTree` (3-сегментный switcher Нет/Просмотр/Изменение); `PositionDetail`; custom_permissions toggle

## Таблицы
- `app_users` — добавлены: `position_id` (FK→app_positions), `custom_permissions` bool, `branch_id` uuid, `all_branches` bool, `ui_theme text not null default 'light' check (ui_theme in ('light','dark'))`
- `app_user_permissions` — user_id, perm_key (формат `block.row`), level (`view`/`edit`), see_all
- `app_positions` — id, code (unique nullable), name (unique), description, sort, is_archived
- `app_position_permissions` — (position_id, perm_key) PK, level, see_all, updated_at
- `app_login_log` — id, user_id (nullable), login, success, reason, ip, user_agent, created_at

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026)**, если у модуля появится интерфейс: новый экран сразу верстается под телефон, планшет и компьютер.
- Личные логины вместо общего пароля: Вера, Назерке, Ангелина, admin (= Сергей). Залогиненный пользователь — автор везде (квалификация, замеры, задачи менеджера, кассир в CRM).
- Cookie `swtoken`: HMAC-SHA256 подпись (ключ: `WINDOW_SECRET || CRON_SECRET`), 30 дней, HttpOnly, Secure, SameSite=Lax.
- `/api/*` без входа → 401 JSON. Прямой заход на `/window`, `/kviz/*` → редирект на `/`. Внутри iframe своего входа нет — шлёт `postMessage({ type: 'auth-required' })`.
- Права в CRM: только admin — Настройки, скидки, смена цены, возвраты, бонусы, изменение остатка смены. Проверка прав — на сервере (`requireAdmin`).
- Rate limiter: 10 неудачных попыток по IP/логину за 15 мин → блокировка.

- **Тема оформления (задача 68.1–68.2):** `app_users.ui_theme` хранит `'light'` или `'dark'` (по умолчанию `'light'`). Сервер читает тему при рендере страниц и инжектирует `data-theme="dark"` в `<html>`. Раздел «Оформление» — в группе «Моё» меню Настроек, **доступен всем сотрудникам без прав** (единственный раздел без `permKey`). Если у сотрудника нет прав ни на один другой раздел, Настройки показывают только эту группу.
- **Окно «Сотрудники» в Настройках (решено 16.11.2026, чат «Логины»):** только админ. Добавить / удалить сотрудника, задать логин и пароль. Все старые пользователи `app_users` (Вера, Назерке, Ангелина, admin) показываются там же — это та же таблица, не новая.
- **Права по блокам и вкладкам внутри блока (16.11.2026):** при добавлении сотрудника админ отмечает, к каким блокам (верхние вкладки: Менеджер, Агент, Расписание, Клиенты, Воронка, Касса, Квалификация, Замеры, Отчёты, Настройки) и к каким вкладкам/разделам внутри каждого блока у него доступ. Блок виден, если открыта хотя бы одна его вкладка.
- **Доступ — 2 уровня на каждую вкладку:** «Просмотр» (видит) и «Изменение» (может менять). Нет ни одного — окно скрыто. Настраивает админ в карточке сотрудника. Проверка — на сервере, а не только скрытием кнопок.

- **Решения 16.11.2026 (чат «Логины»):**
  - Права должны быть удобными, но гибкими: дерево «блок → вкладки», галочка на блоке ставит/снимает всё внутри, у каждой вкладки «Просмотр» / «Изменение».
  - В Кассе отдельными строками: Возвраты, Скидки и смена цены, Бонусы — их можно дать конкретному сотруднику (раньше только админ).
  - Для вкладок с «своё / все» (Задачи, Смены, Контроль и т. п.) — третья галочка «Видит всех». Без неё сотрудник видит только своё.
  - Роль `admin` = всё открыто всегда, дерево прав у админа не редактируется.
  - Кнопка «Скопировать права с…» — новому сотруднику ставятся галочки как у выбранного.
  - Список блоков и вкладок — один справочник в коде; новая вкладка обязана туда добавляться (правило в CLAUDE.md).
  - Удаление: физически — только если за сотрудником нет записей, иначе «Уволен» (вход закрыт, история остаётся). Нельзя выключить себя и последнего админа.
  - Смена пароля или увольнение сразу закрывают все входы сотрудника (версия входа в токене), включая скриптолог.

- **Пerm-ключи формата `block.row` (task 56):** `manager.tasks`, `clients.phone`, `kassa.sale` и т.д. Для новой вкладки/отчёта/действия — ОБЯЗАТЕЛЬНО добавить в `PERM_CATALOG` (src/core/permissions.ts) и в пресеты нужных должностей. Серверные проверки: `const session = await getSessionWithPerms(req); if (!requirePerm(req, res, 'block.row', 'edit', session)) return;` (тип `session` автоматически сужается до `ExtendedSession` после проверки).

## Сделано
### 27.11.2026 · task 112 · Новое право settings.automation
- **`src/core/permissions.ts`**: `settings.automation` (Автоматизация воронок, row) в блоке `settings`. Добавлено в пресет `company_manager` (edit).

### 26.11.2026 · task 108Б · Новые права settings.client_tags и schedule.reschedule_future
- **`src/core/permissions.ts`**: `settings.client_tags` (Метки, row) в блоке `settings`; `schedule.reschedule_future` (Переносить на другой день, action, parent schedule.main) в блоке `schedule`. Добавлены в пресеты: `branch_manager` — edit; `company_manager` — view/edit соответственно.
- **`src/http/crm.ts`**: `GET/PATCH /client-auto-labels` используют `settings.client_tags`; `POST /schedule/bookings/:id/move` требует `schedule.reschedule_future` при переносе на другой день.

### 25.11.2026 · task 96 · Новые права kassa.closings и settings.kassa_passwords
- `src/core/permissions.ts`: добавлены `kassa.closings` (просмотр раздела «Закрытия кассы» в Отчётах) и `settings.kassa_passwords` (управление паролями кассы в Настройках). Добавлены в пресеты нужных должностей.
- `SettingsPage.tsx`: раздел «Пароли кассы» (Section `'kassa-passwords'`, Icon Lock) в группе «money»; `KassaPasswordsSection` с настройкой паролей sales/full/master, статусом блокировки и кнопкой разблокировки.

### 19.11.2026 · f7d896f · task 70 — Профиль и Выйти в Настройках

- `permContext.tsx`: добавлен `display_name: string` в `PermContextValue` и дефолт `''` в `createContext`.
- `App.tsx`: `display_name` хранится в state RequireAuth, передаётся в `PermContext.Provider`.
- `SettingsPage.tsx`: новый раздел «Профиль» (Section `'profile'`, Icon User) в группе «Моё» — без `permKey`, виден всем. `ProfileSection`: аватар-кружок с инициалом, имя, роль, кнопка «Выйти из учётки» (красная, `showConfirm` + POST /api/logout + `postMessage({ type:'logout' })` → оболочка делает `/login`). Синонимы 'профиль' и 'выйти' → 'profile'.

### 16.11.2026 · (task 56-1) · фикс роли админа в Сотрудниках, защита position_id
- **permContext.tsx**: добавлен хук `useRole(): string` — возвращает `role` из `PermContext`; отделяет получение роли от проверки прав.
- **StaffPage.tsx**: `const { role } = usePerm()` → `const role = useRole()` — `isAdmin` теперь корректен; добавлен стейт `positionsLoaded`; `loadPositions` вызывается всегда при маунте (сервер сам 403 для не-adminов); убрана `isAdmin`-зависимость useEffect; загрузка guard (`role === '' → Загрузка…`); `saveProfile` не шлёт `position_id` пока должности не загружены; красное предупреждение «Должность не задана» показывается только когда `positionsLoaded` или `!form.position_id` — иначе «Загрузка…».

### 16.11.2026 · 0dd46e9 · должности, права по каждой вкладке и отчёту, особые действия
- **permissions.ts** переписан: `PERM_CATALOG` — 10 блоков (manager/agent/schedule/clients/funnel/kassa/kviz/measure/reports/settings), ключи формата `block.row`, строки-действия (kind='action'), `hasSeeAll`. `POSITION_PRESETS` — 7 должностей с полными наборами прав.
- **auth.ts**: `ExtendedSession` добавлены `branch_id`/`all_branches`. `getSessionWithPerms` разрешает права: admin→всё, custom_permissions=false→из app_position_permissions, true→из app_user_permissions. `requirePerm` теперь type predicate (`session is ExtendedSession`). `invalidatePositionCache` — сброс кэша всех пользователей должности.
- **index.ts**: `seedPositionPresets()` — при старте заполняет права должностей если пусто; `cleanLegacyPermKeys()` — удаляет старые ключи `tab:*`/`cashier:*`.
- **shell.ts**: вкладка «Настройки» видна не только admin, но и всем со `settings.*` правами.
- **shell-app.js**: `TAB_BLOCK`, `canTab()` — префиксный поиск по блоку вместо точного ключа.
- **staff.ts** переписан: CRUD должностей (`/api/positions/*`, admin-only), CRUD сотрудников с `requireStaffAccess` (settings.staff для не-админа, но с ограничениями: только свой филиал, не трогает админов, не шире своих прав). `fire` и `logout-all` бампят auth_version.
- **StaffPage.tsx** переписан: 2 вкладки Сотрудники|Должности, `PermTree` со 3-сегментным switcher (Нет/Просмотр/Изменение) и галочками-действиями, `PositionDetail` с preset-сбросом.
- **crm.ts** (Part 7): `clients.phone` — маска телефона в GET /clients для без-прав; `clients.documents` — маска ИИН в GET /clients/:id; `clients.delete` — DELETE /clients/:id (было requireAdmin); `kassa.sale` — POST /checkout; `kassa.shift` — POST+PATCH /shifts; `kassa.refunds` — POST /refund (было requireAdmin).
- **measure.ts** (Part 7): `measure.delete` — DELETE /measurements/:id (было без auth).

### 16.11.2026 · (task 55) · окно Сотрудники, права по блокам, версия входа, журнал
- **auth.ts**: `TokenPayload.v` (auth_version в токене); старые токены без `v` невалидны → все входы сбрасываются при деплое. `getSessionWithPerms` — 30 с кэш, проверяет auth_version в БД. `checkLoginRate`/`writeLoginLog` — DB-based rate limiter вместо in-memory Map. `requireAdmin` и `requireAuth` централизованы (убраны дубликаты из 9 файлов). `invalidateUserCache` — сброс кэша при смене пароля/увольнении.
- **permissions.ts**: `PERM_CATALOG` — справочник блоков и вкладок (единственный источник истины). `DEFAULT_MANAGER_PERMISSIONS` — дефолтные права для новых менеджеров.
- **staff.ts**: CRUD сотрудников (создание, профиль, пароль, права, увольнение, восстановление, удаление, logout-all). Журнал входов (последние 100). Копирование прав.
- **shell.ts**: вход пишет в `app_login_log`, обновляет `last_login_at`. `window.SW_PERMS` инжектируется в оболочку перед `shell-app.js`.
- **shell-app.js**: `canTab()` / `applyPermissions()` — скрывают кнопки вкладок, кнопки выбора и боковые кнопки по правам; восстановление вкладки после перезагрузки учитывает права.
- **StaffPage.tsx**: полное окно управления сотрудниками в SettingsPage (раздел «Сотрудники» первым в NAV). Список, карточка, дерево прав, журнал входов.
- **permContext.tsx**: React `PermContext`, `usePerm()`, `useSeeAll()`.

### до 28.10.2026 · 20f59e9 · личные логины + rate limiter
- Личные логины `app_users`, роли admin / manager, rate limiter в памяти сервера.

### до 28.10.2026 · 948e2f0 · Bearer для скриптолога
- Bearer-токен для iframe расширения (cookie в iframe расширения Chrome ненадёжны).

## Открытые баги
- Деплой task 55 сбрасывает все активные сессии (токены без `v` невалидны) — ожидаемое поведение, предупредить сотрудников при деплое task 56.
- `kassa.bonus` — ключ в PERM_CATALOG есть, но оплата бонусами в checkout не реализована (бонусы — только balance-ops). Когда появится — добавить `requirePerm(kassa.bonus)` в `/kviz/api/crm/checkout`.

## Следующее
- Переназначить существующих сотрудников (Вера, Назерке, Ангелина) на должность «Администратор зала» (hall_admin) через UI должностей.
- Проверить, что для hall_admin права propagate корректно (position_presets засеяны при деплое).
- Пересечения: `fin_staff` (Финансы → сотрудники для зарплаты), «Сопоставление FB» и `staff_name_map` в Контроле — потом связать с `app_users`.
- Привязка к филиалам при мультифилиальности (branch_id/all_branches уже в схеме, нужно проверять в запросах).
- При появлении оплаты бонусами в checkout — добавить `requirePerm(req, res, 'kassa.bonus', 'edit', session)` перед обработкой платежей.
