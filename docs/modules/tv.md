# Модуль: ТВ (результаты студии)

Чат в claude.ai: «ТВ» · Файл: `docs/modules/tv.md`

## Назначение
Экран результатов студии для ТВ (`/results?key=…`): счётчики «Сантиметров убрали / Килограммов сбросили / Жира сожгли / клиенток с результатом», миссия студии. Инструменты для сотрудников: ссылка для ТВ (копирование, «открыть на весь экран»), выгрузка всех результатов в общий, отправка результата клиента.

## Где код
- `kviz/client/src/pages/ResultsPage.tsx` — ТВ-экран `/results?key=…` (3-блочный цикл: счётчики / до-после / акция)
- `src/http/tv.ts` — TV-роутер: SSE (`tvNotify`), прокси медиа, CRUD tv_settings/tv_results, загрузка фото
- `kviz/client/src/pages/crm/SettingsPage.tsx` → `TvSection` — настройки блоков, карточки «До/После», загрузка фото
- `kviz/client/src/pages/reports/ReportsPage.tsx` → `StudioSection` — ссылка для ТВ, счётчики, кнопка «Выгрузить все результаты»
- `kviz/client/src/pages/measure/ClientPage.tsx` — кнопка «Отправить в результаты студии» (внутри карточки клиента)
- `src/http/measure.ts` — `POST /kviz/api/measure/clients/:id/results` и `bulk-results`; вызывает `tvNotify()` после upsert
- `kviz/client/public/tv/` — статичные иконки (logo.png, sm.jpg, kg.png, fat.png, bodyr.png)

> Старый `/api/results/summary?key=...` и `/kviz/api/results/summary` (сессия) сохранены для совместимости в `src/http/kviz.ts`.

## Таблицы
- `studio_results` — результаты клиентов для ТВ: `client_id`, `cm_lost`, `kg_lost`, `fat_kg_lost`, `from_measure_no`, `to_measure_no` (оба nullable), `sent_by`, `sent_at`
- `studio_settings` — ключ-значение (миссия студии)
- `tv_settings` — одна строка (id=1): настройки трёх блоков (`main_*`, `results_*`, `promo_*`), `promo_image_path`
- `tv_results` — карточки «До/После»: `id`, `title`, `before_path`, `after_path`, `position`

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты публичного ТВ-экрана и медиа-прокси

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты `/results?key=…`; URL открывается без входа в систему

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Результаты студии — только **реальные** потери (не null, > 0). Клиенты только с InBody получают кг и жир; 0 см — норма (InBody-only, замеров тела нет).
- `from_measure_no` / `to_measure_no` в `studio_results` — nullable. `null` означает «у клиента нет замеров тела, только InBody».
- ТВ-экран защищён `RESULTS_DISPLAY_KEY` в query-параметре `key` — не требует входа в систему.
- Три блока цикла: `main` (счётчики+миссия), `results` (карточки до/после), `promo` (акция). Пропускаются если выключен или нет данных.
- Переходы между блоками: fade-out 400ms → смена → fade-in 400ms (CSS-анимация `.tv-block--exit/enter`).
- SSE `/api/tv/stream?key=...` — push-уведомление `event: update` при изменении studio_results. EventSource на клиенте переподключается автоматически.
- Медиа (tv_results, promo) — приватный бакет `tv-media`. Прокси: `/api/tv/media?path=...&key=...` (публичный с ключом) и `/kviz/api/tv/media?path=...` (сессия, для превью в настройках).
- Загрузка фото: клиент сжимает до 1600px JPEG 0.85 через canvas, отправляет base64. Сервер проверяет magic bytes (JPEG/PNG), сохраняет в бакет.
- Лимит тела для TV-маршрутов: `app.use('/kviz/api/tv', express.json({ limit: '12mb' }))` добавлен в `src/index.ts` до глобального `express.json()`.

## Мобильная версия
(нет отдельных задач; ResultsPage оптимизирована под большой экран ТВ)

## Сделано
### 11.11.2026 · (текущий) · task 45 — иконки через Vite-import, вёрстка карточек

- `kviz/client/src/assets/tv/`: добавлены sm.png, kg.png, fat.png, logo.png (копия из `img/`).
- `ResultsPage.tsx`: импорт четырёх иконок вместо `${BASE}tv/...`; `const BASE` удалён — теперь Vite добавляет хеш в имена файлов при сборке (например `sm-CjauMTJY.png`), кэш браузера инвалидируется автоматически при изменении файла.
- `kviz/client/public/tv/` удалена полностью.
- `index.css`: `.tv-mid` padding → `clamp(24px,4vw,96px)`; `.results-counters` gap → `clamp(16px,2vw,40px)`; `.tv-icon-img` высота → `clamp(48px,9vh,120px)`, ширина → `auto`; добавлен `white-space: nowrap` на `strong`, `span`, `small` внутри `.results-counter`.

### 11.11.2026 · 2ad02b3 · task 44 — UUID-имена файлов, immutable-кэш, ошибки загрузки под блоком

- `src/http/tv.ts`: `promo-upload` теперь генерирует имя `promo/<uuid>.ext` (без `upsert`); читает старый `promo_image_path` до загрузки, удаляет после успешного update (async, ошибку только в `console.error`); вызывает `tvNotify()`. Аналогично `uploadResultImg`: `results/<uuid>.ext`, старый `${side}_path` удаляется после update, `tvNotify()`. `proxyMedia` принимает параметр `cacheImmutable`: публичный прокси `/api/tv/media` → `Cache-Control: public, max-age=31536000, immutable`; админский `/kviz/api/tv/media` → `no-cache`. Ошибки Storage/Postgres только в `console.error`, пользователю — русский текст.
- `SettingsPage.tsx`: добавлены state `promoErr` и `resultErr: Record<string, string>`; ошибки загрузки акции отображаются под блоком «Акция» (не в верхнем баннере `err`); ошибки загрузки фото результата — под соответствующей карточкой.

