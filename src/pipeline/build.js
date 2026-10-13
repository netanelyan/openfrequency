import path from 'node:path';
import { newId, nowIso, now, DAY } from '../core/clock.js';
import { mediaDir } from '../core/paths.js';
import { step, settings } from '../core/store.js';
import { j } from '../db/index.js';
import { BudgetError, guard, postSpend } from '../budget/ledger.js';
import { askJson } from '../llm/index.js';
import { NoRecording } from '../llm/recorded.js';
import { refreshSource } from '../sources/index.js';
import { ensureFormats, pickFormat } from '../formats/rotation.js';
import { tellsIn } from '../voice/tells.js';
import { BLOCK_AT, REWRITE_AT, reviewTexts } from '../voice/review.js';
import { checkRules } from '../rules/check.js';
import { gate, verifyFact } from '../verify/claims.js';
import { findImage } from '../images/index.js';
import { renderPost } from '../render/render.js';
import { outlinePrompt, outlineUser, slidesPrompt, slidesUser } from './prompts.js';

// One post, from topic to a rendered, queued slideshow:
//
//   topic -> facts from approved sources -> outline -> slides -> voice and tell
//   checks -> fact verification -> render -> queue
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

/** The hashtags for one post: two broad, up to three niche, and the format's own, never more than five. */
export function hashtagsFor(pack, format, seed) {
  const h = pack.formats.hashtags || {};
  const rot = (list, k) => {
    if (!list?.length) return [];
    const start = [...String(seed + k)].reduce((a, c) => (a + c.charCodeAt(0)) % list.length, 0);
    return [...list.slice(start), ...list.slice(0, start)];
  };
  const tags = [...(format.hashtags || []), ...rot(h.broad, 'b').slice(0, 2), ...rot(h.niche, 'n')];
  return [...new Set(tags)].slice(0, 5);
}

/** The documents this account could post from now: fresh from its approved sources, not used lately. */
export async function candidateDocs(ctx, pack, { usedWithinDays = 45 } = {}) {
  const sources = ctx.db.all("SELECT * FROM sources WHERE account_id = ? AND status = 'approved' ORDER BY id", pack.id);
  const docs = [];
  for (const src of sources) for (const d of await refreshSource(ctx.db, ctx.sources, src)) docs.push({ ...d, sourceName: src.name, sourceKey: src.key });
  const since = new Date(now() - usedWithinDays * DAY).toISOString();
  const used = new Set(
    ctx.db
      .all("SELECT DISTINCT f.document_id FROM facts f JOIN posts p ON p.id = f.post_id WHERE p.account_id = ? AND p.status NOT IN ('blocked','rejected') AND p.created_at >= ?", pack.id, since)
      .map((r) => r.document_id)
  );
  const fresh = docs.filter((d) => !used.has(d.id));
  fresh.sort((a, b) => String(b.published_at || b.fetched_at).localeCompare(String(a.published_at || a.fetched_at)));
  return fresh;
}

/** Every text of a post, labelled, for the checks. */
export function textsOf({ hook, sub, slides, caption }) {
  const out = [
    { where: 'cover', kind: 'cover', text: hook },
    { where: 'cover line 2', kind: 'slideBody', text: sub },
  ];
  slides.forEach((s, i) => {
    if (s.kind !== 'item') return;
    out.push({ where: `slide ${i} title`, kind: 'slideTitle', text: s.title, idx: i, field: 'title' });
    out.push({ where: `slide ${i} text`, kind: 'slideBody', text: s.body, idx: i, field: 'body' });
  });
  out.push({ where: 'caption', kind: 'caption', text: caption });
  return out.filter((t) => t.text || t.kind === 'cover');
}

/** Voice, rules and the fact gate over a whole post. Returns { problems, gate }. */
export function checkPost(ctx, pack, draft, facts) {
  const problems = [];
  for (const t of textsOf(draft)) for (const x of tellsIn(t.text, { kind: t.kind, extra: pack.rules.bannedPhrases || [] })) problems.push({ where: t.where, code: `voice:${x.code}`, msg: x.msg });
  for (const x of checkRules({ pack, others: ctx.packs || [], texts: textsOf(draft) })) problems.push(x);
  const g = gate({ slides: draft.slides, facts, caption: draft.caption, hook: draft.hook, sub: draft.sub });
  for (const msg of g.problems) problems.push({ where: 'facts', code: 'verify', msg });
  return { problems, gate: g };
}

