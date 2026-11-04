import fs   from 'fs';
import path  from 'path';
import express, { Application } from 'express';
import { supabase } from '../db/supabase';
import { makeToken, getSession, COOKIE_NAME, COOKIE_MAX_S, checkRate, recordFail, clearFails } from './auth';

const SHELL_APP_JS = fs.readFileSync(
  path.join(__dirname, '../../public/shell-app.js'),
  'utf8',
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Login page HTML ──────────────────────────────────────────────────────────

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SlimWay — Вход</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--brand:#02BDB6;--accent:#263CD9;--red:#ef4444}
html,body{height:100%;font-family:'Manrope',system-ui,sans-serif;background:#eef2f7}
body{display:flex;align-items:center;justify-content:center;padding:16px}
.blob{position:fixed;border-radius:50%;filter:blur(80px);opacity:.22;pointer-events:none;z-index:0}
.b1{width:600px;height:600px;background:var(--brand);top:-200px;right:-150px}
.b2{width:500px;height:500px;background:var(--accent);bottom:-150px;left:-100px}
.card{position:relative;z-index:1;width:min(320px,100%);padding:40px 36px;
  background:rgba(255,255,255,0.55);backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);
  border:1px solid rgba(255,255,255,0.65);border-radius:22px;
  box-shadow:0 4px 32px rgba(2,49,100,0.10);text-align:center}
.logo{width:48px;height:48px;margin:0 auto 14px;border-radius:14px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:18px}
h1{font-size:22px;font-weight:700;margin-bottom:5px;color:#1a202c}
.sub{font-size:13px;color:#64748b;margin-bottom:28px}
input[type=text],input[type=password]{width:100%;padding:12px 14px;margin-bottom:14px;
  border:1.5px solid rgba(255,255,255,0.65);border-radius:10px;
  background:rgba(255,255,255,0.82);font-size:16px;font-family:inherit;
  outline:none;color:#1a202c;transition:border-color .15s}
input:focus{border-color:var(--brand)}
.btn{width:100%;padding:12px;border:none;border-radius:10px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  color:#fff;font-size:15px;font-weight:600;font-family:inherit;
  cursor:pointer;transition:opacity .15s,transform .1s}
.btn:hover{opacity:.9}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.6;cursor:not-allowed}
.err{margin-top:12px;font-size:13px;color:var(--red);min-height:20px}
</style>
</head>
<body>
<div class="blob b1"></div>
<div class="blob b2"></div>
<div class="card">
  <div class="logo">SW</div>
  <h1>SlimWay</h1>
  <p class="sub">Помощник администратора</p>
  <input type="text" id="login" placeholder="Логин" autocomplete="username" autocapitalize="none" spellcheck="false">
  <input type="password" id="pw" placeholder="Пароль" autocomplete="current-password">
  <button class="btn" id="btn">Войти</button>
  <div class="err" id="err"></div>
</div>
<script>
var login=document.getElementById('login'),pw=document.getElementById('pw'),btn=document.getElementById('btn'),err=document.getElementById('err');
function doLogin(){
  err.textContent='';btn.disabled=true;
  fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:login.value.trim(),password:pw.value})})
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,status:r.status,d:d}});})
    .then(function(v){
      if(v.ok){
        var rt=new URLSearchParams(location.search).get('returnTo');
        location.href=(rt&&rt.startsWith('/')&&!rt.startsWith('//'))?rt:'/';
      }else{
        err.textContent=v.status===429?'Слишком много попыток, попробуйте через '+(v.d&&v.d.wait_min||'?')+' мин':'Неверный логин или пароль';
        btn.disabled=false;pw.value='';pw.focus();
      }
    })
    .catch(function(){err.textContent='Нет связи с сервером';btn.disabled=false;});
}
btn.addEventListener('click',doLogin);
pw.addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
login.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();pw.focus();}});
login.focus();
</script>
</body>
</html>`;

// ── Shell page HTML ──────────────────────────────────────────────────────────

const SHELL_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#02BDB6">
<title>SlimWay</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--brand:#02BDB6;--accent:#263CD9;--red:#ef4444;--glass:rgba(255,255,255,0.55);--border:rgba(255,255,255,0.65);--shadow:0 4px 24px rgba(2,49,100,0.08)}
html,body{height:100%;overflow:hidden;font-family:'Manrope',system-ui,sans-serif;background:#eef2f7;color:#1a202c}
.blob{position:fixed;border-radius:50%;filter:blur(80px);opacity:.18;pointer-events:none;z-index:0}
.b1{width:600px;height:600px;background:var(--brand);top:-200px;right:-150px}
.b2{width:500px;height:500px;background:var(--accent);bottom:-150px;left:-100px}

/* Work area */
#work-area{display:flex;flex-direction:column;height:100vh;height:100dvh;position:relative;z-index:1}
#top-bar{height:48px;flex-shrink:0;display:none;align-items:center;justify-content:space-between;
  padding:0 8px;background:var(--glass);backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--border);
  box-shadow:0 1px 8px rgba(2,49,100,0.06);gap:6px}
.tabs{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;
  scrollbar-width:none;-ms-overflow-style:none;padding-bottom:1px}
.tabs::-webkit-scrollbar{display:none}
.tab-btn{background:none;border:none;cursor:pointer;padding:7px 12px;border-radius:8px;
  font-size:13px;font-weight:600;font-family:inherit;color:#64748b;
  display:inline-flex;align-items:center;gap:5px;transition:background .15s,color .15s;
  flex-shrink:0;min-height:36px;white-space:nowrap}
.tab-btn:hover{background:rgba(2,189,182,0.1);color:#1a202c}
.tab-btn.active{background:rgba(2,189,182,0.13);color:var(--brand)}
.tbadge{min-width:18px;height:18px;border-radius:9px;background:var(--red);color:#fff;
  font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;
  padding:0 4px;font-family:inherit}
/* Desktop logout */
.logout-btn{background:rgba(255,255,255,0.6);border:1px solid var(--border);border-radius:8px;
  padding:5px 12px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;
  color:#64748b;transition:opacity .15s;flex-shrink:0;white-space:nowrap}
.logout-btn:hover{opacity:.75}
/* Mobile user avatar button */
.ua-wrap{position:relative;flex-shrink:0;display:none}
.ua-btn{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--accent));
  color:#fff;border:none;cursor:pointer;font-size:14px;font-weight:700;
  display:flex;align-items:center;justify-content:center;font-family:inherit}
.ua-menu{position:absolute;right:0;top:calc(100% + 6px);background:#fff;border:1px solid var(--border);
  border-radius:14px;box-shadow:0 6px 24px rgba(2,49,100,.14);padding:14px 16px;min-width:180px;z-index:300;
  display:none}
.ua-menu.open{display:block}
.ua-menu-name{font-size:13px;font-weight:600;color:#1a202c;padding-bottom:10px;
  border-bottom:1px solid #e2e6ea;margin-bottom:8px}
.ua-menu-exit{width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;
  padding:9px 12px;font-size:14px;cursor:pointer;color:#ef4444;font-weight:600;font-family:inherit}
@media(max-width:1023px){
  .logout-btn{display:none}
  .ua-wrap{display:block}
}

/* Panes */
#panes{flex:1;overflow:hidden;position:relative}
.pane{position:absolute;inset:0;display:flex;flex-direction:row}
.pane.hidden{display:none}
iframe.frame{flex:1;border:none;min-width:0;height:100%;display:block}

/* Side buttons */
.side-btn{width:40px;flex-shrink:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  background:rgba(255,255,255,0.32);backdrop-filter:blur(8px);
  border:none;border-left:1px solid var(--border);
  cursor:pointer;font-family:inherit;transition:background .15s;position:relative}
.side-btn.left{border-left:none;border-right:1px solid var(--border)}
.side-btn:hover{background:rgba(2,189,182,0.12)}
.side-text{writing-mode:vertical-rl;transform:rotate(180deg);
  font-size:11px;font-weight:600;color:#64748b;letter-spacing:.05em;white-space:nowrap}
.sbadge{position:absolute;top:8px;min-width:18px;height:18px;border-radius:9px;
  background:var(--red);color:#fff;font-size:11px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 4px}

/* Choice screen overlay */
#choice-screen{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;
  background:rgba(238,242,247,0.55);backdrop-filter:blur(6px)}
.choice-card{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--border);
  border-radius:24px;box-shadow:0 4px 32px rgba(2,49,100,0.10);
  padding:40px 36px 36px;text-align:center;position:relative;z-index:1}
.choice-logo{width:50px;height:50px;margin:0 auto 14px;border-radius:14px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:19px}
.choice-title{font-size:22px;font-weight:700;margin-bottom:5px}
.choice-sub{font-size:13px;color:#64748b;margin-bottom:28px}
.choice-btns{display:flex;gap:16px;justify-content:center}
.choice-btn{width:152px;height:100px;background:rgba(255,255,255,0.42);
  backdrop-filter:blur(8px);border:1.5px solid var(--border);border-radius:16px;
  cursor:pointer;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:7px;font-family:inherit;position:relative;
  transition:background .15s,border-color .15s,box-shadow .15s}
.choice-btn:hover{background:rgba(2,189,182,0.1);border-color:rgba(2,189,182,0.45);
  box-shadow:0 0 0 4px rgba(2,189,182,0.08)}
.choice-icon{font-size:28px;line-height:1}
.choice-label{font-size:14px;font-weight:600;color:#1a202c}
.cbadge{position:absolute;top:8px;right:8px;min-width:20px;height:20px;border-radius:10px;
  background:var(--red);color:#fff;font-size:12px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 5px}

/* Toast */
#shell-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);
  background:rgba(255,255,255,0.88);backdrop-filter:blur(12px);border:1px solid var(--border);
  border-radius:12px;padding:10px 20px;font-size:14px;font-weight:600;z-index:200;
  opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;
  box-shadow:var(--shadow);white-space:nowrap}
#shell-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* Side buttons hidden on mobile+tablet, visible on desktop */
@media(max-width:1023px){
  .side-btn{display:none!important}
}
/* Hamburger button */
#ham-btn{display:none;position:relative;width:40px;height:40px;border-radius:10px;
  background:none;border:none;cursor:pointer;font-size:22px;line-height:1;
  align-items:center;justify-content:center;flex-shrink:0;color:#374151}
#ham-btn:active{background:rgba(2,189,182,0.1)}
.ham-dot{position:absolute;top:5px;right:5px;width:9px;height:9px;border-radius:50%;
  background:var(--red);display:none}
/* Tab label centre (mobile) */
#tab-label{display:none;flex:1;text-align:center;font-size:14px;font-weight:600;
  color:#1a202c;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px}
/* Drawer backdrop */
#drawer-backdrop{position:fixed;inset:0;z-index:200;background:rgba(26,32,44,0.4);
  backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
  opacity:0;visibility:hidden;transition:opacity .25s,visibility .25s}
#drawer-backdrop.open{opacity:1;visibility:visible}
/* Drawer panel */
#drawer{position:fixed;top:0;left:0;bottom:0;z-index:201;width:min(80vw,320px);
  display:flex;flex-direction:column;
  background:rgba(255,255,255,0.92);backdrop-filter:blur(20px) saturate(140%);
  -webkit-backdrop-filter:blur(20px) saturate(140%);
  border-right:1px solid var(--border);box-shadow:4px 0 24px rgba(2,49,100,0.12);
  transform:translateX(-105%);transition:transform .25s ease;overscroll-behavior:contain}
#drawer.open{transform:translateX(0)}
.drawer-head{padding:20px 18px 14px;display:flex;flex-direction:column;gap:8px;
  border-bottom:1px solid rgba(2,189,182,0.15)}
.drawer-logo{width:36px;height:36px;border-radius:10px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-weight:700;font-size:14px}
.drawer-user{font-size:13px;font-weight:600;color:#1a202c}
.drawer-items{flex:1;overflow-y:auto;padding:6px 0}
.drawer-item{width:100%;background:none;border:none;cursor:pointer;font-family:inherit;
  display:flex;align-items:center;gap:12px;padding:11px 18px;
  font-size:14px;font-weight:600;color:#374151;text-align:left;
  transition:background .12s;position:relative}
.drawer-item:hover{background:rgba(2,189,182,0.08)}
.drawer-item.active{background:rgba(2,189,182,0.13);color:var(--brand)}
.drawer-ibadge{margin-left:auto;min-width:18px;height:18px;border-radius:9px;
  background:var(--red);color:#fff;font-size:11px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0}
.drawer-foot{padding:12px 18px;border-top:1px solid rgba(2,189,182,0.15)}
.drawer-exit-btn{width:100%;padding:10px;background:#fef2f2;border:1px solid #fecaca;
  border-radius:8px;font-size:14px;font-weight:600;color:#ef4444;
  cursor:pointer;font-family:inherit}

@media(max-width:1024px){
  #ham-btn{display:flex}
  .tabs{display:none!important}
  .logout-btn{display:none}
  .ua-wrap{display:block!important}
  #tab-label{display:block}
}

/* Choice screen: 2-column tiles + greeting on mobile */
.choice-greeting{display:none;font-size:17px;font-weight:700;margin-bottom:20px;color:#1a202c}
@media(max-width:640px){
  .choice-card{padding:28px 16px 24px;width:calc(100vw - 24px);max-height:92dvh;overflow-y:auto}
  .choice-title{display:none}
  .choice-sub{display:none}
  .choice-greeting{display:block}
  .choice-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .choice-btn{width:100%;height:88px;flex-direction:column;justify-content:center;
    gap:6px;padding:0 8px;border-radius:14px}
  .choice-icon{font-size:26px}
  .choice-label{font-size:13px}
}
@media(min-width:641px) and (max-width:1023px){
  .choice-btns{gap:12px}
  .choice-btn{width:140px;height:90px}
}
</style>
</head>
<body>
<div class="blob b1"></div>
<div class="blob b2"></div>

<div id="work-area">
  <div id="top-bar">
    <button id="ham-btn" aria-label="Меню">☰<span class="ham-dot" id="ham-dot"></span></button>
    <span id="tab-label"></span>
    <div class="tabs">
      <button class="tab-btn" id="tab-btn-manager">👔 Менеджер<span class="tbadge" id="badge-tab-manager">0</span></button>
      <button class="tab-btn active" id="tab-btn-agent">🐕 Агент<span class="tbadge" id="badge-tab-agent">0</span></button>
      <button class="tab-btn" id="tab-btn-schedule">📅 Расписание</button>
      <button class="tab-btn" id="tab-btn-clients">👥 Клиенты</button>
      <button class="tab-btn" id="tab-btn-funnel">📈 Воронка</button>
      <button class="tab-btn" id="tab-btn-cashier">💰 Касса</button>
      <button class="tab-btn" id="tab-btn-kviz">📝 <span id="kviz-tab-text">Квалификация</span><span class="tbadge" id="badge-tab-kviz">0</span></button>
      <button class="tab-btn" id="tab-btn-measure">📏 Замеры</button>
      <!--REPORTS_TAB_BTN-->
      <!--METRICS_TAB_BTN-->
      <!--SETTINGS_TAB_BTN-->
    </div>
    <button class="logout-btn" id="logout-btn"><!--DNAME--> · Выйти</button>
    <div class="ua-wrap" id="ua-wrap">
      <button class="ua-btn" id="ua-btn" aria-label="Меню пользователя">?</button>
      <div class="ua-menu" id="ua-menu">
        <div class="ua-menu-name"><!--DNAME--></div>
        <button class="ua-menu-exit" id="ua-menu-exit">Выйти</button>
      </div>
    </div>
  </div>
  <div id="panes">
    <div class="pane hidden" id="manager-pane">
      <button class="side-btn" id="side-to-agent">
        <span class="sbadge" id="badge-side-agent">0</span>
        <span class="side-text">Агент</span>
      </button>
    </div>
    <div class="pane" id="agent-pane">
      <button class="side-btn left" id="side-to-manager">
        <span class="sbadge" id="badge-side-manager">0</span>
        <span class="side-text">Менеджер</span>
      </button>
      <iframe class="frame" id="agent-iframe" src="/window" allow="notifications; clipboard-write"></iframe>
      <button class="side-btn" id="side-to-schedule">
        <span class="side-text">Расписание</span>
      </button>
    </div>
    <div class="pane hidden" id="schedule-pane">
      <button class="side-btn left" id="side-sched-to-agent">
        <span class="sbadge" id="badge-side-agent2">0</span>
        <span class="side-text">Агент</span>
      </button>
      <button class="side-btn" id="side-sched-to-clients">
        <span class="side-text">Клиенты</span>
      </button>
    </div>
    <div class="pane hidden" id="clients-pane">
      <button class="side-btn left" id="side-cl-to-schedule">
        <span class="side-text">Расписание</span>
      </button>
      <button class="side-btn" id="side-cl-to-funnel">
        <span class="side-text">Воронка</span>
      </button>
    </div>
    <div class="pane hidden" id="funnel-pane">
      <button class="side-btn left" id="side-fn-to-clients">
        <span class="side-text">Клиенты</span>
      </button>
      <button class="side-btn" id="side-fn-to-cashier">
        <span class="side-text">Касса</span>
      </button>
    </div>
    <div class="pane hidden" id="cashier-pane">
      <button class="side-btn left" id="side-cash-to-funnel">
        <span class="side-text">Воронка</span>
      </button>
      <button class="side-btn" id="side-cash-to-kviz">
        <span class="sbadge" id="badge-side-kviz">0</span>
        <span class="side-text">Квалификация</span>
      </button>
    </div>
    <div class="pane hidden" id="kviz-pane">
      <button class="side-btn left" id="side-kviz-to-cashier">
        <span class="side-text">Касса</span>
      </button>
      <button class="side-btn" id="side-to-measure">
        <span class="side-text">Замеры</span>
      </button>
    </div>
    <div class="pane hidden" id="measure-pane">
      <button class="side-btn left" id="side-to-kviz2">
        <span class="side-text">Квалификация</span>
      </button>
      <!--REPORTS_SIDE_FROM_MEASURE-->
    </div>
    <!--REPORTS_PANE-->
    <!--METRICS_PANE-->
    <!--SETTINGS_PANE-->
  </div>
</div>

<div id="drawer-backdrop"></div>
<div id="drawer">
  <div class="drawer-head">
    <div class="drawer-logo">SW</div>
    <div class="drawer-user" id="drawer-user-name"></div>
  </div>
  <div class="drawer-items" id="drawer-items"></div>
  <div class="drawer-foot">
    <button class="drawer-exit-btn" id="drawer-exit">Выйти</button>
  </div>
</div>

<div id="choice-screen">
  <div class="choice-card">
    <div class="choice-logo">SW</div>
    <h1 class="choice-title">SlimWay</h1>
    <p class="choice-sub">Выберите раздел</p>
    <p class="choice-greeting" id="choice-greeting">Выберите раздел</p>
    <div class="choice-btns">
      <button class="choice-btn" id="choice-manager">
        <span class="cbadge" id="badge-choice-manager">0</span>
        <span class="choice-icon">👔</span>
        <span class="choice-label">Менеджер</span>
      </button>
      <button class="choice-btn" id="choice-agent">
        <span class="cbadge" id="badge-choice-agent">0</span>
        <span class="choice-icon">🐕</span>
        <span class="choice-label">Агент</span>
      </button>
      <button class="choice-btn" id="choice-schedule">
        <span class="choice-icon">📅</span>
        <span class="choice-label">Расписание</span>
      </button>
      <button class="choice-btn" id="choice-clients">
        <span class="choice-icon">👥</span>
        <span class="choice-label">Клиенты</span>
      </button>
      <button class="choice-btn" id="choice-funnel">
        <span class="choice-icon">📈</span>
        <span class="choice-label">Воронка</span>
      </button>
      <button class="choice-btn" id="choice-cashier">
        <span class="choice-icon">💰</span>
        <span class="choice-label">Касса</span>
      </button>
      <button class="choice-btn" id="choice-kviz">
        <span class="cbadge" id="badge-choice-kviz">0</span>
        <span class="choice-icon">📝</span>
        <span class="choice-label">Квалификация</span>
      </button>
      <button class="choice-btn" id="choice-measure">
        <span class="choice-icon">📏</span>
        <span class="choice-label">Замеры</span>
      </button>
      <!--REPORTS_CHOICE_BTN-->
      <!--METRICS_CHOICE_BTN-->
      <!--SETTINGS_CHOICE_BTN-->
    </div>
  </div>
</div>

<div id="shell-toast"></div>
<script src="/shell-app.js"></script>
</body>
</html>`;

