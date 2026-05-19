#!/usr/bin/env node
/**
 * Build an elegant PDF from docs/USER_MANUAL.md with TOC, margins, and PDF bookmarks.
 *
 *   npm run manual:pdf
 *
 * Requires: pandoc, playwright (chromium)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS = join(ROOT, 'docs');
const MD = join(DOCS, 'USER_MANUAL.md');
const OUT_HTML = join(DOCS, 'AMR_Portal_User_Manual.html');
const OUT_PDF = join(DOCS, 'AMR_Portal_User_Manual.pdf');
const CSS = join(DOCS, 'user-manual/manual-pdf.css');
const COVER = join(DOCS, 'user-manual/cover.html');
const TMP_MD = join(DOCS, 'user-manual/.USER_MANUAL.build.md');

function stripManualToc(md) {
  const lines = md.split('\n');
  const out = [];
  let skip = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## Table of contents')) {
      skip = true;
      continue;
    }
    if (skip) {
      if (line.startsWith('## ') && !line.startsWith('## Table of contents')) {
        skip = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

async function runPandoc() {
  let md = await readFile(MD, 'utf8');
  md = stripManualToc(md);
  await mkdir(dirname(TMP_MD), { recursive: true });
  await writeFile(TMP_MD, md, 'utf8');

  const args = [
    TMP_MD,
    '-o',
    OUT_HTML,
    '--standalone',
    '--toc',
    '--toc-depth=2',
    `--css=${CSS}`,
    `--include-before-body=${COVER}`,
    '--metadata',
    'title=AMR Portal User Manual',
    '--resource-path',
    `${DOCS}:${join(DOCS, 'user-manual')}`,
  ];

  await execFileAsync('pandoc', args, { cwd: DOCS });
  console.log(`HTML: ${OUT_HTML}`);
}

async function runPdf() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${OUT_HTML}`, { waitUntil: 'networkidle', timeout: 60_000 });

  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    outline: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%;font-size:8px;color:#64748b;padding:0 20mm;font-family:Helvetica,Arial,sans-serif;">
        <span>AMR Portal — User Manual</span>
      </div>`,
    footerTemplate: `
      <div style="width:100%;font-size:8px;color:#64748b;padding:0 20mm;font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:space-between;">
        <span>Anica Meter Reading Portal</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
  });

  await browser.close();
  console.log(`PDF:  ${OUT_PDF}`);
}

async function main() {
  try {
    await runPandoc();
    await runPdf();
    console.log('\nDone. Open the PDF — use the sidebar bookmarks or Contents links to jump to sections.');
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

main();
