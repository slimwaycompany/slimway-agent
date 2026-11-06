# Состояние проекта — карта модулей

Обновляется после каждой задачи (см. `CLAUDE.md`, раздел 8). Подробности — в `docs/modules/<имя>.md`.

Статусы: 🟢 работает · 🟡 в работе / частично · ⚪ заглушка / запланировано · 🔴 сломано

| Модуль | Файл | Чат в claude.ai | Статус | Обновлено | Последнее изменение |
|---|---|---|---|---|---|
| Инфраструктура, вход, оболочка | `modules/infra.md` | Агент и овчарка | 🟢 | 04.11.2026 | task 35: гамбургер-drawer (≤1024px), 2-кол меню выбора, PWA manifest+icons |
| Агент воронки Fitbase | `modules/agent.md` | Агент и овчарка | 🟢 | 30.10.2026 | fetchAll в syncContracts; шаги syncLeads/syncVisits/syncContracts независимы |
| Овчарка (окно уведомлений) | `modules/ovcharka.md` | Агент и овчарка | 🟢 | 28.10.2026 | Работает, кабинет агента |
| Менеджер (чек-лист, смены) | `modules/manager.md` | Менеджер и квалификация | 🟡 | 30.10.2026 | Закрытие смены из Fitbase — тестовый режим; GET /cash/sync-time теперь admin-only |
| Квалификация (звонки) | `modules/kviz.md` | Менеджер и квалификация | 🟢 | 04.11.2026 | task 35: QuizPage tabs на мобиле (Вопрос/Ответы/Резюме) |
| Замеры и InBody | `modules/zamery.md` | Замеры и отчёты | 🟢 | 04.11.2026 | task 35: camera fix, barcode-detector, ClientPage mobile (numbered points, zone list, mini-nav) |
| Отчёты | `modules/reports.md` | Замеры и отчёты | 🟢 | 04.11.2026 | task 35: аккордеон групп на мобиле (openGroups, localStorage) |
| Скриптолог (расширение) | `modules/scriptolog.md` | Скриптолог | 🟢 | 06.11.2026 | Задача 41: EasyChat-клиент, автопрофиль, умные напоминания из Fitbase, парсер ответов, материалы, анкета |
| CRM: настройки и клиенты | `modules/crm-core.md` | CRM: настройки и клиенты | 🟢 | 29.10.2026 | Пагинация списка клиентов, bypass 1000-row, счётчик, «Показать ещё» |
| CRM: касса | `modules/crm-kassa.md` | CRM: касса | 🟡 | 29.10.2026 | checkout/refund payload явный; правильные ключи RPC; ответ {sale_id,number,total}; ждёт проверки на проде |
| CRM: расписание | `modules/crm-schedule.md` | CRM: расписание | ⚪ | 28.10.2026 | Требования собраны, следующий этап после кассы |
| CRM: лиды и воронка | `modules/crm-leads.md` | CRM: лиды и воронка | 🟡 | 05.11.2026 | task 38: fix sync (budget/title NOT NULL, user_id, stage kind), dict sync, deleted leads, LeadDrawer body→text, postMessage, ManagerPage groups |
| Чаты (EasyChat / ФитБейс Чат) | `modules/chats.md` | Чаты (EasyChat) | ⚪ | 05.11.2026 | Модуль создан, исследование: ФБЧ = своя разработка Fitbase, WhatsApp по QR, API не найден |
| UX/UI (дизайн-система, оболочка, мобильная) | `modules/ui.md` | UX/UI | ⚪ | 05.11.2026 | Модуль создан: собраны решения по визуалу, аудит интерфейса (18 проблем) |
| Контроль менеджеров | `modules/control.md` | Контроль | 🟡 | 06.11.2026 | task 40-2 ч.6: фикс fitbase_visits.id→fitbase_id (S5/S3 теперь работают), 53 error checks, staff_name_map editor, bottom sheet, control-schema.md |

Вкладка «Воронка» — модуль `modules/crm-leads.md` (пока заглушка, собираем требования).

## Как пользоваться
- **Claude Code:** перед задачей — `CLAUDE.md` → этот файл → файл модуля из строки `Модуль:` в ТЗ. После задачи — обновить файл модуля, эту таблицу и `QUEUE.md`.
- **Чат claude.ai:** в начале чата прочитать `CLAUDE.md`, этот файл и файлы своего модуля с компьютера Сергея (`C:\Users\SKUPKA\Desktop\agent`). Перед каждым новым ТЗ перечитать файл модуля (Claude Code мог его обновить). ТЗ начинать строкой `Модуль: <имя>`.
