Модуль: ТВ

═══════════════════════════════════════
ЗАДАЧА 43: ТВ-экран — 3-блочный цикл, до/после, акция, SSE, настройки
═══════════════════════════════════════

## Часть 0 — Подготовка
SQL из чата уже выполнен Сергеем: таблицы tv_settings, tv_results, бакет tv-media (private).

tv_settings: single row (id=1) — main_enabled, main_seconds, main_label_cm/kg/fat, results_enabled, results_seconds, results_show_count, promo_enabled, promo_seconds, promo_image_path(nullable), updated_at

tv_results: id(uuid PK), title(text), before_path(text), after_path(text), position(int), created_at

## Часть 1 — Бэкенд src/http/tv.ts
- tvNotify() — экспортируемая функция, пушит SSE-событие 'update' всем подключённым клиентам
- GET /api/tv/data?key=... — {settings, summary, results} (публичный, ключ)
- GET /api/tv/stream?key=... — SSE (публичный, ключ)
- GET /api/tv/media?path=...&key=... — прокси из Supabase Storage (публичный, ключ)
- GET /kviz/api/tv/media?path=... — то же, но по сессии (для настроек)
- GET/PUT /kviz/api/tv/settings (admin)
- POST /kviz/api/tv/settings/promo-upload (admin, base64)
- GET/POST /kviz/api/tv/results (admin)
- PUT/DELETE /kviz/api/tv/results/:id (admin)
- POST /kviz/api/tv/results/:id/before-upload, after-upload (admin, base64)
- Валидация магических байт (JPEG/PNG), upsert настроек по id=1

## Часть 2 — Иконки
Скопировать img/logo.png, sm.jpg, kg.png, fat.png, bodyr.png → kviz/client/public/tv/

## Часть 3 — Переписать ResultsPage.tsx
- 3 блока в цикле: main (счётчики), results (до/после), promo (акция)
- Переход между блоками: fade-out 0.4с → смена → fade-in 0.4с
- Данные из /api/tv/data?key=... (при загрузке)
- SSE /api/tv/stream?key=... (обновление при изменении studio_results)
- Анимация счётчиков easeOutCubic 1100ms сохраняется

## Часть 4 — Блок «До/После»
- Показывает results_show_count карточек (первые по position с заполненными путями)
- Каждая карточка: фото «До» + фото «После» + название
- Прокси-ссылки /api/tv/media?path=...&key=...

## Часть 5 — Блок «Акция»
- Показывает promo_image_path из tv_settings
- Пропускается если нет изображения

## Часть 6 — Уведомление после обновления studio_results
tvNotify() вызывается в measure.ts после двух upsert-операций studio_results:
- POST /kviz/api/measure/clients/:id/results
- POST /kviz/api/measure/bulk-results

## Часть 7 — Настройки ТВ в SettingsPage
TvSection (admin-only):
- Редактирование настроек блоков (enable, seconds, labels, show_count)
- Загрузка промо-изображения (компрессия canvas до 1600px JPEG 0.85)
- Список карточек «До/После» с CRUD
- Загрузка фото до/после для каждой карточки

## Часть 8 — Сборка
npm run build — без ошибок.

## Часть 9 — Коммит
git add + commit + push
