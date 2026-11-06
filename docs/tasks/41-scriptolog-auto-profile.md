Модуль: scriptolog

# Задача 41 — Скриптолог: EasyChat-интеграция, автопрофиль, напоминания

## Контекст

Задачи 39, ч.6–7 были реализованы формально, но фактически не работают:
- `src/jobs/scriptologReminders.ts` читает несуществующие колонки (`text`, `text_kk`, `scheduled_at`, `client_id`, `sent_at`); реальные колонки: `due_at`, `client_key`, `done_at`.
- Напоминания не создаются из Fitbase (только обрабатываются), EasyChat не вызывается.
- `/api/scriptolog/confirm` пишет `event_type: 'confirm'` (нет в check), не отменяет `trial_*`, нет watch_alerts.

Задача 41 — полная реализация EasyChat-интеграции, автопрофиля клиентки и умных напоминаний.

---

## Часть 0 — Подготовка

- Прочитать `docs/STATE.md`, `docs/modules/scriptolog.md`, `docs/QUEUE.md`.
- `docs/modules/scriptolog.md` закоммитить первым отдельным коммитом: `docs: scriptolog — API EasyChat (проверено 05–06.11)`.
- Сохранить это ТЗ в `docs/tasks/41-scriptolog-auto-profile.md`.
- Добавить задачу 41 в `docs/QUEUE.md` со статусом `🔧 в работе`. Задачу 39 перевести в `🟡 частично (ч.6–7 переделаны в 41)`.
- Проверить схемы таблиц: `script_settings`, `script_reminders`, `script_materials`, `script_clients`, `watch_alerts`.
- Правило: `docs/modules/control.md` — чужой, НЕ трогать. При конфликте `git stash` только его, после работы `git stash pop`.

---

## Часть 1 — EasyChat API-клиент (`src/core/easychat.ts`)

Создать новый файл. Всё общение с EasyChat через него.

Базовый URL: `https://chat_api.easychat.ru/v1`
Заголовок: `Authorization: <token>` — БЕЗ «Bearer».
Токен — из `script_settings` по ключу `easychat_token`.

### Функции

```typescript
// Получить токен из базы (или null если не задан)
export async function getEasyChatToken(): Promise<string | null>

// Список диалогов (пагинация, до maxPages страниц по pageSize)
export async function listDialogues(token: string, page?: number, pageSize?: number): Promise<EasyDialogue[]>

// Найти диалог по Fitbase client_id (crm_client_id в EasyChat)
export async function findDialogueByFitbaseClient(token: string, fitbaseClientId: number): Promise<EasyDialogue | null>

// Запланировать отложенное сообщение (send_at — unix секунды)
// Если DRY — только лог, возвращает fake id 0
export async function scheduleMessage(token: string, dialogueId: number, text: string, sendAt: number, fileUrl?: string): Promise<number>

// Список отложенных сообщений диалога
export async function listDelayed(token: string, dialogueId: number): Promise<EasyDelayed[]>

// Удалить отложенное сообщение
export async function deleteDelayed(token: string, delayedId: number): Promise<void>

// Добавить комментарий к диалогу
export async function addComment(token: string, dialogueId: number, text: string, isPinned?: boolean): Promise<number>

// Удалить комментарий
export async function deleteComment(token: string, commentId: number): Promise<void>

// Загрузить файл
export async function uploadFile(token: string, dialogueId: number, fileBuffer: Buffer, filename: string, contentType: string): Promise<{ file_id: number; file_url: string }>
```

### Типы

```typescript
interface EasyDialogue {
  dialogue_id: number;
  name: string;
  crm_client_id: number | null;
  unread_count: number;
  last_message: {
    message: string;
    operator_id: number | null;
    created_at: string;
  } | null;
}

interface EasyDelayed {
  delayed_message_id: number;
  dialogue_id: number;
  message_text: string;
  send_at: number;
  status: number; // 1 = pending
}
```

### Поведение при DRY

`EASYCHAT_DRY_RUN=true` по умолчанию. В DRY-режиме:
- `scheduleMessage`, `deleteDelayed`, `addComment`, `deleteComment`, `uploadFile` → только `console.log`, не вызывают API.
- `listDialogues`, `findDialogueByFitbaseClient`, `listDelayed` → работают (чтение, не пишем).
- Возвращают заглушку (0 / пустой массив / null как нужно).

### Ограничение вызовов

Пауза 300 мс между запросами к EasyChat (не злоупотреблять). Не ретраить 4xx.

---

## Часть 2 — Токен из расширения

