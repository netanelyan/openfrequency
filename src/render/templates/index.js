import { counter, he, ICON, leadNumber, sourceLine, two } from '../html.js';

// The template library. Each template turns one slide into { css, html } using
// only the theme's variables (--bg, --accent, --display...), so one template
// looks like a different brand in a different pack's colours and faces, and two
// packs never share one (pack validation).
//
// A slide: { kind: 'cover'|'item'|'closer', hook, sub, title, body, n, of,
// sources, handle }. Every text block that can run long carries class "fit": the
// renderer shrinks it until it fits, down to a floor, and refuses the slide past
// that floor rather than cutting the text.

const handleTag = (s) => `<bdi>@${he(s.handle)}</bdi>`;

/* ------------------------------------------------------------------ bubble */

const bubble = {
  css: () => `
body{background:radial-gradient(900px 760px at 88% -12%, rgba(var(--accent-rgb),.30), transparent 62%),radial-gradient(760px 640px at -6% 108%, rgba(var(--accent2-rgb),.18), transparent 60%),var(--bg)}
body::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(var(--ink-rgb),.10) 1.7px, transparent 1.8px);background-size:38px 38px;-webkit-mask-image:linear-gradient(to bottom,#000 0%,transparent 78%)}
body.v-b::before{background-image:linear-gradient(rgba(var(--ink-rgb),.06) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(var(--ink-rgb),.06) 1.5px,transparent 1.5px);background-size:72px 72px}
.top{display:flex;justify-content:space-between;align-items:center}
.tag{display:inline-flex;align-items:center;gap:14px;align-self:flex-start;padding:12px 26px;border-radius:999px;background:rgba(var(--ink-rgb),.07);border:1.5px solid rgba(var(--ink-rgb),.14);font:600 30px var(--text);color:var(--ink)}
.tag i{width:14px;height:14px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 6px rgba(var(--accent2-rgb),.2)}
.count{font:700 30px var(--text);padding:10px 24px;border-radius:999px;background:rgba(var(--ink-rgb),.08);color:var(--ink);display:flex;align-items:center;gap:12px}
.count::before{content:'';width:12px;height:12px;border-radius:50%;background:var(--accent2)}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:36px;min-height:0}
.hook{font:700 108px/1.04 var(--display);letter-spacing:-1.5px;max-height:620px;text-wrap:balance}
.s-instagram .hook{font-size:94px;max-height:470px}
.hook em{font-style:normal;color:var(--accent)}
.prompt{display:flex;align-items:center;gap:22px;padding:22px 22px 22px 34px;border-radius:999px;background:var(--surface);border:1.5px solid rgba(var(--ink-rgb),.13);box-shadow:0 28px 60px rgba(0,0,0,.30)}
.prompt span{flex:1;font:500 36px/1.3 var(--text);color:var(--ink);max-height:94px}
.prompt span::after{content:'';display:inline-block;width:4px;height:40px;margin-inline-start:8px;vertical-align:-8px;background:var(--accent)}
.prompt b{flex:none;width:80px;height:80px;border-radius:50%;background:var(--accent);color:var(--on-accent);padding:19px}
.q{align-self:flex-start;max-width:90%;background:var(--accent);color:var(--on-accent);font:700 62px/1.16 var(--display);padding:36px 44px;border-radius:var(--radius) var(--radius) 10px var(--radius);max-height:420px;box-shadow:0 24px 50px rgba(var(--accent-rgb),.28)}
.v-b .q{background:transparent;color:var(--ink);border:4px solid var(--accent);box-shadow:none}
.a{align-self:flex-end;width:94%;background:var(--surface);border:1.5px solid rgba(var(--ink-rgb),.12);padding:38px 44px 42px;border-radius:var(--radius) var(--radius) var(--radius) 10px;display:flex;flex-direction:column;gap:18px}
.a .icon{width:46px;height:46px;color:var(--accent2)}
.a p{font:400 46px/1.45 var(--text);max-height:540px}
.s-instagram .a p{font-size:42px;max-height:400px}
.src{font:500 26px var(--text);color:var(--muted);margin-top:30px}
.save{width:120px;height:120px;border-radius:34px;background:var(--accent);color:var(--on-accent);padding:30px}
.k-closer h2{font:700 96px/1.06 var(--display);max-height:420px}
.k-closer .mid p{font:400 46px/1.45 var(--text);color:var(--muted);max-height:300px}
`,
  html: (s) => {
    if (s.kind === 'cover') {
      return `<div class="frame"><div class="tag"><i></i>${handleTag(s)}</div>
<div class="mid"><h1 class="hook fit">${he(s.hook)}</h1></div>
${s.sub ? `<div class="prompt"><span class="fit">${he(s.sub)}</span><b class="icon">${ICON.arrow}</b></div>` : ''}</div>`;
    }
    if (s.kind === 'item') {
      return `<div class="frame"><div class="top">${counter(s)}<div class="tag">${handleTag(s)}</div></div>
<div class="mid"><div class="q fit">${he(s.title)}</div>${s.body ? `<div class="a"><span class="icon">${ICON.spark}</span><p class="fit">${he(s.body)}</p></div>` : ''}</div>
${sourceLine(s)}</div>`;
    }
    return `<div class="frame"><div class="tag"><i></i>${handleTag(s)}</div>
<div class="mid"><div class="save icon">${ICON.bookmark}</div><h2 class="fit">${he(s.title)}</h2>${s.body ? `<p class="fit">${he(s.body)}</p>` : ''}</div></div>`;
  },
};

