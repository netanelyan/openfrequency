import { COMPLIANCE } from '../rules/compliance.js';
import { overlayOf } from '../rules/overlay.js';
import { CONNECTIVES, FILLER, FORMAL, LIMITS, limitsFor } from '../voice/tells.js';
import { focusText } from '../sources/text.js';
import { contentRange, groupOf, hookPatterns, kindName, kindOf, shapesPrompt } from '../formats/kinds.js';
import { VISUAL_SCHEMA, visualsPrompt } from '../render/visuals.js';

// The drafting calls' prompts and schemas, built from the pack.
//
// Prompts are in English (the model follows instructions best there) and ask for
// Hebrew output. Every rule here is also a check in code: the prompt is how the
// model gets it right the first time, the check is how a draft that did not is
// never shown.
//
// THE ORDER IS THE CACHE. A prompt is cached as a prefix, so it is built from
// the most stable part down:
//   1. the pack: who the account is, its voice guide, all its formats with their
//      cover patterns, the shape of every kind of post it uses, the Hebrew rules
//      and the law. The same for every call about this account (outline,
//      slides, rewrite), so they share one cached prefix.
//   2. the task's instructions: the same for every outline, or every slides call.
//   3. the user turn: this post's format, its cover pattern, its documents or facts.
// Nothing that changes per post (a date, a count, a format name) goes above the
// user turn. The schemas are the same for every kind of post for the same reason.

const SUBJECT = {
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'string' }, answer: { type: 'string' }, date: { type: 'string' } },
  required: ['a', 'b', 'answer', 'date'],
  additionalProperties: false,
};

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    usable: { type: 'boolean' },
    why: { type: 'string' },
    topic: { type: 'string' },
    subject: SUBJECT,
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, claim: { type: 'string' }, quote: { type: 'string' }, doc: { type: 'string' } },
        required: ['id', 'claim', 'quote', 'doc'],
        additionalProperties: false,
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { role: { type: 'string' }, point: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } },
        required: ['role', 'point', 'facts'],
        additionalProperties: false,
      },
    },
    imageQuery: { type: 'string' },
    imageQueryB: { type: 'string' },
    research: { type: 'array', items: { type: 'string' } },
  },
  required: ['usable', 'why', 'topic', 'subject', 'facts', 'items', 'imageQuery', 'research'],
  additionalProperties: false,
};

export const DETAILS_SCHEMA = {
  type: 'object',
  properties: {
    details: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, kind: { type: 'string' }, claim: { type: 'string' }, quote: { type: 'string' }, doc: { type: 'string' }, item: { type: 'integer' } },
        required: ['id', 'kind', 'claim', 'quote', 'doc', 'item'],
        additionalProperties: false,
      },
    },
  },
  required: ['details'],
  additionalProperties: false,
};

export const SLIDES_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    sub: { type: 'string' },
    hookPattern: { type: 'string' },
    subject: SUBJECT,
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          a: { type: 'string' },
          b: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
          visual: VISUAL_SCHEMA,
          imageQuery: { type: 'string' },
        },
        required: ['role', 'title', 'body', 'a', 'b', 'facts', 'visual', 'imageQuery'],
        additionalProperties: false,
      },
    },
    caption: { type: 'string' },
    captionShort: { type: 'string' },
    question: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    coverVisual: VISUAL_SCHEMA,
  },
  required: ['hook', 'sub', 'hookPattern', 'subject', 'slides', 'caption', 'captionShort', 'question', 'keywords', 'coverVisual'],
  additionalProperties: false,
};

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    rewrites: {
      type: 'array',
      items: { type: 'object', properties: { index: { type: 'integer' }, text: { type: 'string' } }, required: ['index', 'text'], additionalProperties: false },
    },
  },
  required: ['rewrites'],
  additionalProperties: false,
};

const compliance = (pack) =>
  (pack.meta.compliance || [])
    .map((id) => `- ${COMPLIANCE[id].about}. This is law and a code check enforces it: explain how things work, never recommend.`)
    .join('\n');

/** The voice guide with at most `max` example lines under each examples heading. */
export function trimVoice(md, max = 5) {
  let into = false;
  let n = 0;
  return String(md || '')
    .split(/\r?\n/)
    .filter((line) => {
      const h = /^#{2,3}\s*(.+)$/.exec(line);
      if (h) {
        into = /טוב|רע|good|bad/i.test(h[1]);
        n = 0;
        return true;
      }
      if (into && /^\s*[-*]\s+/.test(line)) return ++n <= max;
      return true;
    })
    .join('\n')
    .trim();
}

