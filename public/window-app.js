(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LEAD_URL   = window.LEAD_URL   || '';
  const CLIENT_URL = window.CLIENT_URL || '';
  let since_id = 0;
  const notifiedIds = new Set();
  let soundOn = localStorage.getItem('sw_sound') !== 'false';
  let notifGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  let audioCtx = null;

  // ── Dark mode ─────────────────────────────────────────────────────────────
  let darkMode = localStorage.getItem('sw_theme') === 'dark';
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    $('theme-btn').textContent = darkMode ? '☀️' : '🌙';
  }
  applyTheme();
  $('theme-btn').onclick = function () {
    darkMode = !darkMode;
    localStorage.setItem('sw_theme', darkMode ? 'dark' : 'light');
    applyTheme();
  };

  // ── Sound ─────────────────────────────────────────────────────────────────
  function playBeep() {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const g   = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.value = 880;
      g.gain.setValueAtTime(0.3, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc.start(); osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {}
  }

  $('sound-btn').textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
  $('sound-btn').onclick = function () {
    soundOn = !soundOn;
    localStorage.setItem('sw_sound', soundOn ? 'true' : 'false');
    this.textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
    if (soundOn) playBeep();
  };

  $('notif-btn').onclick = function () {
    if (typeof Notification === 'undefined') { alert('Уведомления не поддерживаются'); return; }
    Notification.requestPermission().then(function (p) {
      notifGranted = p === 'granted';
      $('notif-btn').textContent = notifGranted ? 'Уведомления вкл' : 'Уведомления выкл';
    });
  };
  if (notifGranted) $('notif-btn').textContent = 'Уведомления вкл';

  // ── Help modal ────────────────────────────────────────────────────────────
  $('help-btn').onclick   = function () { $('help-modal').style.display = 'flex'; };
  $('help-close').onclick = function () { $('help-modal').style.display = 'none'; };
  $('help-modal').onclick = function (e) { if (e.target === $('help-modal')) $('help-modal').style.display = 'none'; };

  // ── App visibility ────────────────────────────────────────────────────────
  function showApp() {
    $('app').classList.add('visible');
    if (window.innerWidth >= 1100) {
      $('closed-list').style.display = 'block';
      $('closed-chevron').classList.add('open');
    }
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login() {
    const pw  = $('pw-input').value;
    const res = await fetch('/window/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      $('login-screen').style.display = 'none';
      showApp();
      fetchState();
    } else {
      $('login-err').textContent = 'Неверный пароль';
    }
  }
  $('pw-btn').onclick = login;
  $('pw-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timeAgo(iso) {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (d < 1)  return 'только что';
    if (d < 60) return d + 'м назад';
    const h = Math.floor(d / 60);
    if (h < 24) return h + 'ч ' + (d % 60) + 'м';
    return Math.floor(h / 24) + 'д';
  }
  function feedTime(iso) {
    return new Date(new Date(iso).getTime() + 5 * 3600000).toISOString().slice(11, 16);
  }
  function fmtHHMM(iso) {
    return new Date(new Date(iso).getTime() + 5 * 3600000).toISOString().slice(11, 16);
  }
  function secToAlmaty(sec) {
    return new Date(sec * 1000 + 5 * 3600000).toISOString().slice(11, 16);
  }
  function isWorkHourAlmaty(iso) {
    const h = new Date(new Date(iso).getTime() + 5 * 3600000).getUTCHours();
    return h >= 8 && h < 23;
  }
  function minutesAgo(iso) {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  }
  function cleanPhone(phone) {
    const d = (phone || '').replace(/[^0-9]/g, '');
    return d.startsWith('8') && d.length === 11 ? '7' + d.slice(1) : d;
  }
  function timerText(totalSec) {
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return m + 'м ' + String(s).padStart(2, '0') + 'с';
  }

  // ── Icons ─────────────────────────────────────────────────────────────────
  const SVG = {
    lightning: '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M9.5 1L3 9h5l-1.5 6L15 7h-5z"/></svg>',
    calX:      '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M12 2h-1V1h-2v1H7V1H5v1H4a2 2 0 00-2 2v9a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2zm0 11H4V6h8v7zM6.7 8.7l1.3 1.3 1.3-1.3 1 1-1.3 1.3 1.3 1.3-1 1L8 12l-1.3 1.3-1-1 1.3-1.3L5.7 9.7z"/></svg>',
    clock:     '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zm.5 2H7v4.5l3.25 1.75.75-1.25-2.5-1.5V5z"/></svg>',
    question:  '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a1 1 0 110-2 1 1 0 010 2zm1-3H7V5h2v4z"/></svg>',
    ticket:    '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M1 5a1 1 0 011-1h12a1 1 0 011 1v1.5a1.5 1.5 0 000 3V11a1 1 0 01-1 1H2a1 1 0 01-1-1V9.5a1.5 1.5 0 000-3V5z"/></svg>',
    check:     '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M13.5 3L6 11.5 2.5 8 1 9.5l5 5 9-10z"/></svg>',
    warning:   '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 1L1 14h14L8 1zm0 3l5 9H3l5-9zm-1 3v3h2V7H7zm0 4v2h2v-2H7z"/></svg>',
    checklist: '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M13 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1zm-1 10H4V4h8v8zm-5-2l-2-2 1-1 1 1 3-3 1 1z"/></svg>',
    tiktok:    '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.53V6.77a4.85 4.85 0 01-1.01-.08z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
    whatsapp:  '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M17.47 14.38c-.26-.13-1.52-.75-1.75-.83-.24-.09-.41-.13-.58.13s-.67.83-.82.99c-.15.17-.3.19-.56.06-.26-.13-1.1-.41-2.1-1.3-.77-.69-1.3-1.54-1.45-1.8-.15-.26-.01-.4.11-.53.12-.11.26-.29.38-.44.13-.14.17-.26.26-.43.09-.17.04-.32-.02-.44s-.58-1.4-.8-1.91c-.21-.5-.42-.43-.58-.44h-.5c-.17 0-.44.06-.67.32s-.88.86-.88 2.1.9 2.44 1.03 2.61c.13.17 1.78 2.72 4.31 3.81.6.26 1.07.42 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.48-.61 1.69-1.19.21-.58.21-1.08.15-1.19-.06-.1-.22-.16-.47-.28z"/><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16z"/></svg>',
    globe:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-3 4-3 16 0 20M12 2c3 4 3 16 0 20"/></svg>',
  };

  function ruleIcon(rule) {
    if (rule === 'NEW_LEAD' || rule === 'NEW_LEAD_NO_TASK') return SVG.lightning;
    if (rule === 'AGENT_TASK') return SVG.checklist;
    if (rule && rule.includes('NO_SHOW')) return SVG.calX;
    if (rule === 'UNCONFIRMED_3H') return SVG.question;
    if (rule === 'NO_TASK' || rule === 'TASK_OVERDUE' || rule === 'TASK_TOO_FAR') return SVG.clock;
    if (rule && (rule.includes('CONTRACT') || rule === 'CARD_FREE' || rule === 'PURCHASE')) return SVG.ticket;
    return SVG.warning;
  }
  function srcIcon(src) {
    if (src === 'tiktok')    return SVG.tiktok;
    if (src === 'instagram') return SVG.instagram;
    if (src === 'whatsapp')  return SVG.whatsapp;
    return SVG.globe;
  }
  function srcLabel(src) {
    if (src === 'tiktok')    return 'TikTok';
    if (src === 'instagram') return 'Instagram';
    if (src === 'whatsapp')  return 'WhatsApp';
    if (src === 'site')      return 'Сайт';
    return 'Источник';
  }
  function iconClass(level) {
    if (level === 'urgent')    return 'icon-urgent';
    if (level === 'important') return 'icon-important';
    return 'icon-info';
  }

  function actionButtons(a) {
    var ph = a.phone;
    if (!ph) return '';
    var wa = cleanPhone(ph);
    if (!wa) return '';
    var fitUrl = (a.lead_id && LEAD_URL)     ? LEAD_URL.replace('{id}', a.lead_id)
               : (a.client_id && CLIENT_URL) ? CLIENT_URL.replace('{id}', a.client_id) : '';
    return '<div class="act-row">'
      + '<a class="btn-a btn-a-call" href="tel:+' + wa + '">📞 Позвонить</a>'
      + '<a class="btn-a btn-a-wa" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">💬 WhatsApp</a>'
      + (fitUrl ? '<a class="btn-a" href="' + esc(fitUrl) + '" target="_blank" rel="noopener">🔗 Fitbase</a>' : '')
      + '</div>';
  }

  window.toggleClientList = function (el) {
    var list = el.nextElementSibling;
    var open = list.style.display === 'block';
    list.style.display = open ? 'none' : 'block';
    el.textContent = (open ? '▸' : '▾') + el.textContent.slice(1);
  };

  // ── Status bar ────────────────────────────────────────────────────────────
  function updateStatus(data, ok) {
    if (!ok) { $('status-bar').textContent = 'Последняя проверка: — · Связь: нет'; return; }
    var t = data.last_watch_at ? fmtHHMM(data.last_watch_at) : '—';
    $('status-bar').textContent = 'Последняя проверка: ' + t + ' · Связь: есть';
    if (data.last_watch_at && data.server_time) {
      var stale = (new Date(data.server_time) - new Date(data.last_watch_at)) > 10 * 60000 && isWorkHourAlmaty(data.server_time);
      $('stale-banner').style.display = stale ? 'block' : 'none';
    }
  }

  // ── Stats pills ───────────────────────────────────────────────────────────
  function renderStats(s) {
    if (!s) return;
    var el = $('stats-pills');
    if (!el) return;
    var pills = [];
    if (s.active_leads  > 0) pills.push('<span class="stat-pill sp-lead">⚡ ' + s.active_leads + ' заявок</span>');
    if (s.no_shows      > 0) pills.push('<span class="stat-pill sp-task">✕ ' + s.no_shows + ' неявок</span>');
    if (s.overdue_tasks > 0) pills.push('<span class="stat-pill sp-lead">⚠ ' + s.overdue_tasks + ' задач просроч.</span>');
    if (s.closed_today  > 0) pills.push('<span class="stat-pill sp-brand">✓ ' + s.closed_today + ' закрыто сег.</span>');
    if (s.avg_response_min != null) pills.push('<span class="stat-pill sp-muted">⏱ ср. ответ ' + s.avg_response_min + ' мин</span>');
    el.innerHTML = pills.join('');
  }

  // ── Timer ticks ───────────────────────────────────────────────────────────
  function updateTimers() {
    document.querySelectorAll('.timer-lbl[data-ts]').forEach(function (el) {
      var totalSec = Math.floor((Date.now() - Number(el.dataset.ts)) / 1000);
      el.textContent = '⏱ ' + timerText(totalSec);
      el.className   = 'timer-lbl' + (totalSec >= 300 ? ' late' : totalSec >= 120 ? ' warn' : '');
    });
  }
  setInterval(updateTimers, 1000);

  // ── Render alerts ─────────────────────────────────────────────────────────
  var LEVEL_ORDER = { urgent: 0, important: 1, info: 2 };

  function renderAlerts(alerts) {
    var list   = $('alerts-list');
    var sorted = alerts.slice().sort(function (a, b) {
      var lo = (LEVEL_ORDER[a.level] != null ? LEVEL_ORDER[a.level] : 2)
             - (LEVEL_ORDER[b.level] != null ? LEVEL_ORDER[b.level] : 2);
      if (lo !== 0) return lo;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    $('alert-count').textContent = sorted.length ? '(' + sorted.length + ')' : '';
    document.title = (sorted.length ? '(' + sorted.length + ') ' : '') + 'SlimWay — помощник';
    if (!sorted.length) { list.innerHTML = '<div class="empty">Всё под контролем — тревог нет</div>'; return; }

    list.innerHTML = sorted.map(function (a) {
      var isNewLead   = a.rule === 'NEW_LEAD' || a.rule === 'NEW_LEAD_NO_TASK';
      var isAgentTask = a.rule === 'AGENT_TASK';
      var ageMin      = minutesAgo(a.created_at);
      var fresh       = ageMin < 2;
      var escalated   = a.is_escalated;
      var createdTs   = new Date(a.created_at).getTime();

      if (isNewLead) {
        var cls = ['card', 'card-new-lead', fresh ? 'fresh' : '', escalated ? 'escalated' : ''].filter(Boolean).join(' ');
        var srcHtml   = a.lead_source && a.lead_source !== 'other'
          ? '<span class="source-chip">' + srcIcon(a.lead_source) + srcLabel(a.lead_source) + '</span>'
          : '';
        var escBadge  = escalated
          ? '<div class="escalation-badge">' + SVG.warning + ' Без ответа ' + (a.minutes_waiting || ageMin) + ' мин</div>'
          : '';
        var hasNoTask = a.has_no_task
          ? '<div class="card-body" style="color:var(--red);font-weight:600">⚠ Заявка без ответа — не создана задача</div>'
          : '';
        var initSec   = Math.floor((Date.now() - createdTs) / 1000);
        var timerCls  = 'timer-lbl' + (initSec >= 300 ? ' late' : initSec >= 120 ? ' warn' : '');
        var timerHtml = '<div><span class="' + timerCls + '" data-ts="' + createdTs + '">⏱ ' + timerText(initSec) + '</span></div>';
        return '<div class="' + cls + '" data-id="' + a.id + '">'
          + '<div class="card-top">'
          +   '<div class="card-icon ' + iconClass(a.level) + '">' + ruleIcon(a.rule) + '</div>'
          +   '<div class="card-main">'
          +     '<div class="card-name">' + esc(a.short_name || a.title) + '</div>'
          +     '<div class="card-title">' + esc(a.title) + '</div>'
          +     srcHtml + escBadge + hasNoTask + timerHtml
          +     (a.body ? '<div class="card-body">' + esc(a.body) + '</div>' : '')
          +     actionButtons(a)
          +   '</div>'
          + '</div>'
          + '<div class="card-actions">'
          +   '<span class="card-age">' + timeAgo(a.created_at) + '</span>'
          +   (a.lead_id ? '<a class="btn btn-sm" href="/kviz/new?lead_id=' + a.lead_id + (a.short_name ? '&name=' + encodeURIComponent(a.short_name) : '') + (a.phone ? '&phone=' + encodeURIComponent(a.phone) : '') + '" target="_blank" rel="noopener" style="text-decoration:none">Квалифицировать</a>' : '')
          +   '<button class="btn btn-take" onclick="ackLead(' + a.lead_id + ', this)">Взял в работу</button>'
          + '</div>'
          + '</div>';
      }

      if (isAgentTask) {
        var meta   = a.meta || {};
        var dlSec  = meta.deadline_sec;
        var nowSec = Math.floor(Date.now() / 1000);
        var dlHtml = '';
        if (dlSec) {
          var over  = dlSec < nowSec;
          var soon  = !over && (dlSec - nowSec) < 30 * 60;
          var dlCls = over ? 'dl-over' : soon ? 'dl-warn' : 'dl-ok';
          var dlTxt = over
            ? 'Просрочена ' + Math.floor((nowSec - dlSec) / 60) + ' мин'
            : 'До ' + secToAlmaty(dlSec);
          dlHtml = '<span class="dl-badge ' + dlCls + '">' + dlTxt + '</span>';
        }
        var names       = meta.client_names;
        var clientsHtml = (names && names.length > 0)
          ? '<span class="clients-toggle" onclick="toggleClientList(this)">▸ ' + names.length + ' клиентов</span>'
            + '<div class="clients-list">' + names.map(function (n) { return esc(n); }).join('<br>') + '</div>'
          : '';
        return '<div class="card ' + a.level + '" data-id="' + a.id + '">'
          + '<div class="card-top">'
          +   '<div class="card-icon ' + iconClass(a.level) + '">' + ruleIcon(a.rule) + '</div>'
          +   '<div class="card-main">'
          +     '<div class="card-name">' + esc(a.short_name || a.title) + '</div>'
          +     '<div class="card-title"><span class="task-chip">' + SVG.checklist + ' Задача</span>' + esc(meta.category || '') + '</div>'
          +     dlHtml
          +     (a.body ? '<div class="card-body">' + esc(a.body) + '</div>' : '')
          +     clientsHtml
          +     actionButtons(a)
          +   '</div>'
          + '</div>'
          + '<div class="card-actions">'
          +   '<span class="card-age">' + timeAgo(a.created_at) + '</span>'
          +   '<button class="btn btn-sm btn-ack" onclick="ack(' + a.id + ')">Принято</button>'
          + '</div>'
          + '</div>';
      }

      return '<div class="card ' + a.level + '" data-id="' + a.id + '">'
        + '<div class="card-top">'
        +   '<div class="card-icon ' + iconClass(a.level) + '">' + ruleIcon(a.rule) + '</div>'
        +   '<div class="card-main">'
        +     '<div class="card-name">' + esc(a.short_name || a.title) + '</div>'
        +     (a.short_name ? '<div class="card-title">' + esc(a.title) + '</div>' : '')
        +     (a.body ? '<div class="card-body">' + esc(a.body) + '</div>' : '')
        +     actionButtons(a)
        +   '</div>'
        + '</div>'
        + '<div class="card-actions">'
        +   '<span class="card-age">' + timeAgo(a.created_at) + '</span>'
        +   '<button class="btn btn-sm btn-ack" onclick="ack(' + a.id + ')">Принято</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  // ── Render closed ─────────────────────────────────────────────────────────
  function reasonChip(reason, acked) {
    if (!reason && acked)  reason = 'Принято вручную';
    if (!reason)           reason = 'Закрыто';
    var cls = reason.includes('Визит')  ? 'chip-green'
            : reason.includes('Задач') ? 'chip-accent'
            : 'chip-gray';
    return '<span class="chip ' + cls + '">' + esc(reason) + '</span>';
  }
  function renderClosed(closed) {
    var el = $('closed-list');
    $('closed-count').textContent = closed && closed.length ? '(' + closed.length + ')' : '';
    if (!closed || !closed.length) { el.innerHTML = '<div class="empty">Нет завершённых за 24 ч</div>'; return; }
    el.innerHTML = closed.map(function (a) {
      var closeTime = a.acked_at || a.resolved_at;
      var reason    = (a.meta && a.meta.resolve_reason) ? a.meta.resolve_reason
                    : a.acked_at ? 'Принято вручную'
                    : 'Закрыто автоматически';
      var canUnack  = a.acked_at && !a.resolved_at;
      return '<div class="closed-card">'
        + '<div class="closed-top">'
        +   '<div class="closed-title">' + esc(a.short_name ? a.title + ' — ' + a.short_name : a.title) + '</div>'
        +   '<span class="closed-time">' + (closeTime ? fmtHHMM(closeTime) : '') + '</span>'
        +   (canUnack ? '<button class="btn btn-sm" onclick="unack(' + a.id + ')">Вернуть</button>' : '')
        + '</div>'
        + '<div class="closed-chips">' + reasonChip(reason, !!a.acked_at) + '</div>'
        + '</div>';
    }).join('');
  }

  // ── Render feed ───────────────────────────────────────────────────────────
  var FEED_DOT = { lead_moved: 'var(--brand)', task_created: 'var(--accent)', budget_updated: 'var(--c-muted)' };
  function renderFeed(feed) {
    var el = $('feed-list');
    if (!feed.length) { el.innerHTML = '<div class="empty">Действий нет</div>'; return; }
    var items = feed.map(function (f) {
      var c = FEED_DOT[f.type] || 'var(--c-muted)';
      return '<div class="feed-item" style="--dot-c:' + c + '">'
        + '<span class="feed-time">' + feedTime(f.created_at) + '</span>'
        + (f.short_name ? '<span class="feed-name">' + esc(f.short_name) + '</span> ' : '')
        + (f.text ? '— ' + esc(f.text) : '')
        + '</div>';
    }).join('');
    el.innerHTML = '<div class="feed-wrap">' + items + '</div>';
  }

  // ── Toggle closed ─────────────────────────────────────────────────────────
  window.toggleClosed = function () {
    if (window.innerWidth >= 1100) return;
    var list = $('closed-list');
    var chev = $('closed-chevron');
    var open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'block';
    chev.classList.toggle('open', !open);
  };

  // ── Ack / Unack ───────────────────────────────────────────────────────────
  window.ack = async function (id) {
    await fetch('/window/api/ack/' + id, { method: 'POST' });
    fetchState();
  };
  window.unack = async function (id) {
    await fetch('/window/api/unack/' + id, { method: 'POST' });
    fetchState();
  };
  window.ackLead = async function (leadId, btnEl) {
    var card      = btnEl && btnEl.closest ? btnEl.closest('.card-new-lead') : null;
    var timerEl   = card ? card.querySelector('.timer-lbl[data-ts]') : null;
    var respSec   = timerEl ? Math.round((Date.now() - Number(timerEl.dataset.ts)) / 1000) : null;
    await fetch('/window/api/ack-lead/' + leadId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_seconds: respSec }),
    });
    fetchState();
  };

  // ── Poll ──────────────────────────────────────────────────────────────────
  function showError(msg) { var b = $('err-banner'); b.textContent = msg; b.classList.add('show'); }
  function hideError()    { $('err-banner').classList.remove('show'); }

  async function fetchState() {
    try {
      var res = await fetch('/window/api/state?since_id=' + since_id);
      if (res.status === 401) { $('app').classList.remove('visible'); $('login-screen').style.display = 'flex'; return; }
      if (!res.ok) { showError('Ошибка сервера (' + res.status + ')'); updateStatus(null, false); return; }
      hideError();
      var data = await res.json();
      updateStatus(data, true);
      renderStats(data.stats);
      renderAlerts(data.alerts || []);
      renderClosed(data.closed || []);
      renderFeed(data.feed || []);

      // Batch notifications: NEW_LEAD always individual; 3+ others → one batch
      var newItems = (data.new_alerts || []).filter(function (a) { return !notifiedIds.has(a.id); });
      newItems.forEach(function (a) { notifiedIds.add(a.id); since_id = Math.max(since_id, a.id); });
      var newLeads = newItems.filter(function (a) { return a.rule === 'NEW_LEAD' || a.rule === 'NEW_LEAD_NO_TASK'; });
      var others   = newItems.filter(function (a) {
        return a.rule !== 'NEW_LEAD' && a.rule !== 'NEW_LEAD_NO_TASK' && (a.level === 'urgent' || a.level === 'important');
      });
      newLeads.forEach(function (a) {
        if (notifGranted) new Notification(a.title, { body: String(a.body || '').substring(0, 120) });
        playBeep();
      });
      if (others.length >= 3) {
        if (notifGranted) new Notification(others.length + ' новых тревог', { body: others.map(function (a) { return a.title; }).join(', ').substring(0, 120) });
        if (others.some(function (a) { return a.level === 'urgent'; })) playBeep();
      } else {
        others.forEach(function (a) {
          if (notifGranted) new Notification(a.title, { body: String(a.body || '').substring(0, 120) });
          if (a.level === 'urgent') playBeep();
        });
      }
    } catch (e) {
      showError('Нет связи с сервером');
      updateStatus(null, false);
    }
  }

  // Auto-start if cookie exists
  fetch('/window/api/state?since_id=0').then(function (r) {
    if (r.ok) {
      $('login-screen').style.display = 'none';
      showApp();
      r.json().then(function (data) {
        updateStatus(data, true);
        renderStats(data.stats);
        renderAlerts(data.alerts || []);
        renderClosed(data.closed || []);
        renderFeed(data.feed || []);
        if (data.alerts) since_id = Math.max.apply(null, data.alerts.map(function (a) { return a.id || 0; }).concat([0]));
      });
    }
  }).catch(function () {});

  setInterval(fetchState, 10000);

  // ── PWA service worker ────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/window/sw.js', { scope: '/window/' }).catch(function () {});
  }
}());
