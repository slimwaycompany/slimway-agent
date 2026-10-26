// Service worker расширения Скриптолог SlimWay

const PANEL_PAGE = 'https://slimway-agent.onrender.com';

// Открывать боковую панель кликом по иконке
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Хранилище текущего состояния ───────────────────────────────────────────

// Клиентка и статус чата сохраняются в storage, sidepanel.js слушает onChanged.

// ── Маршрутизация сообщений ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // От контент-скриптов → в storage (sidepanel.js получит через onChanged)
  if (msg.type === 'client') {
    chrome.storage.local.set({ currentClient: msg });
    return;
  }

  if (msg.type === 'chat-status') {
    chrome.storage.local.set({ chatReady: msg.ready });
    return;
  }

  if (msg.type === 'manager') {
    chrome.storage.local.set({ managerName: msg.name });
    return;
  }

  // От sidepanel.js → вставка текста в активную вкладку
  if (msg.type === 'insert') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { type: 'insert', text: msg.text })
        .catch(() => {
          // EasyChat может быть в iframe — ищем все фреймы
          chrome.webNavigation?.getAllFrames({ tabId: tab.id }, (frames) => {
            if (!frames) return;
            frames.forEach(f => {
              if (f.url.includes('chat.easychat.ru')) {
                chrome.tabs.sendMessage(tab.id, { type: 'insert', text: msg.text }, { frameId: f.frameId })
                  .catch(() => {});
              }
            });
          });
        });
    });
    return;
  }

  // От iframe страницы (через sidepanel.js) → сохранить токен
  if (msg.type === 'login') {
    chrome.storage.local.set({ authToken: msg.token });
    return;
  }

  // Синхронный запрос состояния от sidepanel.js
  if (msg.type === 'get-state') {
    chrome.storage.local.get(['authToken', 'managerName', 'currentClient', 'chatReady'], (data) => {
      sendResponse(data);
    });
    return true; // async
  }
});
