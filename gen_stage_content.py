"""Generate src/core/leadStageContent.ts from templates/voronki.xlsx"""
import openpyxl, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

wb = openpyxl.load_workbook('templates/voronki.xlsx', data_only=True)
ws = wb[wb.sheetnames[0]]
rows = {i: list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0] for i in range(1, 12)}

stage_names   = rows[1]
agent_row     = rows[5]
manager_row   = rows[7]
transition_row= rows[9]
important_row = rows[11]

def jstr(s):
    if not s:
        return 'null'
    v = str(s).replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    return '`' + v + '`'

# 0=inbox, 1-9=funnel, 10=fail, 11=success
SCOPES = {
    0: 'inbox', 1: 'funnel', 2: 'funnel', 3: 'funnel', 4: 'funnel',
    5: 'funnel', 6: 'funnel', 7: 'funnel', 8: 'funnel', 9: 'funnel',
    10: 'fail', 11: 'success',
}

NAMES = {
    0: 'Неразобранные',
    1: 'Нет ответа',
    2: 'B.A.N.T',
    3: 'Отложенное решение',
    4: 'Не пришел',
    5: 'Записан',
    6: 'Подтвержден',
    7: 'Пришел',
    8: 'Текст драйв',
    9: 'Оффер',
    10: 'Отказ',
    11: 'Успех',
}

REQUIRE_COMMENT = {1: True}  # Нет ответа

