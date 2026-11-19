#!/usr/bin/env node
/**
 * Mobile layout + dark-theme + contrast check.
 * Visits key pages at multiple widths in both light and dark themes,
 * takes screenshots, checks horizontal scroll and text contrast.
 *
 * Usage: npm run check:mobile
 * Requires E2E_LOGIN and E2E_PASSWORD in .env (or environment).
 * Optional BASE_URL (default https://slimway-agent.onrender.com).
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const BASE   = process.env.BASE_URL || 'https://slimway-agent.onrender.com';
const LOGIN  = process.env.E2E_LOGIN;
const PASS   = process.env.E2E_PASSWORD;

if (!LOGIN || !PASS) {
  console.error('ERROR: E2E_LOGIN and E2E_PASSWORD must be set in .env or environment');
  process.exit(1);
}

const WIDTHS   = [375, 768, 1024, 1440];
const LANDSCAPE = { width: 667, height: 375, label: '667x375-land' };
const THEMES   = ['light', 'dark'];

const PAGES = [
  { name: 'shell',       path: '/',                  auth: true  },
  { name: 'manager',     path: '/kviz/manager',       auth: true  },
  { name: 'reports',     path: '/kviz/reports',       auth: true  },
  { name: 'clients',     path: '/kviz/crm/clients',   auth: true  },
  { name: 'kassa',       path: '/kviz/crm/cashier',   auth: true  },
  { name: 'settings',    path: '/kviz/crm/settings',  auth: true  },
  { name: 'funnel',      path: '/kviz/crm/funnel',    auth: true  },
  { name: 'measure-new', path: '/kviz/measure/new',   auth: true  },
];

const OUTDIR = path.join(__dirname, '..', 'tmp', 'mobile-check');
fs.mkdirSync(OUTDIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(label) { return String(label).replace(/[^a-z0-9]/gi, '-'); }

function checkNoHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

// Returns the minimum contrast ratio found for body text, or null if unavailable.
// Checks up to 10 visible text nodes against their computed background.
function checkContrast(page) {
  return page.evaluate(() => {
    function parseRgb(s) {
      if (!s) return null;
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    }
    function luminance(r, g, b) {
      return [r, g, b].reduce((sum, v, i) => {
        const c = v / 255;
        return sum + (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    }
    function ratio(c1, c2) {
      const l1 = luminance(...c1), l2 = luminance(...c2);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }
    const els = Array.from(document.querySelectorAll('p,h1,h2,h3,h4,span,td,th,button,label,a'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 10 && r.top >= 0 && r.top < window.innerHeight;
      }).slice(0, 20);

    let minRatio = Infinity;
    for (const el of els) {
      const st = getComputedStyle(el);
      const fg = parseRgb(st.color);
      const bg = parseRgb(st.backgroundColor);
      if (!fg || !bg) continue;
      // Skip transparent backgrounds
      if (bg[0] === 0 && bg[1] === 0 && bg[2] === 0) continue;
      const r = ratio(fg, bg);
      if (r < minRatio) minRatio = r;
    }
    return minRatio === Infinity ? null : Math.round(minRatio * 10) / 10;
  });
}

// Apply theme to a page (fires postMessage + sets data-theme directly)
async function applyTheme(page, theme) {
  await page.evaluate((t) => {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }, theme);
  await page.waitForTimeout(200); // let CSS transitions settle
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let total = 0, failed = 0;

  const viewports = [
    ...WIDTHS.map(w => ({ width: w, height: Math.round(w * 1.78), label: String(w) })),
    LANDSCAPE,
  ];

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const loginPage = await ctx.newPage();
  await loginPage.setViewportSize({ width: 1440, height: 900 });
  await loginPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await loginPage.fill('input[name="login"], input[type="text"]', LOGIN);
  await loginPage.fill('input[name="password"], input[type="password"]', PASS);
  await loginPage.click('button[type="submit"]');
  await loginPage.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => {});
  await loginPage.close();

  for (const theme of THEMES) {
    for (const pg of PAGES) {
      for (const vp of viewports) {
        total++;
        const tab = await ctx.newPage();
        try {
          await tab.setViewportSize({ width: vp.width, height: vp.height });
          await tab.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle', timeout: 25000 });
          await applyTheme(tab, theme);
          await tab.waitForTimeout(600);

          const hasScroll   = await checkNoHorizScroll(tab);
          const minContrast = await checkContrast(tab);
          const contrastFail = minContrast !== null && minContrast < 3.0;

          const issues = [
            hasScroll   ? 'horiz-scroll' : null,
            contrastFail ? `contrast=${minContrast}` : null,
          ].filter(Boolean);
          const status = issues.length ? 'FAIL' : 'ok';
          if (issues.length) failed++;

          const fname = `${slug(theme)}_${slug(pg.name)}_${vp.label}.png`;
          await tab.screenshot({ path: path.join(OUTDIR, fname), fullPage: false });

          results.push({ theme, page: pg.name, width: vp.label, status, issues: issues.join(', '), file: fname });
          process.stdout.write(status === 'ok' ? '.' : 'F');
        } catch (e) {
          failed++;
          results.push({ theme, page: pg.name, width: vp.label, status: 'ERR', issues: String(e).slice(0, 80) });
          process.stdout.write('E');
        } finally {
          await tab.close();
        }
      }
    }
  }

  await browser.close();

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('\n');
  const colW = [6, 14, 10, 6, 50];
  const hdr = ['Theme', 'Page', 'Width', 'Status', 'Issues'].map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));
  for (const r of results) {
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
  const passed = total - failed;
  console.log(`\n${passed}/${total} passed.  Screenshots → tmp/mobile-check/`);
  if (failed) process.exit(1);
})();
