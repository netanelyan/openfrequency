import path from 'node:path';
import { newId, nowIso, now, DAY } from '../core/clock.js';
import { mediaDir } from '../core/paths.js';
import { step, settings } from '../core/store.js';
import { j } from '../db/index.js';
import { BudgetError, guard, postSpend } from '../budget/ledger.js';
import { askJson } from '../llm/index.js';
import { NoRecording } from '../llm/recorded.js';
import { refreshSource } from '../sources/index.js';
import { ensureFormats, groupsOf, mixOf, pickFormat, pickHook } from '../formats/rotation.js';
import { contentRange, ctasOf, factFree, groupOf, hookPatterns, kindName, kindOf, kindProblems, linesOfBody, ranksOf, shapeProblems, structureNumbers } from '../formats/kinds.js';
import { resolveFormat } from '../trends/index.js';
import { isGenericQuestion, mechanicalFix, normHe, tellsIn } from '../voice/tells.js';
import { BLOCK_AT, REWRITE_AT, reviewTexts } from '../voice/review.js';
import { checkRules } from '../rules/check.js';
import { gate, verifyFact } from '../verify/claims.js';
import { findImage } from '../images/index.js';
import { renderPost } from '../render/render.js';
import { israelDate } from '../schedule/israel.js';
import { upcoming } from '../schedule/events.js';
import { outlinePrompt, outlineUser, rewritePrompt, rewriteUser, slidesPrompt, slidesUser } from './prompts.js';

// One post, from topic to a rendered, queued slideshow:
//
//   format and its kind -> documents from approved sources -> outline -> facts
//   verified -> the shape checked -> slides -> voice, tell, shape and fact checks
//   -> review -> render -> queue
//
// What it costs is kept down by doing in code whatever code can do: documents
// are narrowed to their content before the model sees them, facts are verified
// before any slide is written, the shape of the post is checked in code,
// punctuation tells are fixed in code instead of by a redraft, a generic closing
// question is dropped, the slides get one redraft at most, and the review runs
// only after every code check passed. The lines it flags get one rewrite, only
// then; whatever is still wrong drops the post. Nothing is ever retried a
// second time.
//
// The format's kind (src/formats/kinds.js) is the post's shape: a story, a
// head-to-head, a guess-who. The code picks the format (by the account's mix of
// entertaining and number posts and by results), the cover pattern and the call
// to action; the model writes inside that shape.
//
// Every step writes a row to `steps` as it happens, so any post can be traced
// from a slide back to the fact, the quote, the stored document and the approved
// source, and a blocked post says exactly where and why it stopped.
//
// Returns { postId, status: 'queued'|'sample'|'blocked', reason, kind }. `kind`
// names a blocked post's failure for the safety rails: 'fact_check' pauses the
// account in every mode, 'budget' pauses it until the money is there.

export class PausedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PausedError';
    this.code = 'paused';
  }
}

