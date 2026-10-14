#!/usr/bin/env node
// npm run launch -- next   --pack <id>              the next requests to answer
// npm run launch -- redo   --pack <id> --n <k> [--stage outline|slides] [--notes <file>]
// npm run launch -- build  --pack <id>              drafts -> recordings -> posts, exported
// npm run launch -- review --pack <id>              the blind review requests
// npm run launch -- status --pack <id>
//
// The launch set: the first posts of a new account, the ones its owner approves
// to fill the grid before the account goes public. Planned in
// $OF_HOME/launch/<pack>/plan.json:
//
//   { "posts": [ { "n": 1, "format": "<format id>", "doc": "<recording key or group>",
//                  "day": "YYYY-MM-DD" (on-this-day), "subject": "..." (optional),
//                  "hook": "<hook id>", "cta": "<cta text>" (chosen here when absent) } ] }
//
// THE ANSWERS ARE NOT BOUGHT. Nothing here calls the Anthropic API. Each request
// is exactly what the engine would send (src/pipeline/prompts.js), written to a
// file; a Claude Code subagent on the drafting model answers it, once, and this
// script checks the answer with the engine's own code: the facts verified
// against the stored document, the kind's shape, the voice and the gate. A
// slides answer the checks refuse gets the engine's one redraft, with the
// reasons. A drafted post then takes the engine's review (the reviewing model's
// exact request) and the one rewrite of what it flags, each rewrite kept only if
// the post still passes every check, as src/pipeline/build.js does with a live
// client; a recorded build cannot, so it is done here (requests NN-review and
// NN-rewrite). `build` files the final answers as the pack's recordings and runs the
// real pipeline on them (recorded mode), so every launch post is a post the
// engine built: rendered for TikTok and Instagram, exported with its captions,
// its sources and its cost.
//
// Then a different subagent, which has not seen the drafting, reviews each
// rendered post as a skeptical Israeli who has never heard of the account
// (`review` writes its requests; its answers go to reviews/<n>.json). A post that
// fails is redone with the notes (`redo`), or replaced in the plan.
//
// The posts are written to $OF_HOME/out/launch/<pack>/<n>-<format>/.
//
// Costs are ESTIMATES from token counts at Sonnet 5.5's batch price with the
// pack's block cached, thinking given as a range, like docs/costs.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

process.env.OF_MODE = 'recorded';
const { ofHome } = await import('../src/core/paths.js');
const { Db } = await import('../src/db/index.js');
const { loadPack, packDirs, resolvePackDir, syncAccounts } = await import('../src/packs/load.js');
const { makeContext } = await import('../src/engine.js');
const { recordedSources, refreshSource } = await import('../src/sources/index.js');
const { candidatesOf, buildPost, checkPost, draftFromAnswer, igCaption, keepItems, textsOf } = await import('../src/pipeline/build.js');
const { exportPost } = await import('../src/pipeline/export.js');
const { outlinePrompt, outlineUser, rewritePrompt, rewriteUser, slidesPrompt, slidesUser } = await import('../src/pipeline/prompts.js');
const { BLOCK_AT, REVIEW_SCHEMA, REVIEW_SYSTEM, REWRITE_AT, reviewUser } = await import('../src/voice/review.js');
const { mechanicalFix } = await import('../src/voice/tells.js');
const { verifyFact } = await import('../src/verify/claims.js');
const { ctasOf, hookPatterns, kindName, shapeProblems } = await import('../src/formats/kinds.js');
const { resolveFormat } = await import('../src/trends/index.js');
const { estimateTokens } = await import('../src/llm/index.js');
const { BATCH_FACTOR, MODEL_RATES } = await import('../src/budget/ledger.js');
const { closeBrowser } = await import('../src/render/render.js');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const packId = opt('pack');
if (!packId || !['next', 'redo', 'build', 'review', 'status'].includes(cmd)) {
  console.error('usage: npm run launch -- next|redo|build|review|status --pack <id>');
  process.exit(1);
}
const HOME = path.join(ofHome(), 'launch', packId);
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const W = (f, x) => (mkdirSync(path.dirname(f), { recursive: true }), writeFileSync(f, `${typeof x === 'string' ? x : JSON.stringify(x, null, 2)}\n`));
const nn = (n) => String(n).padStart(2, '0');
const planFile = path.join(HOME, 'plan.json');
const plan = J(planFile);
const pack = loadPack(resolvePackDir(packId));
const others = packDirs().filter((d) => path.basename(d) !== packId).map((d) => {
  try {
    return loadPack(d);
  } catch {
    return null;
  }
}).filter(Boolean);
const ans = (n, stage) => path.join(HOME, 'answers', `${nn(n)}-${stage}.json`);
const req = (n, stage) => path.join(HOME, 'prompts', `${nn(n)}-${stage}.md`);