/** "a story", "an iceberg", "an on-this-day": the kind with its article. */
const aKind = (f) => `${/^[aeio]/.test(kindName(f)) ? 'an' : 'a'} ${kindName(f)}`;

/** One format, as the pack block lists it: its kind, its size and its cover patterns. */
function formatLine(f) {
  const [lo, hi] = contentRange(f);
  const hooks = hookPatterns(f)
    .map((h) => `[${h.id}] ${h.pattern}${h.examples.length ? ` (e.g. ${h.examples.map((x) => `"${x}"`).join(', ')})` : ''}`)
    .join(' / ');
  return `- ${f.id}: "${f.name}", ${aKind(f)} post, ${lo} to ${hi} content slides. ${f.about || ''} Cover patterns (adapt, never copy word for word): ${hooks}`;
}

/**
 * Block 1: the pack. Stable for every call about this account. `ttl` is the
 * cache duration: '1h' for batches (their rounds can be more than five minutes
 * apart), '5m' for direct calls.
 */
export function packBlock(pack, { ttl = '5m' } = {}) {
  const banned = [...CONNECTIVES, ...FORMAL, ...FILLER].map((t) => t.p).concat(pack.rules.bannedPhrases || []);
  const legacy = (pack.formats.formats || []).every((f) => kindName(f) === 'list');
  // An account that asked for short captions gets a tease, not a summary.
  const capLong = limitsFor('captionLong', pack);
  const capShort = limitsFor('captionShort', pack);
  const shortCaps = capLong.maxChars < LIMITS.captionLong.maxChars;
  return {
    cache: ttl,
    text: `You plan and write Hebrew social slideshow posts for one account, from source documents.

THE ACCOUNT: "${pack.meta.displayName}" (@${pack.meta.handle}). It is about: ${(pack.meta.topics || []).join(', ')}. Its audience: ${pack.meta.audience || 'Hebrew speakers in Israel'}.
${pack.meta.description || ''}

THE ACCOUNT'S VOICE (its own guide, follow it):
${trimVoice(pack.voice)}

ITS FORMATS (every post is one of them; the request names which, and which cover pattern to follow):
${(pack.formats.formats || []).map(formatLine).join('\n')}

THE SHAPES (what each kind of post is made of; "role" names a content slide's job):
${shapesPrompt(pack)}

The kind of question its captions end with (examples of the tone, not lines to copy): ${(pack.formats.caption?.questions || []).join(' / ')}
${
  legacy
    ? ''
    : `
EVERY POST:
- 5 to 8 slides with the cover. One idea per slide. The payoff is on the last slide, and the design draws the call to action on it: never write one yourself.
- The cover is one bold claim or one question, narrow and specific, with a famous name in it when there is one. It can tease; it never promises what the post does not deliver.
- Facts in every kind of post come from the documents: a story, a quiz or an opinion holds only facts the quotes support.
- keywords: 3 to 6 words people would search for, shown on the slides: names, the topic, the competition. At least one in Hebrew and one in English letters.
- Today's date is in the request. Anything that happened more than a year before it is told with its year on the cover or the first slide, as what it shows or teaches now: never as news, never as if it just happened.
- Every slide adds something the cover and the slides before it did not: no slide and no graphic repeats another's numbers or point.
- Talk like a friend, in spoken Hebrew: the spoken imperative (תעקבו, תשמרו, תשלחו, תכתבו, תנחשו), never the formal one (עקבו, שמרו, שלחו, כתבו, נחשו), and the everyday word over the formal one (פאונד, not ליברה).
- A claim of "the only", "the first", "never" or "every" keeps every condition its fact has: "the only player to win all six" shortened to three of them is false. Keep the whole list, or drop the "only".
- Name what the post is about (the product, the person, the club, the fight) on the cover or the first slide: a post that never says whose story it is reads as a riddle nobody asked for.
- caption: the TikTok caption, ${shortCaps ? `${capLong.minChars} to ${capLong.maxChars} characters: short and catchy, one or two lines that make them open the post (a tease or the stakes, never a summary of it), with the names people search for` : '200 to 600 characters: what the post is about in the words people search for, and a line on why it matters'}. The post's best fact, quote or twist is on a slide, never only in the caption, and the caption promises nothing the slides do not show ("what Cavani said years later" with no slide that says it reads as a broken promise). captionShort: the Instagram caption, ${capShort.maxChars < LIMITS.captionShort.maxChars ? `up to ${capShort.maxChars} characters, one catchy line` : '60 to 200 characters'} (the design puts the cover line before it). Neither has hashtags, links or a question.

VISUALS: a post is pictures as much as words, never a deck of text cards. At least half of the slides carry a visual: the cover always has one, and the request says how many content slides need one. A content slide's "visual" is data the design draws as a graphic; its numbers are claims like the slide's own, held to the facts the slide cites. A head-to-head "stat" slide's two values are already its visual (give it type "none"). The graphics this account draws:
${visualsPrompt(pack)}
  Unused fields are "", and type "none" means no graphic. A visual adds what the words do not: the timeline of the moment, the numbers side by side, where the players stood. It never repeats the title as a picture.
- imageQuery on a content slide: 2 to 5 English words naming one real, famous person or place the slide is about ("Steven Gerrard", "Wembley Stadium"), for a licensed photograph of exactly them; the engine checks the picture shows them and drops it otherwise. "" when the slide is not about a person or place${pack.meta.imagery?.providers?.length ? '' : ' (this account uses no photographs: always "")'}. Never a logo, a crest, a screenshot or a product.
- coverVisual: the cover's graphic when no photograph is used: the most striking number or match-up of the post, as one visual of the types above (a stat, a compare...), or type "none" to let the design draw the kind's own art. A date is the cover's graphic only on a post about that day (this day in history, a fight's date): a past date as the biggest thing on a cover reads as old news.
`
}
HEBREW, ALWAYS:
- Spoken, correct Hebrew. Short sentences. Address the audience in the plural (אתם, תנסו, שמרו), never in the singular.
- No exclamation marks, no long dashes, no semicolons, no ellipsis, at most one emoji per slide.
- Never claim to have tried, bought, used, visited or seen anything. The account explains; it does not have experiences.
- Never mention another account, a follower count, views, a badge or "official".
- Never these words: ${banned.join(', ')}.
${compliance(pack)}`,
  };
}

