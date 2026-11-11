# Модуль: ТВ (результаты студии)

Чат в claude.ai: «ТВ» · Файл: `docs/modules/tv.md`

## Назначение
Экран результатов студии для ТВ (`/results?key=…`): счётчики «Сантиметров убрали / Килограммов сбросили / Жира сожгли / клиенток с результатом», миссия студии. Инструменты для сотрудников: ссылка для ТВ (копирование, «открыть на весь экран»), выгрузка всех результатов в общий, отправка результата клиента.

## Где код
- `kviz/client/src/pages/ResultsPage.tsx` — ТВ-экран `/results?key=…` (счётчики, миссия, fullscreen)
- `kviz/client/src/pages/reports/ReportsPage.tsx` → `StudioSection` — панель в Отчётах: ссылка для ТВ, счётчики, кнопка «Выгрузить все результаты»
- `kviz/client/src/pages/measure/ClientPage.tsx` — кнопка «Отправить в результаты студии» (внутри карточки клиента)
- `kviz/client/src/pages/crm/SettingsPage.tsx` — ввод миссии студии (секция Настройки)
- `src/http/inbody.ts` — `calcAllResults` (пересчёт всех результатов), `GET /kviz/api/results/summary`, эндпоинты выгрузки и обновления результатов студии
- `src/http/measure.ts` — `POST /kviz/api/measure/clients/:id/results` (отправка результата одного клиента в `studio_results`)

> Код TV-функций лежит в общих файлах с замерами (`measure.ts`, `inbody.ts`, `ClientPage.tsx`). Код не переносился — файлы общие; принадлежность логики указана выше.

## Таблицы
- `studio_results` — результаты клиентов для ТВ: `client_fitbase_id`, `name`, `cm_lost`, `kg_lost`, `fat_lost`, `from_measure_no`, `to_measure_no` (оба nullable)
- `studio_settings` — настройки студии: миссия и другие параметры ТВ-экрана

## env
- `RESULTS_DISPLAY_KEY` — ключ защиты `/results?key=…`; URL открывается без входа в систему

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Результаты студии — только **реальные** потери (не null, > 0). Клиенты только с InBody получают кг и жир; 0 см — норма (InBody-only, замеров тела нет).
- `from_measure_no` / `to_measure_no` в `studio_results` — nullable. `null` означает «у клиента нет замеров тела, только InBody».
- ТВ-экран защищён `RESULTS_DISPLAY_KEY` в query-параметре `key` — не требует входа в систему.

## Мобильная версия
(нет отдельных задач; ResultsPage оптимизирована под большой экран ТВ)

## Сделано
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
- (нет запланированного)
