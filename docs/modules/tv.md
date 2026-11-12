# Модуль: ТВ (результаты студии)

Чат в claude.ai: «ТВ» · Файл: `docs/modules/tv.md`

## Назначение
Экран результатов студии для ТВ (`/results?key=…`): счётчики «Сантиметров убрали / Килограммов сбросили / Жира сожгли / клиенток с результатом», миссия студии. Инструменты для сотрудников: ссылка для ТВ (копирование, «открыть на весь экран»), выгрузка всех результатов в общий, отправка результата клиента.

## Где код
- `kviz/client/src/pages/ResultsPage.tsx` — ТВ-экран `/results?key=…`: загружает `screen_layout` v2 из `/api/tv/data`, анимирует счётчики, рендерит `TvScreen` с carousel-слотом
- `kviz/client/src/components/tv/TvScreen.tsx` — рендерит v2 `ScreenLayout`: 7 типов элементов (text/value/mission/datetime/image/shape/carousel), абсолютное позиционирование %, `--screen-h` CSS-var, поворот через transform
- `kviz/client/src/components/tv/TvScreenEditor.tsx` — полноэкранный редактор (~500 строк): 8 ручек ресайза + ручка поворота (snap 5°/15°), snap-гайды 0/50/100%, undo/redo 50 шагов, drag-reorder слоёв, загрузка изображений через POST /kviz/api/tv/screen/image
- `kviz/client/src/lib/tvScreenLayout.ts` — v2-схема `{ v: 2, elements: ScreenEl[] }`: 7 типов, `TextStyle`, `ShapeFill`, `migrateV1ToV2()`, `defaultScreenLayout()` (18 элементов)
- `kviz/client/src/components/tv/TextBox.tsx` — рендер текста: принимает `style: TextStyle; text: string` (используется TvScreen и FreeSlide)
- `kviz/client/src/components/tv/ImageBox.tsx` — рендер картинки FreeSlide
- `kviz/client/src/components/tv/FreeSlide.tsx` — общий компонент free-слайда: устанавливает `--screen-h`, использует TextBox/ImageBox
- `kviz/client/src/components/tv/SlideTemplate.tsx` — рендер шаблона слайда: ResizeObserver → `--screen-h`, 6 типов элементов (text/image/shape/slot_client/slot_image/slot_text), sample-плейсхолдеры, клики для редактора
- `src/http/tv.ts` — TV-роутер: SSE, прокси медиа, CRUD tv_settings/tv_results/tv_slides, `GET/PUT /kviz/api/tv/screen`, `POST /kviz/api/tv/screen/image`, `GET /api/tv/data` v5, `GET/PUT /kviz/api/tv/templates/:kind`
- `kviz/client/src/pages/crm/SettingsPage.tsx` → `TvSection` — кнопка «Редактор экрана», карточки «До/После», слайды
- `kviz/client/src/pages/reports/ReportsPage.tsx` → `StudioSection` — ссылка для ТВ, счётчики, кнопка «Выгрузить все результаты»
- `kviz/client/src/pages/measure/ClientPage.tsx` — кнопка «Отправить в результаты студии» (внутри карточки клиента)
- `src/http/measure.ts` — `POST /kviz/api/measure/clients/:id/results` и `bulk-results`; вызывает `tvNotify()` после upsert

> Старый `/api/results/summary?key=...` и `/kviz/api/results/summary` (сессия) сохранены для совместимости в `src/http/kviz.ts`.

## Таблицы
- `studio_results` — результаты клиентов для ТВ: `client_id`, `cm_lost`, `kg_lost`, `fat_kg_lost`, `from_measure_no`, `to_measure_no` (оба nullable), `sent_by`, `sent_at`
- `studio_settings` — ключ-значение (миссия студии)
- `tv_settings` — одна строка (id=1): `main_label_cm`, `main_label_kg`, `main_label_fat`, `intro_text` (вступительный текст, max 120 симв.), `screen_layout` (jsonb, task 49 — полное описание экрана; если NULL, генерируется `defaultScreenLayoutServer()` с подстановкой текущих значений)
- `tv_results` — карточки «До/После» (библиотека): `id`, `title`, `before_path`, `after_path`, `position`
- `tv_slides` — слайды карусели: `id`, `position` (NOT NULL, unique), `kind` (result1|result2|promo|usp|**free**), `result_a` (uuid FK tv_results, nullable), `result_b` (uuid FK tv_results, nullable), `image_path` (nullable), `duration_sec` (default 8), `enabled` (default true), `layout` (jsonb, только для free), `slide_text` (text, до 300 симв., для promo/usp), `created_at`
- `tv_settings.slide_templates` — jsonb `{ result1: SlideTemplate, result2: SlideTemplate, image: SlideTemplate }` (task 52); NULL → генерируется `defaultSlideTemplatesServer()`

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты `/results?key=…`; URL открывается без входа в систему

