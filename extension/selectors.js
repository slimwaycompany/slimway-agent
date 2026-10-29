// Устойчивые селекторы для EasyChat (chat.easychat.ru)
// Хэши CSS-модулей (_15svq_1 и т. п.) меняются при обновлениях — НЕ использовать.
// Все изменения только здесь.

const SEL = {
  // Поле ввода чата
  textarea: 'textarea[placeholder="Введите текст сообщения"]',

  // Имя клиентки: правая панель «Данные контакта»
  contactName: '[class*="_name-row_"] h4',

  // Биография (телефон и другие данные)
  bio: '[class*="_bio_"]',

  // Статус-строки в биографии (телефон обычно среди них)
  bioStatus: '[class*="_status_"]',

  // Шапка открытого диалога (для определения канала)
  dialogHeader: '[class*="_header_"]',

  // Активный диалог в списке слева
  activeDialog: '[class*="_active_"]',

  // Иконка/название канала в заголовке диалога
  channelLabel: '[class*="_channel_"], [class*="_source_"], [class*="_integration_"]',

  // Список сообщений (контейнер, за которым следит MutationObserver)
  msgList: '[class*="_message-list_"], [class*="_messages_"]',

  // Один элемент сообщения
  msgItem: '[class*="_message-item_"]',

  // Текст внутри элемента сообщения
  msgText: '[class*="_message-text_"], [class*="_text_"]',

  // Класс исходящего (нашего) сообщения
  msgOwn: '[class*="_own_"], [class*="_right_"]',
};

// Каналы: искать слова в тексте; порядок важен — 'max' после остальных
const CHANNEL_KEYWORDS = [
  ['whatsapp',   'whatsapp'],
  ['instagram',  'instagram'],
  ['telegram',   'telegram'],
  ['вконтакте',  'vk'],
  ['vkontakte',  'vk'],
  [' vk',        'vk'],
  ['max',        'max'],
  ['viber',      'viber'],
];

function detectChannel(headerText) {
  const t = (headerText || '').toLowerCase();
  for (const [kw, ch] of CHANNEL_KEYWORDS) {
    if (t.includes(kw)) return ch;
  }
  // Fallback: scan dedicated channel label elements
  const labelEl = document.querySelector(SEL.channelLabel);
  if (labelEl) {
    const lt = labelEl.textContent.toLowerCase();
    for (const [kw, ch] of CHANNEL_KEYWORDS) {
      if (lt.includes(kw)) return ch;
    }
  }
  return 'unknown';
}

function looksLikePhone(text) {
  return (text.replace(/\D/g, '').length >= 10);
}
