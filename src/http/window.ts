import crypto from 'crypto';
import express from 'express';
import { supabase } from '../db/supabase';
import { env } from '../config';
import { rawGet } from './fitbase';

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

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
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

/* Blobs */
.blob{position:fixed;border-radius:50%;filter:blur(80px);opacity:.25;pointer-events:none;z-index:0}
.blob-1{width:600px;height:600px;background:var(--brand);top:-200px;right:-150px}
.blob-2{width:500px;height:500px;background:var(--accent);bottom:-150px;left:-100px}
[data-theme="dark"] .blob{opacity:.15}

/* Glass panel */
.glass{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--c-border);border-radius:var(--radius-panel);box-shadow:var(--shadow);position:relative;z-index:1}

/* Login */
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

/* Header */
#app{display:none;position:relative;z-index:1}
#app.visible{display:block}
.page{max-width:900px;margin:0 auto;padding:14px 14px 0}
.hdr{display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap}
.hdr-title{font-size:18px;font-weight:700;flex:1}
.hdr-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--brand),var(--accent));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}
.hdr-actions{display:flex;gap:6px;align-items:center}
.status-bar{font-size:12px;color:var(--c-muted);margin-bottom:10px}
.stale-banner{background:#fef9c3;border:1px solid #fde047;color:#713f12;padding:8px 14px;border-radius:10px;margin-bottom:10px;font-size:13px}
#err-banner{display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:8px 14px;border-radius:10px;margin-bottom:10px;font-size:13px}
#err-banner.show{display:block}

/* Column layout */
.columns{display:flex;flex-direction:column;gap:10px;padding-bottom:14px}
.col-alerts{order:1}.col-closed{order:2}.col-feed{order:3}
.col-hdr{padding:12px 16px 10px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:8px}
.col-hdr h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-muted);flex:1}
.col-body{padding:10px 12px 12px}

