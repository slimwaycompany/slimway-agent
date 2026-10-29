// Скрипт боковой панели — мост между iframe (scriptolog page) и background.js

const PANEL_ORIGIN = 'https://slimway-agent.onrender.com';
const iframe       = document.getElementById('panel');

// ── iframe → background ────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  // Принимаем только от нашего сервера
  if (e.origin !== PANEL_ORIGIN) return;
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'ready') {
    // Страница загрузилась — отправляем ей сохранённое состояние
    sendStateToPage();
    return;
  }

  if (msg.type === 'insert') {
    // Страница просит вставить текст → background → content script
    chrome.runtime.sendMessage({ type: 'insert', text: msg.text });
    return;
  }

  if (msg.type === 'login') {
    // Страница сообщила о входе → сохраняем токен
    chrome.runtime.sendMessage({ type: 'login', token: msg.token });
    return;
  }
});

// ── background (storage) → iframe ─────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.currentClient) {
    const client = changes.currentClient.newValue;
    if (client) postToPage(client);
  }
  if (changes.chatReady !== undefined) {
    postToPage({ type: 'chat-status', ready: changes.chatReady.newValue });
  }
  if (changes.managerName) {
    postToPage({ type: 'manager', name: changes.managerName.newValue });
  }
  if (changes.authToken) {
    postToPage({ type: 'auth', token: changes.authToken.newValue });
  }
  if (changes.chatMessages) {
    const oldLen = (changes.chatMessages.oldValue || []).length;
    const newMsgs = (changes.chatMessages.newValue || []).slice(oldLen);
    newMsgs.forEach(m => postToPage({ type: 'chat-message', direction: m.dir, text: m.text }));
  }
});

function postToPage(msg) {
  iframe.contentWindow?.postMessage(msg, PANEL_ORIGIN);
}

function sendStateToPage() {
  chrome.runtime.sendMessage({ type: 'get-state' }, (data) => {
    if (!data) return;
    if (data.authToken)    postToPage({ type: 'auth',        token:  data.authToken });
    if (data.managerName)  postToPage({ type: 'manager',     name:   data.managerName });
    if (data.currentClient) postToPage(data.currentClient);
    if (data.chatReady !== undefined) postToPage({ type: 'chat-status', ready: data.chatReady });
  });
}
