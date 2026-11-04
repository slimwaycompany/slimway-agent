#!/usr/bin/env node
/**
 * Mobile layout check: visits key pages at multiple widths,
 * takes screenshots to tmp/mobile-check/, reports pass/fail.
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
    const m = line.match(/^([A-Z_]+)=(.*)$/);
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

const WIDTHS = [375, 390, 768, 1024, 1440];
const LANDSCAPE = { width: 667, height: 375, label: '667x375-land' };

const PAGES = [
  { name: 'login',       path: '/login',          auth: false },
  { name: 'shell',       path: '/',               auth: true  },
  { name: 'manager',     path: '/kviz/manager',   auth: true  },
  { name: 'reports',     path: '/kviz/reports',   auth: true  },
  { name: 'clients',     path: '/kviz/crm/clients', auth: true },
  { name: 'kassa',       path: '/kviz/crm/cashier', auth: true },
  { name: 'settings',    path: '/kviz/crm/settings', auth: true },
  { name: 'schedule',    path: '/kviz/crm/schedule', auth: true },
  { name: 'funnel',      path: '/kviz/crm/funnel', auth: true },
  { name: 'measure-new', path: '/kviz/measure/new', auth: true },
  { name: 'results',     path: '/kviz/results',   auth: false },
];

const OUTDIR = path.join(__dirname, '..', 'tmp', 'mobile-check');
fs.mkdirSync(OUTDIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(label) { return String(label).replace(/[^a-z0-9]/gi, '-'); }

function checkNoHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let total = 0, failed = 0;

  // Build viewport list: portrait widths + landscape
  const viewports = [
    ...WIDTHS.map(w => ({ width: w, height: Math.round(w * 1.78), label: String(w) })),
    LANDSCAPE,
  ];

  // Create a context with auth cookie set after login
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const loginPage = await ctx.newPage();

  // Login once
  await loginPage.setViewportSize({ width: 1440, height: 900 });
  await loginPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await loginPage.fill('input[name="login"], input[type="text"]', LOGIN);
  await loginPage.fill('input[name="password"], input[type="password"]', PASS);
  await loginPage.click('button[type="submit"]');
  await loginPage.waitForURL(url => !url.includes('/login'), { timeout: 15000 }).catch(() => {});
  await loginPage.close();

  for (const pg of PAGES) {
    for (const vp of viewports) {
      total++;
      const tab = await ctx.newPage();
      try {
        await tab.setViewportSize({ width: vp.width, height: vp.height });
        await tab.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle', timeout: 20000 });
        await tab.waitForTimeout(800); // let animations settle

        const hasScroll = await checkNoHorizScroll(tab);
        const status = hasScroll ? 'SCROLL' : 'ok';
        if (hasScroll) failed++;

        const fname = `${slug(pg.name)}_${vp.label}.png`;
        await tab.screenshot({ path: path.join(OUTDIR, fname), fullPage: false });

        results.push({ page: pg.name, width: vp.label, status, file: fname });
        process.stdout.write(status === 'ok' ? '.' : 'X');
      } catch (e) {
        failed++;
        results.push({ page: pg.name, width: vp.label, status: 'ERR', error: String(e).slice(0, 80) });
        process.stdout.write('E');
      } finally {
        await tab.close();
      }
    }
  }

  await browser.close();

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('\n');
  const colW = [16, 10, 8, 50];
  const hdr = ['Page', 'Width', 'Status', 'Note'].map((h, i) => h.padEnd(colW[i])).join('  ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'SCROLL' ? '⚠ horiz-scroll' : '✗ error';
    console.log([
      r.page.padEnd(colW[0]),
      r.width.padEnd(colW[1]),
      r.status.padEnd(colW[2]),
      (r.error || (r.status !== 'ok' ? icon : '')).slice(0, 50),
    ].join('  '));
  }
  console.log(`\n${total - failed}/${total} passed.  Screenshots → tmp/mobile-check/`);
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
