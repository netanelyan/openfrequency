import path from 'node:path';
import { nowIso } from '../core/clock.js';
import { audit, setSetting, step } from '../core/store.js';
import { loadPost, checkPost } from '../pipeline/build.js';
import { renderPost } from '../render/render.js';
import { pauseAccount, resumeAccount } from '../autonomy/rails.js';
import { publishPost } from '../publish/index.js';
import { MODES } from '../packs/validate.js';
import { factProblems, readTopics, removeFact, saveFact } from '../sources/facts.js';
import { israelDate } from '../schedule/israel.js';
import { DEFAULT_MONTHLY_USD } from '../budget/ledger.js';

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

export function approve(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  if (post.status !== 'queued') throw new ActionError(`אי אפשר לאשר פוסט במצב "${post.status}"`);
  ctx.db.update('posts', id, { status: 'approved', approved_at: nowIso(), approved_by: user.name, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'approve', accountId: post.account_id, postId: id });
  return { ok: true, message: post.slot_at ? 'אושר. ייצא בשעה שלו.' : 'אושר.' };
}

export function unapprove(ctx, user, { id }) {
  const post = mustPost(ctx, id);
  if (post.status !== 'approved') throw new ActionError('הפוסט לא מאושר');
  ctx.db.update('posts', id, { status: 'queued', approved_at: null, approved_by: null, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'unapprove', accountId: post.account_id, postId: id });
  return { ok: true, message: 'האישור בוטל. הפוסט חזר להמתנה.' };
}

export function reject(ctx, user, { id }, form) {
  const post = mustPost(ctx, id);
  if (!['queued', 'approved', 'sample'].includes(post.status)) throw new ActionError(`אי אפשר לדחות פוסט במצב "${post.status}"`);
  const reason = [String(form.reason || '').trim(), String(form.note || '').trim()].filter(Boolean).join(': ').slice(0, 300) || 'נדחה';
  ctx.db.update('posts', id, { status: 'rejected', reason, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'reject', accountId: post.account_id, postId: id, detail: { reason } });
  return { ok: true, message: 'נדחה. הסיבה נשמרה.' };
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
  let item = -1;
  const draft = {
    hook: clean(form.hook, 90),
    sub: clean(form.sub, 120),
    caption: clean(form.caption, 400),
    slides: post.slides.map((s) => {
      if (s.kind !== 'item') return { kind: s.kind, title: s.title, body: s.body, factKeys: s.factKeys };
      item++;
      return { kind: 'item', title: clean(form[`title_${item}`] ?? s.title, 80), body: clean(form[`body_${item}`] ?? s.body, 300), factKeys: s.factKeys };
    }),
  };
  const { problems, gate } = checkPost({ ...ctx, packs: ctx.packs }, pack, draft, post.facts);
  if (problems.length) throw new ActionError('הבדיקות עצרו את השינוי', 422, { problems: problems.map((p) => `${p.where}: ${p.msg}`), values: { ...form } });

  const names = new Map(ctx.db.all('SELECT id, name FROM sources WHERE account_id = ?', pack.id).map((r) => [r.id, r.name]));
  const sourceOf = new Map(post.facts.map((f) => [f.key, names.get(f.source_id)]));
  const slides = draft.slides.map((s) => ({ ...s, sources: s.factKeys.map((k) => sourceOf.get(k)) }));
  const image = post.checks?.image ? ctx.db.get('SELECT * FROM images WHERE id = ?', post.checks.image) : null;
  const outDir = path.dirname(post.media.tiktok?.[0] || post.media.instagram?.[0]);
  const files = await renderPost({ pack, post: { id, hook: draft.hook, sub: draft.sub, caption: draft.caption, token: gate.token }, slides, photo: image, outDir });

  ctx.db.tx(() => {
    const changes = [];
    const note = (slideIdx, field, before, after) => {
      if (String(before || '') !== String(after || '')) changes.push({ slide_idx: slideIdx, field, before, after });
    };
    note(null, 'hook', post.hook, draft.hook);
    note(null, 'sub', post.sub, draft.sub);
    note(null, 'caption', post.caption, draft.caption);
    post.slides.forEach((s, i) => {
      if (s.kind !== 'item') return;
      note(i, 'title', s.title, draft.slides[i].title);
      note(i, 'body', s.body, draft.slides[i].body);
      ctx.db.run('UPDATE slides SET title = ?, body = ? WHERE post_id = ? AND idx = ?', draft.slides[i].title, draft.slides[i].body, id, i);
    });
    for (const c of changes) ctx.db.insert('edits', { post_id: id, account_id: post.account_id, ...c, user_id: user.id, at: nowIso() });
    ctx.db.update('posts', id, { hook: draft.hook, sub: draft.sub, caption: draft.caption, media_json: files, checks_json: { ...post.checks, token: gate.token, edited: true }, updated_at: nowIso() });
    step(ctx.db, id, 'edit', 'ok', { by: user.name, changes: changes.length });
    audit(ctx.db, { actor: user.name, action: 'edit', accountId: post.account_id, postId: id, detail: { changes: changes.length } });
  });
  return { ok: true, message: 'נשמר, נבדק ורונדר מחדש.', redirect: `/post/${id}` };
}

export function setMode(ctx, user, { id }, form) {
  if (!ctx.pack(id)) throw new ActionError('אין חשבון כזה', 404);
  if (!MODES.includes(form.mode)) throw new ActionError('מצב לא מוכר');
  ctx.db.update('accounts', id, { mode: form.mode, updated_at: nowIso() });
  audit(ctx.db, { actor: user.name, action: 'mode', accountId: id, detail: { mode: form.mode } });
  return { ok: true, message: 'המצב עודכן.' };
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
  return { ok: true, message: on ? 'הכל נעצר.' : 'המערכת פועלת שוב.' };
}

/** A lower cap than OF_BUDGET_MONTHLY_USD for now, never a higher one; 0 goes back to it. */
export function setBudget(ctx, user, _p, form) {
  const hard = Number(process.env.OF_BUDGET_MONTHLY_USD) > 0 ? Number(process.env.OF_BUDGET_MONTHLY_USD) : DEFAULT_MONTHLY_USD;
  const n = Number(form.budget);
  if (!(n >= 0 && n <= hard)) throw new ActionError(`תקרה בין 0 ל-${hard} דולר. התקרה עצמה נקבעת ב-.env (OF_BUDGET_MONTHLY_USD)`);
  setSetting(ctx.db, 'globalBudgetUsd', n);
  audit(ctx.db, { actor: user.name, action: 'global_budget', detail: { usd: n || hard } });
  return { ok: true, message: n ? `התקרה לחודש הזה: ${n}.` : `התקרה חזרה ל-${hard} מ-.env.` };
}

export function setGenerateAt(ctx, user, _p, form) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(form.at || ''))) throw new ActionError('שעה בפורמט HH:MM');
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
    if (!url.startsWith('https://')) problems.push('רק כתובות https');
  } catch {
    problems.push('כתובת לא תקינה');
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
