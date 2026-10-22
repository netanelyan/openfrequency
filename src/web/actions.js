import path from 'node:path';
import { waitingImages } from '../images/index.js';
import { now, nowIso } from '../core/clock.js';
import { audit, setSetting, step } from '../core/store.js';
import { loadPost, checkPost, formatOfPost, igCaption, postDraft } from '../pipeline/build.js';
import { lineDraft } from '../rules/overlay.js';
import { kindName, kindOf } from '../formats/kinds.js';
import { confirmDeleted, recordTakedown } from '../publish/takedown.js';
import { renderPost } from '../render/render.js';
import { lockStyle, lockedStyle, styleByHash } from '../render/style.js';
import { pauseAccount, resumeAccount } from '../autonomy/rails.js';
import { publishPost, retireDraft, sendDraft, tiktokMode } from '../publish/index.js';
import { restAt } from '../schedule/shabbat.js';
import { timeHe } from './ui.js';
import { MODES } from '../packs/validate.js';
import { factProblems, readTopics, removeFact, saveFact } from '../sources/facts.js';
import { removeRival, saveRival } from '../pipeline/rivals.js';
import { removeSound, saveSound } from '../pipeline/sounds.js';
import { subscribe, unsubscribe } from '../notify/index.js';
import { catalogSource } from '../sources/catalog.js';
import { robotsAllows } from '../sources/robots.js';
import { israelDate } from '../schedule/israel.js';
import { DEFAULT_MONTHLY_USD } from '../budget/ledger.js';
import { addBankTopic, removeTopic, setWatchList } from '../topics/index.js';

// What each button does. Every action is a function (ctx, user, params, form)
// that returns { ok, message, redirect } or throws an ActionError with a message
// for the owner. The server handles the request, the session, the CSRF token and
// the response; this file only changes state, and audits it.

export class ActionError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const mustPost = (ctx, id) => {
  const post = loadPost(ctx.db, id);
  if (!post) throw new ActionError('הפוסט לא נמצא', 404);
  return post;
};

/**
 * Draft-now: the approved post's TikTok draft is sent at once, beside the answer (an upload to Zernio can take a
 * minute). `job` (not sent to the browser) is the send, for the tests.
 */
function draftBeside(ctx, id, result) {
  const job = sendDraft(ctx, id).catch((e) => {
    ctx.log?.(`draft ${id}: ${e.message}`);
    return { state: 'failed', why: e.message };
  });
  Object.defineProperty(result, 'job', { value: job });
  return result;
}

const DRAFT_LEFT = 'הטיוטה הקודמת כבר בתיבת הטיוטות של טיקטוק: מחקו אותה באפליקציה.';

export function approve(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  if (post.status !== 'queued') throw new ActionError(`אי אפשר לאשר פוסט במצב "${post.status}"`);
  ctx.db.update('posts', id, { status: 'approved', approved_at: nowIso(), approved_by: user.name, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'approve', accountId: post.account_id, postId: id });
  const pack = ctx.pack(post.account_id);
  if (pack && tiktokMode(pack) === 'draft-now' && pack.meta.platforms.includes('tiktok')) {
    const rest = restAt(now());
    const at = post.slot_at ? ` תזכורת תגיע ב-${timeHe(post.slot_at)}.` : '';
    return draftBeside(ctx, id, { ok: true, message: rest ? `אושר. הטיוטה תישלח לטיקטוק כש${rest} ייגמר.${at}` : `אושר. הטיוטה נשלחת לטיקטוק.${at}` });
  }
  return { ok: true, message: post.slot_at ? 'אושר. ייצא בשעה שלו.' : 'אושר.' };
}

/**
 * Approve many at once (the page of every account): the posts the page listed, in `ids`, that still wait. A post
 * drafted after the page was opened is not in the list, so it is never approved unseen. `job` is every draft sent.
 */