const OUTLINE_TASK = {
  cache: '5m',
  text: `TASK: PLAN ONE POST.

The request names the post's format and its kind, how many content slides it has, and gives the source documents. Decide whether the documents can carry this post honestly, and extract the facts it will stand on.

Facts:
- A fact is something a slide will state. Each fact has a quote copied character for character from ONE document (doc: its id, D1, D2...): its exact words, 4 to {maxQuote} words (8 or more where the document allows), no ellipsis, no paraphrase, no translation, no joining two sentences or two lines. A table row is one line, its cells joined with " | ": quote the row as it is written. Pick quotes that contain every number the claim states, written as digits where the document has digits.
- The claim is the fact in plain spoken Hebrew, as the account would say it. It may translate or simplify the quote; it may never add to it. A term it translates (a weight class, a title, a legal term) takes its own Hebrew name, never a neighbouring one: the slides follow the claim. It keeps what each word in the quote belongs to: "the first manager of an English team" is not "the first English manager" (the man was Scottish), and "the club's first title" is not "the first title".
- Never state anything the documents do not say. Never add a number that is not in the quote. A date is a number too: a claim that says when something happened or changed needs a quote that contains that date, or it leaves the date out.
- Prefer facts that are specific, surprising and new to most people over general statements.
- A vendor's forecast or guidance, and the numbers of a demo, an example or a sample run, are claims, not results: the claim says whose forecast or which demo it is, and a post never stands on them.
- The angle. A story every fan of the niche already knows (the most famous final, upset or goal) is no post told the usual way: tell it through a detail from the documents most of them have never heard, and lead with that detail (the cover and the first slide). If the documents hold no such detail, prefer usable=false.

Items: the content slides in order, each { role, point: what the slide says in a few Hebrew words, facts: the fact ids it states }. The roles follow the kind's shape (THE SHAPES). Every item states at least one fact, except the roles the shape says carry none.

RESEARCH COMES NEXT. After this plan, the engine reads the articles you name in "research" and pulls the details out of them (who said what, the minute, the moment, what came before and after), each checked against its source. So when these documents name a famous moment but do not tell it (a career article that mentions the goal, a list that has the result), the post is still usable: plan it, name the article that tells the moment in "research", and leave the facts of the slides that need those details empty: research fills them, and a slide still without a fact after research is dropped. The facts you write here still come only from these documents. Unusable means nothing here is worth a post, not that the details are missing.

subject: what the kind needs, "" for the rest: a and b (the two sides of a head-to-head; a alone for what-happened), answer (guess-who), date (on-this-day, in Hebrew with the year).
topic: the post's subject in a few Hebrew words.
imageQuery: 2 to 5 English words for a licensed photograph that would suit the post (a famous person or place by name is fine where the account's rules allow it; never a logo, a crest, a badge, a screen, an injury); or "" if none would. The person the post is about, by full name (Cristiano Ronaldo, never Ronaldo alone), as they looked in the story's years. Whoever the cover shows, the cover line names: a face the cover does not explain is a stranger (a World Cup iceberg went out with an old man nobody could name, a scorers' ranking with a close-up of its number three). A ranking's cover never shows its number one (it spoils the countdown): name someone else on the list whom the cover line names too, or "". A guess-who names its answer: the design shows it blurred until the reveal. A head-to-head names side a here and side b in imageQueryB (full names in English): the cover shows the two side by side.
imageQueryB: a head-to-head's side b, as above; "" for every other kind.
research: 1 to 4 titles of encyclopedia articles, or short search phrases, that would tell this post's subject in more detail than these documents: the match, the fight, the event, the person, the product or company itself ("2005 UEFA Champions League final", "Natan Levy"). The engine reads them before the slides are written, for the details a fan would want. [] when the documents already hold them.

A story, a what-happened or an on-this-day needs its ending: the post's last slide says how it ended (the result, the outcome, where it stands now). If neither these documents nor the articles you name for research would say it, the post is not usable.

If the documents cannot carry this post with real, specific facts, return usable=false with the reason, and empty facts and items.`,
};

