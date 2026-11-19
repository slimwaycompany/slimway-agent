(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;

  // State
  var currentTab          = null;
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
    // Side badges — agent badge on manager-pane right and schedule-pane left
    setBadge('badge-side-agent',    agentNew);
    setBadge('badge-side-agent2',   agentNew);
    // Side badges — manager badge on agent-pane left
    setBadge('badge-side-manager',  managerNew);
    // Side badges — kviz badge on cashier-pane right
    setBadge('badge-side-kviz',     kvizDraftCount);
    updateDrawerBadges();
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
    measure:  '/kviz/measure',
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
  // tab name → catalog block key (cashier → kassa)
  var TAB_BLOCK = {
    manager:'manager', agent:'agent', schedule:'schedule', clients:'clients',
    funnel:'funnel', cashier:'kassa', kviz:'kviz', measure:'measure',
    reports:'reports', settings:'settings',
  };
  function canTab(name) {
    var perms = window.SW_PERMS;
    if (!perms) return true;
    var block = TAB_BLOCK[name];
    if (!block) return false;
    var prefix = block + '.';
    return Object.keys(perms).some(function(k) { return k.indexOf(prefix) === 0; });
  }

  function lazyIframe(paneId, iframeId, src, beforeId) {
    var f = document.createElement('iframe');
    f.id = iframeId; f.className = 'frame';
    f.src = src; f.setAttribute('allow', 'camera; clipboard-write');
    var pane = $(paneId);
    if (!pane) return;
    var anchor = beforeId ? $(beforeId) : null;
    if (anchor) pane.insertBefore(f, anchor);
    else pane.appendChild(f);
  }

  function scrollTabIntoView(name) {
    var btn = $('tab-btn-' + name);
    if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }

  function showTab(name) {
    if (!canTab(name)) return;
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
    setTimeout(function() { scrollTabIntoView(name); }, 50);

    if (name === 'manager') {
      $('manager-pane').classList.remove('hidden');
      $('tab-btn-manager').classList.add('active');
      if (!managerCreated) {
        // Insert iframe before the right side button "Агент"
        lazyIframe('manager-pane', 'manager-iframe', '/kviz/manager', 'side-to-agent');
        managerCreated = true;
      }
      history.replaceState(null, '', '#manager');

    } else if (name === 'agent') {
      $('agent-pane').classList.remove('hidden');
      $('tab-btn-agent').classList.add('active');
      agentSeenCount = agentAlertCount;
      history.replaceState(null, '', '#agent');

    } else if (name === 'schedule') {
      var sp = $('schedule-pane');
      if (!sp) return;
      sp.classList.remove('hidden');
      $('tab-btn-schedule').classList.add('active');
      if (!scheduleCreated) {
        lazyIframe('schedule-pane', 'schedule-iframe', '/kviz/crm/schedule', 'side-sched-to-clients');
        scheduleCreated = true;
      }
      history.replaceState(null, '', '#schedule');

    } else if (name === 'clients') {
      var cp = $('clients-pane');
      if (!cp) return;
      cp.classList.remove('hidden');
      $('tab-btn-clients').classList.add('active');
      if (!clientsCreated) {
        lazyIframe('clients-pane', 'clients-iframe', '/kviz/crm/clients', 'side-cl-to-funnel');
        clientsCreated = true;
      }
      history.replaceState(null, '', '#clients');

    } else if (name === 'funnel') {
      var fp = $('funnel-pane');
      if (!fp) return;
      fp.classList.remove('hidden');
      $('tab-btn-funnel').classList.add('active');
      if (!funnelCreated) {
        lazyIframe('funnel-pane', 'funnel-iframe', '/kviz/crm/funnel', 'side-fn-to-cashier');
        funnelCreated = true;
      }
      history.replaceState(null, '', '#funnel');

    } else if (name === 'cashier') {
      var xp = $('cashier-pane');
      if (!xp) return;
      xp.classList.remove('hidden');
      $('tab-btn-cashier').classList.add('active');
      if (!cashierCreated) {
        lazyIframe('cashier-pane', 'cashier-iframe', '/kviz/crm/cashier', 'side-cash-to-kviz');
        cashierCreated = true;
      }
      history.replaceState(null, '', '#cashier');

    } else if (name === 'kviz') {
      $('kviz-pane').classList.remove('hidden');
      $('tab-btn-kviz').classList.add('active');
      if (!kvizCreated) {
        // Insert iframe before right button "Замеры"
        lazyIframe('kviz-pane', 'kviz-iframe', '/kviz/', 'side-to-measure');
        kvizCreated = true;
      }
      history.replaceState(null, '', '#kviz');

    } else if (name === 'measure') {
      $('measure-pane').classList.remove('hidden');
      $('tab-btn-measure').classList.add('active');
      if (!measureCreated) {
        // Insert before right button "Отчёты" (injected server-side)
        var sideToReports = $('side-to-reports');
        if (sideToReports) $('measure-pane').insertBefore(
          (function(){ var f=document.createElement('iframe'); f.id='measure-iframe'; f.className='frame'; f.src='/kviz/measure'; f.setAttribute('allow','camera; clipboard-write'); return f; })(),
          sideToReports
        );
        else $('measure-pane').appendChild(
          (function(){ var f=document.createElement('iframe'); f.id='measure-iframe'; f.className='frame'; f.src='/kviz/measure'; f.setAttribute('allow','camera; clipboard-write'); return f; })()
        );
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
        // Insert before right button "Настройки" (admin only, may not exist)
        var sideToSettings = $('side-to-settings');
        var frep = document.createElement('iframe');
        frep.id = 'reports-iframe'; frep.className = 'frame';
        frep.src = '/kviz/reports'; frep.setAttribute('allow', 'camera; clipboard-write');
        if (sideToSettings) rp.insertBefore(frep, sideToSettings);
        else rp.appendChild(frep);
        reportsCreated = true;
      }
      history.replaceState(null, '', '#reports');

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

    updateDrawerBadges();
    updateDrawerState(name);
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

  // ── Side buttons ─────────────────────────────────────────────────────────────
  // Order: Manager(1)→Agent(2)→Schedule(3)→Clients(4)→Funnel(5)→Cashier(6)→Kviz(7)→Measure(8)→Reports(9)→Settings(10)

  // manager-pane: no left, right=Агент
  $('side-to-agent').onclick = function () { showTab('agent'); };

  // agent-pane: left=Менеджер, right=Расписание
  $('side-to-manager').onclick   = function () { showTab('manager'); };
  $('side-to-schedule').onclick  = function () { showTab('schedule'); };

  // schedule-pane: left=Агент, right=Клиенты
  $('side-sched-to-agent').onclick   = function () { showTab('agent'); };
  $('side-sched-to-clients').onclick = function () { showTab('clients'); };

  // clients-pane: left=Расписание, right=Воронка
  $('side-cl-to-schedule').onclick = function () { showTab('schedule'); };
  $('side-cl-to-funnel').onclick   = function () { showTab('funnel'); };

  // funnel-pane: left=Клиенты, right=Касса
  $('side-fn-to-clients').onclick  = function () { showTab('clients'); };
  $('side-fn-to-cashier').onclick  = function () { showTab('cashier'); };

  // cashier-pane: left=Воронка, right=Квалификация
  $('side-cash-to-funnel').onclick = function () { showTab('funnel'); };
  $('side-cash-to-kviz').onclick   = function () { showTab('kviz'); };

  // kviz-pane: left=Касса, right=Замеры
  $('side-kviz-to-cashier').onclick = function () { showTab('cashier'); };
  $('side-to-measure').onclick      = function () { showTab('measure'); };

  // measure-pane: left=Квалификация, right=Отчёты
  $('side-to-kviz2').onclick = function () { showTab('kviz'); };
  if ($('side-to-reports')) $('side-to-reports').onclick = function () { showTab('reports'); };

  // reports-pane: left=Замеры, right=Настройки (admin only)
  if ($('side-to-measure2'))  $('side-to-measure2').onclick  = function () { showTab('measure'); };
  if ($('side-to-settings'))  $('side-to-settings').onclick  = function () { showTab('settings'); };

  // settings-pane: left=Отчёты
  if ($('side-set-to-reports')) $('side-set-to-reports').onclick = function () { showTab('reports'); };

  // ── Permission filtering (SW_PERMS) ─────────────────────────────────────────
  var SIDE_TARGETS = {
    'side-to-agent': 'agent', 'side-to-manager': 'manager', 'side-to-schedule': 'schedule',
    'side-sched-to-agent': 'agent', 'side-sched-to-clients': 'clients',
    'side-cl-to-schedule': 'schedule', 'side-cl-to-funnel': 'funnel',
    'side-fn-to-clients': 'clients', 'side-fn-to-cashier': 'cashier',
    'side-cash-to-funnel': 'funnel', 'side-cash-to-kviz': 'kviz',
    'side-kviz-to-cashier': 'cashier', 'side-to-measure': 'measure',
    'side-to-kviz2': 'kviz', 'side-to-reports': 'reports',
    'side-to-measure2': 'measure', 'side-to-settings': 'settings',
    'side-set-to-reports': 'reports',
  };
  function applyPermissions() {
    var tabNames2 = ['manager','agent','schedule','clients','funnel','cashier','kviz','measure','reports'];
    for (var ti = 0; ti < tabNames2.length; ti++) {
      var tn = tabNames2[ti];
      if (!canTab(tn)) {
        var tb = $('tab-btn-' + tn);
        if (tb) tb.style.display = 'none';
        var cb = $('choice-' + tn);
        if (cb) cb.style.display = 'none';
      }
    }
    for (var sid in SIDE_TARGETS) {
      var sel = $(sid);
      if (sel && !canTab(SIDE_TARGETS[sid])) sel.style.display = 'none';
    }
  }
  applyPermissions();

  // ── Logout ──────────────────────────────────────────────────────────────────
  $('logout-btn').onclick = function () {
    try { sessionStorage.removeItem('sw-session'); } catch (e) {}
    fetch('/api/logout', { method: 'POST' }).finally(function () {
      location.href = '/login';
    });
  };

  // ── Keyboard shortcuts: Alt+1-0 ────────────────────────────────────────────
  // Order: 1=Manager,2=Agent,3=Schedule,4=Clients,5=Funnel,6=Cashier,7=Kviz,8=Measure,9=Reports,0=Settings
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
      if (h === valid[i] && currentTab !== valid[i] && canTab(valid[i])) { showTab(valid[i]); return; }
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
          lazyIframe('kviz-pane', 'kviz-iframe', d.path, 'side-to-measure');
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
    if (d.type === 'open-cashier') {
      showTab('kassa');
    }
    if (d.type === 'open-schedule') {
      showTab('schedule');
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

  // ── Tab names map (for tab label) ──────────────────────────────────────────
  var TAB_LABEL = {
    manager: 'Менеджер', agent: 'Агент', schedule: 'Расписание',
    clients: 'Клиенты', funnel: 'Воронка', cashier: 'Касса',
    kviz: 'Квалификация', measure: 'Замеры', reports: 'Отчёты', settings: 'Настройки',
  };
  var _S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  var TAB_ICON = {
    manager:  '<svg ' + _S + '><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>',
    agent:    '<svg ' + _S + '><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    schedule: '<svg ' + _S + '><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    clients:  '<svg ' + _S + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    funnel:   '<svg ' + _S + '><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    cashier:  '<svg ' + _S + '><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
    kviz:     '<svg ' + _S + '><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    measure:  '<svg ' + _S + '><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>',
    reports:  '<svg ' + _S + '><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    settings: '<svg ' + _S + '><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  // ── Drawer ──────────────────────────────────────────────────────────────────
  var drawerBackdrop = $('drawer-backdrop');
  var drawerEl = $('drawer');
  var drawerItems = $('drawer-items');

  function openDrawer() {
    if (drawerEl) drawerEl.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (drawerEl) drawerEl.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Build drawer from existing tab buttons
  function buildDrawer() {
    if (!drawerItems) return;
    var tabNames = ['manager','agent','schedule','clients','funnel','cashier','kviz','measure','reports','settings'];
    for (var i = 0; i < tabNames.length; i++) {
      var n = tabNames[i];
      if (!$(n + '-pane')) continue;
      if (!canTab(n)) continue;
      var item = document.createElement('button');
      item.className = 'drawer-item'; item.id = 'di-' + n; item.dataset.tab = n;
      var badge = document.createElement('span');
      badge.className = 'drawer-ibadge'; badge.id = 'dibadge-' + n;
      item.innerHTML = (TAB_ICON[n] ? '<span class="di-icon">' + TAB_ICON[n] + '</span>' : '') + '<span>' + (TAB_LABEL[n] || n) + '</span>';
      item.appendChild(badge);
      (function(tabName){ item.onclick = function(){ showTab(tabName); closeDrawer(); }; })(n);
      drawerItems.appendChild(item);
    }
  }
  buildDrawer();

  // Set drawer user name from ua-menu
  var uaMenuNameEl = document.querySelector('.ua-menu-name');
  var drawerUserEl = $('drawer-user-name');
  var choiceGreetingEl = $('choice-greeting');
  if (uaMenuNameEl) {
    var dname = uaMenuNameEl.textContent || '';
    if (drawerUserEl) drawerUserEl.textContent = dname;
    if (choiceGreetingEl) choiceGreetingEl.textContent = 'Привет, ' + dname + ' 👋';
  }

  // Ham button
  var hamBtn = $('ham-btn');
  if (hamBtn) hamBtn.onclick = function(e) { e.stopPropagation(); openDrawer(); };
  if (drawerBackdrop) drawerBackdrop.onclick = closeDrawer;
  var drawerExitBtn = $('drawer-exit');
  if (drawerExitBtn) drawerExitBtn.onclick = function() {
    try { sessionStorage.removeItem('sw-session'); } catch(e){}
    fetch('/api/logout', { method: 'POST' }).finally(function(){ location.href = '/login'; });
  };

  // Swipe left on drawer to close
  var touchStartX = 0;
  if (drawerEl) {
    drawerEl.addEventListener('touchstart', function(e){ touchStartX = e.touches[0].clientX; }, { passive: true });
    drawerEl.addEventListener('touchend', function(e){
      if (touchStartX - e.changedTouches[0].clientX > 60) closeDrawer();
    }, { passive: true });
  }

  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeDrawer(); });

  // Update drawer active item and tab label
  function updateDrawerState(name) {
    var tabLabel = $('tab-label');
    if (tabLabel) tabLabel.textContent = TAB_LABEL[name] || name;
    var items = document.querySelectorAll('.drawer-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.tab === name);
    }
  }

  // Update drawer badges
  function updateDrawerBadges() {
    var agentNew   = (currentTab === 'agent')   ? 0 : Math.max(0, agentAlertCount - agentSeenCount);
    var managerNew = (currentTab === 'manager') ? 0 : managerOverdueCount;
    function setDB(tab, n) {
      var el = $('dibadge-' + tab);
      if (!el) return;
      if (n > 0) { el.textContent = String(n); el.style.display = 'inline-flex'; }
      else el.style.display = 'none';
    }
    setDB('agent', agentNew);
    setDB('manager', managerNew);
    setDB('kviz', kvizDraftCount);
    // Ham dot: show if any badge
    var hamDot = $('ham-dot');
    if (hamDot) hamDot.style.display = (agentNew + managerNew + kvizDraftCount > 0) ? 'block' : 'none';
  }

  // ── Mobile user avatar button ───────────────────────────────────────────────
  var uaBtn = $('ua-btn');
  var uaMenu = $('ua-menu');
  var uaExit = $('ua-menu-exit');
  if (uaBtn && uaMenu) {
    // Set initial from logout button text (contains display_name)
    var logoutBtnEl = $('logout-btn');
    if (logoutBtnEl) {
      var fullText = (logoutBtnEl.textContent || '').trim().split(' ')[0] || '?';
      uaBtn.textContent = fullText.charAt(0).toUpperCase();
    }
    uaBtn.onclick = function (e) {
      e.stopPropagation();
      uaMenu.classList.toggle('open');
    };
    document.addEventListener('click', function () { uaMenu.classList.remove('open'); });
  }
  if (uaExit) {
    uaExit.onclick = function () {
      try { sessionStorage.removeItem('sw-session'); } catch (e) {}
      fetch('/api/logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
    };
  }

  // ── Theme toggle ────────────────────────────────────────────────────────────
  function applyShellTheme(val, skipServer) {
    var root = document.documentElement;
    if (val === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('sw-theme', val); } catch (e) {}
    // Update active state on all theme buttons
    var btns = document.querySelectorAll('[data-theme-val]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-theme-val') === val);
    }
    // Broadcast to all iframes immediately
    var frames = document.querySelectorAll('iframe.frame');
    for (var j = 0; j < frames.length; j++) {
      try { frames[j].contentWindow.postMessage({ type: 'sw-theme', theme: val }, origin); } catch (e) {}
    }
    // Save to server (fire-and-forget; on error next page load re-syncs from DB)
    if (!skipServer) {
      fetch('/kviz/api/me/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ui_theme: val }), credentials: 'include' })
        .catch(function () {});
    }
  }

  // Read initial theme from server-rendered DOM (always correct), sync cache
  var initThemeVal = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem('sw-theme', initThemeVal); } catch (e) {}

  var allThemeBtns = document.querySelectorAll('[data-theme-val]');
  for (var ti = 0; ti < allThemeBtns.length; ti++) {
    (function (btn) {
      btn.addEventListener('click', function () { applyShellTheme(btn.getAttribute('data-theme-val')); });
      btn.classList.toggle('active', btn.getAttribute('data-theme-val') === initThemeVal);
    }(allThemeBtns[ti]));
  }

  // Broadcast initial theme to iframes when they load (handles the agent-iframe case)
  var frames = document.querySelectorAll('iframe.frame');
  for (var fi = 0; fi < frames.length; fi++) {
    (function (f) {
      f.addEventListener('load', function () {
        try { f.contentWindow.postMessage({ type: 'sw-theme', theme: initThemeVal }, origin); } catch (e) {}
      });
    }(frames[fi]));
  }

  // ── Restore last tab on reload ──────────────────────────────────────────────
  try {
    var inSession = sessionStorage.getItem('sw-session');
    var lastTab   = localStorage.getItem('sw-last-tab');
    var valid     = ['manager', 'agent', 'kviz', 'measure', 'reports', 'schedule', 'clients', 'funnel', 'cashier', 'settings'];
    if (inSession && lastTab && valid.indexOf(lastTab) >= 0) {
      if (canTab(lastTab)) {
        showTab(lastTab);
      } else {
        // saved tab now inaccessible — go to first accessible
        for (var ri = 0; ri < valid.length; ri++) {
          if (canTab(valid[ri]) && $(valid[ri] + '-pane')) { showTab(valid[ri]); break; }
        }
      }
    }
  } catch (e) {}
})();