export function approveAll(ctx, user, params, form) {
  const ids = [...new Set(String(form.ids || '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]+$/.test(s)))].slice(0, 500);
  if (!ids.length) throw new ActionError('אין פוסטים לאשר');
  const jobs = [];
  let done = 0;
  for (const id of ids) {
    if (ctx.db.get('SELECT status FROM posts WHERE id = ?', id)?.status !== 'queued') continue;
    const r = approve(ctx, user, { id });
    done++;
    if (r.job) jobs.push(r.job);
  }
  if (!done) throw new ActionError('אף אחד מהפוסטים האלה כבר לא מחכה לאישור');
  const skipped = ids.length - done;
  const rest = jobs.length ? restAt(now()) : null;
  const next = jobs.length ? (rest ? ` הטיוטות יישלחו לטיקטוק כש${rest} ייגמר.` : ' הטיוטות נשלחות לטיקטוק.') : ' כל פוסט ייצא בשעה שלו.';
  const result = { ok: true, message: `${done === 1 ? 'פוסט אחד אושר' : `${done} פוסטים אושרו`}${skipped ? ` (${skipped} כבר לא חיכו)` : ''}.${next}` };
  Object.defineProperty(result, 'job', { value: Promise.all(jobs) });
  return result;
}

export function unapprove(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  if (post.status !== 'approved') throw new ActionError('הפוסט לא מאושר');
  const left = retireDraft(ctx.db, post);
  ctx.db.update('posts', id, { status: 'queued', approved_at: null, approved_by: null, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'unapprove', accountId: post.account_id, postId: id, detail: left ? { draftLeft: true } : null });
  return { ok: true, message: `האישור בוטל. הפוסט חזר להמתנה.${left ? ` ${DRAFT_LEFT}` : ''}` };
}

export function reject(ctx, user, { id }, form) {
  const post = mustPost(ctx, id);
  if (!['queued', 'approved', 'sample'].includes(post.status)) throw new ActionError(`אי אפשר לדחות פוסט במצב "${post.status}"`);
  const reason = [String(form.reason || '').trim(), String(form.note || '').trim()].filter(Boolean).join(': ').slice(0, 300) || 'נדחה';
  const left = retireDraft(ctx.db, post);
  ctx.db.update('posts', id, { status: 'rejected', reason, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'reject', accountId: post.account_id, postId: id, detail: { reason } });
  return { ok: true, message: `נדחה. הסיבה נשמרה.${left ? ` ${DRAFT_LEFT}` : ''}` };
}

/** The owner deleted a post's old TikTok drafts in the app: the reminder on the post goes away. */
export function oldDraftsDeleted(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  if (!post.publish?.oldDrafts?.length) return { ok: true, message: 'אין טיוטות ישנות.' };
  const { oldDrafts, ...rest } = post.publish;
  ctx.db.update('posts', id, { publish_json: rest, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'tiktok_old_drafts_deleted', accountId: post.account_id, postId: id, detail: { n: oldDrafts.length } });
  return { ok: true, message: 'סומן. הטיוטות הישנות נמחקו.' };
}

export async function publishNow(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  try {
    const r = await publishPost(ctx, id);
    audit(ctx.db, { actor: user.name, action: 'publish_now', accountId: post.account_id, postId: id, detail: { via: r.via, ok: r.ok } });
    return { ok: r.ok, message: r.ok ? (r.via === 'dry' ? 'פורסם בפרסום יבש: נכתב לדיסק.' : 'פורסם.') : 'הפרסום נכשל. הסיבה בדף הפוסט.' };
  } catch (e) {
    throw new ActionError(`לא פורסם: ${e.message}`);
  }
}

/**
 * Save edited text. Runs the voice, rules and fact checks again; on any problem
 * nothing is saved and the problems come back. On success the slides are
 * rendered again with a new token from the gate, and every change is kept in
 * `edits`, which the next drafts read as examples of the owner's voice.
 */
export async function edit(ctx, user, { id }, form) {
  const post = mustPost(ctx, id);
  if (!['queued', 'approved', 'sample'].includes(post.status)) throw new ActionError(`אי אפשר לערוך פוסט במצב "${post.status}"`);
  const pack = ctx.pack(post.account_id);
  const clean = (s, max) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);
  const format = formatOfPost(ctx.db, pack, post);
  const legacy = kindName(format) === 'list';
  let item = -1;
  const draft = postDraft(post);
  draft.hook = clean(form.hook, 90);
  draft.sub = clean(form.sub, 120);
  draft.caption = clean(form.caption, legacy ? 400 : 900);
  if (form.caption_short != null) draft.captionShort = clean(form.caption_short, 260);
  draft.slides = draft.slides.map((s) => {
    if (s.kind !== 'item') return s;
    item++;
    return { ...s, title: clean(form[`title_${item}`] ?? s.title, 80), body: clean(form[`body_${item}`] ?? s.body, 300) };
  });
  // A line the owner left longer than the account's rule is broken in code, as a draft's would be.
  lineDraft(draft, pack);
  draft.captionIg = igCaption(draft);
  const { problems, gate } = checkPost({ ...ctx, packs: ctx.packs }, pack, draft, post.facts, format);
  if (problems.length) throw new ActionError('הבדיקות עצרו את השינוי', 422, { problems: problems.map((p) => `${p.where}: ${p.msg}`), values: { ...form } });

  const names = new Map(ctx.db.all('SELECT id, name FROM sources WHERE account_id = ?', pack.id).map((r) => [r.id, r.name]));
  const sourceOf = new Map(post.facts.map((f) => [f.key, names.get(f.source_id)]));
  const slides = draft.slides.map((s) => ({ ...s, sources: s.factKeys.map((k) => sourceOf.get(k)) }));
  const image = post.checks?.image ? ctx.db.get('SELECT * FROM images WHERE id = ?', post.checks.image) : null;
  const outDir = path.dirname(post.media.tiktok?.[0] || post.media.instagram?.[0]);
  const extra = { captionIg: draft.captionIg || '', keywords: draft.keywords || [], subject: draft.subject || {}, cta: draft.cta?.text || '' };
  // Drawn again as it was drawn: in the look it went out in, with every photograph it had (each slide's, the one
  // behind the slides, a head-to-head's two faces). An edit used to bring back the cover's photograph alone.
  const look = styleByHash(ctx.db, pack, post.checks?.style) || lockedStyle(ctx.db, pack, ctx.packs);
  const img = (imageId) => (imageId ? ctx.db.get('SELECT * FROM images WHERE id = ?', imageId) : null);
  const photos = new Map(
    [...post.slides.map((s) => [s.idx, img(s.image_id)]), ['bg', img(post.checks?.bgImage)], ...(post.checks?.coverImages || []).map((x, k) => [k ? 'cb' : 'ca', img(x)])].filter(([, p]) => p?.file)
  );
  const files = await renderPost({
    pack: { ...pack, theme: look.theme }, format, post: { id, hook: draft.hook, sub: draft.sub, caption: draft.caption, token: gate.token, extra, ctaKind: draft.cta?.kind }, slides,
    ...(photos.size ? { photos } : { photo: image, photoOn: kindOf(format).photo }), outDir,
  });

  ctx.db.tx(() => {
    const changes = [];
    const note = (slideIdx, field, before, after) => {
      if (String(before || '') !== String(after || '')) changes.push({ slide_idx: slideIdx, field, before, after });
    };
    note(null, 'hook', post.hook, draft.hook);
    note(null, 'sub', post.sub, draft.sub);
    note(null, 'caption', post.caption, draft.caption);
    note(null, 'caption_short', post.data?.captionShort, draft.captionShort);
    post.slides.forEach((s, i) => {
      if (s.kind !== 'item') return;
      note(i, 'title', s.title, draft.slides[i].title);
      note(i, 'body', s.body, draft.slides[i].body);
      ctx.db.run('UPDATE slides SET title = ?, body = ? WHERE post_id = ? AND idx = ?', draft.slides[i].title, draft.slides[i].body, id, i);
    });
    for (const c of changes) ctx.db.insert('edits', { post_id: id, account_id: post.account_id, ...c, user_id: user.id, at: nowIso() });
    ctx.db.update('posts', id, { hook: draft.hook, sub: draft.sub, caption: draft.caption, caption_ig: draft.captionIg, data_json: { ...post.data, captionShort: draft.captionShort }, media_json: files, checks_json: { ...post.checks, token: gate.token, edited: true, style: look.hash }, updated_at: nowIso() });
    step(ctx.db, id, 'edit', 'ok', { by: user.name, changes: changes.length });
    audit(ctx.db, { actor: user.name, action: 'edit', accountId: post.account_id, postId: id, detail: { changes: changes.length } });
  });
  // A draft sent before the edit is the old text: it stays in the app for the owner to delete, and the new one goes.
  if (post.status === 'approved' && retireDraft(ctx.db, loadPost(ctx.db, id))) {
    return draftBeside(ctx, id, { ok: true, message: `נשמר ועבר את הבדיקות. השקפים רונדרו מחדש, וטיוטה חדשה נשלחת לטיקטוק. ${DRAFT_LEFT}`, redirect: `/post/${id}` });
  }
  return { ok: true, message: 'נשמר ועבר את הבדיקות. השקפים רונדרו מחדש.', redirect: `/post/${id}` };
}

export function setMode(ctx, user, { id }, form) {
  if (!ctx.pack(id)) throw new ActionError('אין חשבון כזה', 404);
  if (!MODES.includes(form.mode)) throw new ActionError('מצב לא מוכר');
  ctx.db.update('accounts', id, { mode: form.mode, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'mode', accountId: id, detail: { mode: form.mode } });
  return { ok: true, message: 'המצב עודכן.' };
}

/** The owner applies the account's theme.json: the next posts are drawn in it, and the posts already drawn keep theirs. */
export function applyStyle(ctx, user, { id }) {
  const pack = ctx.pack(id);
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const lock = lockStyle(ctx.db, pack);
  audit(ctx.db, { actor: user.name, action: 'style', accountId: id, detail: { hash: lock.hash, look: `${pack.theme.template}/${pack.theme.variant || 'a'}` } });
  return { ok: true, message: 'עברתם לסגנון החדש. הפוסטים הבאים ייצאו בו, ואלה שכבר צוירו לא משתנים.' };
}

export function killAccount(ctx, user, { id }) {
  if (!ctx.pack(id)) throw new ActionError('אין חשבון כזה', 404);
  pauseAccount(ctx.db, id, 'kill', `${user.name} כיבה את החשבון`, user.name);
  return { ok: true, message: 'החשבון כובה. שום דבר לא ייכתב ולא יפורסם בו.' };
}

export function resume(ctx, user, { id }) {
  if (!ctx.pack(id)) throw new ActionError('אין חשבון כזה', 404);
  resumeAccount(ctx.db, id, user.name);
  return { ok: true, message: 'החשבון פעיל שוב.' };
}

export function globalKill(ctx, user, _p, form) {
  const on = form.on === '1';
  setSetting(ctx.db, 'globalKill', on);
  audit(ctx.db, { actor: user.name, action: on ? 'global_kill_on' : 'global_kill_off' });
  return { ok: true, message: on ? 'הכל נעצר.' : 'הכל פועל שוב.' };
}

/** A lower cap than OF_BUDGET_MONTHLY_USD for now, never a higher one; 0 goes back to it. */
export function setBudget(ctx, user, _p, form) {
  const hard = Number(process.env.OF_BUDGET_MONTHLY_USD) > 0 ? Number(process.env.OF_BUDGET_MONTHLY_USD) : DEFAULT_MONTHLY_USD;
  // The owner types tokens (100 to a dollar); the cap is kept in dollars, as the ledger counts.
  const t = Number(form.budget);
  const max = Math.round(hard * 100);
  if (!(t >= 0 && t <= max)) throw new ActionError(`התקרה צריכה להיות בין 0 ל-${max.toLocaleString('en-US')} טוקנים`);
  const n = t / 100;
  setSetting(ctx.db, 'globalBudgetUsd', n);
  audit(ctx.db, { actor: user.name, action: 'global_budget', detail: { usd: n || hard } });
  return { ok: true, message: n ? `התקרה לחודש הזה: ${t.toLocaleString('en-US')} טוקנים.` : `התקרה חזרה ל-${max.toLocaleString('en-US')} טוקנים.` };
}

export function setGenerateAt(ctx, user, _p, form) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(form.at || ''))) throw new ActionError('צריך שעה כמו 07:30');
  setSetting(ctx.db, 'generateAt', form.at);
  audit(ctx.db, { actor: user.name, action: 'generate_at', detail: { at: form.at } });
  return { ok: true, message: 'נשמר.' };
}