/* Alert card base */
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
.icon-ok{background:rgba(16,185,129,.1);color:var(--green)}
.card-main{flex:1;min-width:0}
.card-name{font-size:14px;font-weight:600;line-height:1.3}
.card-title{font-size:12px;color:var(--c-muted);margin-top:1px}
.card-body{font-size:12px;color:var(--c-muted);margin-top:5px;line-height:1.5}
.card-actions{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.card-age{font-size:11px;color:var(--c-muted)}

/* NEW_LEAD special card */
.card-new-lead{
  background:linear-gradient(var(--card),var(--card)) padding-box,
             linear-gradient(135deg,var(--brand),var(--accent)) border-box;
  border:2px solid transparent;
}
.card-new-lead .card-name{font-size:18px;font-weight:700}
.card-new-lead .card-icon{background:linear-gradient(135deg,var(--brand),var(--accent));color:#fff}
@keyframes pulse-glow{
  0%,100%{box-shadow:0 0 0 0 rgba(2,189,182,.4)}
  50%{box-shadow:0 0 0 8px rgba(2,189,182,0)}
}
.card-new-lead.fresh{animation:pulse-glow 2s ease-in-out infinite}
.escalation-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.1);color:var(--red);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;margin-top:6px}
.card-new-lead.escalated{border-color:var(--red) !important;background:linear-gradient(rgba(255,255,255,0.92),rgba(255,255,255,0.92)) padding-box, linear-gradient(135deg,var(--red),#f97316) border-box}
[data-theme="dark"] .card-new-lead.escalated{background:linear-gradient(rgba(20,28,44,.92),rgba(20,28,44,.92)) padding-box, linear-gradient(135deg,var(--red),#f97316) border-box}
.source-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(2,189,182,.1);color:var(--brand)}

/* Closed cards */
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

/* Feed timeline */
.feed-wrap{position:relative;padding-left:20px}
.feed-wrap::before{content:'';position:absolute;left:5px;top:6px;bottom:6px;width:2px;background:var(--c-border);border-radius:1px}
.feed-item{position:relative;padding:4px 0 6px 12px;font-size:12px;line-height:1.4;border-bottom:none}
.feed-item::before{content:'';position:absolute;left:-3px;top:8px;width:10px;height:10px;border-radius:50%;background:var(--dot-c,var(--c-muted));border:2px solid var(--c-bg)}
.feed-time{font-size:11px;color:var(--c-muted);margin-right:6px}
.feed-name{font-weight:600}

/* Help modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-box{width:90%;max-width:480px;max-height:90vh;overflow-y:auto;padding:28px}
.modal-box h3{font-size:18px;font-weight:700;margin-bottom:16px}
.modal-rule{display:flex;gap:10px;margin-bottom:10px;font-size:13px;line-height:1.5}
.dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex-shrink:0;background:var(--c-muted)}
.modal-note{font-size:12px;color:var(--c-muted);margin-bottom:8px}
.modal-close{margin-top:16px;width:100%}

/* Dark mode icon button */
.btn-icon{background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;color:var(--c-muted);font-size:18px;line-height:1;transition:background .15s}
.btn-icon:hover{background:var(--c-border)}

/* Misc */
.empty{color:var(--c-muted);font-size:13px;text-align:center;padding:20px}
#login-err{color:var(--red);font-size:12px;margin-top:8px;min-height:18px}

/* ── Desktop 3-column ─────────────────────────────────────────────────────── */
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

<!-- Help modal -->
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

<script>
(function(){
  const $ = id => document.getElementById(id);
  let since_id = 0;
  const notifiedIds = new Set();
  let soundOn = localStorage.getItem('sw_sound') !== 'false';
  let notifGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  let audioCtx = null;

  // ── Dark mode ─────────────────────────────────────────────────────────────
  let darkMode = localStorage.getItem('sw_theme') === 'dark';
  function applyTheme(){
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    $('theme-btn').textContent = darkMode ? '☀️' : '🌙';
  }
  applyTheme();
  $('theme-btn').onclick = function(){
    darkMode = !darkMode;
    localStorage.setItem('sw_theme', darkMode ? 'dark' : 'light');
    applyTheme();
  };

  // ── Sound ─────────────────────────────────────────────────────────────────
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
    } catch(e){}
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

  // ── Help modal ────────────────────────────────────────────────────────────
  $('help-btn').onclick   = () => { $('help-modal').style.display = 'flex'; };
  $('help-close').onclick = () => { $('help-modal').style.display = 'none'; };
  $('help-modal').onclick = e => { if (e.target === $('help-modal')) $('help-modal').style.display = 'none'; };

  // ── App visibility ────────────────────────────────────────────────────────
  function showApp(){
    $('app').classList.add('visible');
    if (window.innerWidth >= 1100){
      $('closed-list').style.display = 'block';
      $('closed-chevron').classList.add('open');
    }
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login(){
    const pw = $('pw-input').value;
    const res = await fetch('/window/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pw})
    });
    if (res.ok){
      $('login-screen').style.display = 'none';
      showApp();
      fetchState();
    } else {
      $('login-err').textContent = 'Неверный пароль';
    }
  }
  $('pw-btn').onclick = login;
  $('pw-input').addEventListener('keydown', e => { if(e.key==='Enter') login(); });

  // ── Helpers ───────────────────────────────────────────────────────────────
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
    const d = new Date(new Date(iso).getTime() + 5*3600000);
    return d.toISOString().slice(11,16);
  }
  function fmtHHMM(iso){
    const d = new Date(new Date(iso).getTime() + 5*3600000);
    return d.toISOString().slice(11,16);
  }
  function isWorkHourAlmaty(iso){
    const h = new Date(new Date(iso).getTime() + 5*3600000).getUTCHours();
    return h >= 8 && h < 23;
  }
  function minutesAgo(iso){
    return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
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
    tiktok:    '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.53V6.77a4.85 4.85 0 01-1.01-.08z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
    whatsapp:  '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M17.47 14.38c-.26-.13-1.52-.75-1.75-.83-.24-.09-.41-.13-.58.13s-.67.83-.82.99c-.15.17-.3.19-.56.06-.26-.13-1.1-.41-2.1-1.3-.77-.69-1.3-1.54-1.45-1.8-.15-.26-.01-.4.11-.53.12-.11.26-.29.38-.44.13-.14.17-.26.26-.43.09-.17.04-.32-.02-.44s-.58-1.4-.8-1.91c-.21-.5-.42-.43-.58-.44h-.5c-.17 0-.44.06-.67.32s-.88.86-.88 2.1.9 2.44 1.03 2.61c.13.17 1.78 2.72 4.31 3.81.6.26 1.07.42 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.48-.61 1.69-1.19.21-.58.21-1.08.15-1.19-.06-.1-.22-.16-.47-.28z"/><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16z"/></svg>',
    globe:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c-3 4-3 16 0 20M12 2c3 4 3 16 0 20"/></svg>',
  };

  function ruleIcon(rule){
    if (rule === 'NEW_LEAD' || rule === 'NEW_LEAD_NO_TASK') return SVG.lightning;
    if (rule && rule.includes('NO_SHOW')) return SVG.calX;
    if (rule === 'UNCONFIRMED_3H') return SVG.question;
    if (rule === 'NO_TASK' || rule === 'TASK_OVERDUE' || rule === 'TASK_TOO_FAR') return SVG.clock;
    if (rule && (rule.includes('CONTRACT') || rule === 'CARD_FREE' || rule === 'PURCHASE')) return SVG.ticket;
    return SVG.warning;
  }
  function srcIcon(src){
    if (src === 'tiktok') return SVG.tiktok;
    if (src === 'instagram') return SVG.instagram;
    if (src === 'whatsapp') return SVG.whatsapp;
    return SVG.globe;
  }
  function srcLabel(src){
    if (src === 'tiktok') return 'TikTok';
    if (src === 'instagram') return 'Instagram';
    if (src === 'whatsapp') return 'WhatsApp';
    if (src === 'site') return 'Сайт';
    return 'Источник';
  }
  function iconClass(level){
    if (level === 'urgent') return 'icon-urgent';
    if (level === 'important') return 'icon-important';
    return 'icon-info';
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  function updateStatus(data, ok){
    if (!ok){ $('status-bar').textContent = 'Последняя проверка: — · Связь: нет'; return; }
    const t = data.last_watch_at ? fmtHHMM(data.last_watch_at) : '—';
    $('status-bar').textContent = 'Последняя проверка: ' + t + ' · Связь: есть';
    if (data.last_watch_at && data.server_time){
      const stale = (new Date(data.server_time) - new Date(data.last_watch_at)) > 10*60000 && isWorkHourAlmaty(data.server_time);
      $('stale-banner').style.display = stale ? 'block' : 'none';
    }
  }

  // ── Render alerts ─────────────────────────────────────────────────────────
  const LEVEL_ORDER = {urgent:0,important:1,info:2};
  function renderAlerts(alerts){
    const list = $('alerts-list');
    const sorted = [...alerts].sort((a,b)=>{
      const lo = (LEVEL_ORDER[a.level]??2) - (LEVEL_ORDER[b.level]??2);
      if (lo!==0) return lo;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    $('alert-count').textContent = sorted.length ? '('+sorted.length+')' : '';
    document.title = (sorted.length ? '('+sorted.length+') ' : '') + 'SlimWay — помощник';
    if (!sorted.length){ list.innerHTML = '<div class="empty">Всё под контролем — тревог нет</div>'; return; }
    list.innerHTML = sorted.map(a => {
      const isNewLead = a.rule === 'NEW_LEAD' || a.rule === 'NEW_LEAD_NO_TASK';
      const ageMin    = minutesAgo(a.created_at);
      const fresh     = ageMin < 2;
      const escalated = a.is_escalated;

      if (isNewLead){
        const cls = ['card','card-new-lead', fresh?'fresh':'', escalated?'escalated':''].filter(Boolean).join(' ');
        const srcHtml = a.lead_source && a.lead_source !== 'other'
          ? \`<span class="source-chip">\${srcIcon(a.lead_source)}\${srcLabel(a.lead_source)}</span>\`
          : '';
        const escBadge = escalated
          ? \`<div class="escalation-badge">\${SVG.warning} Без ответа \${a.minutes_waiting||ageMin} мин</div>\`
          : '';
        const hasNoTask = a.has_no_task
          ? \`<div class="card-body" style="color:var(--red);font-weight:600">⚠ Заявка без ответа — не создана задача</div>\`
          : '';
        return \`<div class="\${cls}" data-id="\${a.id}">
          <div class="card-top">
            <div class="card-icon \${iconClass(a.level)}">\${ruleIcon(a.rule)}</div>
            <div class="card-main">
              <div class="card-name">\${esc(a.short_name||a.title)}</div>
              <div class="card-title">\${esc(a.title)}</div>
              \${srcHtml}
              \${escBadge}
              \${hasNoTask}
              \${a.body ? '<div class="card-body">'+esc(a.body)+'</div>' : ''}
            </div>
          </div>
          <div class="card-actions">
            <span class="card-age">\${timeAgo(a.created_at)}</span>
            <button class="btn btn-take" onclick="ackLead(\${a.lead_id})">Взял в работу</button>
          </div>
        </div>\`;
      }

      return \`<div class="card \${a.level}" data-id="\${a.id}">
        <div class="card-top">
          <div class="card-icon \${iconClass(a.level)}">\${ruleIcon(a.rule)}</div>
          <div class="card-main">
            <div class="card-name">\${esc(a.short_name||a.title)}</div>
            \${a.short_name ? '<div class="card-title">'+esc(a.title)+'</div>' : ''}
            \${a.body ? '<div class="card-body">'+esc(a.body)+'</div>' : ''}
          </div>
        </div>
        <div class="card-actions">
          <span class="card-age">\${timeAgo(a.created_at)}</span>
          <button class="btn btn-sm btn-ack" onclick="ack(\${a.id})">Принято</button>
        </div>
      </div>\`;
    }).join('');
  }

  // ── Render closed ─────────────────────────────────────────────────────────
  function reasonChip(reason, acked){
    if (!reason && acked) reason = 'Принято вручную';
    if (!reason) reason = 'Закрыто';
    const cls = reason.includes('Визит') ? 'chip-green'
              : reason.includes('Задача') ? 'chip-accent'
              : 'chip-gray';
    return \`<span class="chip \${cls}">\${esc(reason)}</span>\`;
  }
  function renderClosed(closed){
    const el = $('closed-list');
    $('closed-count').textContent = closed && closed.length ? '('+closed.length+')' : '';
    if (!closed||!closed.length){ el.innerHTML='<div class="empty">Нет завершённых за 24 ч</div>'; return; }
    el.innerHTML = closed.map(a => {
      const closeTime = a.acked_at || a.resolved_at;
      const reason    = (a.meta&&a.meta.resolve_reason) ? a.meta.resolve_reason : a.acked_at ? 'Принято вручную' : 'Закрыто автоматически';
      const canUnack  = a.acked_at && !a.resolved_at;
      return \`<div class="closed-card">
        <div class="closed-top">
          <div class="closed-title">\${esc(a.short_name ? a.title+' — '+a.short_name : a.title)}</div>
          <span class="closed-time">\${closeTime?fmtHHMM(closeTime):''}</span>
          \${canUnack?'<button class="btn btn-sm" onclick="unack('+a.id+')">Вернуть</button>':''}
        </div>
        <div class="closed-chips">\${reasonChip(reason, !!a.acked_at)}</div>
      </div>\`;
    }).join('');
  }

  // ── Render feed ───────────────────────────────────────────────────────────
  const FEED_DOT = { lead_moved:'var(--brand)', task_created:'var(--accent)', budget_updated:'var(--c-muted)' };
  function renderFeed(feed){
    const el = $('feed-list');
    if (!feed.length){ el.innerHTML='<div class="empty">Действий нет</div>'; return; }
    const items = feed.map(f => {
      const c = FEED_DOT[f.type] || 'var(--c-muted)';
      return \`<div class="feed-item" style="--dot-c:\${c}">
        <span class="feed-time">\${feedTime(f.created_at)}</span>
        \${f.short_name?'<span class="feed-name">'+esc(f.short_name)+'</span> ':''}\${f.text?'— '+esc(f.text):''}
      </div>\`;
    }).join('');
    el.innerHTML = '<div class="feed-wrap">'+items+'</div>';
  }

  // ── Toggle closed ─────────────────────────────────────────────────────────
  window.toggleClosed = function(){
    if (window.innerWidth >= 1100) return;
    const list = $('closed-list');
    const chev = $('closed-chevron');
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'block';
    chev.classList.toggle('open', !open);
  };

  // ── Ack / Unack ───────────────────────────────────────────────────────────
  window.ack = async function(id){
    await fetch('/window/api/ack/'+id, {method:'POST'});
    fetchState();
  };
  window.unack = async function(id){
    await fetch('/window/api/unack/'+id, {method:'POST'});
    fetchState();
  };
  window.ackLead = async function(leadId){
    await fetch('/window/api/ack-lead/'+leadId, {method:'POST'});
    fetchState();
  };

  // ── Poll ──────────────────────────────────────────────────────────────────
  function showError(msg){ const b=$('err-banner'); b.textContent=msg; b.classList.add('show'); }
  function hideError(){ $('err-banner').classList.remove('show'); }

  async function fetchState(){
    try {
      const res = await fetch('/window/api/state?since_id='+since_id);
      if (res.status===401){ $('app').classList.remove('visible'); $('login-screen').style.display='flex'; return; }
      if (!res.ok){ showError('Ошибка сервера ('+res.status+')'); updateStatus(null,false); return; }
      hideError();
      const data = await res.json();
      updateStatus(data, true);
      renderAlerts(data.alerts||[]);
      renderClosed(data.closed||[]);
      renderFeed(data.feed||[]);
      for (const a of (data.new_alerts||[])){
        since_id = Math.max(since_id, a.id);
        if (notifiedIds.has(a.id)) continue;
        notifiedIds.add(a.id);
        if (['urgent','important'].includes(a.level)){
          if (notifGranted) new Notification(a.title, {body: String(a.body||'').substring(0,120)});
          if (a.level==='urgent') playBeep();
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
      showApp();
      r.json().then(data => {
        updateStatus(data, true);
        renderAlerts(data.alerts||[]);
        renderClosed(data.closed||[]);
        renderFeed(data.feed||[]);
        if (data.alerts) since_id = Math.max(...data.alerts.map(a=>a.id||0), 0);
      });
    }
  }).catch(()=>{});

  setInterval(fetchState, 10000);
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
      const sinceId   = Number(req.query.since_id) || 0;
      const cutoff24h = new Date(Date.now() - 86400_000).toISOString();

      const { data: alerts, error: e1 } = await supabase
        .from('watch_alerts')
        .select('id, alert_key, rule, level, lead_id, client_id, registration_id, manager_name, short_name, title, body, action_hint, created_at, acked_at')
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
        // Escalation: any lead older than 5 min shows waiting badge
        const ageMin = Math.floor((Date.now() - new Date(card.created_at as string).getTime()) / 60_000);
        if (ageMin >= 5 || card.has_no_task) {
          card.is_escalated    = true;
          card.minutes_waiting = ageMin;
        }
        // Enrich with lead source
        if (card.lead_id) {
          card.lead_source = await fetchLeadSource(card.lead_id as number);
        }
        merged.push(card);
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

      res.json({
        alerts:        merged,
        closed,
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

  // Ack both NEW_LEAD + NEW_LEAD_NO_TASK for a given lead_id
  app.post('/window/api/ack-lead/:lead_id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const leadId = Number(req.params.lead_id);
    if (!leadId) { res.status(400).json({ error: 'bad lead_id' }); return; }
    const { error } = await supabase
      .from('watch_alerts')
      .update({ acked_at: new Date().toISOString(), meta: { resolve_reason: 'Взял в работу' } })
      .in('rule', ['NEW_LEAD', 'NEW_LEAD_NO_TASK'])
      .eq('lead_id', leadId)
      .is('acked_at', null)
      .is('resolved_at', null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  });
}
