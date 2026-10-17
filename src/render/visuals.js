import { esc, he } from './html.js';
import { bestInk } from './color.js';

// The engine's own graphics: what a slide shows besides its words.
//
// A slide can carry one `visual`, written by the drafting model as data and drawn
// here: a timeline, stat bars, a head-to-head card, a big number, a calendar page,
// a pitch with the players in their places, kit colours, a fight record, the
// weight-class ladder, a product's stack, a funnel, price cards, a mock screen,
// the same screen drawn wrong and right (a do-dont).
// Each pack names the types that fit it (theme.json "visuals"). A visual is data,
// not a picture someone else made: nothing here is a logo, a crest, a screenshot
// or another page's image, and every number in it is held to the slide's quotes
// by the fact gate like the slide's own text (visualText).
//
// The cover always has a visual: a photograph when one passed the checks, else the
// cover graphic the model chose (coverVisual), else the art of the post's kind (an
// iceberg, a versus split, a calendar page, a podium, a silhouette...).
//
// Every size is in em of the .vis box, so the renderer's fit pass can shrink a
// graphic like a line of text, and a graphic that cannot fit refuses the slide.

const KINDS = {
  timeline: {
    items: [2, 5],
    about: 'a timeline: items in order, label = when (a year, a date, a minute like 67\', a round like "סיבוב 2"), value = what happened, a few words',
  },
  bars: { items: [2, 5], about: 'stat bars drawn to scale: title = what is measured, label = who or what, value = the number with its unit' },
  compare: { items: [2, 5], about: 'a head-to-head card: a and b = the two sides\' short names, each item: label = the stat, value = a\'s value, value2 = b\'s value' },
  stat: { items: [1, 1], about: 'one big number: value = the number with its unit, label = what it counts (a percentage is drawn as a ring)' },
  date: { items: [1, 1], about: 'a calendar page: label = the day and month in Hebrew ("6 באוקטובר"), value = the year' },
  pitch: {
    items: [3, 11],
    about: 'a pitch with players in their positions: title = the team or the moment, label = a player\'s name, value = a position code (GK, LB, CB, RB, LWB, RWB, DM, CM, LM, RM, AM, LW, RW, CF, ST)',
  },
  kit: { items: [1, 2], about: 'kit-colour blocks (colours only, never a crest): label = the club, value = its two kit colours as hex codes ("#C8102E #FFFFFF")' },
  record: { items: [1, 3], about: 'a fight record drawn as a bar: label = the fighter, value = wins-losses or wins-losses-draws ("27-1", "22-3-1")' },
  ladder: { items: [3, 6], about: 'the weight-class ladder, heaviest first: label = a class in Hebrew, value = its limit with the unit, sub = "*" on the class the slide is about and "" on the others' },
  stack: { items: [2, 5], about: 'a product\'s stack as layers from the top: label = the layer ("מודל", "שרת", "תשלומים"), value = the tool\'s own name, sub = its price as the source gives it, or ""' },
  funnel: { items: [3, 5], about: 'a funnel, widest first: label = the stage ("ביקרו", "נרשמו", "שילמו"), value = how many, as the source gives it' },
  pricing: { items: [2, 4], about: 'price cards: label = the plan, value = its price with unit and period ("$20 לחודש"), sub = what it includes in a few words' },
  mock: {
    items: [2, 5],
    about: 'a mock screen the account draws (never a real product\'s screenshot or logo): style = chat (label = who speaks, "אתם" or the tool, value = the line), terminal (label = a real command exactly as it is typed, value = what it prints, both in English letters: never a step described in words or a setting such as "CNAME" after the prompt sign; the Hebrew explanation goes in the text of the slide) or browser (title = the page, label and value = its fields)',
  },
  dodont: {
    items: [1, 6],
    about: 'the same small made-up screen drawn twice side by side, wrong then right (the design labels them "לא" and "כן"): style = app (a phone screen: a form, a settings page), web (a landing page), chat (a chat with an AI tool) or code (a code editor); title = what the screen is in a few Hebrew words ("טופס הרשמה") or ""; a and b = the wrong and the right side\'s background as hex codes, or "" for the screen\'s own; each item is one element, top to bottom: label = field (sub = the field\'s label; value and value2 = what is written inside it, "" for empty), button, heading, text, nav (value and value2 = where the logo sits: start or center), me or ai (a chat line: me is the user), line (a line of code, in English letters, at most 40 characters); value = the element on the wrong side, value2 = on the right side, "" where it is missing on that side; a value may open with a hex colour for that element on that side ("#0047FF שליחה"). The sides differ only where the rule is. No digits the slide\'s quotes do not hold: a card number is "XXXX XXXX XXXX"',
  },
};

/** What a do-dont screen is made of, and the colour a value may open with. */
const DD_ELEMENTS = ['field', 'button', 'heading', 'text', 'nav', 'me', 'ai', 'line'];
const DD_STYLES = ['app', 'web', 'chat', 'code'];
const ddPart = (s) => {
  const m = /^(#[0-9a-f]{6})\s*(.*)$/i.exec(String(s || '').trim());
  return m ? { color: m[1], text: m[2].trim() } : { color: '', text: String(s || '').trim() };
};

export const VISUAL_TYPES = Object.keys(KINDS);
export const DEFAULT_VISUALS = ['timeline', 'bars', 'compare', 'stat'];

/** The visual types a pack may use: its theme's list, or the default four; a pack with a do-dont format draws its two screens. */
export const visualsOf = (pack) => {
  const own = pack?.theme?.visuals?.length ? pack.theme.visuals.filter((t) => KINDS[t]) : DEFAULT_VISUALS;
  return (pack?.formats?.formats || []).some((f) => f.kind === 'do-dont') && !own.includes('dodont') ? [...own, 'dodont'] : own;
};

const POSITIONS = {
  GK: [50, 92], LB: [16, 74], LCB: [37, 78], CB: [50, 78], RCB: [63, 78], RB: [84, 74], LWB: [12, 62], RWB: [88, 62],
  DM: [50, 64], LDM: [38, 64], RDM: [62, 64], CM: [50, 52], LCM: [33, 54], RCM: [67, 54], LM: [14, 46], RM: [86, 46],
  AM: [50, 38], CAM: [50, 38], LW: [16, 24], RW: [84, 24], LF: [36, 18], RF: [64, 18], CF: [50, 16], ST: [50, 13], SS: [50, 26],
};
const HEX = /^#[0-9a-f]{6}$/i;

/** The schema of one visual, the same for every type (the API's structured output wants one shape). */
export const VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    style: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' }, value2: { type: 'string' }, sub: { type: 'string' } },
        required: ['label', 'value', 'value2', 'sub'],
        additionalProperties: false,
      },
    },
  },
  required: ['type', 'title', 'a', 'b', 'style', 'items'],
  additionalProperties: false,
};