/* -------------------------------------------------------------- scoreboard */

const scoreboard = {
  css: () => `
body{background:repeating-linear-gradient(90deg,rgba(var(--ink-rgb),.035) 0 120px,transparent 120px 240px),radial-gradient(1300px 900px at 50% -25%,rgba(var(--accent-rgb),.20),transparent 62%),var(--bg)}
body::after{content:'';position:absolute;width:980px;height:980px;border:5px solid rgba(var(--ink-rgb),.10);border-radius:50%;left:-560px;top:calc(50% - 490px)}
body::before{content:'';position:absolute;left:0;right:0;top:50%;border-top:5px solid rgba(var(--ink-rgb),.07)}
body.v-b::after{border-radius:0;width:520px;height:1100px;left:-260px;top:calc(50% - 550px)}
.frame{z-index:2}
.kick{display:flex;align-items:center;gap:18px;font:700 34px var(--text);color:var(--accent);letter-spacing:1px}
.kick .icon{width:44px;height:44px;color:var(--accent)}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:30px;min-height:0}
.hook{font:700 178px/0.9 var(--display);color:var(--ink);max-height:760px;letter-spacing:-1px;text-wrap:balance}
.s-instagram .hook{font-size:150px;max-height:560px}
.bar{width:220px;height:18px;background:var(--accent);transform:skewX(-24deg);margin-inline-start:8px}
.sub{font:500 44px/1.35 var(--text);color:var(--muted);max-height:180px}
.ghost{position:absolute;left:30px;bottom:calc(var(--pb) - 70px);font:700 560px/0.8 var(--display);color:transparent;-webkit-text-stroke:4px rgba(var(--accent-rgb),.28);z-index:1;direction:ltr}
.s-instagram .ghost{font-size:430px;bottom:20px}
.count{font:700 64px/1 var(--display);color:var(--accent);direction:ltr;align-self:flex-start;unicode-bidi:isolate}
.stat{display:flex;align-items:baseline;gap:12px;font:700 250px/0.82 var(--display);color:var(--accent);direction:ltr;align-self:flex-start;unicode-bidi:isolate}
.s-instagram .stat{font-size:200px}
.stat small{font-size:.38em;color:var(--ink)}
.title{font:700 104px/0.98 var(--display);max-height:330px}
.s-instagram .title{font-size:92px;max-height:280px}
.body{font:400 44px/1.42 var(--text);color:var(--ink);opacity:.92;max-height:420px;border-inline-start:8px solid var(--accent);padding-inline-start:30px}
.s-instagram .body{font-size:40px;max-height:300px}
.src{font:500 26px var(--text);color:var(--muted);margin-top:26px}
.k-closer h2{font:700 160px/0.9 var(--display);max-height:520px}
.k-closer .body{max-height:300px}
`,
  html: (s) => {
    if (s.kind === 'cover') {
      return `<div class="frame"><div class="kick"><span class="icon">${ICON.ball}</span>${handleTag(s)}</div>
<div class="mid"><h1 class="hook fit">${he(s.hook)}</h1><div class="bar"></div>${s.sub ? `<p class="sub fit">${he(s.sub)}</p>` : ''}</div></div>`;
    }
    if (s.kind === 'item') {
      const lead = leadNumber(s.title);
      return `<div class="ghost">${two(s.n)}</div><div class="frame"><div class="count">${two(s.n)} / ${two(s.of)}</div>
<div class="mid">${lead ? `<div class="stat">${he(lead.pre)}${he(lead.value)}${lead.post ? `<small>${he(lead.post)}</small>` : ''}</div>` : ''}
<div class="title fit">${he(s.title)}</div>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div>
${sourceLine(s)}</div>`;
    }
    return `<div class="frame"><div class="kick"><span class="icon">${ICON.ball}</span>${handleTag(s)}</div>
<div class="mid"><h2 class="fit">${he(s.title)}</h2><div class="bar"></div>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div></div>`;
  },
};