const pickBy = (list, seed) => list[[...String(seed)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];

/**
 * The hashtags for one post: the format's own, two broad, and the niche tags this
 * post is about (its words appear in the post's text), never more than five. A
 * niche tag the post does not touch ("#צמחיתבלין" under a post about a fern) is
 * left off: a reader sees an unrelated tag as pasted. Without the text (an older
 * caller), the niche tags rotate.
 */
export function hashtagsFor(pack, format, seed, text = null) {
  const h = pack.formats.hashtags || {};
  const rot = (list, k) => {
    if (!list?.length) return [];
    const start = [...String(seed + k)].reduce((a, c) => (a + c.charCodeAt(0)) % list.length, 0);
    return [...list.slice(start), ...list.slice(0, start)];
  };
  const flat = (s) => String(s || '').toLowerCase().replace(/[\s#_'"׳״-]+/g, '');
  // A tag is about the post when its letters are whole words of it, joined as a hashtag
  // joins them ("#ליגתהעל" is "ליגת העל"), with a one-letter prefix allowed ("למסי"). As
  // a substring of the whole text, "#מסי" matched "המסירות" and landed on a Zahavi post.
  const words = text == null ? null : String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const mentions = (tag) => {
    const want = flat(tag);
    for (let i = 0; i < words.length; i++) {
      let s = '';
      for (let k = i; k < Math.min(words.length, i + 4) && s.length <= want.length; k++) {
        s += words[k];
        if (s === want || (s.length === want.length + 1 && /^[ובכלמשה]/.test(s) && s.slice(1) === want)) return true;
      }
    }
    return false;
  };
  const niche = words == null ? rot(h.niche, 'n') : (h.niche || []).filter(mentions);
  const tags = [...(format.hashtags || []), ...rot(h.broad, 'b').slice(0, 2), ...niche];
  return [...new Set(tags)].slice(0, 5);
}

/**
 * The documents this account could post from now: fresh from its approved
 * sources, not used lately. A document a blocked or rejected post was drafted
 * from counts as used too, or the next post would draft the same failure again.
 */
export async function candidateDocs(ctx, pack, { usedWithinDays = 45, day = null } = {}) {
  const sources = ctx.db.all("SELECT * FROM sources WHERE account_id = ? AND status = 'approved' ORDER BY id", pack.id);
  // The pages of the events around this day, for a source that reads them (a fight week).
  const events = pack.meta.events ? upcoming(ctx.db, pack.id, day || israelDate(now()), 8).map((e) => decodeURIComponent(String(e.url || '').split('/wiki/')[1] || '').replace(/_/g, ' ')).filter(Boolean) : [];
  const docs = [];
  for (const src of sources) for (const d of await refreshSource(ctx.db, ctx.sources, src, { day, events })) docs.push({ ...d, sourceName: src.name, sourceKey: src.key });
  const since = new Date(now() - usedWithinDays * DAY).toISOString();
  const used = new Set(
    ctx.db
      .all("SELECT DISTINCT f.document_id FROM facts f JOIN posts p ON p.id = f.post_id WHERE p.account_id = ? AND p.created_at >= ?", pack.id, since)
      .map((r) => r.document_id)
  );
  const fresh = docs.filter((d) => !used.has(d.id));
  fresh.sort((a, b) => String(b.published_at || b.fetched_at).localeCompare(String(a.published_at || a.fetched_at)));
  return fresh;
}

/**
 * Documents read together: those that share a group (two articles for a
 * head-to-head) are one candidate. Each candidate has the key its recorded
 * drafts are filed under.
 */
export function candidatesOf(docs) {
  const out = new Map();
  for (const d of docs) {
    const k = d.group_key ? `g:${d.group_key}` : `d:${d.id}`;
    if (!out.has(k)) out.set(k, { key: d.group_key || d.key || String(d.id), docs: [] });
    out.get(k).docs.push(d);
  }
  // The documents of a group always in the same order (D1, D2...), whatever order they were read in:
  // a fact names its document by that number.
  for (const c of out.values()) c.docs.sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')) || a.id - b.id);
  return [...out.values()];
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_HE = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];

/** Does a text mention this day of the year (any year)? For on-this-day posts. */
export function mentionsDay(text, day) {
  const [, , m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '') || [];
  if (!m) return false;
  const mm = Number(m);
  const dd = Number(d);
  const s = String(text || '');
  const res = [
    new RegExp(`\\b${MONTHS_EN[mm - 1]} ${dd}\\b(?!\\d)`),
    new RegExp(`(?<!\\d)${dd} ${MONTHS_EN[mm - 1]}\\b`),
    new RegExp(`(?<!\\d)${dd} ${MONTHS_HE[mm - 1]}`),
    new RegExp(`\\d{4}-${m}-${d}(?!\\d)`),
    // A dated list (RSSSF): "27/10/2001 Austria Home 1-1".
    new RegExp(`(?<!\\d)${d}/${m}/\\d{4}`),
  ];
  return res.some((re) => re.test(s));
}

/** Every text of a post, labelled, for the checks. */
export function textsOf({ hook, sub, slides, caption, captionShort }) {
  const out = [
    { where: 'cover', kind: 'cover', text: hook },
    { where: 'cover line 2', kind: 'slideBody', text: sub },
  ];
  slides.forEach((s, i) => {
    if (s.kind !== 'item') return;
    out.push({ where: `slide ${i} title`, kind: 'slideTitle', text: s.title, idx: i, field: 'title', role: s.role });
    out.push({ where: `slide ${i} text`, kind: s.role === 'ranks' || s.role === 'layer' ? 'slideLines' : 'slideBody', text: s.body, idx: i, field: 'body', role: s.role });
  });
  // A post with an Instagram caption has TikTok's long one too; a phase 1 post has the one caption.
  out.push({ where: 'caption', kind: captionShort ? 'captionLong' : 'caption', text: caption });
  out.push({ where: 'caption short', kind: 'captionShort', text: captionShort });
  return out.filter((t) => t.text || t.kind === 'cover');
}

/**
 * The Instagram caption: the cover line again, then the short caption and the
 * question. Instagram shows a caption's first line under the picture, and the
 * hook is the line that stops a scroll. Null for a post with no short caption.
 */
export function igCaption({ hook, captionShort, question }) {
  if (!String(captionShort || '').trim()) return null;
  return [String(hook || '').trim(), joinCaption(captionShort, question)].filter(Boolean).join('\n\n');
}

/** What the gate and the token hold beyond the slides, in one fixed order. */
const extraOf = (d) => ({ captionIg: d.captionIg || '', keywords: d.keywords || [], subject: d.subject || {}, cta: d.cta?.text || '' });

/** The fact gate, with what this kind of post allows: its structure numbers, its fact-free roles. */
export function gateDraft(format, draft, facts) {
  const content = draft.slides.filter((s) => s.kind === 'item');
  return gate({
    slides: draft.slides, facts, caption: draft.caption, hook: draft.hook, sub: draft.sub || '', extra: extraOf(draft),
    structure: structureNumbers(format, content), factFree: (role) => factFree(format, role),
  });
}

const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;

/** Voice, rules, the kind's shape and the fact gate over a whole post. Returns { problems, gate }. */
export function checkPost(ctx, pack, draft, facts, format = null) {
  const problems = [];
  const f = format || { kind: 'list' };
  for (const t of textsOf(draft)) for (const x of tellsIn(t.text, { kind: t.kind, extra: pack.rules.bannedPhrases || [] })) problems.push({ where: t.where, code: `voice:${x.code}`, msg: x.msg });
  for (const x of checkRules({ pack, others: ctx.packs || [], texts: textsOf(draft) })) problems.push(x);
  if (kindName(f) !== 'list') {
    const content = draft.slides.filter((s) => s.kind === 'item');
    for (const msg of shapeProblems(f, content.map((s) => s.role))) problems.push({ where: 'shape', code: 'shape', msg });
    for (const msg of kindProblems(f, { ...draft, slides: content })) problems.push({ where: 'shape', code: 'shape', msg });
    // TikTok's search reads the slides and a long caption; Instagram shows the start of a short one.
    if (String(draft.caption || '').length < 200) problems.push({ where: 'caption', code: 'caption', msg: `the TikTok caption is ${String(draft.caption || '').length} characters: it needs 200 to 600` });
    if (String(draft.caption || '').length > 900) problems.push({ where: 'caption', code: 'caption', msg: 'the TikTok caption is over 900 characters' });
    if (!String(draft.captionShort || '').trim()) problems.push({ where: 'caption short', code: 'caption', msg: 'the Instagram caption (captionShort) is missing' });
    else if (String(draft.captionShort).length > 260) problems.push({ where: 'caption short', code: 'caption', msg: 'the Instagram caption is over 260 characters: it is the short one' });
    const kw = draft.keywords || [];
    if (kw.length < 2 || !kw.some((k) => HEBREW.test(k)) || !kw.some((k) => LATIN.test(k))) problems.push({ where: 'keywords', code: 'keywords', msg: 'keywords need at least one in Hebrew and one in English letters' });
    for (const s of content) {
      if (String(s.title || '').length > 70) problems.push({ where: `slide ${draft.slides.indexOf(s)} title`, code: 'length', msg: 'the title is over 70 characters' });
      if (String(s.body || '').length > 260) problems.push({ where: `slide ${draft.slides.indexOf(s)} text`, code: 'length', msg: 'the text is over 260 characters' });
    }
  }
  const g = gateDraft(f, draft, facts);
  for (const msg of g.problems) problems.push({ where: 'facts', code: 'verify', msg });
  return { problems, gate: g };
}

const say = (p) => `${p.where}: ${p.msg}`;

/**
 * The caption and its closing question, once, and never a generic one. A model
 * that already ended the caption with the question would otherwise ask it twice
 * ("ידעתם? ידעתם?"), and a generic engagement line ("ידעתם את זה?") is the most
 * bot-like line a post can have: the cost comparison caught both. Dropping it in
 * code costs nothing; a rewrite costs a call.
 */
export function joinCaption(caption, question) {
  const c = String(caption || '').trim();
  const q = isGenericQuestion(question) ? '' : String(question || '').trim();
  const flat = (s) => normHe(s).replace(/\s+/g, ' ');
  // A caption that already ends on a question takes no second one: two in a row read as a
  // bot (a blind review caught "the same question twice"), even when the words differ.
  if (!q || (c && flat(c).endsWith(flat(q))) || /\?\s*$/.test(c)) return c;
  return [c, q].filter(Boolean).join(' ');
}

/** Fix the mechanical tells in every text of a draft, in place. Returns what changed, per text. */
export function fixDraft(draft) {
  const out = [];
  const fix = (where, get, set) => {
    // A body of short lines (a layer, places 10 to 6) is fixed line by line, so its lines stay lines.
    const parts = String(get() || '').split('\n').map(mechanicalFix);
    const fixed = [...new Set(parts.flatMap((r) => r.fixed))];
    if (fixed.length) {
      set(parts.map((r) => r.text).filter(Boolean).join('\n'));
      out.push(`${where}: ${fixed.join(', ')}`);
    }
  };
  fix('cover', () => draft.hook, (v) => (draft.hook = v));
  fix('cover line 2', () => draft.sub, (v) => (draft.sub = v));
  fix('caption', () => draft.caption, (v) => (draft.caption = v));
  if (draft.captionShort) fix('caption short', () => draft.captionShort, (v) => (draft.captionShort = v));
  draft.slides.forEach((sl, i) => {
    if (sl.kind !== 'item') return;
    fix(`slide ${i} title`, () => sl.title, (v) => (sl.title = v));
    fix(`slide ${i} text`, () => sl.body, (v) => (sl.body = v));
  });
  if (draft.captionShort != null) draft.captionIg = igCaption(draft);
  return out;
}

/** Output room per call. The ceiling reserved for a call is priced on this, so it is no bigger than the answer needs. */
export const MAX_TOKENS = { outline: 10_000, slides: 8_000, rewrite: 6_000 };
export const EFFORT = { outline: 'medium', slides: 'medium', rewrite: 'medium' };

/**
 * The content items the outline planned, kept to those that still stand after
 * the facts were verified: an item with no verified fact goes, unless its role
 * carries none; a myth goes with its fact; a ranking cannot lose a place.
 */
export function keepItems(format, items, good) {
  const kind = kindName(format);
  const role = (it) => (kind === 'list' ? 'item' : String(it.role || ''));
  let kept = items.map((it) => ({ ...it, role: role(it), facts: (it.facts || []).filter((k) => good.has(k)) }));
  if (kind === 'myth-fact') {
    const pairs = [];
    for (let i = 0; i < kept.length; i++) {
      if (kept[i].role === 'myth' && kept[i + 1]?.role === 'fact') {
        if (kept[i + 1].facts.length) pairs.push(kept[i], kept[i + 1]);
        i++;
      }
    }
    return pairs;
  }
  if (kind === 'ranking') return kept.some((it) => !it.facts.length) ? kept.filter((it) => it.facts.length) : kept;
  kept = kept.filter((it) => it.facts.length || factFree(format, it.role));
  if (kind === 'list') kept = kept.slice(0, contentRange(format)[1]);
  return kept;
}

/**
 * The slides call's answer as a draft, fixed in code and checked: what buildPost
 * does with each answer, and what the launch set's tools check an answer with.
 * Returns { draft, checked, fixes }.
 */
export function draftFromAnswer(ctx, pack, { format, answer: d, outline, items, facts, closer = null, hook = null, cta = null }) {
  const legacy = kindName(format) === 'list';
  const draft = {
    hook: String(d.hook || '').trim(),
    sub: String(d.sub || '').trim(),
    // The code chose the pattern, so the results are credited to it whatever the answer says.
    hookPattern: hook?.id || null,
    subject: { a: '', b: '', answer: '', date: '', ...(outline.subject || {}), ...Object.fromEntries(Object.entries(d.subject || {}).filter(([, v]) => String(v || '').trim())) },
    keywords: (d.keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 6),
    question: String(d.question || '').trim(),
    caption: joinCaption(d.caption, d.question),
    captionShort: String(d.captionShort || '').trim(),
    cta,
    slides: [
      { kind: 'cover', role: 'cover', title: '', body: '', factKeys: [] },
      ...(d.slides || []).map((s, i) => ({
        kind: 'item', role: legacy ? 'item' : String(s.role || items[i]?.role || '').trim(),
        title: String(s.title || '').trim(), body: String(s.body || '').trim(), a: String(s.a || '').trim(), b: String(s.b || '').trim(), factKeys: (s.facts || []).map(String),
      })),
      ...(closer ? [{ kind: 'closer', role: 'closer', title: closer.title, body: closer.body || '', factKeys: [] }] : []),
    ],
  };
  draft.captionIg = igCaption(draft);
  // What code can fix, code fixes: no model call for a stray exclamation mark.
  const fixes = fixDraft(draft);
  const checked = checkPost(ctx, pack, draft, facts, format);
  // The slides follow the outline's plan: the same roles, in order.
  const roles = draft.slides.filter((s) => s.kind === 'item').map((s) => s.role).join(',');
  if (!legacy && roles !== items.map((it) => it.role).join(',')) checked.problems.unshift({ where: 'shape', code: 'shape', msg: `the slides must follow the outline's roles in order (${items.map((it) => it.role).join(', ')})` });
  return { draft, checked, fixes };
}

/**
 * What a slide's source line says for one fact: the source's name, and for an
 * encyclopedia the article itself ("ויקיפדיה: Ocimum basilicum"), since "English Wikipedia:
 * Lamiaceae" tells a reader nothing about where to look.
 */
export function sourceLabel(db, fact, { article = true } = {}) {
  const row = db.get('SELECT s.name, s.config_json, d.title FROM sources s LEFT JOIN documents d ON d.id = ? WHERE s.id = ?', fact.document_id, fact.source_id);
  if (!row) return null;
  const kind = j(row.config_json, {})?.api?.kind;
  if (kind === 'wikipedia') return article && row.title ? `ויקיפדיה: ${String(row.title).replace(/\s*\(Wikipedia[^)]*\)\s*$/, '')}` : 'ויקיפדיה';
  return row.name;
}

/** The post as a draft again, from what the database holds: for an edit, and for the gate before publishing. */
export function postDraft(post) {
  const data = post.data || {};
  const d = {
    hook: post.hook || '', sub: post.sub || '', caption: post.caption || '', captionShort: data.captionShort || '', question: data.question || '',
    subject: data.subject || {}, keywords: data.keywords || [], cta: data.cta || null, hookPattern: post.hook_pattern || '',
    slides: post.slides.map((s) => ({ kind: s.kind, role: s.role || (s.kind === 'item' ? 'item' : s.kind), title: s.title || '', body: s.body || '', a: s.data?.a || '', b: s.data?.b || '', factKeys: s.factKeys })),
  };
  d.captionIg = post.caption_ig || null;
  return d;
}

/** The format a stored post was made in, or the phase 1 list. */
export const formatOfPost = (db, pack, post) => resolveFormat(db, pack, post.format_id) || { id: post.format_id, kind: post.kind || 'list' };

export async function buildPost(ctx, { pack, formatKey = null, sample = false, slotAt = null, maxDocs = 6, subject = null, day = null, hookId = null, ctaText = null, docKey = null }) {
  const { db } = ctx;
  const account = db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
  if (!account) throw new Error(`no account row for ${pack.id}: sync the packs first`);
  if (!sample) {
    if (settings(db).globalKill) throw new PausedError('the global kill switch is on');
    if (account.status === 'paused') throw new PausedError(`${pack.id} is paused (${account.paused_reason})`);
  }

  ensureFormats(db, pack);
  const fkey = formatKey || pickFormat(db, pack.id, { groups: groupsOf(pack), mix: mixOf(db, pack) }) || pack.formats.formats[0].id;
  const resolve = (k) => resolveFormat(db, pack, k);
  let format = resolve(fkey) || pack.formats.formats[0];
  // When no fresh document fits the format the rotation picked, the others in the
  // same group are tried in turn rather than skipping the slot (then the rest);
  // a format asked for by name is not.
  const active = db.all("SELECT format_key FROM formats WHERE account_id = ? AND status = 'active'", pack.id).map((r) => r.format_key);
  const others = active.filter((k) => k !== format.id).map(resolve).filter(Boolean);
  const formatsToTry = formatKey ? [format] : [format, ...others.filter((f) => groupOf(f) === groupOf(format)), ...others.filter((f) => groupOf(f) !== groupOf(format))];
  // The day the post goes out: what an on-this-day post is about.
  const postDay = day || (slotAt ? israelDate(Date.parse(slotAt)) : israelDate(now()));
  const postId = newId('p');
  const at = nowIso();
  db.insert('posts', { id: postId, account_id: pack.id, format_id: format.id, kind: kindName(format), grp: groupOf(format), status: 'drafting', sample: sample ? 1 : 0, slot_at: slotAt, created_at: at, updated_at: at });
  const pctx = { ...ctx, pack, postId, sources: ctx.sourcesFor ? ctx.sourcesFor(pack) : ctx.sources };
  const finish = (status, patch = {}) => {
    const spend = postSpend(db, postId);
    db.update('posts', postId, { status, updated_at: nowIso(), cost_usd: spend.usd, cost_estimated: spend.estimated ? 1 : 0, ...patch });
    return { postId, status, reason: patch.reason || null, kind: patch.kind || null, cost: spend.usd };
  };
  const block = (kind, reason, detail = null) => {
    step(db, postId, 'blocked', 'failed', { kind, reason, ...(detail || {}) });
    return { ...finish('blocked', { reason }), kind };
  };

  try {
    guard(db, { pack, estimateUsd: 0 });
    // The pack's prefix is cached for an hour in a batch, whose rounds can be more than five minutes apart.
    const ttl = ctx.llm.batch ? '1h' : '5m';
    step(db, postId, 'format', 'info', { format: format.id, name: format.name, kind: kindName(format), group: groupOf(format) });

    // ---- topic: documents from approved sources
    const docs = await candidateDocs(pctx, pack, { day: postDay });
    step(db, postId, 'topic', docs.length ? 'ok' : 'failed', { candidates: docs.length, mode: pctx.sources.kind });
    if (!docs.length) return block('no_source', 'אין מסמכים חדשים מהמקורות המאושרים');
    let candidates = candidatesOf(docs);
    // One named document (or group): the launch set, and a test, ask for a post from exactly that.
    if (docKey) candidates = candidates.filter((c) => c.key === docKey);
    // A fight week's post is about its event; anything else about something else waits.
    if (subject?.terms?.length) {
      const about = (c) => c.docs.some((d) => subject.terms.every((t) => String(d.text).toLowerCase().includes(String(t).toLowerCase())));
      candidates = candidates.filter(about);
      step(db, postId, 'subject', candidates.length ? 'ok' : 'failed', { subject: subject.text, candidates: candidates.length });
      if (!candidates.length) return block('no_source', `אין מסמך על ${subject.text}`);
    }

    let outline = null;
    let cand = null;
    const recent = db
      .all("SELECT topic FROM posts WHERE account_id = ? AND topic IS NOT NULL AND status NOT IN ('blocked') ORDER BY created_at DESC LIMIT 12", pack.id)
      .map((r) => r.topic);
    tries: for (const f of formatsToTry) {
      // On this day: only documents that mention this day of the year.
      const pool = kindName(f) === 'on-this-day' ? candidates.filter((c) => c.docs.some((d) => mentionsDay(d.text, postDay))) : candidates;
      // At most maxDocs documents per format reach the model. A document with no
      // recording for this format (offline) never did, so it does not use up a turn.
      let tried = 0;
      for (const c of pool) {
        if (tried >= maxDocs) break;
        const refs = c.docs.map((d, i) => ({ ...d, ref: `D${i + 1}` }));
        const p = outlinePrompt(pack, { ttl });
        try {
          const res = await askJson(pctx, {
            task: 'outline', role: 'draft', system: p.system, user: outlineUser(f, refs, { avoid: recent, day: postDay, subject: subject?.text }), schema: p.schema, effort: EFFORT.outline, maxTokens: MAX_TOKENS.outline,
            meta: { recordingsDir: pack.recordingsDir, docKey: c.key, format: f.base || f.id, attempt: 0 },
          });
          tried++;
          if (!res.data.usable) {
            step(db, postId, 'outline', 'skipped', { format: f.id, documents: c.docs.map((d) => d.id), url: c.docs[0].url, why: res.data.why }, res.usd);
            continue;
          }
          outline = res.data;
          cand = { ...c, refs };
          format = f;
          step(db, postId, 'outline', 'ok', { format: f.id, documents: c.docs.map((d) => d.id), url: c.docs[0].url, topic: outline.topic, items: outline.items.length, facts: outline.facts.length }, res.usd);
          break tries;
        } catch (e) {
          if (e instanceof NoRecording) continue;
          throw e;
        }
      }
    }
    if (!outline) return block('no_source', 'אף מסמך חדש לא הספיק לפוסט באחד הפורמטים');
    db.update('posts', postId, { topic: outline.topic, format_id: format.id, kind: kindName(format), grp: groupOf(format) });

    // ---- facts: each verified against its stored document, before any slide is written
    const docOf = new Map(cand.refs.map((d) => [d.ref, d]));
    const facts = [];
    for (const f of outline.facts) {
      const d = docOf.get(String(f.doc || '').trim()) || (cand.refs.length === 1 ? cand.refs[0] : null);
      const row = { key: f.id, claim: f.claim, quote: f.quote, document_id: d?.id ?? null, source_id: d?.source_id ?? null };
      const v = verifyFact(db, row, { accountId: pack.id, maxQuoteWords: pack.rules.maxQuoteWords || 40 });
      facts.push({ ...row, verified: v.ok, error: v.error });
    }
    for (const f of facts) db.insert('facts', { post_id: postId, key: f.key, claim: f.claim, quote: f.quote, document_id: f.document_id, source_id: f.source_id, verified: f.verified ? 1 : 0, error: f.error });
    const good = new Set(facts.filter((f) => f.verified).map((f) => f.key));
    step(db, postId, 'facts', good.size ? 'ok' : 'failed', { verified: good.size, refused: facts.filter((f) => !f.verified).map((f) => ({ key: f.key, error: f.error })) });
    const items = keepItems(format, outline.items, good);
    const shape = kindName(format) === 'list' ? (items.length < format.items[0] ? [`only ${items.length}`] : []) : shapeProblems(format, items.map((it) => it.role));
    if (shape.length || !good.size) {
      const why = kindName(format) === 'list' ? `רק ${items.length} פריטים עם עובדה מאומתת, הפורמט צריך ${format.items[0]}` : `אחרי בדיקת העובדות הפוסט לא שומר על הצורה של ${kindOf(format).name}: ${shape.join('; ') || 'אין עובדות מאומתות'}`;
      return block('fact_check', why, { refused: facts.filter((f) => !f.verified).map((f) => f.error), shape });
    }
    const verifiedFacts = facts.filter((f) => f.verified);

    // ---- slides, then every check; one redraft with the reasons
    const sp = slidesPrompt(pack, { ttl });
    // The owner's own rewrites teach the voice; the three latest short ones are enough.
    const edits = db.all('SELECT before, after FROM edits WHERE account_id = ? AND length(after) <= 240 ORDER BY id DESC LIMIT 3', pack.id);
    const legacy = kindName(format) === 'list';
    const closer = legacy ? pickBy(format.closers, postId) : null;
    // A pattern and a call to action can be fixed in advance (the launch set does, so the text drafted for them and the post agree).
    const fixedHook = hookId ? hookPatterns(format).find((h) => h.id === hookId) : null;
    const hook = legacy ? null : fixedHook || pickHook(db, pack.id, format);
    const ctas = ctasOf(pack, format);
    const lastCta = db.get("SELECT json_extract(data_json, '$.cta.text') AS t FROM posts WHERE account_id = ? AND data_json IS NOT NULL AND status NOT IN ('blocked') ORDER BY created_at DESC LIMIT 1", pack.id)?.t;
    const fixedCta = ctaText ? ctas.find((c) => c.text === ctaText) : null;
    const cta = legacy || !ctas.length ? null : fixedCta || pickBy(ctas.length > 1 ? ctas.filter((c) => c.text !== lastCta) : ctas, postId);
    let draft = null;
    let checked = null;
    let lastProblems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await askJson(pctx, {
          task: 'slides', role: 'draft', system: sp.system, user: slidesUser({ format, n: items.length, outline: { ...outline, items }, facts: verifiedFacts, edits, problems: lastProblems.map(say), hook, cta }), schema: sp.schema,
          effort: EFFORT.slides, maxTokens: MAX_TOKENS.slides, meta: { recordingsDir: pack.recordingsDir, docKey: cand.key, format: format.base || format.id, attempt },
        });
      } catch (e) {
        if (e instanceof NoRecording && attempt > 0) break;
        throw e;
      }
      const made = draftFromAnswer(pctx, pack, { format, answer: res.data, outline, items, facts, closer, hook, cta });
      draft = made.draft;
      checked = made.checked;
      step(db, postId, attempt ? 'redraft' : 'slides', checked.problems.length ? 'failed' : 'ok', { problems: checked.problems.map(say), fixed: made.fixes }, res.usd);
      if (!checked.problems.length) break;
      lastProblems = checked.problems;
    }
    if (!draft) return block('voice', 'הטיוטה לא נכתבה');
    if (checked.problems.length) {
      // The law and honesty come first in the reason, then the facts, then the shape, then the voice.
      const rank = (p) => (/^(compliance|honesty|brand|rule)/.test(p.code) ? 0 : p.code === 'verify' ? 1 : /^(shape|caption|keywords|length)$/.test(p.code) ? 2 : 3);
      const sorted = checked.problems.slice().sort((a, b) => rank(a) - rank(b));
      const kind = rank(sorted[0]) === 0 ? 'rules' : rank(sorted[0]) === 1 ? 'fact_check' : rank(sorted[0]) === 2 ? 'shape' : 'voice';
      return block(kind, sorted.slice(0, 3).map(say).join(' · '), { problems: sorted.map(say) });
    }

    // ---- the second look: does it sound like a bot, and does any text say more
    // than its facts? The reviewer only scores. A text at 4+, or with a fact
    // problem, is rewritten by the drafting model in one call, and kept only if
    // it passes every check. A fact problem that is not fixed blocks the post:
    // the code gate proves every number is quoted, not that the sentence around
    // it is true to the quote.
    const texts = textsOf(draft);
    const review = await reviewTexts(pctx, { pack, texts, facts: verifiedFacts });
    const applied = [];
    // The rewrite is one bounded call on the flagged lines only, never a second
    // redraft of the post: it runs once even after the slides used their redraft
    // (measured: without it, half the posts a strong reviewer flagged were lost),
    // and whatever it does not fix drops the post.
    const flagged = review.reviews.map((r, i) => ({ ...r, index: i, where: texts[i].where, text: texts[i].text })).filter((r) => r.botScore >= REWRITE_AT || r.factProblem);
    if (flagged.length && pctx.llm.kind === 'claude') {
      const rp = rewritePrompt(pack, { ttl });
      try {
        const res = await askJson(pctx, {
          task: 'rewrite', role: 'rewrite', system: rp.system, user: rewriteUser({ flagged, facts: verifiedFacts }), schema: rp.schema, effort: EFFORT.rewrite, maxTokens: MAX_TOKENS.rewrite,
          meta: { recordingsDir: pack.recordingsDir, docKey: cand.key, format: format.base || format.id, attempt: 1 },
        });
        for (const rw of res.data.rewrites || []) {
          const t = texts[rw.index];
          const r = review.reviews[rw.index];
          if (!t || !r || (r.botScore < REWRITE_AT && !r.factProblem)) continue;
          const text = mechanicalFix(String(rw.text || '').trim()).text;
          if (!text) continue;
          const next = structuredClone(draft);
          if (t.where === 'cover') next.hook = text;
          else if (t.where === 'cover line 2') next.sub = text;
          else if (t.where === 'caption') next.caption = text;
          else if (t.where === 'caption short') next.captionShort = text;
          else next.slides[t.idx][t.field] = text;
          next.captionIg = igCaption(next);
          if (!checkPost(pctx, pack, next, facts, format).problems.length) {
            draft = next;
            applied.push({ where: t.where, from: t.text, to: text, score: r.botScore });
            r.rewritten = true;
          }
        }
        step(db, postId, 'rewrite', 'ok', { flagged: flagged.length, kept: applied.length }, res.usd);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        step(db, postId, 'rewrite', 'failed', { error: String(e.message).slice(0, 200) });
      }
    }
    const scores = review.reviews.map((r) => (r.rewritten ? Math.min(r.botScore, REWRITE_AT - 1) : r.botScore));
    const worst = Math.max(0, ...scores);
    const unfixed = review.reviews.map((r, i) => ({ ...r, where: texts[i].where })).filter((r) => r.factProblem && !r.rewritten);
    step(db, postId, 'review', worst >= BLOCK_AT || unfixed.length ? 'failed' : 'ok', { reviewer: review.reviewer, worst, scores: texts.map((t, i) => ({ where: t.where, score: review.reviews[i].botScore, tells: review.reviews[i].tells, factProblem: review.reviews[i].factProblem || undefined })), rewrites: applied });
    if (unfixed.length) return block('review', `הבודק מצא משפט שאומר יותר מהעובדות: ${unfixed.slice(0, 2).map((r) => `${r.where}: ${r.factProblem}`).join(' · ')}`);
    if (worst >= BLOCK_AT) return block('voice', `נשמע כמו בוט (${worst}/10)${applied.length ? ' גם אחרי שכתוב' : ''}`);

    // ---- the gate, final: this exact text, these facts
    const final = checkPost(pctx, pack, draft, facts, format);
    if (final.problems.length) return block('fact_check', final.problems.slice(0, 3).map(say).join(' · '));
    step(db, postId, 'verify', 'ok', { token: final.gate.token, facts: verifiedFacts.length, slides: draft.slides.length });

    // ---- a photograph, licensed, recorded and screened, where the kind puts one
    let image = null;
    const photoOn = kindOf(format).photo;
    if (pack.theme.options?.coverPhoto && photoOn && outline.imageQuery) {
      image = await findImage({ ...pctx, mode: ctx.mode }, { pack, query: outline.imageQuery, postId }).catch((e) => (ctx.log?.(`image: ${e.message}`), null));
      step(db, postId, 'image', image ? (image.safety === 'review' ? 'info' : 'ok') : 'skipped', image ? { provider: image.provider, license: image.license, author: image.author, source: image.source_url, on: photoOn, safety: image.safety, screen: j(image.safety_json, null) } : { query: outline.imageQuery, mode: ctx.mode });
    }

    // ---- render
    const factSource = new Map(facts.map((f) => [f.key, sourceLabel(db, f)]));
    // A guess-who's clue is sourced like any slide, but the article it came from is
    // usually the answer ("ויקיפדיה: Yossi Benayoun", which a review caught on every
    // clue): before the reveal, a slide names the source alone.
    const plainSource = new Map(facts.map((f) => [f.key, sourceLabel(db, f, { article: false })]));
    const slides = draft.slides.map((s) => ({ ...s, sources: s.factKeys.map((k) => (s.role === 'clue' ? plainSource : factSource).get(k)) }));
    const outDir = path.join(ctx.mediaDir || mediaDir(), 'posts', postId);
    const files = await renderPost({ pack, format, post: { id: postId, hook: draft.hook, sub: draft.sub, caption: draft.caption, token: final.gate.token, extra: extraOf(draft), ctaKind: draft.cta?.kind }, slides, photo: image, photoOn, outDir });
    step(db, postId, 'render', 'ok', { platforms: Object.keys(files), slides: slides.length });

    // ---- store and queue
    const tags = hashtagsFor(pack, format, postId, [draft.hook, draft.sub, draft.caption, ...(draft.keywords || []), ...draft.slides.map((s) => `${s.title} ${s.body}`)].join(' '));
    db.tx(() => {
      slides.forEach((s, i) =>
        db.insert('slides', {
          post_id: postId, idx: i, kind: s.kind, role: s.role || null, title: s.title, body: s.body, fact_ids_json: s.factKeys,
          data_json: s.a || s.b ? { a: s.a, b: s.b } : null,
          image_id: image && ((s.kind === 'cover' && photoOn === 'cover') || (photoOn === 'last' && i === slides.length - 1)) ? image.id : null,
          files_json: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v[i]])),
        })
      );
    });
    const status = sample ? 'sample' : 'queued';
    step(db, postId, 'queue', 'ok', { status, slot: slotAt });
    return finish(status, {
      hook: draft.hook, sub: draft.sub, caption: draft.caption, caption_ig: draft.captionIg, hashtags_json: tags, review_score: worst, hook_pattern: draft.hookPattern,
      data_json: { subject: draft.subject, keywords: draft.keywords, cta: draft.cta, captionShort: draft.captionShort, question: draft.question, day: kindName(format) === 'on-this-day' ? postDay : undefined },
      checks_json: { token: final.gate.token, reviewer: review.reviewer, scores, rewrites: applied, image: image ? image.id : null, imageSafety: image?.safety || null },
      media_json: files, ai_label: image?.ai_generated && image?.realistic ? 1 : 0,
    });
  } catch (e) {
    if (e instanceof BudgetError) return block('budget', e.message);
    step(db, postId, 'error', 'failed', { error: String(e.message).slice(0, 500) });
    return { ...finish('blocked', { reason: String(e.message).slice(0, 300) }), kind: e.code === 'overflow' || e.code === 'fonts' ? 'render' : 'error' };
  }
}

/** A stored post with its slides and facts, as the website and the publisher see it. */
export function loadPost(db, postId) {
  const post = db.get('SELECT * FROM posts WHERE id = ?', postId);
  if (!post) return null;
  const slides = db.all('SELECT * FROM slides WHERE post_id = ? ORDER BY idx', postId).map((s) => ({ ...s, factKeys: j(s.fact_ids_json, []), files: j(s.files_json, {}), data: j(s.data_json, null) }));
  const facts = db
    .all('SELECT f.*, d.url AS doc_url, d.title AS doc_title, d.fetched_at AS doc_fetched_at, s.name AS source_name, s.url AS source_url, s.status AS source_status FROM facts f LEFT JOIN documents d ON d.id = f.document_id LEFT JOIN sources s ON s.id = f.source_id WHERE f.post_id = ? ORDER BY f.id', postId)
    .map((f) => ({ ...f, verified: Boolean(f.verified) }));
  return { ...post, hashtags: j(post.hashtags_json, []), checks: j(post.checks_json, {}), media: j(post.media_json, {}), publish: j(post.publish_json, {}), data: j(post.data_json, {}), slides, facts };
}

export { linesOfBody, ranksOf };