const SLIDES_TASK = {
  cache: '5m',
  text: `TASK: WRITE ONE POST'S TEXT.

The request names the format and its kind, the content slides with their roles, the verified facts, the outline and the cover pattern to follow. Write:
- hook: the cover line. 3 to 11 words, after the cover pattern the request names (adapt it to this post, never copy it word for word). It makes them need the second slide: a question or a promise that only the slides answer ("איך ברצלונה עשו את הבלתי אפשרי בקאמפ נואו?" pulls; "ברצלונה ניצחה 6:1" is already over), built on the post's most surprising concrete detail where the pattern allows (a score, a sum, a quote, a name). Never only the famous name of the story, and never the payoff the last slide holds. A count it promises ("3 רמזים", "5 ...") is the count of the slides that follow. A number only if it is the number of content slides, a top 5 or 10, or it appears in a fact's quote. hookPattern: that pattern's id.
- sub: one short line under the cover line, or "" when the cover line alone fills the cover's lines (LINES in the request).
- subject: as in the outline (you may shorten a name).
- slides: exactly the outline's content slides, the same roles in the same order, each { role, title: up to 60 characters, body: up to 230 characters in one to three short sentences, broken into lines as the request's LINES says (or one item a line, where the shape says so), a and b: the two values on a head-to-head stat slide and "" everywhere else, facts: the ids of the facts it states }. Every number on a slide, dates and years included, must appear in the quotes of the facts it lists.
- caption, captionShort, keywords: as the account's rules say. For a legacy list post, captionShort and keywords may be empty.
- question: one short question about this post's own subject that a reader could answer from their own life, or "" when none would sound natural. Never a line that fits any post ("ידעתם את זה?", "מה דעתכם?", "למי זה יכול לעזור?"): those are dropped.`,
};

const REWRITE_TASK = {
  cache: '5m',
  text: `TASK: REWRITE FLAGGED TEXTS.

A reader flagged some texts of a post: as sounding like a bot (and said what gave each away), or as saying more than the post's facts support (a FACT PROBLEM). Rewrite each flagged text so a person would have written it, in the account's voice: natural spoken Hebrew, plural address, no exclamation marks, no long dashes. Where there is a FACT PROBLEM, say only what the facts support: drop or soften the part that goes beyond them. Keep every fact and every number that is supported; add none; keep about the same length. Return { index, text } for each flagged text you were given, using its index. A flagged "visual" is a slide's graphic, given as its data (JSON): return it corrected as the same JSON in "text", every name and number from the facts its slide may use, or "" to drop it.`,
};

