#!/usr/bin/env node
// npm run launch -- run      --pack <id> [--round <n>] [--only 1,4] [--tries 3]
// npm run launch -- review   --pack <id> [--round <n>]
// npm run launch -- verdicts --pack <id> [--round <n>]
// npm run launch -- status   --pack <id>
// npm run launch -- costs    --pack <id>          every round's calls, priced at the API's rates
//
// The launch set: the first posts of a new account, the ones its owner approves
// to fill the grid before the account goes public. Planned in
// $OF_HOME/launch/<pack>/plan.json:
//
//   { "posts": [ { "n": 1, "format": "<format id>", "day": "YYYY-MM-DD" (optional),
//                  "subject": "..." (optional: a fight week's event) } ] }
//
// RUN. Every post is made by the engine's own pipeline, end to end, exactly as the
// runner makes one: live sources, the outline, research and the details, the
// facts verified, the slides, every check in code, the one redraft, the review,
// the one rewrite, the photographs and their checks, the render. The model is
// whatever OF_ENV picks: in development the Claude Code CLI (src/llm/cli.js), so
// nothing is bought. Nothing here edits a post: what the engine makes is what is
// exported. A post the checks stop is made again from another topic, up to
// --tries times, and every attempt is kept with what stopped it.
//
// REVIEW. A post is then read by three fresh reviewers who see only what a viewer
// would: the slides, the two captions and the list of sources (never the drafts,
// the facts or the engine's own review). `review` writes each post's bundle and
// which reviewer reads which post (three per post, three posts per reviewer); the
// reviewers write their verdicts to reviews/<reviewer>.json; `verdicts` tallies
// them (a post passes when two of its three reviewers pass it) and writes the
// notes next to each post.
//
// Each round has its own database and folder, $OF_HOME/launch/<pack>/r<n>/. The
// posts of the latest round are exported to $OF_HOME/out/launch/<pack>/<nn>-<format>/,
// the earlier rounds' to out/launch/<pack>/rounds/r<n>/.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const packId = opt('pack');
if (!packId || !['run', 'review', 'verdicts', 'status', 'costs'].includes(cmd)) {
  console.error('usage: npm run launch -- run|review|verdicts|status --pack <id> [--round <n>]');
  process.exit(1);
}
process.env.OF_MODE = 'live';
// Wikimedia throttles a reader that does not say who it is. Until the owner sets OF_USER_AGENT with a
// contact, the launch set names the project's public repository.
process.env.OF_USER_AGENT ||= 'open-frequency/0.1 (+https://github.com/netanelyan/openfrequency)';

const { loadEnv } = await import('../src/core/env.js');
loadEnv();
const { ofHome } = await import('../src/core/paths.js');
const { Db, j } = await import('../src/db/index.js');
const { makeContext } = await import('../src/engine.js');
const { buildPost, loadPost, sourceLabel } = await import('../src/pipeline/build.js');
const { exportPost } = await import('../src/pipeline/export.js');
const { kindName, groupOf } = await import('../src/formats/kinds.js');
const { resolveFormat } = await import('../src/trends/index.js');
const { closeBrowser } = await import('../src/render/render.js');
const { llmBackend } = await import('../src/llm/index.js');
const { syncEvents } = await import('../src/autonomy/runner.js');

const HOME = path.join(ofHome(), 'launch', packId);
const OUT = path.join(ofHome(), 'out', 'launch', packId);
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const W = (f, x) => (mkdirSync(path.dirname(f), { recursive: true }), writeFileSync(f, `${typeof x === 'string' ? x : JSON.stringify(x, null, 2)}\n`));
const nn = (n) => String(n).padStart(2, '0');
const plan = J(path.join(HOME, 'plan.json'));
const rounds = () => (existsSync(HOME) ? readdirSync(HOME).filter((d) => /^r\d+$/.test(d)).map((d) => Number(d.slice(1))).sort((a, b) => a - b) : []);
const round = Number(opt('round', cmd === 'run' ? (rounds().at(-1) || 0) + 1 : rounds().at(-1) || 1));
const RD = path.join(HOME, `r${round}`);
const usd = (x) => `$${Number(x || 0).toFixed(4)}`;