## layout (kind = 'free')
JSON-схема v2: `{ v: 2, frame: boolean, elements: ScreenEl[] }` (до 30 элементов; только типы text/image/shape).
Элемент: v2 `ScreenEl` (те же поля что у screen_layout, но без value/mission/datetime/carousel).
Сервер мигрирует v1→v2 при GET /kviz/api/tv/slides и GET /api/tv/data. Клиент мигрирует при рендере через `migrateFreeLayoutToV2()`.
Редактор слайда — `TvScreenEditor mode="slide"`: CAROUSEL_ASPECT ≈ 1.533 (размер слота карусели в 16:9 экране), сохраняет через PATCH /kviz/api/tv/slides/:id `{ layout: { v:2, frame, elements } }`.
Файлы картинок — в бакете `tv-media/free/`. Удаляются при сохранении нового layout (если убраны из элементов) и при удалении слайда.

## screen_layout (ScreenLayout)
JSON-схема **v2**: `{ v: 2, elements: ScreenEl[] }` хранится в `tv_settings.screen_layout`.
Каждый `ScreenEl`: `{ id (uuid), type, x, y, w, h (% экрана), z (0–99), visible?, rotate? }` + поля по типу:
- `text` / `mission` / `datetime`: `TextStyle` (font, size % экрана, weight, color, opacity, align, scaleX, scaleY) + для `text` — поле `text: string`
- `value`: `TextStyle` + `bind: 'value_cm' | 'value_kg' | 'value_fat'` — показывает анимированный счётчик
- `image`: `asset?: 'logo'|'icon_cm'|'icon_kg'|'icon_fat'` или `path?: string` (screen/<uuid>.ext) + `fit`, `opacity`, `radius`
- `shape`: `shape: rect|rounded|circle|ellipse|pill`, `fill: ShapeFill (solid|gradient)`, `border?`, `shadow?`, `blur?`, `radius?`
- `carousel`: слот карусели слайдов, `radius?`

**Миграция**: сервер при GET автоматически мигрирует v1 → v2 (или генерирует v2 по умолчанию). Старый v1 различается по наличию поля `version: 1` вместо `v: 2`.
**Миссия** в v2 хранится отдельно в `studio_settings` и возвращается рядом с layout: `{ layout, mission }`.
**Файлы экрана**: загружаются через `POST /kviz/api/tv/screen/image` → `screen/<uuid>.<ext>`. При PUT layout сервер сравнивает старые и новые пути, удаляет убранные из бакета.

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
- `/api/tv/data` v4 (task 50): `{ screen_layout (v2), counters: {cm_lost,kg_lost,fat_kg_lost}, mission: string, slides, serverTime, version: "4" }`. v3 — устаревший (без mission на верхнем уровне).
- Загрузка фото: клиент сжимает через `compressForUpload()` (tvImage.ts) до 2400px длинной стороны (PNG→PNG, JPEG→JPEG q0.9), лимит 8 МБ после сжатия. Сервер проверяет magic bytes (JPEG/PNG), 8 МБ, сохраняет в бакет.
- Лимит тела для TV-маршрутов: `app.use('/kviz/api/tv', express.json({ limit: '16mb' }))` в `src/index.ts` (было 12mb, повышено в task 51).
- v2 screen_layout: миссия студии живёт в `studio_settings` (не в layout). `GET/PUT /kviz/api/tv/screen` принимает `{ layout, mission }` — одним запросом. Редактор сохраняет и layout, и текст миссии вместе.
- TvScreenEditor: поворот элемента — atan2(dx,dy)+90° с привязкой к 5° (Shift: 15°). Ручка поворота позиционируется `top: -26px, left: 50%` над выделенным элементом. История хранит `[ScreenLayout, string][]` (layout+mission) — undo/redo восстанавливает оба состояния.

## Мобильная версия
(нет отдельных задач; ResultsPage оптимизирована под большой экран ТВ)

