// The width of every character the slide styles set, measured once in the browser from the bundled faces
// (src/render/styles/metrics.json). The writing checks use it to tell whether a headline fits a style before
// anything is rendered (src/render/styles/fit.js): a check in code, so a headline too long for its style goes back
// to the writer through the repair loop instead of failing at render.
//
//   node scripts/style-metrics.js      run again after a face in src/render/styles/tokens.js changes
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fontFaces, headlineFaces } from '../src/render/fonts.js';
import { FACES } from '../src/render/styles/tokens.js';
import { ROOT } from '../src/core/paths.js';

const CHARS = [
  ...'אבגדהוזחטיךכלםמןנסעףפץצקרשת',
  ...'0123456789',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ...'  .,:;!?"\'()-–—/…%₪$€£&+#@־׳״“”’',
];

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.setContent(`<html><head><style>${fontFaces([...new Set(FACES.map((f) => f.family.replace(/ Headline$/, '')).concat(['Rubik']))])}${headlineFaces('Karantina')}</style></head><body></body></html>`);
await tab.evaluate(() => Promise.all([...document.fonts].map((f) => f.load())));
const out = {};
for (const f of FACES) {
  const key = `${f.family} ${f.weight}`;
  out[key] = await tab.evaluate(({ family, weight, chars }) => {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;white-space:pre;font:${weight} 100px '${family}'`;
    document.body.appendChild(el);
    const w = {};
    for (const ch of chars) {
      // Measured between two letters, so a space or a mark has its width in a line, not alone.
      el.textContent = `x${ch}x`;
      const both = el.getBoundingClientRect().width;
      el.textContent = 'xx';
      w[ch] = Math.round((both - el.getBoundingClientRect().width) * 100) / 100;
    }
    el.remove();
    return w;
  }, { family: f.family, weight: f.weight, chars: CHARS });
}
await browser.close();
const file = path.join(ROOT, 'src', 'render', 'styles', 'metrics.json');
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`wrote ${file}: ${Object.keys(out).join(', ')}`);
