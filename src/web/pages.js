import { accDot, csrfField, dayHe, esc, icon, k, layout, MODE_HE, postButton, shortDate, stamp, statusChip, timeHe, usd, weekdayNarrow } from './ui.js';
import { PAUSE_REASONS } from '../autonomy/rails.js';

// Every page, as a function from data to HTML.
//
// The words on the pages are Hebrew; what came from a source (an English quote,
// a URL) keeps its own direction inside an isolated run.

const REJECT_REASONS = ['לא מעניין', 'טעות בעובדה', 'הקול לא נכון', 'נושא שכבר היה', 'העיצוב לא עובד'];
const STEP_HE = {
  format: 'פורמט', topic: 'בחירת נושא', outline: 'מתווה ועובדות', facts: 'אימות עובדות', slides: 'כתיבת שקפים', redraft: 'כתיבה מחדש', review: 'בדיקת "נשמע כמו בוט"', verify: 'שער העובדות',
  image: 'תמונה', render: 'רינדור', queue: 'לתור', publish: 'פרסום', blocked: 'נחסם', error: 'שגיאה', edit: 'עריכה',
};
const PLATFORM_HE = { tiktok: 'טיקטוק', instagram: 'אינסטגרם' };
const ROLE_HE = { owner: 'בעלים', editor: 'עורך', viewer: 'צופה' };
const AUDIT_HE = {
  login: 'כניסה', approve: 'אישור פוסט', unapprove: 'ביטול אישור', reject: 'דחיית פוסט', edit: 'עריכה', publish_now: 'פרסום ידני', published: 'פורסם', publish_failed: 'פרסום נכשל',
  auto_approved: 'אושר אוטומטית', mode: 'שינוי מצב', pause: 'השהיה', resume: 'חידוש', global_kill_on: 'כיבוי כללי', global_kill_off: 'הפעלה מחדש', global_budget: 'תקציב כללי',
  generate_at: 'שעת ייצור', source_approved: 'מקור אושר', source_removed: 'מקור הוסר', source_added: 'מקור נוסף', user_added: 'משתמש נוסף',
  format_dropped: 'פורמט נשר', format_promoted: 'פורמט הוכח', format_returned: 'פורמט חזר', onboarding: 'חשבון חדש', went_live: 'חשבון עלה לאוויר',
};

const media = (post, platform, i) => `/media/${encodeURIComponent(post.id)}/${platform}/${i}?v=${encodeURIComponent(String(post.updated_at || '').replace(/D/g, '').slice(-10))}`;
const formatName = (pack, id) => pack?.formats.formats.find((f) => f.id === id)?.name || id;

function botChip(score, reviewer) {
  if (score == null) return '';
  const cls = score <= 2 ? 'ok' : score <= 3 ? '' : 'warn';
  return `<span class="chip ${cls}" title="ציון של בודק ${reviewer === 'claude' ? 'Claude' : 'אופליין'}: 0 אדם, 10 בוט">${icon('spark')}נשמע כמו בוט: <span class="num ltr">${score}/10</span></span>`;
}

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
      return `<li id="s-${post.id}-${i + 1}"><div class="slide-n">שקף ${i + 1}: ${esc(s.title)}</div>${facts
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
  return `<p class="caption">${esc(post.caption)} <span class="tags">${esc((post.hashtags || []).join(' '))}</span></p>`;
}

/** One post as a card, with its decision buttons. */
export function postCard(ctx, post, pack) {
  const when = post.slot_at ? timeHe(post.slot_at) : 'בלי שעה';
  const decide = post.status === 'queued';
  return `<article class="card acc acc-${esc(post.account_id)} post" id="post-${esc(post.id)}" data-post>
