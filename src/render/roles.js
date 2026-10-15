import { esc, he, ICON, sourceLine, two } from './html.js';
import { coverVisualHtml, visualHtml } from './visuals.js';

// The parts of a slide that come from its role in the post's kind (src/formats/
// kinds.js): a head-to-head's two values, a ranking's place, an iceberg's depth,
// a clue's number, a myth's stamp, the call to action on the last slide. Shared
// by every template and drawn only with the theme's variables (--accent,
// --display...), so a versus card looks like a different brand in each pack.
//
// Everything a role draws that is not the post's own text is a fixed Hebrew
// label written here ("רמז", "מיתוס", "דעה"), never a claim: the place numbers of
// a ranking and the depth of a layer are the post's structure, which is why the
// model is told never to write them.

export const ROLE_LABEL = {
  then: 'אז',
  turn: 'התפנית',
  now: 'היום',
  context: 'הרקע',
  moment: 'הרגע',
  after: 'מה קרה אחרי',
  myth: 'מיתוס',
  fact: 'עובדה',
  truth: 'בלי צחוק',
  verdict: 'השורה התחתונה',
  reveal: 'התשובה',
};

const DEPTH = ['על פני המים', 'קצת מתחת', 'מתחילים לצלול', 'עמוק', 'ממש עמוק', 'הקרקעית'];

/** The depth label of a layer, the last one always the bottom. */
export const depthLabel = (n, of) => (n === of ? DEPTH[DEPTH.length - 1] : DEPTH[Math.min(n - 1, DEPTH.length - 2)]);

const CTA_ICON = {
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>',
  save: ICON.bookmark,
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 21 3l-6.5 18-3.2-7.3z" fill="currentColor"/></svg>',
};

