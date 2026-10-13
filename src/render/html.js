import { bestInk, rgbList } from './color.js';
import { fontFaces } from './fonts.js';

// The page every slide is drawn on, whatever the template.
//
// HARD RULE 8: right to left at the root, lang="he", so bidi resolves once and
// every run inherits it. A Latin run inside a Hebrew line (a product name, a
// number with a unit) is isolated with <bdi> so neighbouring punctuation stays on
// the right side of it.
//
// Two sizes, one design: TikTok is 1080x1920 with safe zones for the player's
// own furniture (the search bar on top, the caption and the button rail at the
// bottom and on the right); Instagram is 1080x1350, what the feed crops to.

export const SIZES = {
  tiktok: { w: 1080, h: 1920, pad: { top: 210, bottom: 430, right: 150, left: 90 } },
  instagram: { w: 1080, h: 1350, pad: { top: 96, bottom: 96, right: 92, left: 92 } },
};

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LATIN_RUN = /([A-Za-z][A-Za-z0-9 .+#&:/_-]*[A-Za-z0-9+#]|[A-Za-z])/;

/**
 * Escape, and isolate every Latin run so bidi cannot reorder punctuation around it.
 * The runs are found in the raw text and each piece escaped after: finding them in
 * escaped text would wrap the "quot" of &quot; and break ש"ח, צה"ל or AT&T.
 */
export function he(text) {
  return String(text ?? '')
    .split(LATIN_RUN)
    .map((part, i) => (i % 2 ? `<bdi>${esc(part)}</bdi>` : esc(part)))
    .join('');
}

/** The first number in a text with its unit, for templates that set one large. */
export function leadNumber(text) {
  const m = /(₪\s?)?(\d+(?:[.,]\d+)*)(\s?%|\s?₪)?/.exec(String(text || ''));
  return m ? { value: m[2], pre: (m[1] || '').trim(), post: (m[3] || '').trim() } : null;
}

export const two = (n) => String(n).padStart(2, '0');

/** Inline icons, drawn here so nothing is fetched. */
export const ICON = {
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 7h-4.5v9h-5v-9H5z" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" fill="currentColor"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C9 4 4 9.5 4 16c0 1.5.3 2.8.8 4 1.2-4.6 4.6-8.5 9.2-10.5-3.7 2.6-6.3 6.4-7 10.8C8.2 21 9.8 21.4 11.5 21.4 17.4 21.4 20 15.5 20 4z" fill="currentColor"/></svg>',
  ball: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.2l3.3 2.4-1.3 3.9H10l-1.3-3.9z" fill="currentColor"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

/** :root variables from a theme, shared by every template. */
export function rootCss(theme, size) {
  const c = theme.colors;
  const geo = SIZES[size];
  const onAccent = c.onAccent || bestInk(c.accent, c.ink, c.bg);
  const onAccent2 = bestInk(c.accent2, c.ink, c.bg);
  return `
:root{
  --w:${geo.w}px; --h:${geo.h}px;
  --pt:${geo.pad.top}px; --pb:${geo.pad.bottom}px; --pr:${geo.pad.right}px; --pl:${geo.pad.left}px;
  --bg:${c.bg}; --surface:${c.surface}; --ink:${c.ink}; --muted:${c.muted}; --accent:${c.accent}; --accent2:${c.accent2};
  --on-accent:${onAccent}; --on-accent2:${onAccent2};
  --bg-rgb:${rgbList(c.bg)}; --ink-rgb:${rgbList(c.ink)}; --accent-rgb:${rgbList(c.accent)}; --accent2-rgb:${rgbList(c.accent2)};
  --display:'${theme.fonts.display}'; --text:'${theme.fonts.text}';
  --radius:${Number(theme.options?.radius ?? 28)}px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--w);height:var(--h);overflow:hidden}
body{direction:rtl;text-align:right;background:var(--bg);color:var(--ink);font-family:var(--text),'Heebo',sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:'kern' 1;position:relative}
bdi{unicode-bidi:isolate}
.frame{position:absolute;inset:0;padding:var(--pt) var(--pr) var(--pb) var(--pl);display:flex;flex-direction:column}
.fit{overflow:hidden}
.probe{position:absolute;top:-400px;left:-400px;font-family:'Heebo';font-weight:700;font-size:40px;color:transparent}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:linear-gradient(to top, rgba(8,10,14,var(--scrim,0.82)) 0%, rgba(8,10,14,calc(var(--scrim,0.82)*0.85)) 45%, rgba(8,10,14,0) 85%)}
.icon svg{width:100%;height:100%;display:block}
body.has-photo{--ink:#ffffff;--muted:rgba(255,255,255,.84);--ink-rgb:255,255,255;color:#fff}
body.has-photo .frame{z-index:2}
`;
}

/** The whole page for one slide. `parts` is what a template returns. */
export function page({ theme, size, slide, parts, photo }) {
  const families = [theme.fonts.display, theme.fonts.text, 'Heebo'];
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>${esc(slide.title || slide.hook || '')}</title>
<style>
${fontFaces(families)}
${rootCss(theme, size)}
${parts.css}
</style></head>
<body class="t-${theme.template} v-${theme.variant || 'a'} k-${slide.kind} s-${size}${photo ? ' has-photo' : ''}">
${photo ? `<img class="photo" src="${photo}" alt=""><div class="scrim" data-scrim></div>` : ''}
${parts.html}
<div class="probe">א</div>
</body></html>`;
}

/** "מקור: X" under a slide, from its facts' sources. */
export function sourceLine(slide) {
  const names = [...new Set((slide.sources || []).filter(Boolean))];
  // Each name is one isolated run with its own direction: "Wikipedia (English)"
  // must not have its parenthesis pulled across a Latin word by the Hebrew line.
  return names.length ? `<div class="src">מקור: ${names.map((n) => `<bdi dir="auto">${esc(n)}</bdi>`).join(' · ')}</div>` : '';
}

/** The counter on a content slide: "2/5". */
export const counter = (slide) => (slide.kind === 'item' ? `<div class="count"><bdi>${slide.n}/${slide.of}</bdi></div>` : '');
