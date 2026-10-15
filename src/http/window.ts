import crypto from 'crypto';
import path   from 'path';
import fs     from 'fs';
import express from 'express';
import { supabase } from '../db/supabase';
import { env } from '../config';
import { rawGet } from './fitbase';

const ALMATY_MS    = 5 * 3600 * 1000;
const COOKIE_NAME  = 'swtoken';
const COOKIE_MAX_S = 30 * 86400;

// Loaded once at startup; served as /window/app.js
const WINDOW_APP_JS = fs.readFileSync(
  path.join(__dirname, '../../public/window-app.js'),
  'utf8',
);

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

// ── Lead source cache ─────────────────────────────────────────────────────────

const SRC_MAP: Record<number, string> = { 25: 'tiktok', 4: 'instagram', 14: 'whatsapp', 2: 'site' };
const srcCache = new Map<number, { src: string; at: number }>();
const SRC_TTL  = 5 * 60_000;

async function fetchLeadSource(leadId: number): Promise<string> {
  const hit = srcCache.get(leadId);
  if (hit && Date.now() - hit.at < SRC_TTL) return hit.src;
  try {
    const data  = await rawGet(`/lead/${leadId}`);
    const advId = ((data?.item as Record<string, unknown>)?.advertising_source as Record<string, unknown>)?.id as number | undefined;
    const src   = (advId != null && SRC_MAP[advId]) ? SRC_MAP[advId] : 'other';
    srcCache.set(leadId, { src, at: Date.now() });
    return src;
  } catch {
    return 'other';
  }
}