# Items per stage from the ТЗ
ITEMS = {
    0: [  # Неразобранные (inbox)
        {"key":"inbox_check_source","block":"Первый контакт","type":"check","label":"Открыть карточку, проверить источник","required":True,"who":"human"},
        {"key":"inbox_call_60","block":"Первый контакт","type":"check","label":"Позвонить в течение 60 секунд, если возможно","required":False,"who":"human"},
        {"key":"inbox_whatsapp","block":"Первый контакт","type":"check","label":"Если не ответил — сообщение в WhatsApp","required":False,"who":"human"},
        {"key":"inbox_contact_result","block":"Первый контакт","type":"text","label":"Результат попытки связи","required":True,"who":"human"},
        {"key":"inbox_auto_first_contact","block":"Автоматика","type":"check","label":"Создать задачу на первый контакт","required":False,"who":"auto","rule":"lead_first_contact"},
    ],
    1: [  # Нет ответа
        {"key":"no_ans_result","block":"Попытка связи","type":"question","label":"Результат попытки","required":True,"who":"human","options":["Не ответил","Сбросил","Занят","Попросил позже","Ответил"]},
        {"key":"no_ans_whatsapp","block":"Попытка связи","type":"check","label":"Отправлено сообщение в WhatsApp","required":False,"who":"human"},
        {"key":"no_ans_comment","block":"Попытка связи","type":"comment","label":"Комментарий","required":True,"who":"human"},
    ],
    2: [  # B.A.N.T
        {"key":"bant_budget","block":"Вопросы BANT","type":"question","label":"Budget: отношение к стоимости","required":True,"who":"human","options":["Готов в бюджет","Сомневается","Не готов","Не выяснено"]},
        {"key":"bant_authority","block":"Вопросы BANT","type":"question","label":"Authority: кто решает","required":True,"who":"human","options":["Решает сам","Нужно согласовать","Не выяснено"]},
        {"key":"bant_need","block":"Вопросы BANT","type":"question","label":"Need: цель и желаемый результат","required":True,"who":"human","options":["Цель понятна","Цель размыта","Не выяснено"]},
        {"key":"bant_timing","block":"Вопросы BANT","type":"question","label":"Timing: когда готов прийти","required":True,"who":"human","options":["Сегодня/завтра","Позже (дата)","Не определился","Не выяснено"]},
        {"key":"bant_times","block":"Следующий шаг","type":"check","label":"Предложены два времени посещения","required":False,"who":"human"},
    ],
    3: [  # Отложенное решение
        {"key":"delay_date","block":"Договорённость","type":"question","label":"Желаемая дата или период","required":True,"who":"human","options":["Через неделю","Через месяц","Позже","Не выяснено"]},
        {"key":"delay_agreement","block":"Договорённость","type":"text","label":"Договорённость","required":True,"who":"human"},
        {"key":"delay_task","block":"Договорённость","type":"check","label":"Задача на повторный контакт создана","required":False,"who":"human"},
    ],
    4: [  # Не пришел
        {"key":"noshw_called","block":"Работа с неявкой","type":"check","label":"Позвонил после пропущенного визита","required":True,"who":"human"},
        {"key":"noshw_reason","block":"Работа с неявкой","type":"question","label":"Причина неявки","required":True,"who":"human","options":["Забыл","Передумал","Не смог прийти","Не выяснено"]},
        {"key":"noshw_next","block":"Работа с неявкой","type":"question","label":"Что дальше","required":True,"who":"human","options":["Новое время","Позже","Отказ"]},
    ],
    5: [  # Записан
        {"key":"app_datetime","block":"Подтверждение","type":"check","label":"Согласовано дата и время","required":True,"who":"human"},
        {"key":"app_details","block":"Подтверждение","type":"check","label":"Адрес и детали отправлены клиенту","required":True,"who":"human"},
        {"key":"app_confirm","block":"Подтверждение","type":"check","label":"Подтверждение записи проверено","required":False,"who":"human"},
        {"key":"app_auto_task","block":"Автоматика","type":"check","label":"Отправить напоминания клиенту","required":False,"who":"auto","rule":"stage_task"},
    ],
    6: [  # Подтвержден
        {"key":"conf_received","block":"Подтверждение","type":"check","label":"Подтверждение получено от клиента","required":True,"who":"human"},
        {"key":"conf_knows","block":"Подтверждение","type":"check","label":"Клиент знает дату, время и адрес","required":True,"who":"human"},
        {"key":"conf_questions","block":"Подтверждение","type":"text","label":"Вопросы клиента","required":False,"who":"human"},
    ],
    7: [  # Пришел
        {"key":"arrived_consultant","block":"Встреча","type":"check","label":"Консультант уведомлён","required":True,"who":"human"},
        {"key":"arrived_form","block":"Встреча","type":"check","label":"Анкета безопасности заполнена","required":True,"who":"human"},
        {"key":"arrived_inbody","block":"Встреча","type":"check","label":"Замеры InBody проведены (если нет ограничений)","required":True,"who":"human"},
        {"key":"arrived_limits","block":"Встреча","type":"question","label":"Ограничения","required":True,"who":"human","options":["Нет","Есть (описать)","Не выяснено"]},
        {"key":"arrived_goal","block":"Встреча","type":"text","label":"Цель клиента","required":True,"who":"human"},
    ],
    8: [  # Текст драйв
        {"key":"trial_safety","block":"Тест-драйв","type":"check","label":"Объяснены правила безопасности","required":True,"who":"human"},
        {"key":"trial_done","block":"Тест-драйв","type":"check","label":"Тестовая процедура проведена","required":True,"who":"human"},
        {"key":"trial_feeling","block":"Тест-драйв","type":"question","label":"Самочувствие","required":True,"who":"human","options":["Хорошо","Нормально","Есть жалобы","Не выяснено"]},
        {"key":"trial_feedback","block":"Тест-драйв","type":"text","label":"Ощущения клиента","required":True,"who":"human"},
    ],
    9: [  # Оффер
        {"key":"offer_decision","block":"Итог визита","type":"question","label":"Решение клиента","required":True,"who":"human","options":["Согласился","Думает","Отказался"]},
        {"key":"offer_explained","block":"Итог визита","type":"check","label":"Программа и стоимость озвучены","required":True,"who":"human"},
        {"key":"offer_objections","block":"Итог визита","type":"text","label":"Возражения и итог","required":True,"who":"human"},
    ],
    10: [  # Отказ (fail)
        {"key":"fail_reason","block":"Причина отказа","type":"question","label":"Причина отказа","required":True,"who":"human","options":[]},
        {"key":"fail_comment","block":"Причина отказа","type":"comment","label":"Комментарий","required":True,"who":"human"},
    ],
    11: [  # Успех (success)
        {"key":"success_payment","block":"Оплата","type":"check","label":"Оплата подтверждена","required":True,"who":"human"},
        {"key":"success_amount","block":"Оплата","type":"text","label":"Сумма и способ оплаты","required":True,"who":"human"},
    ],
}

