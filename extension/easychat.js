// Контент-скрипт для chat.easychat.ru (all_frames: true)
// Читает имя/телефон/канал клиентки, слушает команды вставки текста.
// Читает сообщения из DOM; текст НЕ сохраняется в базу — только отправляется в панель.

(function () {
  'use strict';

  let lastClient   = null; // {name, phone, channel}
  let debounceTimer = null;
  let msgObserver  = null;
  let knownMsgIds  = new Set(); // предотвращает дублирование при перерисовке

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

  // ── Чтение сообщений из DOM ────────────────────────────────────────────────

  function watchMessages() {
    const list = document.querySelector(SEL.msgList);
    if (!list) return; // контейнер ещё не появился — main observer повторит
    if (msgObserver) return; // уже следим

    // Сначала отмечаем все уже существующие сообщения как «известные»
    list.querySelectorAll(SEL.msgItem).forEach(el => knownMsgIds.add(getElId(el)));

    msgObserver = new MutationObserver(() => {
      list.querySelectorAll(SEL.msgItem).forEach(el => {
        const id = getElId(el);
        if (knownMsgIds.has(id)) return;
        knownMsgIds.add(id);
        const textEl = el.querySelector(SEL.msgText);
        const text = textEl ? textEl.textContent.trim() : '';
        if (!text) return;
        const isOwn = !!el.querySelector(SEL.msgOwn) || el.matches(SEL.msgOwn);
        chrome.runtime.sendMessage({
          type: 'chat-message',
          direction: isOwn ? 'out' : 'in',
          text,
        });
      });
    });
    msgObserver.observe(list, {childList: true, subtree: true});
  }

  function getElId(el) {
    // Уникальный идентификатор DOM-элемента (порядковый номер в родителе)
    return el.dataset.id || Array.from(el.parentNode?.children || []).indexOf(el) + '_' + (el.textContent || '').slice(0, 20);
  }

  // ── Обнаружение смены диалога ──────────────────────────────────────────────

  function onMutation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { checkClientChange(); watchMessages(); }, 300);
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
    // Сброс наблюдателя сообщений при смене диалога
    if (msgObserver) { msgObserver.disconnect(); msgObserver = null; }
    knownMsgIds.clear();
    chrome.runtime.sendMessage({ type: 'client', ...client });
    watchMessages();
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
    watchMessages();
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
