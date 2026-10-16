(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;

  // State
  var currentTab       = null; // null=choice, 'agent', 'kviz'
  var agentAlertCount  = 0;
  var agentSeenCount   = 0;
  var kvizDraftCount   = 0;
  var kvizCreated      = false;

  // ── Badge helpers ───────────────────────────────────────────────────────────
  function setBadge(id, n) {
    var el = $(id);
    if (!el) return;
    if (n > 0) { el.textContent = String(n); el.style.display = 'inline-flex'; }
    else       { el.style.display = 'none'; }
  }

  function updateBadges() {
    var agentNew = (currentTab === 'agent') ? 0 : Math.max(0, agentAlertCount - agentSeenCount);
    setBadge('badge-choice-agent', agentAlertCount);
    setBadge('badge-choice-kviz',  kvizDraftCount);
    setBadge('badge-tab-agent',    agentNew);
    setBadge('badge-tab-kviz',     kvizDraftCount);
    setBadge('badge-side-agent',   agentNew);
    setBadge('badge-side-kviz',    kvizDraftCount);
  }

  // ── Tab switching ───────────────────────────────────────────────────────────
  function showTab(name) {
    currentTab = name;

    $('choice-screen').style.display = 'none';
    $('top-bar').style.display = 'flex';

    var agentPane = $('agent-pane');
    var kvizPane  = $('kviz-pane');
    var btnAgent  = $('tab-btn-agent');
    var btnKviz   = $('tab-btn-kviz');

    if (name === 'agent') {
      agentPane.classList.remove('hidden');
      kvizPane.classList.add('hidden');
      btnAgent.classList.add('active');
      btnKviz.classList.remove('active');
      agentSeenCount = agentAlertCount;
      history.replaceState(null, '', '#agent');
    } else {
      agentPane.classList.add('hidden');
      kvizPane.classList.remove('hidden');
      btnAgent.classList.remove('active');
      btnKviz.classList.add('active');
      if (!kvizCreated) {
        var f = document.createElement('iframe');
        f.id        = 'kviz-iframe';
        f.className = 'frame';
        f.src       = '/kviz/';
        f.setAttribute('allow', 'clipboard-write');
        kvizPane.appendChild(f);
        kvizCreated = true;
      }
      history.replaceState(null, '', '#kviz');
    }

    updateBadges();
  }

  // ── Choice buttons ──────────────────────────────────────────────────────────
  $('choice-agent').onclick = function () { showTab('agent'); };
  $('choice-kviz').onclick  = function () { showTab('kviz'); };

  // ── Tab / side buttons ──────────────────────────────────────────────────────
  $('tab-btn-agent').onclick = function () { showTab('agent'); };
  $('tab-btn-kviz').onclick  = function () { showTab('kviz'); };
  $('side-to-kviz').onclick  = function () { showTab('kviz'); };
  $('side-to-agent').onclick = function () { showTab('agent'); };

  // ── Logout ──────────────────────────────────────────────────────────────────
  $('logout-btn').onclick = function () {
    fetch('/api/logout', { method: 'POST' }).finally(function () {
      location.href = '/login';
    });
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === '1' || e.code === 'Digit1')) { e.preventDefault(); showTab('agent'); }
    if (e.altKey && (e.key === '2' || e.code === 'Digit2')) { e.preventDefault(); showTab('kviz'); }
  });

  // ── Hash navigation (back / forward only, not on initial load) ──────────────
  window.addEventListener('hashchange', function () {
    if (currentTab === null) return; // choice screen visible, ignore hash
    var h = location.hash.slice(1);
    if (h === 'kviz' && currentTab !== 'kviz') showTab('kviz');
    else if (h === 'agent' && currentTab !== 'agent') showTab('agent');
  });

  // ── postMessage from iframes ────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) return;
    var d = e.data;
    if (!d || !d.type) return;

    if (d.type === 'agent:alerts') {
      agentAlertCount = typeof d.count === 'number' ? d.count : agentAlertCount;
      if (currentTab === 'agent') agentSeenCount = agentAlertCount;
      updateBadges();
    }
    if (d.type === 'kviz:title') {
      var lbl = $('kviz-tab-text');
      if (lbl) lbl.textContent = d.text ? 'Квалификация · ' + d.text : 'Квалификация';
    }
    if (d.type === 'kviz:done') {
      var map = { hot: '🔥 Горячий', warm: '🌤 Тёплый', cold: '❄️ Холодный', stop: '🚫 Стоп', postpone: '⏸ Отложен' };
      showToast('Квалификация сохранена: ' + (map[d.temperature] || d.temperature || ''));
    }
    if (d.type === 'open-kviz') {
      showTab('kviz');
      if (d.path) {
        var frame = $('kviz-iframe');
        if (frame) {
          frame.src = d.path;
        } else {
          // kviz pane just created; attach iframe with the target path
          var f2 = document.createElement('iframe');
          f2.id        = 'kviz-iframe';
          f2.className = 'frame';
          f2.src       = d.path;
          f2.setAttribute('allow', 'clipboard-write');
          $('kviz-pane').appendChild(f2);
          kvizCreated = true;
        }
      }
    }
    if (d.type === 'auth-required') {
      location.href = '/login';
    }
  });

  // ── Toast ───────────────────────────────────────────────────────────────────
  var toastEl = $('shell-toast');
  var toastTimer = null;
  function showToast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  // ── Poll kviz draft count ───────────────────────────────────────────────────
  function pollDrafts() {
    fetch('/kviz/api/sessions?status=draft', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        kvizDraftCount = Array.isArray(data) ? data.length : 0;
        updateBadges();
      })
      .catch(function () {});
  }
  pollDrafts();
  setInterval(pollDrafts, 30000);

  updateBadges();
})();
