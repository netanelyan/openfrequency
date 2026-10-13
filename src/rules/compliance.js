// Built-in compliance checks a pack can enable in pack.json `compliance`.
//
// These live in the engine rather than in a pack's rules.json because they are
// law, not taste: a pack must not be able to switch one off by editing a list.
// Pack validation also refuses a pack whose topics are financial and which does
// not enable `il-investment-advice`.

// ---------------------------------------------------------------- il-investment-advice
//
// HARD RULE 6. In Israel, advising someone on the merits of investing in a
// specific security, fund or financial asset is regulated (the Regulation of
// Investment Advice Law, 1995, and pension advice under its own law). Explaining
// how something works is education and is fine: what a study fund is, how
// management fees are capped, what a payslip line means. What is refused:
//
//   A. a recommending verb near something SPECIFIC: a named provider, a ticker, an
//      index, a named investment track, a named asset
//   B. a superlative pick: "the best fund", "the most worthwhile track"
//   C. a promise about returns: "guaranteed return", "about to jump"
//   D. an imperative to buy or sell an investment
//
// Hebrew matching uses letter lookarounds rather than \b, which does not work
// on Hebrew letters in JavaScript.

const L = '\\p{L}\\p{N}';
const word = (body) => `(?<![${L}])(?:ו|ש|ה|ב|ל|כש)?(?:${body})(?![${L}])`;

const RECOMMEND = word(
  [
    'כדאי\\s+ל(?:קנות|השקיע|בחור|עבור|העביר|הצטרף)',
    'שווה\\s+ל(?:קנות|השקיע|בחור|עבור)',
    'מומלץ\\s+ל(?:קנות|השקיע|בחור|עבור|העביר)',
    'אני\\s+ממליצ(?:ה|)',
    'אנחנו\\s+ממליצים',
    'ממליצים\\s+(?:על|ל)',
    'תקנו', 'קנו', 'תשקיעו', 'השקיעו', 'תבחרו', 'בחרו', 'תעבירו', 'העבירו', 'עברו\\s+ל', 'תעברו\\s+ל', 'תצטרפו', 'הצטרפו',
    'הבחירה\\s+הנכונה', 'אל\\s+תפספסו',
  ].join('|')
);

const PROVIDERS = [
  'מיטב', 'אלטשולר', 'הראל', 'מגדל', 'כלל', 'הפניקס', 'מנורה', 'מור', 'ילין\\s+לפידות', 'אנליסט', 'פסגות', 'IBI', 'אינפיניטי',
  'ואנגארד', 'Vanguard', 'בלקרוק', 'BlackRock', 'iShares', 'אינווסקו', 'Invesco', 'רובינהוד', 'אינטראקטיב', 'Interactive\\s+Brokers', 'eToro', 'איטורו',
];
const SPECIFIC = [
  ...PROVIDERS,
  'S&P\\s*500', 'S&P', 'אס\\s*אנד\\s*פי', 'נאסד"?ק', 'נאסדק', 'NASDAQ', 'ת"?א[-\\s]?(?:35|90|125)', 'דאו\\s+ג\'ונס', 'MSCI',
  'מסלול\\s+(?:מניות|מחקה|S&P|אג"?ח|הלכתי|כללי|סולידי|עוקב\\s+מדד)',
  'ביטקוין', 'Bitcoin', 'את\'ריום', 'קריפטו', 'מטבע\\s+דיגיטלי', 'זהב', 'דירה\\s+להשקעה', 'נדל"?ן\\s+להשקעה',
  '(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])(?=\\s|$|[,.])', // a ticker: SPY, VOO, QQQ, TSLA
];
const SPECIFIC_RE = new RegExp(`(?:${SPECIFIC.join('|')})`, 'u');

const SUPERLATIVE_PICK = new RegExp(
  word('(?:קרן|קופה|מסלול|מני(?:ה|ית)|תעודת\\s+סל|השקעה|פוליסה|קופת\\s+גמל)\\s+(?:\\S+\\s+){0,2}(?:הכי\\s+(?:טוב|טובה|משתלם|משתלמת|רווחי|רווחית|כדאי|כדאית)|מומלצ(?:ת|ים|ות)|מנצח(?:ת|))'),
  'u'
);

const RETURN_PROMISE = new RegExp(
  [
    'תשואה\\s+מובטחת', 'רווח\\s+(?:מובטח|בטוח)', 'בלי\\s+(?:שום\\s+)?סיכון', 'אי\\s+אפשר\\s+להפסיד', 'לא\\s+(?:יכולים|תוכלו)\\s+להפסיד',
    '(?:צפוי|צפויה|צפויות|צפויים|הולך|הולכת|הולכות|עומד|עומדת)\\s+ל(?:עלות|זנק|הכפיל|התפוצץ|טוס)',
    'guaranteed\\s+returns?', 'can\'t\\s+lose', 'to\\s+the\\s+moon',
  ].join('|'),
  'iu'
);

const BUY_SELL = new RegExp(
  word('(?:תקנו|קנו|תמכרו|מכרו|תשקיעו|השקיעו|buy|sell|invest\\s+in)') +
    '\\s+(?:את\\s+|ב|ל)?(?:\\S+\\s+){0,3}?(?:מני|קרן|קרנות|תעוד|אג"?ח|ביטקוין|קריפטו|זהב|ETF|stock|fund|shares)',
  'iu'
);

const RECOMMEND_RE = new RegExp(RECOMMEND, 'iu');

/** Words, keeping punctuation attached, for the proximity check. */
const tokens = (s) => String(s || '').split(/\s+/).filter(Boolean);

function nearby(text, a, b, within = 8) {
  const t = tokens(text);
  const hitsA = [];
  const hitsB = [];
  // Match on short windows so multi-word patterns still find a position.
  for (let i = 0; i < t.length; i++) {
    const win = t.slice(i, i + 3).join(' ');
    if (a.test(win)) hitsA.push(i);
    if (b.test(win)) hitsB.push(i);
  }
  return hitsA.some((i) => hitsB.some((k) => Math.abs(i - k) <= within));
}

export function investmentAdvice(text) {
  const s = String(text || '').replace(/[״]/g, '"').replace(/[׳]/g, "'");
  const out = [];
  if (nearby(s, RECOMMEND_RE, SPECIFIC_RE)) out.push('ממליץ על מוצר, מסלול, מדד או נכס מסוים');
  if (SUPERLATIVE_PICK.test(s)) out.push('בוחר "הכי טוב" מבין מוצרי השקעה');
  if (RETURN_PROMISE.test(s)) out.push('מבטיח או חוזה תשואה');
  if (BUY_SELL.test(s)) out.push('קורא לקנות או למכור השקעה');
  return out;
}

export const COMPLIANCE = {
  'il-investment-advice': {
    he: 'בלי ייעוץ השקעות',
    about: 'Israeli law: no recommending specific securities, funds, tracks or assets; no return promises',
    check: investmentAdvice,
  },
};

export const isCompliance = (id) => Object.prototype.hasOwnProperty.call(COMPLIANCE, id);

/** Does a pack's own description say it is about money? Then it must enable the check. */
export const FINANCIAL = /כסף|כספ|השקע|פנסי|חיסכון|חסכון|משכורת|תלוש|מיסוי|מס הכנסה|קרן|בורסה|ני"ע|ריבית|משכנתא|money|financ|invest|pension|saving|tax|stock|fund|mortgage/i;
