import fs   from 'fs';
import path  from 'path';
import express, { Application } from 'express';
import { supabase } from '../db/supabase';
import { makeToken, getSession, getSessionWithPerms, COOKIE_NAME, COOKIE_MAX_S, checkLoginRate, writeLoginLog } from './auth';
import { PERM_CATALOG } from '../core/permissions';

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
<script>!function(){var t=localStorage.getItem('sw-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')}()</script>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>SlimWay — Вход</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/ui/tokens.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:'Manrope',system-ui,sans-serif;background:var(--bg)}
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
  color:var(--on-primary);font-weight:700;font-size:18px}
h1{font-size:22px;font-weight:700;margin-bottom:5px;color:var(--text)}
.sub{font-size:13px;color:var(--text-2);margin-bottom:28px}
input[type=text],input[type=password]{width:100%;padding:12px 14px;margin-bottom:14px;
  border:1.5px solid rgba(255,255,255,0.65);border-radius:10px;
  background:rgba(255,255,255,0.82);font-size:16px;font-family:inherit;
  outline:none;color:var(--text);transition:border-color .15s}
input:focus{border-color:var(--brand)}
.btn{width:100%;padding:12px;border:none;border-radius:10px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  color:var(--on-primary);font-size:15px;font-weight:600;font-family:inherit;
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

// ── SVG tab icons (Lucide 24×24, stroke 1.75) ───────────────────────────────

const _S = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`;
const ICONS: Record<string, string> = {
  manager:  `<svg ${_S}><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>`,
  agent:    `<svg ${_S}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  schedule: `<svg ${_S}><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
  clients:  `<svg ${_S}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  funnel:   `<svg ${_S}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  cashier:  `<svg ${_S}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
  kviz:     `<svg ${_S}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
  measure:  `<svg ${_S}><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>`,
  reports:  `<svg ${_S}><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`,
  settings: `<svg ${_S}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

// ── Shell page HTML ──────────────────────────────────────────────────────────

const SHELL_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<script>!function(){var t=localStorage.getItem('sw-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')}()</script>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" id="tc-light" media="(prefers-color-scheme: light)" content="#f2f4f7">
<meta name="theme-color" id="tc-dark" media="(prefers-color-scheme: dark)" content="#0b0f14">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<title>SlimWay</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/ui/tokens.css">
<script src="/ui/ui.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:'Manrope',system-ui,sans-serif;background:var(--bg);color:var(--text)}
.blob{position:fixed;border-radius:50%;filter:blur(80px);opacity:.18;pointer-events:none;z-index:0}
.b1{width:600px;height:600px;background:var(--brand);top:-200px;right:-150px}
.b2{width:500px;height:500px;background:var(--accent);bottom:-150px;left:-100px}

/* Work area */
#work-area{display:flex;flex-direction:column;height:100vh;height:100dvh;position:relative;z-index:1}
#top-bar{height:48px;flex-shrink:0;display:none;align-items:center;justify-content:space-between;
  padding:0 8px;background:var(--glass);backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--glass-border);
  box-shadow:0 1px 8px rgba(2,49,100,0.06);gap:6px}
.tabs{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;
  scrollbar-width:none;-ms-overflow-style:none;padding-bottom:1px}
.tabs::-webkit-scrollbar{display:none}
.tab-btn{background:none;border:none;cursor:pointer;padding:7px 12px;border-radius:8px;
  font-size:13px;font-weight:600;font-family:inherit;color:var(--text-2);
  display:inline-flex;align-items:center;gap:5px;transition:background .15s,color .15s;
  flex-shrink:0;min-height:36px;white-space:nowrap}
.tab-btn:hover{background:rgba(2,189,182,0.1);color:var(--text)}
.tab-btn.active{background:rgba(2,189,182,0.13);color:var(--brand)}
.tab-btn svg{width:16px;height:16px;flex-shrink:0}
.tbadge{min-width:18px;height:18px;border-radius:9px;background:var(--red);color:#fff;
  font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;
  padding:0 4px;font-family:inherit}
