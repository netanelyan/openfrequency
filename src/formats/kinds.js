import { numbersIn } from '../verify/claims.js';
import { normHe } from '../voice/tells.js';

// The shapes a post can take. A pack's format (formats.json) names one of these
// kinds and brings its own name, hook patterns and calls to action; the engine
// owns the shape: which slides, in what order, which of them must state a sourced
// fact, and what the drafting model is told about it.
//
// Every kind fits the rules the research behind the accounts gave:
//   - 5 to 8 slides in all, the cover included (carousels peak at 5 to 6; past
//     10 only about a quarter of viewers finish)
//   - one idea per slide, and the payoff on the last slide: the call to action
//     is drawn on that slide by the design, not given a slide of its own
//   - every factual claim traces to a quote (HARD RULE 3). A role in `factFree`
//     carries no fact of its own (a myth as people say it, a verdict, a joke's
//     setup, "agree?"), and any number on it must still be in the post's quotes.
//
// `list` is the phase 1 shape (a cover, items, a closer slide), kept for packs
// that use it; its range comes from the format's own `items`.

export const GROUPS = { entertaining: 'בידור', number: 'מספרים' };

/** The mix of entertaining formats an account moves between, by its results. */
export const MIX = { default: 0.6, min: 0.4, max: 0.8, step: 0.05 };

export const SLIDES = { min: 5, max: 8 };

