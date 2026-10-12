import crypto                    from 'crypto';
import express                   from 'express';
import { supabase }              from '../db/supabase';
import { env }                   from '../config';

const ALMATY_MS    = 5 * 3600 * 1000;
const COOKIE_NAME  = 'swtoken';
const COOKIE_MAX_S = 30 * 86400;

// ── Token helpers ─────────────────────────────────────────────────────────────

function windowSecret(): string {
  return env.WINDOW_SECRET || env.CRON_SECRET;
}

function makeToken(): string {
  const exp     = Math.floor(Date.now() / 1000) + COOKIE_MAX_S;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig     = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', windowSecret()).update(payload).digest('base64url');
  try {
    const eSig = Buffer.from(expected, 'base64url');
    const gSig = Buffer.from(sig,      'base64url');
    if (eSig.length !== gSig.length) return false;
    if (!crypto.timingSafeEqual(eSig, gSig)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number };
    return data.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

function getToken(req: express.Request): string | null {
  const header = req.headers.cookie || '';
  const part   = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  return part ? part.slice(COOKIE_NAME.length + 1) : null;
}

function requireAuth(req: express.Request, res: express.Response): boolean {
  const token = getToken(req);
  if (token && verifyToken(token)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// ── Feed helpers ──────────────────────────────────────────────────────────────

const PHONE_RE = /\+?[78]?\s*[\(\-]?\d{3}[\)\-\s]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;

function stripPhones(text: string): string {
  return text.replace(PHONE_RE, '[тел]');
}

// ── HTML page ─────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SlimWay — помощник</title>
<style>
:root{
  --c-bg:#f8f9fa;--c-card:#fff;--c-border:#e2e8f0;--c-text:#1a202c;--c-muted:#718096;
  --c-urgent:#ef4444;--c-imp:#f59e0b;--c-info:#3b82f6;--c-ok:#10b981;
  --c-urgent-bg:#fef2f2;--c-imp-bg:#fffbeb;--c-info-bg:#eff6ff;
}
@media(prefers-color-scheme:dark){
  :root{--c-bg:#0f172a;--c-card:#1e293b;--c-border:#334155;--c-text:#f1f5f9;--c-muted:#94a3b8;
    --c-urgent-bg:#450a0a;--c-imp-bg:#451a03;--c-info-bg:#0c2c5a;}
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--c-bg);color:var(--c-text);font-size:14px}
a{color:inherit}
.page{max-width:860px;margin:0 auto;padding:12px}
/* Login */
#login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{background:var(--c-card);border:1px solid var(--c-border);border-radius:12px;padding:32px;width:320px;text-align:center}
.login-box h1{font-size:20px;margin-bottom:20px}
.login-box input{width:100%;padding:10px 12px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-bg);color:var(--c-text);font-size:14px;margin-bottom:12px}
.btn{padding:9px 18px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500}
.btn-primary{background:var(--c-info);color:#fff;width:100%}
.btn-sm{background:var(--c-card);border:1px solid var(--c-border);color:var(--c-text);padding:6px 12px;font-size:12px}
.btn-sm:hover{background:var(--c-border)}
/* Header */
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:4px;flex-wrap:wrap}
.hdr h1{font-size:18px;font-weight:700;flex:1}
.hdr-actions{display:flex;gap:8px;align-items:center}
/* Status bar */
.status-bar{font-size:12px;color:var(--c-muted);margin-bottom:8px}
/* Stale banner */
.stale-banner{background:#fef9c3;border:1px solid #fde047;color:#713f12;padding:8px 14px;border-radius:8px;margin-bottom:10px;font-size:13px}
/* Error banner */
#err-banner{display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:8px 14px;border-radius:8px;margin-bottom:12px;font-size:13px}
#err-banner.show{display:block}
/* Sections */
.section{background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;padding:14px;margin-bottom:12px}
.section h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--c-muted);margin-bottom:10px}
/* Alert cards */
.alert-card{border-radius:8px;padding:12px;margin-bottom:8px;border-left:3px solid}
.alert-card:last-child{margin-bottom:0}
.alert-card.urgent{background:var(--c-urgent-bg);border-color:var(--c-urgent)}
.alert-card.important{background:var(--c-imp-bg);border-color:var(--c-imp)}
.alert-card.info{background:var(--c-info-bg);border-color:var(--c-info)}
.alert-card.acked{opacity:.5}
.alert-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.alert-title{font-weight:600;font-size:13px}
.alert-meta{font-size:11px;color:var(--c-muted);white-space:nowrap}
.alert-name{font-size:12px;color:var(--c-muted);margin-top:2px}
.alert-body{font-size:13px;margin-top:4px}
.alert-hint{font-size:12px;color:var(--c-muted);margin-top:3px;font-style:italic}
.alert-footer{display:flex;justify-content:flex-end;margin-top:8px}
/* Feed */
.feed-item{padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px}
.feed-item:last-child{border-bottom:none}
.feed-time{color:var(--c-muted);font-size:11px}
.empty{color:var(--c-muted);font-size:13px;text-align:center;padding:20px}
/* Help modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-box{background:var(--c-card);border:1px solid var(--c-border);border-radius:12px;padding:24px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto}
.modal-box h3{font-size:16px;margin-bottom:14px}
.modal-rule{display:flex;gap:10px;margin-bottom:10px;font-size:13px;line-height:1.45}
.dot{width:10px;height:10px;border-radius:50%;margin-top:3px;flex-shrink:0}
.dot-urgent{background:var(--c-urgent)}.dot-imp{background:var(--c-imp)}
.modal-note{font-size:12px;color:var(--c-muted);margin-bottom:8px}
.modal-close{margin-top:16px;width:100%}
#app{display:none}
</style>
</head>
<body>
<div id="login-screen">
  <div class="login-box">
    <h1>SlimWay — помощник</h1>
    <input type="password" id="pw-input" placeholder="Пароль" autocomplete="current-password">
    <button class="btn btn-primary" id="pw-btn">Войти</button>
    <div id="login-err" style="color:var(--c-urgent);font-size:12px;margin-top:8px"></div>
  </div>
</div>

<div id="app">
  <div class="page">
    <div class="hdr">
      <h1 id="page-title">SlimWay — помощник</h1>
      <div class="hdr-actions">
        <button class="btn btn-sm" id="notif-btn">Уведомления</button>
        <button class="btn btn-sm" id="sound-btn">Звук: вкл</button>
        <button class="btn btn-sm" id="help-btn">?</button>
      </div>
    </div>
    <div class="status-bar" id="status-bar">Последняя проверка: — · Связь: —</div>
    <div class="stale-banner" id="stale-banner" style="display:none">⚠ Агент не запускался более 10 минут</div>
    <div id="err-banner"></div>

    <div class="section">
      <h2>Сейчас важно <span id="alert-count" style="font-weight:400"></span></h2>
      <div id="alerts-list"></div>
    </div>

    <div class="section">
      <h2>Лента</h2>
      <div id="feed-list"></div>
    </div>
  </div>
</div>

<!-- Help modal -->
<div class="modal-overlay" id="help-modal" style="display:none">
  <div class="modal-box">
    <h3>Как пользоваться окном</h3>
    <div class="modal-rule"><div class="dot dot-urgent"></div><div><b>Новая заявка</b> — в воронку «Новые заявки» попал лид. Возьми в работу в течение 2 часов.</div></div>
    <div class="modal-rule"><div class="dot dot-urgent"></div><div><b>Не пришёл на занятие</b> — клиент не отметился через 30 мин после начала. Позвони и отметь в расписании.</div></div>
    <div class="modal-rule"><div class="dot dot-urgent"></div><div><b>Абонемент закончился</b> — у клиента нет ни одного активного абонемента. Свяжись и предложи продление.</div></div>
    <div class="modal-rule"><div class="dot dot-imp"></div><div><b>Заканчивается абонемент</b> — осталось 2 посещения или меньше. Предложи продление заблаговременно.</div></div>
    <p class="modal-note">Красный цвет — срочно, жёлтый — важно.</p>
    <p class="modal-note">«Принято» убирает тревогу из активных. Тревога «Не пришёл» закрывается автоматически через 24 ч после нажатия «Принято».</p>
    <p class="modal-note">Кнопка «Уведомления» в шапке — разреши браузеру показывать всплывающие уведомления для новых тревог.</p>
    <button class="btn btn-sm modal-close" id="help-close">Закрыть</button>
  </div>
</div>

<audio id="beep-audio" preload="none"></audio>

<script>
(function(){
  const $ = id => document.getElementById(id);
  let since_id = 0;
  let soundOn = localStorage.getItem('sw_sound') !== 'false';
  let notifGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  let audioCtx = null;

  // ── Sound ────────────────────────────────────────────────────────────────────
  function playBeep(){
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
    } catch(e){ /* silent */ }
  }

  $('sound-btn').textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
  $('sound-btn').onclick = function(){
    soundOn = !soundOn;
    localStorage.setItem('sw_sound', soundOn ? 'true' : 'false');
    this.textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
    if (soundOn) playBeep();
  };

  $('notif-btn').onclick = function(){
    if (typeof Notification === 'undefined'){ alert('Уведомления не поддерживаются'); return; }
    Notification.requestPermission().then(p => {
      notifGranted = p === 'granted';
      $('notif-btn').textContent = notifGranted ? 'Уведомления вкл' : 'Уведомления выкл';
    });
  };
  if (notifGranted) $('notif-btn').textContent = 'Уведомления вкл';

  // ── Help modal ───────────────────────────────────────────────────────────────
  $('help-btn').onclick  = () => { $('help-modal').style.display = 'flex'; };
  $('help-close').onclick = () => { $('help-modal').style.display = 'none'; };
  $('help-modal').onclick = e => { if (e.target === $('help-modal')) $('help-modal').style.display = 'none'; };

  // ── Login ────────────────────────────────────────────────────────────────────
  async function login(){
    const pw = $('pw-input').value;
    const res = await fetch('/window/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pw})
    });
    if (res.ok){
      $('login-screen').style.display = 'none';
      $('app').style.display = 'block';
      fetchState();
    } else {
      $('login-err').textContent = 'Неверный пароль';
    }
  }
  $('pw-btn').onclick = login;
  $('pw-input').addEventListener('keydown', e => { if(e.key==='Enter') login(); });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function timeAgo(iso){
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (d < 1) return 'только что';
    if (d < 60) return d+'м назад';
    const h = Math.floor(d/60);
    if (h < 24) return h+'ч '+(d%60)+'м';
    return Math.floor(h/24)+'д';
  }
  function feedTime(iso){
    const d = new Date(new Date(iso).getTime() + 5*3600_000);
    return d.toISOString().slice(11,16);
  }
  function fmtHHMM(iso){
    const d = new Date(new Date(iso).getTime() + 5*3600_000);
    return d.toISOString().slice(11,16);
  }
  function isWorkHourAlmaty(iso){
    const h = new Date(new Date(iso).getTime() + 5*3600_000).getUTCHours();
    return h >= 8 && h < 23;
  }

  // ── Status bar ───────────────────────────────────────────────────────────────
  function updateStatus(data, ok){
    if (!ok){ $('status-bar').textContent = 'Последняя проверка: — · Связь: нет'; return; }
    const last = data.last_watch_at;
    const srv  = data.server_time;
    const t    = last ? fmtHHMM(last) : '—';
    $('status-bar').textContent = 'Последняя проверка: ' + t + ' · Связь: есть';
    if (last && srv) {
      const stale = (new Date(srv) - new Date(last)) > 10*60_000 && isWorkHourAlmaty(srv);
      $('stale-banner').style.display = stale ? 'block' : 'none';
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const LEVEL_ORDER = {urgent:0, important:1, info:2};
  function renderAlerts(alerts){
    const list = $('alerts-list');
    const sorted = [...alerts].sort((a,b)=>{
      const lo = (LEVEL_ORDER[a.level]||2) - (LEVEL_ORDER[b.level]||2);
      if (lo !== 0) return lo;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const active = sorted.filter(a => !a.acked_at);
    $('alert-count').textContent = active.length ? '('+active.length+')' : '';
    document.title = (active.length ? '('+active.length+') ' : '') + 'SlimWay — помощник';
    if (sorted.length === 0){
      list.innerHTML = '<div class="empty">Всё под контролем — тревог нет</div>';
      return;
    }
    list.innerHTML = sorted.map(a => {
      const cls = a.level + (a.acked_at ? ' acked' : '');
      const mgr = a.manager_name ? '<span> · '+esc(a.manager_name)+'</span>' : '';
      return \`<div class="alert-card \${cls}" data-id="\${a.id}">
        <div class="alert-top">
          <div>
            <div class="alert-title">\${esc(a.title)}</div>
            <div class="alert-name">\${esc(a.short_name||'')+mgr}</div>
          </div>
          <div class="alert-meta">\${timeAgo(a.created_at)}</div>
        </div>
        <div class="alert-body">\${esc(a.body)}</div>
        \${a.action_hint ? '<div class="alert-hint">→ '+esc(a.action_hint)+'</div>' : ''}
        \${!a.acked_at ? '<div class="alert-footer"><button class="btn btn-sm" onclick="ack('+a.id+')">Принято</button></div>' : ''}
      </div>\`;
    }).join('');
  }

  function renderFeed(feed){
    const el = $('feed-list');
    if (!feed.length){ el.innerHTML = '<div class="empty">Действий нет</div>'; return; }
    el.innerHTML = feed.map(f =>
      \`<div class="feed-item">
        <span class="feed-time">\${feedTime(f.created_at)}</span>
        \${f.short_name ? ' <b>'+esc(f.short_name)+'</b>' : ''}
        \${f.text ? ' — '+esc(f.text) : ''}
      </div>\`
    ).join('');
  }

  // ── Ack ──────────────────────────────────────────────────────────────────────
  window.ack = async function(id){
    await fetch('/window/api/ack/'+id, {method:'POST'});
    fetchState();
  };

  // ── Poll ─────────────────────────────────────────────────────────────────────
  function showError(msg){ const b=$('err-banner'); b.textContent=msg; b.classList.add('show'); }
  function hideError(){ $('err-banner').classList.remove('show'); }

  async function fetchState(){
    try {
      const res = await fetch('/window/api/state?since_id='+since_id);
      if (res.status === 401){ $('app').style.display='none'; $('login-screen').style.display='flex'; return; }
      if (!res.ok){ showError('Ошибка сервера ('+res.status+')'); updateStatus(null,false); return; }
      hideError();
      const data = await res.json();
      updateStatus(data, true);
      renderAlerts(data.alerts||[]);
      renderFeed(data.feed||[]);
      for (const a of (data.new_alerts||[])){
        since_id = Math.max(since_id, a.id);
        if (['urgent','important'].includes(a.level)){
          if (notifGranted){
            new Notification(a.title, {body: (a.short_name||'') + (a.action_hint ? ' — '+a.action_hint : '')});
          }
          if (a.level === 'urgent') playBeep();
        }
      }
    } catch(e){
      showError('Нет связи с сервером');
      updateStatus(null, false);
    }
  }

  // Auto-start if cookie exists
  fetch('/window/api/state?since_id=0').then(r => {
    if (r.ok){
      $('login-screen').style.display = 'none';
      $('app').style.display = 'block';
      r.json().then(data => {
        updateStatus(data, true);
        renderAlerts(data.alerts||[]);
        renderFeed(data.feed||[]);
        if (data.alerts) since_id = Math.max(...(data.alerts.map(a=>a.id||0)), 0);
      });
    }
  }).catch(()=>{});

  setInterval(fetchState, 20000);
})();
</script>
</body>
</html>`;

// ── Express routes ────────────────────────────────────────────────────────────

export function mountWindowRoutes(app: express.Application): void {
  app.use(express.json());

  app.get('/window', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(HTML);
  });

  app.post('/window/login', (req, res) => {
    const pw = (req.body as Record<string, unknown>)?.password;
    if (!env.WINDOW_PASSWORD || String(pw) !== env.WINDOW_PASSWORD) {
      res.status(401).json({ error: 'Invalid password' }); return;
    }
    const token = makeToken();
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_S}; Path=/window`,
    );
    res.json({ ok: true });
  });

  app.get('/window/api/state', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const sinceId = Number(req.query.since_id) || 0;
      const today   = new Date(Date.now() + ALMATY_MS).toISOString().slice(0, 10);

      // Active alerts (unresolved)
      const { data: alerts, error: e1 } = await supabase
        .from('watch_alerts')
        .select('id, alert_key, rule, level, lead_id, client_id, registration_id, manager_name, short_name, title, body, action_hint, created_at, acked_at')
        .is('resolved_at', null)
        .order('created_at', { ascending: false });
      if (e1) throw e1;

      // New alerts (for notifications)
      const { data: newAlerts, error: e2 } = sinceId > 0
        ? await supabase
            .from('watch_alerts')
            .select('id, alert_key, rule, level, short_name, title, action_hint')
            .gt('id', sinceId)
            .is('resolved_at', null)
        : { data: [], error: null };
      if (e2) throw e2;

      // Last successful watch run (for status bar)
      const { data: lastRun } = await supabase
        .from('job_runs')
        .select('finished_at')
        .eq('job', 'watch')
        .eq('status', 'ok')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Feed: last 50 agent actions today (lead_moved, task_created, budget_updated)
      const { data: feedRaw, error: e3 } = await supabase
        .from('agent_events')
        .select('id, created_at, short_name, text, type')
        .gte('created_at', today + 'T00:00:00+05:00')
        .in('type', ['lead_moved', 'task_created', 'budget_updated'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (e3) throw e3;

      const feed = (feedRaw ?? []).map(f => ({
        id:         f.id,
        created_at: f.created_at,
        short_name: f.short_name,
        text:       stripPhones(String(f.text || '')),
        type:       f.type,
      }));

      res.json({
        alerts:        alerts ?? [],
        new_alerts:    newAlerts ?? [],
        feed,
        server_time:   new Date().toISOString(),
        last_watch_at: lastRun?.finished_at ?? null,
      });
    } catch (e) {
      console.error('[window] state error:', (e as Error).message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/window/api/ack/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: 'bad id' }); return; }
    const { error } = await supabase
      .from('watch_alerts')
      .update({ acked_at: new Date().toISOString() })
      .eq('id', id)
      .is('acked_at', null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  });
}
