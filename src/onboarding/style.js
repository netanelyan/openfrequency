import { deltaE, isHex, luminance } from '../render/color.js';
import { resolveStyle } from '../render/styles/tokens.js';

// Which slide style a new account is offered (src/render/styles): from what the account is about and from its
// brand's colours, and away from a customer in the same niche who already looks the same.
//
//   A  editorial card   prices, data, comparisons: finance, real estate, travel, tech and startups, B2B, products
//   B  poster           entertainment and energy: sports, combat sports, gaming, fitness, events, youth brands
//   C  split (light)    light, clean brands: fashion, beauty, food, home, wellness, shops, kids
//   D  native dark      stories and history: news, history, culture, "did you know" pages; and the default
//
// A brand with a light palette leans to C; a strongly dark one never gets C. When another account in the same
// niche already has the style and an accent close to this one's, this one gets its next-best style, so two
// customers never look alike. The owner can change it at any time (Accounts).

const NICHES = {
  A: ['כסף', 'פיננס', 'השקע', 'מניות', 'בורסה', 'נדל"ן', 'נדלן', 'דירה', 'דירות', 'משכנתא', 'ביטוח', 'מחיר', 'השוואה', 'נתונים', 'טיסות', 'תיירות', 'טיול', 'נסיעות', 'מלונות', 'טכנולוגיה', 'סטארטאפ', 'הייטק', 'מוצר', 'גאדג', 'קריפטו', 'עסקים', 'יזמ',
    'finance', 'money', 'invest', 'stock', 'real estate', 'mortgage', 'insurance', 'price', 'compare', 'data', 'travel', 'flight', 'hotel', 'tech', 'startup', 'founder', 'saas', 'b2b', 'product', 'gadget', 'crypto', 'ai', 'developer', 'builders'],
  B: ['ספורט', 'כדורגל', 'כדורסל', 'טניס', 'אגרוף', 'קרב', 'לחימה', 'גיימינג', 'משחקי', 'כושר', 'אימון', 'ריצה', 'אירועים', 'מסיב', 'הופעות', 'פסטיבל', 'נוער',
    'sport', 'football', 'soccer', 'basketball', 'nba', 'tennis', 'mma', 'ufc', 'boxing', 'fight', 'gaming', 'esports', 'fitness', 'gym', 'workout', 'running', 'events', 'party', 'festival', 'youth'],
  C: ['אופנה', 'יופי', 'איפור', 'טיפוח', 'אוכל', 'מתכונ', 'בישול', 'אפייה', 'מסעד', 'בית', 'עיצוב', 'בריאות', 'יוגה', 'תזונה', 'חנות', 'קמעונ', 'ילדים', 'הורות', 'תינוק',
    'fashion', 'beauty', 'makeup', 'skincare', 'food', 'recipe', 'cooking', 'baking', 'restaurant', 'home', 'interior', 'decor', 'wellness', 'yoga', 'nutrition', 'shop', 'store', 'retail', 'kids', 'parenting', 'baby'],
  D: ['חדשות', 'היסטוריה', 'תרבות', 'הידעת', 'עובדות', 'סיפור', 'סיפורים', 'מסתורין', 'ארכיאולוג',
    'news', 'history', 'culture', 'did you know', 'facts', 'story', 'stories', 'mystery', 'archaeology'],
};

// Ties go to the style that suits the most accounts, D last-but-default.
const ORDER = ['D', 'A', 'B', 'C'];

// Why, in the words the Accounts page shows.
const FITS = { A: 'החשבון עוסק במחירים, נתונים והשוואות', B: 'החשבון עוסק בספורט, באנרגיה ובאירועים', C: 'החשבון עוסק באופנה, אוכל, בית או ילדים', D: 'החשבון מספר סיפורים, היסטוריה ותרבות' };

/** How strongly an account's words point at each style: { A, B, C, D }. */
export function nicheScores(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const out = {};
  for (const [s, words] of Object.entries(NICHES)) out[s] = words.filter((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}`).test(t) : t.includes(w))).length;
  return out;
}

/** Light, dark or neither, from the brand's ground. */
export function brandTone(colors = {}) {
  if (!isHex(colors.bg)) return 'neutral';
  const l = luminance(colors.bg);
  return l > 0.6 ? 'light' : l < 0.02 ? 'dark' : 'neutral';
}

const aboutOf = (x) => [x.niche, x.audience, ...(x.topics || []), x.description, x.displayName].filter(Boolean).join(' ');

/** The niche an account belongs to, for the spread: the style its words point at most, or none. */
const nicheOf = (text) => {
  const sc = nicheScores(text);
  const best = ORDER.slice().sort((a, b) => sc[b] - sc[a])[0];
  return sc[best] ? best : null;
};

/**
 * The style to offer an account: { name, ranked, why }. `about`: { niche, audience, topics, description,
 * displayName }; `colors`: its brand's (theme.json colors); `existing`: the other packs.
 */
export function suggestStyle(about, colors = {}, existing = []) {
  const text = aboutOf(about);
  const sc = nicheScores(text);
  const tone = brandTone(colors);
  const why = [];
  const score = { ...sc };
  if (tone === 'light') {
    score.C += 2;
    why.push('המותג בהיר, והסגנון הבהיר מתאים לו');
  }
  let ranked = ORDER.slice().sort((a, b) => score[b] - score[a] || ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!Object.values(score).some(Boolean)) ranked = ['D', 'A', 'B', 'C'];
  if (tone === 'dark') {
    ranked = [...ranked.filter((s) => s !== 'C'), 'C'];
    why.push('המותג כהה מאוד, אז הסגנון הבהיר לא מוצע לו');
  }
  const top = ranked[0];
  why.unshift(sc[top] ? FITS[top] : 'אין סימן לכיוון אחר, אז ברירת המחדל');
  // The spread: a customer in the same niche with the same style and an accent this close already looks like this.
  const niche = nicheOf(text);
  const looksLike = (name) =>
    existing.some((p) => p.meta?.style?.name === name && niche && nicheOf(aboutOf({ ...p.meta, niche: (p.meta.topics || []).join(' ') })) === niche && deltaE(resolveStyle({ name }, colors.accent).colors.accent, resolveStyle(p.meta.style, p.theme?.colors?.accent).colors.accent) < 20);
  const free = ranked.filter((s) => !looksLike(s));
  const name = free[0] || ranked[0];
  if (name !== top) why.push(`לחשבון אחר באותו תחום כבר יש את סגנון ${top} בצבע קרוב, אז החשבון הזה מקבל את הבא בתור`);
  return { name, ranked: [name, ...ranked.filter((s) => s !== name)], why };
}
