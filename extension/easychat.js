// Контент-скрипт для chat.easychat.ru (all_frames: true)
// Читает имя/телефон/канал клиентки, слушает команды вставки текста.

(function () {
  'use strict';

  let lastClient = null; // {name, phone, channel}
  let debounceTimer = null;

  // ── Чтение данных клиентки ─────────────────────────────────────────────────

  function readClient() {
    const nameEl = document.querySelector(SEL.contactName);
    const name   = nameEl ? nameEl.textContent.trim() : '';
    if (!name) return null;

    // Телефон: ищем в bio строку похожую на номер
    let phone = '';
    const bioEl = document.querySelector(SEL.bio);
    if (bioEl) {
      const statusEls = bioEl.querySelectorAll(SEL.bioStatus);
      for (const el of statusEls) {
        const t = el.textContent.trim();
        if (looksLikePhone(t)) { phone = t; break; }
      }
    }

    // Канал: из шапки диалога
    const headerEl = document.querySelector(SEL.dialogHeader);
    const channel  = detectChannel(headerEl ? headerEl.textContent : '');

    return { name, phone, channel };
  }

  // ── Вставка текста ─────────────────────────────────────────────────────────

  function insertText(text) {
    const textarea = document.querySelector(SEL.textarea);
    if (!textarea) {
      chrome.runtime.sendMessage({ type: 'chat-status', ready: false });
      return;
    }
    // Если поле не пустое — дописать с новой строки
    const existing = textarea.value;
    const newVal   = existing ? existing + '\n' + text : text;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(textarea, newVal);
    else              textarea.value = newVal;

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  // ── Обнаружение смены диалога ──────────────────────────────────────────────

  function onMutation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkClientChange, 300);
  }

  function checkClientChange() {
    const client = readClient();
    if (!client || !client.name) return;
    if (
      client.name    === lastClient?.name &&
      client.phone   === lastClient?.phone &&
      client.channel === lastClient?.channel
    ) return;
    lastClient = client;
    chrome.runtime.sendMessage({ type: 'client', ...client });
  }

  // ── Проверка готовности поля ввода ─────────────────────────────────────────

  function checkChatReady() {
    const ready = !!document.querySelector(SEL.textarea);
    chrome.runtime.sendMessage({ type: 'chat-status', ready });
  }

  // ── Сообщения от background ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'insert') insertText(msg.text);
    if (msg.type === 'ping')   checkChatReady();
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    checkClientChange();
    checkChatReady();
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
