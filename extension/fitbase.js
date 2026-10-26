// Контент-скрипт для slimway.fitbase.io — читает имя залогиненного менеджера
// и сохраняет в chrome.storage.local.

(function () {
  'use strict';

  function extractFirstName(fullName) {
    // «Ревнивцев Сергей» → «Сергей»
    const parts = (fullName || '').trim().split(/\s+/);
    return parts.length >= 2 ? parts[1] : parts[0] || '';
  }

  function readManager() {
    const el = document.querySelector('a.user-profile');
    if (!el) return '';
    return extractFirstName(el.textContent.trim());
  }

  let lastManager = '';

  function checkManager() {
    const name = readManager();
    if (!name || name === lastManager) return;
    lastManager = name;
    chrome.storage.local.set({ managerName: name });
    chrome.runtime.sendMessage({ type: 'manager', name });
  }

  checkManager();
  // Fitbase SPA — наблюдаем за изменениями шапки
  const observer = new MutationObserver(() => checkManager());
  observer.observe(document.body, { childList: true, subtree: true });
})();