// A database with the pack's recorded documents in it, for the fact checks.
function workDb() {
  const db = new Db(':memory:');
  syncAccounts(db, [pack, ...others]);
  return db;
}
async function docsFor(db) {
  const srcs = db.all("SELECT * FROM sources WHERE account_id = ? AND status = 'approved'", pack.id);
  const impl = recordedSources(pack);
  const docs = [];
  for (const s of srcs) for (const d of await refreshSource(db, impl, s)) docs.push({ ...d, sourceName: s.name, sourceKey: s.key });
  return candidatesOf(docs);
}

/** A request file a subagent answers: the system blocks, the user turn, the schema, where to write. */
function requestFile(title, { system, user, schema }, answerPath) {
  const sys = (Array.isArray(system) ? system : [{ text: system }]).map((b) => b.text).join('\n\n----- (next system block) -----\n\n');
  return `# ${title}

You are the drafting model of a content engine. Answer this request exactly as the model would: read the system prompt and the user turn below, and reply with ONE JSON object that matches the schema, and nothing else. Write that JSON object, alone, to:

${answerPath}

## System prompt

${sys}

## User turn

${user}

## Output schema (JSON Schema)

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
`;
}

/** Round-robin cover patterns and calls to action over the plan, so the launch set shows each. */
function choose() {
  const used = {};
  let changed = false;
  for (const p of plan.posts) {
    const f = resolveFormat(null, pack, p.format) || pack.formats.formats.find((x) => x.id === p.format);
    if (!f) throw new Error(`plan post ${p.n}: no format "${p.format}"`);
    if (kindName(f) === 'list') continue;
    const k = (used[f.id] ??= { h: 0, c: 0 });
    if (!p.hook) {
      p.hook = hookPatterns(f)[k.h++ % hookPatterns(f).length].id;
      changed = true;
    }
    const ctas = ctasOf(pack, f);
    if (!p.cta && ctas.length) {
      p.cta = ctas[k.c++ % ctas.length].text;
      changed = true;
    }
  }
  if (changed) W(planFile, plan);
}

const fmtOf = (p) => pack.formats.formats.find((x) => x.id === p.format);
const say = (x) => `${x.where}: ${x.msg}`;

/**
 * A post's review notes (plan.json "notes", from a reader's review) after the
 * engine's own user turn: the one thing the launch set adds to the engine's
 * prompt, the way the owner's notes would be.
 */
function withNotes(p, request) {
  if (!p.notes?.length) return request;
  const notes = p.notes.map((x) => `- ${x}`).join('\n');
  return { ...request, user: `${request.user}\n\nA READER REVIEWED THE LAST VERSION OF THIS POST. Fix what they say and keep every rule (notes about photos, layout or links are for the design: leave them):\n${notes}` };
}