export function sourceStatus(ctx, user, { id }, _form, status) {
  const s = ctx.db.get('SELECT * FROM sources WHERE id = ?', Number(id));
  if (!s) throw new ActionError('אין מקור כזה', 404);
  ctx.db.update('sources', s.id, { status, approved_at: status === 'approved' ? nowIso() : s.approved_at });
  audit(ctx.db, { actor: user.name, action: `source_${status}`, accountId: s.account_id, detail: { source: s.key, url: s.url } });
  return { ok: true, message: status === 'approved' ? 'המקור אושר.' : 'המקור הוסר. פוסטים שנשענים עליו ייחסמו לפני פרסום.', redirect: `/sources?account=${encodeURIComponent(s.account_id)}` };
}

export function addSource(ctx, user, _p, form) {
  const problems = [];
  const account = String(form.account || '');
  if (!ctx.pack(account)) problems.push('אין חשבון כזה');
  let url = '';
  try {
    url = new URL(String(form.url || '').trim()).href;
    if (!url.startsWith('https://')) problems.push('צריך כתובת שמתחילה ב-https');
  } catch {
    problems.push('הכתובת לא נראית כמו קישור');
  }
  if (!['rss', 'web', 'api'].includes(form.type)) problems.push('סוג לא מוכר');
  if (String(form.why || '').trim().length < 10) problems.push('צריך לכתוב למה סומכים על המקור');
  if (!String(form.name || '').trim()) problems.push('צריך שם');
  if (problems.length) throw new ActionError('המקור לא נוסף', 422, { problems, values: { ...form } });
  const key = `manual-${new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}`;
  ctx.db.insert('sources', { account_id: account, key, type: form.type, url, name: String(form.name).trim().slice(0, 120), why: String(form.why).trim().slice(0, 400), status: 'approved', origin: 'manual', approved_at: nowIso(), config_json: {}, created_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'source_added', accountId: account, detail: { url } });
  return { ok: true, message: 'המקור נוסף ואושר.', redirect: `/sources?account=${encodeURIComponent(account)}` };
}

