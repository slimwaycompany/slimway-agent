(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var origin = location.origin;

  // State
  var currentTab          = null; // null=choice, 'manager', 'agent', 'kviz', 'measure', 'reports', 'metrics'
  var agentAlertCount     = 0;
  var agentSeenCount      = 0;
  var kvizDraftCount      = 0;
  var managerOverdueCount = 0;
  var kvizCreated         = false;
  var measureCreated      = false;
  var managerCreated      = false;
  var reportsCreated      = false;
  var metricsCreated      = false;

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
    setBadge('badge-side-agent',     agentNew);     // manager-pane right → agent
    setBadge('badge-side-manager',   managerNew);   // agent-pane left → manager
    setBadge('badge-side-kviz',      kvizDraftCount); // agent-pane right → kviz
    setBadge('badge-side-agent2',    agentNew);     // kviz-pane left → agent
  }

  function hidePanes() {
    var ids = ['manager-pane', 'agent-pane', 'kviz-pane', 'measure-pane', 'reports-pane', 'metrics-pane'];
    for (var i = 0; i < ids.length; i++) {
      var p = $(ids[i]);
      if (p) p.classList.add('hidden');
    }
    var tabs = ['tab-btn-manager', 'tab-btn-agent', 'tab-btn-kviz', 'tab-btn-measure', 'tab-btn-reports', 'tab-btn-metrics'];
    for (var j = 0; j < tabs.length; j++) {
      var b = $(tabs[j]);
      if (b) b.classList.remove('active');
    }
  }

  // ── Tab switching ───────────────────────────────────────────────────────────
  function showTab(name) {
    currentTab = name;
    $('choice-screen').style.display = 'none';
    $('top-bar').style.display = 'flex';
    hidePanes();

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
    } else if (name === 'metrics') {
      var mp = $('metrics-pane');
      if (!mp) return;
      mp.classList.remove('hidden');
      var tmb = $('tab-btn-metrics');
      if (tmb) tmb.classList.add('active');
      if (!metricsCreated) {
        var fmet = document.createElement('iframe');
        fmet.id = 'metrics-iframe'; fmet.className = 'frame';
        fmet.src = '/kviz/metrics'; fmet.setAttribute('allow', 'clipboard-write');
        var sr2 = $('side-to-reports2');
        if (sr2) mp.insertBefore(fmet, sr2);
        else mp.appendChild(fmet);
        metricsCreated = true;
      }
      history.replaceState(null, '', '#metrics');
    }

    updateBadges();
  }

  // ── Choice buttons ──────────────────────────────────────────────────────────
  $('choice-manager').onclick = function () { showTab('manager'); };
  $('choice-agent').onclick   = function () { showTab('agent'); };
  $('choice-kviz').onclick    = function () { showTab('kviz'); };
  $('choice-measure').onclick = function () { showTab('measure'); };
  if ($('choice-reports')) $('choice-reports').onclick = function () { showTab('reports'); };
  if ($('choice-metrics')) $('choice-metrics').onclick = function () { showTab('metrics'); };

  // ── Tab buttons ─────────────────────────────────────────────────────────────
  $('tab-btn-manager').onclick = function () { showTab('manager'); };
  $('tab-btn-agent').onclick   = function () { showTab('agent'); };
  $('tab-btn-kviz').onclick    = function () { showTab('kviz'); };
  $('tab-btn-measure').onclick = function () { showTab('measure'); };
  if ($('tab-btn-reports')) $('tab-btn-reports').onclick = function () { showTab('reports'); };
  if ($('tab-btn-metrics')) $('tab-btn-metrics').onclick = function () { showTab('metrics'); };

  // ── Side buttons ────────────────────────────────────────────────────────────
  $('side-to-agent').onclick   = function () { showTab('agent'); };    // manager-pane right
  $('side-to-manager').onclick = function () { showTab('manager'); };  // agent-pane left
  $('side-to-kviz').onclick    = function () { showTab('kviz'); };     // agent-pane right
  $('side-to-agent2').onclick  = function () { showTab('agent'); };    // kviz-pane left
  $('side-to-measure').onclick = function () { showTab('measure'); };  // kviz-pane right
  $('side-to-kviz2').onclick   = function () { showTab('kviz'); };     // measure-pane left
  if ($('side-to-reports'))  $('side-to-reports').onclick  = function () { showTab('reports'); }; // measure-pane right (admin)
  if ($('side-to-measure2')) $('side-to-measure2').onclick = function () { showTab('measure'); }; // reports-pane left (admin)
  if ($('side-to-metrics'))  $('side-to-metrics').onclick  = function () { showTab('metrics'); }; // reports-pane right (admin)
  if ($('side-to-reports2')) $('side-to-reports2').onclick = function () { showTab('reports'); }; // metrics-pane left (admin)

  // ── Logout ──────────────────────────────────────────────────────────────────
  $('logout-btn').onclick = function () {
    fetch('/api/logout', { method: 'POST' }).finally(function () {
      location.href = '/login';
    });
  };

  // ── Keyboard shortcuts: Alt+1=Менеджер, Alt+2=Агент, Alt+3=Квалификация, Alt+4=Замеры, Alt+5=Отчёты
  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === '1' || e.code === 'Digit1')) { e.preventDefault(); showTab('manager'); }
    if (e.altKey && (e.key === '2' || e.code === 'Digit2')) { e.preventDefault(); showTab('agent'); }
    if (e.altKey && (e.key === '3' || e.code === 'Digit3')) { e.preventDefault(); showTab('kviz'); }
    if (e.altKey && (e.key === '4' || e.code === 'Digit4')) { e.preventDefault(); showTab('measure'); }
    if (e.altKey && (e.key === '5' || e.code === 'Digit5') && $('reports-pane')) { e.preventDefault(); showTab('reports'); }
    if (e.altKey && (e.key === '6' || e.code === 'Digit6') && $('metrics-pane')) { e.preventDefault(); showTab('metrics'); }
  });

  // ── Hash navigation (back / forward only) ───────────────────────────────────
  window.addEventListener('hashchange', function () {
    if (currentTab === null) return;
    var h = location.hash.slice(1);
    if      (h === 'manager' && currentTab !== 'manager') showTab('manager');
    else if (h === 'agent'   && currentTab !== 'agent')   showTab('agent');
    else if (h === 'kviz'    && currentTab !== 'kviz')    showTab('kviz');
    else if (h === 'measure' && currentTab !== 'measure') showTab('measure');
    else if (h === 'reports' && currentTab !== 'reports') showTab('reports');
    else if (h === 'metrics' && currentTab !== 'metrics') showTab('metrics');
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
