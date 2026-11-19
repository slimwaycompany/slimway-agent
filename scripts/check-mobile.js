#!/usr/bin/env node
/**
 * Mobile layout + dark-theme + contrast check.
 * Visits all key pages at multiple widths in both light and dark themes,
 * takes screenshots, checks horizontal scroll and text contrast.
 *
 * Usage: npm run check:mobile
 * Requires E2E_LOGIN and E2E_PASSWORD in .env (or environment).
 * Optional: BASE_URL, E2E_CLIENT_ID, E2E_SHARE_TOKEN, CONTRAST_STRICT=1
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const BASE            = process.env.BASE_URL   || 'https://slimway-agent.onrender.com';
const LOGIN           = process.env.E2E_LOGIN;
const PASS            = process.env.E2E_PASSWORD;
const E2E_CLIENT_ID   = process.env.E2E_CLIENT_ID   || '';
const E2E_SHARE_TOKEN = process.env.E2E_SHARE_TOKEN  || '';
const CONTRAST_STRICT = process.env.CONTRAST_STRICT === '1'; // fail at < 3.0 when set

if (!LOGIN || !PASS) {
  console.error('ERROR: E2E_LOGIN and E2E_PASSWORD must be set in .env or environment');
  process.exit(1);
}

const WIDTHS = [375, 1440];
const THEMES = ['light', 'dark'];

// Settings sections — navigate via sessionStorage
const SETTINGS_SECTIONS = [
  'appearance', 'devices', 'tv', 'abonements', 'services', 'products',
  'payments', 'funnels', 'staff', 'control', 'fb-users', 'pbx', 'service',
];

function buildPages() {
  const p = [
    { name: 'login',          path: '/login',                    auth: false },
    { name: 'shell',          path: '/',                         auth: true  },
    { name: 'window',         path: '/window',                   auth: true,  frameFrom: '/' },
    { name: 'manager',        path: '/kviz/manager',             auth: true  },
    { name: 'manager-admin',  path: '/kviz/manager/admin',       auth: true  },
    { name: 'crm-schedule',   path: '/kviz/crm/schedule',        auth: true  },
    { name: 'clients',        path: '/kviz/crm/clients',         auth: true  },
    { name: 'funnel',         path: '/kviz/crm/funnel',          auth: true  },
    { name: 'kassa',          path: '/kviz/crm/cashier',         auth: true  },
    { name: 'kviz',           path: '/kviz',                     auth: true  },
    { name: 'history',        path: '/kviz/history',             auth: true  },
    { name: 'measure',        path: '/kviz/measure',             auth: true  },
    { name: 'measure-new',    path: '/kviz/measure/new',         auth: true  },
    { name: 'inbody',         path: '/kviz/measure/inbody',      auth: true  },
    { name: 'inbody-import',  path: '/kviz/measure/inbody-import', auth: true },
    { name: 'reports',        path: '/kviz/reports',             auth: true  },
    { name: 'settings',       path: '/kviz/crm/settings',        auth: true  },
    // Settings sections — append via URL param (handled with sessionStorage in goto)
    ...SETTINGS_SECTIONS.map(s => ({
      name: `settings-${s}`,
      path: '/kviz/crm/settings',
      auth: true,
      settingsSection: s,
    })),
    { name: 'scriptolog',     path: '/scriptolog',               auth: true, width: 360 },
    // Always-light pages — only test with dark theme set to verify they stay light
    { name: 'results',        path: '/kviz/results',             auth: false, alwaysLight: true },
  ];
  if (E2E_CLIENT_ID) {
    p.push({ name: 'reports-client', path: `/kviz/reports/client/${E2E_CLIENT_ID}`, auth: true });
  }
  if (E2E_SHARE_TOKEN) {
    p.push({ name: 'share-token', path: `/kviz/r/${E2E_SHARE_TOKEN}`, auth: false, alwaysLight: true });
  }
  return p;
}

const PAGES  = buildPages();
const OUTDIR = path.join(__dirname, '..', 'tmp', 'mobile-check');
fs.mkdirSync(OUTDIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(s) { return String(s).replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-'); }

function checkNoHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

// Returns array of contrast problems: { selector, text, fg, bg, ratio }
function checkContrastAll(page) {
  return page.evaluate(() => {
    function parseColor(s) {
      if (!s || s === 'transparent') return null;
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
      if (!m) return null;
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      if (a < 0.05) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    function luminance(r, g, b) {
      return [r, g, b].reduce((sum, c, i) => {
        const v = c / 255;
        return sum + (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    }
    function ratio(c1, c2) {
      const l1 = luminance(c1.r, c1.g, c1.b), l2 = luminance(c2.r, c2.g, c2.b);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }
    // Walk up DOM to find the actual background color
    function getBg(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const c = parseColor(getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0.5) return c;
        cur = cur.parentElement;
      }
      // fallback: body background
      return parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    }

    const problems = [];
    const els = Array.from(document.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, span, td, th, button, label, a, div, li'
    )).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 10 && r.height > 8 && r.top >= 0 && r.top < window.innerHeight &&
             el.textContent.trim().length > 0 &&
             el.children.length === 0; // leaf text nodes only
    });

    for (const el of els) {
      const st  = getComputedStyle(el);
      const fgC = parseColor(st.color);
      if (!fgC) continue;
      const bgC = getBg(el);
      const r   = ratio(fgC, bgC);
      if (r < 4.5) {
        const sel = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.') : '');
        problems.push({
          selector: sel,
          text: el.textContent.trim().slice(0, 40),
          fg: `rgb(${fgC.r},${fgC.g},${fgC.b})`,
          bg: `rgb(${bgC.r},${bgC.g},${bgC.b})`,
          ratio: Math.round(r * 10) / 10,
        });
      }
    }
    return problems;
  });
}

// Set theme via API (server-side + DB)
async function putTheme(ctx, theme) {
  try {
    await ctx.request.fetch(`${BASE}/kviz/api/me/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ ui_theme: theme }),
    });
  } catch (e) {
    // ignore — might fail on login page
  }
}

// Navigate to a page, optionally setting sessionStorage for settings sections
async function gotoPage(ctx, pg, theme, vp) {
  const tab = await ctx.newPage();
  try {
    await tab.setViewportSize({ width: pg.width || vp.width, height: vp.height });

    if (pg.settingsSection) {
      // Pre-set sessionStorage before navigation
      await tab.addInitScript(`
        try { sessionStorage.setItem('crm-settings-section', '${pg.settingsSection}'); } catch(e) {}
      `);
    }

    await tab.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle', timeout: 30000 });

    // For always-light pages with dark theme — verify data-theme is NOT set
    if (pg.alwaysLight && theme === 'dark') {
      const dataTheme = await tab.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (dataTheme === 'dark') {
        return { tab, alwaysLightViolation: true };
      }
    }

    await tab.waitForTimeout(400);
    return { tab };
  } catch (e) {
    await tab.close();
    throw e;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true });
  const rows    = [];
  let   total   = 0, failed = 0;
  let   origTheme = 'light';

  const viewports = WIDTHS.map(w => ({ width: w, height: Math.round(w * 1.78), label: String(w) }));

  // ── Login ──
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const loginPage = await ctx.newPage();
  await loginPage.setViewportSize({ width: 1440, height: 900 });
  await loginPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await loginPage.fill('input[type="text"], input[id="login"]', LOGIN);
  await loginPage.fill('input[type="password"]', PASS);
  await loginPage.click('button');
  await loginPage.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => {});

  // Get current theme before we touch it
  try {
    const meResp = await ctx.request.fetch(`${BASE}/kviz/api/me`);
    const me     = await meResp.json();
    origTheme    = me.ui_theme || 'light';
  } catch {}
  await loginPage.close();

  const contrastIssues = []; // { theme, page, width, issues[] }

  // ── Passes ──
  for (const theme of THEMES) {
    console.log(`\n── theme: ${theme} ──`);
    await putTheme(ctx, theme);

    for (const pg of PAGES) {
      // alwaysLight pages: only test with dark theme (to verify they stay light)
      if (pg.alwaysLight && theme !== 'dark') continue;

      for (const vp of viewports) {
        total++;
        try {
          const { tab, alwaysLightViolation } = await gotoPage(ctx, pg, theme, vp);
          const issues = [];

          if (alwaysLightViolation) {
            issues.push('always-light-violation');
          } else {
            const hasScroll   = await checkNoHorizScroll(tab);
            if (hasScroll) issues.push('horiz-scroll');

            const cProblems = await checkContrastAll(tab);
            if (cProblems.length) {
              const low = cProblems.filter(p => p.ratio < 3.0);
              if (low.length > 0) {
                if (CONTRAST_STRICT) issues.push(`contrast-critical(${low.length})`);
                else issues.push(`contrast-warn(${low.length}<3.0)`);
              }
              const med = cProblems.filter(p => p.ratio >= 3.0 && p.ratio < 4.5);
              if (med.length) issues.push(`contrast-warn(${med.length}<4.5)`);
              contrastIssues.push({ theme, page: pg.name, width: vp.label, problems: cProblems });
            }
          }

          const status = issues.some(i => !i.startsWith('contrast-warn')) ? 'FAIL' : (issues.length ? 'WARN' : 'ok');
          if (status === 'FAIL') failed++;

          const fname = `${slug(theme)}_${slug(pg.name)}_${vp.label}.png`;
          if (!alwaysLightViolation) {
            await tab.screenshot({ path: path.join(OUTDIR, fname), fullPage: false });
          }
          await tab.close();

          rows.push({ theme, page: pg.name, width: vp.label, status, issues: issues.join(', '), file: fname });
          process.stdout.write(status === 'ok' ? '.' : status === 'WARN' ? 'W' : 'F');
        } catch (e) {
          failed++;
          rows.push({ theme, page: pg.name, width: vp.label, status: 'ERR', issues: String(e).slice(0, 100) });
          process.stdout.write('E');
        }
      }
    }
  }

  // ── Restore original theme ──
  await putTheme(ctx, origTheme);
  await browser.close();

  // ── Console report ──
  console.log('\n\n══ RESULTS ══');
  const colW = [5, 20, 6, 5, 60];
  const hdr  = ['Theme', 'Page', 'Width', 'Stat', 'Issues'].map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));
  for (const r of rows) {
    if (r.status !== 'ok') {
      console.log([
        r.theme.padEnd(colW[0]),
        r.page.padEnd(colW[1]),
        r.width.padEnd(colW[2]),
        r.status.padEnd(colW[3]),
        r.issues || '',
      ].join('  '));
    }
  }
  const passed = rows.filter(r => r.status === 'ok').length;
  const warned = rows.filter(r => r.status === 'WARN').length;
  console.log(`\n${passed} ok  ${warned} warn  ${failed} fail  (of ${total} total)`);
  console.log('Screenshots → tmp/mobile-check/');

  // ── Markdown report ──
  const md = [`# check:mobile report\n`, `Generated: ${new Date().toISOString()}\n`];
  md.push('\n## Summary\n');
  md.push(`| Theme | Page | Width | Status | Issues |`);
  md.push(`|-------|------|-------|--------|--------|`);
  for (const r of rows) {
    md.push(`| ${r.theme} | ${r.page} | ${r.width} | ${r.status} | ${r.issues || ''} |`);
  }

  if (contrastIssues.length) {
    md.push('\n## Contrast issues (< 4.5:1)\n');
    for (const ci of contrastIssues) {
      md.push(`\n### ${ci.theme} / ${ci.page} / ${ci.width}\n`);
      md.push('| Selector | Text | FG | BG | Ratio |');
      md.push('|----------|------|----|----|-------|');
      for (const p of ci.problems.slice(0, 30)) {
        md.push(`| \`${p.selector}\` | ${p.text.replace(/\|/g, '\\|')} | ${p.fg} | ${p.bg} | ${p.ratio} |`);
      }
    }
  }

  fs.writeFileSync(path.join(OUTDIR, 'report.md'), md.join('\n'));
  console.log('Report → tmp/mobile-check/report.md');

  if (failed) process.exit(1);
})();
