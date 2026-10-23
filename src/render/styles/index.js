import { esc, he } from '../html.js';
import { fontFaces, headlineFaces } from '../fonts.js';
import { rgbList } from '../color.js';
import { VISUAL_CSS, visualHtml } from '../visuals.js';
import { zonesFor } from '../../rules/overlay.js';
import { familiesOf, resolveStyle, STYLES, themeColors } from './tokens.js';
import { displayText, slideModel, sourcesOf, textHtml } from './model.js';
import { BODY_FLOOR, STEP } from './fit.js';

// The four slide styles, drawn (tokens.js has what each one sets, model.js what each slide shows).
//
// A styled slide is its own page, not a template inside the shared one (html.js): none of the shared furniture
// comes with it. No outline or shadow on any letter, no progress bar, counter, dots or ghost numeral, no handle on
// a slide (TikTok draws its own), and no blurred photograph: a slide with no photograph of its own stands on the
// style's solid ground, its text moved up. Legibility comes from where the text sits: on the ground, on a card,
// under a fade into the ground, or over a flat dark layer.
//
// Every block of text is placed at the style's own position and kept out of the safe zones on all four sides
// (src/rules/overlay.js SAFE_ZONES). The renderer (src/render/render.js) then fits it: a headline is set smaller in
// steps to its floor before it takes another line, a block too tall for its room moves up where the style lets it
// (C and D, over their photograph's fade or by a shorter photograph), and what still does not fit is refused.

/** An account's look, with its style when it has one: what the renderer and the lock (src/render/style.js) take. */
export function themeOf(pack, name = null) {
  const spec = name ? { ...(pack.meta?.style || {}), name } : pack.meta?.style;
  if (!spec?.name || !STYLES[spec.name]) return pack.theme;
  const style = resolveStyle(spec, pack.theme?.colors?.accent);
  return { ...pack.theme, style: { name: style.name, colors: style.colors } };
}

/** The style a pack draws in, by name, or null for the older templates. */
export const styleNameOf = (pack) => (pack?.meta?.style?.name && STYLES[pack.meta.style.name] ? pack.meta.style.name : null);

/** The geometry of one platform: its height, its bands, and how the design's px (TikTok's) are scaled to it. */
export function geo(size, overlay = null) {
  const ig = size === 'instagram';
  const h = ig ? 1350 : 1920;
  const z = zonesFor(size, overlay, h);
  return { size, ig, w: 1080, h, z, limit: h - z.bottom, y: (v) => Math.round(ig ? v * 0.7 : v), hs: (px) => Math.round(ig ? px * 0.85 : px) };
}

const HEADS = new Set(['hook', 'title', 'ntitle']);

/** One text block the renderer fits: its size, its floor, the lines it may take, in data attributes. */
function txt(tag, cls, S, field, text, g, { highlight = '' } = {}) {
  const spec = S.text[field];
  if (!String(text || '').trim()) return '';
  const breaks = spec.breaks !== false;
  const px = HEADS.has(field) ? g.hs(spec.px) : spec.px;
  const floor = Math.round(HEADS.has(field) ? g.hs(spec.floor || spec.px * BODY_FLOOR) : spec.px * BODY_FLOOR);
  const writer = displayText(text, { breaks }).split('\n').length;
  const max = spec.lines || 99;
  const want = breaks ? Math.min(writer, max) : max;
  return `<${tag} class="sf ${cls}${breaks ? '' : ' nb'}" style="font-size:${px}px" data-px="${px}" data-floor="${floor}" data-max="${max}" data-want="${want}" data-step="${HEADS.has(field) ? STEP : 2}">${textHtml(text, { breaks, highlight })}</${tag}>`;
}

/** A number set large: it never breaks, and a long one is set smaller (down to 40%) to stay inside the slide. */
const bigNum = (num, px, cls = 'num') => `<b class="sf ${cls}" style="font-size:${px}px" data-px="${px}" data-floor="${Math.round(px * 0.4)}" data-max="1" data-want="1" data-step="8" dir="ltr">${he(num)}</b>`;