### 11.11.2026 · 3817365 · task 43 дополнение — fixed-screen, логотип/миссия, Заменить/Удалить акцию, перенос выгрузки и миссии

- `ResultsPage.tsx` переписан: `position: fixed; inset: 0; overflow: hidden` на `.results-screen`; body/html получают класс `tv-page` через useEffect; `.tv-block` = `grid-template-rows: auto 1fr auto` (`.tv-top` лого / `.tv-mid` контент / `.tv-bot` миссия+дата). Лого сверху по центру на всех блоках. Миссия снизу по центру на всех блоках. Дата+время `ДД.ММ.ГГГГ ЧЧ:ММ` (Asia/Almaty) — только на главном блоке, снизу справа, обновляется каждые 10 с. `Math.round` вместо `toFixed(1)`. Убран счётчик «Клиенток с результатом» и 4-й элемент массива `values`.
- `index.css`: удалены `min-height`, `overflow-y: auto`, `.results-header/.results-logo/.results-mission/.results-footer`; добавлены `.tv-page`, `.tv-top/.tv-mid/.tv-bot`, `.tv-logo/.tv-mission/.tv-datetime`; все размеры через `clamp()`/`vh`/`vw`.
- `src/http/tv.ts`: добавлен `DELETE /kviz/api/tv/promo` — удаляет файл из бакета, пишет `null` в `tv_settings.promo_image_path`, вызывает `tvNotify()`.
- `SettingsPage.tsx` TvSection: кнопки «Заменить» (file input) + «Удалить» (inline-confirm) рядом с миниатюрой акции; добавлены `deletePromo` функция и `confirmDelPromo` state; в конце секции — `<BulkResultsSection />` + `<MissionSection />`.
- `SettingsPage.tsx` ServiceSection: удалены вкладки `'bulk'` и `'mission'`.
- `ReportsPage.tsx`: удалены мёртвые функции `MissionSection` и `BulkResultsSection` (нигде не вызывались).
- `AdminPage.tsx`: удалены вкладка «Результаты студии», state `mission/resultsUrl/missionSaved`, callback `loadMission`, функция `saveMission`.

### 11.11.2026 · 4f24b48 · task 43 — 3-блочный цикл, до/после, акция, SSE, настройки

- Новый `src/http/tv.ts`: `tvNotify()` (SSE push), `GET /api/tv/data`, `GET /api/tv/stream`, `GET /api/tv/media` (публичные, ключ), `GET/PUT /kviz/api/tv/settings`, `POST /kviz/api/tv/settings/promo-upload`, полный CRUD `tv_results`, `before-upload`/`after-upload` с валидацией magic bytes, `GET /kviz/api/tv/media` (сессия).
- `src/index.ts`: лимит 12mb для `/kviz/api/tv`; импорт `buildTvRouter`.
- `src/http/kviz.ts`: `app.use(buildTvRouter())`.
- `src/http/measure.ts`: `tvNotify()` после upsert в `/clients/:id/results` и `/bulk-results`.
- `kviz/client/public/tv/`: logo.png, sm.jpg, kg.png, fat.png, bodyr.png.
- `ResultsPage.tsx` переписан: `getBlocks()` → цикл `main/results/promo` с fade-анимацией; `MainBlock` (иконки из `/tv/`), `ResultsBlock` (сетка карточек с медиа-прокси), `PromoBlock`; SSE подключение; анимация счётчиков сохранена.
- `SettingsPage.tsx`: `TvSection` с редактором настроек трёх блоков + CRUD карточек + загрузка фото (canvas compress + base64 POST).
- `index.css`: `.tv-block--exit/enter` (fade-анимации), `.tv-cards`, `.tv-card`, `.tv-card-side`, `.tv-card-label`, `.tv-promo`, `.tv-icon-img`, мобильная адаптация ≤760px.

### 29.10.2026 · (текущий) · фикс from/to_measure_no в studio_results (задача 17)
- `calcAllResults` (`src/http/inbody.ts`): добавлены `from_measure_no` / `to_measure_no` в каждую строку upsert — первый и последний `measure_no` замеров клиента, `null` если замеров нет.
- `POST /kviz/api/measure/clients/:id/results`: заменены хардкод `from_measure_no: 1, to_measure_no: 0` на реальные номера (или `null`).
- Ошибки upsert: лог в `console.error`, пользователю — «Не удалось сохранить результаты студии, попробуйте ещё раз».
- `ClientPage.tsx` `StudioResult`: тип `from_measure_no: number | null`, `to_measure_no: number | null`.

### до 28.10.2026 · c7cb5ae · результаты студии, счётчики ТВ, bulk (задача 10)
- «Выгрузить все результаты в общий» (bulk), счётчики студии на ТВ-экране.
- `StudioSection` в ReportsPage: ссылка для ТВ, fullscreen.

## Открытые баги
- (нет)

## Следующее
- Добавить SSE heartbeat (25с комментарий) чтобы Render не закрывал idle-соединения.
- Автопролистывание страниц в ResultsBlock если карточек больше results_show_count (сейчас показываются только первые).
- Проверить scrollHeight === clientHeight на 1920×1080, 1366×768, 1280×720, 1024×768, 3840×2160 после деплоя.