## Сделано
### 12.11.2026 · (текущий) · task 52 — шаблоны слайдов (результат 1 и 2 клиента, картинка) в редакторе, слоты клиента и слот текста
- **`kviz/client/src/lib/tvScreenLayout.ts`**: новые типы `SlotChildText/Image/Shape`, `TplElSlotClient/Image/Text`, `TemplateTopEl`, `SlideTemplate { v:1, elements }`, `SlideTemplates { result1, result2, image }`, `TemplateKind`. Экспорты: `TEMPLATE_KIND_LABELS`, `TEMPLATE_EL_LABELS`, `defSlotChildren()`, `defaultSlideTemplates()`, `validateSlideTemplate()`.
- **`kviz/client/src/components/tv/SlideTemplate.tsx`** (новый, ~205 строк): компонент рендера шаблона; ResizeObserver → `--screen-h`; рендерит все 6 типов элементов (text/image/shape/slot_client/slot_image/slot_text); показывает sample-плейсхолдеры (ДО/ПОСЛЕ); принимает `selectedId/selectedChildId/onElementClick/onChildClick` для режима редактора.
- **`kviz/client/src/components/tv/TvScreenEditor.tsx`** (расширен): добавлен `mode='template'`; отдельный стейт `tplElements/tplHistory/tplFuture/selectedChildId/childDrag/expandedSlots`; `applyDrag` стал generic; `startChildDrag` для дочерних элементов slot_client; вся JSX обновлена — header с кнопкой «Сбросить», левая панель с вложенными слоями slot_client, canvas с `SlideTemplate` вместо TvScreen + child-overlays, правая панель с двухуровневыми свойствами (элемент + дочерний).
- **`src/http/tv.ts`**: `GET /kviz/api/tv/templates` → возвращает `{ result1, result2, image }`; `PUT /kviz/api/tv/templates/:kind` → валидирует и сохраняет в `tv_settings.slide_templates` jsonb; `POST/PATCH /kviz/api/tv/slides` обрабатывают `slide_text` (до 300 симв.); `GET /api/tv/data` v5 добавляет `slide_templates`.
- **`kviz/client/src/pages/ResultsPage.tsx`**: удалены `ResultCard` и `SlideContent`; добавлен `SlideTemplate` + маппинг `SLIDE_TPL_KIND`; `TvData` включает `slide_templates`; `TvSlide` добавлено `slide_text`.
- **`kviz/client/src/pages/crm/SettingsPage.tsx`**: `TvSlideRaw` добавлено `slide_text`; `AddSlideModal` добавлено поле «Подпись» для promo/usp; слайд-строка: inline-редактирование `slide_text` для promo/usp; блок «Шаблоны слайдов» с мини-превью `SlideTemplate` и кнопками «Редактировать»; `TvScreenEditor mode="template"`.
- **БД**: `tv_settings.slide_templates` (jsonb), `tv_slides.slide_text` (text, max 300) — добавлены заранее Сергеем.

### 12.11.2026 · (текущий) · task 51 — картинки в предпросмотре редактора, лимит 8 МБ, редактор слайда в том же конструкторе
- **`kviz/client/src/lib/tvImage.ts`** (новый): `compressForUpload(file)` — сжимает до 2400px длинной стороны (PNG→PNG, JPEG→JPEG q0.9), проверяет 8 МБ после сжатия; заменил `compressImg` везде в SettingsPage.
- **`kviz/client/src/lib/tvScreenLayout.ts`**: добавлены `CAROUSEL_ASPECT ≈ 1.533`, `FreeLayout { v: 2, frame, elements: ScreenEl[] }`, `migrateFreeLayoutToV2(raw)` (v1→v2 для клиента).
- **`kviz/client/src/components/tv/TvScreen.tsx`**: `hexA`, `ShapeBox`, `ImageEl` стали `export function` (используются в FreeSlide).
- **`kviz/client/src/components/tv/FreeSlide.tsx`** (рерайт): использует TextBox, ShapeBox, ImageEl из TvScreen; работает с v2 ScreenEl[]; auto-migrate через `migrateFreeLayoutToV2`.
- **`kviz/client/src/components/tv/TvScreenEditor.tsx`** (расширен): prop `mode: 'screen'|'slide'`, `slideId`, `initialFrame`; `onSave` стал optional; `compressImg` заменён на `compressForUpload`; в slide-режиме: canvas с CAROUSEL_ASPECT, только text/image/shape в «Добавить», правая панель без выбора — toggle Рамка + «Сбросить слайд», сохраняет PATCH на /kviz/api/tv/slides/:id; исправлен баг ЧАСТЬ 1 — добавлен `mediaUrl` в рендер TvScreen в редакторе.
- **`kviz/client/src/pages/crm/SettingsPage.tsx`**: `FreeEditorModal` удалён (~330 строк); `freeEditSlide` → `slideEditorState`; «Редактировать» открывает `TvScreenEditor mode="slide"`; `compressImg` → `compressForUpload`.
- **`kviz/client/src/pages/ResultsPage.tsx`**: `FreeLayout` импортируется из `tvScreenLayout` вместо `FreeSlide`.
- **`src/http/tv.ts`**: 2 МБ → 8 МБ во всех upload-эндпоинтах; `migrateFreeLayoutServer()`, `validateFreeLayoutV2()`; GET /kviz/api/tv/slides + GET /api/tv/data мигрируют v1→v2 на выходе; default layout free-слайда: `{ v:2, frame:true, elements:[] }`.
- **`src/index.ts`**: лимит JSON для `/kviz/api/tv` повышен с 12mb до 16mb.

