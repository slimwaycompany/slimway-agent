/* room.js — pixel agent room: state machine + RAF loop */
(function () {
  'use strict';

  var STORAGE_KEY = 'sw_agent_room_collapsed';
  var CANVAS_W = 160, CANVAS_H = 90;
  var FPS = 12;
  var FRAME_MS = 1000 / FPS;
  var POLL_MS  = 30000;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function yekHour() {
    return new Date(Date.now() + 5 * 3600000).getUTCHours();
  }
  function timeOfDay() {
    var h = yekHour();
    if (h >= 22 || h < 7) return 'night';
    if (h >= 19)           return 'evening';
    return 'day';
  }
  function minAgo(iso) {
    if (!iso) return Infinity;
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }
  function fmtAgo(iso) {
    var m = Math.round(minAgo(iso));
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    var h = Math.floor(m / 60);
    return h + ' ч назад';
  }
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── AgentRoom ──────────────────────────────────────────────────────────────

  function AgentRoom(wrapId) {
    var self = this;
    self.wrap = document.getElementById(wrapId || 'agent-room-wrap');
    if (!self.wrap) return;

    // Build DOM
    self.canvas = document.createElement('canvas');
    self.canvas.id = 'agent-canvas';
    self.canvas.width  = CANVAS_W;
    self.canvas.height = CANVAS_H;
    self.canvas.title  = 'Что делает агент?';
    self.canvas.setAttribute('aria-label', 'Пиксельный агент — нажмите для статуса');

    self.strip = document.createElement('div');
    self.strip.id = 'agent-room-strip';
    self.strip.innerHTML = '<div id="agent-strip-dot"></div><span id="agent-strip-text">Агент</span>';

    self.toggleBtn = document.createElement('button');
    self.toggleBtn.id = 'agent-room-toggle';
    self.toggleBtn.textContent = '—';
    self.toggleBtn.title = 'Свернуть/развернуть';

    self.popup = document.createElement('div');
    self.popup.id = 'agent-status-popup';

    self.wrap.appendChild(self.canvas);
    self.wrap.appendChild(self.strip);
    self.wrap.appendChild(self.toggleBtn);
    self.wrap.appendChild(self.popup);

    self.ctx = self.canvas.getContext('2d');
    self.ctx.imageSmoothingEnabled = false;

    // State
    self.agentState = null;     // data from /window/api/agent-state
    self.state    = 'typing';   // current animation name
    self.frame    = 0;
    self.walkX    = 68;         // agent x for walking animation
    self.walkDir  = 1;
    self.bubble   = null;       // { text, until }
    self.eventQueue   = [];     // pending events to animate
    self.seenEventAts = new Set();
    self.lastIdleAt   = 0;
    self.monitorFlash = false;
    self.moveProgress = -1;     // card move animation 0→1, -1=off
    self.lastRAF  = 0;
    self.lastTod  = timeOfDay();

    // Offscreen background cache
    self.bgCanvas  = document.createElement('canvas');
    self.bgCanvas.width  = CANVAS_W;
    self.bgCanvas.height = CANVAS_H;
    self.bgCtx     = self.bgCanvas.getContext('2d');
    self.bgCtx.imageSmoothingEnabled = false;
    self.bgTod     = null; // time of day when bg was last drawn

    // Force-state via URL param
    var urlParam = new URLSearchParams(location.search).get('agentState');
    self.forceState = urlParam || null;

    // Collapse/expand
    var savedCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
    var mobileDefault  = window.innerWidth < 768;
    self.collapsed = savedCollapsed || mobileDefault;
    self._applyCollapse();

    // Events
    self.toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); self.toggle(); });
    self.strip.addEventListener('click', function () { self.expand(); });
    self.canvas.addEventListener('click', function () { self.showPopup(); });
    document.addEventListener('click', function (e) {
      if (!self.popup.contains(e.target) && e.target !== self.canvas) self.hidePopup();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') self.hidePopup();
    });

    // Reduced motion
    self.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // RAF
    self._raf = null;
    if (!document.hidden) self._startLoop();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(self._raf); self._raf = null; }
      else self._startLoop();
    });

    // Poll
    self._fetchState();
    self._pollTimer = setInterval(function () { self._fetchState(); }, POLL_MS);
  }

  AgentRoom.prototype._applyCollapse = function () {
    var self = this;
    if (self.collapsed) {
      self.wrap.classList.add('collapsed');
      self.toggleBtn.textContent = '+';
    } else {
      self.wrap.classList.remove('collapsed');
      self.toggleBtn.textContent = '—';
    }
  };

  AgentRoom.prototype.toggle = function () {
    this.collapsed = !this.collapsed;
    localStorage.setItem(STORAGE_KEY, this.collapsed ? '1' : '0');
    this._applyCollapse();
    if (!this.collapsed && !this._raf) this._startLoop();
  };

  AgentRoom.prototype.expand = function () {
    if (this.collapsed) this.toggle();
  };

  // ── State machine ──────────────────────────────────────────────────────────

  AgentRoom.prototype._determineState = function () {
    var self = this;
    if (self.forceState) return self.forceState;

    var d = self.agentState;
    var tod = timeOfDay();

    // Night
    if (tod === 'night') return 'sleep';

    // Fresh error (< 10 min)
    if (d && d.lastError && minAgo(d.lastError.at) < 10) return 'panic';

    // No run in 30+ min during work hours
    if (tod !== 'night' && d && d.lastRunAt && minAgo(d.lastRunAt) > 30 && !d.runningNow) return 'confused';

    // Queued event
    if (self.eventQueue.length > 0) {
      var ev = self.eventQueue[0];
      if (ev.type === 'new_lead') return 'alert';
      if (ev.type === 'move')     return 'happy';
      if (ev.type === 'task')     return 'sticky';
      if (ev.type === 'error')    return 'panic';
      return 'typing';
    }

    // Running or ran < 1 min ago
    if (d && (d.runningNow || minAgo(d.lastRunAt) < 1)) return 'typing';

    // Idle: random
    return null; // caller handles idle
  };

  var IDLE_ANIMS = ['walk', 'coffee', 'pullup', 'stretch', 'window', 'typing'];
  AgentRoom.prototype._pickIdle = function () {
    var exclude = this._lastIdle;
    var candidates = IDLE_ANIMS.filter(function (a) { return a !== exclude; });
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    this._lastIdle = pick;
    return pick;
  };

  AgentRoom.prototype._updateState = function () {
    var self = this;
    var newState = self._determineState();

    if (newState === null) {
      // Idle: rotate every 8–15 s
      var now = Date.now();
      if (!self._idleUntil || now >= self._idleUntil) {
        newState = self._pickIdle();
        self._idleUntil = now + (8 + Math.random() * 7) * 1000;
        // Bubble occasionally (not more than 1 per 40s)
        if (!self.bubble && now - self.lastIdleAt > 40000 && Math.random() < 0.4) {
          self.bubble = { text: window.AgentPhrases.getPhrase('idle'), until: now + 5500 };
          self.lastIdleAt = now;
        }
      }
      newState = newState || self.state;
    }

    var changed = newState !== self.state;

    // Handle event consumption
    if (self.eventQueue.length > 0) {
      var ev = self.eventQueue[0];
      if (!self._eventStart) self._eventStart = Date.now();
      // Show bubble on first frame
      if (changed) {
        var phrase = window.AgentPhrases.getPhrase(ev.type, ev.stage);
        self.bubble = { text: phrase, until: Date.now() + 5500 };
        if (ev.type === 'move') self.moveProgress = 0;
      }
      // Consume event after 4.5 s
      if (Date.now() - self._eventStart > 4500) {
        self.eventQueue.shift();
        self._eventStart = null;
        self.moveProgress = -1;
      }
    }

    if (changed) {
      self.state = newState;
      self.frame = 0;
      // Brief walk before teleport (except typing/sleep/pullup)
      if (newState !== 'typing' && newState !== 'sleep' && newState !== 'pullup' && newState !== 'confused') {
        if (self._lastTargetAnim !== newState) {
          self._walkTo = self._targetX(newState);
          self._lastTargetAnim = newState;
        }
      }
    }

    // Strip text
    self._updateStrip();
  };

  AgentRoom.prototype._targetX = function (anim) {
    if (anim === 'coffee')  return 116;
    if (anim === 'pullup')  return 127;
    if (anim === 'window')  return 22;
    if (anim === 'stretch') return 90;
    if (anim === 'sleep')   return 148;
    return 68; // desk
  };

  AgentRoom.prototype._updateStrip = function () {
    var self = this, d = self.agentState;
    var dot  = document.getElementById('agent-strip-dot');
    var txt  = document.getElementById('agent-strip-text');
    if (!dot || !txt) return;

    var label = self.state;
    var dotCls = 'idle';
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
        // Enqueue new events (max 3 in queue)
        var evs = (d.recentEvents || []).filter(function (e) {
          return !self.seenEventAts.has(e.at) && minAgo(e.at) < 5;
        });
        evs.slice(0, 3 - self.eventQueue.length).forEach(function (e) {
          self.seenEventAts.add(e.at);
          self.eventQueue.push(e);
        });
        // Mark all as seen
        (d.recentEvents || []).forEach(function (e) { self.seenEventAts.add(e.at); });
      })
      .catch(function () {});
  };

  // ── Draw ───────────────────────────────────────────────────────────────────

  AgentRoom.prototype._drawFrame = function () {
    var self = this;
    if (!window.AgentSprites) return;
    var ctx = self.ctx, W = CANVAS_W, H = CANVAS_H;
    var S = window.AgentSprites;
    var tod = timeOfDay();

    // Rebuild background if time-of-day changed
    if (tod !== self.bgTod) {
      self.bgCtx.clearRect(0, 0, W, H);
      S.drawBackground(self.bgCtx, W, H, tod);
      S.drawFurniture(self.bgCtx, W, H);
      self.bgTod = tod;
    }

    // Blit background
    ctx.drawImage(self.bgCanvas, 0, 0);

    // Move progress for card animation
    if (self.moveProgress >= 0) {
      self.moveProgress = Math.min(1, self.moveProgress + 0.07);
      S.drawMovingCard(ctx, H, self.moveProgress);
    }

    // Walk interpolation toward target
    if (self._walkTo !== undefined) {
      var dx = self._walkTo - self.walkX;
      if (Math.abs(dx) > 2) {
        self.walkDir  = dx > 0 ? 1 : -1;
        self.walkX   += self.walkDir * 2;
        S.drawAgent(ctx, H, 'walk', self.frame, self.walkX, false);
      } else {
        self.walkX = self._walkTo;
        self._walkTo = undefined;
        S.drawAgent(ctx, H, self.state, self.frame, self.walkX, self.monitorFlash);
      }
    } else {
      S.drawAgent(ctx, H, self.state, self.frame, self.walkX, self.monitorFlash);
    }

    // Bubble
    var now = Date.now();
    if (self.bubble && now < self.bubble.until) {
      S.drawBubble(ctx, self.bubble.text, H, self.state);
    } else if (self.bubble && now >= self.bubble.until) {
      self.bubble = null;
    }
  };

  // ── RAF loop ───────────────────────────────────────────────────────────────

  AgentRoom.prototype._startLoop = function () {
    var self = this;
    if (self._raf) return;
    self._lastRAF = performance.now();
    self.lastTod = timeOfDay();

    function loop(ts) {
      if (document.hidden || self.collapsed) { self._raf = null; return; }
      self._raf = requestAnimationFrame(loop);
      var dt = ts - self.lastRAF;
      if (dt < FRAME_MS) return;
      self.lastRAF = ts - (dt % FRAME_MS);

      self._updateState();

      if (self.reducedMotion) {
        self.frame = 0;
      } else {
        self.frame++;
      }
      self.monitorFlash = !self.monitorFlash;
      self._drawFrame();
    }
    self._raf = requestAnimationFrame(loop);
  };

  // ── Status popup ───────────────────────────────────────────────────────────

  AgentRoom.prototype.showPopup = function () {
    var self = this, d = self.agentState, p = self.popup;
    if (!d) { p.innerHTML = '<em>Нет данных</em>'; p.classList.add('show'); return; }

    var runLine = d.lastRunAt
      ? esc(d.lastRunName || '—') + ' · ' + esc(fmtAgo(d.lastRunAt)) + ' · ' + (d.lastRunOk ? '✅ ок' : '⚠️ ошибка')
      : 'Нет данных о прогонах';

    var errLine = '';
    if (d.lastError) {
      errLine = '<div style="color:var(--red);margin-top:4px">⛔ ' + esc(fmtAgo(d.lastError.at)) + ': ' + esc(d.lastError.message) + '</div>';
    }

    var t = d.today || {};
    var todayLine = 'Перенёс <b>' + (t.moved||0) + '</b> · задач <b>' + (t.tasks||0) + '</b> · заявок <b>' + (t.newLeads||0) + '</b> · тревог <b>' + (t.openAlerts||0) + '</b>';

    p.innerHTML = '<div style="font-weight:600;margin-bottom:4px">Последний прогон</div>'
      + '<div>' + runLine + '</div>'
      + errLine
      + '<div style="border-top:1px solid var(--c-border);margin-top:8px;padding-top:6px">Сегодня: ' + todayLine + '</div>';

    p.classList.add('show');
  };

  AgentRoom.prototype.hidePopup = function () {
    this.popup.classList.remove('show');
  };

  // Expose
  window.AgentRoom = AgentRoom;
}());