const photoHtml = (slide, cls = 'ph') => {
  if (slide.split) return `<div class="${cls} split"><img src="${slide.split[0]}" alt=""${pos(slide.splitPos?.[0])}><img src="${slide.split[1]}" alt=""${pos(slide.splitPos?.[1])}></div>`;
  return slide.photo ? `<img class="${cls}" src="${slide.photo}" alt=""${pos(slide.photoPos)}>` : '';
};
const pos = (p) => (p ? ` style="object-position:${esc(p)}"` : '');
const hasPhoto = (slide) => Boolean(slide.photo || slide.split);

const ctaHtml = (m) => (m.cta ? `<div class="cta">${he(m.cta)}</div>` : '');
const srcHtml = (slide) => {
  const s = sourcesOf(slide);
  return s ? `<div class="src">${s}</div>` : '';
};
const gfx = (m) => (m.visual ? `<div class="gfx">${visualHtml(m.visual)}</div>` : '');
const unitOf = (v) => (v ? [v.pre, v.post].filter(Boolean) : []);

/* ------------------------------------------------------------------------------------------------ A: editorial */

function drawA(m, slide, g, S) {
  const photo = hasPhoto(slide);
  if (m.kind === 'cover') {
    return {
      bt: photo ? g.y(260) : g.y(460),
      html: `${photoHtml(slide, 'ph full')}${photo ? '<div class="ov"></div><div class="shade"></div>' : ''}
${m.category ? `<div class="lbl">${he(m.category)}</div>` : ''}
<div class="blk cov${photo ? '' : ' mid'}">${txt('h1', 'hl', S, 'hook', m.hook, g, { highlight: m.highlight })}${txt('p', 'sub', S, 'sub', m.sub, g)}</div>`,
    };
  }
  if (m.kind === 'end') return endHtml(m, g, S);
  const label = m.label ? `<div class="lbl">${he(m.label)}</div>` : '';
  if (m.kind === 'number') {
    const v = m.value;
    const row = m.sides
      ? `<div class="sides">${m.sides.map((x) => `<div class="side"><span>${he(x.who)}</span>${bigNum(x.value, g.hs(104), 'num sm')}</div>`).join('')}</div>`
      : `<div class="nrow">${v.pre ? `<span class="unit">${he(v.pre)}</span>` : ''}${bigNum(v.num, g.hs(S.text.number.px))}${v.post ? `<span class="unit">${he(v.post)}</span>` : ''}</div>`;
    return {
      bt: photo ? g.y(660) : g.y(280),
      html: `${photoHtml(slide)}${photo ? '<div class="ov"></div><div class="shade"></div>' : ''}${label}
<div class="blk">${txt('h2', 'hl', S, 'ntitle', m.title, g, { highlight: m.highlight })}${m.meta ? `<div class="meta">${he(m.meta)}</div>` : ''}
<div class="card">${m.kicker ? `<div class="clbl">${he(m.kicker)}</div>` : ''}${row}${m.body ? `<i class="rule"></i>${txt('p', 'bd', S, 'body', m.body, g)}` : ''}</div>${ctaHtml(m)}${srcHtml(slide)}</div>`,
    };
  }
  return {
    bt: photo ? g.y(660) : g.y(280),
    html: `${photoHtml(slide)}${photo ? '<div class="ov"></div><div class="shade"></div>' : ''}${label}
<div class="blk">${txt('h2', 'hl', S, 'title', m.title, g, { highlight: m.highlight })}${gfx(m)}${m.list ? listHtml(m.body, S, g) : txt('p', 'bd', S, 'tbody', m.body, g)}${ctaHtml(m)}${srcHtml(slide)}</div>`,
  };
}

