Модуль: Замеры и InBody (+ синк заявок Фитбэйс, модуль CRM-лидов)

# Задача 67: TV-пересчёт (проверка путей + тесты) + body_clients из syncLeads

## Часть 1 — Проверить и добавить тесты recalcStudioResultForClient
Убедиться, что recalcStudioResultForClient вызывается во всех 5 путях:
- POST /measure/measurements (measure.ts)
- POST /inbody/qr (inbody.ts)
- POST /inbody/csv-import (inbody.ts, fire-and-forget)
- POST /inbody/recalculate (inbody.ts, fire-and-forget)
- POST /inbody/link-to-client (inbody.ts)

Добавить в studioResults.test.ts тесты calcLosses для 5 случаев:
1. cm only (только замеры) — cmLost>0, kgLost=0, fatKgLost=null
2. kg only (только InBody, нет замеров) — cmLost=0, kgLost>0
3. fat only (InBody: вес одинаков, жир уменьшился)
4. all metrics grew → cmLost=0, kgLost=0
5. mixed: cm fell, weight rose → cmLost>0, kgLost=0

## Часть 2 — syncLeads() создаёт body_clients для заявок с телефоном
В src/jobs/crmLeadsSync.ts, после upsert заявок:
- Собрать телефоны из заявок (normPhone → 7XXXXXXXXXX)
- Фильтровать по phone_digits в body_clients (только новые)
- Вставить {name: имя+фамилия, phone: +7XXXXXXXXXX} батчами по 100
- try/catch — не прерывать синк при ошибке
- Не трогать fitbase_clients_cache, не перезаписывать существующих, не трогать «Перенести клиентов InBody»

## Часть 3 — Исследование fitbaseCrmSync.ts (только отчёт)
- Частота запуска (из index.ts)
- Поля, которые синхронизируются
- Количество клиентов без заявок (оценка)

## Часть 4 — Build, тесты, документация, коммит
- npm run build без ошибок
- npm test — все тесты проходят
- Обновить: zamery.md, crm-leads.md, STATE.md, QUEUE.md
- Коммит: zamery: пути TV-пересчёта подтверждены + 5 тестов; syncLeads создаёт body_clients