/* Desktop logout */
.logout-btn{background:rgba(255,255,255,0.6);border:1px solid var(--glass-border);border-radius:8px;
  padding:5px 12px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;
  color:var(--text-2);transition:opacity .15s;flex-shrink:0;white-space:nowrap}
.logout-btn:hover{opacity:.75}
/* Mobile user avatar button */
.ua-wrap{position:relative;flex-shrink:0;display:none}
.ua-btn{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--accent));
  color:var(--on-primary);border:none;cursor:pointer;font-size:14px;font-weight:700;
  display:flex;align-items:center;justify-content:center;font-family:inherit}
.ua-menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--surface);border:1px solid var(--border);
  border-radius:14px;box-shadow:0 6px 24px rgba(2,49,100,.14);padding:14px 16px;min-width:180px;z-index:300;
  display:none}
.ua-menu.open{display:block}
.ua-menu-name{font-size:13px;font-weight:600;color:var(--text);padding-bottom:10px;
  border-bottom:1px solid var(--border);margin-bottom:8px}
.ua-menu-exit{width:100%;background:var(--danger-soft);border:1px solid #fecaca;border-radius:8px;
  padding:9px 12px;font-size:14px;cursor:pointer;color:var(--danger);font-weight:600;font-family:inherit}
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
  border:none;border-left:1px solid var(--glass-border);
  cursor:pointer;font-family:inherit;transition:background .15s;position:relative}
.side-btn.left{border-left:none;border-right:1px solid var(--glass-border)}
.side-btn:hover{background:rgba(2,189,182,0.12)}
.side-text{writing-mode:vertical-rl;transform:rotate(180deg);
  font-size:11px;font-weight:600;color:var(--text-2);letter-spacing:.05em;white-space:nowrap}
.sbadge{position:absolute;top:8px;min-width:18px;height:18px;border-radius:9px;
  background:var(--red);color:#fff;font-size:11px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 4px}

/* Choice screen overlay */
#choice-screen{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;
  background:rgba(238,242,247,0.55);backdrop-filter:blur(6px)}
.choice-card{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);
  -webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--glass-border);
  border-radius:24px;box-shadow:0 4px 32px rgba(2,49,100,0.10);
  padding:40px 36px 36px;text-align:center;position:relative;z-index:1}
.choice-logo{width:50px;height:50px;margin:0 auto 14px;border-radius:14px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  display:flex;align-items:center;justify-content:center;
  color:var(--on-primary);font-weight:700;font-size:19px}
.choice-title{font-size:22px;font-weight:700;margin-bottom:5px}
.choice-sub{font-size:13px;color:var(--text-2);margin-bottom:28px}
.choice-btns{display:flex;gap:16px;justify-content:center}
.choice-btn{width:152px;height:100px;background:rgba(255,255,255,0.42);
  backdrop-filter:blur(8px);border:1.5px solid var(--glass-border);border-radius:16px;
  cursor:pointer;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:7px;font-family:inherit;position:relative;
  transition:background .15s,border-color .15s,box-shadow .15s}
.choice-btn:hover{background:rgba(2,189,182,0.1);border-color:rgba(2,189,182,0.45);
  box-shadow:0 0 0 4px rgba(2,189,182,0.08)}
.choice-icon{line-height:1;display:flex;align-items:center;justify-content:center}
.choice-icon svg{width:28px;height:28px}
.choice-label{font-size:14px;font-weight:600;color:var(--text)}
.cbadge{position:absolute;top:8px;right:8px;min-width:20px;height:20px;border-radius:10px;
  background:var(--red);color:#fff;font-size:12px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 5px}

/* Toast */
#shell-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);
  background:rgba(255,255,255,0.88);backdrop-filter:blur(12px);border:1px solid var(--glass-border);
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
  align-items:center;justify-content:center;flex-shrink:0;color:var(--text)}
#ham-btn:active{background:rgba(2,189,182,0.1)}
.ham-dot{position:absolute;top:5px;right:5px;width:9px;height:9px;border-radius:50%;
  background:var(--red);display:none}
