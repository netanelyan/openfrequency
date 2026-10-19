#!/usr/bin/env node
// npm run compare -- init                      the fixed topics, written once
// npm run compare -- next --config C --pack <id> --role draft
// npm run compare -- status
// npm run compare -- score
//
// The cost and quality comparison, before and after phase 2's cost changes, on a
// fixed set of 15 topics (5 recorded documents per pack, each with its format).
// Every config sees exactly the same documents.
//
//   A  before: the old prompts, Claude Opus 5.5 for drafting and for the review
//      (which scored and rewrote in one call), any check problem a redraft
//   B  model routing: the old prompts, Sonnet 5.5 drafting, Haiku 5.5 reviewing
//   C  after: Sonnet 5.5 and Haiku 5.5, the new prompts (the pack first and
//      cached, documents narrowed to their content, fewer examples), mechanical
//      tells fixed in code before any redraft, one redraft at most, a scoring-only
//      review and a rewrite only for a text it flagged
//   plus, on C's own calls, the Message Batches price and the cached prefix.
//
// THE ANSWERS ARE NOT BOUGHT. Nothing here calls the Anthropic API: the project's
// key is for the running engine, not for experiments. The answers are written by
// Claude Code subagents on the matching model, each one answering the exact
// request the engine would send, once, as the model would. This script plays the
// engine: `next` builds the next request from the answers so far (it verifies
// the facts, runs the checks, asks for a redraft or a review when the engine
// would) and says where to write the answer. `score` replays everything through
// the engine's own checks and writes the side by side files and the estimates.
//
// Costs here are ESTIMATES from token counts of the real prompts and answers at
// the published prices; the thinking a model does is not visible in an answer,
// so it is given as a range. docs/costs.md says how to measure the real thing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ofHome } from '../src/core/paths.js';
import { Db } from '../src/db/index.js';
import { loadAll, loadPack, resolvePackDir } from '../src/packs/load.js';
import { verifyFact } from '../src/verify/claims.js';
import { checkPost, fixDraft, joinCaption, textsOf } from '../src/pipeline/build.js';
import { storyCaption } from '../src/rules/caption.js';
import { outlinePrompt, outlineUser, rewritePrompt, rewriteUser, slidesPrompt, slidesUser } from '../src/pipeline/prompts.js';
import { REVIEW_SCHEMA, REVIEW_SYSTEM, reviewUser, REWRITE_AT, BLOCK_AT } from '../src/voice/review.js';
import { estimateTokens } from '../src/llm/index.js';
import { BATCH_FACTOR, MODEL_RATES } from '../src/budget/ledger.js';
import { factDocuments } from '../src/sources/facts.js';
import * as v1 from './compare/prompts-v1.js';
import { REVIEW_SCHEMA_V1, REVIEW_SYSTEM_V1, reviewUserV1 } from './compare/review-v1.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const ROOT = path.join(ofHome(), 'cost-compare');
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const W = (f, x) => (mkdirSync(path.dirname(f), { recursive: true }), writeFileSync(f, `${typeof x === 'string' ? x : JSON.stringify(x, null, 2)}\n`));