const DETAILS_TASK = {
  cache: '5m',
  text: `TASK: FIND THE DETAILS.

The request gives one post's topic, its plan, the facts it already has, and more documents about its subject (R1, R2...). Pull out the specific details a fan would want and the facts do not already say:
- quote: what someone involved said, in the source's words (who said it is part of the claim)
- time: the minute, the round, the date or the hour something happened
- moment: exactly what happened at the turn of the story
- backstory: what came before, that makes the moment matter
- after: what happened or what people said afterwards
- number: one number that tells the story (a score, a crowd, a price, a count)
Each detail: { id: X1, X2..., kind: one of the six above, claim: the detail in plain spoken Hebrew (it may translate the quote, never add to it, and keeps what each word belongs to: "the first manager of an English team" is not "the first English manager"), quote: copied character for character from ONE document, 4 to {maxQuote} words, every number the claim states included, doc: that document's id, item: the number of the plan's slide it belongs on (1, 2...), or 0 }. A slide of the plan that has no fact yet needs its details most: give it at least one, or it is dropped.
Only details about this post's own subject, 3 to 8 of them, none that repeats a fact the post already has. A detail a document does not state is never written: when the documents hold fewer than 3 such details, return the ones they hold, and the engine leaves the topic for another.`,
};

export function detailsPrompt(pack, { ttl = '5m' } = {}) {
  const maxQ = pack.rules.maxQuoteWords || 40;
  return { system: [packBlock(pack, { ttl }), { ...DETAILS_TASK, text: DETAILS_TASK.text.replace('{maxQuote}', maxQ) }], schema: DETAILS_SCHEMA };
}