/**
 * An outlet from the catalog (src/sources/catalog.js), added to an account's approved sources: its site's robots.txt
 * is asked again first, so one that has since told Claude to stay out is refused here. `ctx.robotsAllows` replaces
 * the network for the tests.
 */
export async function addCatalogSource(ctx, user, _p, form) {
  const account = String(form.account || '');
  if (!ctx.pack(account)) throw new ActionError('אין חשבון כזה', 404);
  const src = catalogSource(String(form.niche || ''), String(form.id || ''));
  if (!src) throw new ActionError('אין מקור כזה ברשימה', 404);
  const robots = await (ctx.robotsAllows || robotsAllows)(src.url);
  if (!robots.ok) throw new ActionError(`${src.name} לא נוסף: ${robots.why}`, 422);
  const have = ctx.db.get('SELECT id, status FROM sources WHERE account_id = ? AND url = ?', account, src.url);
  if (have?.status === 'approved') return { ok: true, message: `${src.name} כבר מקור מאושר.`, redirect: `/sources?account=${encodeURIComponent(account)}` };
  if (have) ctx.db.update('sources', have.id, { status: 'approved', approved_at: nowIso(), last_error: null });
  else ctx.db.insert('sources', { account_id: account, key: `catalog-${src.id}`, type: src.type, url: src.url, name: src.name, why: src.why, lang: src.lang, status: 'approved', origin: 'manual', approved_at: nowIso(), config_json: { hints: src.hints }, created_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'source_added', accountId: account, detail: { url: src.url, catalog: `${form.niche}/${src.id}` } });
  return { ok: true, message: `${src.name} נוסף ואושר.`, redirect: `/sources?account=${encodeURIComponent(account)}` };
}