export const CONFIGS = {
  A: { name: 'before: Opus 5.5 everywhere, the old prompts', draft: 'claude-opus-5-5', review: 'claude-opus-5-5', prompts: 'v1' },
  B: { name: 'model routing: Sonnet 5.5 drafts, Haiku 5.5 reviews, the old prompts', draft: 'claude-sonnet-5-5', review: 'claude-haiku-5-5', prompts: 'v1' },
  C: { name: 'after: routing, the new prompts, code fixes, one redraft, review only when needed', draft: 'claude-sonnet-5-5', review: 'claude-haiku-5-5', prompts: 'v2' },
  // The reviewer, measured on its own: C's very drafts, reviewed by Opus instead of Haiku.
  D: { name: "C's drafts, reviewed by Opus 5.5 instead of Haiku 5.5", draft: 'claude-sonnet-5-5', review: 'claude-opus-5-5', prompts: 'v2', draftsFrom: 'C' },
  // And by Sonnet 5.5: a third of Opus's price. Is it as good a reader?
  F: { name: "C's drafts, reviewed by Sonnet 5.5", draft: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5', prompts: 'v2', draftsFrom: 'C' },
  // The engine as it stands after the comparison: C's drafts with a generic closing question
  // dropped in code, reviewed by Sonnet, the flagged lines rewritten once even after a redraft.
  G: { name: "final: C's drafts, generic questions dropped in code, Sonnet review, one rewrite of the flagged lines", draft: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5', prompts: 'v2', draftsFrom: 'C', engine: true },
  // After the comparison: the outline prompt says a date is a number too. Re-run where C lost every fact to dates.
  E: { name: 'C with "a date is a number too" in the prompt, where C lost its facts to dates', draft: 'claude-sonnet-5-5', review: 'claude-haiku-5-5', prompts: 'v2', only: ['ai-2'] },
};



// More of the money pack's new official sources, drafted with C only: not part of
// the comparison, they become the pack's recordings (npm run compare -- export),
// so its dry run shows what the new sources make.


const packCache = new Map();
const packOf = (id) => {
  if (!packCache.has(id)) packCache.set(id, loadPack(resolvePackDir(id)));
  return packCache.get(id);
};
let allPacks = null;
const packsAll = () => (allPacks ??= loadAll());

/** The document a topic is about: a recording, or a topic of the pack's hand-checked facts. */
function docOf(t) {
  const pack = packOf(t.pack);
  if (t.doc.startsWith('facts-')) {
    const d = factDocuments(path.join(pack.dir, 'facts')).find((x) => x.key === t.doc);
    return { ...d, source: 'facts', sourceName: pack.facts.name };
  }
  const d = J(path.join(pack.recordingsDir, 'documents', `${t.doc}.json`));
  const src = pack.sources.sources.find((s) => s.id === d.source);
  return { ...d, key: t.doc, sourceName: src?.name || d.source };
}

/** An in-memory engine for one topic: the account, its approved source, the stored document. */
function engineFor(t) {
  const db = new Db(':memory:');
  const pack = packOf(t.pack);
  const at = '2026-10-13T00:00:00Z';
  db.insert('accounts', { id: pack.id, display_name: pack.meta.displayName, handle: pack.meta.handle, created_at: at, updated_at: at });
  const d = docOf(t);
  const sid = db.insert('sources', { account_id: pack.id, key: d.source, type: 'api', url: d.url, name: d.sourceName, status: 'approved', origin: 'pack', created_at: at });
  const did = db.insert('documents', { source_id: sid, key: t.doc, url: d.url, title: d.title, text: d.text, sha256: 'x', fetched_at: at });
  return { db, pack, doc: { ...d, id: did, source_id: sid, ref: 'D1' } };
}

const dirOf = (kind, config, t) => path.join(ROOT, kind, config, t.id);
const has = (config, t, task) => existsSync(path.join(dirOf('answers', config, t), `${task}.json`));
const answer = (config, t, task) => J(path.join(dirOf('answers', config, t), `${task}.json`));

const sys = (s) => (Array.isArray(s) ? s : [{ text: s, cache: false }]);
function draftOf(d, format, { engine = false } = {}) {
  const closer = format.closers[0];
  return {
    hook: String(d.hook || '').trim(),
    sub: String(d.sub || '').trim(),
    caption: engine ? joinCaption(d.story ? storyCaption(d.story) : d.caption, d.question) : [String(d.caption || '').trim(), String(d.question || '').trim()].filter(Boolean).join(' '),
    slides: [
      { kind: 'cover', title: '', body: '', factKeys: [] },
      ...(d.slides || []).map((s) => ({ kind: 'item', title: String(s.title || '').trim(), body: String(s.body || '').trim(), factKeys: (s.facts || []).map(String) })),
      { kind: 'closer', title: closer.title, body: closer.body || '', factKeys: [] },
    ],
  };
}
const say = (p) => `${p.where}: ${p.msg}`;

/**
 * Replay one config on one topic as far as its answers go. Returns the trace and
 * either `need` (the next request the engine would send) or the final state.
 */
export function replay(config, t) {
  const C = CONFIGS[config];
  const v2 = C.prompts === 'v2';
  const { db, pack, doc } = engineFor(t);
  const format = pack.formats.formats.find((f) => f.id === t.format);
  const ctx = { db, packs: packsAll() };
  const calls = [];
  const out = { config, topic: t, calls, fixes: [], problems: [], redrafts: 0 };
  const need = (task, role, req) => ({ ...out, need: { task, role, model: role === 'review' ? C.review : C.draft, ...req } });

  // ---- outline
  const op = v2 ? outlinePrompt(pack, { ttl: '1h' }) : v1.outlinePrompt(pack, format);
  const oreq = { system: sys(op.system), user: v2 ? outlineUser(format, [doc], { avoid: [] }) : v1.outlineUser([doc], { avoid: [] }), schema: op.schema, effort: 'medium' };
  const dc = C.draftsFrom || config; // whose outline and slides these are
  if (!has(dc, t, 'outline')) return need('outline', 'draft', oreq);
  const outline = answer(dc, t, 'outline');
  calls.push({ task: 'outline', model: C.draft, req: oreq, ans: outline });
  if (!outline.usable) return { ...out, state: 'unusable', reason: outline.why };
  const facts = (outline.facts || []).map((f) => {
    const row = { key: f.id, claim: f.claim, quote: f.quote, document_id: doc.id, source_id: doc.source_id };
    const v = verifyFact(db, row, { accountId: pack.id, maxQuoteWords: pack.rules.maxQuoteWords || 40 });
    return { ...row, verified: v.ok, error: v.error };
  });
  out.facts = facts;
  const good = new Set(facts.filter((f) => f.verified).map((f) => f.key));
  const items = (outline.items || []).map((it) => ({ ...it, facts: (it.facts || []).filter((k) => good.has(k)) })).filter((it) => it.facts.length).slice(0, format.items[1]);
  const verified = facts.filter((f) => f.verified);
  if (items.length < format.items[0]) return { ...out, state: 'blocked', reason: `only ${items.length} items with a verified fact, the format needs ${format.items[0]}` };

  // ---- slides, then the checks; one redraft with the reasons
  let draft = null;
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const sp = v2 ? slidesPrompt(pack, { ttl: '1h' }) : v1.slidesPrompt(pack, format, { n: items.length });
    const sreq = {
      system: sys(sp.system),
      user: v2 ? slidesUser({ format, n: items.length, outline: { ...outline, items }, facts: verified, edits: [], problems: problems.map(say) }) : v1.slidesUser({ outline: { ...outline, items }, facts: verified, edits: [], problems: problems.map(say) }),
      schema: sp.schema,
      effort: 'medium',
    };
    const task = `slides-${attempt}`;
    if (!has(dc, t, task)) return need(task, 'draft', sreq);
    const ans = answer(dc, t, task);
    calls.push({ task, model: C.draft, req: sreq, ans });
    if (attempt) out.redrafts++;
    draft = draftOf(ans, format, { engine: C.engine });
    if (v2) out.fixes.push(...fixDraft(draft).map((x) => `${task} ${x}`));
    problems = checkPost(ctx, pack, draft, facts).problems;
    out.problems.push({ attempt, problems: problems.map(say) });
    if (!problems.length) break;
  }
  if (problems.length) return { ...out, draft, state: 'blocked', reason: problems.slice(0, 3).map(say).join(' · ') };

  // ---- the review
  const texts = textsOf(draft);
  const rreq = v2
    ? { system: sys(REVIEW_SYSTEM), user: reviewUser(pack, texts, verified), schema: REVIEW_SCHEMA, effort: 'low' }
    : { system: sys(REVIEW_SYSTEM_V1), user: reviewUserV1(pack, texts, verified), schema: REVIEW_SCHEMA_V1, effort: 'low' };
  if (!has(config, t, 'review')) return need('review', 'review', rreq);
  const review = answer(config, t, 'review');
  calls.push({ task: 'review', model: C.review, req: rreq, ans: review });
  const scores = texts.map((_, i) => (review.reviews || []).find((r) => r.index === i) || { botScore: 0, tells: [] });
  const applied = [];
  const apply = (i, text) => {
    const tx = texts[i];
    const next = structuredClone(draft);
    if (tx.where === 'cover') next.hook = text;
    else if (tx.where === 'cover line 2') next.sub = text;
    else if (tx.where === 'caption') next.caption = text;
    else next.slides[tx.idx][tx.field] = text;
    if (!checkPost(ctx, pack, next, facts).problems.length) {
      draft = next;
      applied.push({ where: tx.where, from: tx.text, to: text, score: scores[i].botScore });
      scores[i] = { ...scores[i], rewritten: true };
    }
  };
  if (!v2) {
    // v1: the review's own rewrites, every text at 4 or more.
    scores.forEach((r, i) => r.botScore >= REWRITE_AT && r.rewrite && apply(i, r.rewrite));
  } else {
    // As the engine does now: a text at 4+ or with a fact problem is rewritten once; a fact problem not fixed blocks the post.
    const flagged = scores.map((r, i) => ({ ...r, index: i, where: texts[i].where, text: texts[i].text, tells: r.tells || [] })).filter((r) => r.botScore >= REWRITE_AT || r.factProblem);
    if (flagged.length && (C.engine || !out.redrafts)) {
      const rp = rewritePrompt(pack, { ttl: '1h' });
      const wreq = { system: sys(rp.system), user: rewriteUser({ flagged, facts: verified }), schema: rp.schema, effort: 'medium' };
      if (!has(config, t, 'rewrite')) return need('rewrite', 'draft', wreq);
      const rw = answer(config, t, 'rewrite');
      calls.push({ task: 'rewrite', model: C.draft, req: wreq, ans: rw });
      out.redrafts++;
      for (const x of rw.rewrites || []) if (scores[x.index]?.botScore >= REWRITE_AT || scores[x.index]?.factProblem) apply(x.index, String(x.text || '').trim());
    }
  }
  const final = scores.map((r) => (r.rewritten ? Math.min(r.botScore, REWRITE_AT - 1) : r.botScore));
  const worst = Math.max(0, ...final);
  const unfixed = v2 ? scores.filter((r) => r.factProblem && !r.rewritten) : [];
  out.factProblems = scores.filter((r) => r.factProblem).length;
  if (unfixed.length) return { ...out, draft, review: scores, rewrites: applied, worst, state: 'blocked', reason: `a fact problem not fixed: ${unfixed[0].factProblem}` };
  return { ...out, draft, review: scores, rewrites: applied, worst, state: worst >= BLOCK_AT ? 'blocked' : 'ok', reason: worst >= BLOCK_AT ? `sounds like a bot (${worst}/10)` : null };
}

// ---------------------------------------------------------------- costs

const THINK = { low: 0.5, high: 2 }; // thinking tokens per answer token, low and high
const tokensIn = (req) => req.system.reduce((n, b) => n + estimateTokens(b.text), 0) + estimateTokens(req.user) + Math.ceil(estimateTokens(JSON.stringify(req.schema)) / 3) + 30;
const tokensOut = (ans) => estimateTokens(JSON.stringify(ans));
const prefixTokens = (req) => estimateTokens(req.system[0]?.cache ? req.system[0].text : '');

/**
 * One topic's calls priced several ways: direct, through a batch, through a
 * batch with the pack's prefix cached. Returns { low, high } for each.
 * The cache is reckoned per account per day: two posts share the prefix, its
 * first use is a 1-hour write (2x input) and the other calls of the day read it
 * at the cache price.
 */
function priceCalls(calls, { batch = false, cache = false } = {}) {
  const res = { low: 0, high: 0 };
  const draftCalls = calls.filter((c) => c.req.system[0]?.cache).length;
  for (const c of calls) {
    const r = MODEL_RATES[c.model];
    let inUsd = tokensIn(c.req) * r.in;
    if (cache && c.req.system[0]?.cache) {
      const p = prefixTokens(c.req);
      const perDay = 2 * draftCalls; // calls on this prefix in a day of two posts
      const avgPrefix = (p * r.write1h + (perDay - 1) * p * r.cacheRead) / perDay;
      inUsd = (tokensIn(c.req) - p) * r.in + avgPrefix;
    }
    const out = tokensOut(c.ans);
    for (const k of ['low', 'high']) res[k] += ((inUsd + out * (1 + THINK[k]) * r.out) / 1e6) * (batch ? BATCH_FACTOR : 1);
  }
  return res;
}

// ---------------------------------------------------------------- commands

// The topics live with the real packs, in $OF_HOME/cost-compare/topics.json:
//   { "topics": [{ id, pack, doc, format }], "extra": [...] }
// `topics` are the fixed 15 compared in every config; `extra` are drafted with C
// only, to become a pack's recordings (export).
function topicsFile() {
  const f = path.join(ROOT, 'topics.json');
  if (!existsSync(f)) throw new Error(`no ${f}: list the topics to compare there, { "topics": [{ "id", "pack", "doc", "format" }] }`);
  return J(f);
}
const topicsList = () => topicsFile().topics;
const extraList = () => topicsFile().extra || [];

if (cmd === 'init') {
  console.log(`${path.join(ROOT, 'topics.json')}: ${topicsList().length} topics, ${extraList().length} extra`);
} else if (cmd === 'next') {
  const config = opt('config');
  const role = opt('role', 'draft');
  const list = [...topicsList(), ...(config === 'C' ? extraList() : [])].filter((t) => (!opt('pack') || t.pack === opt('pack')) && (!CONFIGS[config].only || CONFIGS[config].only.includes(t.id)));
  let waiting = 0;
  for (const t of list) {
    const r = replay(config, t);
    if (!r.need) continue;
    if (r.need.role !== role) {
      waiting++;
      continue;
    }
    const pf = path.join(dirOf('prompts', config, t), `${r.need.task}.json`);
    const af = path.join(dirOf('answers', config, t), `${r.need.task}.json`);
    W(pf, { config, topic: t.id, task: r.need.task, model: r.need.model, effort: r.need.effort, system: r.need.system.map((b) => b.text).join('\n\n'), user: r.need.user, schema: r.need.schema });
    console.log(JSON.stringify({ status: 'answer', prompt: pf, answer: af, model: r.need.model, task: r.need.task, topic: t.id }));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: waiting ? 'wait' : 'done', waiting }));
} else if (cmd === 'status') {
  for (const config of Object.keys(CONFIGS)) {
    const rows = [...topicsList(), ...(config === 'C' ? extraList() : [])].filter((t) => !CONFIGS[config].only || CONFIGS[config].only.includes(t.id)).map((t) => replay(config, t));
    console.log(`${config}: ${rows.map((r) => `${r.topic.id}:${r.need ? `need ${r.need.task}` : r.state}`).join('  ')}`);
  }
} else if (cmd === 'export') {
  // Config C's answers become the pack's recordings: the outline, and the slides as
  // they were finally written (a redraft included), keyed by document and format.
  const pack = packOf(opt('pack'));
  let n = 0;
  for (const t of [...topicsList(), ...extraList()].filter((x) => x.pack === pack.id)) {
    if (!has('C', t, 'outline')) continue;
    const slides = has('C', t, 'slides-1') ? answer('C', t, 'slides-1') : has('C', t, 'slides-0') ? answer('C', t, 'slides-0') : null;
    const f = path.join(pack.recordingsDir, 'drafts', `${t.doc}.json`);
    if (existsSync(f) && !args.includes('--overwrite')) continue;
    W(f, { document: t.doc, format: t.format, written: 'Claude Code subagent on claude-sonnet-5-5, from the engine\'s exact prompt (npm run compare)', outline: answer('C', t, 'outline'), ...(slides ? { slides } : {}) });
    n++;
  }
  console.log(`${n} recording(s) written to ${path.join(pack.recordingsDir, 'drafts')}`);
} else if (cmd === 'score') {
  const topics = topicsList();
  const lines = ['# Cost and quality comparison', '', `Written by \`npm run compare -- score\`, ${new Date().toISOString().slice(0, 10)}. Answers written by Claude Code subagents on each config's models; prices are estimates from token counts (thinking as a range). See docs/costs.md.`, ''];
  const sum = {};
  const table = ['| Topic | ' + Object.keys(CONFIGS).map((c) => `${c} status | ${c} facts | ${c} redrafts | ${c} worst bot`).join(' | ') + ' |', `|---|${Object.keys(CONFIGS).map(() => '---|---|---|---').join('|')}|`];
  for (const t of topics) {
    const md = [`# ${t.id}: ${t.pack} / ${t.doc} / ${t.format}`, ''];
    const row = [t.id];
    for (const [config, C] of Object.entries(CONFIGS)) {
      if (C.only && !C.only.includes(t.id)) {
        row.push('', '', '', '');
        continue;
      }
      const r = replay(config, t);
      const s = (sum[config] ??= { posts: 0, ok: 0, calls: 0, redrafts: 0, rewrites: 0, fixes: 0, direct: { low: 0, high: 0 }, batch: { low: 0, high: 0 }, cached: { low: 0, high: 0 }, inTok: 0, outTok: 0, missing: 0 });
      if (r.need) {
        s.missing++;
        row.push('missing', '', '', '');
        md.push(`## ${config}: ${C.name}`, '', `Not answered yet: ${r.need.task}.`, '');
        continue;
      }
      s.posts++;
      if (r.state === 'ok') s.ok++;
      s.calls += r.calls.length;
      s.redrafts += r.calls.filter((c) => c.task === 'slides-1').length;
      s.rewrites += r.calls.filter((c) => c.task === 'rewrite').length;
      s.fixes += r.fixes.length;
      for (const c of r.calls) {
        s.inTok += tokensIn(c.req);
        s.outTok += tokensOut(c.ans);
      }
      const direct = priceCalls(r.calls);
      const batch = CONFIGS[config].prompts === 'v2' ? priceCalls(r.calls, { batch: true }) : direct;
      const cached = CONFIGS[config].prompts === 'v2' ? priceCalls(r.calls, { batch: true, cache: true }) : direct;
      for (const [k, v] of [['direct', direct], ['batch', batch], ['cached', cached]]) for (const b of ['low', 'high']) s[k][b] += v[b];
      const ver = (r.facts || []).filter((f) => f.verified).length;
      row.push(r.state, `${ver}/${(r.facts || []).length}`, String(r.calls.filter((c) => c.task === 'slides-1' || c.task === 'rewrite').length), r.worst != null ? String(r.worst) : '-');
      md.push(`## ${config}: ${C.name}`, '', `**${r.state}**${r.reason ? `: ${r.reason}` : ''}. Calls: ${r.calls.map((c) => c.task).join(', ')}. Estimated cost: $${direct.low.toFixed(4)} to $${direct.high.toFixed(4)}${CONFIGS[config].prompts === 'v2' ? ` direct, $${cached.low.toFixed(4)} to $${cached.high.toFixed(4)} batched and cached` : ''}.`, '');
      if (r.facts) md.push(`Facts verified: ${ver} of ${r.facts.length}.${r.facts.filter((f) => !f.verified).map((f) => ` ${f.key}: ${f.error}.`).join('')}`, '');
      if (r.draft) {
        md.push(`- **Cover:** ${r.draft.hook}`, r.draft.sub ? `- **Line 2:** ${r.draft.sub}` : '', ...r.draft.slides.filter((x) => x.kind === 'item').map((x, i) => `- **${i + 1}. ${x.title}** ${x.body} _(${x.factKeys.join(', ')})_`), `- **Caption:** ${r.draft.caption}`, '');
      }
      if (r.fixes.length) md.push(`Fixed in code: ${r.fixes.join('; ')}.`, '');
      for (const p of r.problems.filter((x) => x.problems.length)) md.push(`Checks on attempt ${p.attempt}: ${p.problems.join(' · ')}`, '');
      if (r.review) md.push(`Bot scores: ${r.review.map((x, i) => `${i}:${x.botScore}${x.tells?.length ? ` (${x.tells.join(', ')})` : ''}${x.rewritten ? ' rewritten' : ''}`).join(' · ')}`, '');
      for (const w of r.rewrites || []) md.push(`Rewrite kept (${w.where}, ${w.score}): ${w.from} → ${w.to}`, '');
    }
    W(path.join(ROOT, `${t.id}.md`), md.filter((x) => x !== '').join('\n\n'));
    table.push(`| ${row.join(' | ')} |`);
  }
  lines.push(...table, '', '## Per config', '', '| Config | Posts answered | Queued | Calls | Redrafts | Rewrites | Fixed in code | Tokens in / out (est.) | Per post, direct | Per post, batch | Per post, batch + cache |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [config, s] of Object.entries(sum)) {
    const per = (v) => (s.posts ? `$${(v.low / s.posts).toFixed(4)} to $${(v.high / s.posts).toFixed(4)}` : '-');
    lines.push(`| ${config} | ${s.posts} | ${s.ok} | ${s.calls} | ${s.redrafts} | ${s.rewrites} | ${s.fixes} | ${s.inTok} / ${s.outTok} | ${per(s.direct)} | ${CONFIGS[config].prompts === 'v2' ? per(s.batch) : '-'} | ${CONFIGS[config].prompts === 'v2' ? per(s.cached) : '-'} |`);
  }
  // Per step: what an average call of each kind costs, direct and batched with the cache.
  lines.push('', '## Per step (average per call, low to high thinking)', '', '| Config | Step | Calls | Tokens in | Tokens out | Direct | Batch + cache |', '|---|---|---|---|---|---|---|');
  for (const config of Object.keys(CONFIGS)) {
    const by = {};
    for (const t of topics) {
      if (CONFIGS[config].only && !CONFIGS[config].only.includes(t.id)) continue;
      const r = replay(config, t);
      for (const c of r.calls || []) {
        const k = c.task.replace(/-\d$/, '');
        const b = (by[k] ??= { n: 0, in: 0, out: 0, d: { low: 0, high: 0 }, c: { low: 0, high: 0 } });
        b.n++;
        b.in += tokensIn(c.req);
        b.out += tokensOut(c.ans);
        const d = priceCalls([c]);
        const cc = CONFIGS[config].prompts === 'v2' ? priceCalls([c], { batch: true, cache: true }) : d;
        for (const x of ['low', 'high']) (b.d[x] += d[x]), (b.c[x] += cc[x]);
      }
    }
    for (const [k, b] of Object.entries(by)) lines.push(`| ${config} | ${k} | ${b.n} | ${Math.round(b.in / b.n)} | ${Math.round(b.out / b.n)} | $${(b.d.low / b.n).toFixed(4)} to $${(b.d.high / b.n).toFixed(4)} | ${CONFIGS[config].prompts === 'v2' ? `$${(b.c.low / b.n).toFixed(4)} to $${(b.c.high / b.n).toFixed(4)}` : '-'} |`);
  }
  W(path.join(ROOT, 'summary.md'), lines.join('\n'));
  W(path.join(ROOT, 'summary.json'), sum);
  console.log(lines.join('\n'));
} else {
  console.error('usage: npm run compare -- init | next --config A|B|C [--pack id] --role draft|review | status | score');
  process.exit(1);
}
