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
};

// Каналы: искать слова в тексте шапки
const CHANNEL_KEYWORDS = [
  ['whatsapp',   'whatsapp'],
  ['instagram',  'instagram'],
  ['telegram',   'telegram'],
  ['вконтакте',  'vk'],
  ['vkontakte',  'vk'],
  [' vk ',       'vk'],
  ['max',        'max'],
];

function detectChannel(headerText) {
  const t = (headerText || '').toLowerCase();
  for (const [kw, ch] of CHANNEL_KEYWORDS) {
    if (t.includes(kw)) return ch;
  }
  return 'unknown';
}

function looksLikePhone(text) {
  return (text.replace(/\D/g, '').length >= 10);
}
