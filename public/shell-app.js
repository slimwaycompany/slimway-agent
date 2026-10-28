(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;

  // State
  var currentTab          = null; // null=choice, 'manager', 'agent', 'kviz', 'measure', 'reports', 'schedule', 'clients', 'funnel', 'cashier', 'settings'
  var agentAlertCount     = 0;
  var agentSeenCount      = 0;
  var kvizDraftCount      = 0;
  var managerOverdueCount = 0;
  var kvizCreated         = false;
  var measureCreated      = false;
  var managerCreated      = false;
  var reportsCreated      = false;
  var scheduleCreated     = false;
  var clientsCreated      = false;
  var funnelCreated       = false;
  var cashierCreated      = false;
  var settingsCreated     = false;

  // ── Badge helpers ───────────────────────────────────────────────────────────
  function setBadge(id, n) {
    var el = $(id);
    if (!el) return;
    if (n > 0) { el.textContent = String(n); el.style.display = 'inline-flex'; }
    else       { el.style.display = 'none'; }
  }

  function updateBadges() {
    var agentNew   = (currentTab === 'agent')   ? 0 : Math.max(0, agentAlertCount - agentSeenCount);
    var managerNew = (currentTab === 'manager') ? 0 : managerOverdueCount;
    setBadge('badge-tab-manager',    managerNew);
    setBadge('badge-tab-agent',      agentNew);
    setBadge('badge-tab-kviz',       kvizDraftCount);
    setBadge('badge-choice-manager', managerOverdueCount);
    setBadge('badge-choice-agent',   agentAlertCount);
    setBadge('badge-choice-kviz',    kvizDraftCount);
    setBadge('badge-side-agent',     agentNew);
    setBadge('badge-side-manager',   managerNew);
    setBadge('badge-side-kviz',      kvizDraftCount);
    setBadge('badge-side-agent2',    agentNew);
  }

  function hidePanes() {
    var ids = ['manager-pane', 'agent-pane', 'kviz-pane', 'measure-pane', 'reports-pane',
               'schedule-pane', 'clients-pane', 'funnel-pane', 'cashier-pane', 'settings-pane'];
    for (var i = 0; i < ids.length; i++) {
      var p = $(ids[i]);
      if (p) p.classList.add('hidden');
    }
    var tabs = ['tab-btn-manager', 'tab-btn-agent', 'tab-btn-kviz', 'tab-btn-measure', 'tab-btn-reports',
                'tab-btn-schedule', 'tab-btn-clients', 'tab-btn-funnel', 'tab-btn-cashier', 'tab-btn-settings'];
    for (var j = 0; j < tabs.length; j++) {
      var b = $(tabs[j]);
      if (b) b.classList.remove('active');
    }
  }

  // ── Tab persistence ─────────────────────────────────────────────────────────
  function saveTab(name) {
    try {
      localStorage.setItem('sw-last-tab', name);
      sessionStorage.setItem('sw-session', '1');
    } catch (e) {}
  }

  // ── Tab switching ───────────────────────────────────────────────────────────
  var TAB_HOME = {
    manager:  '/kviz/manager',
    agent:    '/window',
    kviz:     '/kviz/',
    measure:  '/kviz/measure/new',
    reports:  '/kviz/reports',
    schedule: '/kviz/crm/schedule',
    clients:  '/kviz/crm/clients',
    funnel:   '/kviz/crm/funnel',
    cashier:  '/kviz/crm/cashier',
    settings: '/kviz/crm/settings',
  };
  var TAB_FRAME = {
    manager:  'manager-iframe',
    agent:    'agent-iframe',
    kviz:     'kviz-iframe',
    measure:  'measure-iframe',
    reports:  'reports-iframe',
    schedule: 'schedule-iframe',
    clients:  'clients-iframe',
    funnel:   'funnel-iframe',
    cashier:  'cashier-iframe',
    settings: 'settings-iframe',
  };

  function lazyIframe(paneId, iframeId, src, before) {
    var f = document.createElement('iframe');
    f.id = iframeId; f.className = 'frame';
    f.src = src; f.setAttribute('allow', 'clipboard-write');
    var pane = $(paneId);
    if (!pane) return;
    var anchor = before ? $(before) : null;
    if (anchor) pane.insertBefore(f, anchor);
    else pane.appendChild(f);
  }

  function showTab(name) {
    if (currentTab === name) {
      var fr = $(TAB_FRAME[name]);
      if (fr) fr.src = TAB_HOME[name];
      return;
    }
    currentTab = name;
    $('choice-screen').style.display = 'none';
    $('top-bar').style.display = 'flex';
    hidePanes();
    saveTab(name);

    if (name === 'manager') {
      $('manager-pane').classList.remove('hidden');
      $('tab-btn-manager').classList.add('active');
      if (!managerCreated) {
        var fm = document.createElement('iframe');
        fm.id = 'manager-iframe'; fm.className = 'frame';
        fm.src = '/kviz/manager'; fm.setAttribute('allow', 'clipboard-write');
        $('manager-pane').insertBefore(fm, $('side-to-agent'));
        managerCreated = true;
      }
      history.replaceState(null, '', '#manager');
    } else if (name === 'agent') {
      $('agent-pane').classList.remove('hidden');
      $('tab-btn-agent').classList.add('active');
      agentSeenCount = agentAlertCount;
      history.replaceState(null, '', '#agent');
    } else if (name === 'kviz') {
      $('kviz-pane').classList.remove('hidden');
      $('tab-btn-kviz').classList.add('active');
      if (!kvizCreated) {
        var fk = document.createElement('iframe');
        fk.id = 'kviz-iframe'; fk.className = 'frame';
        fk.src = '/kviz/'; fk.setAttribute('allow', 'clipboard-write');
        $('kviz-pane').insertBefore(fk, $('side-to-measure'));
        kvizCreated = true;
      }
      history.replaceState(null, '', '#kviz');
    } else if (name === 'measure') {
      $('measure-pane').classList.remove('hidden');
      $('tab-btn-measure').classList.add('active');
      if (!measureCreated) {
        var fme = document.createElement('iframe');
        fme.id = 'measure-iframe'; fme.className = 'frame';
        fme.src = '/kviz/measure/new'; fme.setAttribute('allow', 'clipboard-write');
        var sideToReports = $('side-to-reports');
        if (sideToReports) $('measure-pane').insertBefore(fme, sideToReports);
        else $('measure-pane').appendChild(fme);
        measureCreated = true;
      }
      history.replaceState(null, '', '#measure');
    } else if (name === 'reports') {
      var rp = $('reports-pane');
      if (!rp) return;
      rp.classList.remove('hidden');
      var trb = $('tab-btn-reports');
      if (trb) trb.classList.add('active');
      if (!reportsCreated) {
        var frep = document.createElement('iframe');
        frep.id = 'reports-iframe'; frep.className = 'frame';
        frep.src = '/kviz/reports'; frep.setAttribute('allow', 'clipboard-write');
        var sideM2 = $('side-to-measure2');
        if (sideM2) rp.insertBefore(frep, sideM2);
        else rp.appendChild(frep);
        reportsCreated = true;
      }
      history.replaceState(null, '', '#reports');
    } else if (name === 'schedule') {
      var sp = $('schedule-pane');
      if (!sp) return;
      sp.classList.remove('hidden');
      $('tab-btn-schedule').classList.add('active');
      if (!scheduleCreated) {
        lazyIframe('schedule-pane', 'schedule-iframe', '/kviz/crm/schedule', null);
        scheduleCreated = true;
      }
      history.replaceState(null, '', '#schedule');
    } else if (name === 'clients') {
      var cp = $('clients-pane');
      if (!cp) return;
      cp.classList.remove('hidden');
      $('tab-btn-clients').classList.add('active');
      if (!clientsCreated) {
        lazyIframe('clients-pane', 'clients-iframe', '/kviz/crm/clients', null);
        clientsCreated = true;
      }
      history.replaceState(null, '', '#clients');
    } else if (name === 'funnel') {
      var fp = $('funnel-pane');
      if (!fp) return;
      fp.classList.remove('hidden');
      $('tab-btn-funnel').classList.add('active');
      if (!funnelCreated) {
        lazyIframe('funnel-pane', 'funnel-iframe', '/kviz/crm/funnel', null);
        funnelCreated = true;
      }
      history.replaceState(null, '', '#funnel');
    } else if (name === 'cashier') {
      var xp = $('cashier-pane');
      if (!xp) return;
      xp.classList.remove('hidden');
      $('tab-btn-cashier').classList.add('active');
      if (!cashierCreated) {
        lazyIframe('cashier-pane', 'cashier-iframe', '/kviz/crm/cashier', null);
        cashierCreated = true;
      }
      history.replaceState(null, '', '#cashier');
    } else if (name === 'settings') {
      var stp = $('settings-pane');
      if (!stp) return;
      stp.classList.remove('hidden');
      var stb = $('tab-btn-settings');
      if (stb) stb.classList.add('active');
      if (!settingsCreated) {
        lazyIframe('settings-pane', 'settings-iframe', '/kviz/crm/settings', null);
        settingsCreated = true;
      }
      history.replaceState(null, '', '#settings');
    }

    updateBadges();
  }

  // ── Choice buttons ──────────────────────────────────────────────────────────
  $('choice-manager').onclick  = function () { showTab('manager'); };
  $('choice-agent').onclick    = function () { showTab('agent'); };
  $('choice-kviz').onclick     = function () { showTab('kviz'); };
  $('choice-measure').onclick  = function () { showTab('measure'); };
  $('choice-schedule').onclick = function () { showTab('schedule'); };
  $('choice-clients').onclick  = function () { showTab('clients'); };
  $('choice-funnel').onclick   = function () { showTab('funnel'); };
  $('choice-cashier').onclick  = function () { showTab('cashier'); };
  if ($('choice-reports'))  $('choice-reports').onclick  = function () { showTab('reports'); };
  if ($('choice-settings')) $('choice-settings').onclick = function () { showTab('settings'); };

  // ── Tab buttons ─────────────────────────────────────────────────────────────
  $('tab-btn-manager').onclick  = function () { showTab('manager'); };
  $('tab-btn-agent').onclick    = function () { showTab('agent'); };
  $('tab-btn-kviz').onclick     = function () { showTab('kviz'); };
  $('tab-btn-measure').onclick  = function () { showTab('measure'); };
  $('tab-btn-schedule').onclick = function () { showTab('schedule'); };
  $('tab-btn-clients').onclick  = function () { showTab('clients'); };
  $('tab-btn-funnel').onclick   = function () { showTab('funnel'); };
  $('tab-btn-cashier').onclick  = function () { showTab('cashier'); };
  if ($('tab-btn-reports'))  $('tab-btn-reports').onclick  = function () { showTab('reports'); };
  if ($('tab-btn-settings')) $('tab-btn-settings').onclick = function () { showTab('settings'); };

  // ── Side buttons ────────────────────────────────────────────────────────────
  $('side-to-agent').onclick   = function () { showTab('agent'); };    // manager-pane right
  $('side-to-manager').onclick = function () { showTab('manager'); };  // agent-pane left
  $('side-to-kviz').onclick    = function () { showTab('kviz'); };     // agent-pane right
  $('side-to-agent2').onclick  = function () { showTab('agent'); };    // kviz-pane left
  $('side-to-measure').onclick = function () { showTab('measure'); };  // kviz-pane right
  $('side-to-kviz2').onclick   = function () { showTab('kviz'); };     // measure-pane left
  if ($('side-to-reports'))  $('side-to-reports').onclick  = function () { showTab('reports'); };
  if ($('side-to-measure2')) $('side-to-measure2').onclick = function () { showTab('measure'); };

  // ── Logout ──────────────────────────────────────────────────────────────────
  $('logout-btn').onclick = function () {
    try { sessionStorage.removeItem('sw-session'); } catch (e) {}
    fetch('/api/logout', { method: 'POST' }).finally(function () {
      location.href = '/login';
    });
  };

  // ── Keyboard shortcuts: Alt+1-9, Alt+0 ────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (!e.altKey) return;
    if (e.key === '1' || e.code === 'Digit1') { e.preventDefault(); showTab('manager'); }
    if (e.key === '2' || e.code === 'Digit2') { e.preventDefault(); showTab('agent'); }
    if (e.key === '3' || e.code === 'Digit3') { e.preventDefault(); showTab('schedule'); }
    if (e.key === '4' || e.code === 'Digit4') { e.preventDefault(); showTab('clients'); }
    if (e.key === '5' || e.code === 'Digit5') { e.preventDefault(); showTab('funnel'); }
    if (e.key === '6' || e.code === 'Digit6') { e.preventDefault(); showTab('cashier'); }
    if (e.key === '7' || e.code === 'Digit7') { e.preventDefault(); showTab('kviz'); }
    if (e.key === '8' || e.code === 'Digit8') { e.preventDefault(); showTab('measure'); }
    if (e.key === '9' || e.code === 'Digit9') { e.preventDefault(); showTab('reports'); }
    if ((e.key === '0' || e.code === 'Digit0') && $('settings-pane')) { e.preventDefault(); showTab('settings'); }
  });

  // ── Hash navigation ─────────────────────────────────────────────────────────
  window.addEventListener('hashchange', function () {
    if (currentTab === null) return;
    var h = location.hash.slice(1);
    var valid = ['manager','agent','kviz','measure','reports','schedule','clients','funnel','cashier','settings'];
    for (var i = 0; i < valid.length; i++) {
      if (h === valid[i] && currentTab !== valid[i]) { showTab(valid[i]); return; }
    }
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
    if (d.type === 'manager:overdue') {
      managerOverdueCount = typeof d.count === 'number' ? d.count : managerOverdueCount;
      updateBadges();
    }
    if (d.type === 'kviz:title') {
      var lbl = $('kviz-tab-text');
      if (lbl) lbl.textContent = d.text ? 'Квалификация · ' + d.text : 'Квалификация';
    }
    if (d.type === 'kviz:done') {
      var map = { hot: '🔥 Горячий', warm: '🌤 Тёплый', cold: '❄️ Холодный', stop: '🚫 Стоп', postpone: '⏸ Отложен' };
      showToast('Квалификация сохранена: ' + (map[d.temperature] || d.temperature || ''));
    }
    if (d.type === 'open-kviz') {
      showTab('kviz');
      if (d.path) {
        var frame = $('kviz-iframe');
        if (frame) {
          frame.src = d.path;
        } else {
          var fk2 = document.createElement('iframe');
          fk2.id = 'kviz-iframe'; fk2.className = 'frame';
          fk2.src = d.path; fk2.setAttribute('allow', 'clipboard-write');
          $('kviz-pane').insertBefore(fk2, $('side-to-measure'));
          kvizCreated = true;
        }
      }
    }
    if (d.type === 'open-measure') {
      showTab('measure');
      if (d.path) {
        var fm2 = $('measure-iframe');
        if (fm2) fm2.src = d.path;
      }
    }
    if (d.type === 'open-clients') {
      showTab('clients');
      if (d.path) {
        var fc = $('clients-iframe');
        if (fc) fc.src = d.path;
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

  // ── Restore last tab on reload (skip choice screen) ────────────────────────
  try {
    var inSession = sessionStorage.getItem('sw-session');
    var lastTab   = localStorage.getItem('sw-last-tab');
    var valid     = ['manager', 'agent', 'kviz', 'measure', 'reports', 'schedule', 'clients', 'funnel', 'cashier', 'settings'];
    if (inSession && lastTab && valid.indexOf(lastTab) >= 0) {
      showTab(lastTab);
    }
  } catch (e) {}
})();