/** Where one planned post stands, and what it needs next. */
async function state(db, cands, p) {
  const f = fmtOf(p);
  const cand = cands.find((c) => c.key === p.doc);
  if (!cand) return { p, f, stage: 'no-doc', why: `no recorded document "${p.doc}"` };
  const refs = cand.docs.map((d, i) => ({ ...d, ref: `D${i + 1}` }));
  const op = outlinePrompt(pack, { ttl: '1h' });
  const outlineReq = withNotes(p, { system: op.system, user: outlineUser(f, refs, { avoid: [], day: p.day || null, subject: p.subject || null }), schema: op.schema });
  if (!existsSync(ans(p.n, 'outline'))) return { p, f, stage: 'outline', outlineReq };
  const outline = J(ans(p.n, 'outline'));
  if (!outline.usable) return { p, f, stage: 'unusable', why: outline.why, outlineReq };
  const docOf = new Map(refs.map((d) => [d.ref, d]));
  const facts = outline.facts.map((x) => {
    const d = docOf.get(String(x.doc || '').trim()) || (refs.length === 1 ? refs[0] : null);
    const row = { key: x.id, claim: x.claim, quote: x.quote, document_id: d?.id ?? null, source_id: d?.source_id ?? null };
    const v = verifyFact(db, row, { accountId: pack.id, maxQuoteWords: pack.rules.maxQuoteWords || 40 });
    return { ...row, verified: v.ok, error: v.error };
  });
  const good = new Set(facts.filter((x) => x.verified).map((x) => x.key));
  const items = keepItems(f, outline.items, good);
  const shape = shapeProblems(f, items.map((it) => it.role));
  const refused = facts.filter((x) => !x.verified).map((x) => `${x.key}: ${x.error}`);
  if (shape.length || !good.size) return { p, f, stage: 'outline-failed', why: [...shape, ...refused].join(' · '), outlineReq, facts };
  const verified = facts.filter((x) => x.verified);
  const hook = hookPatterns(f).find((h) => h.id === p.hook) || null;
  const cta = ctasOf(pack, f).find((c) => c.text === p.cta) || null;
  const sp = slidesPrompt(pack, { ttl: '1h' });
  const slidesReq = (problems = []) => withNotes(p, { system: sp.system, user: slidesUser({ format: f, n: items.length, outline: { ...outline, items }, facts: verified, edits: [], problems, hook, cta }), schema: sp.schema });
  const ctx = { db, packs: [pack, ...others] };
  const check = (stage) => (existsSync(ans(p.n, stage)) ? draftFromAnswer(ctx, pack, { format: f, answer: J(ans(p.n, stage)), outline, items, facts, hook, cta }) : null);
  const first = check('slides');
  if (!first) return { p, f, stage: 'slides', outlineReq, slidesReq: slidesReq(), facts, refused };
  if (!first.checked.problems.length) return vet(ctx, { p, f, outlineReq, slidesReq: slidesReq(), final: 'slides', draft: first.draft, facts, refused });
  const problems = first.checked.problems.map(say);
  const second = check('slides-2');
  if (!second) return { p, f, stage: 'redraft', outlineReq, slidesReq: slidesReq(problems), firstReq: slidesReq(), problems, facts, refused };
  if (second.checked.problems.length) return { p, f, stage: 'blocked', why: second.checked.problems.map(say).join(' · '), outlineReq, slidesReq: slidesReq(problems), firstReq: slidesReq(), facts, refused };
  return vet(ctx, { p, f, outlineReq, slidesReq: slidesReq(problems), firstReq: slidesReq(), final: 'slides-2', draft: second.draft, facts, refused, redrafted: problems });
}

/**
 * The engine's second look, which a recorded build cannot take (src/pipeline/build.js
 * reviews with the offline heuristic and rewrites nothing without a live client): the
 * review request on the final draft, the one rewrite of what it flags, each rewrite
 * kept only if the post still passes every check, a fact problem left unfixed blocks
 * the post, and so does a text still scored as a bot. A request is tied to the text it
 * was written for: an answer to an older version of the post is set aside.
 */