// ---- hand-checked facts (src/sources/facts.js), written into the pack's facts/ folder

const factPack = (ctx, form) => {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  return { pack, dir: path.join(pack.dir, 'facts') };
};

export function addFact(ctx, user, _p, form) {
  const { pack, dir } = factPack(ctx, form);
  const topic = String(form.topic || '').trim().slice(0, 60);
  const fact = {
    quote: String(form.quote || '').replace(/\s+/g, ' ').trim(),
    source: String(form.source || '').trim().slice(0, 80),
    url: String(form.url || '').trim(),
    checkedAt: String(form.checkedAt || ''),
    checkedBy: user.name,
    expires: String(form.expires || ''),
    note: String(form.note || '').trim().slice(0, 200),
  };
  const problems = [...(topic ? [] : ['צריך נושא']), ...factProblems(fact, { maxQuoteWords: pack.rules.maxQuoteWords || 40 })];
  if (problems.length) throw new ActionError('העובדה לא נשמרה', 422, { problems, values: { ...form } });
  const first = !pack.facts;
  saveFact(dir, topic, fact);
  // The first fact makes the folder, and the folder makes the pack's "facts" source.
  if (first) ctx.reloadPacks();
  audit(ctx.db, { actor: user.name, action: 'fact_added', accountId: pack.id, detail: { topic, url: fact.url, expires: fact.expires } });
  return { ok: true, message: 'העובדה נשמרה. היא תשמש פוסטים עד תאריך התפוגה.', redirect: `/facts?account=${encodeURIComponent(pack.id)}` };
}

