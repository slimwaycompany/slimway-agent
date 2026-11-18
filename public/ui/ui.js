(function () {
  'use strict';

  var toastEl, toastTimer;

  function getToast() {
    if (!toastEl) {
      toastEl = document.getElementById('shell-toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'ui-toast-el';
        toastEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
          'z-index:9999;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:500;' +
          'box-shadow:0 4px 24px rgba(0,0,0,.12);opacity:0;pointer-events:none;transition:opacity .2s;' +
          'background:var(--surface,#fff);color:var(--text,#0f172a);border:1px solid var(--border,#e5e8ec)';
        document.body.appendChild(toastEl);
      }
    }
    return toastEl;
  }

  function toast(text, type) {
    var el = getToast();
    el.textContent = text;
    if (el.classList) {
      el.classList.remove('show');
      void el.offsetWidth; // reflow
      el.classList.add('show');
      if (type === 'error') el.style.cssText += ';background:var(--danger-soft,#fef2f2);color:var(--danger,#dc2626);border-color:#fecaca';
      else if (type === 'success') el.style.cssText += ';background:var(--success-soft,#f0fdf4);color:var(--success,#16a34a);border-color:#bbf7d0';
    } else {
      el.style.opacity = '1';
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (el.classList) el.classList.remove('show');
      else el.style.opacity = '0';
    }, 3500);
  }

  function uiConfirm(message) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);' +
        'display:flex;align-items:center;justify-content:center;padding:16px';
      overlay.innerHTML =
        '<div style="background:var(--surface,#fff);border-radius:16px;padding:24px;width:min(400px,100%);' +
        'box-shadow:0 8px 40px rgba(0,0,0,.24);font-family:inherit">' +
        '<p style="font-size:15px;line-height:1.6;margin-bottom:20px;color:var(--text,#0f172a)">' + message + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
        '<button data-cancel style="padding:9px 16px;border:1.5px solid var(--border,#e5e8ec);background:none;' +
        'border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:var(--text,#0f172a)">Отмена</button>' +
        '<button data-ok style="padding:9px 16px;border:none;background:var(--danger,#dc2626);color:#fff;' +
        'border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600">Подтвердить</button>' +
        '</div></div>';
      document.body.appendChild(overlay);

      function done(val) {
        document.body.removeChild(overlay);
        resolve(val);
      }
      overlay.querySelector('[data-ok]').addEventListener('click', function () { done(true); });
      overlay.querySelector('[data-cancel]').addEventListener('click', function () { done(false); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') { done(false); document.removeEventListener('keydown', handler); }
        if (e.key === 'Enter') { done(true); document.removeEventListener('keydown', handler); }
      });
    });
  }

  window.ui = { toast: toast, confirm: uiConfirm };
})();
