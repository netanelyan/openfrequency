import { chromium } from 'playwright';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../core/paths.js';
import { tokenOf } from '../verify/claims.js';
import { page, SIZES } from './html.js';
import { buildSlide } from './templates/index.js';

// Slides to JPEG, through headless Chromium, because Hebrew needs real
// bidirectional layout and shaping and the browser is the thing that has it.
//
// What the renderer refuses, rather than quietly drawing:
//   - a post whose text does not hash to the token the fact gate issued
//     (HARD RULE 3: nothing is rendered that was not checked)
//   - a page whose fonts did not load (Hebrew would come out as tofu boxes, or
//     silently in a fallback face)
//   - a text block that still overflows at the smallest size the fit pass allows
//     (a cut line is a post nobody can act on after it is published)
//
// The render context has no network at all: every request is aborted, so a slide
// can only draw what was inlined into it (fonts and the photograph as data URIs).
//
// The legibility gate: theme colours are checked for contrast when the pack is
// validated; a photograph is measured here, and the scrim over it is set to the
// alpha that gets white type to 7:1 over the brightest patch where the type sits.

let browserPromise = null;
let idle = null;

export function getBrowser() {
  browserPromise ??= chromium.launch({ args: ['--font-render-hinting=none'] });
  return browserPromise;
}

export async function closeBrowser() {
  if (idle) clearTimeout(idle);
  idle = null;
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

function keepWarm() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => closeBrowser(), 120_000);
  idle.unref?.();
}