<div class="meta"><span class="when num">${esc(when)}</span><span class="chip">${esc(formatName(pack, post.format_id))}</span>${statusChip(post.status)}${botChip(post.review_score, post.checks?.reviewer)}${post.ai_label ? '<span class="chip warn">תמונת AI: תסומן</span>' : ''}<span class="end muted small num">${usd(post.cost_usd, 3)}${post.cost_estimated ? ' הערכה' : ''}</span></div>
<h3 class="hook">${esc(post.hook)}</h3>
${post.sub ? `<p class="caption">${esc(post.sub)}</p>` : ''}
${strip(post)}
${captionBlock(post)}
${factsBlock(post)}
<div class="actions">
${decide ? postButton(ctx, `/post/${post.id}/approve`, `${icon('check')}אשר`, { cls: 'btn primary', ajax: 'remove' }) : ''}
<a class="btn" href="/post/${esc(post.id)}#edit">${icon('edit')}ערוך</a>
${decide ? `<button class="btn ghost" type="button" data-toggle="#reject-${esc(post.id)}" aria-expanded="false">${icon('x')}דחה</button>` : ''}
${post.status === 'approved' ? postButton(ctx, `/post/${post.id}/unapprove`, 'בטל אישור', { cls: 'btn ghost', ajax: 'reload' }) : ''}
</div>
${decide ? `<form class="rejectbox" id="reject-${esc(post.id)}" method="post" action="/post/${esc(post.id)}/reject" data-ajax="remove">${csrfField(ctx)}
<label class="f">למה?<select name="reason">${REJECT_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}<option value="">אחר</option></select></label>
<input type="text" name="note" placeholder="הערה (לא חובה), עוזרת לכתיבה הבאה" maxlength="300">
<button class="btn danger" type="submit">דחה את הפוסט</button></form>` : ''}
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
    else if (g.reached) banners.push(`<div class="banner warn">${icon('alert')}<div><b>${esc(g.pack.meta.displayName)}: התקציב החודשי נגמר.</b><p>לא נכתבים פוסטים חדשים עד החודש הבא או עד שהתקציב יוגדל.</p></div></div>`);
  }
  const body = `<div class="head"><h1>היום</h1><span class="sub">${esc(dayHe(Date.now()))}</span></div>
${banners.join('')}
<div class="stats"><div class="stat${all.length ? ' hot' : ''}"><b>${all.length}</b><span>מחכים לך</span></div><div class="stat"><b>${sched.length}</b><span>מאושרים, מתוזמנים</span></div><div class="stat"><b>${pub.length}</b><span>פורסמו היום</span></div><div class="stat"><b>${blocked.length}</b><span>נחסמו בבדיקות</span></div></div>
${d.groups
  .map((g) => {
    const mode = MODE_HE[g.acc?.mode || 'approve'];
    const posts = [...g.waiting, ...g.scheduled];
    return `<section class="group" aria-labelledby="g-${esc(g.pack.id)}"><header>${accDot(g.pack.id)}<h2 id="g-${esc(g.pack.id)}">${esc(g.pack.meta.displayName)}</h2><span class="handle ltr">@${esc(g.pack.meta.handle)}</span><span class="end"><span class="chip ghost">${esc(mode[0])}</span></span></header>
${posts.length ? `<div class="posts">${posts.map((p) => postCard(ctx, p, g.pack)).join('')}</div>` : `<div class="empty">${icon('inbox')}<b>אין כאן מה לאשר</b>${g.acc?.status === 'paused' ? 'החשבון מושהה.' : 'הפוסטים של היום ייווצרו בשעת הייצור, או שכבר טופלו.'}</div>`}
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
<label class="f">כיתוב<textarea name="caption" maxlength="400">${esc(v.caption)}</textarea></label>
<div><button class="btn primary" type="submit">${icon('check')}שמור ורנדר מחדש</button></div></form></details>`;

  const body = `<div class="head"><div><a class="muted small back" href="/">${icon('chev')}חזרה להיום</a><h1>${esc(post.hook || post.topic || 'פוסט')}</h1></div><span class="end">${statusChip(post.status)}</span></div>