/* ------------------------------------------------------------------ ledger */

const ledger = {
  css: () => `
body{background:repeating-linear-gradient(to bottom,transparent 0 67px,rgba(var(--ink-rgb),.075) 67px 68px),var(--bg)}
body::before{content:'';position:absolute;top:0;bottom:0;right:132px;border-right:3px solid rgba(var(--accent2-rgb),.35)}
.s-instagram::before{right:70px}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px;min-height:0}
.stamp{align-self:flex-start;display:flex;align-items:center;gap:14px;padding:14px 26px;border:3px solid var(--accent);border-radius:14px;color:var(--accent);font:700 30px var(--text);transform:rotate(-2deg)}
.stamp .icon{width:38px;height:38px}
.hook{font:900 116px/1.04 var(--display);color:var(--ink);max-height:640px;text-wrap:balance}
.s-instagram .hook{font-size:100px;max-height:500px}
.rule{height:12px;width:260px;border-top:4px solid var(--accent);border-bottom:4px solid var(--accent)}
.sub{font:500 44px/1.4 var(--text);color:var(--muted);max-height:190px}
.receipt{position:relative;background:var(--surface);padding:64px 58px 70px;box-shadow:0 34px 70px rgba(var(--ink-rgb),.14);display:flex;flex-direction:column;gap:26px;min-height:0;
  -webkit-mask:radial-gradient(circle 16px at 22px 0,transparent 15px,#000 16px) top left/44px 52% repeat-x,radial-gradient(circle 16px at 22px 100%,transparent 15px,#000 16px) bottom left/44px 52% repeat-x}
.v-b .receipt{-webkit-mask:none;border-radius:var(--radius);border:3px solid var(--ink)}
.head{display:flex;justify-content:space-between;font:700 30px var(--text);color:var(--muted);letter-spacing:.5px;padding-bottom:22px;border-bottom:3px dashed rgba(var(--ink-rgb),.25)}
.head b{color:var(--accent)}
.title{font:800 70px/1.12 var(--display);max-height:330px}
.s-instagram .title{font-size:62px;max-height:240px}
.body{font:400 44px/1.48 var(--text);max-height:520px}
.s-instagram .body{font-size:40px;max-height:330px}
.amount{display:flex;align-items:baseline;justify-content:space-between;border-top:3px solid var(--ink);padding-top:20px;font:900 96px/1 var(--display);color:var(--accent)}
.amount span{font:700 30px var(--text);color:var(--muted)}
.amount b{direction:ltr;unicode-bidi:isolate}
.src{font:500 26px var(--text);color:var(--muted);margin-top:28px}
.k-closer h2{font:900 104px/1.06 var(--display);max-height:460px}
`,
  html: (s) => {
    if (s.kind === 'cover') {
      return `<div class="frame"><div class="stamp"><span class="icon">${ICON.receipt}</span>${handleTag(s)}</div>
<div class="mid"><h1 class="hook fit">${he(s.hook)}</h1><div class="rule"></div>${s.sub ? `<p class="sub fit">${he(s.sub)}</p>` : ''}</div></div>`;
    }
    if (s.kind === 'item') {
      const lead = leadNumber(s.title);
      return `<div class="frame"><div class="mid"><div class="receipt">
<div class="head"><span>סעיף <b>${two(s.n)}</b></span><span>מתוך ${two(s.of)}</span></div>
<div class="title fit">${he(s.title)}</div>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}
${lead ? `<div class="amount"><span>המספר</span><b>${he(lead.pre)}${he(lead.value)}${he(lead.post)}</b></div>` : ''}
</div>${sourceLine(s)}</div></div>`;
    }
    return `<div class="frame"><div class="stamp"><span class="icon">${ICON.bookmark}</span>${handleTag(s)}</div>
<div class="mid"><h2 class="fit">${he(s.title)}</h2><div class="rule"></div>${s.body ? `<p class="sub fit">${he(s.body)}</p>` : ''}</div></div>`;
  },
};

/* --------------------------------------------------------------- editorial */