export class RenderError extends Error {
  constructor(message, code = 'render') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

const FIT_FLOOR = 0.6;

/** One HTML page to one JPEG. Returns { file, fitted }. */
export async function renderHtml(html, { size, file }) {
  const geo = SIZES[size];
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: geo.w, height: geo.h }, deviceScaleFactor: 1, locale: 'he-IL', javaScriptEnabled: true });
  await context.route('**/*', (route) => route.abort());
  const tab = await context.newPage();
  try {
    await tab.setContent(html, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);

    // Every declared face must load, and Hebrew set in it must measure differently
    // from Hebrew set in a face that cannot exist. document.fonts.check() is not
    // enough: it answers true when ANY face, fallback included, can draw the text.
    const font = await tab.evaluate(async () => {
      const faces = [...document.fonts];
      await Promise.all(faces.map((f) => f.load().catch(() => null)));
      const measure = (family) => {
        const el = document.createElement('span');
        el.textContent = 'בדיקת גופן בעברית 123';
        el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:700 100px ${family}`;
        document.body.appendChild(el);
        const w = el.getBoundingClientRect().width;
        el.remove();
        return w;
      };
      const families = [...new Set(faces.map((f) => f.family.replace(/['"]/g, '')))];
      return {
        broken: faces.filter((f) => f.status !== 'loaded').map((f) => `${f.family} ${f.weight}`),
        same: families.filter((fam) => Math.abs(measure(`'${fam}'`) - measure("'__no_such_font__'")) < 0.5),
      };
    });
    if (font.broken.length || font.same.length) {
      throw new RenderError(`fonts did not load (${[...font.broken, ...font.same].join(', ')}): refusing to render, the Hebrew would not be ours`, 'fonts');
    }

    // A photograph: measure the brightest band where the text sits and set the scrim.
    await tab.evaluate(() => {
      const img = document.querySelector('img.photo');
      const scrim = document.querySelector('[data-scrim]');
      if (!img || !scrim) return;
      const W = 54;
      const H = Math.round((W * innerHeight) / innerWidth);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      const r = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      g.drawImage(img, (W - img.naturalWidth * r) / 2, (H - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r);
      const d = g.getImageData(0, 0, W, H).data;
      const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      // The text lives in the lower 70% on a photo cover; take the brightest
      // window one line tall across it.
      let worst = 0;
      const winH = Math.max(1, Math.round(H * 0.06));
      for (let y = Math.round(H * 0.3); y + winH <= H; y++) {
        for (let x0 = 0; x0 < W; x0 += Math.round(W / 4)) {
          let s = 0;
          let n = 0;
          for (let yy = y; yy < y + winH; yy++) for (let x = x0; x < Math.min(W, x0 + W / 2); x++) (s += lum((yy * W + x) * 4)), n++;
          worst = Math.max(worst, s / n);
        }
      }
      // White text over (1 - a) * L + a * scrim(~0.003) must reach 7:1:  1.05 / (L' + 0.05) >= 7
      const want = 1.05 / 7 - 0.05;
      const a = worst <= want ? 0.35 : Math.min(0.96, (worst - want) / (worst - 0.003));
      scrim.style.setProperty('--scrim', String(Math.max(0.35, a).toFixed(2)));
      document.body.dataset.scrim = String(a.toFixed(2));
    });

    // Shrink any block that overflows, 2% a step, down to the floor.
    const fitted = await tab.evaluate((floor) => {
      const over = (el) => el.scrollHeight - el.clientHeight > Math.max(2, (parseFloat(getComputedStyle(el).lineHeight) || 40) * 0.3);
      const out = [];
      for (const el of document.querySelectorAll('.fit')) {
        if (!over(el)) continue;
        const from = parseFloat(getComputedStyle(el).fontSize);
        let px = from;
        while (over(el) && px > from * floor) {
          px *= 0.98;
          el.style.fontSize = `${px}px`;
        }
        out.push({ text: el.textContent.trim().slice(0, 40), from: Math.round(from), to: Math.round(px), fits: !over(el) });
      }
      return out;
    }, FIT_FLOOR);
    const failed = fitted.filter((f) => !f.fits);
    if (failed.length) throw new RenderError(`too long for the slide even at ${Math.round(FIT_FLOOR * 100)}% size: "${failed[0].text}..."`, 'overflow');

    const dir = await tab.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    if (dir[0] !== 'rtl' || dir[1] !== 'he') throw new RenderError('the slide is not right to left Hebrew', 'rtl');

    const buf = await tab.screenshot({ type: 'jpeg', quality: 90 });
    ensureDir(path.dirname(file));
    writeFileSync(`${file}.tmp`, buf);
    renameSync(`${file}.tmp`, file);
    return { file, fitted, bytes: buf.length };
  } finally {
    await context.close().catch(() => {});
    keepWarm();
  }
}

/**
 * Render every slide of a post for every platform of its pack.
 * post: { id, hook, sub, caption, token }; slides: [{ kind, title, body, factKeys, sources }];
 * photo: an image row (with .file) for the cover, or null.
 * Returns { tiktok: [files], instagram: [files] }.
 */
export async function renderPost({ pack, post, slides, photo = null, outDir }) {
  const expected = tokenOf({ slides, caption: post.caption, hook: post.hook, sub: post.sub });
  if (!post.token || post.token !== expected) {
    throw new RenderError('refused: this text was not checked by the fact gate (or changed after it)', 'unverified');
  }
  const photoUri = photo?.file ? `data:image/jpeg;base64,${readFileSync(photo.file).toString('base64')}` : null;
  const items = slides.filter((s) => s.kind === 'item').length;
  const out = {};
  for (const size of pack.meta.platforms) {
    out[size] = [];
    let n = 0;
    for (const [i, s] of slides.entries()) {
      if (s.kind === 'item') n++;
      const slide = {
        ...s,
        hook: post.hook,
        sub: post.sub,
        n,
        of: items,
        handle: pack.meta.handle,
        displayName: pack.meta.displayName,
      };
      const usePhoto = s.kind === 'cover' && photoUri && pack.theme.options?.coverPhoto !== false;
      const html = page({ theme: pack.theme, size, slide, parts: buildSlide(pack.theme, slide), photo: usePhoto ? photoUri : null });
      const file = path.join(outDir, `${size}-${String(i + 1).padStart(2, '0')}.jpg`);
      await renderHtml(html, { size, file });
      out[size].push(file);
    }
  }
  return out;
}
