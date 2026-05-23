#!/usr/bin/env node
/**
 * Capture portal screenshots for docs/USER_MANUAL.md (local dev, mock Anica session).
 *
 *   npm run dev:all    # terminal 1
 *   npm run manual:screenshots
 *
 * Optional: AUTH_STATE=docs/user-manual/.auth-state.json for a saved browser login instead of mock session.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs/user-manual/images');
const FIXTURE = join(ROOT, 'docs/user-manual/fixtures/sample-upload.png');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const AUTH_STATE = process.env.AUTH_STATE || '';

const MOCK_SESSION = { UserID: 'manual-docs', EMailID: 'docs@anica.local', FirstName: 'Manual', LastName: 'Docs' };

/** Minimal 1×1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Install Playwright: npm install -D playwright && npx playwright install chromium');
  process.exit(1);
}

async function seedFixture() {
  await mkdir(dirname(FIXTURE), { recursive: true });
  await writeFile(FIXTURE, TINY_PNG);
}

async function injectAuth(context, { role = 'reviewer', dismissWelcome = true } = {}) {
  if (AUTH_STATE) return;
  await context.addInitScript(
    ({ session, role, dismissWelcome }) => {
      sessionStorage.setItem('anica_login_session', JSON.stringify(session));
      localStorage.setItem('meter_portal_role', role);
      if (dismissWelcome) localStorage.setItem('meter_portal_welcome_never_v1', '1');
    },
    { session: MOCK_SESSION, role, dismissWelcome },
  );
}

async function waitPortalReady(page) {
  await page.waitForSelector('.portal-shell', { timeout: 45_000 });
  await page.waitForTimeout(800);
}

async function shot(page, file, { fullPage = false, clip } = {}) {
  const path = join(OUT_DIR, file);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path, fullPage, clip });
  console.log(`  ✓ ${file}`);
}

async function goto(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
}

await mkdir(OUT_DIR, { recursive: true });
await seedFixture();

const browser = await chromium.launch({ headless: true });
const contextOpts = { viewport: { width: 1280, height: 900 } };
if (AUTH_STATE) contextOpts.storageState = AUTH_STATE;

const context = await browser.newContext(contextOpts);
const page = await context.newPage();

try {
  // —— Login (no mock session) ——
  console.log('01-login');
  await goto(page, '/login');
  await page.waitForSelector('.login-page', { timeout: 20_000 });
  await shot(page, '01-login.png');

  await injectAuth(context, { role: 'reviewer', dismissWelcome: true });
  const authed = await context.newPage();

  console.log('02-dashboard-reviewer');
  await goto(authed, '/');
  await waitPortalReady(authed);
  await shot(authed, '02-dashboard-reviewer.png');

  console.log('02b-welcome-modal');
  await authed.evaluate(() => {
    localStorage.removeItem('meter_portal_welcome_never_v1');
    sessionStorage.removeItem('meter_portal_welcome_dismissed_session');
    window.dispatchEvent(new CustomEvent('portal-welcome-open'));
  });
  if (await authed.locator('.portal-welcome-overlay').isVisible().catch(() => false)) {
    await shot(authed, '02-welcome-modal.png');
    await authed.locator('.portal-welcome-close').click();
    await authed.waitForTimeout(400);
  }

  console.log('03-sidebar-reviewer');
  await authed.locator('.portal-sidebar').screenshot({ path: join(OUT_DIR, '03-sidebar-reviewer.png') });
  console.log('  ✓ 03-sidebar-reviewer.png');

  console.log('04-awaiting-review');
  await goto(authed, '/readings/incorrect_new');
  await authed.waitForSelector('.readings-list-page', { timeout: 45_000 });
  await authed.waitForTimeout(1200);
  await shot(authed, '04-awaiting-review-list.png');

  console.log('05-reading-detail');
  const rowLink = authed.locator('.readings-table tbody tr a').first();
  if (await rowLink.count()) {
    await rowLink.click();
  } else {
    const sampleId =
      process.env.MANUAL_SAMPLE_READING_ID ||
      (await fetch(`${process.env.API_BASE || 'http://localhost:3001'}/api/readings?workType=1000&limit=1`)
        .then((r) => r.json())
        .then((rows) => rows?.[0]?.id)
        .catch(() => null));
    if (sampleId) {
      await goto(authed, `/reading/${encodeURIComponent(sampleId)}`);
    }
  }
  if (authed.url().includes('/reading/')) {
    await authed.waitForSelector('.reading-detail-layout', { timeout: 45_000 });
    await authed.waitForTimeout(1000);
    await shot(authed, '05-reading-detail.png');
  } else {
    console.warn('  ⚠ no reading available — 05-reading-detail.png skipped');
  }

  console.log('06-bulk-upload');
  await goto(authed, '/manual-upload');
  await authed.waitForSelector('.manual-upload-page', { timeout: 20_000 });
  await shot(authed, '06-bulk-upload.png');

  console.log('07-bulk-upload-with-file');
  const fileInput = authed.locator('.manual-upload-dropzone input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);
  await authed.waitForSelector('.manual-upload-preview-block', { timeout: 10_000 });
  await authed.waitForTimeout(500);
  await shot(authed, '07-bulk-upload-with-files.png');

  console.log('08-label-uploads');
  await goto(authed, '/manual-upload/label');
  await authed.waitForSelector('.manual-label-page', { timeout: 45_000 });
  await authed.waitForTimeout(1500);
  await shot(authed, '08-label-uploads.png');

  console.log('09-label-lightbox');
  const card = authed.locator('.manual-label-card').first();
  if (await card.count()) {
    await card.locator('.manual-label-card-media').click();
    await authed.waitForSelector('.manual-label-lightbox-shell', { timeout: 10_000 });
    await authed.waitForTimeout(600);
    await shot(authed, '09-label-lightbox.png');
    await authed.keyboard.press('Escape').catch(() => {});
  } else {
    console.warn('  ⚠ no manual uploads — 09-label-lightbox.png skipped');
  }

  console.log('10-correct-list');
  await goto(authed, '/readings/correct');
  await authed.waitForSelector('.readings-list-page', { timeout: 45_000 });
  await authed.waitForTimeout(800);
  await shot(authed, '10-correct-list.png');

  console.log('11-incorrect-queues');
  await goto(authed, '/readings/incorrect-queues');
  await authed.waitForSelector('.readings-list-page', { timeout: 45_000 }).catch(() => {});
  await authed.waitForTimeout(800);
  await shot(authed, '11-incorrect-queues.png');

  // —— Test data reviewer ——
  await injectAuth(context, { role: 'test_data_reviewer', dismissWelcome: true });
  const tdr = await context.newPage();

  console.log('13-test-data-pending');
  await goto(tdr, '/test-data/pending');
  await tdr.waitForSelector('.readings-list-page', { timeout: 45_000 }).catch(() => {});
  await tdr.waitForTimeout(800);
  await shot(tdr, '13-test-data-pending.png');

  console.log('14-test-data-images');
  await goto(tdr, '/test-data/images');
  await tdr.waitForTimeout(2000);
  await shot(tdr, '14-test-data-images.png');
  await tdr.close();

  // —— Labeler ——
  await injectAuth(context, { role: 'labeler', dismissWelcome: true });
  const labeler = await context.newPage();

  console.log('15-training-hub');
  await goto(labeler, '/training');
  await labeler.waitForSelector('.training-hub-page, .readings-list-page', { timeout: 45_000 }).catch(() => {});
  await labeler.waitForTimeout(1200);
  await shot(labeler, '15-training-hub.png');
  await labeler.close();

  // —— Admin ——
  await injectAuth(context, { role: 'admin', dismissWelcome: true });
  const admin = await context.newPage();

  console.log('16-dashboard-admin');
  await goto(admin, '/');
  await waitPortalReady(admin);
  await shot(admin, '16-dashboard-admin.png');

  console.log('17-model-factory');
  await goto(admin, '/factory');
  await admin.waitForTimeout(2000);
  await shot(admin, '17-model-factory.png');

  console.log('18-pipeline-iterations');
  await goto(admin, '/pipeline-iterations');
  await admin.waitForTimeout(2000);
  await shot(admin, '18-pipeline-iterations.png');

  console.log('19-all-readings');
  await goto(admin, '/readings/all');
  await admin.waitForSelector('.readings-list-page', { timeout: 45_000 }).catch(() => {});
  await admin.waitForTimeout(800);
  await shot(admin, '19-all-readings.png');

  await admin.close();

  // —— Shared pages (reviewer) ——
  console.log('20-usage');
  await goto(authed, '/usage');
  await authed.waitForTimeout(2000);
  await shot(authed, '20-usage.png');

  console.log('21-models');
  await goto(authed, '/models');
  await authed.waitForTimeout(2000);
  await shot(authed, '21-models.png');

  await authed.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(`\nScreenshots saved to ${OUT_DIR}`);
