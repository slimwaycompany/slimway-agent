/* room.js — agent room state machine; uses AgentScene for SVG rendering */
(function () {
  'use strict';

  var STORAGE_KEY = 'sw_agent_room_collapsed';
  var POLL_MS     = 30000;
  var TICK_MS     = 500;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function yekHour() { return new Date(Date.now() + 5 * 3600000).getUTCHours(); }
  function timeOfDay() {
    var h = yekHour();
    if (h >= 22 || h < 7)  return 'night';
    if (h >= 19)            return 'evening';
    return 'day';
  }
  function minAgo(iso) { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / 60000; }
  function fmtAgo(iso) {
    var m = Math.round(minAgo(iso));
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    return Math.floor(m / 60) + ' ч назад';
  }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── AgentRoom ──────────────────────────────────────────────────────────────

  function AgentRoom(wrapId) {
    var self = this;
    self.wrap = document.getElementById(wrapId || 'agent-room-wrap');
    if (!self.wrap || !window.AgentScene) return;

    // Init SVG scene
    window.AgentScene.init(self.wrap);

    // Collapse strip
    self.strip = document.createElement('div');
    self.strip.id = 'agent-room-strip';
    self.strip.innerHTML = '<div id="agent-strip-dot"></div><span id="agent-strip-text">Агент</span>';

    self.toggleBtn = document.createElement('button');
    self.toggleBtn.id = 'agent-room-toggle';
    self.toggleBtn.textContent = '—';
    self.toggleBtn.title = 'Свернуть/развернуть';

    self.popup = document.createElement('div');
    self.popup.id = 'agent-status-popup';

    self.wrap.appendChild(self.strip);
    self.wrap.appendChild(self.toggleBtn);
    self.wrap.appendChild(self.popup);

    // State
    self.agentState   = null;
    self.state        = 'typing';
    self.eventQueue   = [];
    self.seenEventAts = new Set();
    self._eventStart  = null;
    self._idleUntil   = 0;
    self._lastIdle    = null;
    self._dogState    = 'lie';
    self._lastTodStr  = timeOfDay();

    // Force state via URL param
    var urlP = new URLSearchParams(location.search);
    self.forceGirlState = urlP.get('agentState') || null;
    self.forceDogState  = urlP.get('dogState')   || null;

    // Sound toggle
    self.soundOn = localStorage.getItem('sw_room_sound') === '1';
    self.soundBtn = document.createElement('button');
    self.soundBtn.id = 'agent-sound-toggle';
    self.soundBtn.title = 'Звук собаки';
    self.soundBtn.textContent = self.soundOn ? '🔈' : '🔇';
    self.soundBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self.soundOn = !self.soundOn;
      self.soundBtn.textContent = self.soundOn ? '🔈' : '🔇';
      localStorage.setItem('sw_room_sound', self.soundOn ? '1' : '0');
    });
    self.wrap.appendChild(self.soundBtn);

  // Collapse/expand
    var savedCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
    var mobileDefault  = window.innerWidth < 768;
    self.collapsed = savedCollapsed || mobileDefault;
    self._applyCollapse();

    // Events
    self.toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); self.toggle(); });
    self.strip.addEventListener('click', function () { self.expand(); });

    var svgEl = window.AgentScene.getRoom();
    if (svgEl) svgEl.addEventListener('click', function (e) {
      var dogEl = window.AgentScene.getDog && window.AgentScene.getDog();
      if (dogEl && (dogEl === e.target || dogEl.contains(e.target))) { self.barkDog(); }
      else { self.showPopup(); }
    });

    document.addEventListener('click', function (e) {
      if (!self.popup.contains(e.target)) self.hidePopup();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.hidePopup(); });

    // Visibility → pause/resume animations
    document.addEventListener('visibilitychange', function () {
      var r = window.AgentScene.getRoom();
      if (r) r.classList.toggle('paused', document.hidden);
    });

    // Initial dog
    var initDog = self.forceDogState || 'lie';
    window.AgentScene.setDog(initDog);
    self._dogState = initDog;

    // Start ticks
    self._tickTimer = setInterval(function () { self._tick(); }, TICK_MS);
    self._dogTimer  = setTimeout(function () { self._dogTick(); }, 7000 + Math.random() * 5000);
    self._clockTimer = setInterval(function () {
      window.AgentScene.tickClock();
      // Update tod once a minute
      var nowTod = timeOfDay();
      if (nowTod !== self._lastTodStr) {
        self._lastTodStr = nowTod;
        window.AgentScene.setTod('now');
      }
    }, 60000);

    // Fetch
    self._fetchState();
    self._pollTimer = setInterval(function () { self._fetchState(); }, POLL_MS);
  }

  AgentRoom.prototype._applyCollapse = function () {
    var self = this;
    var r = window.AgentScene.getRoom();
    if (self.collapsed) {
      self.wrap.classList.add('collapsed');
      self.toggleBtn.textContent = '+';
      if (r) r.classList.add('paused');
    } else {
      self.wrap.classList.remove('collapsed');
      self.toggleBtn.textContent = '—';
      if (r) r.classList.remove('paused');
    }
  };

  AgentRoom.prototype.toggle = function () {
    this.collapsed = !this.collapsed;
    localStorage.setItem(STORAGE_KEY, this.collapsed ? '1' : '0');
    this._applyCollapse();
  };

  AgentRoom.prototype.expand = function () { if (this.collapsed) this.toggle(); };

  // ── State machine ──────────────────────────────────────────────────────────

  var IDLE_ANIMS = ['walk', 'coffee', 'pullup', 'stretch', 'window', 'typing'];

  AgentRoom.prototype._determineState = function () {
    var self = this, d = self.agentState, tod = timeOfDay();
    if (self.forceGirlState) return self.forceGirlState;
    if (tod === 'night') return 'sleep';
    if (d && d.lastError && minAgo(d.lastError.at) < 10) return 'panic';
    if (tod !== 'night' && d && d.lastRunAt && minAgo(d.lastRunAt) > 30 && !d.runningNow) return 'confused';
    if (self.eventQueue.length > 0) {
      var ev = self.eventQueue[0];
      if (ev.type === 'new_lead') return 'alert';
      if (ev.type === 'move')     return 'happy';
      if (ev.type === 'task')     return 'sticky';
      if (ev.type === 'error')    return 'panic';
      return 'typing';
    }
    if (d && (d.runningNow || minAgo(d.lastRunAt) < 1)) return 'typing';
    return null; // idle
  };

  AgentRoom.prototype._pickIdle = function () {
    var last = this._lastIdle;
    var pool = IDLE_ANIMS.filter(function (a) { return a !== last; });
    var pick = pool[Math.floor(Math.random() * pool.length)];
    this._lastIdle = pick;
    return pick;
  };

  AgentRoom.prototype._tick = function () {
    var self = this, now = Date.now();

    // Consume expired event
    if (self.eventQueue.length > 0 && self._eventStart && now - self._eventStart > 4500) {
      self.eventQueue.shift();
      self._eventStart = null;
    }

    var newState = self._determineState();

    if (newState === null) {
      if (now >= self._idleUntil) {
        newState = self._pickIdle();
        self._idleUntil = now + (8 + Math.random() * 7) * 1000;
      } else {
        newState = self.state;
      }
    }

    if (newState !== self.state) {
      self.state = newState;
      self._updateStrip();

      // Determine phrase type
      var phraseType = newState;
      if (self.eventQueue.length > 0) {
        var ev = self.eventQueue[0];
        if (!self._eventStart) self._eventStart = now;
        phraseType = ev.type; // 'new_lead', 'move', 'task', 'error'
      }
      var phrase = window.AgentPhrases ? window.AgentPhrases.getPhrase(phraseType) : null;
      window.AgentScene.setGirl(newState, phrase);
    }
  };

  AgentRoom.prototype._dogTick = function () {
    var self = this;
    clearTimeout(self._dogTimer);
    var tod = timeOfDay();
    var name;
    if (self.forceDogState) {
      name = self.forceDogState;
    } else if (tod === 'night') {
      name = 'sleep';
    } else {
      var pool = ['lie','lick','sit','scratch','wash','stand','sleep','lie'].filter(function (s) { return s !== self._dogState; });
      name = pool[Math.floor(Math.random() * pool.length)];
    }
    self._dogState = name;
    window.AgentScene.setDog(name);
    self._dogTimer = setTimeout(function () { self._dogTick(); }, 7000 + Math.random() * 5000);
  };

  AgentRoom.prototype._updateStrip = function () {
    var self = this, d = self.agentState;
    var dot = document.getElementById('agent-strip-dot');
    var txt = document.getElementById('agent-strip-text');
    if (!dot || !txt) return;
    var label = self.state, dotCls = 'idle';
    if (d) {
      if (d.runningNow) { dotCls = ''; label = 'Прогон: ' + d.runningNow; }
      else if (d.lastError && minAgo(d.lastError.at) < 10) { dotCls = 'err'; label = 'Ошибка'; }
      else if (d.lastRunAt) { dotCls = ''; label = 'Прогон ' + fmtAgo(d.lastRunAt); }
    }
    dot.className = dotCls;
    txt.textContent = 'Агент · ' + label;
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────

  AgentRoom.prototype._fetchState = function () {
    var self = this;
    fetch('/window/api/agent-state', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        self.agentState = d;
        var evs = (d.recentEvents || []).filter(function (e) {
          return !self.seenEventAts.has(e.at) && minAgo(e.at) < 5;
        });
        evs.slice(0, 3 - self.eventQueue.length).forEach(function (e) {
          self.seenEventAts.add(e.at);
          self.eventQueue.push(e);
        });
        (d.recentEvents || []).forEach(function (e) { self.seenEventAts.add(e.at); });
        self._updateStrip();
      })
      .catch(function () {});
  };

  // ── Dog interaction ────────────────────────────────────────────────────────

  var WOOF_PHRASES = ['Гав!', 'Гав-гав!', 'Вуф!', 'Гррав!', 'Ав-ав!', '🐾 Гав!'];
  var RARE_PHRASES = ['Хозяйка, пора кушать!', 'Гуляем?', 'Гав!! Гав!!', 'Мяу.. нет, ГАВ!'];

  AgentRoom.prototype.barkDog = function () {
    var self = this;
    var phrase = Math.random() < 0.15
      ? RARE_PHRASES[Math.floor(Math.random() * RARE_PHRASES.length)]
      : WOOF_PHRASES[Math.floor(Math.random() * WOOF_PHRASES.length)];
    window.AgentScene.dogSay(phrase);
    // Bounce animation
    var r = window.AgentScene.getRoom();
    if (r) {
      r.classList.remove('dog-barked');
      void r.offsetWidth;
      r.classList.add('dog-barked');
      setTimeout(function () { r.classList.remove('dog-barked'); }, 400);
    }
    // Dog switches to sit state briefly
    window.AgentScene.setDog('sit');
    self._dogState = 'sit';
    clearTimeout(self._dogTimer);
    self._dogTimer = setTimeout(function () { self._dogTick(); }, 2000);
    // Sound
    if (self.soundOn) self._playBark();
  };

  AgentRoom.prototype._playBark = function () {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(); osc.stop(ctx.currentTime + 0.22);
      setTimeout(function () { ctx.close(); }, 500);
    } catch (e) { /* AudioContext unavailable */ }
  };

  // ── Status popup ───────────────────────────────────────────────────────────

  AgentRoom.prototype.showPopup = function () {
    var self = this, d = self.agentState, p = self.popup;
    if (!d) { p.innerHTML = '<em>Нет данных</em>'; p.classList.add('show'); return; }
    var runLine = d.lastRunAt
      ? esc(d.lastRunName || '—') + ' · ' + esc(fmtAgo(d.lastRunAt)) + ' · ' + (d.lastRunOk ? '✅ ок' : '⚠️ ошибка')
      : 'Нет данных о прогонах';
    var errLine = '';
    if (d.lastError) errLine = '<div style="color:var(--red);margin-top:4px">⛔ ' + esc(fmtAgo(d.lastError.at)) + ': ' + esc(d.lastError.message) + '</div>';
    var t = d.today || {};
    var todayLine = 'Перенесла <b>' + (t.moved||0) + '</b> · задач <b>' + (t.tasks||0) + '</b> · заявок <b>' + (t.newLeads||0) + '</b> · тревог <b>' + (t.openAlerts||0) + '</b>';
    p.innerHTML = '<div style="font-weight:600;margin-bottom:4px">Последний прогон</div><div>' + runLine + '</div>' + errLine + '<div style="border-top:1px solid var(--c-border);margin-top:8px;padding-top:6px">Сегодня: ' + todayLine + '</div>';
    p.classList.add('show');
  };

  AgentRoom.prototype.hidePopup = function () { this.popup.classList.remove('show'); };

  window.AgentRoom = AgentRoom;
}());