function vet(ctx, s) {
  const { p, f, draft, facts } = s;
  const verified = facts.filter((x) => x.verified);
  const texts = textsOf(draft);
  const reviewReq = { system: REVIEW_SYSTEM, user: reviewUser(pack, texts, verified), schema: REVIEW_SCHEMA };
  if (!fresh(p.n, 'review', reviewReq)) return { ...s, stage: 'review', reviewReq };
  const got = J(ans(p.n, 'review')).reviews || [];
  const scores = texts.map((t, i) => {
    const r = got.find((x) => x.index === i) || {};
    return { index: i, where: t.where, text: t.text, botScore: Math.max(0, Math.min(10, Math.round(Number(r.botScore) || 0))), tells: (r.tells || []).map(String).slice(0, 5), factProblem: String(r.factProblem || '') };
  });
  const flagged = scores.filter((r) => r.botScore >= REWRITE_AT || r.factProblem);
  const answer = J(ans(p.n, s.final));
  if (!flagged.length) return { ...s, stage: 'drafted', reviewReq, answer, vetted: { scores, flagged: [], applied: [] } };
  const rp = rewritePrompt(pack, { ttl: '1h' });
  const rewriteReq = { system: rp.system, user: rewriteUser({ flagged, facts: verified }), schema: rp.schema };
  if (!fresh(p.n, 'rewrite', rewriteReq)) return { ...s, stage: 'rewrite', reviewReq, rewriteReq, flagged };
  let cur = draft;
  const patched = structuredClone(answer);
  const applied = [];
  const rejected = [];
  for (const rw of J(ans(p.n, 'rewrite')).rewrites || []) {
    const t = texts[rw.index];
    if (!t || !flagged.some((x) => x.index === rw.index)) continue;
    const text = mechanicalFix(String(rw.text || '').trim()).text;
    if (!text) continue;
    const next = structuredClone(cur);
    if (t.where === 'cover') next.hook = text;
    else if (t.where === 'cover line 2') next.sub = text;
    else if (t.where === 'caption') next.caption = text;
    else if (t.where === 'caption short') next.captionShort = text;
    else next.slides[t.idx][t.field] = text;
    next.captionIg = igCaption(next);
    const refusedBy = checkPost(ctx, pack, next, facts, f).problems;
    if (refusedBy.length) {
      rejected.push({ where: t.where, text, why: refusedBy.slice(0, 2).map(say).join(" · ") });
      continue;
    }
    cur = next;
    applied.push({ index: rw.index, where: t.where, from: t.text, to: text });
    // The same change in the answer the build files as the recording.
    if (t.where === 'cover') patched.hook = text;
    else if (t.where === 'cover line 2') patched.sub = text;
    else if (t.where === 'caption') patched.caption = text;
    else if (t.where === 'caption short') patched.captionShort = text;
    else patched.slides[t.idx - 1][t.field] = text;
  }
  const fixed = new Set(applied.map((a) => a.index));
  const after = scores.map((r) => (fixed.has(r.index) ? Math.min(r.botScore, REWRITE_AT - 1) : r.botScore));
  const unfixed = scores.filter((r) => r.factProblem && !fixed.has(r.index));
  const vetted = { scores, flagged, applied, rejected };
  const base = { ...s, reviewReq, rewriteReq, vetted };
  if (unfixed.length) return { ...base, stage: 'blocked', why: `the review: says more than its facts: ${unfixed.map((r) => `${r.where}: ${r.factProblem}`).join(' · ')}${rejected.length ? ` (rewrites the checks refused: ${rejected.map((x) => `${x.where}: ${x.why}`).join(' · ')})` : ''}` };
  if (Math.max(0, ...after) >= BLOCK_AT) return { ...base, stage: 'blocked', why: `the review: still sounds like a bot (${Math.max(...after)}/10: ${scores.filter((r, i) => after[i] >= BLOCK_AT).map((r) => r.where).join(', ')})${rejected.length ? ` (rewrites the checks refused: ${rejected.map((x) => `${x.where}: ${x.why}`).join(' · ')})` : ''}` };
  return { ...base, stage: 'drafted', draft: cur, answer: patched };
}

/** Whether an answer exists for this exact request (its user turn), not for an older version of the post. */
function fresh(n, stage, request) {
  const sig = createHash('sha256').update(request.user).digest('hex').slice(0, 16);
  const sigFile = path.join(HOME, 'answers', `${nn(n)}-${stage}.sig`);
  if (!existsSync(ans(n, stage))) {
    W(sigFile, sig);
    return false;
  }
  if (existsSync(sigFile) && readFileSync(sigFile, 'utf8').trim() !== sig) {
    rmSync(ans(n, stage), { force: true });
    W(sigFile, sig);
    return false;
  }
  return true;
}

