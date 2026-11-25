Модуль: crm-kassa

# Задача 98 — Касса: фикс паролей, мастер-пароль, печать, 0 ₸, квитанция, права, выгрузка клиентов

## Части
1. Хотфикс серый экран «Пароли кассы» — useContext(PermContext).can → usePerm
2. Мастер-пароль: bcrypt-диагностика при старте, master_configured в /kassa/status
3. Суммы импорта Fitbase: crm-import-fix-prices dry → apply
4. Печать закрытия смены по образцу templates/zakrytie-smeny.xlsx
5. Запрет продажи абонемента за 0 ₸
6. Квитанция после продажи и в истории
7. Серверные права: kassa.discounts, kassa.bonus, schedule.attend
8. Выгрузка клиентов GET /crm/clients/export.xlsx (clients.export)
9. Build, docs, check:mobile, commit

## Статус
В работе
