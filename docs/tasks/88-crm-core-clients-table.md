Модуль: crm-core

Таблица клиентов с настраиваемыми колонками.

Части 1–6 — см. текст ТЗ от Сергея (24.11.2026).
Колонки: name, phone, plan, sessions, last_visit, days, tags, source, ltv, created, birth, profile, deposit, fitbase.
По умолчанию видны: name, phone, plan, sessions, last_visit, days, tags.
Сортировка на сервере (sort + dir). Дефолтная — last_visit DESC.
Сохранение (порядок, ширина, видимость, сортировка) в localStorage ключ crm.clients.table.<login>.
Мобиль ≤640px — карточки как сейчас + select сортировки.
Часть 5 — только отчёт по мусорным записям (не удалять).