/** The estimated cost of a launch post's calls: Sonnet 5.5, batch, the pack block cached after the first call. */
function price(s) {
  const r = MODEL_RATES['claude-sonnet-5-5'];
  const sysTokens = (system) => (Array.isArray(system) ? system : [{ text: system }]).map((b) => estimateTokens(b.text));
  const call = (request, answerPath) => {
    if (!request || !existsSync(answerPath)) return null;
    const [packT, ...rest] = sysTokens(request.system);
    const restT = rest.reduce((a, b) => a + b, 0) + estimateTokens(request.user) + Math.ceil(estimateTokens(JSON.stringify(request.schema)) / 3);
    const out = estimateTokens(readFileSync(answerPath, 'utf8'));
    // The pack block: read from the cache (written once a day per account, which a day's posts share).
    const input = (packT * r.cacheRead + restT * r.in) / 1e6;
    return { input, out };
  };
  const calls = [call(s.outlineReq, ans(s.p.n, 'outline')), call(s.firstReq || s.slidesReq, ans(s.p.n, 'slides')), s.firstReq ? call(s.slidesReq, ans(s.p.n, 'slides-2')) : null].filter(Boolean);
  // The review: its own short system prompt, not cached; the texts and facts in, a few tokens per text out.
  if (s.reviewReq) {
    const inT = estimateTokens(REVIEW_SYSTEM) + estimateTokens(s.reviewReq.user) + Math.ceil(estimateTokens(JSON.stringify(REVIEW_SCHEMA)) / 3);
    const out = existsSync(ans(s.p.n, 'review')) ? estimateTokens(readFileSync(ans(s.p.n, 'review'), 'utf8')) : 30 * textsOf(s.draft).length;
    calls.push({ input: (inT * r.in) / 1e6, out });
  }
  // The rewrite of what it flagged, when it flagged anything: the pack block cached again.
  if (s.vetted?.flagged.length) calls.push(call(s.rewriteReq, ans(s.p.n, 'rewrite')));
  // Thinking is not visible: the answer plus half to twice its length again.
  const lo = calls.filter(Boolean).reduce((a, c) => a + c.input + (c.out * 1.5 * r.out) / 1e6, 0) * BATCH_FACTOR;
  const hi = calls.filter(Boolean).reduce((a, c) => a + c.input + (c.out * 3 * r.out) / 1e6, 0) * BATCH_FACTOR;
  return { lo, hi, calls: calls.filter(Boolean).length };
}

const db = workDb();
const cands = await docsFor(db);
choose();
const states = [];
for (const p of plan.posts) states.push(await state(db, cands, p));

if (cmd === 'status' || cmd === 'next') {
  for (const s of states) {
    const line = `${nn(s.p.n)} ${s.p.format.padEnd(16)} ${s.stage.padEnd(15)} ${s.why || s.problems?.slice(0, 2).join(' · ') || ''}`;
    console.log(line.slice(0, 260));
    if (cmd !== 'next') continue;
    // A request written by redo, with a review's notes, stays as it is until it is answered.
    const reviewed = (stage) => existsSync(req(s.p.n, stage)) && readFileSync(req(s.p.n, stage), 'utf8').includes('A READER REVIEWED');
    if (s.stage === 'outline' && !reviewed('outline')) W(req(s.p.n, 'outline'), requestFile(`Launch post ${s.p.n}: the outline (format ${s.p.format}, a ${kindName(s.f)} post)`, s.outlineReq, ans(s.p.n, 'outline')));
    if (s.stage === 'slides' && !reviewed('slides')) W(req(s.p.n, 'slides'), requestFile(`Launch post ${s.p.n}: the slides (format ${s.p.format}, a ${kindName(s.f)} post)`, s.slidesReq, ans(s.p.n, 'slides')));
    if (s.stage === 'redraft') W(req(s.p.n, 'slides-2'), requestFile(`Launch post ${s.p.n}: the slides, redrafted after the checks refused the first draft`, s.slidesReq, ans(s.p.n, 'slides-2')));
    if (s.stage === 'review') W(req(s.p.n, 'review'), requestFile(`Launch post ${s.p.n}: the engine's review of the drafted post (the reviewing model)`, s.reviewReq, ans(s.p.n, 'review')));
    if (s.stage === 'rewrite') W(req(s.p.n, 'rewrite'), requestFile(`Launch post ${s.p.n}: the rewrite of the lines the review flagged`, s.rewriteReq, ans(s.p.n, 'rewrite')));
  }
  if (cmd === 'next') console.log(`\nrequests in ${path.join(HOME, 'prompts')}; answers go to ${path.join(HOME, 'answers')}`);
}