export function confirmFact(ctx, user, _p, form) {
  const { pack, dir } = factPack(ctx, form);
  const topic = readTopics(dir).find((t) => t.topic === form.topic);
  const fact = topic?.facts.find((f) => f.id === form.id);
  if (!fact) throw new ActionError('העובדה לא נמצאה', 404);
  const next = { ...fact, checkedAt: israelDate(Date.now()), checkedBy: user.name, expires: String(form.expires || fact.expires) };
  const problems = factProblems(next, { maxQuoteWords: pack.rules.maxQuoteWords || 40 });
  if (problems.length) throw new ActionError(problems[0]);
  saveFact(dir, topic.topic, next);
  audit(ctx.db, { actor: user.name, action: 'fact_confirmed', accountId: pack.id, detail: { topic: topic.topic, id: fact.id, expires: next.expires } });
  return { ok: true, message: `נבדקה שוב, בתוקף עד ${next.expires}.`, redirect: `/facts?account=${encodeURIComponent(pack.id)}` };
}

export function removeFactAction(ctx, user, _p, form) {
  const { pack, dir } = factPack(ctx, form);
  const gone = removeFact(dir, String(form.topic || ''), String(form.id || ''));
  if (!gone) throw new ActionError('העובדה לא נמצאה', 404);
  audit(ctx.db, { actor: user.name, action: 'fact_removed', accountId: pack.id, detail: { topic: form.topic, quote: gone.quote.slice(0, 80) } });
  return { ok: true, message: 'הוסרה. פוסט שעוד לא פורסם ונשען עליה ייחסם בבדיקה שלפני הפרסום.', redirect: `/facts?account=${encodeURIComponent(pack.id)}` };
}

// ---- rivals the owner watches (src/pipeline/rivals.js), typed in by hand

export function saveRivalAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const r = saveRival(ctx.db, pack.id, form, { by: user.name });
  if (r.problems) throw new ActionError('המתחרה לא נשמר', 422, { problems: r.problems, values: { ...form } });
  audit(ctx.db, { actor: user.name, action: form.id ? 'rival_updated' : 'rival_added', accountId: pack.id, detail: { handle: String(form.handle || '').replace(/^@+/, '').trim(), platform: form.platform } });
  return { ok: true, message: form.id ? 'עודכן. הכתיבה הבאה תשתמש בזה.' : 'נוסף. הכתיבה הבאה תשתמש בזה.', redirect: `/rivals?account=${encodeURIComponent(pack.id)}` };
}

export function removeRivalAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const gone = removeRival(ctx.db, pack.id, form.id);
  if (!gone) throw new ActionError('אין מתחרה כזה', 404);
  audit(ctx.db, { actor: user.name, action: 'rival_removed', accountId: pack.id, detail: { handle: gone.handle, platform: gone.platform } });
  return { ok: true, message: `@${gone.handle} הוסר.`, redirect: `/rivals?account=${encodeURIComponent(pack.id)}` };
}

export function saveSoundAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const r = saveSound(ctx.db, pack.id, form, { by: user.name });
  if (r.problems) throw new ActionError('הסאונד לא נשמר', 422, { problems: r.problems, values: { ...form } });
  audit(ctx.db, { actor: user.name, action: 'sound_added', accountId: pack.id, detail: { name: String(form.name || '').trim() } });
  return { ok: true, message: 'נוסף. הטיוטה הבאה בטיקטוק תקבל סאונד מהרשימה.', redirect: `/sounds?account=${encodeURIComponent(pack.id)}` };
}

export function removeSoundAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const gone = removeSound(ctx.db, pack.id, form.id);
  if (!gone) throw new ActionError('אין סאונד כזה', 404);
  audit(ctx.db, { actor: user.name, action: 'sound_removed', accountId: pack.id, detail: { name: gone.name } });
  return { ok: true, message: `"${gone.name}" הוסר.`, redirect: `/sounds?account=${encodeURIComponent(pack.id)}` };
}

/** A browser asks for notifications: its push endpoint is kept. */
export function subscribePush(ctx, user, _p, form) {
  const r = subscribe(ctx.db, { endpoint: form.endpoint }, { userId: user.id ?? null });
  if (!r.ok) throw new ActionError('הדפדפן לא החזיר כתובת התראות תקינה');
  audit(ctx.db, { actor: user.name, action: 'push_subscribed', detail: { host: new URL(String(form.endpoint)).hostname } });
  return { ok: true, message: 'ההתראות מופעלות בדפדפן הזה.' };
}

