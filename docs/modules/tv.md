# Модуль: ТВ (результаты студии)

Чат в claude.ai: «ТВ» · Файл: `docs/modules/tv.md`

## Назначение
Экран результатов студии для ТВ (`/results?key=…`): счётчики «Сантиметров убрали / Килограммов сбросили / Жира сожгли / клиенток с результатом», миссия студии. Инструменты для сотрудников: ссылка для ТВ (копирование, «открыть на весь экран»), выгрузка всех результатов в общий, отправка результата клиента.

## Где код
- `kviz/client/src/pages/ResultsPage.tsx` — ТВ-экран `/results?key=…` (flex 2-кол: счётчики слева 30%, карусель слайдов справа 70%)
- `src/http/tv.ts` — TV-роутер: SSE (`tvNotify`), прокси медиа, CRUD tv_settings/tv_results/tv_slides, загрузка фото
- `kviz/client/src/pages/crm/SettingsPage.tsx` → `TvSection` — настройки блоков, карточки «До/После», загрузка фото
- `kviz/client/src/pages/reports/ReportsPage.tsx` → `StudioSection` — ссылка для ТВ, счётчики, кнопка «Выгрузить все результаты»
- `kviz/client/src/pages/measure/ClientPage.tsx` — кнопка «Отправить в результаты студии» (внутри карточки клиента)
- `src/http/measure.ts` — `POST /kviz/api/measure/clients/:id/results` и `bulk-results`; вызывает `tvNotify()` после upsert
- `kviz/client/public/tv/` — статичные иконки (logo.png, sm.jpg, kg.png, fat.png, bodyr.png)

> Старый `/api/results/summary?key=...` и `/kviz/api/results/summary` (сессия) сохранены для совместимости в `src/http/kviz.ts`.

## Таблицы
- `studio_results` — результаты клиентов для ТВ: `client_id`, `cm_lost`, `kg_lost`, `fat_kg_lost`, `from_measure_no`, `to_measure_no` (оба nullable), `sent_by`, `sent_at`
- `studio_settings` — ключ-значение (миссия студии)
- `tv_settings` — одна строка (id=1): `main_label_cm`, `main_label_kg`, `main_label_fat` (прочие старые колонки не используются после task 46)
- `tv_results` — карточки «До/После» (библиотека): `id`, `title`, `before_path`, `after_path`, `position`
- `tv_slides` — слайды карусели: `id`, `position` (NOT NULL, unique), `kind` (result1|result2|promo|usp|**free**), `result_a` (uuid FK tv_results, nullable), `result_b` (uuid FK tv_results, nullable), `image_path` (nullable), `duration_sec` (default 8), `enabled` (default true), `layout` (jsonb, только для free), `created_at`

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты публичного ТВ-экрана и медиа-прокси

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты `/results?key=…`; URL открывается без входа в систему

