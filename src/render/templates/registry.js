// The visual systems a pack can choose from, by name, and their variants.
//
// HARD RULE 2: no two accounts share a visual template. Pack validation refuses
// two packs on the same template and variant, so the number of accounts the
// engine can run without new code is the number of (template, variant) pairs
// below. A new pair is one file in this folder; a new account is never code.

export const TEMPLATES = {
  bubble: { variants: ['a', 'b'], about: 'conversation bubbles on a dark ground: a question, then what comes back' },
  scoreboard: { variants: ['a', 'b'], about: 'stadium scoreboard: huge condensed numerals, chalk lines, floodlight accent' },
  ledger: { variants: ['a', 'b'], about: 'paper and ink: a receipt card with a perforated edge and a numbers column' },
  editorial: { variants: ['a', 'b'], about: 'magazine page: big serif index numbers, a colour band, generous margins' },
  poster: { variants: ['a', 'b'], about: 'bold colour blocks split on a diagonal, one heavy display face' },
  card: { variants: ['a', 'b'], about: 'clean and dark: one bright accent, one big number or idea per slide, content on comparison cards' },
  corner: { variants: ['a', 'b'], about: "the fighter's corner: black and red, a grain over everything, hard diagonal cuts, tale-of-the-tape cards" },
  photocard: { variants: ['a', 'b', 'c'], about: 'a sharp photograph behind every slide, fading into dark; the facts on one dark card with a giant number' },
};

export const isTemplate = (name, variant = 'a') => Boolean(TEMPLATES[name]?.variants.includes(variant));

/** Every (template, variant) pair, in order: what onboarding picks an unused one from. */
export const ALL_LOOKS = Object.entries(TEMPLATES).flatMap(([t, { variants }]) => variants.map((v) => ({ template: t, variant: v })));