// ── HTML page ─────────────────────────────────────────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#02BDB6">
<link rel="manifest" href="/window/manifest.json">
<title>SlimWay — помощник</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --brand:#02BDB6;--accent:#263CD9;
  --red:#ef4444;--orange:#f59e0b;--yellow:#eab308;--green:#10b981;
  --c-bg:#eef2f7;--c-text:#1a202c;--c-muted:#64748b;--c-border:rgba(255,255,255,0.6);
  --glass:rgba(255,255,255,0.55);--card:rgba(255,255,255,0.82);
  --shadow:0 4px 24px rgba(2,49,100,0.08);
  --radius-panel:20px;--radius-card:14px;
}
[data-theme="dark"]{
  --c-bg:#0d1117;--c-text:#e2e8f0;--c-muted:#94a3b8;--c-border:rgba(255,255,255,0.08);
  --glass:rgba(20,28,44,0.62);--card:rgba(20,28,44,0.82);
  --shadow:0 4px 24px rgba(0,0,0,0.35);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Manrope',system-ui,sans-serif;background:var(--c-bg);color:var(--c-text);font-size:14px;overflow-x:hidden}
a{color:inherit}
.blob{position:fixed;border-radius:50%;filter:blur(80px);opacity:.25;pointer-events:none;z-index:0}
.blob-1{width:600px;height:600px;background:var(--brand);top:-200px;right:-150px}
.blob-2{width:500px;height:500px;background:var(--accent);bottom:-150px;left:-100px}
[data-theme="dark"] .blob{opacity:.15}
.glass{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--c-border);border-radius:var(--radius-panel);box-shadow:var(--shadow);position:relative;z-index:1}
#login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{width:320px;padding:36px;text-align:center}
.login-box h1{font-size:22px;font-weight:700;margin-bottom:6px}
.login-tagline{font-size:13px;color:var(--c-muted);margin-bottom:24px}
.login-box input{width:100%;padding:11px 14px;border:1.5px solid var(--c-border);border-radius:10px;background:var(--card);color:var(--c-text);font-size:14px;font-family:inherit;margin-bottom:12px;outline:none}
.login-box input:focus{border-color:var(--brand)}
.btn{padding:10px 18px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;transition:opacity .15s,transform .1s}
.btn:active{transform:scale(.97)}
.btn-primary{background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff;width:100%}
.btn-sm{background:var(--card);border:1px solid var(--c-border);color:var(--c-text);padding:6px 12px;font-size:12px;font-weight:500}
.btn-sm:hover{opacity:.8}
.btn-ack{background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff;padding:7px 14px;font-size:12px}
.btn-take{background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff;padding:8px 16px;font-size:13px;margin-top:10px;width:100%}
#app{display:none;position:relative;z-index:1}
#app.visible{display:block}
.page{max-width:900px;margin:0 auto;padding:14px 14px 0}
.hdr{display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap}
.hdr-title{font-size:18px;font-weight:700;flex:1}
.hdr-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--brand),var(--accent));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}
.hdr-actions{display:flex;gap:6px;align-items:center}
.status-bar{font-size:12px;color:var(--c-muted);margin-bottom:6px}
.stats-pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.stat-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:var(--card);border:1px solid var(--c-border)}
.sp-lead{background:rgba(239,68,68,.08);color:var(--red);border-color:rgba(239,68,68,.2)}
.sp-brand{background:rgba(2,189,182,.08);color:var(--brand);border-color:rgba(2,189,182,.2)}
.sp-task{background:rgba(38,61,217,.08);color:var(--accent);border-color:rgba(38,61,217,.2)}
.sp-muted{background:rgba(100,116,139,.08);color:var(--c-muted)}
.stale-banner{background:#fef9c3;border:1px solid #fde047;color:#713f12;padding:8px 14px;border-radius:10px;margin-bottom:10px;font-size:13px}
#err-banner{display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:8px 14px;border-radius:10px;margin-bottom:10px;font-size:13px}
#err-banner.show{display:block}
.columns{display:flex;flex-direction:column;gap:10px;padding-bottom:14px}
.col-alerts{order:1}.col-closed{order:2}.col-feed{order:3}
.col-hdr{padding:12px 16px 10px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:8px}
.col-hdr h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-muted);flex:1}
.col-body{padding:10px 12px 12px}
.card{background:var(--card);border-radius:var(--radius-card);padding:12px 14px;margin-bottom:8px;border:1.5px solid var(--c-border);transition:transform .15s,box-shadow .15s}
.card:last-child{margin-bottom:0}
.card:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.09)}
.card.urgent{border-color:var(--red)}
.card.important{border-color:var(--orange)}
.card.info{border-color:rgba(38,61,217,.3)}
.card-top{display:flex;align-items:flex-start;gap:8px}
.card-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px}
.icon-urgent{background:rgba(239,68,68,.12);color:var(--red)}
.icon-important{background:rgba(245,158,11,.12);color:var(--orange)}
.icon-info{background:rgba(38,61,217,.1);color:var(--accent)}
.card-main{flex:1;min-width:0}
.card-name{font-size:14px;font-weight:600;line-height:1.3}
.card-title{font-size:12px;color:var(--c-muted);margin-top:1px}
.card-body{font-size:12px;color:var(--c-muted);margin-top:5px;line-height:1.5}
.card-actions{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.card-age{font-size:11px;color:var(--c-muted)}
.card-new-lead{background:linear-gradient(var(--card),var(--card)) padding-box,linear-gradient(135deg,var(--brand),var(--accent)) border-box;border:2px solid transparent}
.card-new-lead .card-name{font-size:18px;font-weight:700}
.card-new-lead .card-icon{background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(2,189,182,.4)}50%{box-shadow:0 0 0 8px rgba(2,189,182,0)}}
.card-new-lead.fresh{animation:pulse-glow 2s ease-in-out infinite}
.escalation-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);color:var(--red);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;margin-top:6px}
.card-new-lead.escalated{border-color:var(--red) !important;background:linear-gradient(rgba(255,255,255,0.92),rgba(255,255,255,0.92)) padding-box,linear-gradient(135deg,var(--red),#f97316) border-box}
[data-theme="dark"] .card-new-lead.escalated{background:linear-gradient(rgba(20,28,44,.92),rgba(20,28,44,.92)) padding-box,linear-gradient(135deg,var(--red),#f97316) border-box}
.source-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(2,189,182,.1);color:var(--brand)}
.timer-lbl{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;background:rgba(2,189,182,.1);color:var(--brand);margin-top:4px}
.timer-lbl.warn{background:rgba(234,179,8,.12);color:#b45309}
.timer-lbl.late{background:rgba(239,68,68,.1);color:var(--red)}
.dl-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;margin-top:4px}
.dl-ok{background:rgba(100,116,139,.08);color:var(--c-muted)}
.dl-warn{background:rgba(245,158,11,.12);color:var(--orange)}
.dl-over{background:rgba(239,68,68,.1);color:var(--red)}
.task-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(38,61,217,.1);color:var(--accent);margin-right:4px}
.act-row{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
.btn-a{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;border:1.5px solid var(--c-border);background:var(--card);color:var(--c-text);cursor:pointer;text-decoration:none;line-height:1;transition:opacity .15s}
.btn-a:hover{opacity:.75}
.btn-a-wa{background:rgba(37,211,102,.1);color:#16a34a;border-color:rgba(37,211,102,.3)}
.btn-a-call{background:rgba(2,189,182,.1);color:var(--brand);border-color:rgba(2,189,182,.3)}
.clients-toggle{font-size:11px;color:var(--accent);cursor:pointer;margin-top:4px;display:inline-block}
.clients-list{font-size:11px;color:var(--c-muted);line-height:1.6;margin-top:3px;display:none}
.closed-card{background:var(--card);border-radius:10px;padding:9px 12px;margin-bottom:6px;border:1px solid var(--c-border);opacity:.8}
.closed-card:last-child{margin-bottom:0}
.closed-top{display:flex;align-items:center;gap:8px}
.closed-title{font-size:13px;font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.closed-time{font-size:11px;color:var(--c-muted);white-space:nowrap;flex-shrink:0}
.closed-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
.chip{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.chip-green{background:rgba(16,185,129,.12);color:var(--green)}
.chip-accent{background:rgba(38,61,217,.1);color:var(--accent)}
.chip-gray{background:rgba(100,116,139,.1);color:var(--c-muted)}
.section-toggle{cursor:pointer;user-select:none}
.section-chevron{font-size:10px;color:var(--c-muted);transition:transform .2s}
.section-chevron.open{transform:rotate(180deg)}
.feed-wrap{position:relative;padding-left:20px}
.feed-wrap::before{content:'';position:absolute;left:5px;top:6px;bottom:6px;width:2px;background:var(--c-border);border-radius:1px}
.feed-item{position:relative;padding:4px 0 6px 12px;font-size:12px;line-height:1.4}
.feed-item::before{content:'';position:absolute;left:-3px;top:8px;width:10px;height:10px;border-radius:50%;background:var(--dot-c,var(--c-muted));border:2px solid var(--c-bg)}
.feed-time{font-size:11px;color:var(--c-muted);margin-right:6px}
.feed-name{font-weight:600}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-box{width:90%;max-width:480px;max-height:90vh;overflow-y:auto;padding:28px}
.modal-box h3{font-size:18px;font-weight:700;margin-bottom:16px}
.modal-rule{display:flex;gap:10px;margin-bottom:10px;font-size:13px;line-height:1.5}
.dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex-shrink:0;background:var(--c-muted)}
.modal-note{font-size:12px;color:var(--c-muted);margin-bottom:8px}
.modal-close{margin-top:16px;width:100%}
.btn-icon{background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;color:var(--c-muted);font-size:18px;line-height:1;transition:background .15s}
.btn-icon:hover{background:var(--c-border)}
.empty{color:var(--c-muted);font-size:13px;text-align:center;padding:20px}
#login-err{color:var(--red);font-size:12px;margin-top:8px;min-height:18px}
@media(min-width:1100px){
  body{overflow:hidden}
  #app.visible{display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .page{flex:1;min-height:0;display:flex;flex-direction:column;max-width:none;padding:12px 16px 0}
  .page-hdr{flex-shrink:0}
  .columns{flex:1;min-height:0;display:flex;flex-direction:row;gap:10px;padding-bottom:12px}
  .col-feed{flex:28 28 0;order:1;overflow-y:auto;display:flex;flex-direction:column}
  .col-alerts{flex:44 44 0;order:2;overflow-y:auto;display:flex;flex-direction:column}
  .col-closed{flex:28 28 0;order:3;overflow-y:auto;display:flex;flex-direction:column}
  .col-hdr{position:sticky;top:0;z-index:2;border-radius:var(--radius-panel) var(--radius-panel) 0 0}
  .col-body{flex:1}
  .col-closed .section-toggle{cursor:default}
  .col-closed .section-chevron{display:none}
  .card{padding:10px 12px}
  .card-new-lead{padding:12px 14px}
}
</style>
</head>
<body>
<div class="blob blob-1"></div>
<div class="blob blob-2"></div>

<div id="login-screen">
  <div class="login-box glass">
    <div class="hdr-logo" style="margin:0 auto 14px">SW</div>
    <h1>SlimWay</h1>
    <p class="login-tagline">Помощник администратора</p>
    <input type="password" id="pw-input" placeholder="Пароль" autocomplete="current-password">
    <button class="btn btn-primary" id="pw-btn">Войти</button>
    <div id="login-err"></div>
  </div>
</div>

<div id="app">
  <div class="page">
    <div class="page-hdr">
      <div class="hdr">
        <div class="hdr-logo">SW</div>
        <span class="hdr-title">SlimWay — помощник</span>
        <div class="hdr-actions">
          <button class="btn btn-sm" id="notif-btn">Уведомления</button>
          <button class="btn btn-sm" id="sound-btn">Звук: вкл</button>
          <button class="btn-icon" id="theme-btn" title="Тема">🌙</button>
          <button class="btn btn-sm" id="help-btn">?</button>
        </div>
      </div>
      <div class="status-bar" id="status-bar">Последняя проверка: — · Связь: —</div>
      <div id="stats-pills" class="stats-pills"></div>
      <div class="stale-banner" id="stale-banner" style="display:none">⚠ Агент не запускался более 10 минут</div>
      <div id="err-banner"></div>
    </div>
    <div class="columns">
      <div class="glass col-feed">
        <div class="col-hdr"><h2>Лента событий</h2></div>
        <div class="col-body" id="feed-list"></div>
      </div>
      <div class="glass col-alerts">
        <div class="col-hdr"><h2>Сейчас важно</h2><span id="alert-count" style="font-size:12px;color:var(--c-muted)"></span></div>
        <div class="col-body" id="alerts-list"></div>
      </div>
      <div class="glass col-closed" id="closed-section">
        <div class="col-hdr section-toggle" onclick="toggleClosed()">
          <h2>Завершённые за 24 ч</h2>
          <span id="closed-count" style="font-size:12px;color:var(--c-muted)"></span>
          <span class="section-chevron" id="closed-chevron">▾</span>
        </div>
        <div class="col-body" id="closed-list" style="display:none"></div>
      </div>
    </div>
  </div>
</div>

<div class="modal-overlay" id="help-modal" style="display:none">
  <div class="modal-box glass">
    <h3>Как пользоваться окном</h3>
    <div class="modal-rule"><div class="dot" style="background:var(--red)"></div><div><b>Новая заявка</b> — лид в воронке. Нажми «Взял в работу» в течение 2 ч.</div></div>
    <div class="modal-rule"><div class="dot" style="background:var(--red)"></div><div><b>Не пришёл на занятие</b> — клиент не отметился через 30 мин после начала. Позвони и отметь.</div></div>
    <div class="modal-rule"><div class="dot" style="background:var(--red)"></div><div><b>Абонемент закончился</b> — нет активных абонементов. Предложи продление.</div></div>
    <div class="modal-rule"><div class="dot" style="background:var(--orange)"></div><div><b>Заканчивается абонемент</b> — осталось ≤2 посещения. Предложи заблаговременно.</div></div>
    <p class="modal-note">Красный — срочно, жёлтый — важно. «Принято» убирает тревогу.</p>
    <p class="modal-note">Кнопка «Уведомления» — разреши браузеру показывать всплывающие сообщения.</p>
    <button class="btn btn-sm modal-close" id="help-close">Закрыть</button>
  </div>
</div>

<audio id="beep-audio" preload="none"></audio>
<script>window.LEAD_URL='__LEAD_URL__';window.CLIENT_URL='__CLIENT_URL__';</script>
<script src="/window/app.js"></script>
</body>
</html>`;

// ── Express routes ────────────────────────────────────────────────────────────

export function mountWindowRoutes(app: express.Application): void {
  app.use(express.json());

  app.get('/window', (_req, res) => {
    const leadUrl   = (env.FITBASE_LEAD_URL_TEMPLATE   || '').replace(/'/g, "\\'");
    const clientUrl = (env.FITBASE_CLIENT_URL_TEMPLATE || '').replace(/'/g, "\\'");
    const html = HTML_TEMPLATE
      .replace('__LEAD_URL__',   leadUrl)
      .replace('__CLIENT_URL__', clientUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  app.get('/window/app.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(WINDOW_APP_JS);
  });

  app.get('/window/manifest.json', (_req, res) => {
    res.json({
      name: 'SlimWay — помощник',
      short_name: 'SlimWay',
      start_url: '/window',
      display: 'standalone',
      theme_color: '#02BDB6',
      background_color: '#eef2f7',
      icons: [],
    });
  });

  app.get('/window/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send('self.addEventListener("fetch",e=>e.respondWith(fetch(e.request)));');
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
      const sinceId   = Number(req.query.since_id) || 0;
      const cutoff24h = new Date(Date.now() - 86400_000).toISOString();

      const { data: alerts, error: e1 } = await supabase
        .from('watch_alerts')
        .select('id, alert_key, rule, level, lead_id, client_id, registration_id, manager_name, short_name, title, body, action_hint, created_at, acked_at, meta')
        .is('resolved_at', null)
        .is('acked_at', null)
        .order('created_at', { ascending: false });
      if (e1) throw e1;

      // Merge NEW_LEAD + NEW_LEAD_NO_TASK by lead_id into one card
      const merged: Record<string, unknown>[] = [];
      const newLeadMap = new Map<number, Record<string, unknown>>();
      for (const a of (alerts ?? []) as Record<string, unknown>[]) {
        if (a.rule === 'NEW_LEAD' && a.lead_id) {
          newLeadMap.set(a.lead_id as number, { ...a });
        } else if (a.rule === 'NEW_LEAD_NO_TASK' && a.lead_id) {
          const existing = newLeadMap.get(a.lead_id as number);
          if (existing) {
            existing.has_no_task = true;
            existing.no_task_id  = a.id;
          } else {
            newLeadMap.set(a.lead_id as number, { ...a });
          }
        } else {
          merged.push(a);
        }
      }
      for (const card of newLeadMap.values()) {
        const ageMin = Math.floor((Date.now() - new Date(card.created_at as string).getTime()) / 60_000);
        if (ageMin >= 5 || card.has_no_task) {
          card.is_escalated    = true;
          card.minutes_waiting = ageMin;
        }
        if (card.lead_id) {
          card.lead_source = await fetchLeadSource(card.lead_id as number);
        }
        merged.push(card);
      }

      // Expose meta.phone as top-level field for action buttons
      for (const a of merged) {
        const m = a.meta as Record<string, unknown> | null;
        if (m?.phone) a.phone = m.phone;
      }

      const { data: closedRaw, error: e4 } = await supabase
        .from('watch_alerts')
        .select('id, rule, level, short_name, title, acked_at, resolved_at, meta, created_at')
        .or(`resolved_at.gt.${cutoff24h},acked_at.gt.${cutoff24h}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (e4) throw e4;
      const closed = (closedRaw ?? []).sort((a, b) => {
        const ta = new Date(a.acked_at || a.resolved_at || a.created_at).getTime();
        const tb = new Date(b.acked_at || b.resolved_at || b.created_at).getTime();
        return tb - ta;
      });

      const { data: newAlerts, error: e2 } = sinceId > 0
        ? await supabase
            .from('watch_alerts')
            .select('id, alert_key, rule, level, short_name, title, body')
            .gt('id', sinceId)
            .is('resolved_at', null)
            .is('acked_at', null)
        : { data: [], error: null };
      if (e2) throw e2;

      const { data: lastRun } = await supabase
        .from('job_runs')
        .select('finished_at')
        .eq('job', 'watch')
        .eq('status', 'ok')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: feedRaw, error: e3 } = await supabase
        .from('agent_events')
        .select('id, created_at, short_name, text, type')
        .gte('created_at', cutoff24h)
        .in('type', ['lead_moved', 'task_created', 'budget_updated'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (e3) throw e3;

      const feed = (feedRaw ?? []).map(f => ({
        id:         f.id,
        created_at: f.created_at,
        short_name: f.short_name,
        text:       stripPhones(String(f.text || '')),
        type:       f.type,
      }));

      const todayAlmaty = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      const respTimes = (closed as Record<string, unknown>[])
        .filter(a => a.rule === 'NEW_LEAD' && (a.meta as Record<string, unknown>)?.response_seconds)
        .map(a => Number((a.meta as Record<string, unknown>).response_seconds))
        .filter(n => n > 0 && n < 86400);
      const stats = {
        active_leads:  newLeadMap.size,
        no_shows:      merged.filter(a => String(a.rule).includes('NO_SHOW')).length,
        overdue_tasks: merged.filter(a => a.rule === 'AGENT_TASK' && a.level === 'urgent').length,
        closed_today:  (closed as Record<string, unknown>[]).filter(a => {
          const t = String(a.acked_at || a.resolved_at || '');
          return t && new Date(new Date(t).getTime() + 5 * 3600_000).toISOString().slice(0, 10) === todayAlmaty;
        }).length,
        avg_response_min: respTimes.length > 0
          ? Math.round(respTimes.reduce((a, b) => a + b, 0) / respTimes.length / 60)
          : null,
      };

      res.json({
        alerts:        merged,
        closed,
        new_alerts:    newAlerts ?? [],
        feed,
        stats,
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
      .update({ acked_at: new Date().toISOString(), meta: { resolve_reason: 'Принято вручную' } })
      .eq('id', id)
      .is('acked_at', null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  });

  app.post('/window/api/unack/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: 'bad id' }); return; }
    const { error } = await supabase
      .from('watch_alerts')
      .update({ acked_at: null, meta: null })
      .eq('id', id)
      .is('resolved_at', null)
      .not('acked_at', 'is', null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  });

  app.post('/window/api/ack-lead/:lead_id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const leadId  = Number(req.params.lead_id);
    if (!leadId) { res.status(400).json({ error: 'bad lead_id' }); return; }
    const body    = req.body as Record<string, unknown>;
    const respSec = Number(body?.response_seconds) || null;
    const meta: Record<string, unknown> = { resolve_reason: 'Взял в работу' };
    if (respSec) meta.response_seconds = respSec;
    const { error } = await supabase
      .from('watch_alerts')
      .update({ acked_at: new Date().toISOString(), meta })
      .in('rule', ['NEW_LEAD', 'NEW_LEAD_NO_TASK'])
      .eq('lead_id', leadId)
      .is('acked_at', null)
      .is('resolved_at', null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  });
}