const editorial = {
  css: () => `
body{background:var(--bg)}
body::before{content:'';position:absolute;width:760px;height:760px;left:-260px;bottom:-200px;background:rgba(var(--accent2-rgb),.20);border-radius:58% 42% 63% 37% / 46% 55% 45% 54%}
body::after{content:'';position:absolute;width:300px;height:300px;right:-90px;top:120px;background:rgba(var(--accent-rgb),.16);border-radius:42% 58% 37% 63% / 55% 46% 54% 45%}
body.v-b::before{border-radius:50%;background:transparent;border:5px solid rgba(var(--accent2-rgb),.4)}
.frame{z-index:1}
.band{display:flex;justify-content:space-between;align-items:center;padding-bottom:22px;border-bottom:4px solid var(--ink);font:400 32px var(--text)}
.band .icon{width:44px;height:44px;color:var(--accent2)}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px;min-height:0}
.hook{font:400 118px/1.08 var(--display);color:var(--ink);max-height:660px;text-wrap:balance}
.s-instagram .hook{font-size:100px;max-height:520px}
.sub{font:400 44px/1.42 var(--text);color:var(--muted);max-height:200px}
.idx{font:400 230px/0.85 var(--display);color:var(--accent);direction:ltr;unicode-bidi:isolate;align-self:flex-start}
.s-instagram .idx{font-size:180px}
.title{font:400 82px/1.12 var(--display);max-height:380px}
.s-instagram .title{font-size:70px;max-height:270px}
.body{font:400 44px/1.5 var(--text);color:var(--ink);max-height:520px}
.s-instagram .body{font-size:40px;max-height:330px}
.src{font:400 26px var(--text);color:var(--muted);margin-top:26px;padding-top:18px;border-top:2px solid rgba(var(--ink-rgb),.2)}
.pill{align-self:flex-start;background:var(--accent);color:var(--on-accent);font:400 32px var(--text);padding:12px 28px;border-radius:999px}
.k-closer h2{font:400 108px/1.08 var(--display);max-height:460px}
`,
  html: (s) => {
    const band = `<div class="band">${handleTag(s)}<span class="icon">${ICON.leaf}</span></div>`;
    if (s.kind === 'cover') {
      return `<div class="frame">${band}<div class="mid"><h1 class="hook fit">${he(s.hook)}</h1>${s.sub ? `<p class="sub fit">${he(s.sub)}</p>` : ''}</div></div>`;
    }
    if (s.kind === 'item') {
      return `<div class="frame">${band}<div class="mid"><div class="idx">${two(s.n)}</div><div class="title fit">${he(s.title)}</div>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div>${sourceLine(s)}</div>`;
    }
    return `<div class="frame">${band}<div class="mid"><div class="pill">שמרו לפעם הבאה</div><h2 class="fit">${he(s.title)}</h2>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div></div>`;
  },
};

/* ------------------------------------------------------------------ poster */

const poster = {
  css: () => `
body{background:linear-gradient(162deg,var(--accent) 0 34%,var(--bg) 34%)}
body.v-b{background:linear-gradient(18deg,var(--bg) 0 62%,var(--accent) 62%)}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:30px;min-height:0}
.who{align-self:flex-start;font:400 34px var(--display);color:var(--on-accent)}
.hook{font:400 124px/1.02 var(--display);color:var(--ink);max-height:660px;text-wrap:balance}
.s-instagram .hook{font-size:104px;max-height:500px}
.sub{font:500 44px/1.4 var(--text);color:var(--muted);max-height:200px}
.dot{align-self:flex-start;width:150px;height:150px;border-radius:50%;background:var(--accent2);color:var(--on-accent2);display:flex;align-items:center;justify-content:center;font:400 76px var(--display);direction:ltr}
.title{font:400 86px/1.08 var(--display);max-height:380px}
.s-instagram .title{font-size:72px;max-height:270px}
.body{font:400 44px/1.48 var(--text);max-height:520px}
.s-instagram .body{font-size:40px;max-height:330px}
.src{font:500 26px var(--text);color:var(--muted);margin-top:26px}
.k-closer h2{font:400 110px/1.04 var(--display);max-height:460px}
`,
  html: (s) => {
    if (s.kind === 'cover') return `<div class="frame"><div class="who">${handleTag(s)}</div><div class="mid"><h1 class="hook fit">${he(s.hook)}</h1>${s.sub ? `<p class="sub fit">${he(s.sub)}</p>` : ''}</div></div>`;
    if (s.kind === 'item') return `<div class="frame"><div class="who">${handleTag(s)}</div><div class="mid"><div class="dot">${s.n}</div><div class="title fit">${he(s.title)}</div>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div>${sourceLine(s)}</div>`;
    return `<div class="frame"><div class="who">${handleTag(s)}</div><div class="mid"><h2 class="fit">${he(s.title)}</h2>${s.body ? `<p class="body fit">${he(s.body)}</p>` : ''}</div></div>`;
  },
};

export const TEMPLATE_IMPL = { bubble, scoreboard, ledger, editorial, poster };

/** { css, html } for one slide in a theme's template. */
export function buildSlide(theme, slide) {
  const t = TEMPLATE_IMPL[theme.template];
  if (!t) throw new Error(`no template "${theme.template}"`);
  return { css: t.css(theme), html: t.html(slide) };
}
