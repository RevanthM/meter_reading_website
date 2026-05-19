#!/usr/bin/env node
/** Re-capture manual screenshots that were previously full-page (viewport only). */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../docs/user-manual/images');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SESSION = { UserID: 'manual-docs', EMailID: 'docs@anica.local' };

const SHOTS = [
  { file: '10-correct-list.png', path: '/readings/correct', role: 'reviewer' },
  { file: '08-label-uploads.png', path: '/manual-upload/label', role: 'reviewer' },
  { file: '14-test-data-images.png', path: '/test-data/images', role: 'test_data_reviewer' },
  { file: '18-pipeline-iterations.png', path: '/pipeline-iterations', role: 'admin' },
  { file: '19-all-readings.png', path: '/readings/all', role: 'admin' },
  { file: '20-usage.png', path: '/usage', role: 'reviewer' },
  { file: '21-models.png', path: '/models', role: 'reviewer' },
];

const { chromium } = await import('playwright');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

for (const { file, path, role } of SHOTS) {
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ session, role }) => {
      sessionStorage.setItem('anica_login_session', JSON.stringify(session));
      localStorage.setItem('meter_portal_role', role);
      localStorage.setItem('meter_portal_welcome_never_v1', '1');
    },
    { session: SESSION, role },
  );
  console.log(file);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, file) });
  await page.close();
}

await browser.close();
console.log('Done.');