### В расширении

**`extension/easychat.js`** — добавить в `init()`:
```js
// Читаем EasyChat token из URL текущего фрейма (chat.easychat.ru)
const params = new URLSearchParams(window.location.search);
const token = [...params.values()].find(v => /^[a-zA-Z0-9_-]{18,24}$/.test(v));
if (token) chrome.runtime.sendMessage({ type: 'easychat-token', token });
```

**`extension/background.js`** — обработать сообщение:
```js
if (msg.type === 'easychat-token') {
  chrome.storage.local.get(['easychatToken'], (data) => {
    if (data.easychatToken !== msg.token) {
      chrome.storage.local.set({ easychatToken: msg.token });
    }
  });
  return;
}
```

**`extension/sidepanel.js`** — при изменении storage отправить токен на сервер:
```js
if (changes.easychatToken) {
  const token = changes.easychatToken.newValue;
  if (token) sendTokenToServer(token);
}
// + вызвать sendTokenToServer при sendStateToPage если токен уже есть
```

`sendTokenToServer(token)`: `fetch('/api/scriptolog/easychat-token', {method:'POST', headers:{'Content-Type':'application/json', 'Authorization': 'Bearer '+authToken}, body: JSON.stringify({token})})` — authToken из storage.

**Не выводить токен в лог, ответ и интерфейс.** Только «есть / обновлён в HH:MM DD.MM».

### На сервере

**`POST /api/scriptolog/easychat-token`** (требует auth):
```
body: { token: string }
```
Сохранить в `script_settings` (`upsert` by key):
```sql
upsert { key: 'easychat_token', value: token, updated_at: now(), updated_by: session.display_name }
```
Ответ: `{ ok: true, updated_at: '...' }`. Токен в ответ не включать.

**`GET /api/scriptolog/settings/token-status`** (требует auth):
Ответ: `{ has_token: boolean, updated_at: string | null, updated_by: string | null }` — без самого токена.

### В интерфейсе

