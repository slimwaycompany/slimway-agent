Модуль: ТВ

═══════════════════════════════════════
ЗАДАЧА 45: ТВ — иконки и логотип через import (хеш в имени), вёрстка карточек
═══════════════════════════════════════

Причина: иконки sm.png, kg.png, fat.png, logo.png лежали в kviz/client/public/tv/ под постоянными
именами без кэш-хешей. Браузер держал старые версии — на экране видны чёрные иконки с белой подложкой.

## Часть 1 — Иконки через import (хеш Vite)
- Создать kviz/client/src/assets/tv/
- Скопировать sm.png, kg.png, fat.png, logo.png из img/
- Импортировать в ResultsPage.tsx
- Заменить ${BASE}tv/... на импорты
- Удалить kviz/client/public/tv/

## Часть 2 — Вёрстка карточек
- .tv-mid padding: 0 clamp(24px,4vw,96px)
- .results-counters gap: clamp(16px,2vw,40px)
- .tv-icon-img height: clamp(48px,9vh,120px), width: auto
- white-space: nowrap на strong/span/small счётчиков

## Части 3-5 — Проверка, мобильная, check:mobile

## Часть 6 — Сборка, коммит, деплой