/* Tab label centre (mobile) */
#tab-label{display:none;flex:1;text-align:center;font-size:14px;font-weight:600;
  color:var(--text);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px}
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
  border-right:1px solid var(--glass-border);box-shadow:4px 0 24px rgba(2,49,100,0.12);
  transform:translateX(-105%);transition:transform .25s ease;overscroll-behavior:contain}
#drawer.open{transform:translateX(0)}
.drawer-head{padding:20px 18px 14px;display:flex;flex-direction:column;gap:8px;
  border-bottom:1px solid rgba(2,189,182,0.15)}
.drawer-logo{width:36px;height:36px;border-radius:10px;
  background:linear-gradient(135deg,var(--brand),var(--accent));
  display:flex;align-items:center;justify-content:center;
  color:var(--on-primary);font-weight:700;font-size:14px}
.drawer-user{font-size:13px;font-weight:600;color:var(--text)}
.drawer-items{flex:1;overflow-y:auto;padding:6px 0}
.drawer-item{width:100%;background:none;border:none;cursor:pointer;font-family:inherit;
  display:flex;align-items:center;gap:12px;padding:11px 18px;
  font-size:14px;font-weight:600;color:var(--text);text-align:left;
  transition:background .12s;position:relative}
.drawer-item:hover{background:rgba(2,189,182,0.08)}
.drawer-item.active{background:rgba(2,189,182,0.13);color:var(--brand)}
.drawer-item svg{width:18px;height:18px;flex-shrink:0;opacity:.65}
.drawer-item.active svg,.drawer-item:hover svg{opacity:1}
.drawer-ibadge{margin-left:auto;min-width:18px;height:18px;border-radius:9px;
  background:var(--red);color:#fff;font-size:11px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0}
.drawer-foot{padding:12px 18px;border-top:1px solid rgba(2,189,182,0.15)}
.drawer-exit-btn{width:100%;padding:10px;background:var(--danger-soft);border:1px solid #fecaca;
  border-radius:8px;font-size:14px;font-weight:600;color:var(--danger);
  cursor:pointer;font-family:inherit}

@media(max-width:1024px){
  #ham-btn{display:flex}
  .tabs{display:none!important}
  .logout-btn{display:none}
  .ua-wrap{display:block!important}
  #tab-label{display:block}
}

/* Choice screen: 2-column tiles + greeting on mobile */
.choice-greeting{display:none;font-size:17px;font-weight:700;margin-bottom:20px;color:var(--text)}
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
/* Theme toggle */
.ua-theme{display:flex;gap:4px;margin:8px 0}
.ua-theme-btn{flex:1;padding:6px 4px;border-radius:6px;border:1.5px solid var(--border);
  background:none;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text-2);
  transition:border-color var(--dur-fast),background var(--dur-fast)}
