import { askJson } from '../llm/index.js';
import { getBrowser } from '../render/render.js';

// The image screen: no blood, no injury close-ups, no fighter down and out, no
// watermark, no belt, no promotion's logo or poster. TikTok takes a post with
// any of them out of the For You feed, and the first two are not this engine's
// to publish anyway. Three layers, cheapest first:
//
//   1. words: the picture's own title and description name it ("bloody",
//      "knockout", "Getty Images", "championship belt"): refused, no call made.
//   2. pixels: a large share of deep, saturated red is how blood looks to a
//      counter, and also how red gloves and a red corner look. A counter cannot
//      tell them apart, so a red picture is never refused here: it goes to a
//      person, or to the model.
//   3. the model: Claude Haiku looks at the picture when there is a live client,
//      and its answer refuses or clears it.
//
// What none of them can clear goes to a person. Such a picture's post can be
// approved, but it is not published until someone has looked at the picture on
// the post's page (images.reviewed_at): "review" is the fallback, never "ok".

export const REFUSE_WORDS = [
  'blood', 'bloody', 'bloodied', 'bleeding', 'bleeds', 'injury', 'injured', 'injuries', 'wound', 'wounded', 'laceration', 'gash', 'cut eye', 'swollen', 'swelling',
  'broken nose', 'broken arm', 'broken leg', 'fracture', 'stretcher', 'unconscious', 'knocked out', 'knockout', 'k.o.', 'tko', 'out cold', 'concussion', 'gore', 'corpse', 'dead body',
  'watermark', 'getty images', 'gettyimages', 'shutterstock', 'alamy', 'zuffa', 'ap photo', 'reuters', 'afp', 'usa today sports', 'imagn',
  'belt', 'championship belt', 'title belt', 'poster', 'fight poster', 'promo', 'logo', 'octagon logo',
  'דם', 'מדמם', 'פציעה', 'פצוע', 'נוקאאוט', 'מעולף', 'אלונקה',
];

const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿.]+/g, ' ')} `;

/** The first refusing word in a picture's title and description, or null. */
export function refusingWord(text, extra = []) {
  const t = norm(text);
  return [...REFUSE_WORDS, ...extra].find((w) => t.includes(` ${String(w).toLowerCase()} `)) || null;
}

/**
 * The share of deep, saturated red pixels in an image, through the render
 * browser's canvas (nothing is fetched: the image is inlined).
 */
export async function redShare(buf, type = 'image/jpeg') {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 200, height: 200 } });
  await context.route('**/*', (route) => route.abort());
  const tab = await context.newPage();
  try {
    await tab.setContent(`<img id="i" src="data:${type};base64,${buf.toString('base64')}">`, { waitUntil: 'load' });
    return await tab.evaluate(() => {
      const img = document.getElementById('i');
      const W = 120;
      const H = Math.max(1, Math.round((W * img.naturalHeight) / Math.max(1, img.naturalWidth)));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gr, b] = [d[i], d[i + 1], d[i + 2]];
        if (r > 110 && r > gr * 1.9 && r > b * 1.7) red++;
      }
      return red / (W * H);
    });
  } finally {
    await context.close().catch(() => {});
  }
}

export const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    blood: { type: 'boolean' },
    injury: { type: 'boolean' },
    unconscious: { type: 'boolean' },
    watermark: { type: 'boolean' },
    logoOrBelt: { type: 'boolean' },
    sure: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['blood', 'injury', 'unconscious', 'watermark', 'logoOrBelt', 'sure', 'note'],
  additionalProperties: false,
};

const SCREEN_SYSTEM = `You check one photograph before it goes on a public social post. Answer only about what is visible.
- blood: any visible blood.
- injury: an injury close-up (a cut, swelling, a broken bone, a bruised face up close).
- unconscious: a person lying knocked out, limp or being attended to on the ground.
- watermark: a photo agency's or anyone's watermark or credit stamped on the picture.
- logoOrBelt: a promotion's or brand's logo as a main element, a championship belt, a poster or a broadcast graphic.
- sure: false when the picture is too small or unclear to tell.
- note: a few words on what decided it.`;

/** The red share above which a person (or the model) must look. Strict packs look sooner. */
export const RED_REVIEW = { strict: 0.04, standard: 0.12 };

/**
 * Screen one image before it is used. Returns { safety: 'ok'|'review'|'refused', why, red, model }.
 * meta: its title and description; strict: the pack asked for the strict screen (imagery.safety).
 */
export async function screenImage(ctx, { pack, buf, type, meta = '', postId = null }) {
  const strict = pack.meta.imagery?.safety === 'strict';
  const word = refusingWord(meta, pack.rules?.imageQueryBlock || []);
  if (word) return { safety: 'refused', why: `the picture's description says "${word}"` };
  let red = null;
  try {
    red = await redShare(buf, type);
  } catch (e) {
    ctx.log?.(`image screen: ${e.message}`);
  }
  const reddish = red == null || red >= RED_REVIEW[strict ? 'strict' : 'standard'];
  if (ctx.llm?.kind === 'claude' && (strict || reddish)) {
    try {
      const { data } = await askJson(ctx, { task: 'image-screen', role: 'judge', system: SCREEN_SYSTEM, user: 'The photograph:', image: { type, buf }, schema: SCREEN_SCHEMA, effort: 'low', maxTokens: 1500, tag: 'image-screen' });
      const bad = ['blood', 'injury', 'unconscious', 'watermark', 'logoOrBelt'].filter((k) => data[k]);
      if (bad.length) return { safety: 'refused', why: `the model saw: ${bad.join(', ')} (${data.note})`, red, model: data };
      if (data.sure) return { safety: 'ok', why: `the model saw nothing to refuse (${data.note})`, red, model: data };
      return { safety: 'review', why: `the model could not tell (${data.note})`, red, model: data };
    } catch (e) {
      ctx.log?.(`image screen model: ${e.message}`);
    }
  }
  if (strict) return { safety: 'review', why: red == null ? 'the picture could not be measured' : `a strict pack, and no model to look: red ${(red * 100).toFixed(1)}%`, red };
  if (reddish) return { safety: 'review', why: red == null ? 'the picture could not be measured' : `${(red * 100).toFixed(1)}% deep red: a person must look`, red };
  return { safety: 'ok', why: `no refusing word, ${(red * 100).toFixed(1)}% deep red`, red };
}