// ── Routes ───────────────────────────────────────────────────────────────────

export function mountShellRoutes(app: Application): void {

  app.get('/shell-app.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(SHELL_APP_JS);
  });

  // Login page: redirect to / if already authed
  app.get('/login', (req, res) => {
    if (getSession(req)) { res.redirect(302, '/'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(LOGIN_HTML);
  });

  // Shell page: redirect to /login if not authed; inject display_name + admin-only Reports tab
  app.get('/', (req, res) => {
    const session = getSession(req);
    if (!session) { res.redirect(302, '/login'); return; }
    const isAdmin = session.role === 'admin';
    const reportsSettingsBtn = isAdmin ? '<button class="side-btn" id="side-to-settings"><span class="side-text">Настройки</span></button>' : '';
    const reportsPane = `<div class="pane hidden" id="reports-pane"><button class="side-btn left" id="side-to-measure2"><span class="side-text">Замеры</span></button>${reportsSettingsBtn}</div>`;
    const settingsBtn  = isAdmin ? '<button class="tab-btn" id="tab-btn-settings">⚙️ Настройки</button>' : '';
    const settingsPane = isAdmin ? '<div class="pane hidden" id="settings-pane"><button class="side-btn left" id="side-set-to-reports"><span class="side-text">Отчёты</span></button></div>' : '';
    const settingsCh   = isAdmin ? '<button class="choice-btn" id="choice-settings"><span class="choice-icon">⚙️</span><span class="choice-label">Настройки</span></button>' : '';
    const html = SHELL_HTML
      .replace('<!--DNAME-->', escapeHtml(session.display_name))
      .replace('<!--REPORTS_TAB_BTN-->', '<button class="tab-btn" id="tab-btn-reports">📊 Отчёты</button>')
      .replace('<!--REPORTS_SIDE_FROM_MEASURE-->', '<button class="side-btn" id="side-to-reports"><span class="side-text">Отчёты</span></button>')
      .replace('<!--REPORTS_PANE-->', reportsPane)
      .replace('<!--REPORTS_CHOICE_BTN-->', '<button class="choice-btn" id="choice-reports"><span class="choice-icon">📊</span><span class="choice-label">Отчёты</span></button>')
      .replace('<!--METRICS_TAB_BTN-->', '')
      .replace('<!--METRICS_PANE-->', '')
      .replace('<!--METRICS_CHOICE_BTN-->', '')
      .replace('<!--SETTINGS_TAB_BTN-->', settingsBtn)
      .replace('<!--SETTINGS_PANE-->', settingsPane)
      .replace('<!--SETTINGS_CHOICE_BTN-->', settingsCh);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // GET /api/me
  app.get('/api/me', (req, res) => {
    const session = getSession(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json({ login: session.login, display_name: session.display_name, role: session.role });
  });

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    const ip    = String(req.ip || req.socket.remoteAddress || '');
    const login = String((req.body as Record<string, unknown>)?.login || '').trim().toLowerCase();
    const pw    = String((req.body as Record<string, unknown>)?.password || '');

    if (!login) { res.status(400).json({ error: 'Login required' }); return; }

    const rateKey = `${login}:${ip}`;
    const rate = checkRate(rateKey);
    if (!rate.ok) { res.status(429).json({ error: 'Too many attempts', wait_min: rate.waitMin }); return; }

    try {
      const { data, error } = await supabase.rpc('app_check_login', { p_login: login, p_password: pw });
      const user = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (error || !user?.id) {
        recordFail(rateKey);
        res.status(401).json({ error: 'Invalid credentials' }); return;
      }
      clearFails(rateKey);
      const token = makeToken({
        id:           String(user.id),
        login:        String(user.login),
        display_name: String(user.display_name),
        role:         String(user.role),
      });
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_S}; Path=/`,
      );
      res.json({ ok: true, display_name: String(user.display_name) });
    } catch (e) {
      recordFail(rateKey);
      res.status(500).json({ error: String(e) });
    }
  });

  // POST /api/logout
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', [
      `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`,
      `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/window`,
    ]);
    res.json({ ok: true });
  });
}