.ua-theme-btn.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}
/* Minimal dark shell background */
html[data-theme="dark"],html[data-theme="dark"] body{background:var(--bg);color:var(--text)}
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
      <button class="tab-btn" id="tab-btn-manager">${ICONS.manager} Менеджер<span class="tbadge" id="badge-tab-manager">0</span></button>
      <button class="tab-btn active" id="tab-btn-agent">${ICONS.agent} Агент<span class="tbadge" id="badge-tab-agent">0</span></button>
      <button class="tab-btn" id="tab-btn-schedule">${ICONS.schedule} Расписание</button>
      <button class="tab-btn" id="tab-btn-clients">${ICONS.clients} Клиенты</button>
      <button class="tab-btn" id="tab-btn-funnel">${ICONS.funnel} Воронка</button>
      <button class="tab-btn" id="tab-btn-cashier">${ICONS.cashier} Касса</button>
      <button class="tab-btn" id="tab-btn-kviz">${ICONS.kviz} <span id="kviz-tab-text">Квалификация</span><span class="tbadge" id="badge-tab-kviz">0</span></button>
      <button class="tab-btn" id="tab-btn-measure">${ICONS.measure} Замеры</button>
      <!--REPORTS_TAB_BTN-->
      <!--METRICS_TAB_BTN-->
      <!--SETTINGS_TAB_BTN-->
    </div>
    <button class="logout-btn" id="logout-btn"><!--DNAME--> · Выйти</button>
    <div class="ua-wrap" id="ua-wrap">
      <button class="ua-btn" id="ua-btn" aria-label="Меню пользователя">?</button>
      <div class="ua-menu" id="ua-menu">
        <div class="ua-menu-name"><!--DNAME--></div>
        <div class="ua-theme" role="group" aria-label="Тема">
          <button class="ua-theme-btn" data-theme-val="light">Светлая</button>
          <button class="ua-theme-btn" data-theme-val="dark">Тёмная</button>
          <button class="ua-theme-btn" data-theme-val="auto">Авто</button>
        </div>
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
    <div class="ua-theme" role="group" aria-label="Тема" style="margin-bottom:10px">
      <button class="ua-theme-btn" data-theme-val="light">Светлая</button>
      <button class="ua-theme-btn" data-theme-val="dark">Тёмная</button>
      <button class="ua-theme-btn" data-theme-val="auto">Авто</button>
    </div>
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
        <span class="choice-icon">${ICONS.manager}</span>
        <span class="choice-label">Менеджер</span>
      </button>
      <button class="choice-btn" id="choice-agent">
        <span class="cbadge" id="badge-choice-agent">0</span>
        <span class="choice-icon">${ICONS.agent}</span>
        <span class="choice-label">Агент</span>
      </button>
      <button class="choice-btn" id="choice-schedule">
        <span class="choice-icon">${ICONS.schedule}</span>
        <span class="choice-label">Расписание</span>
      </button>
      <button class="choice-btn" id="choice-clients">
        <span class="choice-icon">${ICONS.clients}</span>
        <span class="choice-label">Клиенты</span>
      </button>
      <button class="choice-btn" id="choice-funnel">
        <span class="choice-icon">${ICONS.funnel}</span>
        <span class="choice-label">Воронка</span>
      </button>
      <button class="choice-btn" id="choice-cashier">
        <span class="choice-icon">${ICONS.cashier}</span>
        <span class="choice-label">Касса</span>
      </button>
      <button class="choice-btn" id="choice-kviz">
        <span class="cbadge" id="badge-choice-kviz">0</span>
        <span class="choice-icon">${ICONS.kviz}</span>
        <span class="choice-label">Квалификация</span>
      </button>
      <button class="choice-btn" id="choice-measure">
        <span class="choice-icon">${ICONS.measure}</span>
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

  // Shell page: redirect to /login if not authed; inject display_name + permissions (SW_PERMS)
  app.get('/', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.redirect(302, '/login'); return; }
    const isAdmin = session.role === 'admin';

    // Build SW_PERMS: for admin — all keys edit/see_all; for others — their resolved perm map
    let swPerms: string;
    if (isAdmin) {
      const all: Record<string, { level: string; see_all: boolean }> = {};
      for (const block of PERM_CATALOG) {
        for (const row of block.rows) all[row.key] = { level: 'edit', see_all: Boolean(row.hasSeeAll) };
      }
      swPerms = JSON.stringify(all);
    } else {
      const out: Record<string, { level: string; see_all: boolean }> = {};
      for (const [k, pv] of Object.entries(session.perms)) out[k] = { level: pv.level, see_all: pv.see_all };
      swPerms = JSON.stringify(out);
    }

    const hasSettings = isAdmin || Object.keys(session.perms).some(k => k.startsWith('settings.'));
    const reportsSettingsBtn = hasSettings ? '<button class="side-btn" id="side-to-settings"><span class="side-text">Настройки</span></button>' : '';
    const reportsPane = `<div class="pane hidden" id="reports-pane"><button class="side-btn left" id="side-to-measure2"><span class="side-text">Замеры</span></button>${reportsSettingsBtn}</div>`;
    const settingsBtn  = hasSettings ? `<button class="tab-btn" id="tab-btn-settings">${ICONS.settings} Настройки</button>` : '';
    const settingsPane = hasSettings ? '<div class="pane hidden" id="settings-pane"><button class="side-btn left" id="side-set-to-reports"><span class="side-text">Отчёты</span></button></div>' : '';
    const settingsCh   = hasSettings ? `<button class="choice-btn" id="choice-settings"><span class="choice-icon">${ICONS.settings}</span><span class="choice-label">Настройки</span></button>` : '';
    const permsScript  = `<script>window.SW_PERMS=${swPerms};</script>`;
    const html = SHELL_HTML
      .replace('<!--DNAME-->', escapeHtml(session.display_name))
      .replace('<!--REPORTS_TAB_BTN-->', `<button class="tab-btn" id="tab-btn-reports">${ICONS.reports} Отчёты</button>`)
      .replace('<!--REPORTS_SIDE_FROM_MEASURE-->', '<button class="side-btn" id="side-to-reports"><span class="side-text">Отчёты</span></button>')
      .replace('<!--REPORTS_PANE-->', reportsPane)
      .replace('<!--REPORTS_CHOICE_BTN-->', `<button class="choice-btn" id="choice-reports"><span class="choice-icon">${ICONS.reports}</span><span class="choice-label">Отчёты</span></button>`)
      .replace('<!--METRICS_TAB_BTN-->', '')
      .replace('<!--METRICS_PANE-->', '')
      .replace('<!--METRICS_CHOICE_BTN-->', '')
      .replace('<!--SETTINGS_TAB_BTN-->', settingsBtn)
      .replace('<!--SETTINGS_PANE-->', settingsPane)
      .replace('<!--SETTINGS_CHOICE_BTN-->', settingsCh)
      .replace('<script src="/shell-app.js"></script>', `${permsScript}<script src="/shell-app.js"></script>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // GET /api/me
  app.get('/api/me', async (req, res) => {
    const session = await getSessionWithPerms(req);
    if (!session) { res.status(401).json({ error: 'Unauthorized' }); return; }
    res.json({ login: session.login, display_name: session.display_name, role: session.role, perms: session.perms });
  });

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    const ip    = String(req.ip || req.socket.remoteAddress || '');
    const ua    = String(req.headers['user-agent'] || '');
    const login = String((req.body as Record<string, unknown>)?.login || '').trim().toLowerCase();
    const pw    = String((req.body as Record<string, unknown>)?.password || '');

    if (!login) { res.status(400).json({ error: 'Login required' }); return; }

    const rate = await checkLoginRate(login, ip);
    if (!rate.ok) { res.status(429).json({ error: 'Too many attempts', wait_min: rate.waitMin }); return; }

    try {
      const { data, error } = await supabase.rpc('app_check_login', { p_login: login, p_password: pw });
      const user = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (error || !user?.id) {
        await writeLoginLog(null, login, false, error?.message || 'invalid credentials', ip, ua);
        res.status(401).json({ error: 'Invalid credentials' }); return;
      }
      const userId = String(user.id);
      // Check if user is active
      const { data: profile } = await supabase
        .from('app_users')
        .select('is_active, fired_at')
        .eq('id', userId)
        .maybeSingle();
      if (!profile?.is_active || profile?.fired_at) {
        await writeLoginLog(userId, login, false, 'account inactive', ip, ua);
        res.status(401).json({ error: 'Invalid credentials' }); return;
      }
      await writeLoginLog(userId, login, true, null, ip, ua);
      await supabase.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', userId);
      const token = makeToken({
        id:           userId,
        login:        String(user.login),
        display_name: String(user.display_name),
        role:         String(user.role),
        v:            Number(user.auth_version ?? 1),
      });
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_S}; Path=/`,
      );
      res.json({ ok: true, display_name: String(user.display_name) });
    } catch (e) {
      await writeLoginLog(null, login, false, String(e), ip, ua);
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