if (cmd === 'redo') {
  const n = Number(opt('n'));
  const stage = opt('stage', 'slides');
  const s = states.find((x) => x.p.n === n);
  if (!s) throw new Error(`no post ${n}`);
  for (const st of stage === 'outline' ? ['outline', 'slides', 'slides-2', 'review', 'rewrite'] : ['slides', 'slides-2', 'review', 'rewrite']) rmSync(ans(n, st), { force: true });
  // The reviewer's notes go to the slides call as the engine's own redraft reasons.
  const notes = opt('notes') ? readFileSync(opt('notes'), 'utf8').split(/\n+/).map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean) : [];
  if (notes.length) {
    const fresh = await state(db, cands, s.p);
    const base = stage === 'outline' ? fresh.outlineReq : fresh.slidesReq;
    // The one place the launch set adds to the engine's prompt: a review, as the owner's notes would be.
    const user = `${base.user}\n\nA READER REVIEWED THE LAST VERSION OF THIS POST. Fix what they say and keep every rule:\n${notes.map((x) => `- ${x}`).join('\n')}`;
    W(req(n, stage), requestFile(`Launch post ${n}: the ${stage}, written again after a review`, { ...base, user }, ans(n, stage)));
    console.log(`post ${n}: ${stage} request written with ${notes.length} notes`);
  } else console.log(`post ${n}: ${stage} answers removed; run next`);
}