${post.reason ? `<div class="banner ${post.status === 'blocked' || post.status === 'failed' ? 'bad' : 'info'}">${icon('alert')}<div><b>${esc(post.reason)}</b></div></div>` : ''}
<div class="cols">
<div>
<section class="card acc acc-${esc(post.account_id)}"><div class="meta"><span class="chip">${accDot(post.account_id)} ${esc(pack?.meta.displayName || post.account_id)}</span><span class="chip">${esc(formatName(pack, post.format_id))}</span>${post.slot_at ? `<span class="chip">${icon('clock')}${esc(stamp(post.slot_at))}</span>` : ''}</div>
<h3 class="hook pt10">טיקטוק <span class="muted small">9:16</span></h3>${strip(post, 'tiktok')}
${post.media?.instagram ? `<h3 class="hook">אינסטגרם <span class="muted small">4:5</span></h3>${strip(post, 'instagram')}` : ''}
${captionBlock(post)}
${post.status === 'queued' ? `<div class="actions">${postButton(ctx, `/post/${post.id}/approve`, `${icon('check')}אשר`, { cls: 'btn primary' })}${postButton(ctx, `/post/${post.id}/reject`, `${icon('x')}דחה`, { cls: 'btn ghost', fields: { reason: 'נדחה מדף הפוסט' } })}</div>` : ''}
${post.status === 'approved' ? `<div class="actions">${postButton(ctx, `/post/${post.id}/publish-now`, 'פרסם עכשיו', { cls: 'btn primary', confirm: 'בטוח? לפרסם עכשיו' })}${postButton(ctx, `/post/${post.id}/unapprove`, 'בטל אישור', { cls: 'btn ghost' })}</div>` : ''}
</section>
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
${d.image ? `<dt>תמונה</dt><dd>${esc(d.image.provider)} · ${esc(d.image.license)}${d.image.author ? ` · ${esc(d.image.author)}` : ''}${d.image.ai_generated ? ' · <span class="chip warn">AI</span>' : ''}</dd>` : ''}
${d.metrics.length ? d.metrics.slice(0, 2).map((m) => `<dt>${esc(PLATFORM_HE[m.platform] || m.platform)}</dt><dd class="num">${k(m.views)} צפיות · ${k(m.likes)} לייקים · ${k(m.shares)} שיתופים${m.saves != null ? ` · ${k(m.saves)} שמירות` : ''}</dd>`).join('') : ''}
</dl></section>
<section class="panel"><header><h2>איך הפוסט נוצר</h2></header><ol class="trace">${trace}</ol></section>
</div></div>`;
  return layout({ ...ctx, title: post.hook || 'פוסט', active: 'today' }, body);
}

/* ------------------------------------------------------------ accounts */

export function accountsPage(ctx, rows) {
  const body = `<div class="head"><h1>חשבונות</h1><span class="sub">${rows.length} חשבונות, כל אחד מותג משלו</span><span class="end"><a class="btn sm" href="/new">${icon('plus')}חשבון חדש</a></span></div>
<div class="accounts">${rows
    .map(({ pack, acc, spend, cap, week }) => {
      const paused = acc.status === 'paused';
      const max = Math.max(1, ...week.days.map((x) => x.n));
      const h = (n) => (n === 0 ? 'h0' : `h${Math.max(1, Math.min(4, Math.ceil((n / max) * 4)))}`);
      return `<article class="card acc acc-${esc(pack.id)} acct" id="acc-${esc(pack.id)}">
<div class="title">${accDot(pack.id)}<div><h2>${esc(pack.meta.displayName)}</h2><span class="muted small ltr">@${esc(pack.meta.handle)}</span></div><span class="end">${paused ? '<span class="chip warn">מושהה</span>' : '<span class="chip ok">פעיל</span>'}</span></div>
${paused ? `<div class="paused${acc.paused_reason === 'kill' ? ' kill' : ''}">${icon(acc.paused_reason === 'kill' ? 'power' : 'alert')}<div><b>${esc(PAUSE_REASONS[acc.paused_reason] || acc.paused_reason)}</b>${acc.paused_detail ? `<div class="small">${esc(acc.paused_detail)}</div>` : ''}</div>${postButton(ctx, `/accounts/${pack.id}/resume`, 'הפעל מחדש', { cls: 'btn sm' })}</div>` : ''}
<form method="post" action="/accounts/${esc(pack.id)}/mode" data-autosubmit>${csrfField(ctx)}<div class="seg" role="radiogroup" aria-label="מצב אוטונומיה">${['approve', 'digest', 'auto']
        .map((m) => `<input type="radio" name="mode" value="${m}" id="m-${esc(pack.id)}-${m}"${acc.mode === m ? ' checked' : ''}><label for="m-${esc(pack.id)}-${m}">${MODE_HE[m][0]}<small>${MODE_HE[m][1]}</small></label>`)
        .join('')}</div><noscript><button class="btn sm" type="submit">שמור</button></noscript></form>
<div><div class="row"><span>תקציב החודש</span><b class="ltr">$${spend.toFixed(2)} / $${cap}</b></div><meter min="0" max="${cap || 1}" low="${(cap || 1) * 0.7}" high="${(cap || 1) * 0.9}" optimum="0" value="${Math.min(spend, cap || 1)}"></meter></div>
<div><div class="row"><span>7 הימים האחרונים</span><b>${week.days.reduce((s, x) => s + x.n, 0)} פורסמו${week.views != null ? ` · ${k(week.views)} צפיות` : ''}</b></div>
<div class="week" aria-label="פוסטים שפורסמו בכל יום">${week.days.map((x) => `<span title="${esc(shortDate(x.at))}: ${x.n}"><i class="${h(x.n)}"></i>${esc(weekdayNarrow(x.at))}</span>`).join('')}</div></div>
<dl class="kv"><dt>בתור</dt><dd>${week.counts.queued || 0} ממתינים · ${week.counts.approved || 0} מאושרים</dd><dt>נחסמו השבוע</dt><dd>${week.counts.blocked || 0}</dd><dt>פרסום</dt><dd>${pack.meta.publisher === 'zernio' ? 'Zernio' : 'יבש (לדיסק)'}</dd></dl>
<div class="actions p0">${!paused ? postButton(ctx, `/accounts/${pack.id}/kill`, `${icon('power')}כבה את החשבון`, { cls: 'btn danger', confirm: 'בטוח? לחצו שוב לכיבוי' }) : ''}<a class="btn" href="/sources?account=${esc(pack.id)}">מקורות</a></div>
</article>`;
    })
    .join('')}</div>`;
  return layout({ ...ctx, title: 'חשבונות', active: 'accounts' }, body);
}

/* ------------------------------------------------------------ results */

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
<p class="lede">כל פוסט נמדד 72 שעות אחרי שעלה, מול החציון של אותה פלטפורמה: בטיקטוק שיתופים ולייקים לצפייה (טיקטוק לא מדווחת שמירות), באינסטגרם שמירות לצפייה. 70% מהפוסטים בפורמטים מוכחים, 30% בניסיונות, ופורמט נושר אחרי 3 תוצאות ברצף מתחת ל-70% מהחציון.</p>
${d.scored.length ? `<div class="cols even"><section class="panel"><header><h2>מנצחים</h2></header>${table(d.winners)}</section><section class="panel"><header><h2>מפסידים</h2></header>${table(d.losers)}</section></div>` : `<div class="empty">${icon('results')}<b>אין עדיין מספרים</b>מספרים נקראים מ-Zernio רק מפוסטים שפורסמו באמת, והציון נקבע 72 שעות אחרי הפרסום. שום מספר לא מומצא כדי למלא את הדף.</div>`}
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
  const body = `<div class="head"><h1>מקורות</h1><span class="sub">רק מקור מאושר יכול לתמוך בעובדה</span></div>
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