const CSS_A = (g, S) => `
.ph{height:${g.y(940)}px}
.ph.full{height:100%}
.ov{position:absolute;inset:0 0 auto 0;height:${g.y(940)}px;background:linear-gradient(to bottom,rgba(var(--bg-rgb),0) ${g.y(520)}px,rgba(var(--bg-rgb),1) ${g.y(940)}px)}
.k-cover .ov{height:100%;background:linear-gradient(to bottom,rgba(var(--bg-rgb),0) 35%,rgba(var(--bg-rgb),.92) 72%,rgba(var(--bg-rgb),1) 100%)}
.lbl{top:${g.y(152)}px;font:700 ${S.text.label.px}px/1.2 'Assistant';color:var(--accent)}
.blk{gap:${g.y(36)}px}
.blk.cov{justify-content:flex-end;bottom:${g.y(460)}px}
.blk.cov.mid{justify-content:center;top:${g.y(400)}px}
.hl{font-family:'Heebo';font-weight:900;letter-spacing:-1px;line-height:1.04}
.k-item .hl{line-height:1.05}
.hl mark.hi{color:var(--accent)}
.sub{font:700 ${S.text.sub.px}px/1.3 'Assistant';color:var(--accent)}
.meta{font:400 32px/1.35 'Assistant';color:var(--muted);margin-top:-${g.y(18)}px}
.card{background:var(--card);border:2px solid var(--card-border);border-radius:36px;padding:${g.ig ? 40 : 52}px;display:flex;flex-direction:column;gap:${g.y(28)}px}
.clbl{font:700 28px/1.2 'Assistant';color:var(--accent)}
.nrow{display:flex;align-items:baseline;gap:24px;flex-wrap:nowrap}
.num{font-family:'Heebo';font-weight:900;line-height:1;letter-spacing:-2px;white-space:nowrap;unicode-bidi:isolate}
.unit{font:600 44px/1.1 'Assistant';white-space:nowrap}
.sides{display:flex;gap:30px}
.side{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.side span{font:700 30px/1.2 'Assistant';color:var(--muted)}
.side+.side{padding-inline-start:30px;border-inline-start:2px solid var(--card-border)}
.rule{display:block;height:2px;background:var(--card-border)}
.bd{font-family:'Assistant';font-weight:400;line-height:1.45}
.k-item .blk>.bd{color:var(--fg)}
.cta{font:700 34px/1.3 'Assistant';color:var(--accent)}
.src{font:400 24px/1.3 'Assistant'}
.list li{font:400 36px/1.4 'Assistant'}
`;

/* -------------------------------------------------------------------------------------------------- B: poster */

function drawB(m, slide, g, S) {
  const photo = hasPhoto(slide);
  if (m.kind === 'cover') {
    return {
      bt: photo ? g.y(560) : g.y(380),
      html: `${photoHtml(slide, 'ph full')}${photo ? '<div class="ov" data-scrim data-min="0.45" data-max="0.7"></div>' : ''}
${m.category ? `<div class="lbl">${he(m.category)}</div>` : ''}
<div class="blk cov">${txt('h1', 'hl', S, 'hook', m.hook, g, { highlight: m.highlight })}${txt('p', 'sub', S, 'sub', m.sub, g)}</div>
<div class="cue">החליקו ←</div>`,
    };
  }
  if (m.kind === 'end') return endHtml(m, g, S);
  const label = [m.label, m.kind === 'number' ? m.kicker : ''].filter(Boolean).join(' · ');
  const top = label ? `<div class="lbl">${he(label)}</div>` : '';
  const framed = photo ? photoHtml(slide, 'fr') : '';
  if (m.kind === 'number') {
    const v = m.value;
    const big = m.sides
      ? `<div class="sides">${m.sides.map((x) => `<div class="side"><span>${he(x.who)}</span>${bigNum(x.value, g.hs(200))}</div>`).join('')}</div>`
      : `<div class="nrow">${bigNum(v.num, g.hs(S.text.number.px))}${unitOf(v).length ? `<span class="unit">${he(unitOf(v).join(' '))}</span>` : ''}</div>`;
    return {
      bt: g.y(260),
      html: `${top}<div class="blk">${big}${txt('div', 'cap', S, 'ntitle', m.title, g, { highlight: m.highlight })}${framed}${txt('p', 'bd', S, 'body', m.body, g)}${ctaHtml(m)}${srcHtml(slide)}</div>`,
    };
  }
  return {
    bt: g.y(260),
    html: `${top}<div class="blk">${txt('h2', 'hl', S, 'title', m.title, g, { highlight: m.highlight })}${framed || gfx(m)}${m.list ? listHtml(m.body, S, g) : txt('p', 'bd', S, 'tbody', m.body, g)}${ctaHtml(m)}${srcHtml(slide)}</div>`,
  };
}