export const KINDS = {
  story: {
    group: 'entertaining',
    name: 'סיפור',
    segments: [['beat', 3, 5], ['payoff', 1, 1]],
    photo: 'cover',
    cta: 'send',
    prompt: `story: a true story in slides. The cover is a hook that teases the twist without giving it away, and never promises what the story does not deliver. 3 to 5 "beat" slides build it up in order, one moment each, with the names, dates and numbers from the facts. The last slide, "payoff", is the twist or the result the hook promised. No earlier slide gives the payoff away.`,
  },
  'what-happened': {
    group: 'entertaining',
    name: 'מה קרה ל...',
    segments: [['then', 1, 2], ['turn', 1, 2], ['now', 1, 1]],
    content: [4, 7],
    photo: 'cover',
    cta: 'comment',
    subject: ['a'],
    prompt: `what-happened: "what happened to X", one person, team or company (subject.a). "then" slides: who they were at their peak, with numbers. "turn" slides: the fall or the turn, documented facts only. "now": where they are by the latest dated fact in the documents, with its date. Only documented facts about people: never guess at reasons, health, money or private life the documents do not state.`,
  },
  'on-this-day': {
    group: 'entertaining',
    name: 'היום לפני',
    segments: [['context', 1, 2], ['moment', 1, 3], ['after', 1, 1]],
    content: [4, 7],
    photo: 'cover',
    cta: 'send',
    subject: ['date'],
    prompt: `on-this-day: one wild moment from this date in an earlier year. subject.date is the day it happened, as the cover shows it ("6 באוקטובר 2001"); the day and the year must be in a quote. "context" slides: what was at stake before. "moment" slides: what happened, beat by beat. "after": what it led to.`,
  },
  'guess-who': {
    group: 'entertaining',
    name: 'נחשו מי',
    segments: [['clue', 3, 4], ['reveal', 1, 1]],
    photo: 'last',
    cta: 'comment',
    subject: ['answer'],
    prompt: `guess-who: the cover asks them to guess a famous person (or club, or company) from clues. 3 "clue" slides (4 at most), from hard to easy, each one sourced fact that never names the answer, and never names anything that gives it away at once. The "reveal" slide is last: its title is the answer (subject.answer) and its body one sourced line. The answer appears nowhere before the reveal: not on the cover, not in a clue, not in the captions or the keywords. Never number a clue yourself ("רמז 1"): the design draws the badges.`,
  },
  'head-to-head': {
    group: 'number',
    name: 'ראש בראש',
    segments: [['stat', 4, 6], ['verdict', 1, 1]],
    factFree: ['verdict'],
    photo: 'cover',
    cta: 'comment',
    subject: ['a', 'b'],
    prompt: `head-to-head: two subjects, subject.a and subject.b (short names, as the slides call them). 4 to 6 "stat" slides: title is the stat's name, a and b are the two values exactly as the quotes give them (digits, with their unit), body one short line of context; each stat slide cites the facts that hold both values. Compare like with like: the same competition and period for both, said on the slide. The last slide, "verdict", says who the numbers favour and the one stat that decides it, with no new number. It can take a side.`,
  },
  ranking: {
    group: 'number',
    name: 'דירוג',
    segments: [['ranks', 0, 1], ['rank', 5, 5]],
    photo: 'cover',
    cta: 'comment',
    prompt: `ranking: a top 5, or a top 10. Famous names only. Every place is decided by a number in the quotes (goals, titles, wins, money), and the order follows that number. Five "rank" slides go from 5th place to 1st: number 1 is the last slide. For a top 10, one "ranks" slide comes first and holds places 10 to 6 as exactly five short lines in its body, one per line, in order, each with its number. Never write a place number yourself ("מקום 3", "#1"): the design draws them. A rank slide's title is the name; its body the number that ranks it and one short line.`,
  },
  iceberg: {
    group: 'entertaining',
    name: 'הקרחון',
    segments: [['layer', 4, 6]],
    photo: 'cover',
    cta: 'save',
    prompt: `iceberg: from what everyone knows down to what almost nobody knows. 4 to 6 "layer" slides, top to bottom. A layer is one slide: a short title, and 1 to 3 facts as short lines in its body, one per line. The top layer is the famous facts, the bottom layer the most obscure ones the documents hold. The design draws the depth.`,
  },
  'hot-take': {
    group: 'entertaining',
    name: 'דעה',
    segments: [['case', 3, 5], ['ask', 1, 1]],
    factFree: ['ask'],
    photo: 'cover',
    cta: 'comment',
    prompt: `hot-take: one bold opinion on the cover, the account's own (the design labels it as opinion). 3 to 5 "case" slides make the case with sourced facts: the opinion is ours, the facts inside it are never invented. The last slide, "ask", restates the take in a few words and asks if they agree. Never insult a person, a club, a company or fans.`,
  },
  'myth-fact': {
    group: 'entertaining',
    name: 'מיתוס ועובדה',
    segments: [['myth', 1, 1], ['fact', 1, 1]],
    repeat: [2, 3],
    factFree: ['myth'],
    photo: 'cover',
    cta: 'save',
    prompt: `myth-fact: 2 or 3 pairs. A "myth" slide says a common belief in a few words, the way people say it (the design stamps it as a myth); the "fact" slide right after it says what the sources say instead, with its facts. A myth slide holds no number that its fact slide's quotes do not hold. Pick beliefs people really hold; never a straw man.`,
  },
  meme: {
    group: 'entertaining',
    name: 'מם',
    segments: [['joke', 3, 5], ['truth', 1, 1]],
    factFree: ['joke'],
    photo: null,
    cta: 'send',
    prompt: `meme: text-led jokes about the audience's insider pain, in the account's own design (never a meme template, a film still or another page's picture). 3 to 5 "joke" slides: title is the setup (a situation every one of them knows), body the punchline, short and spoken. A joke that states a fact (a rate, a deadline, a sum) cites it. The last slide, "truth", is the real fact behind the jokes, sourced. Punch at the situation, never at a group of people.`,
  },
  list: {
    group: 'number',
    name: 'רשימה',
    segments: [['item', 2, 10]],
    closer: true,
    photo: 'cover',
    prompt: `list: the cover, then content slides ("item"), each one point with its facts, then a closing slide the design adds.`,
  },
};

export const isKind = (k) => Object.hasOwn(KINDS, k);

/** A format's kind (formats.json "kind", or the phase 1 list). */
export const kindOf = (format) => KINDS[format?.kind] || KINDS.list;
export const kindName = (format) => (isKind(format?.kind) ? format.kind : 'list');
export const groupOf = (format) => kindOf(format).group;
export const factFree = (format, role) => (kindOf(format).factFree || []).includes(role);

/** The content roles a kind allows, in their order. */
export const rolesOf = (format) => [...new Set(kindOf(format).segments.map(([r]) => r))];

/** [min, max] content slides (cover and closer not counted). */
export function contentRange(format) {
  const k = kindOf(format);
  if (k === KINDS.list) return format.items || [3, 5];
  if (k.content) return k.content;
  const rep = k.repeat || [1, 1];
  const lo = k.segments.reduce((n, [, a]) => n + a, 0) * rep[0];
  const hi = k.segments.reduce((n, [, , b]) => n + b, 0) * rep[1];
  return [lo, hi];
}

