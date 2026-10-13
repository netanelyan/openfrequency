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
const URL_LIKE = /https?:\/\/|www\.|\.(?:com|co\.il|org|net|io|ai|gov\.il)(?:\/|\b)/i;

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

export const LIMITS = {
  cover: { maxChars: 70, minWords: 3, maxWords: 11, emoji: 1, sentences: 2 },
  slideTitle: { maxChars: 60, emoji: 1, sentences: 2 },
  slideBody: { maxChars: 230, emoji: 1, sentences: 3 },
  caption: { maxChars: 320, emoji: 2, sentences: 4 },
};

/**
 * Every tell in one text, as { code, msg }. Empty means it reads like a person.
 * kind: 'cover' | 'slideTitle' | 'slideBody' | 'caption'
 * extra: the pack's own banned phrases (rules.json bannedPhrases)
 */
export function tellsIn(text, { kind = 'slideBody', extra = [] } = {}) {
  const out = [];
  const add = (code, msg) => out.push({ code, msg });
  const raw = String(text || '').trim();
  if (!raw) return kind === 'slideBody' ? [] : [{ code: 'empty', msg: 'empty' }];
  const norm = normHe(raw);
  const lim = LIMITS[kind] || LIMITS.slideBody;

  for (const t of [...CONNECTIVES, ...FORMAL, ...PRAISE, ...FILLER, ...GENDERED]) if (t.re.test(norm)) add('phrase', `${t.label}: "${t.p}"`);
  for (const p of extra) if (phrase(p).test(norm)) add('banned', `banned by the pack: "${p}"`);

  if (LONG_DASH.test(raw)) add('structure', 'a long dash (use a comma or a hyphen)');
  if (/;/.test(raw)) add('structure', 'a semicolon');
  if (/!/.test(raw)) add('register', 'an exclamation mark');
  if (/\.\.\.|…/.test(raw)) add('structure', 'trails off with an ellipsis');
  if (ARTEFACTS.test(raw)) add('artefact', 'markdown or a template placeholder left in the text');
  if (URL_LIKE.test(raw)) add('url', 'a web address (a link in a post is a demotion and is never tappable)');
  const emoji = (raw.match(EMOJI) || []).length;
  if (emoji > lim.emoji) add('register', `${emoji} emoji, ${lim.emoji} at most`);
  if (kind === 'caption') {
    // In a caption the colon of a brochure ("שלושה דברים: א, ב, ג") is a tell.
    const colon = sentencesOf(raw).some((s) => {
      const at = s.replace(/\d:\d/g, '').indexOf(':');
      return at >= 0 && s.slice(0, at).trim().split(/\s+/).length > 4;
    });
    if (colon) add('structure', 'a colon after a whole clause: say it as a sentence');
  }

  const sentences = sentencesOf(raw);
  for (const s of sentences) {
    const parts = s.split(/,|\s+ו(?=\S)/).map((p) => p.trim()).filter(Boolean);
    if (s.split(',').length >= 4 && parts.filter((p) => p.split(/\s+/).length <= 3).length >= 4) {
      add('structure', 'a list of four or more things in one sentence');
      break;
    }
  }
  const last = normHe(sentences[sentences.length - 1] || '');
  if (sentences.length > 1 && MORAL.test(last)) add('structure', 'ends by summing up or drawing a moral');

  const len = raw.replace(/\s+/g, ' ').length;
  if (len > lim.maxChars) add('length', `${len} characters, ${lim.maxChars} at most`);
  if (sentences.length > lim.sentences) add('length', `${sentences.length} sentences, ${lim.sentences} at most`);
  if (kind === 'cover') {
    // Words as a reader counts them: ש-Gemini is one word, not a prefix and a name.
    const words = raw.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    if (words < lim.minWords || words > lim.maxWords) add('length', `${words} words on the cover, ${lim.minWords} to ${lim.maxWords}`);
  }
  if (hebrewShare(raw) < 0.5) add('language', 'mostly not Hebrew');
  return out;
}