const CSS_B = (g, S) => `
.ph.full{height:100%}
.ov{position:absolute;inset:0;background:rgba(10,10,10,var(--scrim,.45))}
.lbl{top:${g.y(152)}px;font:600 ${S.text.label.px}px/1.2 'Rubik';color:var(--accent)}
.blk{gap:${g.y(32)}px}
.blk.cov{gap:${g.y(40)}px;bottom:${g.z.bottom + 36 + g.y(28)}px}
.hl{font-family:'Karantina Headline';font-weight:700;line-height:.86;color:var(--fg)}
.k-item .hl{line-height:.9}
.hl mark.hi{background:var(--accent);color:var(--on-accent);padding:0 ${g.y(32)}px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.k-item .hl mark.hi{padding:0 ${g.y(24)}px}
.sub{font:600 ${S.text.sub.px}px/1.3 'Rubik';color:var(--fg)}
.cue{position:absolute;right:${g.z.right}px;bottom:${g.z.bottom}px;font:600 30px/1.2 'Rubik';color:var(--muted)}
.nrow{display:flex;align-items:baseline;gap:24px}
.num{font-family:'Karantina';font-weight:700;line-height:.8;color:var(--accent);white-space:nowrap;unicode-bidi:isolate}
.unit{font:800 56px/1.1 'Rubik';color:var(--accent);white-space:nowrap}
.sides{display:flex;gap:40px}
.side{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.side span{font:600 30px/1.2 'Rubik';color:var(--muted)}
.cap{font-family:'Rubik';font-weight:800;line-height:1.2;color:var(--fg)}
.cap mark.hi{background:var(--accent);color:var(--on-accent);padding:0 12px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.fr{display:block;width:100%;height:${g.y(480)}px;border-radius:12px;object-fit:cover;object-position:50% 30%}
.fr.split{display:flex;gap:6px;overflow:hidden}
.fr.split img{flex:1;min-width:0;object-fit:cover}
.bd{font-family:'Rubik';font-weight:400;line-height:1.45;color:var(--muted)}
.cta{font:700 36px/1.3 'Rubik';color:var(--accent)}
.src{font:400 24px/1.3 'Rubik'}
.list li{font:400 38px/1.4 'Rubik';color:var(--muted)}
`;

/* --------------------------------------------------------------------------------------------------- C: split */

function drawC(m, slide, g, S) {
  const photo = hasPhoto(slide);
  if (m.kind === 'cover') {
    return {
      bt: photo ? g.y(1160) : g.y(560),
      lift: photo ? g.y(860) : null,
      html: `${photoHtml(slide)}
<div class="blk cov${m.key ? ' keyed' : ''}"><i class="bar"></i>${txt('h1', 'hl', S, 'hook', m.hook, g, { highlight: m.highlight })}${txt('p', 'sub', S, 'sub', m.sub, g)}</div>
${m.key ? `<div class="key">${he(m.key)}</div>` : ''}`,
    };
  }
  if (m.kind === 'end') return endHtml(m, g, S);
  const chip = m.label ? `<div class="chip${photo ? '' : ' still'}">${he(m.label)}</div>` : '';
  const num = m.kind === 'number'
    ? m.sides
      ? `<div class="sides">${m.sides.map((x) => `<div class="side"><span>${he(x.who)}</span>${bigNum(x.value, g.hs(96))}</div>`).join('')}</div>`
      : `<div class="nrow">${m.value.pre ? `<span class="unit">${he(m.value.pre)}</span>` : ''}${bigNum(m.value.num, g.hs(S.text.number.px))}${m.value.post ? `<span class="unit">${he(m.value.post)}</span>` : ''}</div>`
    : '';
  const body = m.kind === 'number' ? txt('p', 'bd', S, 'body', m.body, g) : m.list ? listHtml(m.body, S, g) : txt('p', 'bd', S, 'tbody', m.body, g);
  return {
    bt: photo ? g.y(1000) : g.y(chip ? 360 : 260),
    lift: photo ? g.y(700) : null,
    html: `${photoHtml(slide)}${chip}
<div class="blk">${num}${txt('h2', 'hl', S, m.kind === 'number' ? 'ntitle' : 'title', m.title, g, { highlight: m.highlight })}${body}${m.kind === 'number' ? '' : gfx(m)}${ctaHtml(m)}${srcHtml(slide)}</div>`,
  };
}