/** The format's hook patterns, as { id, pattern, examples } (a plain string is a pattern of its own). */
export function hookPatterns(format) {
  return (format?.hooks || []).map((h, i) => (typeof h === 'string' ? { id: `h${i + 1}`, pattern: h, examples: [] } : { id: String(h.id || `h${i + 1}`), pattern: String(h.pattern || ''), examples: (h.examples || []).map(String) }));
}

const GUESS_CTA = { kind: 'comment', text: 'ניחשתם לפני השקופית האחרונה? כתבו בתגובות' };

/** The calls to action a post of this format can end with: the format's own, the pack's, or the kind's default. */
export function ctasOf(pack, format) {
  const own = format?.ctas || pack?.formats?.ctas || [];
  const list = own.map((c) => (typeof c === 'string' ? { kind: 'save', text: c } : { kind: c.kind || 'save', text: String(c.text || '') })).filter((c) => c.text);
  if (format?.kind === 'guess-who' && !list.length) return [GUESS_CTA];
  return list;
}

/**
 * Do the content slides follow the kind's shape? roles: the content slides'
 * roles in order. Returns problems, worded for the model's redraft.
 */
export function shapeProblems(format, roles) {
  const k = kindOf(format);
  const out = [];
  const [lo, hi] = contentRange(format);
  if (roles.length < lo || roles.length > hi) out.push(`the post needs ${lo} to ${hi} content slides, it has ${roles.length}`);
  const allowed = rolesOf(format);
  const bad = roles.filter((r) => !allowed.includes(r));
  if (bad.length) out.push(`roles ${[...new Set(bad)].join(', ')} are not part of a ${kindName(format)} post (use ${allowed.join(', ')})`);
  if (bad.length) return out;
  // Walk the segments: each role in its run, in order, with its count.
  const want = k.repeat ? Array.from({ length: Math.max(1, Math.round(roles.length / k.segments.length)) }, () => k.segments).flat() : k.segments;
  let i = 0;
  for (const [role, min, max] of want) {
    let n = 0;
    while (i < roles.length && roles[i] === role && n < max) (i++, n++);
    if (roles[i] === role) {
      out.push(`at most ${max} "${role}" slide${max > 1 ? 's' : ''} in a row in a ${kindName(format)} post`);
      return out;
    }
    if (n < min) {
      out.push(k.repeat ? `the slides must alternate ${k.segments.map(([r]) => r).join(', ')}` : `a ${kindName(format)} post needs ${min === max ? min : `${min} to ${max}`} "${role}" slide${max > 1 ? 's' : ''} in its place (it has ${n})`);
      return out;
    }
  }
  if (i < roles.length) out.push(`the slides are out of order: the shape is ${k.segments.map(([r, a, b]) => `${r}${a === b ? (a > 1 ? ` x${a}` : '') : ` x${a}-${b}`}`).join(', ')}${k.repeat ? `, repeated ${k.repeat[0]} to ${k.repeat[1]} times` : ''}`);
  return out;
}

const SLIDE_TOTAL = (format, content) => 1 + content + (kindOf(format).closer ? 1 : 0);

/** The lines of a slide's body, for the kinds that hold several facts on one slide. */
export const linesOfBody = (body) => String(body || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);

/**
 * Everything a kind asks of a written post beyond its shape. post: { hook, sub,
 * subject, slides (content only, with role, title, body, a, b), caption,
 * captionShort, keywords }. Returns problems.
 */
