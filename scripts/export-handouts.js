import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createQuizServer } from '../server/app.js';
import { projectRoot } from '../server/content.js';

const server = createQuizServer({ dbPath: ':memory:', hostKey: 'documentation-only' });
await server.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${server.http.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  await page.goto(`${base}/stand.html`, { waitUntil: 'networkidle' });
  await page.pdf({ path: path.join(projectRoot, 'docs', 'standunterlagen.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(projectRoot, 'docs', 'start-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(projectRoot, 'docs', 'start-mobile.png'), fullPage: true });
  console.log('PDF und Vorschaubilder unter docs/ erzeugt.');
} finally { await browser?.close(); await server.close(); }