const CSS_C = (g, S) => `
.ph{height:calc(var(--bt) - ${g.y(80)}px)}
.k-item .ph{height:calc(var(--bt) - ${g.y(120)}px)}
.blk{gap:${g.y(32)}px}
.blk.cov{gap:${g.y(36)}px}
.blk.cov.keyed{bottom:${g.z.bottom + 36 + g.y(20)}px}
.bar{display:block;width:96px;height:12px;background:var(--accent)}
.hl{font-family:'Rubik';font-weight:900;line-height:1.04;color:var(--fg)}
.k-item .hl{line-height:1.08}
.hl mark.hi{background:none;color:var(--accent)}
.sub{font:500 ${S.text.sub.px}px/1.35 'Rubik';color:var(--muted)}
.key{position:absolute;right:${g.z.right}px;left:${g.z.left}px;bottom:${g.z.bottom}px;font:800 30px/1.2 'Rubik';color:var(--accent)}
.chip{position:absolute;right:${g.z.right}px;top:calc(var(--bt) - ${g.y(192)}px);max-width:${1080 - g.z.left - g.z.right}px;font:900 ${g.hs(S.text.label.px)}px/1.2 'Rubik';color:#fff;background:var(--accent);padding:16px 36px;white-space:nowrap;overflow:hidden}
.chip.still{top:${g.y(180)}px}
.nrow{display:flex;align-items:baseline;gap:20px}
.num{font-family:'Rubik';font-weight:900;line-height:1;color:var(--accent);white-space:nowrap;unicode-bidi:isolate}
.unit{font:800 40px/1.1 'Rubik';color:var(--accent);white-space:nowrap}
.sides{display:flex;gap:40px}
.side{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.side span{font:700 30px/1.2 'Rubik';color:var(--muted)}
.bd{font-family:'Rubik';font-weight:400;line-height:1.5;color:var(--muted)}
.cta{font:800 34px/1.3 'Rubik';color:var(--accent)}
.src{font:400 24px/1.3 'Rubik'}
.list li{font:400 38px/1.45 'Rubik';color:var(--muted)}
`;

/* --------------------------------------------------------------------------------------------- D: native dark */

function drawD(m, slide, g, S) {
  const photo = hasPhoto(slide);
  if (m.kind === 'cover') {
    return {
      bt: photo ? g.y(880) : g.y(560),
      lift: photo ? g.y(560) : null,
      html: `${photoHtml(slide)}${photo ? '<div class="ov"></div>' : ''}
<div class="blk cov">${txt('h1', 'hl', S, 'hook', m.hook, g, { highlight: m.highlight })}${txt('p', 'sub', S, 'sub', m.sub, g)}<i class="bar"></i></div>`,
    };
  }
  if (m.kind === 'end') return endHtml(m, g, S);
  const chip = m.label ? `<span class="chip">${he(m.label)}</span>` : '';
  const num = m.kind === 'number'
    ? m.sides
      ? `<div class="sides">${m.sides.map((x) => `<div class="side"><span>${he(x.who)}</span>${bigNum(x.value, g.hs(150))}</div>`).join('')}</div>`
      : `<div class="nrow">${bigNum(m.value.num, g.hs(S.text.number.px))}${unitOf(m.value).length || m.kicker ? `<span class="unit">${he(unitOf(m.value).join(' ') || m.kicker)}</span>` : ''}</div>`
    : '';
  const body = m.kind === 'number' ? txt('p', 'bd', S, 'body', m.body, g) : m.list ? listHtml(m.body, S, g) : txt('p', 'bd', S, 'tbody', m.body, g);
  return {
    bt: photo ? g.y(800) : g.y(300),
    lift: photo ? g.y(420) : null,
    html: `${photoHtml(slide)}${photo ? '<div class="ov"></div>' : ''}
<div class="blk">${chip}${txt('h2', 'hl', S, m.kind === 'number' ? 'ntitle' : 'title', m.title, g, { highlight: m.highlight })}${num}${body}${m.kind === 'number' ? '' : gfx(m)}${ctaHtml(m)}${srcHtml(slide)}</div>`,
  };
}

