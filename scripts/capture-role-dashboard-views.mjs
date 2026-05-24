#!/usr/bin/env node
/**
 * Capture dashboard + sidebar for each portal role (mock active session).
 *
 *   npm run dev:all   # terminal 1
 *   node scripts/capture-role-dashboard-views.mjs
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs/user-manual/images/role-views');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const ROLES = [
  { portal: 'reviewer', api: 'rvwr', label: 'Reviewer (rvwr)' },
  { portal: 'test_data_reviewer', api: 'trvr', label: 'Test data reviewer (trvr)' },
  { portal: 'labeler', api: 'mtnr', label: 'Model trainer (mtnr)' },
  { portal: 'admin', api: 'admn', label: 'Admin (admn)' },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Install Playwright: npm install -D playwright && npx playwright install chromium');
  process.exit(1);
}

function mockSession(apiRole) {
  return {
    UserID: `demo_${apiRole}`,
    EMailID: `${apiRole}@demo.anica.local`,
    FirstName: 'Demo',
    LastName: apiRole.toUpperCase(),
    Role: apiRole,
    IsActive: true,
  };
}

async function injectRole(context, portal, api) {
  await context.addInitScript(
    ({ session, portal }) => {
      sessionStorage.setItem('anica_login_session', JSON.stringify(session));
      localStorage.setItem('meter_portal_role', portal);
      localStorage.setItem('anica_login_user_id', session.UserID);
      localStorage.setItem('meter_portal_welcome_never_v1', '1');
    },
    { session: mockSession(api), portal },
  );
}

async function waitPortalReady(page) {
  await page.waitForSelector('.portal-shell', { timeout: 45_000 });
  await page.waitForTimeout(1200);
}

async function shot(page, file, { fullPage = true } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT_DIR, file), fullPage });
  console.log(`  ✓ ${file}`);
}

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const { portal, api, label } of ROLES) {
  console.log(`\n${label}`);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await injectRole(context, portal, api);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await waitPortalReady(page);
  await shot(page, `${portal}-dashboard.png`);
  await context.close();
}

await browser.close();
console.log(`\nSaved to ${OUT_DIR}`);
