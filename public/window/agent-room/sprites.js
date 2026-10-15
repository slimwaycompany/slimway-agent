/* sprites.js — pixel scene + agent drawing, no external deps */
(function () {
  'use strict';

  // ── Palette ──────────────────────────────────────────────────────────────
  var C = {
    '.': null,
    W: '#eef2f7',   // wall bg
    O: '#d4c5a9',   // floor
    o: '#b8a88a',   // floor shadow
    k: '#1a1a2e',   // outline/dark
    T: '#8b6914',   // wood desk
    t: '#6b4f10',   // wood dark
    B: '#02BDB6',   // brand teal (shirt)
    b: '#018f8a',   // teal dark
    D: '#263CD9',   // accent blue (pants)
    d: '#1a2ba0',   // blue dark
    F: '#fdbcb4',   // skin
    f: '#d49080',   // skin shadow
    H: '#3d2b1f',   // hair
    G: '#6b7280',   // gray
    g: '#9ca3af',   // light gray
    M: '#c5e8f0',   // monitor screen default
    m: '#92cfe0',   // monitor screen dark
    R: '#ef4444',   // red
    r: '#fca5a5',   // red light
    A: '#4b5563',   // chair/furniture dark
    a: '#6b7280',   // furniture mid
    V: '#4a7c20',   // plant green
    v: '#2d5016',   // plant dark
    E: '#78350f',   // coffee machine
    e: '#b45309',   // coffee light
    P: '#e5e7eb',   // paper/light
    Z: '#fef9c3',   // pale yellow
    S: '#7dd3e0',   // day sky
    s: '#bae6fd',   // sky light
    N: '#1e3a5f',   // night sky
    n: '#0f2440',   // night dark
    Y: '#f59e0b',   // evening/stars
    X: '#374151',   // sofa dark
    x: '#4b5563',   // sofa mid
    L: '#fde68a',   // lamp glow
  };

  function px(ctx, col, x, y, w, h) {
    var c = C[col];
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w || 1, h || 1);
  }

  // Draw a sprite from a char-grid at position (ox, oy)
  function drawGrid(ctx, grid, ox, oy) {
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch !== '.') px(ctx, ch, ox + c, oy + r);
      }
    }
  }

  // ── Background scene ──────────────────────────────────────────────────────

  function drawBackground(ctx, W, H, timeOfDay) {
    // Wall
    px(ctx, 'W', 0, 0, W, H);

    // Baseboard
    px(ctx, 'o', 0, H - 4, W, 4);
    px(ctx, 'O', 0, H - 3, W, 2);

    // Floor
    px(ctx, 'O', 0, H - 12, W, 9);
    ctx.fillStyle = '#c9b99a';
    for (var i = 0; i < W; i += 16) ctx.fillRect(i, H - 12, 1, 9);

    // Window on left wall
    var skyCol = timeOfDay === 'night' ? 'N' : timeOfDay === 'evening' ? 'Y' : 'S';
    var skyCol2 = timeOfDay === 'night' ? 'n' : timeOfDay === 'evening' ? 'E' : 's';
    px(ctx, 'k', 3, 3, 38, 42);
    px(ctx, skyCol, 5, 5, 34, 38);
    // Sky gradient-ish
    for (var j = 0; j < 10; j++) px(ctx, skyCol2, 5, 5 + j, 34, 1);
    // Window cross
    px(ctx, 'k', 21, 5, 2, 38);
    px(ctx, 'k', 5, 23, 34, 2);
    // Window sill
    px(ctx, 'T', 2, 44, 40, 3);
    px(ctx, 't', 2, 47, 40, 1);
    // Stars at night
    if (timeOfDay === 'night') {
      ctx.fillStyle = '#fff';
      [[10,8],[22,12],[30,7],[15,18],[35,15]].forEach(function(s){ ctx.fillRect(s[0],s[1],1,1); });
    }
    // Curtains
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(3, 3, 5, 42);
    ctx.fillRect(35, 3, 6, 42);
  }

  function drawFurniture(ctx, W, H) {
    var flY = H - 12; // floor y

    // Plant (left of desk)
    px(ctx, 'T', 40, flY - 8, 6, 8);  // pot
    px(ctx, 't', 41, flY - 9, 4, 1);
    px(ctx, 'V', 36, flY - 20, 5, 12); // left leaf
    px(ctx, 'v', 36, flY - 20, 2, 6);
    px(ctx, 'V', 44, flY - 22, 5, 14); // right leaf
    px(ctx, 'v', 48, flY - 22, 2, 8);
    px(ctx, 'V', 39, flY - 26, 7, 8);  // top leaf
    px(ctx, 'v', 40, flY - 28, 3, 4);

    // Desk
    var deskY = flY - 16;
    px(ctx, 'T', 48, deskY, 72, 5);     // surface
    px(ctx, 't', 48, deskY + 5, 72, 1); // edge
    px(ctx, 'T', 50, deskY + 6, 3, 10); // left leg
    px(ctx, 'T', 115, deskY + 6, 3, 10);// right leg
    px(ctx, 't', 53, deskY + 6, 1, 10);
    px(ctx, 't', 118, deskY + 6, 1, 10);

    // Monitor stand
    px(ctx, 'A', 77, deskY - 2, 4, 2);
    px(ctx, 'G', 74, deskY - 3, 10, 1);

    // Monitor
    var monX = 63, monY = deskY - 22, monW = 32, monH = 20;
    px(ctx, 'k', monX, monY, monW, monH);           // outer frame
    px(ctx, 'A', monX + 1, monY + 1, monW - 2, monH - 2); // bezel
    px(ctx, 'M', monX + 2, monY + 2, monW - 4, monH - 4); // screen

    // Kanban on monitor screen
    var scX = monX + 2, scY = monY + 2, scW = monW - 4, scH = monH - 4;
    var cols = 5, colW = Math.floor(scW / cols);
    var colColors = ['#6b7280','#f59e0b','#02BDB6','#263CD9','#10b981'];
    for (var ci = 0; ci < cols; ci++) {
      var cx2 = scX + ci * colW + 1;
      ctx.fillStyle = colColors[ci];
      ctx.fillRect(cx2, scY, colW - 1, 2); // column header
      // Cards
      for (var card = 0; card < 2 + (ci === 2 ? 1 : 0); card++) {
        ctx.fillStyle = colColors[ci] + '88';
        ctx.fillRect(cx2, scY + 3 + card * 4, colW - 2, 3);
      }
    }

    // Chair
    var chX = 76, chY = deskY + 4;
    px(ctx, 'A', chX, chY, 18, 4);         // seat
    px(ctx, 'a', chX + 1, chY + 4, 16, 1);
    px(ctx, 'A', chX + 2, chY - 8, 14, 8); // backrest
    px(ctx, 'a', chX + 2, chY - 8, 14, 1);
    px(ctx, 'k', chX + 3, chY + 5, 2, 6);  // front legs
    px(ctx, 'k', chX + 13, chY + 5, 2, 6);
    px(ctx, 'k', chX + 5, chY + 5, 2, 5);  // back legs (shorter)
    px(ctx, 'k', chX + 11, chY + 5, 2, 5);

    // Coffee machine
    px(ctx, 'E', 118, flY - 26, 14, 20);
    px(ctx, 'e', 119, flY - 25, 12, 14);
    px(ctx, 'k', 122, flY - 20, 6, 6); // front panel
    px(ctx, 'B', 123, flY - 18, 4, 2); // button
    px(ctx, 'T', 123, flY - 7, 5, 4);  // cup
    ctx.fillStyle = '#78350f';
    ctx.fillRect(124, flY - 5, 3, 1);  // coffee

    // Pull-up bar (wall mounted)
    px(ctx, 'G', 118, 8, 2, 20);  // left mount
    px(ctx, 'G', 135, 8, 2, 20);  // right mount
    px(ctx, 'k', 117, 16, 22, 3); // bar
    px(ctx, 'g', 117, 17, 22, 1); // shine

    // Sofa
    var sofaX = 138, sofaY = flY - 15;
    px(ctx, 'X', sofaX, sofaY, 22, 10);
    px(ctx, 'x', sofaX + 1, sofaY + 1, 20, 8);
    px(ctx, 'X', sofaX, sofaY - 8, 22, 8);  // back
    px(ctx, 'x', sofaX + 1, sofaY - 7, 20, 6);
    px(ctx, 'X', sofaX, sofaY, 4, 10);      // armrest L
    px(ctx, 'X', sofaX + 18, sofaY, 4, 10); // armrest R
    px(ctx, 'x', sofaX + 5, sofaY + 2, 6, 6);  // cushion L
    px(ctx, 'x', sofaX + 13, sofaY + 2, 6, 6); // cushion R
    px(ctx, 'P', sofaX + 6, sofaY + 3, 4, 4);
    px(ctx, 'P', sofaX + 14, sofaY + 3, 4, 4);
  }

  // ── Agent sprites ─────────────────────────────────────────────────────────
  // Agent drawn relative to anchor (feet position)
  // H=hair F=skin B=teal D=blue k=dark f=skinshadow

  var AGENT = {
    // sitting at desk — upper body only (anchor = desk surface y)
    typing: [
      // frame 0 — normal
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BBBBB.',
       'BB...BB',
       '.BBBBB.',
       '..BBB..'],
      // frame 1 — hands up on keyboard
      ['..HHH..',
       '.HFFFH.',
       '.HFfFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       'BBBBBBB',
       '.B...B.',
       '.BBBBB.',
       '..BBB..'],
    ],

    happy: [
      ['..HHH..',
       '.HFFFH.',
       '.HFFFF.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BB..B.',
       '.B.B...',
       '.BBBBB.',
       '..BBB..'],
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHHB.',
       '..BBB.B',
       '.BBBBB.',
       '.BB..B.',
       '..BBB..',
       '.BBBBB.',
       '..BBB..'],
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '.BBBB..',
       'BBBBBB.',
       '.BB.BB.',
       '..BBB..',
       '.BBBBB.',
       '..BBB..'],
    ],

    // walking — full body
    walk: [
      // frame 0
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.B.B.B.',
       '.BBBBB.',
       '..DDD..',
       '.D...D.',
       '.D...D.',
       'kk...kk'],
      // frame 1
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '.BBBBB.',
       '..BBB..',
       '.B.B.B.',
       '.BBBBB.',
       '..DDD..',
       '..D.D..',
       '.D...D.',
       'kk...kk'],
    ],

    // alert — standing, looking at monitor
    alert: [
      ['..HHH..',
       '.HFFFH.',
       '.HF.FH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       'BB.B.BB',
       '.BBBBB.',
       '..DDD..',
       '.D...D.',
       '.D...D.',
       'kk...kk'],
      ['..HHH..',
       '.HFfFH.',
       '.HFfFH.',
       '..HHH..',
       '.BBBBB.',
       '.BBBBB.',
       'B.BBB.B',
       '.BBBBB.',
       '..DDD..',
       '.D...D.',
       '.D...D.',
       'kk...kk'],
    ],

    // panic — hands up
    panic: [
      ['..HHH..',
       '.HfFFH.',
       '.HFfFH.',
       '..HHH..',
       'B.BBB.B',
       '.BBBBB.',
       '.BBBBB.',
       '.B.B.B.',
       '..DDD..',
       '.D...D.',
       '.D...D.',
       'kk...kk'],
      ['..HHH..',
       '.HFFFH.',
       '.HfFfH.',
       '..HHH..',
       'BB.B.BB',
       '.BBBBB.',
       '.BBBBB.',
       '.B.B.B.',
       '..DDD..',
       '.D...D.',
       '.D...D.',
       'kk...kk'],
    ],

    // sticky — writing on sticker
    sticky: [
      ['..HHH..',
       '.HFfFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BBB.ZZ',
       '.BBBZPZ',
       '..BBB..',
       '..BBB..'],
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BB..ZZ',
       '.BBBZPZ',
       '..BBB..',
       '..BBB..'],
    ],

    // sleep — lying on sofa
    sleep: [
      ['.HHH...',
       'HFFF...',
       'HFFF...',
       '.HHH...',
       'BBBBBBB',
       '.BBBBB.',
       'DDDDDDD'],
      ['.HHH...',
       'HFfF...',
       'HFfF...',
       '.HHH...',
       'BBBBBBB',
       '.BBBBB.',
       'DDDDDDD'],
    ],

    // confused
    confused: [
      ['..HHH..',
       '.HFfFH.',
       '.HFfFH.',
       '..HHH.H',
       '..BBB.F',
       '.BBBBB.',
       '.BB.BB.',
       '.BBBBB.',
       '..DDD..',
       '..DDD..'],
      ['..HHH..',
       '.HFFFH.',
       '.HFfFH.',
       '..HHHH.',
       '..BBB..',
       '.BBBBB.',
       '.BB.BB.',
       '.BBBBB.',
       '..DDD..',
       '..DDD..'],
    ],

    // coffee — standing at machine
    coffee: [
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BBBBB.',
       '.B...B.',
       '..DDD..',
       '..D.D..',
       '..D.D..',
       'kk...kk'],
      ['..HHH..',
       '.HFfFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBBB.',
       '.BBBBB.',
       '.BBB.B.',
       '..BBB..',
       '..DDD..',
       '..D.D..',
       '..D.D..',
       'kk...kk'],
    ],

    // pullup — arms on bar
    pullup: [
      ['.B...B.',
       '.B...B.',
       '..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '..BBB..',
       '.BBBBB.',
       '.BBBBB.',
       '..DDD..',
       '..DDD..'],
      ['BB...BB',
       '.B...B.',
       '..HHH..',
       '.HFfFH.',
       '.HFFFH.',
       '..HHH..',
       '.BBBBB.',
       '.BBBBB.',
       '..BBB..',
       '..DDD..',
       '..DDD..'],
    ],

    // stretch
    stretch: [
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       'B.BBB.B',
       '.BBBBB.',
       '.BBBBB.',
       '..BBB..',
       '..DDD..',
       '.D...D.',
       'kk...kk'],
      ['..HHH..',
       '.HFFFH.',
       '.HFfFH.',
       '..HHH..',
       '.BBBBB',
       'B.BBBB.',
       '.BBBBB.',
       '..BBB..',
       '..DDD..',
       '.D...D.',
       'kk...kk'],
    ],

    // window — looking out
    window: [
      ['..HHH..',
       '.HFFFH.',
       '.HFFFH.',
       '..HHH..',
       '.BBBBB.',
       '.BBBBB.',
       '.BB.BB.',
       '..BBB..',
       '..DDD..',
       '..D.D..',
       'kk...kk'],
    ],
  };

  // Position presets for each animation (x=center, y=feet in scene coords)
  var POSITIONS = {
    typing:   { x: 72, y: null, sitting: true },  // y derived from desk
    happy:    { x: 72, y: null, sitting: true },
    sticky:   { x: 72, y: null, sitting: true },
    confused: { x: 72, y: null, sitting: true },
    alert:    { x: 68, y: null, standing: true },
    panic:    { x: 68, y: null, standing: true },
    walk:     { x: null, y: null, walking: true }, // x varies
    coffee:   { x: 116, y: null, standing: true },
    pullup:   { x: 127, y: 28, bar: true },
    stretch:  { x: 85, y: null, standing: true },
    window:   { x: 22, y: null, standing: true },
    sleep:    { x: 148, y: null, lying: true },
  };

  function drawAgent(ctx, H, anim, frame, walkX, monitorFlash) {
    var frames = AGENT[anim] || AGENT.typing;
    var frameIdx = Math.min(frame % frames.length, frames.length - 1);
    var grid = frames[frameIdx];
    var flY = H - 12;

    // Flashing monitor for panic
    if (monitorFlash && (anim === 'panic')) {
      ctx.fillStyle = (frame % 2 === 0) ? '#fca5a5' : '#ef4444';
      ctx.fillRect(65, H - 28 - 20, 28, 16);
    }

    var deskY = flY - 16;
    var gw = grid[0].length, gh = grid.length;
    var ox, oy;

    if (anim === 'sleep') {
      ox = 141; oy = flY - 8;
    } else if (anim === 'pullup') {
      ox = 123; oy = 16;
    } else if (anim === 'walk') {
      ox = (walkX || 85) - Math.floor(gw / 2);
      oy = flY - gh;
    } else if (anim === 'typing' || anim === 'happy' || anim === 'sticky' || anim === 'confused') {
      ox = 68 - Math.floor(gw / 2);
      oy = deskY - gh;
    } else if (anim === 'coffee') {
      ox = 111 - Math.floor(gw / 2);
      oy = flY - gh;
    } else if (anim === 'window') {
      ox = 22 - Math.floor(gw / 2);
      oy = flY - gh;
    } else {
      ox = 68 - Math.floor(gw / 2);
      oy = flY - gh;
    }

    drawGrid(ctx, grid, ox, oy);
  }

  // ── Speech bubble ─────────────────────────────────────────────────────────

  function drawBubble(ctx, text, H, anim, scale) {
    if (!text) return;
    scale = scale || 1;
    var flY = H - 12;
    var deskY = flY - 16;

    // Anchor above agent head
    var ax = (anim === 'sleep') ? 148 : (anim === 'coffee') ? 118 : (anim === 'pullup') ? 126 : 68;
    var ay = (anim === 'sleep' || anim === 'pullup') ? 15 : deskY - 22;

    var bw = Math.min(text.length * 4 + 6, 80);
    var bh = 11;
    var bx = Math.max(1, Math.min(ax - Math.floor(bw / 2), W - bw - 1));
    var by = Math.max(1, ay - bh - 3);

    // Bubble bg
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#d1a000';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    // Tail
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(ax - 1, by + bh, 3, 3);
    ctx.strokeStyle = '#d1a000';
    ctx.strokeRect(ax - 0.5, by + bh - 0.5, 2, 4);

    // Text
    ctx.fillStyle = '#1a1a2e';
    ctx.font = '4px monospace';
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = false;
    ctx.fillText(text.slice(0, 18), bx + 3, by + 4);
  }

  // ── Moving card animation ─────────────────────────────────────────────────

  function drawMovingCard(ctx, H, progress) {
    var monX = 63, deskY = (H - 12) - 16;
    var monY = deskY - 22;
    var scX = monX + 2, scY = monY + 2, scW = 28, scH = 16;
    var colW = Math.floor(scW / 5);
    // Card moves from col 1 to col 2
    var fromX = scX + colW + 1;
    var toX   = scX + colW * 2 + 1;
    var cardX = fromX + Math.round((toX - fromX) * progress);
    ctx.fillStyle = '#02BDB6cc';
    ctx.fillRect(cardX, scY + 3, colW - 2, 3);
  }

  // Expose
  window.AgentSprites = {
    drawBackground: drawBackground,
    drawFurniture:  drawFurniture,
    drawAgent:      drawAgent,
    drawBubble:     drawBubble,
    drawMovingCard: drawMovingCard,
  };
}());