export function settingsPage(ctx, d) {
  const s = d.settings;
  const body = `<div class="head"><h1>הגדרות</h1></div>
<div class="cols even">
<div>
<section class="panel"><header><h2>מתג כיבוי כללי</h2><span class="end">${s.globalKill ? '<span class="chip bad">מופעל</span>' : '<span class="chip ok">כבוי</span>'}</span></header>
<p class="muted">עוצר את כל החשבונות מיד: שום פוסט לא נכתב ושום פוסט לא מתפרסם עד שמכבים אותו.</p>
${s.globalKill ? postButton(ctx, '/settings/kill', 'הפעל את המערכת מחדש', { cls: 'btn primary', fields: { on: '0' } }) : postButton(ctx, '/settings/kill', `${icon('power')}עצור הכל`, { cls: 'btn danger', fields: { on: '1' }, confirm: 'בטוח? לחצו שוב לעצירה' })}
</section>
<section class="panel" id="budget"><header><h2>תקציב חודשי כללי</h2></header>
<div class="row spread"><span>הוצאה ב-${esc(d.month)}</span><b class="ltr num">$${d.spend.usd.toFixed(2)} / $${s.globalBudgetUsd}</b></div>
<meter min="0" max="${s.globalBudgetUsd || 1}" low="${(s.globalBudgetUsd || 1) * 0.7}" high="${(s.globalBudgetUsd || 1) * 0.9}" optimum="0" value="${Math.min(d.spend.usd, s.globalBudgetUsd || 1)}"></meter>
<ul class="factlist mt12">${d.perAccount.map((r) => `<li>${accDot(r.pack.id)} ${esc(r.pack.meta.displayName)} <span class="muted ltr num">$${r.spend.toFixed(2)} / $${r.cap}</span>${r.reached ? ' <span class="chip bad">נגמר</span>' : ''}</li>`).join('')}</ul>
<form method="post" action="/settings/budget" class="formgrid mt12">${csrfField(ctx)}<label class="f">תקציב כללי בדולרים לחודש<input type="number" name="budget" min="1" max="5000" step="1" value="${esc(s.globalBudgetUsd)}"></label><button class="btn" type="submit">שמור</button></form>
<p class="muted small">התקציב של כל חשבון מוגדר בקובץ pack.json שלו. כשאחד מהם נגמר, החשבון מושהה עד החודש הבא.</p></section>
<section class="panel"><header><h2>שעת ייצור יומית</h2></header><form method="post" action="/settings/generate-at" class="formgrid">${csrfField(ctx)}<label class="f">שעה (שעון ישראל)<input type="text" name="at" value="${esc(s.generateAt)}" pattern="[0-2][0-9]:[0-5][0-9]" dir="ltr"></label><button class="btn" type="submit">שמור</button></form></section>
</div>
<div>
<section class="panel"><header><h2>מפתחות</h2><span class="end muted small">רק אם הוגדר, אף פעם לא הערך</span></header><ul class="keys">${d.keys.map((x) => `<li>${x.set ? `<span class="chip ok">${icon('check')}מוגדר</span>` : '<span class="chip ghost">חסר</span>'}<div><code>${esc(x.name)}</code><div class="muted small">${esc(x.he || x.what)}</div></div></li>`).join('')}</ul></section>
<section class="panel"><header><h2>מצב המנוע</h2></header><dl class="kv"><dt>מקורות וכתיבה</dt><dd>${d.mode === 'live' ? '<span class="chip ok">חי</span> מקורות אמיתיים ו-Claude' : '<span class="chip warn">הקלטות</span> בלי רשת ובלי מפתח'}</dd>
<dt>מתג פרסום חי</dt><dd>${d.liveSwitch ? '<span class="chip ok">PUBLISH_MODE=live</span>' : '<span class="chip ghost">כבוי: הכל יבש</span>'}</dd>
${d.publishers.map((p) => `<dt>${esc(p.name)}</dt><dd>${p.via === 'zernio' ? 'Zernio' : `יבש${p.wants === 'zernio' ? ' (מוגדר ל-Zernio, חסר מפתח או מתג)' : ''}`}</dd>`).join('')}</dl></section>
<section class="panel"><header><h2>משתמשים</h2></header><ul class="factlist">${d.users.map((u) => `<li><b>${esc(u.name)}</b> <span class="chip ghost">${esc(ROLE_HE[u.role] || u.role)}</span> <span class="muted small">${u.last_login_at ? `נכנס ${esc(stamp(u.last_login_at))}` : ''}</span></li>`).join('')}</ul><p class="muted small">משתמש נוסף: <code class="ltr">npm run user:add -- name</code></p></section>
<section class="panel"><header><h2>יומן פעולות</h2></header><ol class="trace">${d.audit.map((a) => `<li class="ok"><b>${esc(AUDIT_HE[a.action] || a.action)}</b> <span class="muted small">${esc(a.actor)} · ${esc(stamp(a.at))}${a.account_id ? ` · ${esc(a.account_id)}` : ''}</span></li>`).join('')}</ol></section>
</div></div>`;
  return layout({ ...ctx, title: 'הגדרות', active: 'settings' }, body);
}