function context() {
  mkdirSync(RD, { recursive: true });
  const db = new Db(path.join(RD, 'launch.db'));
  const ctx = makeContext({ db, mode: 'live', log: (m) => console.log(`  ${m}`) });
  ctx.mediaDir = path.join(RD, 'media');
  return ctx;
}

/** What a post's model calls were, and what they would cost through the API. */
function costOf(db, postIds) {
  const rows = db.all(`SELECT tag, model, usd, api, api_usd, usage_json FROM spend WHERE post_id IN (${postIds.map(() => '?').join(',')}) AND api IN ('claude', 'claude-cli') ORDER BY id`, ...postIds);
  const calls = rows.map((r) => {
    const u = j(r.usage_json, {}) || {};
    const input = u.priced?.input ?? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    return { tag: r.tag, model: r.model, backend: r.api, input, output: u.priced?.output ?? (u.output_tokens || 0), thinking: u.output_tokens_details?.thinking_tokens || 0, paid: r.usd, prod: r.api_usd ?? r.usd, list: u.listUsd ?? r.usd };
  });
  const sum = (k) => calls.reduce((s, c) => s + (c[k] || 0), 0);
  return { calls, input: sum('input'), output: sum('output'), paid: sum('paid'), prod: sum('prod'), list: sum('list') };
}

