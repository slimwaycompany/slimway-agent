Модуль: crm-schedule, crm-core

ТЗ 114.3 — Перенос записей Fitbase: будущие записи, общий пул для абонементов на несколько аппаратов, безлимит, без дублей в карточке клиента

═══════════════════════════════════════════

ЧАСТЬ 0 — Подготовка

- `git pull --rebase origin main`, `git status`. Прочитать `CLAUDE.md`, `docs/modules/crm-schedule.md`, `src/jobs/fitbaseBookingsImport.ts`, в `src/http/crm.ts` — обработчики посещений клиента (выборки `crm_visit_history` рядом со строками ~2190 и ~2280).
- Срез после 114.2 (27.11): броней из Fitbase 889, **будущих 0**; история из Fitbase 2961; **дубли бронь + история 879**; абонементов Fitbase 594, из них `needs_split` 149, без `plan_id` 57, без позиций 471; 2 ошибки `crm_client_plan_items_sessions_chk` на безлимите.
- Ограничения `crm_client_plan_items` (проверено в базе 27.11):
  - `crm_client_plan_items_sessions_chk`: (`is_unlimited` И `sessions_total` IS NULL И `sessions_left` IS NULL) ИЛИ (НЕ `is_unlimited` И `sessions_total > 0` И `sessions_left >= 0` И `sessions_left <= sessions_total`);
  - `crm_client_plan_items_device_chk`: (`device_type_code` не null И `device_type_codes` null) ИЛИ (`device_type_code` null И `cardinality(device_type_codes) >= 2`);
  - `crm_client_plan_items_phase_check`: `phase` — `active` / `finishing`;
  - `crm_client_plan_items_daily_limit_check`: `daily_limit` null или > 0.
- Решение Сергея (27.11): активные абонементы на несколько аппаратов (`needs_split`) переносить как **общий пул** с остатком из Fitbase, не ждать ручной разбивки.

═══════════════════════════════════════════

ЧАСТЬ 1 — Будущие записи

- Сейчас `/schedule-registration` запрашивается с `date_to: todayUTC5()`, поэтому будущие записи не переносятся. Сделать `date_to` = сегодня + 180 дней (по UTC+5).
- Будущая запись без собранной брони (нет абонемента / позиции) уходит в историю, как и раньше, но отдельным счётчиком «будущих в историю: N» в статусе и карточке «Записи и посещения» — это то, что девочкам нужно будет поставить руками.

═══════════════════════════════════════════

ЧАСТЬ 2 — Позиции: безлимит, проверка сеансов, общий пул

- В `ensureImportedPlanItems` все значения сеансов собирать через одну функцию, которая гарантирует `crm_client_plan_items_sessions_chk`:
  - `is_unlimited = true` → `sessions_total = null`, `sessions_left = null`;
  - иначе `sessions_total` должно быть > 0 (если нет — позицию не создавать, абонемент остаётся без позиций → причина `no_item`); `sessions_left` = значение в пределах 0…`sessions_total`; null → 0.
- Одна позиция в шаблоне: `sessions_total` = `crm_client_plans.sessions_total`, если null — `sessions` шаблона; `sessions_left` = `crm_client_plans.sessions_left`.
- Несколько позиций в шаблоне, абонемент не `needs_split` (уже не активен) — как сейчас (сеансы шаблона, остаток 0), но через ту же функцию.
- **Общий пул для `needs_split = true`** (обработку `needs_split` больше не пропускать):
  - собрать все виды аппаратов из шаблона (`device_type_code` и элементы `device_type_codes`), без повторов;
  - видов ≥ 2 → одна позиция: `device_type_code = null`, `device_type_codes` = этот список, `phase = 'active'`, `daily_limit = null`;
  - если все позиции шаблона безлимитные → `is_unlimited = true`, сеансы null; иначе `is_unlimited = false`, `sessions_total` = `crm_client_plans.sessions_total`, если null — сумма `sessions` шаблона; `sessions_left` = `crm_client_plans.sessions_left`;
  - вид в шаблоне только один → обычная позиция по этому виду;
  - после успешной вставки поставить абонементу `needs_split = false`;
  - не прошло проверку сеансов → позицию не создавать, `needs_split` не трогать, причина в историю `needs_split`.
- Сеансы при переносе по-прежнему не списывать.
- Счётчик «из них пулом: N» рядом с «позиций абонементов».

═══════════════════════════════════════════

ЧАСТЬ 3 — Без дублей бронь + история

- Историю не удалять: по `crm_visit_history` считаются «Визитов», «последний визит» и правила автоматизации.
- Убрать из `fitbaseBookingsImport.ts` все `void supabase.from('crm_visit_history').delete()...` (они всё равно не выполнялись: без `await` запрос supabase-js не отправляется).
- В обработчиках посещений клиента в `src/http/crm.ts` (вкладка «Записи» и список посещений карточки клиента): в выборку истории добавить `fitbase_reg_id`, а также выбрать `fitbase_reg_id` броней клиента; строки истории, у которых `fitbase_reg_id` есть среди броней клиента, не показывать. Показывать только бронь.
- Счётчики «Визитов» / «последний визит» не менять.
- Проверить на клиенте с переносом: в «Записях» каждый визит один раз.

═══════════════════════════════════════════

ЧАСТЬ 4 — Сборка, документация, коммит

- `npm run build` без ошибок.
- Обнови docs/modules/crm-schedule.md, docs/modules/crm-core.md, docs/STATE.md и docs/QUEUE.md по разделу 8 CLAUDE.md.
```bash
git add -A -- src kviz/client/src docs
git commit -m "task 114.3: перенос записей — будущие записи, общий пул для needs_split, безлимит, без дублей в карточке"
git push origin main
```
- Отчёт по разделу 5 CLAUDE.md. Перенос на проде не запускать.