const CSS_D = (g, S) => `
.ph{height:${g.y(1000)}px}
.k-cover .ph{height:${g.y(1120)}px}
.ov{position:absolute;inset:0 0 auto 0;height:${g.y(1000)}px;background:linear-gradient(to bottom,rgba(var(--bg-rgb),0) ${g.y(520)}px,rgba(var(--bg-rgb),1) ${g.y(1000)}px)}
.k-cover .ov{height:${g.y(1120)}px;background:linear-gradient(to bottom,rgba(var(--bg-rgb),0) ${g.y(560)}px,rgba(var(--bg-rgb),.92) ${g.y(1120)}px)}
.blk{gap:${g.y(28)}px}
.blk.cov{gap:${g.y(8)}px}
.hl{font-family:'Karantina Headline';font-weight:700;line-height:.9;color:var(--fg)}
.k-item .hl{line-height:.92}
.hl mark.hi{background:var(--accent);color:var(--on-accent);padding:0 ${g.y(20)}px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.sub{font:500 ${S.text.sub.px}px/1.4 'Rubik';color:var(--muted);margin-top:${g.y(28)}px}
.bar{display:block;width:88px;height:6px;background:var(--accent);margin-top:${g.y(20)}px}
.chip{align-self:flex-start;font:800 ${S.text.label.px}px/1.2 'Rubik';color:var(--on-accent);background:var(--accent);padding:6px 18px;white-space:nowrap}
.nrow{display:flex;align-items:baseline;gap:20px}
.num{font-family:'Karantina';font-weight:700;line-height:.9;color:var(--accent);white-space:nowrap;unicode-bidi:isolate}
.unit{font:800 38px/1.1 'Rubik';color:var(--fg);white-space:nowrap}
.sides{display:flex;gap:40px}
.side{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.side span{font:800 28px/1.2 'Rubik';color:var(--muted)}
.bd{font-family:'Rubik';font-weight:400;line-height:1.5;color:var(--muted)}
.cta{font:800 32px/1.3 'Rubik';color:var(--accent)}
.src{font:400 22px/1.3 'Rubik'}
.list li{font:400 32px/1.45 'Rubik';color:var(--muted)}
`;

/* --------------------------------------------------------------------------------------------- shared parts */