const say = (p) => `${p.where}: ${p.msg}`;

export async function buildPost(ctx, { pack, formatKey = null, sample = false, slotAt = null, maxDocs = 6 }) {
  const { db } = ctx;
  const account = db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
  if (!account) throw new Error(`no account row for ${pack.id}: sync the packs first`);
  if (!sample) {
    if (settings(db).globalKill) throw new PausedError('the global kill switch is on');
    if (account.status === 'paused') throw new PausedError(`${pack.id} is paused (${account.paused_reason})`);
  }

  ensureFormats(db, pack);
  const fkey = formatKey || pickFormat(db, pack.id) || pack.formats.formats[0].id;
  let format = pack.formats.formats.find((f) => f.id === fkey) || pack.formats.formats[0];
  // When no fresh document fits the format the rotation picked, the others are
  // tried in turn rather than skipping the slot; a format asked for by name is not.
  const active = new Set(db.all("SELECT format_key FROM formats WHERE account_id = ? AND status = 'active'", pack.id).map((r) => r.format_key));
  const formatsToTry = formatKey ? [format] : [format, ...pack.formats.formats.filter((f) => f.id !== format.id && active.has(f.id))];
  const postId = newId('p');
  const at = nowIso();
  db.insert('posts', { id: postId, account_id: pack.id, format_id: format.id, status: 'drafting', sample: sample ? 1 : 0, slot_at: slotAt, created_at: at, updated_at: at });
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
    guard(db, { pack, estimateUsd: 0.05 });
    step(db, postId, 'format', 'info', { format: format.id, name: format.name });

    // ---- topic: a document from an approved source
    const docs = await candidateDocs(pctx, pack);
    step(db, postId, 'topic', docs.length ? 'ok' : 'failed', { candidates: docs.length, mode: pctx.sources.kind });
    if (!docs.length) return block('no_source', 'אין מסמכים חדשים מהמקורות המאושרים');

    let outline = null;
    let doc = null;
    const recent = db
      .all("SELECT topic FROM posts WHERE account_id = ? AND topic IS NOT NULL AND status NOT IN ('blocked') ORDER BY created_at DESC LIMIT 12", pack.id)
      .map((r) => r.topic);
    tries: for (const f of formatsToTry) {
      for (const d of docs.slice(0, maxDocs)) {
        const ref = { ...d, ref: 'D1' };
        const p = outlinePrompt(pack, f);
        try {
          const res = await askJson(pctx, {
            task: 'outline', role: 'draft', system: p.system, user: outlineUser([ref], { avoid: recent }), schema: p.schema, effort: 'medium', maxTokens: 12000, expectOut: 3000,
            meta: { recordingsDir: pack.recordingsDir, docKey: d.key, format: f.id, attempt: 0 },
          });
          if (!res.data.usable) {
            step(db, postId, 'outline', 'skipped', { format: f.id, document: d.id, url: d.url, why: res.data.why }, res.usd);
            continue;
          }
          outline = res.data;
          doc = d;
          format = f;
          step(db, postId, 'outline', 'ok', { format: f.id, document: d.id, url: d.url, topic: outline.topic, items: outline.items.length, facts: outline.facts.length }, res.usd);
          break tries;
        } catch (e) {
          if (e instanceof NoRecording) continue;
          throw e;
        }
      }
    }
    if (!outline) return block('no_source', 'אף מסמך חדש לא הספיק לפוסט באחד הפורמטים');
    db.update('posts', postId, { topic: outline.topic, format_id: format.id });

    // ---- facts: each verified against the stored document, before any slide is written
    const facts = [];
    for (const f of outline.facts) {
      const row = { key: f.id, claim: f.claim, quote: f.quote, document_id: doc.id, source_id: doc.source_id };
      const v = verifyFact(db, row, { accountId: pack.id, maxQuoteWords: pack.rules.maxQuoteWords || 40 });
      facts.push({ ...row, verified: v.ok, error: v.error });
    }
    for (const f of facts) db.insert('facts', { post_id: postId, key: f.key, claim: f.claim, quote: f.quote, document_id: f.document_id, source_id: f.source_id, verified: f.verified ? 1 : 0, error: f.error });
    const good = new Set(facts.filter((f) => f.verified).map((f) => f.key));
    step(db, postId, 'facts', good.size ? 'ok' : 'failed', { verified: good.size, refused: facts.filter((f) => !f.verified).map((f) => ({ key: f.key, error: f.error })) });
    const items = outline.items
      .map((it) => ({ ...it, facts: it.facts.filter((k) => good.has(k)) }))
      .filter((it) => it.facts.length)
      .slice(0, format.items[1]);
    if (items.length < format.items[0]) {
      return block('fact_check', `רק ${items.length} פריטים עם עובדה מאומתת, הפורמט צריך ${format.items[0]}`, { refused: facts.filter((f) => !f.verified).map((f) => f.error) });
    }
    const verifiedFacts = facts.filter((f) => f.verified);

    // ---- slides, then every check; one redraft with the reasons
    const sp = slidesPrompt(pack, format, { n: items.length });
    const edits = db.all('SELECT before, after FROM edits WHERE account_id = ? ORDER BY id DESC LIMIT 5', pack.id);
    const closer = pickBy(format.closers, postId);
    let draft = null;
    let checked = null;
    let lastProblems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await askJson(pctx, {
          task: 'slides', role: 'draft', system: sp.system, user: slidesUser({ outline: { ...outline, items }, facts: verifiedFacts, edits, problems: lastProblems.map(say) }), schema: sp.schema,
          effort: 'medium', maxTokens: 12000, expectOut: 2500, meta: { recordingsDir: pack.recordingsDir, docKey: doc.key, format: format.id, attempt },
        });
      } catch (e) {
        if (e instanceof NoRecording && attempt > 0) break;
        throw e;
      }
      const d = res.data;
      draft = {
        hook: String(d.hook || '').trim(),
        sub: String(d.sub || '').trim(),
        caption: [String(d.caption || '').trim(), String(d.question || '').trim()].filter(Boolean).join(' '),
        slides: [
          { kind: 'cover', title: '', body: '', factKeys: [] },
          ...(d.slides || []).map((s) => ({ kind: 'item', title: String(s.title || '').trim(), body: String(s.body || '').trim(), factKeys: (s.facts || []).map(String) })),
          { kind: 'closer', title: closer.title, body: closer.body || '', factKeys: [] },
        ],
      };
      checked = checkPost(pctx, pack, draft, facts);
      step(db, postId, attempt ? 'redraft' : 'slides', checked.problems.length ? 'failed' : 'ok', { problems: checked.problems.map(say) }, res.usd);
      if (!checked.problems.length) break;
      lastProblems = checked.problems;
    }
    if (!draft) return block('voice', 'הטיוטה לא נכתבה');
    if (checked.problems.length) {
      // The law and honesty come first in the reason, then the facts, then the voice.
      const rank = (p) => (/^(compliance|honesty|brand|rule)/.test(p.code) ? 0 : p.code === 'verify' ? 1 : 2);
      const sorted = checked.problems.slice().sort((a, b) => rank(a) - rank(b));
      const kind = rank(sorted[0]) === 0 ? 'rules' : rank(sorted[0]) === 1 ? 'fact_check' : 'voice';
      return block(kind, sorted.slice(0, 3).map(say).join(' · '), { problems: sorted.map(say) });
    }

    // ---- the second model: does it sound like a bot? Rewrites at 4+, kept only if they pass every check.
    const texts = textsOf(draft);
    const review = await reviewTexts(pctx, { pack, texts, facts: verifiedFacts });
    const applied = [];
    review.reviews.forEach((r, i) => {
      const t = texts[i];
      if (r.botScore < REWRITE_AT || !r.rewrite) return;
      const next = structuredClone(draft);
      if (t.where === 'cover') next.hook = r.rewrite;
      else if (t.where === 'cover line 2') next.sub = r.rewrite;
      else if (t.where === 'caption') next.caption = r.rewrite;
      else next.slides[t.idx][t.field] = r.rewrite;
      const c = checkPost(pctx, pack, next, facts);
      if (!c.problems.length) {
        draft = next;
        applied.push({ where: t.where, from: t.text, to: r.rewrite, score: r.botScore });
        r.rewritten = true;
      }
    });
    const scores = review.reviews.map((r) => (r.rewritten ? Math.min(r.botScore, REWRITE_AT - 1) : r.botScore));
    const worst = Math.max(0, ...scores);
    step(db, postId, 'review', worst >= BLOCK_AT ? 'failed' : 'ok', { reviewer: review.reviewer, worst, scores: texts.map((t, i) => ({ where: t.where, score: review.reviews[i].botScore, tells: review.reviews[i].tells })), rewrites: applied });
    if (worst >= BLOCK_AT) return block('voice', `נשמע כמו בוט (${worst}/10) גם אחרי שכתוב`);

    // ---- the gate, final: this exact text, these facts
    const final = checkPost(pctx, pack, draft, facts);
    if (final.problems.length) return block('fact_check', final.problems.slice(0, 3).map(say).join(' · '));
    step(db, postId, 'verify', 'ok', { token: final.gate.token, facts: verifiedFacts.length, slides: draft.slides.length });

    // ---- a cover photograph, licensed and recorded, when the theme wants one
    let image = null;
    if (pack.theme.options?.coverPhoto && outline.imageQuery) {
      image = await findImage({ ...pctx, mode: ctx.mode }, { pack, query: outline.imageQuery, postId }).catch((e) => (ctx.log?.(`image: ${e.message}`), null));
      step(db, postId, 'image', image ? 'ok' : 'skipped', image ? { provider: image.provider, license: image.license, author: image.author, source: image.source_url } : { query: outline.imageQuery, mode: ctx.mode });
    }

    // ---- render
    const sourceName = new Map(db.all('SELECT id, name FROM sources WHERE account_id = ?', pack.id).map((r) => [r.id, r.name]));
    const factSource = new Map(facts.map((f) => [f.key, sourceName.get(f.source_id)]));
    const slides = draft.slides.map((s) => ({ ...s, sources: s.factKeys.map((k) => factSource.get(k)) }));
    const outDir = path.join(ctx.mediaDir || mediaDir(), 'posts', postId);
    const files = await renderPost({ pack, post: { id: postId, hook: draft.hook, sub: draft.sub, caption: draft.caption, token: final.gate.token }, slides, photo: image, outDir });
    step(db, postId, 'render', 'ok', { platforms: Object.keys(files), slides: slides.length });

    // ---- store and queue
    const tags = hashtagsFor(pack, format, postId);
    db.tx(() => {
      slides.forEach((s, i) =>
        db.insert('slides', {
          post_id: postId, idx: i, kind: s.kind, title: s.title, body: s.body, fact_ids_json: s.factKeys,
          image_id: s.kind === 'cover' && image ? image.id : null,
          files_json: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v[i]])),
        })
      );
    });
    const status = sample ? 'sample' : 'queued';
    step(db, postId, 'queue', 'ok', { status, slot: slotAt });
    return finish(status, {
      hook: draft.hook, sub: draft.sub, caption: draft.caption, hashtags_json: tags, review_score: worst,
      checks_json: { token: final.gate.token, reviewer: review.reviewer, scores, rewrites: applied, image: image ? image.id : null },
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
  const slides = db.all('SELECT * FROM slides WHERE post_id = ? ORDER BY idx', postId).map((s) => ({ ...s, factKeys: j(s.fact_ids_json, []), files: j(s.files_json, {}) }));
  const facts = db
    .all('SELECT f.*, d.url AS doc_url, d.title AS doc_title, d.fetched_at AS doc_fetched_at, s.name AS source_name, s.url AS source_url, s.status AS source_status FROM facts f LEFT JOIN documents d ON d.id = f.document_id LEFT JOIN sources s ON s.id = f.source_id WHERE f.post_id = ? ORDER BY f.id', postId)
    .map((f) => ({ ...f, verified: Boolean(f.verified) }));
  return { ...post, hashtags: j(post.hashtags_json, []), checks: j(post.checks_json, {}), media: j(post.media_json, {}), publish: j(post.publish_json, {}), slides, facts };
}