/** A visual as the engine keeps it: trimmed, or null for none. */
export function normVisual(v) {
  const type = String(v?.type || '').trim().toLowerCase();
  if (!type || type === 'none' || !KINDS[type]) return type && type !== 'none' ? { type, bad: true, title: '', a: '', b: '', style: '', items: [] } : null;
  const t = (x) => String(x ?? '').trim();
  return {
    type, title: t(v.title), a: t(v.a), b: t(v.b), style: t(v.style).toLowerCase(),
    items: (v.items || []).map((it) => ({ label: type === 'dodont' ? t(it.label).toLowerCase() : t(it.label), value: t(it.value), value2: t(it.value2), sub: t(it.sub) })).filter((it) => it.label || it.value),
  };
}

/** The text of a visual the fact gate reads: everything but a kit's colours and a pitch's position codes. */
export function visualText(v) {
  if (!v || v.bad) return '';
  // A do-dont's screens: their words, without the element names, the colours and the logo's place.
  if (v.type === 'dodont') return [v.title, ...(v.items || []).flatMap((it) => [it.sub, ...(it.label === 'nav' ? [] : [ddPart(it.value).text, ddPart(it.value2).text])])].filter(Boolean).join(' ');
  const parts = [v.title, v.a, v.b];
  for (const it of v.items || []) {
    parts.push(it.label);
    if (v.type !== 'kit' && v.type !== 'pitch') parts.push(it.value);
    parts.push(it.value2, v.type === 'ladder' && it.sub === '*' ? '' : it.sub);
  }
  return parts.filter(Boolean).join(' ');
}

/** What is wrong with one visual, worded for the model's redraft. */
export function visualProblems(v, allowed, where) {
  if (!v) return [];
  if (v.bad || !allowed.includes(v.type)) return [`${where}: the visual type "${v.type}" is not one this account uses (${allowed.join(', ')}, or none)`];
  const out = [];
  const [lo, hi] = KINDS[v.type].items;
  if (v.items.length < lo || v.items.length > hi) out.push(`${where}: a ${v.type} visual has ${lo === hi ? lo : `${lo} to ${hi}`} items, it has ${v.items.length}`);
  v.items.forEach((it, i) => {
    // Room for a Hebrew stat name; the render's fit pass refuses what still does not fit.
    if ([...it.label].length > 44) out.push(`${where}: visual item ${i + 1}'s label is over 44 characters: shorten it`);
    if ([...it.value].length > (['mock', 'timeline', 'dodont'].includes(v.type) ? 80 : 32) || (v.type === 'dodont' && [...it.value2].length > 80)) out.push(`${where}: visual item ${i + 1}'s value is too long for a graphic: shorten it`);
    if ([...it.sub].length > 48) out.push(`${where}: visual item ${i + 1}'s sub is over 48 characters: shorten it`);
  });
  if (v.type === 'kit') v.items.forEach((it, i) => it.value.split(/[\s,]+/).filter(Boolean).every((c) => HEX.test(c)) || out.push(`${where}: kit item ${i + 1} needs its colours as hex codes ("#C8102E #FFFFFF")`));
  if (v.type === 'pitch') v.items.forEach((it, i) => POSITIONS[it.value.toUpperCase()] || out.push(`${where}: pitch item ${i + 1} needs a position code (${Object.keys(POSITIONS).join(', ')})`));
  if (v.type === 'record') v.items.forEach((it, i) => /^\d+\s*-\s*\d+(\s*-\s*\d+)?$/.test(it.value) || out.push(`${where}: record item ${i + 1} is wins-losses or wins-losses-draws ("27-1")`));
  if (v.type === 'compare' && !(v.a && v.b)) out.push(`${where}: a compare visual needs a and b (the two sides)`);
  if (v.type === 'compare' && v.items.some((it) => ![it.value, it.value2].every((x) => /[\p{L}\p{N}]/u.test(x)))) out.push(`${where}: every compare row needs both values, never a dash: drop a row one side does not have`);
  if ((v.type === 'bars' || v.type === 'funnel' || v.type === 'stat') && v.items.some((it) => numberOf(it.value) == null)) out.push(`${where}: every ${v.type} value needs a number`);
  if (v.type === 'mock' && !['chat', 'terminal', 'browser'].includes(v.style)) out.push(`${where}: a mock visual's style is chat, terminal or browser`);
  // A terminal holds what a terminal prints: Hebrew in it came out scrambled in a left-to-right screen, and "$ CNAME" or
  // "$ preview URL" after the prompt sign read as broken commands to every reader who knew none.
  if (v.type === 'mock' && v.style === 'terminal') {
    for (const it of v.items || []) {
      if (/[֐-׿]/.test(`${it.label || ''} ${it.value || ''}`)) out.push(`${where}: a terminal holds a command and what it prints, in English letters: "${it.label}" / "${it.value}" (the Hebrew explanation goes in the slide's text)`);
      else if (it.label && !/^(?:[a-z][\w.+-]*|\.\/\S+|[A-Z_][A-Z0-9_]*=\S*)(?:\s|$)/.test(String(it.label).trim())) out.push(`${where}: "${it.label}" is not a command a reader can type: a terminal line is a real command as it is typed`);
    }
  }
  if (v.type === 'dodont') {
    if (!DD_STYLES.includes(v.style)) out.push(`${where}: a dodont's style is ${DD_STYLES.join(', ')}`);
    for (const [side, c] of [['a', v.a], ['b', v.b]]) if (c && !HEX.test(c)) out.push(`${where}: a dodont's ${side} is a background colour as a hex code, or ""`);
    v.items.forEach((it, i) => {
      if (!DD_ELEMENTS.includes(it.label)) return out.push(`${where}: dodont item ${i + 1} is one of ${DD_ELEMENTS.join(', ')}, not "${it.label}"`);
      const [x, y] = [ddPart(it.value), ddPart(it.value2)];
      if (it.label === 'nav' && ![x.text, y.text].every((p) => ['start', 'center', ''].includes(p))) out.push(`${where}: a nav's values are where the logo sits: start or center`);
      if (it.label === 'field' && !it.sub) out.push(`${where}: dodont item ${i + 1}: a field needs its label in sub`);
      if (it.label === 'line' && /[֐-׿]/.test(`${x.text} ${y.text}`)) out.push(`${where}: a line of code is in English letters: "${x.text || y.text}"`);
      if (it.label === 'line' && [x.text, y.text].some((t) => [...t].length > 40)) out.push(`${where}: a line of code is at most 40 characters: shorten it`);
    });
    // The same screen twice is no lesson: the two sides differ where the rule is.
    if (v.items.every((it) => it.value === it.value2) && v.a === v.b) out.push(`${where}: the two sides of a dodont are the same: draw the wrong one and the right one`);
  }
  return out;
}

