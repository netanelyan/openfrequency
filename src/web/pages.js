import { accDot, csrfField, dayHe, esc, icon, k, layout, markDots, MODE_HE, postButton, shortDate, stamp, statusChip, timeHe, usd, weekdayNarrow } from './ui.js';
import { PAUSE_REASONS } from '../autonomy/rails.js';
import { KINDS, MIX } from '../formats/kinds.js';
import { BOXES, MEASURES, PRIORITY } from '../metrics/feedback.js';
import { RIVALS } from '../pipeline/rivals.js';

const KIND_HE = Object.fromEntries(Object.entries(KINDS).map(([k2, v]) => [k2, v.name]));

// Every page, as a function from data to HTML.
//
// The words on the pages are Hebrew; what came from a source (an English quote,
// a URL) keeps its own direction inside an isolated run.

const REJECT_REASONS = ['לא מעניין', 'טעות בעובדה', 'הקול לא נכון', 'נושא שכבר היה', 'העיצוב לא עובד'];
const STEP_HE = {
  format: 'פורמט', topic: 'בחירת נושא', outline: 'מתווה ועובדות', facts: 'אימות עובדות', slides: 'כתיבת שקפים', redraft: 'כתיבה מחדש', rewrite: 'שכתוב מה שנשמע כמו בוט', review: 'בדיקת "נשמע כמו בוט"', verify: 'שער העובדות',
  image: 'תמונה', render: 'רינדור', queue: 'לתור', publish: 'פרסום', blocked: 'נחסם', error: 'שגיאה', edit: 'עריכה', subject: 'נושא השבוע', takedown: 'הודעת הסרה',
};
// The checks on the Results page's block rates, by the names src/pipeline/build.js checkOf gives them.
const CHECK_HE = {
  facts: 'שער העובדות: מספר שלא בציטוט', shape: 'צורת הפורמט', visuals: 'גרפיקות', details: 'פרטים מהמחקר', caption: 'כיתוב (אורך, חסר)', keywords: 'מילות מפתח', length: 'אורך כותרת או שקף', overlay: 'טקסט על התמונה',
  'voice:banned': 'קול: מילה אסורה', 'voice:phrase': 'קול: ביטוי של בוט', 'voice:register': 'קול: משלב', 'voice:structure': 'קול: מבנה', 'voice:length': 'קול: אורך ומשפטים', 'voice:language': 'קול: שפה', 'voice:url': 'קול: קישור', 'voice:artefact': 'קול: שארית של מודל', 'voice:empty': 'טקסט ריק',
  'kind:no_source': 'אין מסמך שמחזיק פוסט', 'kind:no_photo': 'אין תמונה של שני הצדדים', 'kind:fact_check': 'עובדות שלא אומתו (בתכנון)', 'kind:voice': 'נשמע כמו בוט (ציון הבודק)', 'kind:review': 'הבודק: יותר מהעובדות', 'kind:budget': 'תקציב', 'kind:shape': 'צורת הפורמט', 'kind:rules': 'חוק או כלל של החשבון',
};
const checkHe = (c) => CHECK_HE[c] || (/^compliance:/.test(c) ? `חוק: ${c.slice(11)}` : /^rule:/.test(c) ? `כלל של החשבון: ${c.slice(5)}` : /^honesty:/.test(c) ? `כנות: ${c.slice(8)}` : c);

/** Which checks stop posts: the top ten, blocked and failed first, as shares of the posts drafted. */
export function blocksPanel(b) {
  if (!b?.total) return '';
  const pct = (n) => `${Math.round((n / b.total) * 100)}%`;
  const rows = b.rows.filter((r) => r.blocked || r.firstFail).slice(0, 10);
  return `<section class="panel"><header><h2>מה חוסם פוסטים</h2><span class="end muted small">${b.blocked} מתוך ${b.total} פוסטים נחסמו (${pct(b.blocked)}) ב-30 הימים האחרונים</span></header>
${rows.length ? `<table class="table stack"><thead><tr><th>בדיקה</th><th>חסמה</th><th>מהפוסטים</th><th>נכשלה בטיוטה הראשונה</th></tr></thead><tbody>${rows.map((r) => `<tr><td data-k="">${esc(checkHe(r.check))}</td><td class="n" data-k="חסמה">${r.blocked}</td><td class="n" data-k="מהפוסטים">${pct(r.blocked)}</td><td class="n" data-k="טיוטה ראשונה">${r.firstFail ? `${r.firstFail} (${pct(r.firstFail)})` : '–'}</td></tr>`).join('')}</tbody></table>
<p class="muted small">פוסט שנחסם בכמה בדיקות נספר בכל אחת. "נכשלה בטיוטה הראשונה": לפני התיקון והכתיבה מחדש, שמצילים חלק מהם.</p>` : '<p class="muted">אף פוסט לא נחסם.</p>'}</section>`;
}

const ROLE_NAME = {
  beat: 'בנייה', payoff: 'הסוף', then: 'אז', turn: 'התפנית', now: 'היום', context: 'רקע', moment: 'הרגע', after: 'אחרי', clue: 'רמז', reveal: 'התשובה',
  stat: 'נתון', verdict: 'השורה התחתונה', ranks: 'מקומות 10 עד 6', rank: 'מקום', layer: 'שכבה', case: 'נימוק', ask: 'השאלה', myth: 'מיתוס', fact: 'עובדה', joke: 'בדיחה', truth: 'בלי צחוק',
};
const PLATFORM_DELETE = { deleted: 'נמחק דרך ה-API', deleted_by_hand: 'נמחק ידנית', by_hand: 'צריך למחוק ידנית', not_published: 'לא פורסם שם', failed: 'נכשל' };
const PLATFORM_HE = { tiktok: 'טיקטוק', instagram: 'אינסטגרם' };
const ROLE_HE = { owner: 'בעלים', editor: 'עורך', viewer: 'צופה' };
const AUDIT_HE = {
  login: 'כניסה', approve: 'אישור פוסט', unapprove: 'ביטול אישור', reject: 'דחיית פוסט', edit: 'עריכה', publish_now: 'פרסום ידני', published: 'פורסם', publish_failed: 'פרסום נכשל',
  auto_approved: 'אושר אוטומטית', mode: 'שינוי מצב', pause: 'השהיה', resume: 'חידוש', global_kill_on: 'כיבוי כללי', global_kill_off: 'הפעלה מחדש', global_budget: 'תקציב כללי',
  takedown: 'הודעת הסרה', takedown_deleted: 'נמחק ידנית אחרי הודעה', image_ok: 'תמונה נבדקה בעין', mix_changed: 'יחס בידור ומספרים זז',
  generate_at: 'שעת ייצור', source_approved: 'מקור אושר', source_removed: 'מקור הוסר', source_added: 'מקור נוסף', user_added: 'משתמש נוסף',
  publish_retry: 'פרסום יחזור על עצמו', fact_added: 'עובדה נוספה', fact_confirmed: 'עובדה נבדקה שוב', fact_removed: 'עובדה הוסרה', rival_added: 'מתחרה נוסף', rival_updated: 'מתחרה עודכן', rival_removed: 'מתחרה הוסר', format_dropped: 'פורמט נשר', format_promoted: 'פורמט הוכח', format_returned: 'פורמט חזר', onboarding: 'חשבון חדש', went_live: 'חשבון עלה לאוויר',
};

const media = (post, platform, i) => `/media/${encodeURIComponent(post.id)}/${platform}/${i}?v=${encodeURIComponent(String(post.updated_at || '').replace(/D/g, '').slice(-10))}`;
const formatName = (pack, id) => pack?.formats.formats.find((f) => f.id === id)?.name || id;