### 12.11.2026 · (текущий) · task 50 — конструктор экрана v2 (свободные элементы, поворот, слои)
- **`kviz/client/src/lib/tvScreenLayout.ts`** (полный рерайт): v2-схема `{ v: 2, elements: ScreenEl[] }`. 7 типов: text/value/mission/datetime/image/shape/carousel. `TextStyle` (font/size/weight/color/opacity/align/scaleX/scaleY). `ShapeFill` (solid/gradient). Экспорты: `TYPE_LABELS`, `BIND_LABELS`, `SHAPE_LABELS`, `VALID_FONTS`, `ASSET_LABELS`, `newId()`, `migrateV1ToV2()`, `defaultScreenLayout()` (18 элементов).
- **`kviz/client/src/components/tv/TextBox.tsx`**: сигнатура изменена на `style: TextStyle; text: string`; добавлен `opacity`; используется и в TvScreen, и в FreeSlide.
- **`kviz/client/src/components/tv/TvScreen.tsx`** (полный рерайт): `ShapeBox` (5 форм, glassmorphism/gradient/border/shadow), `ImageEl` (asset или path), 7 типов в `sorted.map()`, поворот через `transform: rotate`, `opacity: 0.25` для скрытых в режиме редактора.
- **`kviz/client/src/components/tv/TvScreenEditor.tsx`** (полный рерайт, ~500 строк): 8 ручек ресайза (nw/ne/sw/se/n/s/e/w) + ручка поворота (top -26px), snap-гайды к 0/50/100% (порог 2%), история `[ScreenLayout, string][]` (undo/redo включает миссию), drag-reorder слоёв через HTML5 DnD (z переназначается по порядку), загрузка изображений `POST /kviz/api/tv/screen/image`, панели свойств для всех 7 типов, предупреждение «Нет элемента «Карусель»».
- **`src/http/tv.ts`**: `validateScreenLayoutV2()`, `migrateToV2Server()` (v1→v2: счётчик→4 элемента), `defaultScreenLayoutV2Server()`, `extractScreenPaths()`. `GET /api/tv/data` → v4 (c `mission` на верхнем уровне). `GET /kviz/api/tv/screen` → `{ layout (v2), mission }`. `PUT /kviz/api/tv/screen` → принимает v2, сохраняет mission, удаляет убранные `screen/*` файлы. `POST /kviz/api/tv/screen/image` → `screen/<uuid>.<ext>`.
- **`kviz/client/src/pages/ResultsPage.tsx`**: добавлено `mission: string` в `TvData`; обновлён вызов `TvScreen` (`values={{value_cm,value_kg,value_fat}}`, `mission`, `mediaUrl`).
- **`kviz/client/src/pages/crm/SettingsPage.tsx`**: `screenMission` state; GET считывает `r.data.mission`; PUT отправляет `{ layout, mission }`; `initialMission` у `TvScreenEditor`.

