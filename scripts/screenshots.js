#!/usr/bin/env node
// npm run screenshots [-- --out docs/screenshots] [-- --dark] [-- --only today,post]
//
// Every page of the website at phone width (390x844) and desktop width
// (1440x900), in a headless browser, from the fictional demo only: it builds the
// demo home first, so no real account can ever appear in a picture that goes in
// the public repository.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../src/core/paths.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = path.resolve(ROOT, opt('out', 'docs/screenshots'));
const only = opt('only', null)?.split(',');
const themes = args.includes('--dark') ? ['light', 'dark'] : args.includes('--dark-only') ? ['dark'] : ['light'];
mkdirSync(out, { recursive: true });

const port = 4791;
const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo.js'), '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', (d) => {
    buf += d;
    if (buf.includes('open http://')) resolve();
  });
  server.on('exit', (c) => reject(new Error(`demo exited ${c}`)));
  setTimeout(() => reject(new Error('demo did not start')), 180_000);
});

const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const shots = [];
try {
  for (const theme of themes) {
    for (const [device, viewport, extra] of [
      ['phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
      ['desktop', { width: 1440, height: 900 }, { deviceScaleFactor: 1 }],
    ]) {
      const context = await browser.newContext({ viewport, ...extra, locale: 'he-IL', colorScheme: theme });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/login`);
      if (!only || only.includes('login')) shots.push(await shot(page, `login-${device}${theme === 'dark' ? '-dark' : ''}`));
      await page.fill('input[name=user]', 'demo');
      await page.fill('input[name=password]', 'demo-password-2026');
      await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
      const postId = await page.evaluate(() => document.querySelector('[data-post]')?.id?.replace('post-', ''));
      const pages = [
        ['today', '/'],
        ['post', `/post/${postId}`],
        ['accounts', '/accounts'],
        ['results', '/results'],
        ['sources', '/sources'],
        ['new', '/new'],
        ['settings', '/settings'],
        ...(device === 'phone' ? [['more', '/more']] : []),
      ];
      // The onboarding review, from a fictional seed, offline: discovery runs, the page lists what it found.
      if (!only || only.includes('new-review')) {
        await page.goto(`${base}/new`);
        await page.fill('input[name=niche]', 'בישול טבעוני לסטודנטים');
        await page.fill('input[name=audience]', 'סטודנטים עם מטבח קטן ותקציב קטן');
        await page.fill('input[name=topics]', 'מתכונים, תקציב, תזונה');
        await Promise.all([page.waitForNavigation(), page.click('form[action="/new"] button[type=submit]')]);
        for (let i = 0; i < 30 && !(await page.content()).includes('שם לחשבון'); i++) {
          await page.waitForTimeout(500);
          await page.reload();
        }
        shots.push(await shot(page, `new-review-${device}${theme === 'dark' ? '-dark' : ''}`));
      }
      for (const [name, url] of pages) {
        if (only && !only.includes(name)) continue;
        await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
        shots.push(await shot(page, `${name}-${device}${theme === 'dark' ? '-dark' : ''}`));
      }
      if (errors.length) console.log(`${device}/${theme} console errors:\n  ${[...new Set(errors)].join('\n  ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

async function shot(page, name) {
  // A full-page picture of a lazy page: load every image first, or the ones below the fold come out blank.
  // A lazy image that has not started can already report `complete`, so wait for pixels.
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach((i) => (i.loading = 'eager'));
    for (let t = 0; t < 50 && imgs.some((i) => !i.naturalWidth); t++) await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
  });
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) console.log(`  ${name}: the page scrolls sideways`);
  return file;
}
console.log(`${shots.length} screenshots in ${path.relative(ROOT, out)}`);