function strip(post, platform = 'tiktok') {
  const files = post.media?.[platform] || [];
  if (!files.length) return '';
  const items = post.slides.filter((s) => s.kind === 'item');
  return `<div class="strip${platform === 'instagram' ? ' ig' : ''}" data-strip>${files
    .map((_, i) => {
      const s = post.slides[i];
      const n = s?.kind === 'item' ? items.indexOf(s) + 1 : null;
      const target = n ? `#s-${post.id}-${n}` : '#';
      return `<a href="${target}" aria-label="שקף ${i + 1}${n ? `, העובדות שלו` : ''}"><img src="${media(post, platform, i)}" alt="${esc(s?.kind === 'cover' ? post.hook : s?.title || '')}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" width="270" height="${platform === 'tiktok' ? 480 : 338}"><span class="n">${i + 1}/${files.length}</span>${n && s.factKeys.length ? `<span class="has">${s.factKeys.length === 1 ? 'מקור אחד' : `${s.factKeys.length} מקורות`}</span>` : ''}</a>`;
    })
    .join('')}</div><div class="dots" aria-hidden="true">${files.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

function factsBlock(post, { open = false } = {}) {
  const items = post.slides.filter((s) => s.kind === 'item');
  const n = post.facts.filter((f) => items.some((s) => s.factKeys.includes(f.key))).length;
  return `<details class="facts"${open ? ' open' : ''}><summary>${icon('shield')}עובדות ומקורות <span class="chip">${n}</span><span class="chev">${icon('chev')}</span></summary>
<ol class="factlist">${items
    .map((s, i) => {
      const facts = s.factKeys.map((key) => post.facts.find((f) => f.key === key)).filter(Boolean);
      return `<li id="s-${post.id}-${i + 1}"><div class="slide-n">שקף ${i + 1}${ROLE_NAME[s.role] ? ` (${ROLE_NAME[s.role]})` : ''}: ${esc(s.title)}${s.data?.a || s.data?.b ? ` <span class="muted num">${esc(s.data.a)} · ${esc(s.data.b)}</span>` : ''}</div>${facts.length ? '' : '<div class="muted small">בלי עובדה משלו: דעה, מיתוס או בדיחה, וכל מספר בו מצוטט</div>'}${facts
        .map(
          (f) => `<details class="fact"><summary>${f.verified ? `<span class="ok">${icon('check')}</span>` : `<span class="no">${icon('x')}</span>`}<span>${esc(f.claim)}</span></summary>
<div class="src"><blockquote class="q" dir="auto">${esc(f.quote)}</blockquote>
<div class="where"><a href="${esc(f.doc_url)}" target="_blank" rel="noopener noreferrer">${esc(f.source_name)} ${icon('ext')}</a><span class="muted">נשמר ${esc(stamp(f.doc_fetched_at))}</span>${f.source_status === 'approved' ? '<span class="chip ok">מקור מאושר</span>' : `<span class="chip bad">מקור ${esc(f.source_status)}</span>`}</div>
${f.error ? `<div class="muted">${esc(f.error)}</div>` : ''}</div></details>`
        )
        .join('')}</li>`;
    })
    .join('')}</ol></details>`;
}

function captionBlock(post) {
  const tags = `<span class="tags">${esc((post.hashtags || []).join(' '))}</span>`;
  // TikTok's caption is a story, one beat a line (src/rules/caption.js).
  const tiktok = esc(post.caption).replace(/\n+/g, '<br>');
  if (!post.caption_ig) return `<p class="caption">${tiktok} ${tags}</p>`;
  return `<p class="caption"><span class="chip ghost">טיקטוק</span> ${tiktok} ${tags}</p><p class="caption"><span class="chip ghost">אינסטגרם</span> ${esc(post.caption_ig).replace(/\n/g, '<br>')}</p>`;
}

/** What the checks found, in one quiet line: the facts and their sources, the bot score, an AI image. */
function trustLine(post) {
  const items = post.slides.filter((s) => s.kind === 'item');
  const used = post.facts.filter((f) => items.some((s) => s.factKeys.includes(f.key)));
  const unverified = used.filter((f) => !f.verified).length;
  const bits = [];
  if (used.length) bits.push(unverified ? `<span class="badc">${icon('x')}${unverified} עובדות לא אומתו</span>` : `<span class="good">${icon('shield')}${used.length === 1 ? 'עובדה אחת, עם מקור' : `${used.length} עובדות, כל אחת עם מקור`}</span>`);
  if (post.review_score != null) bits.push(`<span class="${post.review_score >= 4 ? 'warnc' : ''}" title="ציון של בודק ${post.checks?.reviewer === 'claude' ? 'Claude' : 'אופליין'}: 0 אדם, 10 בוט">${icon('spark')}נשמע כמו בוט <span class="num ltr">${post.review_score}/10</span></span>`);
  if (post.ai_label) bits.push(`<span class="warnc">${icon('alert')}תמונת AI: תסומן</span>`);
  return bits.length ? `<div class="trust">${bits.join('')}</div>` : '';
}

/** The captions, folded: they go out with the post, so they are one tap away, not in the way of the decision. */
function captionDetails(post) {
  return `<details class="facts"><summary>${icon('text')}הכיתוב<span class="chev">${icon('chev')}</span></summary>${captionBlock(post)}</details>`;
}

/** One post as a card, decision first: when and what, the headline, the slides, what the checks found, the buttons. */
export function postCard(ctx, post, pack) {
  const when = post.slot_at ? timeHe(post.slot_at) : 'בלי שעה';
  const decide = post.status === 'queued';
  return `<article class="card acc acc-${esc(post.account_id)} post" id="post-${esc(post.id)}" data-post>
<div class="meta"><span class="when num">${esc(when)}</span><span class="fmt">${esc(formatName(pack, post.format_id))}</span><span class="end">${statusChip(post.status)}</span></div>
<h3 class="hook">${esc(post.hook)}</h3>
${post.sub ? `<p class="subline">${esc(post.sub)}</p>` : ''}
${strip(post)}
${trustLine(post)}
<div class="actions">
${decide ? postButton(ctx, `/post/${post.id}/approve`, `${icon('check')}אשר`, { cls: 'btn primary', ajax: 'remove' }) : ''}
<a class="btn" href="/post/${esc(post.id)}#edit">${icon('edit')}ערוך</a>
${decide ? `<button class="btn ghost" type="button" data-toggle="#reject-${esc(post.id)}" aria-expanded="false">${icon('x')}דחה</button>` : ''}
${post.status === 'approved' ? postButton(ctx, `/post/${post.id}/unapprove`, 'בטל אישור', { cls: 'btn ghost', ajax: 'reload' }) : ''}
</div>
${decide ? `<form class="rejectbox" id="reject-${esc(post.id)}" method="post" action="/post/${esc(post.id)}/reject" data-ajax="remove">${csrfField(ctx)}
<label class="f">למה לדחות?<select name="reason">${REJECT_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}<option value="">אחר</option></select></label>
<input type="text" name="note" placeholder="הערה (לא חובה), עוזרת לכתיבה הבאה" maxlength="300">
<button class="btn danger" type="submit">דחה את הפוסט</button></form>` : ''}
${captionDetails(post)}
${factsBlock(post)}
</article>`;
}

/* ------------------------------------------------------------ Today */

export function todayPage(ctx, d) {
  const all = d.groups.flatMap((g) => g.waiting);
  const sched = d.groups.flatMap((g) => g.scheduled);
  const pub = d.groups.flatMap((g) => g.published);
  const blocked = d.groups.flatMap((g) => g.blocked);
  const banners = [];
  if (ctx.globalKill) banners.push(`<div class="banner bad">${icon('power')}<div><b>מתג הכיבוי הכללי מופעל.</b><p>שום חשבון לא מייצר ולא מפרסם.</p></div>${postButton(ctx, '/settings/kill', 'הפעל מחדש', { cls: 'btn sm', fields: { on: '0' } })}</div>`);
  for (const g of d.groups) {
    if (g.acc?.status === 'paused') banners.push(`<div class="banner warn">${icon('alert')}<div><b>${esc(g.pack.meta.displayName)} מושהה: ${esc(PAUSE_REASONS[g.acc.paused_reason] || g.acc.paused_reason)}</b>${g.acc.paused_detail ? `<p>${esc(g.acc.paused_detail)}</p>` : ''}</div><a class="btn sm" href="/accounts#acc-${esc(g.pack.id)}">לחשבון</a></div>`);
    else if (g.reached) banners.push(`<div class="banner warn">${icon('alert')}<div><b>${esc(g.pack.meta.displayName)}: הנתח שלו מהתקציב נגמר.</b><p>לא נכתבים בו פוסטים חדשים עד שהתוכנית החודשית מפנה לו כסף, או עד החודש הבא.</p></div></div>`);
  }
  for (const t of d.attention?.waitingDeletes || []) {
    banners.push(`<div class="banner bad">${icon('alert')}<div><b>הודעת הסרה: צריך למחוק ידנית ב${t.waiting.map((w) => PLATFORM_HE[w.platform] || w.platform).join(' וב')}</b><p>${esc(t.hook || t.post_id)}</p></div><a class="btn sm" href="/post/${esc(t.post_id)}">לפוסט</a></div>`);
  }
  for (const im of d.attention?.images || []) {
    banners.push(`<div class="banner warn">${icon('alert')}<div><b>תמונה מחכה לעין של אדם לפני פרסום</b><p>${esc(im.hook || im.id)}${im.screen?.why ? ` · ${esc(im.screen.why)}` : ''}</p></div><a class="btn sm" href="/post/${esc(im.id)}">לבדיקה</a></div>`);
  }
  // The day in the mark's own language: one dot per post, its shape its state (see .pulse in the stylesheet).
  const dotsOf = (g) => {
    const dots = [...g.waiting.map(() => 'w'), ...g.scheduled.map(() => 's'), ...g.published.map(() => 'p'), ...g.blocked.map(() => 'b')];
    return dots.length ? `<span class="pulse" aria-hidden="true">${dots.map((c) => `<i class="${c}"></i>`).join('')}</span>` : '<span class="none">אין פוסטים היום</span>';
  };
  const said = (g) => [g.waiting.length && `${g.waiting.length} מחכים`, g.scheduled.length && `${g.scheduled.length} מתוזמנים`, g.published.length && `${g.published.length} פורסמו`, g.blocked.length && `${g.blocked.length} נחסמו`].filter(Boolean).join(', ') || 'אין פוסטים היום';
  const day = `<section class="day" aria-label="היום במבט אחד">
<div class="lead">${all.length > 1 ? `<span class="num">${all.length}</span> פוסטים מחכים לך` : all.length ? 'פוסט אחד מחכה לך' : 'אין מה לאשר כרגע'}</div>
<p class="rest">${sched.length} מתוזמנים · ${pub.length} פורסמו היום · ${blocked.length} נחסמו בבדיקות</p>
<div class="lines">${d.groups.map((g) => `<a href="#g-${esc(g.pack.id)}">${accDot(g.pack.id)}<span class="nm">${esc(g.pack.meta.displayName)}</span><span class="end">${dotsOf(g)}<span class="sr">${esc(said(g))}</span></span></a>`).join('')}</div>
<div class="legend" aria-hidden="true"><span><span class="pulse"><i class="w"></i></span>מחכה לך</span><span><span class="pulse"><i class="s"></i></span>מתוזמן</span><span><span class="pulse"><i class="p"></i></span>פורסם</span><span><span class="pulse"><i class="b"></i></span>נחסם</span></div>
</section>`;
  const body = `<div class="head"><h1>היום</h1><span class="sub">${esc(dayHe(Date.now()))}</span></div>
${banners.join('')}
${day}
${d.groups
  .map((g) => {
    const mode = MODE_HE[g.acc?.mode || 'approve'];
    const posts = [...g.waiting, ...g.scheduled];
    return `<section class="group" id="g-${esc(g.pack.id)}" aria-labelledby="gh-${esc(g.pack.id)}"><header>${accDot(g.pack.id)}<h2 id="gh-${esc(g.pack.id)}">${esc(g.pack.meta.displayName)}</h2><span class="handle ltr">@${esc(g.pack.meta.handle)}</span><span class="end">${g.waiting.length ? `<span class="chip sig">${g.waiting.length} מחכים</span>` : ''}${g.plan?.cut ? `<span class="chip warn" title="התקציב קצר החודש">${g.plan.perDay} ביום</span>` : ''}<span class="chip ghost" title="${esc(mode[1])}">${esc(mode[0])}</span></span></header>
${posts.length ? `<div class="posts">${posts.map((p) => postCard(ctx, p, g.pack)).join('')}</div>` : `<div class="empty">${icon('inbox')}<b>אין כאן מה לאשר</b>${g.acc?.status === 'paused' ? 'החשבון מושהה.' : 'הפוסטים הבאים ייכתבו בשעת הייצור היומית.'}</div>`}
${g.blocked.length ? `<details class="facts"><summary>${icon('shield')}נחסמו היום בבדיקות <span class="chip bad">${g.blocked.length}</span><span class="chev">${icon('chev')}</span></summary><ul class="factlist">${g.blocked.map((b) => `<li><a href="/post/${esc(b.id)}"><b>${esc(b.hook || b.topic || 'בלי כותרת')}</b></a><div class="muted small">${esc(b.reason)}</div></li>`).join('')}</ul></details>` : ''}
${g.published.length ? `<details class="facts"><summary>${icon('check')}פורסמו היום <span class="chip ok">${g.published.length}</span><span class="chev">${icon('chev')}</span></summary><ul class="factlist">${g.published.map((b) => `<li><a href="/post/${esc(b.id)}">${esc(b.hook)}</a> <span class="muted small num">${esc(timeHe(b.published_at))}</span></li>`).join('')}</ul></details>` : ''}
</section>`;
  })
  .join('')}
${d.summary ? `<section class="panel"><header><h2>סיכום ${esc(shortDate(`${d.summary.day}T12:00:00Z`))}</h2></header><p class="lede">${esc(d.summary.text).replace(/\n/g, '<br>')}</p></section>` : ''}`;
  return layout({ ...ctx, title: 'היום', active: 'today' }, body);
}

/* ------------------------------------------------------------ one post */

export function postPage(ctx, d, { problems = [], values = null } = {}) {
  const { post, pack } = d;
  const v = values || post;
  const items = post.slides.filter((s) => s.kind === 'item');
  const trace = d.steps
    .map((s) => {
      const det = s.detail || {};
      const bits = [];
      if (det.topic) bits.push(det.topic);
      if (det.verified != null) bits.push(`${det.verified} עובדות אומתו`);
      if (det.refused?.length) bits.push(`${det.refused.length} נפסלו`);
      if (det.reviewer) bits.push(`בודק: ${det.reviewer === 'claude' ? 'Claude' : 'אופליין'}, הכי גרוע ${det.worst}/10`);
      if (det.problems?.length) bits.push(det.problems.slice(0, 3).join(' · '));
      if (det.reason) bits.push(det.reason);
      if (det.why) bits.push(det.why);
      if (det.via) bits.push(det.via === 'dry' ? 'פרסום יבש: נכתב לדיסק' : `דרך ${det.via}`);
      if (det.provider) bits.push(`${det.provider}, ${det.license}`);
      return `<li class="${esc(s.status)}"><b>${esc(STEP_HE[s.step] || s.step)}</b> <span class="muted small num">${esc(stamp(s.at))}${s.cost_usd ? ` · $${s.cost_usd.toFixed(4)}` : ''}</span>${bits.length ? `<div class="d">${esc(bits.join(' · '))}</div>` : ''}</li>`;
    })
    .join('');
  const scores = post.checks?.scores || [];
  const edit = `<details class="panel edit" id="edit"${problems.length || values ? ' open' : ''}><summary><h2 class="inline">עריכת הטקסט</h2></summary>
${problems.length ? `<div class="problems"><b>השינוי לא נשמר, הבדיקות עצרו אותו:</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
<p class="muted small">כל עריכה עוברת שוב את בדיקות הקול, הכללים ושער העובדות, ואז השקפים מרונדרים מחדש. מספר שלא נמצא בציטוט לא יעבור.</p>
<form method="post" action="/post/${esc(post.id)}/edit" class="formgrid">${csrfField(ctx)}
<fieldset><legend>שער</legend><label class="f">כותרת<input type="text" name="hook" value="${esc(v.hook)}" maxlength="90"></label><label class="f">שורה שנייה<input type="text" name="sub" value="${esc(v.sub || '')}" maxlength="120"></label></fieldset>
${items
  .map((s, i) => {
    const val = values ? { title: values[`title_${i}`], body: values[`body_${i}`] } : s;
    return `<fieldset><legend>שקף ${i + 1}</legend><label class="f">כותרת<input type="text" name="title_${i}" value="${esc(val.title)}" maxlength="80"></label><label class="f">טקסט<textarea name="body_${i}" maxlength="300">${esc(val.body)}</textarea></label></fieldset>`;
  })
  .join('')}
<label class="f">${post.caption_ig ? 'כיתוב לטיקטוק' : 'כיתוב'}<textarea name="caption" maxlength="${post.caption_ig ? 900 : 400}">${esc(v.caption)}</textarea></label>
${post.caption_ig ? `<label class="f">כיתוב קצר לאינסטגרם (הכותרת נכנסת לפניו)<textarea name="caption_short" maxlength="260">${esc(values ? values.caption_short : post.data?.captionShort || '')}</textarea></label>` : ''}
<div><button class="btn primary" type="submit">${icon('check')}שמור ורנדר מחדש</button></div></form></details>`;
  const screen = d.image ? (() => {
    try {
      return JSON.parse(d.image.safety_json || 'null');
    } catch {
      return null;
    }
  })() : null;
  const imageHold = d.image && d.image.safety && d.image.safety !== 'ok' && !d.image.reviewed_at;
  const tds = d.takedowns || [];
  const takedownPanel = ['published', 'taken_down', 'publishing'].includes(post.status) || tds.length
    ? `<section class="panel"><header><h2>הודעות הסרה</h2></header>
${tds.map((t) => `<div class="banner bad">${icon('alert')}<div><b>${esc(stamp(t.received_at))}${t.claimant ? ` · ${esc(t.claimant)}` : ''}</b><p dir="auto">${esc(t.notice.slice(0, 300))}</p><ul class="factlist">${Object.entries(t.deleted).map(([pl, x]) => `<li>${esc(PLATFORM_HE[pl] || pl)}: <b>${esc(PLATFORM_DELETE[x.state] || x.state)}</b>${x.why ? `<div class="muted small">${esc(x.why)}</div>` : ''}${x.state === 'by_hand' ? postButton(ctx, `/takedowns/${t.id}/deleted`, 'מחקתי ידנית', { cls: 'btn sm', fields: { platform: pl } }) : ''}</li>`).join('')}</ul></div></div>`).join('')}
${post.status !== 'taken_down' ? `<details><summary class="muted">${icon('alert')}התקבלה הודעת הסרה על הפוסט הזה</summary><form method="post" action="/post/${esc(post.id)}/takedown" class="formgrid">${csrfField(ctx)}
<p class="muted small">הפוסט יורד מיד: באינסטגרם נמחק דרך ה-API כשאפשר, בטיקטוק צריך למחוק ידנית (אין לזה API). הודעה שנייה תוך 90 יום משהה את החשבון.</p>
<label class="f">פלטפורמה<select name="platform"><option value="">שתיהן</option><option value="tiktok">טיקטוק</option><option value="instagram">אינסטגרם</option></select></label>
<label class="f">ממי<input type="text" name="claimant" maxlength="200"></label>
<label class="f">נוסח ההודעה<textarea name="notice" maxlength="4000" required></textarea></label>
<div><button class="btn danger" type="submit">רשום והורד את הפוסט</button></div></form></details>` : ''}</section>`
    : '';

  const body = `<div class="head"><div><a class="muted small back" href="/">${icon('chev')}חזרה להיום</a><h1 class="title">${esc(post.hook || post.topic || 'פוסט')}</h1></div><span class="sub">${statusChip(post.status)}</span></div>
${post.reason ? `<div class="banner ${post.status === 'blocked' || post.status === 'failed' ? 'bad' : 'info'}">${icon('alert')}<div><b>${esc(post.reason)}</b></div></div>` : ''}
<div class="cols">
<div>
<section class="card acc acc-${esc(post.account_id)} post"><div class="meta"><span class="chip">${accDot(post.account_id)} ${esc(pack?.meta.displayName || post.account_id)}</span><span class="chip">${esc(formatName(pack, post.format_id))}</span>${post.slot_at ? `<span class="chip">${icon('clock')}${esc(stamp(post.slot_at))}</span>` : ''}</div>
${post.sub ? `<p class="subline">${esc(post.sub)}</p>` : ''}
<h3 class="lbl">טיקטוק <span>9:16</span></h3>${strip(post, 'tiktok')}
${post.media?.instagram ? `<h3 class="lbl">אינסטגרם <span>4:5</span></h3>${strip(post, 'instagram')}` : ''}
${trustLine(post)}
<div class="capwrap">${captionBlock(post)}</div>
</section>
${post.status === 'queued' ? `<div class="actionbar">${postButton(ctx, `/post/${post.id}/approve`, `${icon('check')}אשר`, { cls: 'btn primary' })}<a class="btn" href="#edit">${icon('edit')}ערוך</a>${postButton(ctx, `/post/${post.id}/reject`, `${icon('x')}דחה`, { cls: 'btn ghost', fields: { reason: 'נדחה מדף הפוסט' } })}</div>` : ''}
${post.status === 'approved' ? `<div class="actionbar">${postButton(ctx, `/post/${post.id}/publish-now`, 'פרסם עכשיו', { cls: 'btn primary', confirm: 'בטוח? לפרסם עכשיו' })}${postButton(ctx, `/post/${post.id}/unapprove`, 'בטל אישור', { cls: 'btn ghost' })}</div>` : ''}
${['queued', 'approved', 'sample'].includes(post.status) ? edit : ''}
</div>
<div>
<section class="panel">${factsBlock(post, { open: true })}</section>
<section class="panel"><header><h2>בדיקות</h2></header>
<dl class="kv"><dt>שער העובדות</dt><dd>${post.checks?.token ? '<span class="chip ok">עבר</span>' : '<span class="chip">לא הגיע</span>'}</dd>
<dt>בודק הקול</dt><dd>${post.checks?.reviewer === 'claude' ? 'Claude' : 'אופליין (בלי מפתח API)'}</dd>
${scores.length ? `<dt>ציון הכי גבוה</dt><dd><span class="num ltr">${Math.max(...scores)}/10</span></dd>` : ''}
${(post.checks?.rewrites || []).length ? `<dt>שכתובים</dt><dd>${post.checks.rewrites.length}</dd>` : ''}
<dt>עלות</dt><dd>${usd(post.cost_usd, 4)}${post.cost_estimated ? ' <span class="muted small">הערכה, בלי מפתח API</span>' : ''}</dd>
${post.kind && post.kind !== 'list' ? `<dt>סוג</dt><dd>${esc(KIND_HE[post.kind] || post.kind)} · ${post.grp === 'entertaining' ? 'בידור' : 'מספרים'}</dd>` : ''}
${post.hook_pattern ? `<dt>תבנית השער</dt><dd><span class="ltr">${esc(post.hook_pattern)}</span></dd>` : ''}
${post.data?.cta?.text ? `<dt>קריאה לפעולה</dt><dd>${esc(post.data.cta.text)}</dd>` : ''}
${post.data?.keywords?.length ? `<dt>מילות חיפוש</dt><dd>${post.data.keywords.map((x) => `<bdi>${esc(x)}</bdi>`).join(' · ')}</dd>` : ''}
${d.image ? `<dt>תמונה</dt><dd>${esc(d.image.provider)} · ${esc(d.image.license)}${d.image.author ? ` · ${esc(d.image.author)}` : ''}${d.image.source_url ? ` · <a href="${esc(d.image.source_url)}" target="_blank" rel="noopener noreferrer">מקור ${icon('ext')}</a>` : ''}${d.image.ai_generated ? ' · <span class="chip warn">AI</span>' : ''}</dd>
<dt>בדיקת התמונה</dt><dd>${d.image.safety === 'ok' || d.image.reviewed_at ? `<span class="chip ok">${d.image.reviewed_at ? `נבדקה על ידי ${esc(d.image.reviewed_by)}` : 'עברה'}</span>` : d.image.safety ? `<span class="chip warn">מחכה לעין של אדם</span>` : '<span class="chip ghost">לא נבדקה</span>'}${screen?.why ? `<div class="muted small" dir="auto">${esc(screen.why)}</div>` : ''}${imageHold ? postButton(ctx, `/post/${post.id}/image-ok`, 'הסתכלתי: אין דם, פציעה או סימן מים', { cls: 'btn sm' }) : ''}</dd>` : ''}
${d.metrics.length ? d.metrics.slice(0, 2).map((m) => `<dt>${esc(PLATFORM_HE[m.platform] || m.platform)}</dt><dd class="num">${k(m.views)} צפיות · ${k(m.likes)} לייקים · ${k(m.shares)} שיתופים${m.saves != null ? ` · ${k(m.saves)} שמירות` : ''}</dd>`).join('') : ''}
</dl></section>
${takedownPanel}
<section class="panel"><header><h2>איך הפוסט נוצר</h2></header><ol class="trace">${trace}</ol></section>
</div></div>`;
  return layout({ ...ctx, title: post.hook || 'פוסט', active: 'today' }, body);
}

/* ------------------------------------------------------------ accounts */

export function accountsPage(ctx, rows) {
  const body = `<div class="head"><h1>חשבונות</h1><span class="sub">${rows.length === 1 ? 'חשבון אחד' : `${rows.length} חשבונות`}</span><span class="end"><a class="btn sm" href="/new">${icon('plus')}חשבון חדש</a></span></div>
<div class="accounts">${rows
    .map(({ pack, acc, spend, cap, plan, publishers, week }) => {
      const paused = acc.status === 'paused';
      const max = Math.max(1, ...week.days.map((x) => x.n));
      const h = (n) => (n === 0 ? 'h0' : `h${Math.max(1, Math.min(4, Math.ceil((n / max) * 4)))}`);
      return `<article class="card acc acc-${esc(pack.id)} acct" id="acc-${esc(pack.id)}">
<div class="title">${accDot(pack.id)}<div><h2>${esc(pack.meta.displayName)}</h2><span class="muted small ltr">@${esc(pack.meta.handle)}</span></div><span class="end">${paused ? '<span class="chip warn">מושהה</span>' : '<span class="chip ok">פעיל</span>'}</span></div>
${paused ? `<div class="paused${acc.paused_reason === 'kill' ? ' kill' : ''}">${icon(acc.paused_reason === 'kill' ? 'power' : 'alert')}<div><b>${esc(PAUSE_REASONS[acc.paused_reason] || acc.paused_reason)}</b>${acc.paused_detail ? `<div class="small">${esc(acc.paused_detail)}</div>` : ''}</div>${postButton(ctx, `/accounts/${pack.id}/resume`, 'הפעל מחדש', { cls: 'btn sm' })}</div>` : ''}
<form method="post" action="/accounts/${esc(pack.id)}/mode" data-autosubmit>${csrfField(ctx)}<div class="seg" role="radiogroup" aria-label="מצב אוטונומיה">${['approve', 'digest', 'auto']
        .map((m) => `<input type="radio" name="mode" value="${m}" id="m-${esc(pack.id)}-${m}"${acc.mode === m ? ' checked' : ''}><label for="m-${esc(pack.id)}-${m}">${MODE_HE[m][0]}<small>${MODE_HE[m][1]}</small></label>`)
        .join('')}</div><noscript><button class="btn sm" type="submit">שמור</button></noscript></form>
<div><div class="row"><span>הנתח מהתקציב</span><b class="ltr">$${spend.toFixed(2)} / $${cap.toFixed(2)}</b></div><meter min="0" max="${cap || 1}" low="${(cap || 1) * 0.7}" high="${(cap || 1) * 0.9}" optimum="0" value="${Math.min(spend, cap || 1)}"></meter>${plan?.cut ? `<p class="small m4"><span class="chip warn">פוסט ${plan.perDay === 1 ? 'אחד' : plan.perDay} ביום במקום ${plan.planned}</span> התקציב קצר החודש, וזה החשבון שמצמצם ראשון.</p>` : ''}</div>
<div><div class="row"><span>7 הימים האחרונים</span><b>${week.days.reduce((s, x) => s + x.n, 0)} פורסמו${week.views != null ? ` · ${k(week.views)} צפיות` : ''}</b></div>
<div class="week" aria-label="פוסטים שפורסמו בכל יום">${week.days.map((x) => `<span title="${esc(shortDate(x.at))}: ${x.n}"><i class="${h(x.n)}"></i>${esc(weekdayNarrow(x.at))}</span>`).join('')}</div></div>
<dl class="kv"><dt>בתור</dt><dd>${week.counts.queued || 0} ממתינים · ${week.counts.approved || 0} מאושרים</dd><dt>נחסמו השבוע</dt><dd>${week.counts.blocked || 0}</dd><dt>פרסום</dt><dd>${publishers.map((x) => `${PLATFORM_HE[x.platform] || x.platform}: ${publisherHe(x)}`).join(' · ')}</dd></dl>
<div class="actions p0">${!paused ? postButton(ctx, `/accounts/${pack.id}/kill`, `${icon('power')}כבה את החשבון`, { cls: 'btn danger', confirm: 'בטוח? לחצו שוב לכיבוי' }) : ''}<a class="btn" href="/sources?account=${esc(pack.id)}">מקורות</a><a class="btn" href="/rivals?account=${esc(pack.id)}">מתחרים</a></div>
</article>`;
    })
    .join('')}</div>`;
  return layout({ ...ctx, title: 'חשבונות', active: 'accounts' }, body);
}

/* ------------------------------------------------------------ results */

const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`);
const DIRECTIVE_HE = { open: ['מחכה למשבצת', 'warn'], used: ['נכתב', 'ok'], expired: ['הוחלף בדוח חדש', 'ghost'] };

/** The morning's feedback, one panel per account: the posts of the last three days in their boxes, and what each box asked for. */
export function feedbackPanels(list) {
  return list
    .map(({ pack, day, text, report, directives }) => {
      const head = `<header>${accDot(pack.id)}<h2>${esc(pack.meta.displayName)}: המשוב של הבוקר</h2>${day ? `<span class="end muted small">${esc(dayHe(day))}</span>` : ''}</header>`;
      if (!report) return `<section class="panel">${head}<p class="muted">עוד אין דוח. כל בוקר, לפני שנכתבים הפוסטים, המנוע קורא מחדש את המספרים של הפוסטים משלושת הימים האחרונים, ושם כל אחד מהם באחת מארבע קופסאות.</p></section>`;
      const posts = report.posts || [];
      const measures = [...new Set(posts.flatMap((p) => Object.values(p.platforms || {}).map((x) => x.measure)))];
      const row = (p) => {
        const x = p.platforms?.[p.primary] || {};
        return `<li><a href="/post/${esc(p.post)}">${esc(p.hook || p.post)}</a><div class="muted small num">${esc(PLATFORM_HE[p.primary] || p.primary || '')}: ${k(x.views)} צפיות מול חציון ${k(Math.round(x.medianViews || 0))} · ${pct(x.rate)} מול ${pct(x.medianRate)}</div></li>`;
      };
      const cells = PRIORITY.map((b) => {
        const ins = posts.filter((p) => p.box === b);
        return `<div class="cell ${b}"><b>${esc(BOXES[b].he)}</b><span class="todo">${esc(BOXES[b].todo)}</span>${ins.length ? `<ul>${ins.map(row).join('')}</ul>` : '<p class="muted small">אין</p>'}</div>`;
      }).join('');
      const waiting = posts.filter((p) => !p.box);
      if (!posts.some((p) => p.box)) return `<section class="panel">${head}<p class="muted">${esc(text)}.${waiting.length ? ` ${waiting.map((p) => esc(p.hook || p.post)).join(' · ')}` : ''}</p></section>`;
      // One line per post and answer: the three variations of a winner are one line, with what became of each.
      const groups = new Map();
      for (const d of directives) {
        const key = `${d.post_id}:${d.action}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }
      const plans = groups.size
        ? `<h3>מה זה משנה בפוסטים הבאים</h3><ul class="factlist">${[...groups.values()]
            .map((ds) => {
              const d = ds[0];
              const states = Object.entries(DIRECTIVE_HE).filter(([st]) => ds.some((x) => x.status === st)).map(([st, [label, tone]]) => `<span class="chip ${tone}">${esc(label)}${ds.length > 1 ? ` ${ds.filter((x) => x.status === st).length}` : ''}</span>`).join(' ');
              const made = ds.filter((x) => x.used_post_id).map((x) => `<a href="/post/${esc(x.used_post_id)}">${esc(x.used_hook || 'הפוסט')}</a>`).join(' · ');
              return `<li>${states} ${esc(BOXES[d.box]?.todo || d.action)}${d.plan?.steer?.hook ? ` <span class="muted small">(בעקבות "${esc(d.plan.steer.hook)}")</span>` : ''}${made ? `<div class="small">${made}</div>` : ''}</li>`;
            })
            .join('')}</ul>`
        : '';
      return `<section class="panel">${head}<p class="muted small">${esc(text)}. צפיות מול החציון של החשבון עצמו, באותו גיל של הפוסט; פעולה: ${measures.map((m) => esc(MEASURES[m] || m)).join(', ') || 'אין עוד מספרים'}. הודעות פרטיות לא נקראות אף פעם.</p>
<div class="matrix">${cells}</div>
${waiting.length ? `<p class="muted small">עוד לא בקופסה (אין מספיק פוסטים קודמים להשוואה, או שהפלטפורמה עוד לא מסרה מספרים): ${waiting.map((p) => esc(p.hook || p.post)).join(' · ')}</p>` : ''}
${plans}</section>`;
    })
    .join('');
}

const bars = (last) =>
  `<span class="rel" aria-label="שלוש התוצאות האחרונות ביחס לחציון">${last.map((r) => `<i class="${r.rel >= 1 ? 'win' : r.rel < 0.7 ? 'lose' : ''} h${Math.max(1, Math.min(4, Math.round(r.rel * 2)))}" title="${r.rel.toFixed(2)}"></i>`).join('')}</span>`;

export function resultsPage(ctx, d) {
  const postRow = (p) => {
    const t = p.metrics.tiktok;
    const ig = p.metrics.instagram;
    return `<tr><td class="title" data-k="">${accDot(p.account_id)} <a href="/post/${esc(p.id)}">${esc(p.hook)}</a></td><td class="n" data-k="פורסם">${esc(shortDate(p.published_at))}</td><td class="n" data-k="טיקטוק">${t ? `${k(t.views)} · ${((t.score || 0) * 100).toFixed(1)}%` : '–'}</td><td class="n" data-k="אינסטגרם">${ig ? `${k(ig.views)} · ${((ig.score || 0) * 100).toFixed(1)}%` : '–'}</td><td class="n" data-k="מול החציון">${p.rel != null ? `${p.rel.toFixed(2)}×` : '–'}</td></tr>`;
  };
  const table = (rows) => `<table class="table stack"><thead><tr><th>פוסט</th><th>פורסם</th><th>טיקטוק</th><th>אינסטגרם</th><th>מול החציון</th></tr></thead><tbody>${rows.map(postRow).join('')}</tbody></table>`;
  const dropped = d.formats.flatMap((f) => f.rows.filter((r) => r.status === 'dropped' || r.atRisk).map((r) => ({ ...r, pack: f.pack })));
  const body = `<div class="head"><h1>תוצאות</h1><span class="sub">30 הימים האחרונים</span></div>
${d.demo ? `<div class="banner info">${icon('alert')}<div><b>נתוני הדגמה בדויים.</b><p>המספרים בדף הזה נזרעו לחשבון הדמו כדי להראות איך הדף נראה. מספרים אמיתיים מגיעים רק מ-Zernio, 72 שעות אחרי פרסום.</p></div></div>` : ''}
<p class="lede">כל פוסט נמדד 72 שעות אחרי שעלה, מול החציון של אותה פלטפורמה: בטיקטוק שיתופים ולייקים לצפייה (טיקטוק לא מדווחת שמירות), באינסטגרם שמירות לחשיפה (reach). 70% מהפוסטים בפורמטים מוכחים, 30% בניסיונות, ופורמט נושר אחרי 3 תוצאות ברצף מתחת ל-70% מהחציון.</p>
${blocksPanel(d.blocks)}
${feedbackPanels(d.feedback || [])}
${(d.learning || []).filter((l) => l.share != null).map((l) => `<section class="panel"><header>${accDot(l.pack.id)}<h2>${esc(l.pack.meta.displayName)}: בידור מול מספרים</h2></header>
<p>עכשיו <b class="num">${Math.round(l.share * 100)}%</b> מהפוסטים בפורמטים של בידור (סיפור, נחשו מי, קרחון...) ו-<b class="num">${Math.round((1 - l.share) * 100)}%</b> בפורמטים של מספרים (ראש בראש, דירוג).${l.recent ? ` מתוך ${l.recent} הפוסטים האחרונים, ${l.recentEnt} היו בידור.` : ''}</p>
<p class="muted small">${l.learned?.why ? `השינוי האחרון (${esc(shortDate(l.learned.at))}): ${esc(l.learned.why)}.` : `עוד לא זז: היחס זז ב-5 נקודות בכל פעם, לכל היותר פעם בשבוע, בין ${Math.round(MIX.min * 100)}% ל-${Math.round(MIX.max * 100)}% בידור, לכיוון הקבוצה שהפוסטים שלה עושים יותר טוב, ורק כשיש לפחות 3 תוצאות בכל קבוצה.`}</p>
${l.hooks.some((h) => h.used) ? `<table class="table stack"><thead><tr><th>תבנית שער</th><th>פורמט</th><th>שימושים</th><th>ממוצע מול החציון</th></tr></thead><tbody>${l.hooks
  .filter((h) => h.used)
  .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
  .map((h) => `<tr><td data-k="">${esc(h.pattern)}</td><td data-k="פורמט">${esc(h.format)}</td><td class="n" data-k="שימושים">${h.used}</td><td class="n" data-k="ממוצע">${h.avg != null ? `${h.avg.toFixed(2)}× (${h.n})` : 'אין עוד מספרים'}</td></tr>`)
  .join('')}</tbody></table>` : '<p class="muted small">אין עדיין פוסטים לפי תבניות השער: כל תבנית מקבלת קודם שני תורות, ואז נבחרת לפי התוצאות.</p>'}</section>`).join('')}
${d.scored.length ? `<div class="cols even"><section class="panel"><header><h2>מנצחים</h2></header>${table(d.winners)}</section><section class="panel"><header><h2>מפסידים</h2></header>${table(d.losers)}</section></div>` : `<div class="empty">${icon('results')}<b>אין עדיין מספרים</b>המספרים נקראים מ-Zernio רק מפוסטים שפורסמו בפועל, והציון נקבע 72 שעות אחרי הפרסום.</div>`}
<section class="panel mt16"><header><h2>מה נושר ולמה</h2></header>${dropped.length ? `<ul class="factlist">${dropped.map((r) => `<li>${accDot(r.pack.id)} <b>${esc(r.name)}</b> ${r.status === 'dropped' ? '<span class="chip bad">נשר</span>' : '<span class="chip warn">בסכנה</span>'}<div class="muted small">${esc(r.dropped_why || 'שתי התוצאות האחרונות מתחת ל-70% מהחציון: עוד אחת והוא נושר')}</div></li>`).join('')}</ul>` : '<p class="muted">אף פורמט לא נשר ואף אחד לא בסכנה.</p>'}</section>
${d.formats
  .map(
    (f) => `<section class="panel"><header>${accDot(f.pack.id)}<h2>${esc(f.pack.meta.displayName)}: פורמטים</h2></header>
<table class="table stack"><thead><tr><th>פורמט</th><th>סוג</th><th>מצב</th><th>תוצאות</th><th>ממוצע מול החציון</th><th>שלוש אחרונות</th></tr></thead><tbody>${f.rows
      .map((r) => `<tr><td data-k="">${esc(r.name)}</td><td data-k="סוג">${r.kind === 'proven' ? 'מוכח' : 'ניסיון'}</td><td data-k="מצב">${r.status === 'dropped' ? '<span class="chip bad">נשר</span>' : r.atRisk ? '<span class="chip warn">בסכנה</span>' : '<span class="chip ok">פעיל</span>'}</td><td class="n" data-k="תוצאות">${r.n}</td><td class="n" data-k="ממוצע">${r.avg != null ? `${r.avg.toFixed(2)}×` : '–'}</td><td data-k="אחרונות">${r.last.length ? bars(r.last) : '–'}</td></tr>`)
      .join('')}</tbody></table></section>`
  )
  .join('')}`;
  const trendsPanel = `<section class="panel"><header><h2>פורמטים שעובדים עכשיו</h2><span class="end muted small">שורטס ביוטיוב, עם המספרים של יוטיוב עצמו</span></header>${d.trends.length ? `<ul class="factlist">${d.trends.map((x) => `<li>${accDot(x.account_id)} ${x.status === 'kept' ? '<span class="chip ok">נכנס לניסיון</span>' : '<span class="chip ghost">נדחה</span>'} <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${k(x.views)} צפיות ${icon('ext')}</a>${x.card?.hookShape ? ` <b>${esc(x.card.hookShape)}</b>` : ''}<div class="muted small">${esc(x.why || x.card?.why || '')}</div></li>`).join('')}</ul>` : '<p class="muted">עוד לא נבדק. עם YOUTUBE_API_KEY המנוע מחפש פעם בשבוע שורטס שעובדים בנישה של כל חשבון, לומד מהם את הפורמט בלבד, ומכניס אותו לניסיון.</p>'}</section>`;
  return layout({ ...ctx, title: 'תוצאות', active: 'results' }, body + trendsPanel);
}

/* ------------------------------------------------------------ sources */

const SOURCE_STATUS = { approved: ['מאושר', 'ok'], pending: ['ממתין לאישור', 'warn'], removed: ['הוסר', 'ghost'] };
const TYPE_HE = { rss: 'פיד', web: 'דף', api: 'API' };

export function sourcesPage(ctx, { packs, current, sources, form = {}, problems = [] }) {
  const tabs = `<nav class="tabs" aria-label="חשבונות">${packs.map((p) => `<a href="/sources?account=${esc(p.id)}"${p.id === current.id ? ' aria-current="true"' : ''}>${accDot(p.id)}${esc(p.meta.displayName)}</a>`).join('')}</nav>`;
  const list = sources
    .map((s) => {
      const [he, cls] = SOURCE_STATUS[s.status] || [s.status, ''];
      return `<article class="card acc acc-${esc(current.id)} srccard"><div class="meta p0"><span class="chip ${cls}">${esc(he)}</span><span class="chip ghost">${esc(TYPE_HE[s.type] || s.type)}</span>${s.score ? `<span class="chip sig" title="${esc(s.score.reason || '')}">סמכות ${esc(s.score.authority)}/10</span>` : ''}<span class="end muted small">${s.docs} מסמכים</span></div>
<h3 class="srcname" dir="auto">${esc(s.name)}</h3><a class="small ltr" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a>
<p class="muted small m6" dir="auto">${esc(s.why || '')}</p>
<p class="muted small m4">${s.approved_at ? `אושר ${esc(shortDate(s.approved_at))}` : ''}${s.last_ok_at ? ` · נקרא ${esc(stamp(s.last_ok_at))}` : ''}${s.last_error ? ` · <span class="chip bad">${esc(s.last_error.slice(0, 80))}</span>` : ''}</p>
<div class="actions pt10 p0x">${s.status !== 'approved' ? postButton(ctx, `/sources/${s.id}/approve`, 'אשר', { cls: 'btn sm primary' }) : ''}${s.status !== 'removed' ? postButton(ctx, `/sources/${s.id}/remove`, 'הסר', { cls: 'btn sm danger', confirm: 'להסיר את המקור?' }) : ''}</div></article>`;
    })
    .join('');
  const body = `<div class="head"><h1>מקורות</h1><span class="sub">רק מקור מאושר יכול לתמוך בעובדה</span><span class="end"><a class="btn sm" href="/facts?account=${esc(current.id)}">${icon('shield')}עובדות שנבדקו ביד</a></span></div>
${tabs}
<p class="lede">עובדה בשקף חייבת ציטוט ממסמך של מקור מאושר של החשבון. מקור שמוסר כאן מפסיק לתמוך בכל פוסט שעוד לא פורסם, והפוסט ייחסם בבדיקה שלפני הפרסום.</p>
<div class="cols"><div class="grid12">${list || `<div class="empty"><b>אין מקורות</b></div>`}</div>
<section class="panel"><header><h2>הוספת מקור</h2></header>
${problems.length ? `<div class="problems"><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="/sources/add" class="formgrid">${csrfField(ctx)}<input type="hidden" name="account" value="${esc(current.id)}">
<label class="f">שם<input type="text" name="name" required value="${esc(form.name || '')}"></label>
<label class="f">כתובת <small>https בלבד</small><input type="url" name="url" required dir="ltr" value="${esc(form.url || '')}"></label>
<label class="f">סוג<select name="type"><option value="rss">פיד (RSS/Atom)</option><option value="web">דף</option><option value="api">API (JSON)</option></select></label>
<label class="f">למה סומכים עליו? <small>יופיע ליד כל עובדה ממנו</small><textarea name="why" required minlength="10">${esc(form.why || '')}</textarea></label>
<button class="btn primary" type="submit">${icon('plus')}הוסף כמקור מאושר</button></form></section></div>`;
  return layout({ ...ctx, title: 'מקורות', active: 'sources' }, body);
}

/* ------------------------------------------------------------ settings */

const VIA_HE = { zernio: 'Zernio', instagram: 'ישירות דרך Meta', dry: 'יבש (לדיסק)' };
/** One platform's publisher, and why it is dry when the pack asked for more. */
function publisherHe({ wants, via }) {
  if (via === wants || wants === 'dry') return VIA_HE[via] || via;
  const why = process.env.PUBLISH_MODE !== 'live' ? 'PUBLISH_MODE לא live' : wants === 'zernio' ? 'חסר ZERNIO_API_KEY' : 'חסר אסימון או instagram.userId';
  return `${VIA_HE[via]} (מוגדר ל${VIA_HE[wants] === 'Zernio' ? '-Zernio' : `${VIA_HE[wants]}`}, ${why})`;
}

const BASIS_HE = { results: 'לפי התוצאות', approval: 'לפי שיעור האישורים', none: 'אין עוד נתונים' };
const LEVEL_HE = { ok: ['בתוך התקציב', 'ok'], short: ['התחזית מעל התקציב גם אחרי צמצום', 'warn'], warn: ['מעל 80%', 'warn'], stop: ['נגמר: אין כתיבה עד החודש הבא', 'bad'] };

/** The month against the cap: spent, held, forecast, posts left, and each account's share and volume. */
export function budgetPanel(ctx, d) {
  const p = d.plan;
  const [lvl, cls] = LEVEL_HE[p.level] || [p.level, ''];
  // Only a value that lowers the cap is in force (globalCap), so only that one is shown: an older, higher setting reads as 0.
  const set = Number(d.settings.globalBudgetUsd) || 0;
  const lower = set > 0 && set < d.envCap ? set : 0;
  const capUsd = usd(d.envCap, Number.isInteger(d.envCap) ? 0 : 2);
  const rows = p.accounts
    .map(
      (a) =>
        `<tr><td class="title" data-k="">${accDot(a.id)} ${esc(a.name)}</td><td class="n" data-k="נתח">${usd(a.alloc)}</td><td class="n" data-k="הוצאה">${usd(a.spent, 3)}${a.reserved ? ` <span class="muted small">+${usd(a.reserved, 3)} שמור</span>` : ''}</td><td class="n" data-k="לפוסט">${usd(a.costPerPost, 3)}<span class="muted small"> ${a.measured ? 'נמדד' : 'הערכה'}</span></td><td class="n" data-k="ביום">${a.cut ? `<span class="chip warn">${a.perDay} במקום ${a.planned}</span>` : a.perDay}</td><td class="n" data-k="נשארו החודש">${a.remainingPosts}</td><td data-k="חוזק">${esc(BASIS_HE[a.basis])}${a.strength != null ? ` · ${a.strength.toFixed(2)}` : ''}</td></tr>`
    )
    .join('');
  return `<section class="panel" id="budget"><header><h2>תקציב חודשי</h2><span class="end"><span class="chip ${cls}">${esc(lvl)}</span></span></header>
<div class="row spread"><span>הוצאה ב-${esc(p.month)}</span><b class="ltr num">$${p.spent.toFixed(2)} / $${p.cap}</b></div>
<meter min="0" max="${p.cap || 1}" low="${(p.cap || 1) * 0.7}" high="${(p.cap || 1) * 0.8}" optimum="0" value="${Math.min(p.spent, p.cap || 1)}"></meter>
<dl class="kv mt12"><dt>תחזית לסוף החודש</dt><dd>${usd(p.forecast)}</dd><dt>שמור לקריאות שעוד רצות</dt><dd>${usd(p.reserved, 3)}</dd><dt>נשאר</dt><dd>${usd(p.left)} · בערך ${p.postsLeft} פוסטים, ב-${usd(p.costPerPost, 3)} לפוסט</dd></dl>
<div class="scrollx mt12"><table class="table stack"><thead><tr><th>חשבון</th><th>נתח</th><th>הוצאה</th><th>לפוסט</th><th>ביום</th><th>נשארו החודש</th><th>חוזק</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">התקרה היא <code class="ltr">OF_BUDGET_MONTHLY_USD</code> ב-<code class="ltr">.env</code> (${capUsd}), לכל שירות בתשלום חוץ מ-Zernio. כל קריאה שומרת קודם את המחיר הגבוה ביותר שהיא יכולה לעלות, ולכן שום דבר לא עובר את התקרה. כשהתחזית עוברת אותה, החשבון החלש ביותר יורד לפוסט אחד ביום, ואחריו הבא. ב-80% מופיעה אזהרה, וב-100% שום פוסט לא נכתב עד החודש הבא.</p>
<form method="post" action="/settings/budget" class="formgrid mt12">${csrfField(ctx)}<label class="f">תקרה נמוכה יותר לחודש הזה <small>עד ${capUsd}; 0 חוזר לתקרה מ-<code class="ltr">.env</code></small><input type="number" name="budget" min="0" max="${d.envCap}" step="0.5" value="${esc(lower)}"></label><button class="btn" type="submit">שמור</button></form></section>`;
}

export function settingsPage(ctx, d) {
  const s = d.settings;
  const body = `<div class="head"><h1>הגדרות</h1></div>
<div class="cols even">
<div>
<section class="panel"><header><h2>מתג כיבוי כללי</h2><span class="end">${s.globalKill ? '<span class="chip bad">מופעל</span>' : '<span class="chip ok">כבוי</span>'}</span></header>
<p class="muted">עוצר את כל החשבונות מיד: שום פוסט לא נכתב ושום פוסט לא מתפרסם עד שמכבים אותו.</p>
${s.globalKill ? postButton(ctx, '/settings/kill', 'הפעל את המערכת מחדש', { cls: 'btn primary', fields: { on: '0' } }) : postButton(ctx, '/settings/kill', `${icon('power')}עצור הכל`, { cls: 'btn danger', fields: { on: '1' }, confirm: 'בטוח? לחצו שוב לעצירה' })}
</section>
${budgetPanel(ctx, d)}
<section class="panel"><header><h2>שעת ייצור יומית</h2></header><form method="post" action="/settings/generate-at" class="formgrid">${csrfField(ctx)}<label class="f">שעה (שעון ישראל)<input type="text" name="at" value="${esc(s.generateAt)}" pattern="[0-2][0-9]:[0-5][0-9]" dir="ltr"></label><button class="btn" type="submit">שמור</button></form></section>
</div>
<div>
<section class="panel"><header><h2>מפתחות</h2><span class="end muted small">הערכים עצמם לא מוצגים</span></header><ul class="keys">${d.keys.map((x) => `<li>${x.set ? `<span class="chip ok">${icon('check')}מוגדר</span>` : '<span class="chip ghost">חסר</span>'}<div><code>${esc(x.name)}</code><div class="muted small">${esc(x.he || x.what)}</div></div></li>`).join('')}</ul></section>
<section class="panel"><header><h2>מצב המנוע</h2></header><dl class="kv"><dt>מקורות וכתיבה</dt><dd>${d.mode === 'live' ? '<span class="chip ok">חי</span> מקורות אמיתיים ו-Claude' : '<span class="chip warn">הקלטות</span> בלי רשת ובלי מפתח'}</dd>
<dt>מתג פרסום חי</dt><dd>${d.liveSwitch ? '<span class="chip ok">PUBLISH_MODE=live</span>' : '<span class="chip ghost">כבוי: הכל יבש</span>'}</dd>
${d.publishers.map((p) => `<dt>${esc(p.name)}</dt><dd>${p.platforms.map((x) => `${PLATFORM_HE[x.platform] || x.platform}: ${publisherHe(x)}`).join(' · ')}</dd>`).join('')}</dl></section>
${d.instagram.length ? `<section class="panel"><header><h2>אינסטגרם ישירות (Meta Graph API)</h2></header><ul class="factlist">${d.instagram.map((x) => `<li>${accDot(x.id)} <b>${esc(x.name)}</b> ${x.configured ? '<span class="chip ok">מחובר</span>' : `<span class="chip ghost">חסר ${!x.userId ? 'instagram.userId ב-pack.json' : `<code class="ltr">${esc(x.tokenEnv)}</code>`}</span>`} <span class="muted small">${x.auth === 'instagram' ? 'Instagram Login' : 'Facebook Login (עמוד פייסבוק)'}${x.daysLeft != null ? ` · האסימון בתוקף עוד ${x.daysLeft} ימים` : ''}</span></li>`).join('')}</ul><p class="muted small">בדיקה מלאה של האסימון, החשבון ונתוני ה-insights: <code class="ltr">npm run instagram:check</code></p></section>` : ''}
<section class="panel"><header><h2>החשבון שלך</h2></header><p class="muted m0">שם המשתמש: <b>${esc(ctx.user?.name || '')}</b></p><div class="actions p0 mt12">${postButton(ctx, '/logout', `${icon('logout')}יציאה`, { cls: 'btn danger' })}</div></section>
<section class="panel"><header><h2>משתמשים</h2></header><ul class="factlist">${d.users.map((u) => `<li><b>${esc(u.name)}</b> <span class="chip ghost">${esc(ROLE_HE[u.role] || u.role)}</span> <span class="muted small">${u.last_login_at ? `נכנס ${esc(stamp(u.last_login_at))}` : ''}</span></li>`).join('')}</ul><p class="muted small">משתמש נוסף: <code class="ltr">npm run user:add -- name</code></p></section>
<section class="panel"><header><h2>יומן פעולות</h2></header><ol class="trace">${d.audit.map((a) => `<li class="ok"><b>${esc(AUDIT_HE[a.action] || a.action)}</b> <span class="muted small">${esc(a.actor)} · ${esc(stamp(a.at))}${a.account_id ? ` · ${esc(a.account_id)}` : ''}</span></li>`).join('')}</ol></section>
</div></div>`;
  return layout({ ...ctx, title: 'הגדרות', active: 'settings' }, body);
}

export function morePage(ctx) {
  const row = (href, ic, t, sub) => `<a href="${href}"><span class="ico">${icon(ic)}</span><span class="t"><b>${t}</b><small>${sub}</small></span><span class="go">${icon('chev')}</span></a>`;
  const body = `<div class="head"><h1>עוד</h1></div><nav class="list" aria-label="עוד">
${row('/new', 'plus', 'חשבון חדש', 'ממקור ועד חמישה פוסטים לדוגמה')}
${row('/settings', 'settings', 'הגדרות', 'כיבוי כללי, תקציב, מפתחות, משתמשים')}
<form method="post" action="/logout">${csrfField(ctx)}<button class="danger" type="submit"><span class="ico">${icon('logout')}</span><span class="t"><b>יציאה</b></span></button></form></nav>`;
  return layout({ ...ctx, title: 'עוד', active: 'more' }, body);
}

export function loginPage({ error = null } = {}) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#eeeff2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)"><title>כניסה · תדר</title><link rel="stylesheet" href="/static/style.css"><link rel="icon" href="/static/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/static/icon-180.png"><link rel="manifest" href="/static/manifest.webmanifest"></head>
<body class="login"><form class="card" method="post" action="/login">
<div class="hero"><span class="mark" aria-hidden="true"><svg viewBox="0 0 100 100">${markDots(true)}</svg></span><b>תדר</b></div>
<p>היכנסו כדי לאשר את הפוסטים של היום.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<label class="f">שם משתמש<input type="text" name="user" autocomplete="username" autocapitalize="off" spellcheck="false" required dir="ltr"></label>
<label class="f">סיסמה<input type="password" name="password" autocomplete="current-password" required dir="ltr"></label>
<button class="btn primary" type="submit">כניסה</button></form></body></html>`;
}

export function notFoundPage(ctx) {
  return layout({ ...ctx, title: 'לא נמצא', active: '' }, `<div class="empty mt30">${icon('alert')}<b>הדף לא נמצא</b><a href="/">חזרה להיום</a></div>`);
}

/* ------------------------------------------------------------ hand-checked facts */

const FACT_STATE = { valid: ['בתוקף', 'ok'], soon: ['פג בקרוב', 'warn'], expired: ['פג: לא בשימוש', 'bad'] };

export function factsPage(ctx, { packs, current, topics, today, nextYear, form = {}, problems = [] }) {
  const tabs = `<nav class="tabs" aria-label="חשבונות">${packs.map((p) => `<a href="/facts?account=${esc(p.id)}"${p.id === current.id ? ' aria-current="true"' : ''}>${accDot(p.id)}${esc(p.meta.displayName)}</a>`).join('')}</nav>`;
  const list = topics
    .map(
      (t) => `<section class="panel"><header><h2 dir="auto">${esc(t.topic)}</h2><span class="end muted small">${t.facts.length} עובדות</span></header>${t.facts.length ? `<ul class="factlist">${t.facts
        .map((f) => {
          const [he, cls] = FACT_STATE[f.state] || [f.state, ''];
          return `<li><div class="meta p0"><span class="chip ${cls}">${esc(he)}</span>${f.checkedBy === 'claude' ? '<span class="chip warn" title="הועתק מהעמוד, עוד לא נבדק על ידיך">נבדק על ידי Claude</span>' : ''}<span class="end muted small">נבדק ${esc(f.checkedAt)} · עד ${esc(f.expires)}</span></div>
<blockquote dir="auto">${esc(f.quote)}</blockquote><a class="small" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(f.source)}</a>${f.note ? `<p class="muted small m4" dir="auto">${esc(f.note)}</p>` : ''}
${f.problems.length ? `<div class="problems"><ul>${f.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
<div class="actions pt10 p0x"><form method="post" action="/facts/confirm" class="inline">${csrfField(ctx)}<input type="hidden" name="account" value="${esc(current.id)}"><input type="hidden" name="topic" value="${esc(t.topic)}"><input type="hidden" name="id" value="${esc(f.id)}"><label class="small">בתוקף עד <input type="date" name="expires" value="${esc(f.expires > today ? f.expires : nextYear)}" dir="ltr"></label><button class="btn sm primary" type="submit">${icon('check')}בדקתי שוב היום</button></form>${postButton(ctx, '/facts/remove', 'הסר', { cls: 'btn sm danger', confirm: 'להסיר את העובדה?', fields: { account: current.id, topic: t.topic, id: f.id } })}</div></li>`;
        })
        .join('')}</ul>` : '<p class="muted">אין עובדות בנושא הזה.</p>'}</section>`
    )
    .join('');
  const body = `<div class="head"><h1>עובדות שנבדקו ביד</h1><span class="sub">מה שקראתם באתר שהמנוע לא קורא</span></div>
${tabs}
<p class="lede">חלק מהאתרים הרשמיים (כל זכות, gov.il) חוסמים קוראים אוטומטיים, והמנוע לא עוקף את זה. כאן אתם כותבים עובדה שקראתם בעצמכם: המשפט מילה במילה, העמוד, היום שבדקתם, ועד מתי היא בתוקף. אחרי תאריך התפוגה העובדה לא משמשת אף פוסט עד שתבדקו אותה שוב, ופוסט שנכתב ממנה ועוד לא פורסם ייחסם.</p>
<div class="cols"><div>${list || '<div class="empty"><b>עוד אין עובדות לחשבון הזה</b>הראשונה תיצור את התיקייה <code class="ltr">facts/</code> בחבילה שלו.</div>'}</div>
<section class="panel"><header><h2>עובדה חדשה</h2></header>
${problems.length ? `<div class="problems"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="/facts/add" class="formgrid">${csrfField(ctx)}<input type="hidden" name="account" value="${esc(current.id)}">
<label class="f">נושא <small>עובדות באותו נושא נכתבות יחד לפוסט אחד</small><input type="text" name="topic" required maxlength="60" list="topics" value="${esc(form.topic || '')}"><datalist id="topics">${topics.map((t) => `<option value="${esc(t.topic)}">`).join('')}</datalist></label>
<label class="f">המשפט, מילה במילה <small>4 עד 40 מילים, בדיוק כמו בעמוד, בלי שלוש נקודות</small><textarea name="quote" required rows="3">${esc(form.quote || '')}</textarea></label>
<label class="f">שם המקור<input type="text" name="source" required maxlength="80" value="${esc(form.source || '')}" placeholder="כל זכות"></label>
<label class="f">כתובת העמוד<input type="url" name="url" required dir="ltr" value="${esc(form.url || '')}"></label>
<label class="f">נבדק ב<input type="date" name="checkedAt" required dir="ltr" value="${esc(form.checkedAt || today)}"></label>
<label class="f">בתוקף עד <small>אחרי התאריך הזה היא לא בשימוש עד שתבדקו שוב; עד שנתיים</small><input type="date" name="expires" required dir="ltr" value="${esc(form.expires || nextYear)}"></label>
<label class="f">הערה <small>לא חובה</small><input type="text" name="note" maxlength="200" value="${esc(form.note || '')}"></label>
<button class="btn primary" type="submit">${icon('plus')}הוסף עובדה</button></form></section></div>`;
  return layout({ ...ctx, title: 'עובדות שנבדקו ביד', active: 'sources' }, body);
}

/* ------------------------------------------------------------ rivals, typed in by hand */

const RIVAL_STATE = { fresh: null, stale: ['כדאי להציץ שוב', 'warn'], dropped: ['ישן: לא בשימוש', 'bad'] };
const agoHe = (d) => (d <= 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`);

/** The rival form: a new rival, or the one `r` is (its fields prefilled). */
function rivalForm(ctx, current, r = {}, { id = null, submit = 'הוסף מתחרה' } = {}) {
  const v = (x) => (Array.isArray(x) ? x.join('\n') : x || '');
  return `<form method="post" action="/rivals/save" class="formgrid">${csrfField(ctx)}<input type="hidden" name="account" value="${esc(current.id)}">${id ? `<input type="hidden" name="id" value="${esc(id)}">` : ''}
<label class="f">שם משתמש<input type="text" name="handle" required maxlength="40" dir="ltr" autocapitalize="off" spellcheck="false" placeholder="@" value="${esc(r.handle || '')}"></label>
<label class="f">פלטפורמה<select name="platform">${['tiktok', 'instagram'].map((x) => `<option value="${x}"${(r.platform || 'tiktok') === x ? ' selected' : ''}>${PLATFORM_HE[x]}</option>`).join('')}</select></label>
<label class="f">שורות השער שעבדו להם הכי טוב <small>שורה לכל אחת, עד ${RIVALS.hooks}, כמו שהן כתובות</small><textarea name="hooks" required rows="4" dir="auto">${esc(v(r.hooks))}</textarea></label>
<label class="f">הפורמטים שלהם <small>שורה לכל אחד: "דירוג 5 עד 1", "סיפור בשקפים"</small><textarea name="formats" rows="2" dir="auto">${esc(v(r.formats))}</textarea></label>
<label class="f">שעות פרסום <small><bdi dir="ltr">18:30, 21:00</bdi></small><input type="text" name="times" dir="ltr" value="${esc(Array.isArray(r.times) ? r.times.join(', ') : r.times || '')}"></label>
<label class="f">מה הם לא נותנים <small>הנושאים והזוויות שהקהל שלהם לא מקבל; הכי חשוב בטופס</small><textarea name="gaps" rows="3" maxlength="${RIVALS.gapChars}" dir="auto">${esc(r.gaps || '')}</textarea></label>
<button class="btn primary" type="submit">${id ? icon('check') : icon('plus')}${submit}</button></form>`;
}

export function rivalsPage(ctx, { packs, current, rivals, times, form = {}, problems = [] }) {
  const tabs = `<nav class="tabs" aria-label="חשבונות">${packs.map((p) => `<a href="/rivals?account=${esc(p.id)}"${p.id === current.id ? ' aria-current="true"' : ''}>${accDot(p.id)}${esc(p.meta.displayName)}</a>`).join('')}</nav>`;
  const editing = form.id ? Number(form.id) : null;
  const list = rivals
    .map((r) => {
      const st = RIVAL_STATE[r.state];
      const shown = editing === r.id ? { ...r, ...form } : r;
      return `<section class="panel acc acc-${esc(current.id)}" id="rival-${r.id}"><header><h2 class="ltr">@${esc(r.handle)}</h2><span class="chip ghost">${esc(PLATFORM_HE[r.platform] || r.platform)}</span>${st ? `<span class="chip ${st[1]}">${esc(st[0])}</span>` : ''}<span class="end muted small">עודכן ${esc(agoHe(r.age))}${r.updatedBy ? ` · ${esc(r.updatedBy)}` : ''}</span></header>
<ul class="rival">${r.hooks.map((h) => `<li dir="auto">${esc(h)}</li>`).join('')}</ul>
<dl class="kv">${r.formats.length ? `<dt>פורמטים</dt><dd dir="auto">${esc(r.formats.join(' · '))}</dd>` : ''}${r.times.length ? `<dt>שעות</dt><dd class="ltr">${esc(r.times.join(' · '))}</dd>` : ''}${r.gaps ? `<dt>מה חסר אצלם</dt><dd dir="auto">${esc(r.gaps)}</dd>` : ''}</dl>
<details class="rivaledit"${editing === r.id ? ' open' : ''}><summary>עדכון</summary>${editing === r.id && problems.length ? `<div class="problems"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${rivalForm(ctx, current, shown, { id: r.id, submit: 'שמור, הסתכלתי היום' })}</details>
<div class="actions pt10 p0x">${postButton(ctx, '/rivals/remove', 'הסר', { cls: 'btn sm danger', confirm: 'להסיר את המתחרה?', fields: { account: current.id, id: r.id } })}</div></section>`;
    })
    .join('');
  const fewer = rivals.length < RIVALS.min ? `<p class="small"><span class="chip warn">${rivals.length ? `עוד ${RIVALS.min - rivals.length}` : `${RIVALS.min} לפחות`}</span> שלושה עד חמישה חשבונות נותנים תמונה של הנישה; אחד הוא רק טעם של חשבון אחד.</p>` : '';
  const slots = times.own.length
    ? `<section class="panel"><header><h2>שעות</h2></header><dl class="kv">${times.own.map((x) => `<dt class="ltr">${esc(x.at)}</dt><dd>${x.near ? `${x.near === 1 ? 'מתחרה אחד מפרסם' : `${x.near} מתחרים מפרסמים`} בטווח שעה` : 'אף מתחרה לא מפרסם בטווח שעה'}</dd>`).join('')}${times.theirs.length ? `<dt>הם</dt><dd><bdi dir="ltr">${esc(times.theirs.map((x) => x.at).join(' · '))}</bdi></dd>` : ''}</dl>
<p class="muted small m6">המשבצות של החשבון באות מהחבילה שלו, עם שבת, חגים ושעות הפרסום. השעות של המתחרים מוצגות כאן לידן ולא משנות אותן.</p></section>`
    : '';
  const adding = !editing && problems.length;
  const body = `<div class="head"><h1>מתחרים</h1><span class="sub">מה שראיתם אצלם, בשביל הכתיבה</span></div>
${tabs}
<p class="lede">המנוע לא קורא חשבונות של אחרים: זה דף של מישהו אחר, וכלל הרשת שלנו חוסם אותו. כאן אתם כותבים מה ראיתם כשגללתם בנישה: השערים שעבדו להם, הפורמטים, מתי הם מפרסמים ומה הם לא נותנים. הכותב מקבל את זה בכל תכנון: מה שחסר אצלם מכוון את הנושא והזווית, והשערים שלהם הם מה שהשער שלנו צריך לבלוט מולו, בלי להעתיק. מתחרה שלא עודכן ${RIVALS.staleDays} יום מסומן, ואחרי ${RIVALS.dropDays} יום הוא כבר לא מגיע לכותב.</p>
${fewer}
<div class="cols"><div>${list || '<div class="empty"><b>עוד אין מתחרים לחשבון הזה</b>הכתיבה עובדת גם בלעדיהם, רק בלי לדעת מה הנישה כבר רואה.</div>'}${slots}</div>
${rivals.length < RIVALS.max ? `<section class="panel"><header><h2>מתחרה חדש</h2><span class="end muted small">${rivals.length} מתוך ${RIVALS.max}</span></header>
${adding ? `<div class="problems"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
${rivalForm(ctx, current, adding ? form : {})}</section>` : `<section class="panel"><header><h2>חמישה מתחרים</h2></header><p class="muted">זה המקסימום. כדי להוסיף אחר, הסירו אחד.</p></section>`}</div>`;
  return layout({ ...ctx, title: 'מתחרים', active: 'accounts' }, body);
}