export const ROLE_CSS = `
.rtag{align-self:flex-start;display:inline-flex;align-items:center;gap:12px;padding:10px 24px;border-radius:999px;font:700 30px var(--text);background:rgba(var(--accent-rgb),.16);color:var(--ink);border:2px solid rgba(var(--accent-rgb),.55)}
.rtag.alt{background:rgba(var(--accent2-rgb),.16);border-color:rgba(var(--accent2-rgb),.6)}
.rtag.solid{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.rtitle{font:700 84px/1.06 var(--display);max-height:330px}
.s-instagram .rtitle{font-size:72px;max-height:250px}
.rbody{font:400 44px/1.45 var(--text);max-height:500px}
.s-instagram .rbody{font-size:40px;max-height:300px}
/* TikTok's slide is tall: the text takes the room rather than floating in it. */
.s-tiktok .rtitle{font-size:96px;max-height:420px}
.s-tiktok .rbody{font-size:50px;max-height:640px}
.s-tiktok .lines li{font-size:46px}
.lines{list-style:none;display:flex;flex-direction:column;gap:22px;max-height:640px}
.s-instagram .lines{max-height:420px;gap:16px}
.lines li{font:400 42px/1.38 var(--text);padding-inline-start:34px;position:relative}
.s-instagram .lines li{font-size:37px}
.lines li::before{content:'';position:absolute;inset-inline-start:0;top:.55em;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.vs{display:flex;flex-direction:column;gap:24px;padding:36px 36px 32px;border-radius:var(--radius);background:linear-gradient(180deg,rgba(var(--ink-rgb),.09),rgba(var(--ink-rgb),.03));border:2px solid rgba(var(--ink-rgb),.12);box-shadow:0 18px 50px rgba(0,0,0,.25)}
.vs .row{display:flex;align-items:flex-end;gap:18px}
.vs .side{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.vs .side.b{align-items:flex-end;text-align:left}
.vs .val{font:800 132px/0.95 var(--headline);color:var(--accent);unicode-bidi:isolate;overflow-wrap:normal;word-break:keep-all;hyphens:none;max-height:260px}
.vs .side.b .val{text-align:left}
.vs .bar{display:flex;gap:6px;height:16px;border-radius:8px;overflow:hidden}
.vs .bar i{display:block;min-width:12px}
.vs .bar .a{background:var(--accent)}
.vs .bar .b{background:var(--accent2)}
.vs .val.m{font-size:92px}
.vs .val.l{font-size:66px}
.vs .val.xl{font-size:52px}
.vs .side.b .val{color:var(--accent2)}
.s-instagram .vs .val{font-size:104px}
.s-instagram .vs .val.m{font-size:78px}
.s-instagram .vs .val.l{font-size:58px}
.s-instagram .vs .val.xl{font-size:46px}
.vs .who{font:700 30px/1.2 var(--text);color:var(--muted);letter-spacing:.02em}
.vs .vs-dot{align-self:center;margin-bottom:34px;padding:10px 18px;border-radius:999px;border:2px solid rgba(var(--ink-rgb),.2);font:700 28px var(--text);color:var(--muted)}
.versus{display:flex;align-items:center;gap:26px;font:700 64px/1.05 var(--display)}
.versus .a{color:var(--accent)}
.versus .b{color:var(--accent2)}
.versus i{font-style:normal;font:700 34px var(--text);color:var(--muted);padding:8px 18px;border:2px solid rgba(var(--ink-rgb),.3);border-radius:999px}
.rank{display:flex;align-items:baseline;gap:18px;font:700 300px/0.8 var(--display);color:var(--accent);direction:ltr;unicode-bidi:isolate;align-self:flex-start}
.rank small{font-size:.34em;color:var(--muted)}
.rank.one{color:var(--accent2)}
.s-instagram .rank{font-size:220px}
.rows{list-style:none;display:flex;flex-direction:column;gap:20px}
.rows li{display:flex;gap:24px;align-items:baseline;font:400 40px/1.3 var(--text);padding-bottom:16px;border-bottom:2px solid rgba(var(--ink-rgb),.14)}
.s-instagram .rows li{font-size:35px;padding-bottom:10px}
.rows b{flex:none;width:78px;font:700 60px/1 var(--display);color:var(--accent);direction:ltr;unicode-bidi:isolate;text-align:left}
.depth{display:flex;align-items:center;gap:20px}
.depth .bar{display:flex;gap:8px}
.depth .bar i{width:46px;height:14px;border-radius:7px;background:rgba(var(--ink-rgb),.18)}
.depth .bar i.on{background:var(--accent)}
.depth span{font:700 32px var(--text);color:var(--muted)}
/* The deeper the layer, the more of the theme's second colour rises from the bottom: a tint, never a dark wash, so dark text on a light theme stays legible. */
.deep{position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(to top,rgba(var(--accent2-rgb),calc(var(--deep,0) * .55)) 0%,rgba(var(--accent2-rgb),0) 75%)}
body.layer .frame{z-index:2}
.clue-n{display:flex;align-items:center;gap:20px}
.clue-n b{width:120px;height:120px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font:700 70px var(--display)}
.clue-n span{font:700 36px var(--text);color:var(--muted)}
.qmark{position:absolute;left:60px;top:calc(var(--pt) + 120px);font:700 420px/0.8 var(--display);color:rgba(var(--accent-rgb),.10);z-index:0;direction:ltr}
.answer{font:700 128px/1 var(--display);color:var(--accent);max-height:420px}
.s-instagram .answer{font-size:104px;max-height:300px}
/* A myth is stamped in the muted ink and struck through; the fact that answers it in the accent. */
.stamp-r{align-self:flex-start;font:700 46px var(--display);padding:12px 34px;border:5px solid var(--muted);color:var(--muted);border-radius:14px;transform:rotate(-3deg)}
.stamp-r.ok{border-color:var(--accent);color:var(--accent)}
.myth-text{font:700 92px/1.08 var(--display);text-decoration:line-through;text-decoration-color:var(--muted);color:var(--muted);text-decoration-thickness:8px;max-height:520px}
.s-instagram .myth-text{font-size:78px;max-height:380px}
.meme{background:var(--surface);color:var(--ink);border-radius:var(--radius);padding:44px 46px;display:flex;flex-direction:column;gap:28px;border:3px solid rgba(var(--ink-rgb),.12);box-shadow:0 30px 70px rgba(0,0,0,.28)}
.meme .setup{font:500 46px/1.35 var(--text);color:var(--muted);max-height:300px}
.cover-meme{transform:rotate(-1.5deg)}
.cover-meme .punch{max-height:620px}
.meme .punch{font:700 86px/1.08 var(--display);max-height:520px}
.s-instagram .meme .punch{font-size:70px;max-height:340px}
.s-instagram .meme .setup{font-size:40px;max-height:200px}
.track{display:flex;align-items:center;gap:14px}
.track i{flex:1;height:10px;border-radius:5px;background:rgba(var(--ink-rgb),.16)}
.track i.on{background:var(--accent)}
.track span{flex:none;font:700 30px var(--text);color:var(--muted)}
.date{align-self:flex-start;display:flex;flex-direction:column;align-items:center;padding:22px 40px 26px;border-radius:var(--radius);background:var(--accent);color:var(--on-accent);gap:4px}
.date b{font:700 96px/1 var(--display)}
.date span{font:700 34px var(--text)}
.opinion{align-self:flex-start;font:700 32px var(--text);padding:10px 26px;border-radius:999px;background:var(--accent2);color:var(--on-accent2)}
.kw{display:flex;flex-wrap:wrap;gap:6px 14px;font:500 21px var(--text);color:var(--muted);margin-top:18px;opacity:.6}
.kw bdi{white-space:nowrap}
.cta{display:flex;align-items:center;gap:20px;margin-top:30px;padding:22px 30px;border-radius:var(--radius);background:var(--accent);color:var(--on-accent);font:700 38px/1.25 var(--text)}
.cta .icon{flex:none;width:52px;height:52px}
.s-instagram .cta{font-size:34px;padding:18px 26px;margin-top:22px}
.payoff .rtitle{color:var(--accent)}
body.has-photo .rtag,body.has-photo .vs{background:rgba(0,0,0,.35)}
`;