function costMd(db, post, attempts) {
  const ids = [...attempts.map((a) => a.postId)];
  const all = costOf(db, ids);
  const own = costOf(db, [post.id]);
  const lines = [
    `# Cost: ${post.hook}`,
    '',
    `Backend: ${all.calls[0]?.backend || '-'}. A call answered by the Claude Code CLI costs nothing; "API" is what the same call would cost`,
    'through the Anthropic API as production sends it (batched, the pack prefix read from the cache), and "list" at the full price,',
    'from the tokens the CLI reported (each includes about 1,000 tokens of the CLI\'s own framing).',
    '',
    `This post: ${own.calls.length} calls, ${own.input.toLocaleString()} tokens in, ${own.output.toLocaleString()} out: API ${usd(own.prod)}, list ${usd(own.list)}, paid ${usd(own.paid)}.`,
    attempts.length > 1 ? `With the ${attempts.length - 1} attempt(s) the checks stopped before it: ${all.calls.length} calls, API ${usd(all.prod)}, list ${usd(all.list)}.` : '',
    '',
    '| Call | Model | Tokens in | Out (thinking) | API | List |',
    '|---|---|---|---|---|---|',
    ...own.calls.map((c) => `| ${c.tag} | ${String(c.model).replace('claude-', '')} | ${c.input.toLocaleString()} | ${c.output.toLocaleString()} (${c.thinking.toLocaleString()}) | ${usd(c.prod)} | ${usd(c.list)} |`),
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function imagesMd(db, post) {
  const lines = [`# Pictures: ${post.hook}`, '', 'Every picture on the slides, where it came from and its license. A slide without a photograph shows a graphic the engine drew from the slide\'s own facts.', ''];
  post.slides.forEach((s, i) => {
    const vis = s.data?.visual;
    const img = s.image_id ? db.get('SELECT * FROM images WHERE id = ?', s.image_id) : null;
    const what = img ? 'photograph' : vis ? `graphic (${vis.type})` : s.kind === 'cover' ? (post.data?.coverVisual ? `graphic (${post.data.coverVisual.type})` : "the kind's own art") : s.role === 'stat' ? 'graphic (the two values)' : 'none';
    lines.push(`- Slide ${i + 1} (${s.role || s.kind}): ${what}`);
    if (img) {
      const match = j(img.match_json, {}) || {};
      lines.push(`  - file: ${img.provider_id} (${img.provider})`, `  - license: ${img.license}${img.license_url ? ` (${img.license_url})` : ''}`, `  - author: ${img.author || '-'}`, `  - source: ${img.source_url || '-'}`, `  - asked for: "${img.query}"`, `  - the screen: ${img.safety}${match.model ? `; the vision check saw "${match.model.mainSubject}" (${match.model.consistent ? 'fits the slide' : 'does not fit'})` : ''}`);
    }
  });
  return lines.join('\n');
}

function engineReviewMd(db, post, attempts) {
  const steps = db.all('SELECT step, status, detail_json FROM steps WHERE post_id = ? ORDER BY id', post.id).map((s) => ({ ...s, d: j(s.detail_json, {}) }));
  const lines = [`# The engine's own review: ${post.hook}`, '', 'What the engine\'s checks and its reviewing model said while the post was made. The blind reviewers never see this.', ''];
  for (const s of steps) {
    if (s.step === 'outline') lines.push(`- outline: ${s.status}, topic "${s.d.topic || ''}"${s.d.research?.length ? `, research: ${s.d.research.join(' · ')}` : ''}`);
    else if (s.step === 'details') lines.push(`- details: ${s.status}, ${s.d.verified} verified of ${s.d.found} (need ${s.d.need})${s.d.documents?.length ? `; read ${s.d.documents.join(', ')}` : ''}`);
    else if (s.step === 'facts') lines.push(`- facts: ${s.d.verified} verified${s.d.refused?.length ? `, refused: ${s.d.refused.map((r) => `${r.key} (${r.error})`).join('; ')}` : ''}`);
    else if (s.step === 'slides' || s.step === 'redraft') lines.push(`- ${s.step}: ${s.status}${s.d.problems?.length ? `\n  - ${s.d.problems.join('\n  - ')}` : ''}${s.d.fixed?.length ? `\n  - fixed in code: ${s.d.fixed.join('; ')}` : ''}`);
    else if (s.step === 'review') {
      lines.push(`- review (${s.d.reviewer}): worst ${s.d.worst}/10`);
      for (const x of s.d.scores || []) lines.push(`  - ${x.where}: ${x.score}${x.tells?.length ? ` (${x.tells.join(', ')})` : ''}${x.factProblem ? `, FACT: ${x.factProblem}` : ''}`);
      for (const r of s.d.rewrites || []) lines.push(`  - rewritten ${r.where}: "${r.from}" -> "${r.to}"`);
      for (const v of s.d.visualsDropped || []) lines.push(`  - graphic dropped on ${v.where}: ${v.why}`);
    } else if (s.step === 'rewrite') lines.push(`- rewrite: ${s.status}, kept ${s.d.kept ?? 0} of ${s.d.flagged ?? 0}`);
    else if (s.step === 'image') lines.push(`- image for slide ${(s.d.slide ?? 0) + 1} ("${s.d.query}"): ${s.status}${s.d.license ? `, ${s.d.license}` : ''}`);
  }
  if (attempts.length > 1) {
    lines.push('', '## Attempts the checks stopped first', '');
    for (const a of attempts.slice(0, -1)) lines.push(`- ${a.topic || '(no topic)'}: ${a.reason}`);
  }
  return lines.join('\n');
}

function sourceList(db, post) {
  const seen = new Map();
  // The same names the slides show, never the engine's own (a topic bank).
  for (const f of post.facts) if (f.verified && f.doc_url && !seen.has(f.doc_url)) seen.set(f.doc_url, `${f.doc_title || f.source_name} (${sourceLabel(db, f, { article: false })})`);
  return ['# Sources', '', ...[...seen].map(([u, t]) => `- ${t}: ${u}`)].join('\n');
}

/**
 * Each round has its own database, so a round never saw what the rounds before it made: round 3 told the story a
 * passed post of round 2 had told. The posts that passed earlier are written into this round's database first (id
 * "seed-..."), so the outline's "posted recently" list holds them, as an account's own history would.
 */
function seedPassed(db, pack) {
  for (const r of rounds().filter((n) => n < round)) {
    const v = path.join(HOME, `r${r}`, 'verdicts.json');
    if (!existsSync(v) || !existsSync(path.join(HOME, `r${r}`, 'results.json'))) continue;
    const res = J(path.join(HOME, `r${r}`, 'results.json'));
    const old = new Db(path.join(HOME, `r${r}`, 'launch.db'));
    for (const [n, x] of Object.entries(J(v).posts || {})) {
      const id = `seed-r${r}-${n}`;
      // A failed post's topic is kept too, as rejected: the readers turned it down, so the next attempt finds another.
      const post = res[n]?.postId ? old.get('SELECT topic, hook, format_id, created_at FROM posts WHERE id = ?', res[n].postId) : null;
      if (!post || db.get('SELECT id FROM posts WHERE id = ?', id)) continue;
      db.insert('posts', { id, account_id: pack.id, format_id: post.format_id, topic: post.topic, hook: post.hook, status: x.pass ? 'published' : 'rejected', reason: x.pass ? `passed in round ${r}` : `failed the blind review in round ${r}`, created_at: post.created_at, updated_at: post.created_at });
    }
    old.close();
  }
}

async function run() {
  if (llmBackend() === 'api' && !args.includes('--allow-api')) console.log('note: the API backend is selected; in dev it is refused without --allow-api');
  const ctx = context();
  const pack = ctx.pack(packId);
  if (!pack) throw new Error(`no pack "${packId}"`);
  const only = opt('only') ? new Set(opt('only').split(',').map(Number)) : null;
  const tries = Number(opt('tries', 3));
  // A pack that follows events (a fight card) reads its calendar first, as the runner does every day.
  if (pack.meta.events) await syncEvents(ctx, pack).catch((e) => console.log(`events: ${e.message}`));
  const log = path.join(RD, 'progress.jsonl');
  const results = existsSync(path.join(RD, 'results.json')) ? J(path.join(RD, 'results.json')) : {};
  seedPassed(ctx.db, pack);
  console.log(`launch round ${round} for ${packId}, on ${llmBackend()}`);
  for (const p of plan.posts) {
    if (only && !only.has(p.n)) continue;
    if (results[p.n]?.status === 'sample' && !only) continue;
    const attempts = [];
    let made = null;
    for (let t = 0; t < tries && !made; t++) {
      const t0 = Date.now();
      console.log(`post ${p.n} (${p.format}), attempt ${t + 1}`);
      const r = await buildPost(ctx, { pack, formatKey: p.format, sample: true, day: p.day || null, subject: p.subject ? { text: p.subject, terms: p.terms || [p.subject] } : null });
      const row = ctx.db.get('SELECT topic FROM posts WHERE id = ?', r.postId);
      const a = { postId: r.postId, status: r.status, reason: r.reason, kind: r.kind, topic: row?.topic || null, minutes: Number(((Date.now() - t0) / 60000).toFixed(1)) };
      attempts.push(a);
      writeFileSync(log, `${JSON.stringify({ n: p.n, at: new Date().toISOString(), ...a })}\n`, { flag: 'a' });
      console.log(`  -> ${r.status}${r.reason ? `: ${r.reason}` : ''} (${a.minutes} min)`);
      if (r.status === 'sample') made = r;
      else if (r.kind === 'no_source') break;
    }
    results[p.n] = { format: p.format, status: made ? 'sample' : 'blocked', postId: made?.postId || null, attempts };
    W(path.join(RD, 'results.json'), results);
    if (made) exportOne(ctx, p, made.postId, attempts);
  }
  await closeBrowser();
  summary(ctx, results);
}

function postDir(p) {
  return path.join(OUT, `${nn(p.n)}-${p.format}`);
}

function exportOne(ctx, p, postId, attempts) {
  const dir = postDir(p);
  // An earlier round's post of this number goes to rounds/ first.
  if (existsSync(dir)) {
    const was = existsSync(path.join(dir, 'round.txt')) ? readFileSync(path.join(dir, 'round.txt'), 'utf8').trim() : 'r0';
    const to = path.join(OUT, 'rounds', was, path.basename(dir));
    mkdirSync(path.dirname(to), { recursive: true });
    rmSync(to, { recursive: true, force: true });
    renameSync(dir, to);
  }
  exportPost(ctx.db, postId, dir);
  const post = loadPost(ctx.db, postId);
  W(path.join(dir, 'round.txt'), `r${round}`);
  W(path.join(dir, 'cost.md'), costMd(ctx.db, post, attempts));
  W(path.join(dir, 'images.md'), imagesMd(ctx.db, post));
  W(path.join(dir, 'engine-review.md'), engineReviewMd(ctx.db, post, attempts));
  W(path.join(dir, 'source-list.md'), sourceList(ctx.db, post));
}

function summary(ctx, results) {
  const lines = [`# Launch round ${round}: ${packId}`, '', '| # | Format | Kind | Status | Attempts | Topic | API cost (with attempts) |', '|---|---|---|---|---|---|---|'];
  for (const p of plan.posts) {
    const r = results[p.n];
    if (!r) continue;
    const f = resolveFormat(ctx.db, ctx.pack(packId), p.format);
    const c = costOf(ctx.db, r.attempts.map((a) => a.postId));
    const topic = r.attempts.at(-1)?.topic || '';
    lines.push(`| ${p.n} | ${p.format} | ${kindName(f)} (${groupOf(f)}) | ${r.status} | ${r.attempts.length} | ${topic} | ${usd(c.prod)} |`);
  }
  W(path.join(RD, 'summary.md'), lines.join('\n'));
  console.log(lines.join('\n'));
}

/** Three reviewers per post, three posts per reviewer: reviewer k reads posts k, k+1 and k+2 (wrapping). */
function assign(ns) {
  return ns.map((_, k) => ({ reviewer: `R${k + 1}`, posts: [0, 1, 2].map((d) => ns[(k + d) % ns.length]) }));
}

function review() {
  const results = J(path.join(RD, 'results.json'));
  const made = plan.posts.filter((p) => results[p.n]?.status === 'sample');
  const bundles = path.join(RD, 'review');
  rmSync(bundles, { recursive: true, force: true });
  for (const p of made) {
    const src = postDir(p);
    const dst = path.join(bundles, nn(p.n));
    // Only what a viewer sees: the slides, the captions and where the facts come from.
    for (const plat of ['tiktok', 'instagram']) if (existsSync(path.join(src, plat))) cpSync(path.join(src, plat), path.join(dst, plat), { recursive: true });
    for (const f of ['caption.txt', 'caption-instagram.txt', 'source-list.md']) if (existsSync(path.join(src, f))) cpSync(path.join(src, f), path.join(dst, f));
  }
  const plan3 = made.length >= 3 ? assign(made.map((p) => p.n)) : made.map((p, k) => ({ reviewer: `R${k + 1}`, posts: made.map((x) => x.n) }));
  W(path.join(RD, 'reviewers.json'), plan3);
  console.log(`${made.length} posts in ${bundles}; ${plan3.length} reviewers: ${plan3.map((r) => `${r.reviewer} ${r.posts.join(',')}`).join(' · ')}`);
}

function verdicts() {
  const results = J(path.join(RD, 'results.json'));
  const dir = path.join(RD, 'reviews');
  // A reviewer's file is read leniently: a Hebrew abbreviation's quote mark (מנכ"ל) left unescaped is the gershayim it stands for.
  const lenient = (file) => {
    const text = readFileSync(file, 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      return JSON.parse(text.replace(/([֐-׿])"([֐-׿])/g, '$1״$2'));
    }
  };
  const all = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => lenient(path.join(dir, f)).map((r) => ({ ...r, reviewer: path.basename(f, '.json') }))) : [];
  const table = ['| # | Format | Pass votes | Verdict | Stop / Swipe / Act |', '|---|---|---|---|---|'];
  let passed = 0;
  const per = {};
  for (const p of plan.posts) {
    const r = results[p.n];
    if (r?.status !== 'sample') {
      table.push(`| ${p.n} | ${p.format} | - | not made (${r?.attempts?.at(-1)?.reason || 'not run'}) | |`);
      continue;
    }
    const mine = all.filter((x) => Number(x.post) === p.n);
    const votes = mine.filter((x) => String(x.verdict).toLowerCase() === 'pass').length;
    const ok = votes >= 2;
    if (ok) passed++;
    per[p.n] = { votes, of: mine.length, pass: ok };
    const sw = (k) => mine.filter((x) => x[k]).length;
    table.push(`| ${p.n} | ${p.format} | ${votes} of ${mine.length} | ${ok ? 'PASS' : 'fail'} | ${sw('stop')} / ${sw('swipe')} / ${sw('act')} |`);
    const notes = [`# Reviewer notes, round ${round}: post ${p.n} (${p.format})`, '', `Verdict: **${ok ? 'PASS' : 'FAIL'}** (${votes} of ${mine.length} reviewers passed it; it passes at 2).`, ''];
    for (const x of mine) {
      notes.push(`## ${x.reviewer}: ${String(x.verdict).toUpperCase()}`, '', `Stops the scroll: ${x.stop ? 'yes' : 'no'}. Swipes to the end: ${x.swipe ? 'yes' : 'no'}. Saves, sends or comments: ${x.act ? 'yes' : 'no'}.`, '');
      for (const k of ['why', 'notes', 'doubts', 'fixes']) if (x[k]?.length) notes.push(`**${k}**`, '', ...(Array.isArray(x[k]) ? x[k] : [x[k]]).map((t) => `- ${t}`), '');
    }
    if (existsSync(postDir(p))) W(path.join(postDir(p), 'reviewer-notes.md'), notes.join('\n'));
  }
  const head = [`# Blind review, round ${round}: ${packId}`, '', `${passed} of ${plan.posts.length} passed (a post passes when at least 2 of its 3 reviewers pass it: it stops the scroll, it gets swiped to the end, it gives a reason to save, send or comment).`, ''];
  W(path.join(RD, 'verdicts.md'), [...head, ...table].join('\n'));
  W(path.join(RD, 'verdicts.json'), { round, passed, of: plan.posts.length, posts: per });
  console.log([...head, ...table].join('\n'));
}

function status() {
  for (const r of rounds()) {
    const f = path.join(HOME, `r${r}`, 'verdicts.json');
    const res = existsSync(path.join(HOME, `r${r}`, 'results.json')) ? J(path.join(HOME, `r${r}`, 'results.json')) : {};
    const made = Object.values(res).filter((x) => x.status === 'sample').length;
    console.log(`r${r}: ${made} made${existsSync(f) ? `, ${J(f).passed} of ${J(f).of} passed the blind review` : ''}`);
  }
}

/**
 * What the launch rounds' calls would cost through the API: per call type, per
 * attempt (made or stopped), and per post made, counting the attempts the checks
 * stopped before it. The numbers behind docs/costs.md's forecast.
 */
function costs() {
  const tags = {};
  let made = 0;
  let attempts = 0;
  let prod = 0;
  let list = 0;
  for (const r of rounds()) {
    const file = path.join(HOME, `r${r}`, 'launch.db');
    if (!existsSync(file)) continue;
    const db = new Db(file);
    for (const row of db.all("SELECT tag, model, api_usd, usage_json FROM spend WHERE api = 'claude-cli'")) {
      const u = j(row.usage_json, {}) || {};
      const t = (tags[row.tag] ??= { calls: 0, input: 0, output: 0, prod: 0, list: 0, model: row.model });
      t.calls++;
      t.input += u.priced?.input ?? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      t.output += u.priced?.output ?? (u.output_tokens || 0);
      t.prod += row.api_usd || 0;
      t.list += u.listUsd || 0;
      prod += row.api_usd || 0;
      list += u.listUsd || 0;
    }
    made += db.get("SELECT COUNT(*) AS n FROM posts WHERE status = 'sample'").n;
    attempts += db.get("SELECT COUNT(*) AS n FROM posts WHERE id NOT LIKE 'seed-%'").n;
    db.close();
  }
  const lines = [`# Launch costs: ${packId}`, '', `${attempts} attempts, ${made} posts made, over rounds ${rounds().join(', ')}.`, '', '| Call | Model | Calls | Avg tokens in | Avg out | API (batched, cached) | List |', '|---|---|---|---|---|---|---|'];
  for (const [tag, t] of Object.entries(tags)) lines.push(`| ${tag} | ${String(t.model).replace('claude-', '')} | ${t.calls} | ${Math.round(t.input / t.calls).toLocaleString()} | ${Math.round(t.output / t.calls).toLocaleString()} | ${usd(t.prod)} | ${usd(t.list)} |`);
  lines.push('', `Per attempt: API ${usd(prod / Math.max(1, attempts))}, list ${usd(list / Math.max(1, attempts))}.`, `Per post made, the stopped attempts included: API ${usd(prod / Math.max(1, made))}, list ${usd(list / Math.max(1, made))}.`);
  W(path.join(HOME, 'costs.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  return { made, attempts, prod, list };
}

if (cmd === 'run') await run();
else if (cmd === 'costs') costs();
else if (cmd === 'review') review();
else if (cmd === 'verdicts') verdicts();
else status();