export function morePage(ctx) {
  const body = `<div class="head"><h1>עוד</h1></div><div class="accounts">
<a class="card acct plain" href="/new"><div class="title">${icon('plus')}<h2>חשבון חדש</h2></div><p class="muted m0">ממקור ועד חמישה פוסטים לדוגמה</p></a>
<a class="card acct plain" href="/settings"><div class="title">${icon('settings')}<h2>הגדרות</h2></div><p class="muted m0">כיבוי כללי, תקציב, מפתחות, משתמשים</p></a></div>`;
  return layout({ ...ctx, title: 'עוד', active: 'more' }, body);
}

export function loginPage({ error = null, theme = null } = {}) {
  return `<!doctype html><html lang="he" dir="rtl"${theme ? ` data-theme="${esc(theme)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>כניסה · תדר</title><link rel="stylesheet" href="/static/style.css"><link rel="icon" href="/static/icon.svg" type="image/svg+xml"></head>
<body class="login"><form class="card" method="post" action="/login">
<a class="brand" href="/login"><span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c2.5-6 4.5-6 7 0s4.5 6 7 0 4-6 6 0"/></svg></span><span><b>תדר</b><small>open frequency</small></span></a>
<p>שולחן האישורים. כל פוסט, כל עובדה, כל מקור.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<label class="f">שם משתמש<input type="text" name="user" autocomplete="username" required dir="ltr"></label>
<label class="f">סיסמה<input type="password" name="password" autocomplete="current-password" required dir="ltr"></label>
<button class="btn primary" type="submit">כניסה</button></form></body></html>`;
}

export function notFoundPage(ctx) {
  return layout({ ...ctx, title: 'לא נמצא', active: '' }, `<div class="empty mt30">${icon('alert')}<b>הדף לא נמצא</b><a href="/">חזרה להיום</a></div>`);
}