import json

out_lines = [
    "// AUTO-GENERATED from templates/voronki.xlsx — do not edit by hand",
    "// To regenerate: python gen_stage_content.py > src/core/leadStageContent.ts",
    "",
    "export type ItemType = 'question' | 'check' | 'text' | 'comment';",
    "export type ItemWho  = 'human' | 'auto';",
    "export type ItemRule = 'lead_first_contact' | 'stage_task' | null;",
    "",
    "export interface StageItem {",
    "  key: string;",
    "  block: string;",
    "  type: ItemType;",
    "  label: string;",
    "  hint?: string;",
    "  required: boolean;",
    "  options?: string[];",
    "  who: ItemWho;",
    "  rule?: ItemRule;",
    "}",
    "",
    "export interface StageHelper {",
    "  manager: string | null;",
    "  transition: string | null;",
    "  important: string | null;",
    "  agent: string | null;",
    "}",
    "",
    "export interface StageContent {",
    "  name: string;",
    "  scope: 'funnel' | 'inbox' | 'success' | 'fail';",
    "  helper: StageHelper;",
    "  require_comment: boolean;",
    "  items: StageItem[];",
    "}",
    "",
    "export const STAGE_CONTENT: StageContent[] = [",
]

for i in range(12):
    scope = SCOPES[i]
    name  = NAMES[i]
    mgr   = manager_row[i]
    tra   = transition_row[i]
    imp   = important_row[i]
    ag    = agent_row[i]
    req_c = REQUIRE_COMMENT.get(i, False)
    items = ITEMS.get(i, [])

    def ts_string(s):
        if not s:
            return 'null'
        v = str(s).replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
        return '`' + v + '`'

    out_lines.append(f'  {{')
    out_lines.append(f'    name: {json.dumps(name, ensure_ascii=False)},')
    out_lines.append(f'    scope: {json.dumps(scope)},')
    out_lines.append(f'    require_comment: {str(req_c).lower()},')
    out_lines.append(f'    helper: {{')
    out_lines.append(f'      manager: {ts_string(mgr)},')
    out_lines.append(f'      transition: {ts_string(tra)},')
    out_lines.append(f'      important: {ts_string(imp)},')
    out_lines.append(f'      agent: {ts_string(ag)},')
    out_lines.append(f'    }},')
    out_lines.append(f'    items: [')
    for item in items:
        item_parts = [
            f'key: {json.dumps(item["key"])}',
            f'block: {json.dumps(item["block"], ensure_ascii=False)}',
            f'type: {json.dumps(item["type"])}',
            f'label: {json.dumps(item["label"], ensure_ascii=False)}',
            f'required: {str(item["required"]).lower()}',
            f'who: {json.dumps(item["who"])}',
        ]
        if 'options' in item and item['options']:
            opts = json.dumps(item['options'], ensure_ascii=False)
            item_parts.append(f'options: {opts}')
        if 'rule' in item:
            item_parts.append(f'rule: {json.dumps(item["rule"])}')
        out_lines.append(f'      {{ {", ".join(item_parts)} }},')
    out_lines.append(f'    ],')
    out_lines.append(f'  }},')

out_lines.append('];')
out_lines.append('')

print('\n'.join(out_lines))