/** A browser turns its notifications off: its endpoint is forgotten. */
export function unsubscribePush(ctx, user, _p, form) {
  const n = unsubscribe(ctx.db, { endpoint: form.endpoint });
  audit(ctx.db, { actor: user.name, action: 'push_unsubscribed', detail: { n } });
  return { ok: true, message: 'ההתראות כבויות בדפדפן הזה.' };
}

/** A takedown notice for a post: recorded, the post taken down, the account paused on the second in 90 days. */
export async function takedown(ctx, user, { id }, form) {
  const post = mustPost(ctx, id);
  const notice = String(form.notice || '').trim();
  if (notice.length < 10) throw new ActionError('הדביקו את נוסח ההודעה (לפחות כמה מילים)');
  const platform = ['tiktok', 'instagram'].includes(form.platform) ? form.platform : null;
  const r = await recordTakedown(ctx, { postId: id, platform, claimant: String(form.claimant || '').trim(), notice, by: user.name });
  const hand = Object.entries(r.deleted).filter(([, v]) => v.state === 'by_hand').map(([p]) => (p === 'tiktok' ? 'טיקטוק' : 'אינסטגרם'));
  return {
    ok: true,
    message: `ההודעה נרשמה והפוסט ירד.${hand.length ? ` צריך למחוק ידנית ב${hand.join(' וב')}: הפרטים בדף הפוסט.` : ''}${r.paused ? ` החשבון הושהה: ${r.count} הודעות ב-90 יום.` : ''}`,
    redirect: `/post/${id}`,
  };
}

/** The owner deleted the post by hand on one platform. */
export function takedownDeleted(ctx, user, { id }, form) {
  const platform = ['tiktok', 'instagram'].includes(form.platform) ? form.platform : null;
  if (!platform) throw new ActionError('איזו פלטפורמה?');
  try {
    confirmDeleted(ctx.db, { id: Number(id), platform, by: user.name });
  } catch (e) {
    throw new ActionError(e.message);
  }
  return { ok: true, message: 'סומן כנמחק.' };
}

/** A person looked at a photograph the screen could not clear, and it is fine. */
export function imageOk(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  // The person looked at the post's page, every slide on it: every photograph waiting there is marked.
  const waiting = waitingImages(ctx.db, post);
  if (!waiting.length) throw new ActionError('לפוסט הזה אין תמונה שמחכה לבדיקה');
  for (const img of waiting) ctx.db.update('images', img.id, { reviewed_by: user.name, reviewed_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'image_ok', accountId: post.account_id, postId: id, detail: { images: waiting.map((i) => i.id) } });
  return { ok: true, message: waiting.length > 1 ? `${waiting.length} התמונות סומנו כבדוקות. אפשר לפרסם.` : 'התמונה סומנה כבדוקה. אפשר לפרסם.' };
}

/* ------------------------------------------------------------ topics: the bank and the watch list (src/topics) */

export function addTopicAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  try {
    addBankTopic(ctx.db, pack.id, { title: form.title, why: form.why, url: form.url }, user.name);
  } catch (e) {
    throw new ActionError('הנושא לא נשמר', 422, { problems: [e.message], values: { ...form } });
  }
  return { ok: true, message: 'נוסף לבנק. הוא יקבל ציון, והפוסט הבא יתחיל ממנו.', redirect: '/topics' };
}

export function removeTopicAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  if (!removeTopic(ctx.db, pack.id, Number(form.id), user.name)) throw new ActionError('אין נושא כזה', 404);
  return { ok: true, message: 'הוסר.', redirect: '/topics' };
}

export function saveWatchAction(ctx, user, _p, form) {
  const pack = ctx.pack(String(form.account || ''));
  if (!pack) throw new ActionError('אין חשבון כזה', 404);
  const names = setWatchList(ctx.db, pack, form.names);
  audit(ctx.db, { actor: user.name, action: 'watch_saved', accountId: pack.id, detail: { n: names.length } });
  return { ok: true, message: names.length ? `נשמרו ${names.length} שמות. הם נבדקים פעם ביום.` : 'הרשימה ריקה: ויקיפדיה לא תיבדק.', redirect: '/topics' };
}