## layout (kind = 'free')
JSON-схема: `{ frame: boolean, elements: [...] }` (до 12 элементов).
Элемент: `{ id: uuid, type: 'text'|'image', x, y, w, h (% области), z (0–50) }`.
Текстовый: `font` (6 вариантов), `size` (% высоты слайда), `weight` (400/600/800), `color` (#RRGGBB), `align`, `scaleX/scaleY` (0.5–2).
Картинка: `path` (free/<uuid>.jpg|png), `fit` (cover/contain/stretch).
Файлы картинок — в бакете `tv-media/free/`. Удаляются при сохранении нового layout (если убраны из элементов) и при удалении слайда.

## Где код
- `kviz/client/src/components/tv/FreeSlide.tsx` — общий компонент: позиционирует элементы, ResizeObserver для размеров, overflow-hint в preview-режиме

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Результаты студии — только **реальные** потери (не null, > 0). Клиенты только с InBody получают кг и жир; 0 см — норма (InBody-only, замеров тела нет).
- `from_measure_no` / `to_measure_no` в `studio_results` — nullable. `null` означает «у клиента нет замеров тела, только InBody».
- ТВ-экран защищён `RESULTS_DISPLAY_KEY` в query-параметре `key` — не требует входа в систему.
- Три блока цикла: `main` (счётчики+миссия), `results` (карточки до/после), `promo` (акция). Пропускаются если выключен или нет данных.
- Переходы между блоками: fade-out 400ms → смена → fade-in 400ms (CSS-анимация `.tv-block--exit/enter`).
- SSE `/api/tv/stream?key=...` — push-уведомление `event: changed` (после task 46, было `event: update`) при изменении данных. EventSource на клиенте переподключается автоматически.
- Медиа (tv_results, slides) — приватный бакет `tv-media`. Прокси: `/api/tv/media?path=...&key=...` (публичный с ключом) и `/kviz/api/tv/media?path=...` (сессия, для превью в настройках).
- Слайды хранятся в `tv_slides` (позиции 1..n без пробелов); position swap через temp=9999; DELETE ренумерует оставшиеся.
- Gradient border у `.tv-frame`: `background: ...padding-box, ...border-box; border: 2px solid transparent` (border-image не работает с border-radius).
- После task 46 блок «Акция» в настройках удалён — промо теперь добавляется как слайд типа `promo`.
- `/api/tv/data` возвращает `version: "2"` для различения от старого формата.
- Загрузка фото: клиент сжимает до 1600px JPEG 0.85 через canvas, отправляет base64. Сервер проверяет magic bytes (JPEG/PNG), сохраняет в бакет.
- Лимит тела для TV-маршрутов: `app.use('/kviz/api/tv', express.json({ limit: '12mb' }))` добавлен в `src/index.ts` до глобального `express.json()`.

## Мобильная версия
(нет отдельных задач; ResultsPage оптимизирована под большой экран ТВ)

## Сделано
### 12.11.2026 · (текущий) · task 47 — свободный блок слайда

- `src/http/tv.ts`: добавлен тип `free` в POST, валидация layout (validateLayout — шрифт, диапазоны, UUID), эндпоинт `POST .../free-image` (сохраняет `free/<uuid>.ext`), PATCH принимает `layout` целиком + удаляет из бакета картинки которые исчезли из нового layout, DELETE удаляет все файлы из `layout.elements`.
- `kviz/client/src/components/tv/FreeSlide.tsx` — новый общий компонент: ResizeObserver → `dim`, элементы position:absolute по %, текст с font/size/weight/color/align/scaleX/scaleY, картинка с objectFit, preview-режим: красная рамка + тултип если scrollHeight > clientHeight.
- `kviz/client/src/pages/ResultsPage.tsx`: TvSlide расширен (kind `free`, layout?: FreeLayout), в карусели free-слайд рендерится через FreeSlide с conditionally рамкой (frame: true → `.tv-frame` стили inline, false → без рамки), preload захватывает пути из layout.elements.
- `kviz/client/src/pages/crm/SettingsPage.tsx`: TvSlideRaw расширен, KIND_LABELS + 'free', AddSlideModal + опция «Свободный блок», FreeEditorModal (3-панели: слои + frame-toggle | preview с aspect-ratio 1.6:1 | свойства элемента — позиция/размер + замок W/H, текст/картинка все поля, замок scaleX/scaleY), кнопка «Редактировать» в строке слайда, мини-предпросмотр FreeSlide в строке, редактор открывается автоматически при создании free-слайда.
- `kviz/client/index.html`: Google Fonts для 6 семейств (Manrope, Montserrat, Oswald, Barlow Condensed, Playfair Display, Russo One) — display=swap. Внимание: Barlow Condensed не поддерживает кириллицу, для кирилличного текста выбирать другой шрифт.

### 11.11.2026 · (текущий) · task 46 — 2-колоночный экран, tv_slides, настройки переписаны

- `src/http/tv.ts` полностью переписан:
  - `tvNotify()` теперь шлёт `event: changed` (было `event: update`).
  - `GET /api/tv/data` возвращает `{ settings:{main_label_cm/kg/fat}, counters, mission, slides:[] }` — слайды обогащены объектами result_a/result_b.
  - `PUT /kviz/api/tv/settings` обновляет только метки счётчиков; вызывает `tvNotify()`.
  - Удалены эндпоинты `POST /kviz/api/tv/settings/promo-upload` и `DELETE /kviz/api/tv/promo`.
  - `DELETE /kviz/api/tv/results/:id` перед удалением проверяет использование в `tv_slides.result_a/result_b` → 409 с текстом «Карточка используется в слайде №N».
  - Новый CRUD `tv_slides`: GET/POST/PATCH/DELETE + `POST .../image`. POST загружает image_path для promo/usp. PATCH поддерживает position swap (3-шаговый через temp=9999 против unique-constraint). DELETE ренумерует оставшиеся слайды 1..n.
- `kviz/client/src/pages/ResultsPage.tsx` полностью переписан:
  - Новый layout: `<main class="tv-screen">` → `.tv-hdr` (лого, center) → `.tv-body` (`.tv-left` 30% + `.tv-right` 70%) → `.tv-ftr` (миссия center, время right, grid `1fr auto 1fr`).
  - Четыре типа слайдов: `result1` (одна карточка), `result2` (две карточки рядом), `promo/usp` (изображение).
  - SSE слушает `event: changed`. Fallback poll каждые 60 с. Слайды с упавшими картинками пропускаются (`failedIds`). Следующий слайд предзагружается через `new Image()`.
  - Анимация счётчиков работает только при изменении значений (`prevTargetRef`).
  - Slide transitions: exit 400ms, enter 600ms, `translateX` по горизонтали.
- `kviz/client/src/index.css` TV-секция полностью переписана:
  - `.tv-screen` (fixed inset:0), `.tv-body` (flex-row), `.tv-left/.tv-right`, `.tv-counters/.tv-counter`.
  - `.tv-frame` — градиентная рамка через `background-clip: padding-box / border-box`.
  - `.tv-res1/.tv-res2/.tv-img-slide` для трёх типов слайдов.
  - Анимации `tv-slide-out/in` + `tv-fade-only-out/in` для `prefers-reduced-motion`.
- `kviz/client/src/pages/crm/SettingsPage.tsx` TvSection переписан:
  - Убраны `TvSettings` (старая с promo/results fields), `ToggleRow` в TV-контексте.
  - Добавлены `TvSettingsLabels`, `TvSlideRaw`, `KIND_LABELS`, `AddSlideModal`.
  - Три блока: Счётчики (3 метки + Save), Слайды (список с duration/enabled/up/down/delete + AddSlideModal), Карточки (библиотека с 409 per-row).
  - Удалён блок «Акция».

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
- Barlow Condensed не поддерживает кириллицу — шрифт работает только для латинского текста.

## Следующее
- Добавить SSE heartbeat (25с `comment:` строка) чтобы Render не закрывал idle-соединения.
- Проверить layout на 1920×1080, 1366×768, 1280×720, 1024×768, 3840×2160 после деплоя.
- В AddSlideModal нет предпросмотра загруженного изображения для promo/usp — можно добавить по желанию.
- Для result1/result2 слайдов в настройках нет редактирования после создания (нельзя сменить карточку) — сейчас надо удалить и добавить заново.
- Перетаскивание элементов мышью в редакторе free-слайда — не реализовано, позиция задаётся числами.