### 12.11.2026 · (текущий) · task 49 — редактор экрана (screen_layout, TvScreen, TvScreenEditor, TextBox/ImageBox)
- **`kviz/client/src/lib/tvScreenLayout.ts`** (новый): типы `ScreenEl`/`ScreenLayout`, `defaultScreenLayout()`, `SCREEN_EL_LABELS`. 9 видов элементов: logo/panel/carousel/intro/mission/datetime/counter_cm/counter_kg/counter_fat.
- **`kviz/client/src/components/tv/TextBox.tsx`** (новый): рендер текста FreeSlide (font-size через CSS calc(`--screen-h`)); wrapper имеет `overflow:hidden`, сам TextBox — нет (фикс бага обрезки scaleX).
- **`kviz/client/src/components/tv/ImageBox.tsx`** (новый): рендер картинки FreeSlide.
- **`kviz/client/src/components/tv/FreeSlide.tsx`**: устанавливает `--screen-h` CSS-var, использует TextBox/ImageBox.
- **`kviz/client/src/components/tv/TvScreen.tsx`** (новый): рендерит `ScreenLayout` — каждый элемент position:absolute по %, CounterBlock (Barlow Condensed, ResizeObserver), `--screen-h` var, слот `carousel: ReactNode`.
- **`kviz/client/src/components/tv/TvScreenEditor.tsx`** (новый): полноэкранный редактор (~450 строк). Drag/resize через pointer capture, snap 0.5%, undo/redo 50 шагов (`preInteractionRef` + история). Три панели: дерево элементов (200px) | 16:9 preview | свойства (260px). Сохраняет через `PUT /kviz/api/tv/screen`.
- **`src/http/tv.ts`**: `VALID_FONTS` ← Unbounded; `validateScreenLayout()`; `defaultScreenLayoutServer()` (сид из tv_settings+studio_settings); `GET /api/tv/data` v3 — возвращает `screen_layout`; `GET/PUT /kviz/api/tv/screen`; `PUT /kviz/api/tv/settings` блокирует deprecated поля `main_label_*/intro_text`.
- **`kviz/client/src/pages/ResultsPage.tsx`**: использует `TvScreen` с carousel-слотом; `defaultScreenLayout()` как fallback; CounterBlock перенесён в TvScreen.
- **`kviz/client/src/pages/crm/SettingsPage.tsx`** TvSection: убраны «Счётчики» и `MissionSection`; добавлена кнопка «Редактор экрана» + `TvScreenEditor`.
- **`kviz/client/index.html`**: добавлен Unbounded в Google Fonts.

### 12.11.2026 · (текущий) · task 48 — исправление цикла FreeSlide, счётчики в панели с иконками и вступительным текстом
- `kviz/client/src/components/tv/FreeSlide.tsx`: исправлен React error #185 (бесконечный цикл) — `useLayoutEffect` получил deps `[layout, dim.h, preview]`; добавлен `prevOverflowRef` для сравнения ключа до вызова `setOverflows`.
- `src/http/tv.ts`: `GET /api/tv/data` выбирает `intro_text` из `tv_settings`; `PUT /kviz/api/tv/settings` принимает и валидирует `intro_text` (trim, max 120 симв., 400 если длиннее).
- `kviz/client/src/pages/ResultsPage.tsx`: новый компонент `CounterBlock` (ResizeObserver → динамический font-size, Barlow Condensed 800, scaleY 1.2, иконка слева + данные справа); счётчики теперь в одной стеклянной панели `.tv-counter-panel` с `intro_text` вверху и разделителями между блоками.
- `kviz/client/src/index.css`: удалены старые классы `.tv-counters/.tv-counter`; добавлены `.tv-counter-panel`, `.tv-counter-intro`, `.tv-counter-block`, `.tv-counter-data`, `.tv-counter-numrow`.
- `kviz/client/src/pages/crm/SettingsPage.tsx`: `TvSettingsLabels` + `intro_text`; textarea с счётчиком символов (красный при >100) добавлена в блок «Счётчики»; данные загружаются и сохраняются вместе с остальными метками.

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
- Проверить TvScreen/TvScreenEditor на 1920×1080, 1366×768, 1280×720, 1024×768, 3840×2160 после деплоя.
- В AddSlideModal нет предпросмотра загруженного изображения для promo/usp — можно добавить по желанию.
- Для result1/result2 слайдов в настройках нет редактирования после создания (нельзя сменить карточку) — сейчас надо удалить и добавить заново.
- Перетаскивание элементов мышью в редакторе free-слайда — не реализовано, позиция задаётся числами.
- **SQL выполнен (task 49)**: `ALTER TABLE tv_settings ADD COLUMN IF NOT EXISTS screen_layout jsonb;`
