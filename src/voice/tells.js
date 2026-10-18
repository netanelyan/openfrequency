// What gives a Hebrew text away as written by a bot, checked in code.
//
// A prompt can ask a model not to write these things; only a check can promise
// it did not. Every phrase here is refused on every slide, cover and caption,
// and the reasons go back to the model once for a redraft.
//
// Matching is on normalised Hebrew (no niqqud, no geresh, no punctuation), on
// whole words with a one-letter prefix allowed, so "ובנוסף" is caught and a
// longer word that merely contains a banned one is not. JavaScript's \b does not
// work on Hebrew letters, which is why none of these use it.

/** Hebrew without niqqud, quote marks and punctuation, single-spaced. */
export const normHe = (s) =>
  String(s || '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[׳״'"`]/g, '')
    .replace(/[^\p{L}\p{N}\s%]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PREFIX = '(?:ו|ה|ב|ל|מ|ש|כ|וה|וב|ול|ומ|וש|שה|שב|של|כש)?';
const phrase = (p) => new RegExp(`(?:^| )${PREFIX}${normHe(p)}(?= |$)`, 'u');
const group = (label, list) => list.map((p) => ({ label, p, re: phrase(p) }));

export const CONNECTIVES = group('stock opener or connective', [
  'חשוב לציין', 'כדאי לדעת', 'כדאי לזכור', 'שווה לדעת', 'שווה לציין', 'בנוסף', 'יחד עם זאת', 'ללא ספק', 'מעניין לציין',
  'ראוי לציין', 'לסיכום', 'כמו כן', 'נקודה שמתחברת', 'בעולם של היום', 'בעידן הנוכחי', 'בואו נצלול', 'בואו נדבר על', 'צללו פנימה',
  'במאמר זה', 'בפוסט הזה נדבר',
]);

export const FORMAL = group('formal word', ['ניתן', 'הינו', 'הינה', 'הינם', 'אנו', 'על מנת', 'באפשרותכם', 'באפשרותך', 'לפיכך', 'אי לכך', 'יתרה מזאת']);

export const PRAISE = group('generic praise', ['פשוט מדהים', 'תוכן מדהים', 'איזה כיף', 'איזה יופי', 'משנה חיים', 'משנה את כללי המשחק', 'גיים צ׳יינג׳ר', 'מהפכני']);

// Adjectives that carry no information; a slide's filler IS the whole line.
export const FILLER = group('filler adjective', [
  'מדהים', 'מדהימה', 'מדהימים', 'מרהיב', 'מרהיבה', 'קסום', 'קסומה', 'חלומי', 'חלומית', 'מושלם', 'מושלמת', 'עוצר נשימה', 'עוצרת נשימה',
  'בלתי נשכח', 'פנטסטי', 'פנטסטית', 'אדיר', 'אדירה',
]);

// Second-person singular forms. Posts address the audience in the plural.
// Only unambiguous ones: the masculine future (תוכל, תרצה, תבדוק) is spelled
// exactly like the third person feminine ("Google תוכל"), so it cannot be told
// apart without parsing the sentence, and a guard that refuses correct Hebrew is
// a broken guard. The live reviewer reads for register on top of this.
export const GENDERED = group('singular "you" (the audience is addressed in the plural)', [
  'אתה', 'תרצי', 'תגידי', 'תשלחי', 'תבדקי', 'תשמרי', 'תוכלי', 'תדעי', 'בא לך', 'שלך', 'אותך', 'עשית', 'כתבת', 'צילמת',
]);

const MORAL = /^(?:בקיצור|בסופו של דבר|בשורה התחתונה|השורה התחתונה|וזה מה ש|כי בסוף|אז כן|ובקיצור|המסקנה)/;
const EMOJI = /\p{Extended_Pictographic}/gu;
const LONG_DASH = /[—–]/;
const ARTEFACTS = /\*\*|^\s*[#*]\s|\{[a-z_]+\}|\[[^\]]*\]\(|<\/?[a-z]+>/im;
// A link: a scheme, "www.", or a domain with a path. A company named for its domain
// ("monday.com", "Wix.com") is a name, not a link, and neither platform makes it one.
// One word in two scripts: "חבib", "greco-רומית". A Hebrew prefix before a Latin name is the way it is written
// ("ב-Vercel", "ה-API"); a Latin word with a Hebrew one glued on after it is a translation left half done.
const MIXED_SCRIPT = /[א-ת][A-Za-z]|[A-Za-z][א-ת]|[A-Za-z]{2,}-[א-ת]{3,}/;
const URL_LIKE = /https?:\/\/|www\.|[\p{L}\p{N}-]+\.(?:com|co\.il|org|net|io|ai|gov\.il)\/\S/iu;

// The comma inside one score written the way fans read it ("ישראל 9, טייוואן 0"):
// a number, a comma, a name and a number, not chained to another score on either side.
const SCORE_COMMA = /(\d+)(?<!\d\s*,\s*[^,\d]{1,30}\s\d+)\s*,\s+(?=[^,\d]{1,30}\s\d+(?!\d)(?!\s*,\s*[^,\d]{1,30}\s\d))/gu;

/** Sentences, the way a reader counts them. */
export function sentencesOf(text) {
  return String(text || '')
    .replace(EMOJI, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/**
 * Share of words that carry Hebrew. Counted by word, not by letter: a product or
 * button name in Latin letters inside a Hebrew sentence ("Projects \u05D1-Claude") is
 * how people actually write, while a Latin sentence is not Hebrew however short.
 */
export function hebrewShare(text) {
  const words = String(text || '')
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (!words.length) return 1;
  return words.filter((w) => /[\u05D0-\u05EA]/.test(w)).length / words.length;
}

/**
 * A formal imperative at the head of a request ("עקבו אחרי", "שמרו את", "כתבו בתגובות"). Said to a friend it is the
 * spoken one: "תעקבו", "תשמרו", "תכתבו". Only before the words a request goes on with, so a past tense ("הם שמרו
 * על הכדור") is not taken for one.
 */
const FORMAL_IMPERATIVE = /(?:^|[\s.?:,"(])(עקבו|שמרו|שלחו|כתבו|תייגו|נחשו|ספרו|הגיבו|לחצו)\s+(?:את|לנו|לחבר|לחברים|אחרי|בתגובות|מי|עכשיו|כאן|פה|ל(?=\S))/;

export const LIMITS = {
  // A cover can ask, answer and tease in three short sentences ("X או Y? מי היה טוב יותר? התשובה בסוף"): eleven words bound it.
  cover: { maxChars: 70, minWords: 3, maxWords: 11, emoji: 1, sentences: 3 },
  slideTitle: { maxChars: 60, emoji: 1, sentences: 2 },
  slideBody: { maxChars: 230, emoji: 1, sentences: 3 },
  // The line under the cover line: a slide body's limits, unless the account keeps it shorter.
  sub: { maxChars: 230, emoji: 1, sentences: 3 },
  caption: { maxChars: 320, emoji: 2, sentences: 4 },
  // A post with two captions: TikTok's long one (its search reads it) and Instagram's short one.
  // An account that wants short, catchy captions asks for a lower minimum.
  captionLong: { minChars: 200, maxChars: 900, emoji: 2, sentences: 8 },
  captionShort: { maxChars: 260, emoji: 2, sentences: 3 },
  // A body of short lines (places 10 to 6, an iceberg's layer): each line is one item, not a run-on.
  slideLines: { maxChars: 260, emoji: 1, sentences: 6 },
};

/**
 * The limits for one kind of text in one pack: the engine's, tightened by the pack's own (pack.json
 * "writing": { "slideBody": { "maxChars": 150, "sentences": 2 } }). A pack can ask for less, never more:
 * a shorter text, fewer sentences, a lower minimum for TikTok's caption.
 */
export function limitsFor(kind, pack = null) {
  const base = LIMITS[kind] || LIMITS.slideBody;
  const own = pack?.meta?.writing?.[kind] || {};
  const out = { ...base };
  for (const [k, v] of Object.entries(own)) if (Number.isFinite(v) && (k === 'minWords' ? v >= (base[k] ?? 0) : v <= (base[k] ?? Infinity))) out[k] = v;
  return out;
}

/**
 * Every tell in one text, as { code, msg }. Empty means it reads like a person.
 * kind: 'cover' | 'sub' | 'slideTitle' | 'slideBody' | 'slideLines' | 'caption' | 'captionLong' | 'captionShort'
 * extra: the pack's own banned phrases (rules.json bannedPhrases)
 */
const ON_SLIDE = new Set(['cover', 'sub', 'slideTitle', 'slideBody']);

export function tellsIn(text, { kind = 'slideBody', extra = [], pack = null } = {}) {
  const out = [];
  const add = (code, msg) => out.push({ code, msg });
  const raw = String(text || '').trim();
  if (!raw) return kind === 'slideBody' || kind === 'slideLines' || kind === 'sub' ? [] : [{ code: 'empty', msg: 'empty' }];
  const norm = normHe(raw);
  const lim = limitsFor(kind, pack);

  for (const t of [...CONNECTIVES, ...FORMAL, ...PRAISE, ...FILLER, ...GENDERED]) if (t.re.test(norm)) add('phrase', `${t.label}: "${t.p}"`);
  for (const p of extra) if (phrase(p).test(norm)) add('banned', `banned by the pack: "${p}"`);

  if (LONG_DASH.test(raw)) add('structure', 'a long dash (use a comma or a hyphen)');
  if (/;/.test(raw)) add('structure', 'a semicolon');
  if (/!/.test(raw)) add('register', 'an exclamation mark');
  const formal = FORMAL_IMPERATIVE.exec(norm);
  if (formal) add('register', `the formal imperative "${formal[1]}": say it the spoken way, "ת${formal[1]}"`);
  if (/\.\.\.|…/.test(raw)) add('structure', 'trails off with an ellipsis');
  if (ARTEFACTS.test(raw)) add('artefact', 'markdown or a template placeholder left in the text');
  const mixed = raw.split(/\s+/).find((w) => MIXED_SCRIPT.test(w));
  if (mixed) add('language', `"${mixed}" mixes Hebrew and Latin letters in one word: write it in Hebrew`);
  if (URL_LIKE.test(raw)) add('url', 'a web address (a link in a post is a demotion and is never tappable)');
  const emoji = (raw.match(EMOJI) || []).length;
  if (emoji > lim.emoji) add('register', `${emoji} emoji, ${lim.emoji} at most`);
  if (/^caption/.test(kind)) {
    // In a caption the colon of a brochure ("שלושה דברים: א, ב, ג") is a tell.
    const colon = sentencesOf(raw).some((s) => {
      const at = s.replace(/\d:\d/g, '').indexOf(':');
      return at >= 0 && s.slice(0, at).trim().split(/\s+/).length > 4;
    });
    if (colon) add('structure', 'a colon after a whole clause: say it as a sentence');
  }

  // Lines are items: each is counted on its own, so five places are five lines, not one long sentence.
  // On a slide a line break is where the eye rests (src/rules/overlay.js), not the end of a sentence.
  const sentences = kind === 'slideLines' ? raw.split(/\n+/).flatMap((l) => sentencesOf(l)) : ON_SLIDE.has(kind) ? sentencesOf(raw.replace(/\s*\n+\s*/g, ' ')) : sentencesOf(raw);
  for (const raw1 of sentences) {
    // A score as fans write it ("ישראל 9, טייוואן 0") is one thing, not two; four scores in a row are still a list.
    const s = raw1.replace(SCORE_COMMA, '$1 ');
    const parts = s.split(/,|\s+ו(?=\S)/).map((p) => p.trim()).filter(Boolean);
    // Four short things in a row: "פוטוס, זמיה, קקטוס ואלוורה". Clauses around one long one are a sentence, not a list
    // ("באותה שנה, ב-14 בנובמבר, החברה הוציאה את X, שמסכם אתרים" was refused, and no redraft could fix what was not there).
    let run = 0;
    let longest = 0;
    for (const p of parts) {
      run = p.split(/\s+/).length <= 3 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (s.split(',').length >= 4 && longest >= 4) {
      add('structure', `a list of four or more things in one sentence ("${raw1.length > 70 ? `${raw1.slice(0, 70)}...` : raw1}"): keep two or three, or give them a line each`);
      break;
    }
  }
  const last = normHe(sentences[sentences.length - 1] || '');
  if (sentences.length > 1 && MORAL.test(last)) add('structure', 'ends by summing up or drawing a moral');

  const len = raw.replace(/\s+/g, ' ').length;
  if (len > lim.maxChars) add('length', `${len} characters, ${lim.maxChars} at most`);
  // The sentences as the code counted them: a model told only "4 sentences" miscounts its own text and redrafts the same four.
  if (sentences.length > lim.sentences) add('length', `${sentences.length} sentences, ${lim.sentences} at most (counted: ${sentences.map((x, i) => `[${i + 1}] "${x.length > 50 ? `${x.slice(0, 50)}...` : x}"`).join(' ')}): join two of them or cut one`);
  if (kind === 'cover') {
    // Words as a reader counts them: ש-Gemini is one word, not a prefix and a name.
    const words = raw.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    if (words < lim.minWords || words > lim.maxWords) add('length', `${words} words on the cover, ${lim.minWords} to ${lim.maxWords}`);
  }
  // A short title that is a name ("Fiverr", "Real Madrid", the answer of a guess-who) is not a sentence in English.
  const aName = (kind === 'slideTitle' || kind === 'cover') && raw.split(/\s+/).length <= 3 && !/[.?]$/.test(raw);
  if (hebrewShare(raw) < 0.5 && !aName) add('language', 'mostly not Hebrew');
  return out;
}

/**
 * The tells a redraft would only fix mechanically, fixed in code instead: an
 * exclamation mark becomes a full stop, a long dash a comma (a hyphen between
 * two numbers, so a range stays a range), a semicolon a full stop, an ellipsis
 * a full stop, and markdown bold is dropped. No word changes, so no fact and no
 * number can. Returns { text, fixed: [what changed] }.
 */
export function mechanicalFix(text) {
  const before = String(text || '');
  const fixed = [];
  let t = before;
  const sub = (re, to, what) => {
    const next = t.replace(re, to);
    if (next !== t) fixed.push(what);
    t = next;
  };
  sub(/(\d)\s*[—–]\s*(\d)/g, '$1-$2', 'a dash between numbers');
  sub(/\s*[—–]\s*/g, ', ', 'a long dash');
  sub(/\?!+|!+\?/g, '?', 'an exclamation mark');
  sub(/!+/g, '.', 'an exclamation mark');
  sub(/\s*;\s*/g, '. ', 'a semicolon');
  sub(/\s*(?:\.\.\.|…)/g, '.', 'an ellipsis');
  sub(/\*\*/g, '', 'markdown');
  t = t.replace(/\s+([,.?])/g, '$1').replace(/,\s*([.?])/g, '$1').replace(/\.{2,}/g, '.').replace(/^[,\s]+/, '').replace(/ {2,}/g, ' ').trim();
  return { text: t, fixed: [...new Set(fixed)] };
}

// The closing questions every engagement-bait post ends with. A strong reviewer
// scores a caption that ends with one at 8 out of 10 (the cost comparison,
// docs/costs.md), and the post then needs a rewrite it may not have left.
const GENERIC_QUESTIONS = ['ידעתם את זה', 'ידעתם', 'הידעתם', 'מה דעתכם', 'מה אתם חושבים', 'למי זה יכול לעזור', 'כבר ניסיתם את זה', 'ניסיתם את זה', 'זוכרים את זה', 'מי לדעתכם', 'איזה מספר הכי הפתיע אתכם', 'מה הפתיע אתכם', 'שמרו את הפוסט', 'תייגו חבר', 'מסכימים'];

/** Is this closing question a generic engagement line, the same under any post? */
export function isGenericQuestion(q) {
  const n = normHe(q);
  return GENERIC_QUESTIONS.some((g) => n === normHe(g));
}
