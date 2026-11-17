import https from 'https';
import { supabase } from '../db/supabase';
import { phoneTail } from './phone';
import { getOrCreateShareToken } from '../http/measure';

const TOKEN = process.env.TG_BOT_TOKEN ?? '';
const PUBLIC_URL = (process.env.TG_PUBLIC_URL ?? '').replace(/\/$/, '');

type JsonObject = Record<string, unknown>;

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

// ── Menu screens ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function screenBody(chatId: number, msgId: number, link: { client_id: string }): Promise<void> {
  const [{ data: ms }, { data: cl }] = await Promise.all([
    supabase.from('body_measurements')
      .select('measured_at, total_cm')
      .eq('client_id', link.client_id)
      .order('measured_at', { ascending: false })
      .limit(2),
    supabase.from('body_clients').select('share_token').eq('id', link.client_id).single(),
  ]);

  const token = (cl?.share_token as string | null) ?? await getOrCreateShareToken(link.client_id);
  const shareUrl = token ? `${PUBLIC_URL}/r/${token}` : null;
  const shareRow = shareUrl ? [[{ text: '🔗 Полный отчёт', url: shareUrl }]] : [];

  if (!ms?.length) {
    await editMsg(chatId, msgId, 'Замеров тела пока нет.', { reply_markup: backKb(shareRow) });
    return;
  }

  const lines = ms.map((m, i) => {
    const delta = i === 0 && ms.length > 1
      ? ` (${((m.total_cm as number) - (ms[1].total_cm as number) >= 0 ? '+' : '')}${((m.total_cm as number) - (ms[1].total_cm as number)).toFixed(1)} см)`
      : '';
    return `📅 ${fmtDate(m.measured_at as string)}: ${m.total_cm} см${delta}`;
  });

  await editMsg(chatId, msgId, `<b>Замеры тела</b>\n\n${lines.join('\n')}`, {
    reply_markup: backKb(shareRow),
  });
}

async function screenInBody(chatId: number, msgId: number, link: { client_id: string; phone_digits: string | null }): Promise<void> {
  const shareUrl = await getOrCreateShareToken(link.client_id).then(t => t ? `${PUBLIC_URL}/r/${t}` : null);
  const shareRow = shareUrl ? [[{ text: '🔗 Полный отчёт', url: shareUrl }]] : [];

  if (!link.phone_digits) {
    await editMsg(chatId, msgId, 'Тестов InBody пока нет.', { reply_markup: backKb(shareRow) });
    return;
  }

  const { data: tests } = await supabase
    .from('inbody_tests')
    .select('tested_at, weight, pbf, smm, vfl')
    .eq('phone_digits', link.phone_digits)
    .order('tested_at', { ascending: false })
    .limit(1);

  if (!tests?.length) {
    await editMsg(chatId, msgId, 'Тестов InBody пока нет.', { reply_markup: backKb(shareRow) });
    return;
  }

  const t = tests[0];
  const lines = [
    `📅 Дата: ${fmtDate(t.tested_at as string)}`,
    `⚖️ Вес: ${t.weight} кг`,
    `🩸 Жир: ${t.pbf}%`,
    `💪 Мышцы (SMM): ${t.smm} кг`,
    `🫁 Висцеральный жир: ${t.vfl}`,
  ];

  await editMsg(chatId, msgId, `<b>Замеры InBody</b>\n\n${lines.join('\n')}`, {
    reply_markup: backKb(shareRow),
  });
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

  const c = contracts[0];
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
      const contactUserId = (contact.user_id as number | undefined);
      if (!contactUserId || contactUserId !== (from.id as number)) {
        await sendMsg(chatId, 'Нажмите кнопку «📱 Поделиться контактом» — пересланные контакты не принимаются.');
        return;
      }

      const rawPhone = contact.phone_number as string;
      const tail = phoneTail(rawPhone);
      if (!tail) {
        await sendMsg(chatId, 'Номер не найден в базе. Обратитесь к консультанту.');
        return;
      }

      const { data: clients } = await supabase
        .from('body_clients')
        .select('id')
        .eq('phone_digits', tail)
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
        phone_digits: tail,
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
      if (data === 'm_body')   await screenBody(chatId, msgId, link);
      if (data === 'm_ib')     await screenInBody(chatId, msgId, link);
      if (data === 'm_visits') await screenVisits(chatId, msgId, link);
      if (data === 'm_sub')    await screenSub(chatId, msgId, link);
    } catch (e) {
      console.error(`[tg] screen ${data} error chat=${chatId}:`, (e as Error).message);
      await editMsg(chatId, msgId, 'Что-то пошло не так, попробуйте позже.', { reply_markup: backKb() });
    }
  }
}
