import https from 'https';
import { supabase } from '../db/supabase';
import { normalizePhone } from './phone';
import { extractDataFields, beforeTarget, delta, formatValue } from './inbodyView';

type JsonObject = Record<string, unknown>;

const TOKEN = process.env.TG_BOT_TOKEN ?? '';

// ── Telegram API ─────────────────────────────────────────────────────────────

function tgPost(method: string, body: JsonObject): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      `https://api.telegram.org/bot${TOKEN}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => { try { resolve(JSON.parse(data) as JsonObject); } catch { resolve({ ok: false }); } });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendMsg(chatId: number, text: string, extra?: JsonObject): Promise<void> {
  await tgPost('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function editMsg(chatId: number, msgId: number, text: string, extra?: JsonObject): Promise<void> {
  await tgPost('editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', ...extra });
}

async function answerCb(id: string): Promise<void> {
  await tgPost('answerCallbackQuery', { callback_query_id: id });
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

const MENU_KB = {
  inline_keyboard: [
    [{ text: 'Замеры тела', callback_data: 'm_body' }, { text: 'Замеры InBody', callback_data: 'm_ib' }],
    [{ text: 'Посещения', callback_data: 'm_visits' }, { text: 'Абонемент', callback_data: 'm_sub' }],
  ],
};

function backKb(extraRows?: unknown[][]): JsonObject {
  const kb = [...(extraRows ?? []), [{ text: '← Меню', callback_data: 'm_menu' }]];
  return { inline_keyboard: kb };
}

const CONTACT_KB = {
  keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// ── Rate limiter (20 req/min per chat_id, in-process) ─────────────────────────

const rateMap = new Map<number, { count: number; resetAt: number }>();
function rateLimitOk(chatId: number): boolean {
  const now = Date.now();
  let e = rateMap.get(chatId);
  if (!e || e.resetAt < now) { e = { count: 0, resetAt: now + 60_000 }; rateMap.set(chatId, e); }
  e.count++;
  return e.count <= 20;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getLink(chatId: number): Promise<{ client_id: string; phone_digits: string | null } | null> {
  const { data } = await supabase
    .from('telegram_links')
    .select('client_id, phone_digits')
    .eq('chat_id', chatId)
    .is('unlinked_at', null)
    .maybeSingle();
  return (data ?? null) as { client_id: string; phone_digits: string | null } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = iso.split('T')[0];
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

// wraps inline button; falls back to m_menu if cbData exceeds 64 bytes
function mkBtn(text: string, cbData: string): JsonObject {
  if (Buffer.byteLength(cbData) > 64) {
    console.error(`[tg] callback_data exceeds 64 bytes: "${cbData}"`);
    return { text, callback_data: 'm_menu' };
  }
  return { text, callback_data: cbData };
}
// sign arrow: ▼ for negative, ▲ for non-negative
function arrow(val: number, unit: string): string {
  const s = val < 0 ? val.toFixed(1) : `+${val.toFixed(1)}`;
  const icon = val < 0 ? '▼' : '▲';
  return unit ? `${icon} ${s} ${unit}` : `${icon} ${s}`;
}

// ── Menu screens ──────────────────────────────────────────────────────────────

async function screenBody(chatId: number, msgId: number, link: { client_id: string }, offset = 0): Promise<void> {
  const { data: ms } = await supabase
    .from('body_measurements')
    .select('id, measured_at')
    .eq('client_id', link.client_id)
    .order('measured_at', { ascending: false })
    .range(offset, offset + 10); // fetch 11 to detect next page

  if (!ms?.length) {
    await editMsg(chatId, msgId, 'Замеров тела пока нет.', { reply_markup: backKb() });
    return;
  }

  const page = ms.slice(0, 10);
  const hasMore = ms.length > 10;

  const rows = page.map(m => [mkBtn(fmtDate(m.measured_at as string), `m:${m.id}`)]);
  const nav: unknown[][] = hasMore ? [[mkBtn('Ещё →', `mp:${offset + 10}`)]] : [];

  await editMsg(chatId, msgId, '<b>Замеры тела</b>\n\nВыберите дату:', {
    reply_markup: { inline_keyboard: [...rows, ...nav, [{ text: '← Меню', callback_data: 'm_menu' }]] },
  });
}

async function screenBodyDetail(chatId: number, msgId: number, link: { client_id: string }, id: string): Promise<void> {
  const { data: m } = await supabase
    .from('body_measurements')
    .select('client_id, measured_at, total_cm, neck, chest, arm_l, arm_r, waist, belly, glutes, thigh_l, thigh_r, shin_l, shin_r, note')
    .eq('id', id)
    .maybeSingle();

  if (!m || (m as JsonObject).client_id !== link.client_id) {
    await editMsg(chatId, msgId, 'Замер не найден.', { reply_markup: backKb() });
    return;
  }

  const r = m as JsonObject;
  const zones: [string, string][] = [
    ['Шея', 'neck'], ['Грудь', 'chest'], ['Рука (л)', 'arm_l'], ['Рука (п)', 'arm_r'],
    ['Талия', 'waist'], ['Живот', 'belly'], ['Ягодицы', 'glutes'],
    ['Бедро (л)', 'thigh_l'], ['Бедро (п)', 'thigh_r'], ['Голень (л)', 'shin_l'], ['Голень (п)', 'shin_r'],
  ];

  const lines: string[] = [
    `📅 ${fmtDate(r.measured_at as string)}`,
    `📏 Итого: ${r.total_cm} см`,
    '',
  ];

  for (const [label, key] of zones) {
    if (r[key] !== null && r[key] !== undefined) lines.push(`${label}: ${r[key]} см`);
  }

  if (r.note) lines.push(`\n📝 ${r.note}`);

  await editMsg(chatId, msgId, `<b>Замер тела</b>\n\n${lines.join('\n')}`, { reply_markup: backKb() });
}

async function screenInBody(chatId: number, msgId: number, link: { client_id: string; phone_digits: string | null }, offset = 0): Promise<void> {
  if (!link.phone_digits) {
    await editMsg(chatId, msgId, 'Тестов InBody пока нет.', { reply_markup: backKb() });
    return;
  }

  const { data: tests } = await supabase
    .from('inbody_tests')
    .select('id, tested_at')
    .eq('phone_digits', link.phone_digits)
    .order('tested_at', { ascending: false })
    .range(offset, offset + 10);

  if (!tests?.length) {
    await editMsg(chatId, msgId, 'Тестов InBody пока нет.', { reply_markup: backKb() });
    return;
  }

  const page = tests.slice(0, 10);
  const hasMore = tests.length > 10;

  const rows = page.map(t => [mkBtn(fmtDate(t.tested_at as string), `i:${t.id}`)]);
  const nav: unknown[][] = hasMore ? [[mkBtn('Ещё →', `ip:${offset + 10}`)]] : [];

  await editMsg(chatId, msgId, '<b>Замеры InBody</b>\n\nВыберите дату:', {
    reply_markup: { inline_keyboard: [...rows, ...nav, [{ text: '← Меню', callback_data: 'm_menu' }]] },
  });
}

async function screenInBodyDetail(chatId: number, msgId: number, link: { phone_digits: string | null }, id: string): Promise<void> {
  const { data: t } = await supabase
    .from('inbody_tests')
    .select('id, phone_digits, tested_at, weight, pbf, smm, ffm, bmi, vfl, inbody_score, bmr, whr, data')
    .eq('id', id)
    .maybeSingle();

  if (!t || (t as JsonObject).phone_digits !== link.phone_digits) {
    await editMsg(chatId, msgId, 'Тест не найден.', { reply_markup: backKb() });
    return;
  }

  const r = t as JsonObject;
  const pd = link.phone_digits as string;
  const testedAt = r.tested_at as string;

  const [prevRes, nextRes, firstRes] = await Promise.all([
    supabase.from('inbody_tests').select('id, tested_at, weight, pbf, smm')
      .eq('phone_digits', pd).lt('tested_at', testedAt)
      .order('tested_at', { ascending: false }).limit(1),
    supabase.from('inbody_tests').select('id')
      .eq('phone_digits', pd).gt('tested_at', testedAt)
      .order('tested_at', { ascending: true }).limit(1),
    supabase.from('inbody_tests').select('id, tested_at, weight, pbf')
      .eq('phone_digits', pd)
      .order('tested_at', { ascending: true }).limit(1),
  ]);

  const prev    = prevRes.data?.[0]  as JsonObject | undefined;
  const next    = nextRes.data?.[0]  as JsonObject | undefined;
  const first   = firstRes.data?.[0] as JsonObject | undefined;
  const isFirst = first?.id === r.id;

  const df = extractDataFields(r.data as Record<string, unknown> | null);
  const fv = formatValue;

  const lines: string[] = [
    '<b>Замеры InBody</b>',
    `📅 <b>${fmtDate(testedAt)}</b>`,
    '',
    '<b>🧍 Состав тела</b>',
    `⚖️ Вес: ${fv(r.weight as number | null, 'кг')}`,
    `🔥 Жир (PBF): ${fv(r.pbf as number | null, '%')}`,
    `💪 Мышцы (SMM): ${fv(r.smm as number | null, 'кг')}`,
    `🦴 Безжировая масса (FFM): ${fv(r.ffm as number | null, 'кг')}`,
    `📐 ИМТ (BMI): ${fv(r.bmi as number | null, '')}`,
    `🫁 Висцеральный жир (VFL): ${fv(r.vfl as number | null, '')}`,
    `🏅 InBody Score: ${fv(r.inbody_score as number | null, '')}`,
    `⚡ Обмен веществ (BMR): ${fv(r.bmr as number | null, 'ккал')}`,
    `📏 ОТ/ОБ (WHR): ${fv(r.whr as number | null, '')}`,
  ];

  // «До цели» — only when weight+weightControl ≈ targetWeight
  if (beforeTarget(r.weight as number | null, df.weight_control, df.target_weight) !== null) {
    lines.push('', '<b>🎯 До цели</b>');
    lines.push(`Вес: ${arrow(df.weight_control!, 'кг')} (цель ${df.target_weight!.toFixed(1)} кг)`);
    if (df.bfm_control !== null)  lines.push(`Жир: ${arrow(df.bfm_control, 'кг')}`);
    if (df.ffm_control !== null)  lines.push(`Мышцы: ${arrow(df.ffm_control, 'кг')}`);
    if (df.ideal_weight !== null) lines.push(`Идеальный вес: ${df.ideal_weight.toFixed(1)} кг`);
  } else if (df.ideal_weight !== null) {
    lines.push('', `🎯 Идеальный вес: ${df.ideal_weight.toFixed(1)} кг`);
  }

  // «С прошлого теста»
  if (prev) {
    const dw = delta(r.weight as number | null, prev.weight as number | null);
    const dp = delta(r.pbf as number | null,    prev.pbf as number | null);
    const ds = delta(r.smm as number | null,    prev.smm as number | null);
    if (dw !== null || dp !== null || ds !== null) {
      lines.push('', '<b>📈 С прошлого теста</b>');
      if (dw !== null) lines.push(`Вес: ${arrow(dw, 'кг')}`);
      if (dp !== null) lines.push(`Жир: ${arrow(dp, '%')}`);
      if (ds !== null) lines.push(`Мышцы: ${arrow(ds, 'кг')}`);
    }
  }

  // «Со старта» — only when this is not the earliest test
  if (first && !isFirst) {
    const dw = delta(r.weight as number | null, first.weight as number | null);
    const dp = delta(r.pbf as number | null,    first.pbf as number | null);
    if (dw !== null || dp !== null) {
      lines.push('', '<b>🏁 Со старта</b>');
      if (dw !== null) lines.push(`Вес: ${arrow(dw, 'кг')} (с ${fmtDate(first.tested_at as string)})`);
      if (dp !== null) lines.push(`Жир: ${arrow(dp, '%')}`);
    }
  }

  const navRow: JsonObject[] = [];
  if (prev) navRow.push(mkBtn('‹ Предыдущий', `i:${prev.id}`));
  if (next) navRow.push(mkBtn('Следующий ›',  `i:${next.id}`));

  const kb: unknown[][] = [];
  if (navRow.length) kb.push(navRow);
  kb.push([mkBtn('← К списку дат', 'ip:0')]);
  kb.push([{ text: '← Меню', callback_data: 'm_menu' }]);

  await editMsg(chatId, msgId, lines.join('\n'), { reply_markup: { inline_keyboard: kb } });
}

async function screenVisits(chatId: number, msgId: number, link: { client_id: string }): Promise<void> {
  const { data: cl } = await supabase
    .from('body_clients')
    .select('fitbase_client_id')
    .eq('id', link.client_id)
    .single();

  if (!cl?.fitbase_client_id) {
    await editMsg(chatId, msgId, 'Данные по посещениям сейчас недоступны.', { reply_markup: backKb() });
    return;
  }

  const { data: contracts } = await supabase
    .from('fitbase_contracts')
    .select('raw')
    .eq('client_fitbase_id', cl.fitbase_client_id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1);

  if (!contracts?.length) {
    await editMsg(chatId, msgId, 'Активного абонемента нет.', { reply_markup: backKb() });
    return;
  }

  const raw = contracts[0].raw as JsonObject | null;
  const visitsLeft = raw ? raw['visits_left'] : undefined;

  if (visitsLeft === undefined || visitsLeft === null) {
    await editMsg(chatId, msgId, 'Данные по посещениям сейчас недоступны.', { reply_markup: backKb() });
    return;
  }

  await editMsg(chatId, msgId, `<b>Посещения</b>\n\nОстаток: ${visitsLeft} занятий`, { reply_markup: backKb() });
}

async function screenSub(chatId: number, msgId: number, link: { client_id: string }): Promise<void> {
  const { data: cl } = await supabase
    .from('body_clients')
    .select('fitbase_client_id')
    .eq('id', link.client_id)
    .single();

  if (!cl?.fitbase_client_id) {
    await editMsg(chatId, msgId, 'Активного абонемента нет.', { reply_markup: backKb() });
    return;
  }

  const { data: contracts } = await supabase
    .from('fitbase_contracts')
    .select('name, status, begin_date, end_date')
    .eq('client_fitbase_id', cl.fitbase_client_id)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1);

  if (!contracts?.length) {
    await editMsg(chatId, msgId, 'Активного абонемента нет.', { reply_markup: backKb() });
    return;
  }

  const c = contracts[0] as JsonObject;
  const statusLabel: Record<string, string> = { active: '🟢 Активный', closed: '🔴 Закрытый', deleted: '⚫ Удалён' };
  const lines = [
    `📋 ${c.name || '—'}`,
    `Статус: ${statusLabel[c.status as string] ?? c.status}`,
    c.begin_date ? `Начало: ${c.begin_date}` : null,
    c.end_date ? `Конец: ${c.end_date}` : null,
  ].filter(Boolean);

  await editMsg(chatId, msgId, `<b>Абонемент</b>\n\n${lines.join('\n')}`, { reply_markup: backKb() });
}

// ── Menu message ──────────────────────────────────────────────────────────────

async function sendMenu(chatId: number): Promise<void> {
  await sendMsg(chatId, 'Выберите раздел:', { reply_markup: MENU_KB });
}

// ── Update handler ────────────────────────────────────────────────────────────

export async function handleUpdate(update: JsonObject): Promise<void> {
  const msg = update.message as JsonObject | undefined;
  const cb = update.callback_query as JsonObject | undefined;

  // ── Incoming message ───────────────────────────────────────────────────────
  if (msg) {
    const chat = msg.chat as JsonObject;
    if (chat.type !== 'private') return; // ignore groups

    const chatId = chat.id as number;
    const from = msg.from as JsonObject;
    const text = msg.text as string | undefined;
    const contact = msg.contact as JsonObject | undefined;

    // /stop
    if (text === '/stop') {
      await supabase.from('telegram_links')
        .update({ unlinked_at: new Date().toISOString() })
        .eq('chat_id', chatId)
        .is('unlinked_at', null);
      await sendMsg(chatId, 'Вы отвязаны. Чтобы вернуться, нажмите /start');
      return;
    }

    // /start
    if (text?.startsWith('/start')) {
      const link = await getLink(chatId);
      if (link) {
        await sendMenu(chatId);
      } else {
        await sendMsg(chatId, 'Чтобы открыть свои данные, нажмите кнопку ниже и поделитесь контактом.', {
          reply_markup: CONTACT_KB,
        });
      }
      return;
    }

    // contact sharing
    if (contact) {
      const contactUserId = contact.user_id as number | undefined;
      if (!contactUserId || contactUserId !== (from.id as number)) {
        await sendMsg(chatId, 'Нажмите кнопку «📱 Поделиться контактом» — пересланные контакты не принимаются.');
        return;
      }

      const rawPhone = contact.phone_number as string;
      const normalized = normalizePhone(rawPhone);
      if (!normalized) {
        await sendMsg(chatId, 'Номер не найден в базе. Обратитесь к консультанту.');
        return;
      }

      const { data: clients } = await supabase
        .from('body_clients')
        .select('id')
        .eq('phone_digits', normalized)
        .limit(1);

      if (!clients?.length) {
        console.log(`[tg] contact not_found chat=${chatId}`);
        await sendMsg(chatId, 'Номер не найден в базе. Обратитесь к консультанту.');
        return;
      }

      const clientId = (clients[0] as { id: string }).id;
      await supabase.from('telegram_links').upsert({
        chat_id: chatId,
        tg_user_id: from.id as number,
        client_id: clientId,
        phone_digits: normalized,
        linked_at: new Date().toISOString(),
        unlinked_at: null,
      }, { onConflict: 'chat_id' });

      console.log(`[tg] contact found chat=${chatId}`);
      await sendMsg(chatId, '✅ Контакт подтверждён!', { reply_markup: { remove_keyboard: true } });
      await sendMenu(chatId);
      return;
    }

    // any other text without binding
    const link = await getLink(chatId);
    if (!link) {
      await sendMsg(chatId, 'Нажмите /start и поделитесь контактом.');
    }
    // bound users: ignore unknown messages silently
  }

  // ── Callback query ─────────────────────────────────────────────────────────
  if (cb) {
    const cbMsg = cb.message as JsonObject;
    const cbChat = cbMsg?.chat as JsonObject;
    if (cbChat?.type !== 'private') return;

    const chatId = cbChat.id as number;
    const msgId = cbMsg.message_id as number;
    const data = cb.data as string;

    await answerCb(cb.id as string);

    if (!rateLimitOk(chatId)) return;

    if (data === 'm_menu') {
      await editMsg(chatId, msgId, 'Выберите раздел:', { reply_markup: MENU_KB });
      return;
    }

    const link = await getLink(chatId);
    if (!link) {
      await editMsg(chatId, msgId, 'Привязка потеряна. Нажмите /start.', { reply_markup: { inline_keyboard: [] } });
      return;
    }

    try {
      if (data === 'm_body')           await screenBody(chatId, msgId, link, 0);
      else if (data === 'm_ib')        await screenInBody(chatId, msgId, link, 0);
      else if (data === 'm_visits')    await screenVisits(chatId, msgId, link);
      else if (data === 'm_sub')       await screenSub(chatId, msgId, link);
      else if (data.startsWith('mp:')) await screenBody(chatId, msgId, link, parseInt(data.slice(3), 10));
      else if (data.startsWith('ip:')) await screenInBody(chatId, msgId, link, parseInt(data.slice(3), 10));
      else if (data.startsWith('m:'))  await screenBodyDetail(chatId, msgId, link, data.slice(2));
      else if (data.startsWith('i:'))  await screenInBodyDetail(chatId, msgId, link, data.slice(2));
    } catch (e) {
      console.error(`[tg] screen ${data} error chat=${chatId}:`, (e as Error).message);
      await editMsg(chatId, msgId, 'Что-то пошло не так, попробуйте позже.', { reply_markup: backKb() });
    }
  }
}
