import crypto                    from 'crypto';
import express                   from 'express';
import { supabase }              from '../db/supabase';
import { paginateGet }           from '../http/fitbase';
import { shortName }             from '../core/names';
import { env, TRIAL_TRAINING_ID } from '../config';

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

// ── Plan cache (1 min) ────────────────────────────────────────────────────────

interface PlanItem {
  registration_id: number;
  time:            string;
  short_name:      string;
  training_name:   string;
  status:          number;
  status_label:    string;
  lead_id:         number | null;
}

const REG_STATUS_LABELS: Record<string, string> = {
  '0': 'Записан', '1': 'Подтверждено', '2': 'Отменено', '3': 'Пришёл', '4': 'Не пришёл',
};

let planCache: { date: string; items: PlanItem[]; at: number } | null = null;

function almatyDate(): string {
  return new Date(Date.now() + ALMATY_MS).toISOString().slice(0, 10);
}

function regStartHHMM(reg: Record<string, unknown>): string {
  const ev = reg.event as Record<string, unknown> | undefined;
  return String(ev?.time_start || '00:00').slice(0, 5);
}

function regShortName(reg: Record<string, unknown>): string {
  const client = reg.client as Record<string, unknown> | undefined;
  const lead   = reg.lead   as Record<string, unknown> | undefined;
  const cn = String(client?.name    || '').trim();
  const cs = String(client?.surname || '').trim();
  if (cn) return shortName({ name: cn + (cs ? ' ' + cs : '') });
  if (lead) return shortName(lead, client);
  return String(reg.client_name || reg.lead_title || '').trim() || `#${reg.id}`;
}

async function getTodayPlan(): Promise<PlanItem[]> {
  const today = almatyDate();
  if (planCache?.date === today && Date.now() - planCache.at < 60_000) return planCache.items;

  const regs  = await paginateGet('/schedule-registration', { date: today, page_size: 100 });
  const items: PlanItem[] = regs
    .map(reg => ({
      registration_id: Number(reg.id),
      time:            regStartHHMM(reg),
      short_name:      regShortName(reg),
      training_name:   (() => {
        const ev       = reg.event as Record<string, unknown> | undefined;
        const training = ev?.training as Record<string, unknown> | undefined;
        return String(training?.name || '');
      })(),
      status:          Number(reg.status ?? 0),
      status_label:    REG_STATUS_LABELS[String(reg.status ?? '0')] || String(reg.status),
      lead_id:         Number(reg.lead_id ?? 0) || null,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  planCache = { date: today, items, at: Date.now() };
  return items;
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
.page{max-width:1100px;margin:0 auto;padding:12px}
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
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.hdr h1{font-size:18px;font-weight:700;flex:1}
.hdr-actions{display:flex;gap:8px;align-items:center}
/* Error banner */
#err-banner{display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:8px 14px;border-radius:8px;margin-bottom:12px;font-size:13px}
#err-banner.show{display:block}
/* Grid */
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:680px){.grid{grid-template-columns:1fr}}
.section{background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;padding:14px}
.section h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--c-muted);margin-bottom:10px}
.section-alerts{grid-column:1/-1}
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
/* Plan table */
.plan-table{width:100%;border-collapse:collapse;font-size:13px}
.plan-table td{padding:5px 6px;border-bottom:1px solid var(--c-border)}
.plan-table tr:last-child td{border-bottom:none}
.status-0{color:var(--c-muted)}.status-1{color:var(--c-ok)}.status-2{color:var(--c-urgent)}
.status-3{color:var(--c-ok)}.status-4{color:var(--c-imp)}
/* Feed */
.feed-item{padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px}
.feed-item:last-child{border-bottom:none}
.feed-time{color:var(--c-muted);font-size:11px}
.empty{color:var(--c-muted);font-size:13px;text-align:center;padding:20px}
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
      </div>
    </div>
    <div id="err-banner"></div>
    <div class="grid">
      <div class="section section-alerts">
        <h2>Сейчас важно <span id="alert-count" style="font-weight:400"></span></h2>
        <div id="alerts-list"></div>
      </div>
      <div class="section">
        <h2>План на сегодня</h2>
        <table class="plan-table" id="plan-table"><tbody></tbody></table>
      </div>
      <div class="section">
        <h2>Лента</h2>
        <div id="feed-list"></div>
      </div>
    </div>
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
    const d = new Date(iso);
    return d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
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
    if (sorted.length === 0){ list.innerHTML = '<div class="empty">Тревог нет</div>'; return; }
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

  const STATUS_CLS = ['status-0','status-1','status-2','status-3','status-4'];
  function renderPlan(plan){
    const tbody = $('plan-table').querySelector('tbody');
    if (!plan.length){ tbody.innerHTML = '<tr><td class="empty" colspan="3">Занятий нет</td></tr>'; return; }
    tbody.innerHTML = plan.map(p =>
      \`<tr>
        <td style="width:40px;font-weight:600">\${esc(p.time)}</td>
        <td>\${esc(p.short_name)}<br><span style="font-size:11px;color:var(--c-muted)">\${esc(p.training_name)}</span></td>
        <td class="\${STATUS_CLS[p.status]||''}" style="white-space:nowrap">\${esc(p.status_label)}</td>
      </tr>\`
    ).join('');
  }

  function renderFeed(feed){
    const el = $('feed-list');
    if (!feed.length){ el.innerHTML = '<div class="empty">Событий нет</div>'; return; }
    el.innerHTML = feed.map(f =>
      \`<div class="feed-item">
        <span class="feed-time">\${feedTime(f.created_at)}</span>
        \${f.short_name ? ' <b>'+esc(f.short_name)+'</b>' : ''}
        \${f.text ? ' '+esc(f.text) : ''}
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
      if (!res.ok){ showError('Ошибка сервера ('+res.status+')'); return; }
      hideError();
      const data = await res.json();
      renderAlerts(data.alerts||[]);
      renderPlan(data.plan||[]);
      renderFeed(data.feed||[]);
      // Notifications for new alerts
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
    }
  }

  // Auto-start if cookie exists
  fetch('/window/api/state?since_id=0').then(r => {
    if (r.ok){
      $('login-screen').style.display = 'none';
      $('app').style.display = 'block';
      r.json().then(data => {
        renderAlerts(data.alerts||[]);
        renderPlan(data.plan||[]);
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

  // Serve the window page
  app.get('/window', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(HTML);
  });

  // Login
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

  // State endpoint
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

      // Today's plan (from Fitbase, cached 1 min)
      const plan = await getTodayPlan();

      // Feed: last 50 agent_events today, phones stripped
      const { data: feedRaw, error: e3 } = await supabase
        .from('agent_events')
        .select('id, created_at, short_name, text, type')
        .gte('created_at', today + 'T00:00:00+05:00')
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
        alerts:     alerts ?? [],
        new_alerts: newAlerts ?? [],
        plan,
        feed,
        server_time: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[window] state error:', (e as Error).message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Ack an alert
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