/** The prompt's lines about the visuals this pack can draw. */
export function visualsPrompt(pack) {
  return visualsOf(pack).map((t) => `  - ${t}: ${KINDS[t].about}`).join('\n');
}

/** The first number in a value ("1,234", "4.5%", "$20"), or null. */
export function numberOf(s) {
  const m = /(\d+(?:[.,]\d+)*)/.exec(String(s || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------- drawing */

const cell = (t) => (t ? he(t) : '');
const pct = (n, max) => Math.max(4, Math.round((100 * n) / Math.max(1e-9, max)));

const draw = {
  timeline: (v) => `<ol class="v-tl">${v.items.map((it) => `<li><b>${cell(it.label)}</b><span>${cell(it.value)}</span></li>`).join('')}</ol>`,
  bars: (v) => {
    const max = Math.max(...v.items.map((it) => numberOf(it.value) || 0));
    return `<div class="v-bars">${v.items.map((it, i) => `<div class="row${i === 0 ? ' first' : ''}"><div class="lab"><span>${cell(it.label)}</span><b>${cell(it.value)}</b></div><div class="track"><i style="width:${pct(numberOf(it.value) || 0, max)}%"></i></div></div>`).join('')}</div>`;
  },
  compare: (v) => `<div class="v-cmp"><div class="hd"><b class="a">${cell(v.a)}</b><span></span><b class="b">${cell(v.b)}</b></div>${v.items.map((it) => {
    const x = numberOf(it.value);
    const y = numberOf(it.value2);
    const win = x != null && y != null && x !== y ? (x > y ? 'a' : 'b') : '';
    return `<div class="r"><b class="a${win === 'a' ? ' w' : ''}">${cell(it.value)}</b><span>${cell(it.label)}</span><b class="b${win === 'b' ? ' w' : ''}">${cell(it.value2)}</b></div>`;
  }).join('')}</div>`,
  stat: (v) => {
    const it = v.items[0] || {};
    const n = numberOf(it.value);
    const ring = /%/.test(it.value) && n != null && n <= 100;
    const r = 44;
    const c = 2 * Math.PI * r;
    return `<div class="v-stat">${ring ? `<svg viewBox="0 0 100 100" class="ring" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="bg"/><circle cx="50" cy="50" r="${r}" class="fg" stroke-dasharray="${((c * n) / 100).toFixed(1)} ${c.toFixed(1)}"/></svg>` : ''}<b>${cell(it.value)}</b><span>${cell(it.label)}</span></div>`;
  },
  date: (v) => {
    const it = v.items[0] || {};
    const m = /^(\d{1,2})\s+(.+)$/.exec(it.label.replace(/^ב-?(?=\d)/, ''));
    return `<div class="v-date"><div class="top">${cell(m ? m[2].replace(/^ב(?=[א-ת])/, '') : it.label)}</div><b>${cell(m ? m[1] : '')}</b><span>${cell(it.value)}</span></div>`;
  },
  pitch: (v) => `<div class="v-pitch"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y="2" width="96" height="96" rx="2"/><line x1="2" y1="50" x2="98" y2="50"/><circle cx="50" cy="50" r="11"/><rect x="26" y="82" width="48" height="16"/><rect x="38" y="92" width="24" height="6"/><rect x="26" y="2" width="48" height="16"/><rect x="38" y="2" width="24" height="6"/></svg>${v.items.map((it) => {
    const [x, y] = POSITIONS[it.value.toUpperCase()] || [50, 50];
    return `<div class="pl" style="left:${x}%;top:${y}%"><i></i><span>${cell(it.label)}</span></div>`;
  }).join('')}${v.title ? `<div class="cap">${cell(v.title)}</div>` : ''}</div>`,
  kit: (v) => `<div class="v-kit">${v.items.map((it) => {
    const [c1, c2 = c1] = it.value.split(/[\s,]+/).filter((c) => HEX.test(c));
    return `<figure><svg viewBox="0 0 100 90" aria-hidden="true"><defs><clipPath id="k${esc(c1).slice(1)}"><path d="M30 4 L42 10 Q50 14 58 10 L70 4 L96 18 L86 38 L76 33 L76 88 L24 88 L24 33 L14 38 L4 18 Z"/></clipPath></defs><g clip-path="url(#k${esc(c1).slice(1)})"><rect width="100" height="90" fill="${c1}"/><rect x="38" width="8" height="90" fill="${c2}"/><rect x="54" width="8" height="90" fill="${c2}"/><rect y="0" width="100" height="8" fill="${c2}"/></g><path d="M30 4 L42 10 Q50 14 58 10 L70 4 L96 18 L86 38 L76 33 L76 88 L24 88 L24 33 L14 38 L4 18 Z" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/></svg><figcaption>${cell(it.label)}</figcaption></figure>`;
  }).join('')}</div>`,
  record: (v) => `<div class="v-rec">${v.items.map((it) => {
    const [w, l, d = 0] = it.value.split('-').map((x) => Number(x.trim()) || 0);
    const all = Math.max(1, w + l + d);
    return `<div class="row"><div class="lab"><span>${cell(it.label)}</span><b><bdi dir="ltr">${esc(it.value.replace(/\s+/g, ''))}</bdi></b></div><div class="track"><i class="w" style="width:${(100 * w) / all}%"></i><i class="l" style="width:${(100 * l) / all}%"></i>${d ? `<i class="d" style="width:${(100 * d) / all}%"></i>` : ''}</div><div class="key"><span class="w">ניצחונות ${w}</span><span class="l">הפסדים ${l}</span>${d ? `<span class="d">תיקו ${d}</span>` : ''}</div></div>`;
  }).join('')}</div>`,
  ladder: (v) => `<ol class="v-lad">${v.items.map((it) => `<li class="${it.sub === '*' ? 'on' : ''}"><span>${cell(it.label)}</span><b>${cell(it.value)}</b></li>`).join('')}</ol>`,
  stack: (v) => `<div class="v-stack">${v.items.map((it, i) => `<div class="layer" style="--i:${i}"><span>${cell(it.label)}</span><b>${cell(it.value)}</b>${it.sub ? `<em>${cell(it.sub)}</em>` : ''}</div>`).join('')}</div>`,
  funnel: (v) => {
    const max = Math.max(...v.items.map((it) => numberOf(it.value) || 0));
    return `<div class="v-fun">${v.items.map((it) => `<div class="st" style="width:${Math.max(58, pct(numberOf(it.value) || 0, max))}%"><span>${cell(it.label)}</span><b>${cell(it.value)}</b></div>`).join('')}</div>`;
  },
  pricing: (v) => `<div class="v-price n${v.items.length}">${v.items.map((it, i) => `<div class="tier${i === v.items.length - 1 ? ' top' : ''}"><span>${cell(it.label)}</span><b>${cell(it.value)}</b>${it.sub ? `<em>${cell(it.sub)}</em>` : ''}</div>`).join('')}</div>`,
  mock: (v) => {
    if (v.style === 'terminal') return `<div class="v-term"><div class="bar"><i></i><i></i><i></i></div><div class="screen" dir="ltr">${v.items.map((it) => `<div class="cmd"><em>$</em> <bdi dir="auto">${esc(it.label)}</bdi></div>${it.value ? `<div class="res"><bdi dir="auto">${esc(it.value)}</bdi></div>` : ''}`).join('')}</div></div>`;
    if (v.style === 'browser') return `<div class="v-web"><div class="bar"><i></i><i></i><i></i><span>${cell(v.title)}</span></div><div class="page">${v.items.map((it) => `<div class="field"><span>${cell(it.label)}</span><b>${cell(it.value)}</b></div>`).join('')}${v.b ? `<div class="btn">${cell(v.b)}</div>` : ''}</div></div>`;
    return `<div class="v-chat">${v.items.map((it, i) => `<div class="msg ${i % 2 ? 'them' : 'me'}"><span>${cell(it.label)}</span><p>${cell(it.value)}</p></div>`).join('')}</div>`;
  },
  // The wrong screen first (on the right, where a Hebrew reader starts), the right one beside it.
  dodont: (v) => {
    const el = (it, raw) => {
      const { color, text } = ddPart(raw);
      const ink = color ? ` style="color:${color}"` : '';
      if (it.label === 'field') return `<div class="fld"><span>${cell(it.sub)}</span><div class="in" dir="auto"${ink}>${text ? cell(text) : '&nbsp;'}</div></div>`;
      if (!raw) return '';
      if (it.label === 'nav') return `<div class="nav ${text === 'center' ? 'center' : 'start'}"><i></i><span></span><span></span><span></span></div>`;
      if (it.label === 'button') return `<div class="btn"${color ? ` style="background:${color};color:${bestInk(color, '#ffffff', '#111111')}"` : ''}>${text ? cell(text) : '&nbsp;'}</div>`;
      if (it.label === 'heading') return `<b class="hd" dir="auto"${ink}>${cell(text)}</b>`;
      if (it.label === 'line') return `<code dir="ltr"${ink}>${esc(text)}</code>`;
      if (it.label === 'me' || it.label === 'ai') return `<div class="msg ${it.label}" dir="auto">${cell(text)}</div>`;
      return `<p class="tx" dir="auto"${ink}>${cell(text)}</p>`;
    };
    const side = (ok) => {
      const bg = ok ? v.b : v.a;
      const ground = HEX.test(bg) ? ` style="background:${bg};color:${bestInk(bg, '#ffffff', '#1b1f24')}"` : '';
      const els = v.items.map((it) => el(it, ok ? it.value2 : it.value)).join('');
      return `<div class="side ${ok ? 'yes' : 'no'}"><div class="scr"${ground}>${v.style === 'web' ? '<div class="bar"><i></i><i></i><i></i></div>' : ''}${els}</div><div class="dd-tag">${ok ? DD_YES : DD_NO}<span>${ok ? 'כן' : 'לא'}</span></div></div>`;
    };
    return `<div class="v-dd st-${esc(v.style)}">${side(false)}${side(true)}</div>`;
  },
};

const DD_NO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>';
const DD_YES = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** One visual, drawn. `title` is shown above the graphic when the slide does not already say it. */
export function visualHtml(v, { showTitle = true } = {}) {
  if (!v || v.bad || !draw[v.type]) return '';
  const head = showTitle && v.title && !['pitch', 'mock'].includes(v.type) ? `<div class="v-title">${he(v.title)}</div>` : '';
  return `<div class="vis fit v-${v.type}-box">${head}${draw[v.type](v)}</div>`;
}

/* ---------------------------------------------------------------- the cover's art, by kind */

const SVG = {
  iceberg: '<svg viewBox="0 0 200 200" aria-hidden="true"><path d="M0 70 H200" class="sea"/><path d="M82 70 L100 30 L112 48 L122 40 L138 70 Z" class="tip"/><path d="M52 70 L138 70 L160 108 L146 150 L112 188 L70 176 L40 128 Z" class="under"/></svg>',
  podium: '<svg viewBox="0 0 200 140" aria-hidden="true"><rect x="70" y="20" width="60" height="120" rx="6" class="p1"/><rect x="10" y="56" width="58" height="84" rx="6" class="p2"/><rect x="132" y="80" width="58" height="60" rx="6" class="p3"/></svg>',
  who: '<b class="qbig">?</b>',
  flame: '<svg viewBox="0 0 200 200" aria-hidden="true"><path d="M100 10 C120 60 170 80 160 140 C152 182 120 196 100 196 C72 196 40 176 40 136 C40 100 70 86 76 52 C92 72 92 90 100 98 C108 72 110 40 100 10 Z" class="fl"/></svg>',
  split: '<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M0 0 H118 L82 120 H0 Z" class="sa"/><path d="M118 0 H200 V120 H82 Z" class="sb"/></svg>',
  stamp: '<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="10" y="14" width="180" height="92" rx="14" class="st"/><path d="M24 98 L176 22" class="x"/></svg>',
  arrow: '<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M10 30 H120" class="ln"/><path d="M120 30 C160 30 160 90 120 90 H40" class="ln"/><path d="M52 76 L36 90 L52 104" class="ln"/></svg>',
  frames: '<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="4" y="16" width="56" height="88" rx="8" class="f1"/><rect x="72" y="16" width="56" height="88" rx="8" class="f2"/><rect x="140" y="16" width="56" height="88" rx="8" class="f3"/></svg>',
  dodont: '<svg viewBox="0 0 200 130" aria-hidden="true"><rect x="4" y="8" width="88" height="114" rx="12" class="dn"/><rect x="108" y="8" width="88" height="114" rx="12" class="dy"/><circle cx="48" cy="65" r="24" class="cn"/><path d="M38 55 L58 75 M58 55 L38 75" class="mk"/><circle cx="152" cy="65" r="24" class="cy"/><path d="M140 66 L149 75 L165 57" class="mk"/></svg>',
  face: '<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="86" class="fc"/><circle cx="70" cy="84" r="10" class="ey"/><circle cx="130" cy="84" r="10" class="ey"/><path d="M58 122 Q100 160 142 122" class="mo"/></svg>',
};

const ART = { iceberg: 'iceberg', ranking: 'podium', 'guess-who': 'who', 'hot-take': 'flame', 'head-to-head': 'split', 'myth-fact': 'stamp', 'what-happened': 'arrow', story: 'frames', meme: 'face', 'do-dont': 'dodont', list: 'frames' };

/**
 * The cover's visual when there is no photograph: the model's cover graphic, or
 * the kind's own art (an on-this-day's calendar page from its date).
 */
export function coverVisualHtml(s) {
  const cv = s.coverVisual && !s.coverVisual.bad ? s.coverVisual : null;
  if (cv) return `<div class="cover-vis">${visualHtml(cv, { showTitle: false })}</div>`;
  if (s.postKind === 'on-this-day' && s.subject?.date) {
    const m = /^(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(String(s.subject.date).replace(/^ב-?/, ''));
    if (m) return `<div class="cover-vis">${visualHtml({ type: 'date', title: '', a: '', b: '', style: '', items: [{ label: `${m[1]} ${m[2]}`, value: m[3], value2: '', sub: '' }] })}</div>`;
  }
  // A meme's cover is its own card (the hook set as a meme), never a drawn face: every reader read the smiley as a bot's.
  if (s.postKind === 'meme') return '';
  const art = SVG[ART[s.postKind] || 'frames'];
  const names = s.postKind === 'head-to-head' && s.subject?.a && s.subject?.b ? `<div class="vs-names"><b class="a">${he(s.subject.a)}</b><b class="b">${he(s.subject.b)}</b></div>` : '';
  return `<div class="cover-vis art art-${ART[s.postKind] || 'frames'}">${art}${names}</div>`;
}

/** Does this content slide carry a visual: its own graphic, or a head-to-head stat's two values? */
export const slideHasVisual = (s) => Boolean((s.visual && !s.visual.bad) || s.role === 'stat' || s.photo);

export const VISUAL_CSS = `
.vis{display:flex;flex-direction:column;gap:.5em;font:500 38px/1.25 var(--text);color:var(--ink);min-height:0}
.vis>*{flex-shrink:0}
.s-tiktok .vis{font-size:54px}
.v-title{font:700 1em var(--text);color:var(--muted)}
.v-tl{list-style:none;display:flex;flex-direction:column;gap:.55em;position:relative;padding-inline-start:1.3em}
.v-tl::before{content:'';position:absolute;inset-inline-start:.38em;top:.4em;bottom:.4em;width:.16em;border-radius:.08em;background:rgba(var(--accent-rgb),.45)}
.v-tl li{position:relative;display:flex;gap:.6em;align-items:baseline}
.v-tl li::before{content:'';position:absolute;inset-inline-start:-1.16em;top:.32em;width:.62em;height:.62em;border-radius:50%;background:var(--accent);box-shadow:0 0 0 .18em var(--bg)}
.v-tl b{flex:none;min-width:3.4em;font:700 1.1em var(--headline);color:var(--accent)}
.v-tl span{font-size:.92em}
.v-bars{display:flex;flex-direction:column;gap:.6em}
.v-bars .lab,.v-rec .lab{display:flex;justify-content:space-between;align-items:baseline;gap:.6em;margin-bottom:.22em}
.v-bars .lab b{font:700 1.15em var(--headline);color:var(--accent)}
.v-bars .track,.v-rec .track{height:.72em;border-radius:.36em;background:rgba(var(--ink-rgb),.12);overflow:hidden;display:flex}
/* flex:none: the slide's progress track (.track i{flex:1}) would stretch every bar to full width. */
.v-bars .track i{display:block;flex:none;height:100%;border-radius:.36em;background:rgba(var(--accent-rgb),.8)}
.v-bars .first .track i{background:var(--accent)}
.v-cmp{display:flex;flex-direction:column;border-radius:var(--radius);overflow:hidden;border:.08em solid rgba(var(--ink-rgb),.16)}
.v-cmp .hd,.v-cmp .r{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr);overflow-wrap:normal;align-items:center;text-align:center;gap:.3em;padding:.42em .5em}
.v-cmp .hd{background:rgba(var(--ink-rgb),.08);font:700 1em var(--headline)}
.v-cmp .hd .a,.v-cmp .r .a.w{color:var(--accent)}
.v-cmp .hd .b,.v-cmp .r .b.w{color:var(--accent2)}
.v-cmp .r{border-top:.05em solid rgba(var(--ink-rgb),.12)}
.v-cmp .r b{font:700 1.15em var(--headline)}
.v-cmp .r span{font-size:.8em;color:var(--muted)}
.v-stat{display:flex;flex-direction:column;align-items:flex-start;gap:.15em;position:relative}
.v-stat b{font:700 3.6em/1 var(--headline);color:var(--accent)}
.v-stat span{font:600 1em var(--text);color:var(--muted)}
.v-stat .ring{width:4.6em;height:4.6em;transform:rotate(-90deg);margin-bottom:-.2em}
.v-stat .ring circle{fill:none;stroke-width:9}
.v-stat .ring .bg{stroke:rgba(var(--ink-rgb),.14)}
.v-stat .ring .fg{stroke:var(--accent);stroke-linecap:round}
.v-date{align-self:flex-start;width:6.2em;border-radius:.5em;overflow:hidden;background:var(--surface);border:.08em solid rgba(var(--ink-rgb),.14);display:flex;flex-direction:column;align-items:center;padding-bottom:.4em;box-shadow:0 .6em 1.4em rgba(0,0,0,.25)}
.v-date .top{align-self:stretch;text-align:center;background:var(--accent);color:var(--on-accent);font:700 .95em var(--text);padding:.3em 0}
.v-date b{font:700 3.2em/1.05 var(--headline);color:var(--ink)}
.v-date span{font:700 1.05em var(--text);color:var(--muted)}
.v-pitch{position:relative;width:100%;aspect-ratio:1/1.05;max-height:13em;align-self:center;background:linear-gradient(180deg,rgba(46,125,50,.55),rgba(27,94,32,.6));border-radius:.4em}
.s-instagram .v-pitch{max-height:9.4em;aspect-ratio:1.3/1}
.v-pitch svg{position:absolute;inset:0;width:100%;height:100%}
.v-pitch svg *{fill:none;stroke:rgba(255,255,255,.6);stroke-width:.5}
.v-pitch .pl{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:.1em;width:3.6em}
.v-pitch .pl i{width:.8em;height:.8em;border-radius:50%;background:var(--accent);border:.12em solid #fff}
.v-pitch .pl span{font:700 .56em/1.05 var(--text);color:#fff;text-align:center;text-shadow:0 .1em .3em rgba(0,0,0,.6)}
.v-pitch .cap{position:absolute;inset-inline-start:.5em;top:.4em;font:700 .7em var(--text);color:#fff}
.v-kit{display:flex;gap:1em;justify-content:center}
.v-kit figure{display:flex;flex-direction:column;align-items:center;gap:.3em;width:6.4em}
.v-kit svg{width:6.2em;height:5.6em;filter:drop-shadow(0 .3em .6em rgba(0,0,0,.35))}
.v-kit figcaption{font:700 .95em var(--text);text-align:center}
.v-rec{display:flex;flex-direction:column;gap:.7em}
.v-rec .lab b{font:700 1.15em var(--headline)}
.v-rec .track{height:.9em}
.v-rec .track i{display:block;flex:none;height:100%}
.v-rec i.w{background:var(--accent)}
.v-rec i.l{background:rgba(var(--ink-rgb),.35)}
.v-rec i.d{background:var(--accent2)}
.v-rec .key{display:flex;gap:1em;font:600 .72em var(--text);color:var(--muted);margin-top:.25em}
.v-lad{list-style:none;display:flex;flex-direction:column;gap:.25em}
.v-lad li{display:flex;justify-content:space-between;align-items:center;padding:.32em .7em;border-radius:.35em;background:rgba(var(--ink-rgb),.07);font-size:.9em}
.v-lad li b{font:700 1em var(--headline);color:var(--muted)}
.v-lad li.on{background:var(--accent);color:var(--on-accent);box-shadow:0 0 0 .1em rgba(var(--accent-rgb),.35);font-weight:700}
.v-lad li.on b{color:var(--on-accent)}
.v-stack{display:flex;flex-direction:column;gap:.3em}
.v-stack .layer{display:grid;grid-template-columns:1fr auto;grid-template-areas:'l v' 'l s';align-items:center;column-gap:.6em;padding:.45em .8em;border-radius:.4em;background:rgba(var(--accent-rgb),calc(.85 - var(--i) * .16));color:var(--on-accent);margin-inline:calc(var(--i) * .5em)}
.v-stack .layer span{grid-area:l;font:600 .9em var(--text)}
.v-stack .layer b{grid-area:v;font:700 1.05em var(--headline)}
.v-stack .layer em{grid-area:s;font:500 .7em var(--text);font-style:normal;opacity:.85}
.v-fun{display:flex;flex-direction:column;align-items:center;gap:.25em}
.v-fun .st{display:flex;justify-content:space-between;align-items:center;gap:.6em;padding:.45em 1.1em;white-space:nowrap;border-radius:.35em;background:var(--accent);color:var(--on-accent);clip-path:polygon(0 0,100% 0,96% 100%,4% 100%)}
.v-fun .st:nth-child(2){opacity:.85}
.v-fun .st:nth-child(3){opacity:.72}
.v-fun .st:nth-child(n+4){opacity:.6}
.v-fun .st b{font:700 1.1em var(--headline)}
.v-price{display:grid;gap:.5em}
.v-price.n2{grid-template-columns:repeat(2,minmax(0,1fr))}
.v-price.n3,.v-price.n4{grid-template-columns:repeat(2,minmax(0,1fr))}
.s-tiktok .v-price.n3{grid-template-columns:repeat(3,minmax(0,1fr))}
.v-price .tier{display:flex;flex-direction:column;gap:.2em;min-width:0;overflow-wrap:normal;padding:.6em .7em;border-radius:.5em;background:var(--surface);border:.08em solid rgba(var(--ink-rgb),.16)}
.v-price .tier.top{border-color:var(--accent);box-shadow:0 0 0 .08em var(--accent) inset}
.v-price .tier>*,.v-cmp .r>*,.v-cmp .hd>*{min-width:0}
.v-price .tier span{font:600 .85em var(--text);color:var(--muted)}
.v-price .tier b{font:700 1.3em var(--headline);color:var(--accent)}
.v-price .tier em{font:500 .72em var(--text);font-style:normal}
.v-term,.v-web{border-radius:.5em;overflow:hidden;border:.08em solid rgba(var(--ink-rgb),.2);box-shadow:0 .6em 1.4em rgba(0,0,0,.3)}
.v-term .bar,.v-web .bar{display:flex;align-items:center;gap:.3em;padding:.35em .6em;background:rgba(var(--ink-rgb),.12)}
.v-term .bar i,.v-web .bar i{width:.55em;height:.55em;border-radius:50%;background:rgba(var(--ink-rgb),.35)}
.v-web .bar span{margin-inline-start:.6em;font:600 .7em var(--text);color:var(--muted)}
.v-term .screen{background:#0d1117;color:#e6edf3;padding:.6em .8em;font:500 .78em/1.45 ui-monospace,Consolas,'DejaVu Sans Mono',monospace;text-align:left;display:flex;flex-direction:column;gap:.15em}
.v-term .cmd em{color:#7ee787;font-style:normal}
.v-term .res{color:#a5b3c2}
.v-web .page{background:var(--surface);padding:.7em .8em;display:flex;flex-direction:column;gap:.4em}
.v-web .field{display:flex;justify-content:space-between;gap:.6em;padding:.35em .5em;border-radius:.3em;background:rgba(var(--ink-rgb),.06);font-size:.85em}
.v-web .btn{align-self:flex-start;padding:.35em .9em;border-radius:.4em;background:var(--accent);color:var(--on-accent);font:700 .85em var(--text)}
.v-chat{display:flex;flex-direction:column;gap:.4em}
.v-chat .msg{max-width:88%;padding:.45em .7em;border-radius:.6em;display:flex;flex-direction:column;gap:.1em}
.v-chat .msg span{font:700 .62em var(--text);opacity:.75}
.v-chat .msg p{font-size:.86em}
.v-chat .me{align-self:flex-start;background:var(--accent);color:var(--on-accent);border-end-start-radius:.15em}
.v-chat .them{align-self:flex-end;background:var(--surface);border:.06em solid rgba(var(--ink-rgb),.16);border-end-end-radius:.15em}
.v-dd{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6em;align-items:stretch}
.s-tiktok .v-dd .scr{font-size:.66em}
.v-dd .no{--dd:#E5484D}
.v-dd .yes{--dd:#30A46C}
.v-dd .side{display:flex;flex-direction:column;align-items:stretch;gap:.35em;min-width:0}
.v-dd .scr{flex:1;display:flex;flex-direction:column;gap:.5em;min-height:6em;padding:.75em .7em;border-radius:.6em;overflow:hidden;background:#ffffff;color:#1b1f24;border:.16em solid var(--dd);box-shadow:0 .5em 1.2em rgba(0,0,0,.25);font:500 .62em/1.3 var(--text);overflow-wrap:anywhere}
.v-dd .dd-tag{align-self:center;display:flex;align-items:center;gap:.3em;font:700 1em var(--headline);color:var(--dd)}
.v-dd .dd-tag svg{width:1em;height:1em;flex:none}
.v-dd .bar{display:flex;gap:.3em;margin:-.75em -.7em .1em;padding:.45em .7em;background:#e9ecef}
.v-dd .bar i{width:.6em;height:.6em;border-radius:50%;background:#adb5bd}
.v-dd .fld{display:flex;flex-direction:column;gap:.3em}
.v-dd .fld span{font-weight:700;font-size:.92em}
.v-dd .in{padding:.6em .65em;border-radius:.4em;background:#f1f3f5;border:.06em solid #dee2e6;color:#868e96}
.v-dd .btn{padding:.6em;border-radius:.45em;background:#2f6bff;color:#ffffff;text-align:center;font-weight:700}
.v-dd .hd{font:700 1.3em/1.2 var(--text)}
.v-dd .tx{font-size:.95em}
.v-dd .nav{display:flex;align-items:center;gap:.4em;margin:-.75em -.7em .1em;padding:.55em .7em;background:rgba(47,107,255,.16)}
.v-dd .nav i{flex:none;width:1.6em;height:1.6em;border-radius:50%;background:#2f6bff}
.v-dd .nav span{flex:1;height:.32em;border-radius:.16em;background:rgba(47,107,255,.55)}
.v-dd .nav.center{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));justify-items:center;row-gap:.45em}
.v-dd .nav.center i{grid-column:1/-1}
.v-dd .nav.center span{width:100%}
.v-dd .msg{max-width:92%;padding:.5em .65em;border-radius:.7em}
.v-dd .msg.me{align-self:flex-start;background:#2f6bff;color:#ffffff;border-end-start-radius:.15em}
.v-dd .msg.ai{align-self:flex-end;background:#f1f3f5;color:#1b1f24;border-end-end-radius:.15em}
/* Code is read in long lines: its two screens stack, wrong above right, each the full width. */
.v-dd.st-code{grid-template-columns:minmax(0,1fr);gap:.35em}
.v-dd.st-code .side{flex-direction:row;align-items:center;gap:.5em}
.v-dd.st-code .scr{min-height:0;padding:.55em .7em}
.v-dd.st-code .dd-tag{flex:none;width:3em;justify-content:center}
.v-dd.st-code .scr{background:#0d1117;color:#e6edf3}
.v-dd code{display:block;text-align:left;font:500 .8em/1.45 ui-monospace,Consolas,'DejaVu Sans Mono',monospace;white-space:pre-wrap;overflow-wrap:break-word}
.cover-vis{flex:none}
.cover-vis .vis{font-size:44px}
.s-tiktok .cover-vis .vis{font-size:54px}
.cover-vis.art{position:relative;align-self:flex-start;width:420px;height:300px}
.s-tiktok .cover-vis.art{width:520px;height:380px}
.cover-vis.art svg{width:100%;height:100%;overflow:visible}
.art .sea{stroke:rgba(var(--ink-rgb),.5);stroke-width:2.5}
.art .tip{fill:var(--ink)}
.art .under{fill:rgba(var(--accent-rgb),.45)}
.art .p1{fill:var(--accent)}
.art .p2{fill:rgba(var(--accent-rgb),.6)}
.art .p3{fill:rgba(var(--accent-rgb),.35)}
.art-who{display:flex;align-items:center;justify-content:flex-start}
.art .qbig{font:700 380px/0.8 var(--display);color:var(--accent);text-shadow:0 18px 50px rgba(var(--accent-rgb),.35)}
.s-tiktok .art .qbig{font-size:470px}
.photo.blur{filter:brightness(.62) saturate(1.1);image-rendering:pixelated;object-position:50% 50%}
.art .fl{fill:var(--accent2)}
.art .sa{fill:var(--accent)}
.art .sb{fill:var(--accent2)}
.art .st{fill:none;stroke:var(--muted);stroke-width:8}
.art .x{stroke:var(--accent2);stroke-width:10;stroke-linecap:round}
.art .ln{fill:none;stroke:var(--accent);stroke-width:9;stroke-linecap:round;stroke-linejoin:round}
.art .f1{fill:rgba(var(--accent-rgb),.3)}
.art .f2{fill:rgba(var(--accent-rgb),.6)}
.art .f3{fill:var(--accent)}
.art .fc{fill:var(--accent)}
.art .ey{fill:var(--on-accent)}
.art .dn{fill:rgba(229,72,77,.16);stroke:#E5484D;stroke-width:4}
.art .dy{fill:rgba(48,164,108,.16);stroke:#30A46C;stroke-width:4}
.art .cn{fill:#E5484D}
.art .cy{fill:#30A46C}
.art .mk{fill:none;stroke:#fff;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.art .mo{fill:none;stroke:var(--on-accent);stroke-width:9;stroke-linecap:round}
.art-split .vs-names{position:absolute;inset:0;display:flex;justify-content:space-between;align-items:center;padding:0 6%;font:700 44px/1 var(--headline)}
.art-split .vs-names b{max-width:44%;color:var(--on-accent)}
.art-split .vs-names .b{color:var(--on-accent2)}
/* The photograph gives way first: a slide with a long text pushed a fixed-height card up over the page counter. */
.portrait{flex:0 1 520px;min-height:260px;position:relative;border-radius:var(--radius);overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.35)}
.s-instagram .portrait{flex-basis:380px;min-height:200px}
.portrait img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block}
.avatar{flex:none;width:180px;height:180px;border-radius:50%;overflow:hidden;border:6px solid var(--accent);box-shadow:0 16px 40px rgba(0,0,0,.35)}
.s-instagram .avatar{width:140px;height:140px}
.avatar img{width:100%;height:100%;object-fit:cover;object-position:50% 20%;display:block}
/* With a graphic, the title, the graphic and the text share the slide: their heights add up to what the
   frame holds (TikTok's about 1,150 px inside a panel, Instagram's about 900), and the fit pass shrinks each within it. */
body.has-vis .rtitle,body.has-vis .title{font-size:66px;max-height:200px}
body.has-vis .rbody,body.has-vis .body{font-size:38px;max-height:240px}
body.has-vis.s-tiktok .rtitle,body.has-vis.s-tiktok .title{font-size:80px;max-height:250px}
body.has-vis.s-tiktok .rbody,body.has-vis.s-tiktok .body{font-size:44px;max-height:300px}
body.has-vis.s-instagram .rtitle,body.has-vis.s-instagram .title{font-size:56px;max-height:160px}
body.has-vis.s-instagram .rbody,body.has-vis.s-instagram .body{font-size:34px;max-height:200px}
/* Beside a graphic, a text keeps its height and the graphic gives way: squeezed by the flex layout, a text box
   could shrink to nothing. */
body.has-vis .fit:not(.vis){flex-shrink:0}
body.has-vis .vis{max-height:600px}
body.has-vis.s-instagram .vis{max-height:420px}
body.has-vis .portrait{flex-basis:400px}
body.has-vis.s-instagram .portrait{flex-basis:280px}
/* A role's own big element shares the slide with a graphic: a place number, an answer, a myth, two values. */
body.has-vis .rank{font-size:170px}
body.has-vis.s-instagram .rank{font-size:120px}
body.has-vis .answer{font-size:96px;max-height:260px}
body.has-vis.s-instagram .answer{font-size:72px;max-height:180px}
body.has-vis .myth-text{font-size:70px;max-height:300px}
body.has-vis.s-instagram .myth-text{font-size:56px;max-height:200px}
body.has-vis .vs .val:not(.m):not(.l):not(.xl){font-size:92px}
body.has-vis.s-instagram .vs .val:not(.m):not(.l):not(.xl){font-size:70px}
body.has-vis .clue-n b{width:90px;height:90px;font-size:52px}
.brand{position:absolute;z-index:5;width:96px;height:96px;object-fit:contain;left:var(--pl);bottom:calc(var(--pb) - 120px)}
.s-tiktok .brand{top:calc(var(--pt) - 120px);bottom:auto}
`;