/** The details call's user turn: the post so far, then the research documents. */
export function detailsUser({ format, outline, facts, docs, maxChars = 12000 }) {
  const per = docs.length ? Math.max(2500, Math.floor(maxChars / docs.length)) : maxChars;
  return [
    formatHead(format),
    `TOPIC: ${outline.topic}`,
    outline.subject ? `SUBJECT: ${Object.entries(outline.subject).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || '(none)'}` : '',
    'THE PLAN:',
    ...(outline.items || []).map((it, i) => `${i + 1}. ${it.role || 'item'}: ${it.point}${(it.facts || []).length ? '' : ' (no fact yet)'}`),
    'FACTS THE POST ALREADY HAS (do not repeat them):',
    ...facts.map((f) => `- ${f.claim}`),
    ...docs.map((d) => `<document id="${d.ref}" source="${d.sourceName || ''}" url="${d.url}">\n${d.title ? `# ${d.title}\n` : ''}${String(d.text).slice(0, per)}\n</document>`),
  ]
    .filter((x) => x !== '')
    .join('\n\n');
}

export function outlinePrompt(pack, { ttl = '5m' } = {}) {
  const maxQ = pack.rules.maxQuoteWords || 40;
  return { system: [packBlock(pack, { ttl }), { ...OUTLINE_TASK, text: OUTLINE_TASK.text.replace('{maxQuote}', maxQ) }], schema: OUTLINE_SCHEMA };
}

/** What the request says about the format: its id, name and kind, and the size of the post. */
function formatHead(format, n = null) {
  const [lo, hi] = contentRange(format);
  return `FORMAT: ${format.base || format.id} ("${format.name}"), ${aKind(format)} post, ${n ? `exactly ${n}` : `${lo} to ${hi}`} content slides.`;
}

/**
 * The outline's user turn: this post's format, then the documents, narrowed to
 * their content. `day` (on-this-day): the date the post goes out on; `subject`:
 * a subject the post must be about (a fight week's main event). `niche`: the
 * rivals the owner watches, as nicheForOutline says them.
 */
export function outlineUser(format, docs, { avoid = [], faceless = [], maxChars = 7000, day = null, subject = null, maxAgeDays = null, niche = '' } = {}) {
  const per = docs.length > 1 ? Math.max(2500, Math.floor(maxChars / docs.length)) : maxChars;
  return [
    `${formatHead(format)}${format.trend ? ` ${format.about}` : ''}`,
    day ? `TODAY: ${day}.` : '',
    day && kindName(format) === 'on-this-day' ? `THE POST GOES OUT ON: ${day}. Pick a moment that happened on this day and month in an earlier year.` : '',
    subject ? `SUBJECT: ${subject}. The post is about this.` : '',
    // An undated page (an encyclopedia article) passes the date filter; the story inside it may still be years old.
    maxAgeDays && day && kindName(format) !== 'on-this-day'
      ? `FRESHNESS: this account's news ages fast. The post's story happened within ${maxAgeDays} days before TODAY, or it is a lasting how-to or price that is current now; an older launch, raise or failure is background at most, never the story.`
      : '',
    ...docs.map((d) => `<document id="${d.ref}" source="${d.sourceName}" url="${d.url}">\n${d.title ? `# ${d.title}\n` : ''}${focusText(d.text, { maxChars: per, numbersFirst: groupOf(format) === 'number' })}\n</document>`),
    avoid.length ? `Topics this account posted recently (do not repeat them): ${avoid.join(' · ')}` : '',
    faceless.length ? `Matchups with no licensed photograph of one side (choose two others, from the same card or the same documents): ${faceless.join(' · ')}` : '',
    // The rivals the owner typed in (src/pipeline/rivals.js): a subject still wins, and the documents still decide what is true.
    subject ? '' : niche,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function slidesPrompt(pack, { ttl = '5m' } = {}) {
  return { system: [packBlock(pack, { ttl }), SLIDES_TASK], schema: SLIDES_SCHEMA };
}

/** How many content slides need a visual, so that with the cover at least half of the slides have one. */
export const visualsNeeded = (n) => Math.max(0, Math.ceil((n + 1) / 2) - 1);

/**
 * The overlay rules as the writer is told them (src/rules/overlay.js holds them and checks them): the
 * account's own numbers, so a pack that asks for longer lines is written for as it asks.
 */
export function linesRule(pack = null) {
  const o = overlayOf(pack);
  const [lo, hi] = o.wordsPerLine;
  const [a, b] = o.linesPerSlide;
  return `LINES: the words on a slide sit over a picture, read in a second. Break them by hand with "\\n": ${lo} to ${hi} words a line (only the last line of a text may be shorter), ${a} to ${b} lines on a slide, title and body together (on the cover, the cover line and the line under it together). A title is a reaction, what a person says when they see it ("81 יום, ואף אחד לא השקה"), never a label that names the part ("טיפ 3", "עובדה:", "התפנית"). A body that is a list (places 10 to 6, a layer) keeps one item a line.`;
}

/**
 * What the morning's feedback found, said to the writer (src/metrics/feedback.js): why this post is planned the
 * way it is, so the cover, the caption or the angle change where the numbers say they should. "" when it is not.
 */
export function steerLine(steer) {
  if (!steer?.kind) return '';
  const was = steer.hook ? `"${steer.hook}"` : 'a recent post';
  if (steer.kind === 'variation') return `FROM THE RESULTS: ${was} reached more people than this account's usual post, and more of them acted on it. This post is variation ${steer.n || 1} of ${steer.of || 3} of it: the same story and facts, a new cover line in the pattern named here. Never the words of ${was}.`;
  if (steer.kind === 'new-cta') return `FROM THE RESULTS: ${was} reached more people than usual, but few acted on it. Keep a cover as strong, in the pattern named here; the call to action is a different one, and write the captions a new way${steer.cta ? ` (the last call to action was "${steer.cta}")` : ''}.`;
  if (steer.kind === 'new-hooks') return `FROM THE RESULTS: ${was} reached fewer people than usual, but those it reached acted on it. Keep the call to action; the cover must be radically different from ${was}: another angle, another first word, and another kind of first-slide picture${steer.cover ? ` than its "${steer.cover}"` : ''}.`;
  if (steer.kind === 'new-angle') return `FROM THE RESULTS: ${was}${steer.format ? ` (${steer.format})` : ''} did poorly on views and on action. This post takes a new angle${steer.topic ? `, far from "${steer.topic}"` : ''}.`;
  return '';
}

export function slidesUser({ format, n, outline, facts, edits = [], problems = [], lastDraft = null, hook = null, cta = null, day = null, pack = null, steer = null, niche = '' }) {
  const legacy = kindName(format) === 'list';
  const body = limitsFor('slideBody', pack);
  const sub = limitsFor('sub', pack);
  const end = pack?.meta?.endSlide?.title;
  return [
    `${formatHead(format, n)}`,
    day ? `TODAY: ${day}.` : '',
    hook ? `COVER PATTERN: [${hook.id}] ${hook.pattern}${hook.examples?.length ? ` (e.g. ${hook.examples.map((x) => `"${x}"`).join(', ')})` : ''}` : '',
    format.trend ? `Cover lines that fit this post: ${format.hooks.join(' / ')}` : '',
    end && !legacy ? 'The design adds a closing slide that asks them to follow the account: no slide asks to save, send, follow or comment.' : cta && !legacy ? `The design ends the last slide with this call to action, so the slides do not say it: "${cta.text}"` : '',
    body.maxChars < LIMITS.slideBody.maxChars ? `TEXT: this account keeps slides short. A slide's body is at most ${body.maxChars} characters and ${body.sentences} sentences: one point, the words a fan would say, no number the point does not need.` : '',
    sub.maxChars < LIMITS.sub.maxChars ? `SUB: the line under the cover is at most ${sub.maxChars} characters, one punchy line that makes them swipe (the stakes or a tease, never an explanation of the topic), or "".` : '',
    !legacy ? `VISUALS: at least ${visualsNeeded(n)} of the ${n} content slides carry a visual (a stat slide's two values count).` : '',
    linesRule(pack),
    steerLine(steer),
    niche,
    `TOPIC: ${outline.topic}`,
    !legacy && outline.subject ? `SUBJECT: ${Object.entries(outline.subject).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || '(none)'}` : '',
    'FACTS (state only these; cite their ids):',
    ...facts.map((f) => `- ${f.key}${f.detail ? ` (detail: ${f.detail})` : ''}: ${f.claim}  [quote: "${f.quote}"]`),
    facts.some((f) => f.detail) ? `DETAILS: the facts marked "detail" are the specific moments, words and numbers a fan keeps. Put at least ${Math.min(3, facts.filter((f) => f.detail).length)} of them on the slides, each on the slide it belongs to, cited by its id: they are what makes this post worth finishing.` : '',
    'OUTLINE:',
    ...outline.items.map((it, i) => `${i + 1}. ${legacy ? '' : `${it.role || 'item'}: `}${it.point} (facts: ${(it.facts || []).join(', ') || 'none'})`),
    edits.length ? `\nLines the account's owner rewrote by hand recently (write like the AFTER versions):\n${edits.map((e) => `- before: ${e.before}\n  after: ${e.after}`).join('\n')}` : '',
    problems.length ? `\nTHE LAST DRAFT WAS REFUSED BY THE CHECKS. Fix exactly these and keep everything else:\n${problems.map((p) => `- ${p}`).join('\n')}` : '',
    // The draft itself: without it, "keep everything else" was a new draft from scratch, with new mistakes.
    problems.length && lastDraft ? `\nTHE LAST DRAFT (change only what the checks named, keep the rest word for word):\n${JSON.stringify(lastDraft)}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

export function rewritePrompt(pack, { ttl = '5m' } = {}) {
  return { system: [packBlock(pack, { ttl }), REWRITE_TASK], schema: REWRITE_SCHEMA };
}

export function rewriteUser({ flagged, facts }) {
  const limits = (l) => (l ? `; at most ${l.maxChars} characters${l.sentences ? ` and ${l.sentences} sentences` : ''}` : '');
  return [
    'FACTS THE POST STANDS ON (each with its id and what the source says):',
    ...facts.map((f) => `- ${f.key ? `${f.key}: ` : ''}${f.claim}${f.quote ? ` (source: "${f.quote}")` : ''}`),
    '',
    'FLAGGED TEXTS (every number in a text must be in the source words of the facts it may use):',
    ...flagged.map((x) =>
      [
        `[${x.index}] (${x.where}${x.botScore >= 4 ? `, gave away: ${(x.tells || []).join(', ') || 'too polished'}` : ''}${x.factProblem ? `, FACT PROBLEM: ${x.factProblem}` : ''}${limits(x.limits)}${x.uses?.length ? `; it may use facts ${x.uses.join(', ')}` : ''}) ${x.text}`,
        x.last ? `    your last rewrite: ${x.last}\n    REFUSED BY THE CHECKS: ${x.refused.join(' · ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    ),
  ].join('\n');
}

/** The kind's own instructions, for tests and tools that show one. */
export const kindPrompt = (format) => kindOf(format).prompt;