В `SettingsPage.tsx` секция «Скриптолог», подсекция «EasyChat-токен»:
- Строка «Токен: есть, обновлён в 14:32 06.11.2026 (Сергей)» или «Токен не задан».
- Кнопка «Обновить» рядом — открывает инструкцию: «Перезагрузите расширение в Chrome (chrome://extensions → ↺)».
- Инструкция в `extension/README.md`.

---

## Часть 3 — Автопрофиль клиентки

**`POST /api/scriptolog/profile`** (требует auth):
```
body: { client_id: string, fitbase_client_id?: number }
```

Шаги:
1. Загрузить `script_clients` по `client_id` (получить текущий `vars` и `fitbase_client_id`).
2. Если `fitbase_client_id` — загрузить клиента из Fitbase: `GET /client/{id}`.
3. Извлечь поля:
   - `{Имя}` — `client.name` (или first_name + last_name)
   - `{Возраст}` — из `birthday` (дата рождения → полных лет)
   - `{Рост}` и `{Вес}` — из Fitbase client profile если есть
   - `{ИМТ}` — посчитать если есть Рост и Вес
4. Загрузить последние визиты: из `fitbase_visits` по `client_fitbase_id`, фильтр `is_trial=false`, `status=3` (пришла), `order by visit_at desc limit 10`.
5. Извлечь `{Время1}` и `{Время2}` — самые частые слоты (ЧЧ:ММ из `visit_at`).
6. Загрузить активные контракты: `fitbase_contracts` по `client_fitbase_id`, самый ближний `end_date` → `{Окончание абонемента}`.
7. `{Менеджер}` — из сессии (session.display_name).

Для каждого поля, которое удалось заполнить: записать в `vars[KEY]` и `vars[KEY+'_src'] = 'auto'`.
Не перезаписывать поля, у которых нет суффикса `_src` (пользователь вводил вручную).

Ответ: `{ updated: string[] }` — список заполненных ключей.

**В панели** (`public/scriptolog.html`): у каждого поля переменной добавить мелкий серый лейбл «авто» если `vars[KEY+'_src'] === 'auto'`. Кнопка «🔄 Автопрофиль» в блоке клиентки → вызывает `POST /api/scriptolog/profile`.

---

## Часть 4 — Парсер ответа клиентки

**`src/core/scriptologParse.ts`** — чистый модуль, без HTTP:

```typescript
interface ParseResult {
  field: string;      // 'Имя' | 'Возраст' | 'Рост' | 'Вес' | 'Цель' | 'Опыт' | 'Почему не подошло'
  value: string;
  confidence: 'sure' | 'guess';
}

export function parseClientReply(text: string): ParseResult[]
```

Правила парсинга:
- **Имя**: первое слово с заглавной буквы, 2–15 символов, только кириллица — `sure`; числа не в имени.
- **Возраст**: число 15–80 (само по себе или после «мне», «лет», «год») — `sure`; просто число 15–80 в тексте без других чисел — `guess`.
- **Рост**: число 140–210 (само по себе или со «см», «рост») — `sure`; или первое число в диапазоне в тексте — `guess`.
- **Вес**: число 40–200 (со «кг», «вес» или после роста) — `sure`; второе большое число — `guess`.
- **Цель**: keywords: «похудеть», «сбросить», «фигура», «живот», «накачать», «тонус», «здоровье» и их казахские аналоги — `sure`.
- **Опыт** (тренировки): «нет опыта», «первый раз», «не занималась», «занималась», «хожу», «ходила», «зал», «лет X» — `sure`.
- **Почему не подошло**: «дорого», «не подошло», «далеко», «не понравилось», «результата нет», «не смогла», «закончила» — `sure`.

**`POST /api/scriptolog/parse`** (требует auth):
```
body: { text: string }
response: ParseResult[]
```

---

## Часть 5 — Умные напоминания (полная перезапись `src/jobs/scriptologReminders.ts`)

Запускается каждые 5 мин, окно 07:00–22:00 Yekaterinburg.

### Алгоритм

1. Получить токен EasyChat из `script_settings`. Если нет — `{ status: 'skipped', reason: 'no easychat token' }`.
2. Загрузить все диалоги EasyChat (до 10 страниц × 50): создать `Map<number, EasyDialogue>` по `crm_client_id`.
3. Загрузить будущие пробные визиты из Fitbase:
   ```
   GET /visit?date_from=сегодня&date_to=послезавтра&page_size=100
   ```
   Фильтр: только `is_trial = true` (по service name из `TRIAL_SERVICE_NAMES` и training.id=16), статус НЕ 2 (отказ) и НЕ 4 (не пришла).
4. Для каждого визита:
   a. `visitAt` = unix timestamp начала визита (из `event.date` + `event.time_start`, часовой пояс UTC+5).
   b. Нужные моменты отправки: `24h = visitAt - 86400`, `3h = visitAt - 10800`, `1h = visitAt - 3600`.
   c. Скорректировать ночное окно: если час UTC (sendAt) < 2 (< 07:00 YEK) или >= 17 (>= 22:00 YEK) → сдвинуть на 04:00 UTC (09:00 YEK) следующего дня.
   d. Пропустить если `sendAt < now()`.
   e. Найти диалог по `crm_client_id = visit.client_id`.
   f. Если диалог не найден — `console.warn`, продолжить.
   g. Проверить `script_reminders` на дубль: `dedupe_key = 'trial_24h:{fitbase_visit_id}'` и т.д.
   h. Если запись есть со статусом `pending` или `sent` — пропустить.
   i. Иначе — создать delayed message в EasyChat, записать в `script_reminders`.
5. Для визитов со статусом 2 (отказ): найти pending reminders в `script_reminders`, удалить delayed messages, обновить `status = 'cancelled'`.
6. Для визитов со статусом 1 (подтверждён): найти pending reminders за 1ч и 3ч, удалить delayed messages (24ч оставить), обновить `status = 'cancelled'`.

### Тексты напоминаний (из `docs/sales-tree-v2-draft.md` этап 6)

Русский (`lang = 'ru'`):
- `trial_24h`: «Здравствуйте, {Имя}! 🌸 Напоминаем, завтра {Время} ждём Вас на пробное посещение в SlimWay 💚 🎁 И не забудьте: замер InBody — Вам в подарок!»
- `trial_3h`: «Здравствуйте! Через 3 часа начинается Ваше пробное посещение. Для подтверждения отправьте нам «+» 👇🏻🌸»
- `trial_1h`: «{Имя}, ждём Вас через час 🌸 Подтвердите, пожалуйста, что всё в силе: отправьте «+» 👇🏻»

Казахский (`lang = 'kk'`):
- `trial_24h`: «Сәлеметсіз бе, {Имя}! 🌸 Ертең {Время} сізді SlimWay-дегі сынақ сабағына күтеміз 💚 🎁 Ұмытпаңыз: InBody өлшеуі — сізге сыйлық!»
- `trial_3h`: «Сәлеметсіз бе! 3 сағаттан кейін сынақ сабағыңыз басталады. Растау үшін «+» жіберіңіз 👇🏻🌸»
- `trial_1h`: «{Имя}, бір сағат кейін күтеміз 🌸 Барлығы жоспарда екенін «+» жіберіп растаңыз 👇🏻»

Язык (`lang`) — из `vars.lang` клиента; если нет — `'ru'`.

Подстановка `{Имя}` и `{Время}` — из `vars` клиента и из визита (`event.time_start` → ЧЧ:ММ).

### Запись в `script_reminders`

```typescript
{
  client_key: клиентский client_key из script_clients (ищем по fitbase_client_id),
  kind: 'trial_24h' | 'trial_3h' | 'trial_1h',
  status: 'pending',
  lang: 'ru' | 'kk',
  dedupe_key: `trial_24h:${fitbase_visit_id}`,
  due_at: ISO timestamp когда надо отправить,
  send_at: ISO timestamp реальной отправки (может быть сдвинута из-за ночного окна),
  message_text: финальный текст с подстановками,
  fitbase_visit_id: String(visit.id),
  easychat_delayed_id: id из EasyChat (или null если DRY),
  easychat_dialogue_id: dialogue_id,
}
```

---

## Часть 6 — Автоподтверждение

В той же задаче (`runScriptologReminders`), после шага планирования.

Для каждого диалога, у которого есть pending `trial_1h` или `trial_3h` reminder:
1. Проверить `dialogue.last_message`:
   - `operator_id === null` (клиент написал, не оператор)
   - Текст содержит согласие: `+`, `да`, `ок`, `окей`, `приду`, `буду`, `хорошо`, `помню`, `иду`, `yes`, `иә`, `ия`, `келемін`, `барамын`, `жарайды` (регистронезависимо, trim)
   - `created_at` последнего сообщения > `send_at` напоминания trial_3h (клиент ответил ПОСЛЕ напоминания)
2. Если согласие обнаружено:
   - Пометить все `trial_*` reminders для этого визита как `cancelled`
   - Удалить оставшиеся delayed messages в EasyChat
   - `SCRIPTOLOG_CONFIRM_DRY_RUN=true` по умолчанию:
     - В DRY: `console.log('[confirm] DRY: подтверждение {Имя} для визита {id}')`
     - В PROD: вызвать Fitbase API `PATCH /visit/{id}` с `status=1` (подтверждён). **Пока не выполнять — Fitbase API не верифицирован. Написать в `docs/reports/fitbase-registration-confirm-probe.md`.**
   - Создать `watch_alert` (тип `script_confirm`):
     ```json
     { "rule": "SCRIPT_CONFIRM", "level": "info", "short_name": "{Имя}", "title": "Подтвердила пробное", "body": "{Имя} ответила «{текст}» → пробное {дата} {время}", "meta": { "fitbase_visit_id": "..." } }
     ```
   - Добавить комментарий в EasyChat: `[СКРИПТОЛОГ] ✅ Подтвердила пробное на {дата} {время}`

3. Если отказ (`нет`, `не приду`, `отменить`, `отмена`, `жоқ`, `кела алмаймын`):
   - Создать `watch_alert` с `rule: 'SCRIPT_CANCEL'`, `level: 'warn'`.
   - Не отменять запись в Fitbase (только уведомить).

---

## Часть 7 — Материалы клиентке

### Загрузка файлов в EasyChat

Новый эндпоинт: **`POST /api/scriptolog/materials/:key/send`** (требует auth):
```
body: { client_id: string }
```

1. Загрузить материал из `script_materials` по `key`.
2. Если `easychat_file_url` уже есть — использовать его.
3. Иначе: скачать файл (из Storage или по URL), загрузить в EasyChat `/v1/file`, сохранить `easychat_file_url` и `easychat_file_at`.
4. Загрузить клиента, найти его диалог в EasyChat.
5. Запланировать отложенное сообщение с `file_url` на «через 1 минуту» (send_at = now + 60).
6. Ответ: `{ ok: true, dry: boolean, file_url: string }`.

**Обработка Google Drive URL**: если URL содержит `drive.google.com`, преобразовать в прямую ссылку скачивания: `https://drive.google.com/uc?export=download&id={FILE_ID}`.

### В панели (`public/scriptolog.html`)

В блоке клиентки: кнопки «Отправить» рядом с каждым материалом (видео, памятка, 2ГИС и т.п.) → вызывают `POST /api/scriptolog/materials/:key/send`.

---

## Часть 8 — Анкета клиентки в EasyChat

### EasyChat-комментарий

После заполнения ключевых переменных (этапы 2, 4, 5) — автоматически обновить комментарий в EasyChat:

**`POST /api/scriptolog/questionnaire`** (требует auth):
```
body: { client_id: string }
```

Формирует текст:
```
[СКРИПТОЛОГ] Анкета:
Имя: {Имя}
Цель: {Цель}
Рост/Вес: {Рост} см / {Вес} кг → ИМТ {ИМТ}
Опыт: {Опыт}
Время: {Время1}, {Время2}
Окончание абонемента: {Окончание абонемента}
Менеджер: {Менеджер}
```

Только заполненные поля. Если комментарий уже есть (`[СКРИПТОЛОГ] Анкета:`) — удалить старый и создать новый.

Ответ: `{ ok: true, dry: boolean }`.

### В панели

Кнопка «📋 Анкета в EasyChat» в блоке клиентки → `POST /api/scriptolog/questionnaire`.

### Менеджер: «Пробные сегодня»

Новый блок в `ManagerPage.tsx`, видимый всем авторизованным.

**`GET /kviz/api/manager/trials-today`** — возвращает:
```typescript
interface TrialToday {
  fitbase_visit_id: string;
  client_name: string | null;
  visit_time: string; // "09:00"
  status: number;    // 0=записан, 1=подтверждён, 3=пришла
  reminder_status: 'none' | 'pending' | 'sent' | 'cancelled';
  confirmed: boolean;
}
```

Данные из `fitbase_visits` (is_trial=true, visit_date=today, статус не 2/4) + join с `script_reminders` (dedupe_key like `trial_24h:%`).

Блок в ManagerPage: «🧪 Пробные сегодня» — список строк: «ЧЧ:ММ Имя — ✅ Подтвердила / ⏳ Ждём / 🔔 Напоминание запланировано».

---

## Часть 9 — Панель: список напоминаний

В `public/scriptolog.html`, аккордеон этапа 6 (подтверждение «+»):

- Новая вкладка / секция «📅 Напоминания» (показывается если есть `fitbase_client_id`).
- Загрузка: `GET /api/scriptolog/reminders?fitbase_client_id={id}`.
- Список напоминаний: иконка времени, тип (24ч/3ч/1ч), дата отправки, статус (pending/sent/cancelled).
- Для `pending`: кнопка «✕» (удалить) → `DELETE /api/scriptolog/reminders/:id`.
- Если хотя бы один reminder `trial_*` имеет `status = 'sent'` и клиент подтверждён (`confirmed_trial`) — зелёный бейдж «✅ Подтвердила» в заголовке этапа 6.

Новые эндпоинты:
- `GET /api/scriptolog/reminders?fitbase_client_id={id}` — список `script_reminders` по `fitbase_visit_id` через `fitbase_visits.client_fitbase_id`.
- `DELETE /api/scriptolog/reminders/:id` — отменить напоминание: удалить delayed message из EasyChat, обновить `status = 'cancelled'`.

---

## Часть 10 — Финал

1. `npm run check-tree` — ✅ без ошибок.
2. `npm run build` — ✅ без ошибок TypeScript.
3. `npm run check:mobile` — ✅.
4. Тестовый DRY-прогон: `GET /run/scriptolog-reminders` с `EASYCHAT_DRY_RUN=true`.
5. Обновить `docs/modules/scriptolog.md`, `docs/STATE.md`, `docs/QUEUE.md`.
6. Коммит и пуш.
7. Дождаться деплоя.
8. Проверить на проде: EasyChat-токен, статус токена в Настройках, DRY-прогон.

### Новые env в Render

```
EASYCHAT_DRY_RUN=true
SCRIPTOLOG_CONFIRM_DRY_RUN=true
```

### Новое расписание cron-job.org

- `/run/scriptolog-reminders` — каждые **5 минут**, 07:00–22:00 Yekaterinburg.
  (Уже добавлено с 15 мин — изменить интервал на 5 мин.)

### Файл `docs/reports/fitbase-registration-confirm-probe.md`

Создать при реализации Part 6. Содержание:
- Дата исследования
- Эндпоинт кандидат: `PATCH /visit/{id}` → `{"status": 1}`
- Статус: НЕ верифицировано (нет доступа к тест-визиту)
- Что нужно проверить: `PATCH /visit/{id}` → успешный ответ → `status = 1` в Fitbase
- `SCRIPTOLOG_CONFIRM_DRY_RUN=false` устанавливать только после проверки