const tag = (text, cls = '') => `<div class="rtag ${cls}">${he(text)}</div>`;
const title = (s, cls = 'rtitle') => (s.title ? `<div class="${cls} fit">${he(s.title)}</div>` : '');
const body = (s) => (s.body ? `<p class="rbody fit">${he(s.body)}</p>` : '');
const lines = (s) => {
  const ls = String(s.body || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return ls.length > 1 ? `<ul class="lines fit">${ls.map((l) => `<li>${he(l)}</li>`).join('')}</ul>` : body(s);
};

/** The progress along a story or a timeline: n of `of`, with a word for where it is. */
const track = (n, of, label = '') => `<div class="track">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}${label ? `<span>${he(label)}</span>` : ''}</div>`;

/** The call to action, on the last slide only. */
export const ctaHtml = (cta) => (cta?.text ? `<div class="cta"><span class="icon">${CTA_ICON[cta.kind] || CTA_ICON.save}</span><span>${he(cta.text)}</span></div>` : '');

/** The keywords, a quiet line under the call to action: TikTok's search reads the text on a slide. */
export const keywordsHtml = (kw = []) => (kw.length ? `<div class="kw">${kw.map((k) => `<bdi>${esc(k)}</bdi>`).join('<span>·</span>')}</div>` : '');

/** What a cover of each kind adds under its cover line. */
export function coverExtras(s, { art = false } = {}) {
  const k = s.postKind;
  const subj = s.subject || {};
  const parts = [];
  // The kind's own art already draws the two sides, or the date: once is enough.
  const drawn = art && !s.coverVisual;
  if (k === 'head-to-head' && subj.a && subj.b && !drawn) parts.push(`<div class="versus"><span class="a">${he(subj.a)}</span><i>VS</i><span class="b">${he(subj.b)}</span></div>`);
  // The label, unless the cover line already says it is an opinion.
  if (k === 'hot-take' && !/^\s*דעה/.test(String(s.hook || ''))) parts.unshift('<div class="opinion">דעה</div>');
  if (k === 'on-this-day' && subj.date && !drawn) {
    const m = /^(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(subj.date.replace(/^ב-?/, ''));
    // The stamp, unless the cover line already says the date: once is enough.
    const said = m && new RegExp(`(?<!\\d)${m[1]}\\s+${m[2]}`).test(String(s.hook || ''));
    if (!said) parts.unshift(m ? `<div class="date"><b>${he(m[1])}</b><span>${he(`${m[2].replace(/^ב/, '')} ${m[3]}`)}</span></div>` : `<div class="date"><span>${he(subj.date)}</span></div>`);
  }
  return parts.join('');
}

/** Is this a slide the shared role parts draw (a new kind's cover or content slide)? */
export const drawsRole = (s) => Boolean(s.postKind && s.postKind !== 'list' && (s.kind === 'item' || s.kind === 'cover'));

/**
 * The inside of a content slide of a new kind, by its role. The template wraps it
 * in its own frame (its handle tag, its counter, its ground).
 */
export function roleInner(s) {
  const subj = s.subject || {};
  const r = s.role;
  // The last slide carries the call to action and, under it, the keywords (TikTok's search
  // reads every slide; on the cover they would give a guess-who or a twist away). Two blind
  // reviews read a keyword row as SEO, so it is a small, faint footnote, not a line of tags.
  const last = s.isLast ? `${ctaHtml(s.cta)}${s.noKeywords ? '' : keywordsHtml(s.keywords)}` : '';
  const src = sourceLine(s);
  let inner = '';
  if (r === 'stat') {
    // A value is a number, or a word or two: the longer the value, the smaller it is set, in its own direction.
    const size = (v) => {
      const n = [...String(v || '')].length;
      return n <= 4 ? '' : n <= 7 ? ' m' : n <= 11 ? ' l' : ' xl';
    };
    const val = (v) => `<div class="val fit${size(v)}" dir="auto">${he(v)}</div>`;
    // A bar only for two plain amounts of the same thing ("213" against "260"), never for a record or a word.
    const amount = (v) => {
      const t = String(v || '').trim();
      return /^[$€£]?\d[\d,.]*\s*(%|[\u0590-\u05FF"']{1,10})?$/.test(t) ? Number(t.replace(/[^\d.]/g, '')) : null;
    };
    const [na, nb] = [amount(s.a), amount(s.b)];
    const bar = na > 0 && nb > 0 ? `<div class="bar"><i class="a" style="flex:${na} 1 0"></i><i class="b" style="flex:${nb} 1 0"></i></div>` : '';
    inner = `${title(s)}<div class="vs"><div class="row"><div class="side a"><div class="who">${he(subj.a || '')}</div>${val(s.a)}</div><div class="vs-dot">מול</div><div class="side b"><div class="who">${he(subj.b || '')}</div>${val(s.b)}</div></div>${bar}</div>${body(s)}`;
  } else if (r === 'rank') {
    inner = `<div class="rank${s.rank === 1 ? ' one' : ''}"><small>#</small>${s.rank}</div>${title(s)}${body(s)}`;
  } else if (r === 'ranks') {
    const ls = String(s.body || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    inner = `${title(s)}<ul class="rows fit">${ls.map((l, i) => `<li><b>${(s.rank || [])[i] ?? ''}</b><span>${he(l)}</span></li>`).join('')}</ul>`;
  } else if (r === 'layer') {
    inner = `<div class="depth"><div class="bar">${Array.from({ length: s.of }, (_, i) => `<i class="${i < s.n ? 'on' : ''}"></i>`).join('')}</div><span>${he(depthLabel(s.n, s.of))}</span></div>${title(s)}${lines(s)}`;
  } else if (r === 'clue') {
    inner = `<div class="clue-n"><b>${s.n}</b><span>רמז ${s.n} מתוך ${s.clues}</span></div>${title(s)}${body(s)}`;
  } else if (r === 'reveal') {
    inner = `${tag(ROLE_LABEL.reveal, 'solid')}<div class="answer fit">${he(s.title)}</div>${body(s)}`;
  } else if (r === 'myth') {
    inner = `<div class="stamp-r">${ROLE_LABEL.myth}</div><div class="myth-text fit">${he(s.title)}</div>${body(s)}`;
  } else if (r === 'fact') {
    inner = `<div class="stamp-r ok">${ROLE_LABEL.fact}</div>${title(s)}${body(s)}`;
  } else if (r === 'joke') {
    inner = `<div class="meme"><div class="setup fit">${he(s.title)}</div>${s.body ? `<div class="punch fit">${he(s.body)}</div>` : ''}</div>`;
  } else if (r === 'truth') {
    inner = `${tag(ROLE_LABEL.truth, 'solid')}${title(s)}${body(s)}`;
  } else if (r === 'verdict') {
    inner = `${tag(ROLE_LABEL.verdict, 'alt')}${title(s)}${body(s)}`;
  } else if (r === 'ask') {
    inner = `${/^\s*דעה/.test(String(s.title || '')) ? '' : '<div class="opinion">דעה</div>'}${title(s)}${body(s)}`;
  } else if (r === 'case') {
    inner = `${tag(`נימוק ${s.n}`)}${title(s)}${body(s)}`;
  } else if (['then', 'turn', 'now', 'context', 'moment', 'after'].includes(r)) {
    inner = `${track(s.n, s.of, ROLE_LABEL[r])}${title(s)}${body(s)}`;
  } else if (r === 'beat' || r === 'payoff') {
    inner = `${track(s.n, s.of)}<div class="${r === 'payoff' ? 'payoff' : ''}">${title(s)}</div>${body(s)}`;
  } else {
    inner = `${title(s)}${lines(s)}`;
  }
  // The slide's graphic under its words, and its photograph: in a frame of its own when the
  // slide has no graphic, as a round portrait beside the words when it has one.
  const vis = s.visual && r !== 'stat' ? visualHtml(s.visual) : s.visual && r === 'stat' && s.visual.type !== 'compare' ? visualHtml(s.visual) : '';
  if (s.photo) inner = vis ? `<div class="avatar"><img src="${s.photo}" alt=""></div>${inner}${vis}` : `<div class="portrait"><img src="${s.photo}" alt=""></div>${inner}`;
  else if (vis) inner = `${inner}${vis}`;
  return { inner, after: `${src}${last}`, ghost: r === 'clue' ? '<div class="qmark">?</div>' : r === 'layer' ? '<div class="deep"></div>' : '' };
}

/** The inside of a new kind's cover: its cover line and what the kind adds. */
export function coverInner(s, { photo = false } = {}) {
  // A cover always shows a picture: its photograph, or the graphic drawn in its place.
  // A guess-who's blurred photograph carries the question mark over it.
  const art = s.tease ? '<div class="cover-vis art art-who"><b class="qbig">?</b></div>' : photo ? '' : coverVisualHtml(s);
  const extras = coverExtras(s, { art: Boolean(art) });
  // A meme's cover is the meme: the hook on the account's own meme card.
  if (s.postKind === 'meme' && !photo && !s.coverVisual) return { inner: `${extras}<div class="meme cover-meme"><div class="punch hook fit">${he(s.hook)}</div>${s.sub ? `<div class="setup fit">${he(s.sub)}</div>` : ''}</div>`, after: '', ghost: '' };
  return { inner: `${art}${extras}<h1 class="hook fit">${he(s.hook)}</h1>${s.sub ? `<p class="sub fit">${he(s.sub)}</p>` : ''}`, after: '', ghost: '' };
}

/** A number in two digits, for the templates that count. */
export { two };