export function kindProblems(format, post) {
  const k = kindOf(format);
  const name = kindName(format);
  const out = [];
  const content = post.slides || [];
  const total = SLIDE_TOTAL(format, content.length);
  if (name !== 'list' && (total < SLIDES.min || total > SLIDES.max)) out.push(`the post has ${total} slides with the cover: it needs ${SLIDES.min} to ${SLIDES.max}`);
  const subj = post.subject || {};
  for (const f of k.subject || []) if (!String(subj[f] || '').trim()) out.push(`subject.${f} is required for a ${name} post`);
  if (name === 'head-to-head') {
    content.forEach((s, i) => {
      if (s.role === 'stat' && !(String(s.a || '').trim() && String(s.b || '').trim())) out.push(`slide ${i + 1}: a stat slide needs both values (a and b)`);
      if (s.role === 'stat' && String(s.a || '').length + String(s.b || '').length > 32) out.push(`slide ${i + 1}: a and b are values, not sentences (at most a few characters each)`);
    });
  }
  if (name === 'on-this-day' && subj.date && !/\d{4}/.test(subj.date)) out.push('subject.date must hold the year');
  if (name === 'guess-who' && subj.answer) {
    const ans = normHe(subj.answer).split(' ').filter((w) => w.length >= 3);
    const spoils = (t) => {
      const words = ` ${normHe(t)} `;
      return ans.some((w) => words.includes(` ${w} `) || new RegExp(` [והבלמשכ]${w} `).test(words));
    };
    const early = [['the cover', `${post.hook} ${post.sub}`], ['the captions', `${post.caption} ${post.captionShort}`], ['the keywords', (post.keywords || []).join(' ')], ...content.filter((s) => s.role === 'clue').map((s, i) => [`clue ${i + 1}`, `${s.title} ${s.body}`])];
    content.forEach((s, i) => s.role === 'clue' && /(?:^|\s)רמז\s*(?:\d|מספר|ראשון|שני|שלישי|רביעי)/.test(`${s.title} ${s.body}`) && out.push(`slide ${i + 1}: no clue numbers in the text, the design draws them`));
    for (const [where, text] of early) if (spoils(text)) out.push(`${where} gives the answer away ("${subj.answer}"): it may appear only on the reveal slide`);
  }
  if (name === 'ranking') {
    const ranks = content.find((s) => s.role === 'ranks');
    if (ranks && linesOfBody(ranks.body).length !== 5) out.push('the "ranks" slide holds places 10 to 6: exactly five lines in its body');
    content.forEach((s, i) => {
      if (/(?:^|\s)(?:#\s?\d|מקום\s+(?:ה|ראשון|שני|\d))/.test(`${s.title} ${s.body}`)) out.push(`slide ${i + 1}: no place numbers in the text, the design draws them`);
    });
  }
  if (name === 'iceberg') content.forEach((s, i) => linesOfBody(s.body).length > 3 && out.push(`slide ${i + 1}: a layer holds 1 to 3 short lines`));
  if (name === 'myth-fact') {
    content.forEach((s, i) => {
      if (s.role !== 'myth') return;
      const next = content[i + 1];
      const nums = new Set([...numbersIn(`${next?.title} ${next?.body}`, { hebrew: true })]);
      for (const x of numbersIn(`${s.title} ${s.body}`, { hebrew: true })) if (!nums.has(x)) out.push(`slide ${i + 1}: the myth states ${x}, which its fact slide does not`);
    });
  }
  return out;
}

/**
 * Numbers that are the post's own structure, not claims: how many slides, a top
 * 5 or a top 10, 3 clues. The cover may say them without a quote.
 */
export function structureNumbers(format, content) {
  const out = new Set([String(content.length)]);
  const name = kindName(format);
  if (name === 'ranking') out.add(String(content.some((s) => s.role === 'ranks') ? 10 : 5));
  if (name === 'guess-who') out.add(String(content.filter((s) => s.role === 'clue').length));
  if (name === 'myth-fact') out.add(String(content.filter((s) => s.role === 'myth').length));
  if (name === 'iceberg') out.add(String(content.length));
  return out;
}

/** The rank the design draws on each content slide of a ranking: 10..6 on the group slide, then 5..1. */
export function ranksOf(content) {
  const singles = content.filter((s) => s.role === 'rank').length;
  let next = singles;
  return content.map((s) => (s.role === 'rank' ? next-- : s.role === 'ranks' ? [10, 9, 8, 7, 6] : null));
}

/** The shapes, as the drafting model is told them: only the kinds this pack uses. */
export function shapesPrompt(pack) {
  const used = [...new Set((pack.formats.formats || []).map(kindName))];
  // The slides that carry no fact of their own are said so, or a model cites a fact on them anyway.
  return used.map((k) => `- ${KINDS[k].prompt}${KINDS[k].factFree?.length ? ` A "${KINDS[k].factFree.join('" or "')}" item carries no fact of its own: facts [].` : ''}`).join('\n');
}