if (cmd === 'build') {
  const drafted = states.filter((s) => s.stage === 'drafted');
  for (const s of states.filter((x) => x.stage !== 'drafted')) console.log(`${nn(s.p.n)} not drafted (${s.stage}): ${s.why || ''}`);
  // The final answers become the pack's recordings, keyed by the document (or group) they were drafted from.
  for (const s of drafted) {
    // The final answer with the review's kept rewrites in it: the text the engine would have published.
    W(path.join(pack.recordingsDir, 'drafts', `${s.p.doc}.json`), { document: s.p.doc, format: s.p.format, outline: J(ans(s.p.n, 'outline')), slides: s.answer || J(ans(s.p.n, s.final)) });
  }
  const dbFile = path.join(HOME, 'launch.db');
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
  const ldb = new Db(dbFile);
  const ctx = makeContext({ db: ldb, packs: [pack, ...others], log: () => {} });
  ctx.mediaDir = path.join(HOME, 'media');
  // The launch set's photos are real: found on Commons now, licensed, screened, credited.
  ctx.imagesLive = !args.includes('--no-images');
  rmSync(ctx.mediaDir, { recursive: true, force: true });
  const out = path.join(ofHome(), 'out', 'launch', pack.id);
  rmSync(out, { recursive: true, force: true });
  const rows = [];
  for (const s of drafted) {
    const res = await buildPost(ctx, { pack, formatKey: s.p.format, docKey: s.p.doc, day: s.p.day || null, subject: s.p.subject ? { text: s.p.subject, terms: [] } : null, hookId: s.p.hook, ctaText: s.p.cta, sample: true });
    const folder = path.join(out, `${nn(s.p.n)}-${s.p.format}`);
    exportPost(ldb, res.postId, folder);
    const cost = price(s);
    const review = existsSync(path.join(HOME, 'reviews', `${nn(s.p.n)}.json`)) ? J(path.join(HOME, 'reviews', `${nn(s.p.n)}.json`)) : null;
    // An earlier round's review, kept with the post: what was wrong, and what this version answers.
    const rounds = readdirSync(HOME).filter((d) => /^round\d+$/.test(d)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    const earlier = rounds.map((d) => [d, path.join(HOME, d, 'reviews', `${nn(s.p.n)}.json`)]).filter(([, f]) => existsSync(f));
    if (review && earlier.length) review.history = earlier.map(([d, f]) => `round ${d.slice(5)}: ${J(f).verdict}. ${(J(f).notes || []).join(' ')}`.slice(0, 1500));
    W(path.join(folder, 'cost.md'), `# Cost of this post\n\nEstimated, not billed: ${cost.calls} model calls (outline, slides${s.firstReq ? ', the one redraft' : ''}, the review) at Claude Sonnet 5.5's Message Batches price, the account's cached block read from the cache, thinking given as half to twice each answer.\n\n**$${cost.lo.toFixed(4)} to $${cost.hi.toFixed(4)}**\n\nThe engine's own estimate for the same calls made directly, without batching or caching: $${res.cost.toFixed(4)} (post.json, \`cost\`).\n`);
    W(path.join(folder, 'reviewer-notes.md'), review ? reviewNotes(review) : '# Reviewer notes\n\nNot reviewed yet.\n');
    W(path.join(folder, 'engine-review.md'), engineReview(s));
    rows.push({ n: s.p.n, format: s.p.format, status: res.status, reason: res.reason, cost, review });
    console.log(`${res.status === 'sample' ? 'ok ' : 'NO '} ${nn(s.p.n)} ${s.p.format.padEnd(16)} $${cost.lo.toFixed(3)}-${cost.hi.toFixed(3)} ${review ? `review: ${review.verdict}` : ''} ${res.reason || ''}`);
  }
  await closeBrowser();
  W(path.join(out, 'README.md'), summary(rows));
  console.log(`\n${rows.filter((r) => r.status === 'sample').length}/${plan.posts.length} built: ${out}`);
}

if (cmd === 'review') {
  const out = path.join(ofHome(), 'out', 'launch', pack.id);
  const folders = existsSync(out) ? readdirSync(out).filter((d) => /^\d\d-/.test(d)) : [];
  for (const d of folders) {
    const n = Number(d.slice(0, 2));
    const folder = path.join(out, d);
    const slides = (p) => (existsSync(path.join(folder, p)) ? readdirSync(path.join(folder, p)).sort().map((f) => path.join(folder, p, f)) : []);
    const read = (f) => (existsSync(path.join(folder, f)) ? readFileSync(path.join(folder, f), 'utf8').trim() : '');
    W(path.join(HOME, 'reviews', `${nn(n)}-request.md`), `# Review of one post

You have never heard of this account. You are a skeptical Israeli, the age of its audience, scrolling TikTok and Instagram in Hebrew. Look at the post below as you would in your feed: open each slide image (TikTok first, then the Instagram version), read the captions.

The account: ${pack.meta.audience}. (Nothing else about it: judge the post, not the brand.)

Answer three questions honestly, then a verdict:
1. stop: would the cover stop your scroll? Why or why not.
2. swipe: would you swipe to the last slide? Where would you drop off, if anywhere.
3. saveOrSend: would you save it, send it to a friend, or comment? Which, and why.
Also note anything that sounds like a bot or a translation, anything that seems false or unclear, and anything visual that is off (text too small, cramped, cut, ugly).

Verdict "pass" only if it would stop you AND you would swipe to the end AND it gives a reason to save, send or comment. Otherwise "fail", with what would fix it.

Write ONE JSON object to ${path.join(HOME, 'reviews', `${nn(n)}.json`)}:
{ "stop": true|false, "swipe": true|false, "saveOrSend": "save"|"send"|"comment"|"none", "verdict": "pass"|"fail", "notes": ["short notes in Hebrew or English"], "fix": ["what to change, concretely, if it fails"] }

## TikTok slides (in order)
${slides('tiktok').map((f) => `- ${f}`).join('\n')}

## Instagram slides
${slides('instagram').map((f) => `- ${f}`).join('\n')}

## TikTok caption
${read('caption.txt')}

## Instagram caption
${read('caption-instagram.txt')}
`);
  }
  console.log(`${folders.length} review requests in ${path.join(HOME, 'reviews')}`);
}

/** The engine's own review of the post, before the blind one: scores, what it flagged, what the rewrite changed. */
function engineReview(s) {
  const v = s.vetted || { scores: [], flagged: [], applied: [] };
  return `# The engine's review

The step every post takes before it is queued (src/voice/review.js): the reviewing model scores each text from 0 (a person wrote it) to 10 (a bot did) and says when a text claims more than its facts. A text at ${REWRITE_AT} or more, or with a fact problem, is rewritten once, and a rewrite is kept only if the post still passes every check. Answered here by a Claude Code subagent on the engine's exact request, as the drafts were.

${v.scores.map((r) => `- ${r.where}: ${r.botScore}/10${r.tells.length ? ` (${r.tells.join(', ')})` : ''}${r.factProblem ? `. **Fact problem:** ${r.factProblem}` : ''}`).join('\n')}

${v.applied.length ? `## Rewritten\n\n${v.applied.map((a) => `- ${a.where}\n  - before: ${a.from}\n  - after: ${a.to}`).join('\n')}` : v.flagged.length ? '## Rewritten\n\nNothing kept.' : 'Nothing flagged.'}
`;
}

function reviewNotes(r) {
  return `# Reviewer notes

A separate reviewer that had not seen the drafting, looking at the rendered post as a skeptical Israeli who has never heard of the account.

- Would it stop the scroll: **${r.stop ? 'yes' : 'no'}**
- Would they swipe to the end: **${r.swipe ? 'yes' : 'no'}**
- Save, send or comment: **${r.saveOrSend}**
- Verdict: **${r.verdict}**

${(r.notes || []).map((x) => `- ${x}`).join('\n')}
${r.fix?.length ? `\nWhat would fix it:\n${r.fix.map((x) => `- ${x}`).join('\n')}\n` : ''}${r.history ? `\nEarlier rounds:\n${r.history.map((h) => `- ${h}`).join('\n')}\n` : ''}`;
}

function summary(rows) {
  const lo = rows.reduce((a, r) => a + r.cost.lo, 0) / Math.max(1, rows.length);
  const hi = rows.reduce((a, r) => a + r.cost.hi, 0) / Math.max(1, rows.length);
  return `# Launch set: ${pack.meta.displayName}

${rows.length} posts, built by the engine from recorded documents and drafts written by a Claude Code subagent on the engine's exact prompts (no API key spent). Each folder has the slides for both platforms (\`tiktok/\`, \`instagram/\`), both captions, \`sources.md\` (every fact, its quote and its source), \`cost.md\`, \`engine-review.md\` (the engine's own review and what its rewrite changed), \`reviewer-notes.md\` (the blind review, with the earlier rounds' verdicts) and \`post.json\` (the full trace).

The Review column is the last blind review: a separate subagent playing a skeptical Israeli who has never heard of the account, told to pass a post only if it would stop the scroll, be swiped to the end and give a reason to save, send or comment. It is one strict opinion, written down for you to weigh; whether a post goes out is yours to decide.

| # | Format | Built | Cost (est.) | Review |
|---|---|---|---|---|
${rows.map((r) => `| ${r.n} | ${r.format} | ${r.status === 'sample' ? 'yes' : `no: ${r.reason}`} | $${r.cost.lo.toFixed(3)} to $${r.cost.hi.toFixed(3)} | ${r.review ? r.review.verdict : 'not yet'} |`).join('\n')}

Average per post: **$${lo.toFixed(3)} to $${hi.toFixed(3)}** (estimated, batch and cache, thinking as a range).
`;
}