/** A body that is a list (places 10 to 6, an iceberg's layer): one item a line, as its kind is checked. */
function listHtml(body, S, g) {
  const ls = String(body || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return ls.length ? `<ul class="list">${ls.map((l) => `<li>${he(displayText(l))}</li>`).join('')}</ul>` : '';
}

/** The closing slide: its line, and the handle the account is followed at. */
function endHtml(m, g, S) {
  return {
    bt: g.y(560),
    html: `<div class="blk">${txt('h2', 'hl', S, 'title', m.title, g)}${txt('p', 'sub', S, 'sub', m.body, g)}<div class="handle"><bdi dir="ltr">@${esc(m.handle)}</bdi></div></div>`,
  };
}

const DRAW = { A: drawA, B: drawB, C: drawC, D: drawD };
const CSS = { A: CSS_A, B: CSS_B, C: CSS_C, D: CSS_D };

const base = (g, c, S) => `
:root{
  --bg:${c.bg}; --fg:${c.text}; --muted:${c.muted}; --accent:${c.accent}; --on-accent:${c.onAccent};
  --card:${c.card || c.bg}; --card-border:${c.cardBorder || 'transparent'};
  --bg-rgb:${rgbList(c.bg)}; --ink:${c.text}; --ink-rgb:${rgbList(c.text)}; --accent-rgb:${rgbList(c.accent)};
  --accent2:${c.muted}; --accent2-rgb:${rgbList(c.muted)}; --on-accent2:${c.bg}; --surface:${c.card || c.bg};
  --text:'${S.text.tbody.family}'; --headline:'${S.text.title.family}'; --display:'${S.text.title.family}'; --radius:${S.name === 'B' ? 12 : 28}px;
  --pt:${g.z.top}px; --pb:${g.z.bottom}px; --pr:${g.z.right}px; --pl:${g.z.left}px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:${g.h}px;overflow:hidden}
body{direction:rtl;text-align:right;background:var(--bg);color:var(--fg);font-family:var(--text),sans-serif;-webkit-font-smoothing:antialiased;font-kerning:normal;position:relative}
bdi{unicode-bidi:isolate}
.probe{position:absolute;top:-400px;left:-400px;font:700 40px 'Rubik';color:transparent}
.ph{position:absolute;top:0;left:0;width:100%;object-fit:cover;object-position:50% 30%;display:block}
.ph.split{display:flex;gap:6px;overflow:hidden}
.ph.split img{flex:1;min-width:0;height:100%;object-fit:cover}
/* The labels over a photograph's top: a dark band from the top edge, not a shadow on the letters. */
.shade{position:absolute;inset:0 0 auto 0;height:${g.y(340)}px;background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,0))}
.lbl{position:absolute;right:${g.z.right}px;left:${g.z.left}px;white-space:nowrap;overflow:hidden}
.blk{position:absolute;right:${g.z.right}px;left:${g.z.left}px;top:var(--bt);bottom:${g.z.bottom}px;display:flex;flex-direction:column}
.blk>*{flex:none}
.blk>.gfx{flex:0 1 auto;min-height:0;display:flex;flex-direction:column}
.gfx>.vis{flex:1 1 auto;min-height:0}
.sf{white-space:pre-line;text-wrap:balance;overflow-wrap:normal;word-break:keep-all}
.sf.nb{white-space:normal}
mark.hi{color:inherit;background:none}
.src{color:var(--muted)}
.list{list-style:none;display:flex;flex-direction:column;gap:14px}
.handle{font:700 48px/1.2 var(--text);color:var(--accent)}
/* No outline and no shadow on any letter, the shared graphics' included: the text reads by where it sits. */
.st *{text-shadow:none!important;-webkit-text-stroke:0!important}
/* A slide with no photograph: its text moves up, into the middle of the room the photograph left. */
.no-photo:not(.k-cover) .blk{justify-content:center}
.s-instagram .vis{font-size:38px}
`;

/** The whole page of one styled slide. `slide.photo` (or `slide.split`) is its own photograph, when it has one. */
export function stylePage({ theme, size, slide, overlay = null }) {
  const st = theme.style;
  const S = STYLES[st.name];
  const g = geo(size, overlay);
  const m = slideModel(slide);
  const d = DRAW[st.name](m, slide, g, S);
  const families = familiesOf(st.name);
  const karantina = families.includes('Karantina');
  const z = g.z;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>${esc(slide.title || slide.hook || '')}</title>
<style>
${fontFaces(families)}
${karantina ? headlineFaces('Karantina') : ''}
${base(g, st.colors, S)}
${CSS[st.name](g, S)}
${VISUAL_CSS}
</style></head>
<body class="st st-${st.name} k-${slide.kind === 'cover' ? 'cover' : slide.kind === 'end' ? 'end' : 'item'} s-${size}${hasPhoto(slide) ? ' has-photo' : ' no-photo'}" style="--bt:${d.bt}px" data-style="${st.name}" data-safe="${z.top},${z.right},${z.bottom},${z.left}"${d.lift != null ? ` data-lift="${d.lift}"` : ''} data-outline="0">
${d.html}
<div class="probe">א</div>
</body></html>`;
}

export { STYLES, resolveStyle, themeColors };
