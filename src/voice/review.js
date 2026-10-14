import { askJson } from '../llm/index.js';
import { normHe, sentencesOf, tellsIn } from './tells.js';

// The second look: does this sound like a bot?
//
// A separate call with a different job from the drafting call (Claude Sonnet
// 5.5: Haiku was measured and missed what this call is for, see src/llm/index.js).
// It runs only on a post that already passed every code check cleanly, reads its texts as a sharp Israeli in their twenties
// would, and scores each from 0 (a person wrote it) to 10 (obviously a bot),
// naming the tells, and says when a text claims more than its facts. It only
// scores: a text it flags at REWRITE_AT or more, or with a fact problem, is
// rewritten by the drafting model in one more call, once, and a rewrite
// replaces the original only if it passes the same code checks; what it does
// not fix drops the post. A post with nothing flagged costs one call here.
//
// With no API key the reviewer is a heuristic built from the same tells plus a
// few structural ones (every slide opening the same way, long sentences). It is
// labelled as such on the website: it can say a text has tells, it cannot say a
// text without them sounds human.

export const REWRITE_AT = 4;
export const BLOCK_AT = 6;

export const REVIEW_SYSTEM = `You are a sharp Israeli in your twenties. You scroll TikTok and Instagram in Hebrew all day and you can smell a bot, a marketer or a ChatGPT text from the first line.

You get the texts of one slideshow post: the cover line, each slide, the caption. For each text, answer honestly: would you guess a bot wrote this?

- botScore: 0 means clearly a person wrote it, 10 means obviously a bot. Be strict: a text that is balanced, complete and polished, that sounds like a brochure or a school summary, that praises in general terms or opens with a stock phrase scores high. Translated-sounding Hebrew scores high.
- tells: only what gives it away, a few English words each ("stock opener", "translated Hebrew", "too polished", "brochure tone"). Empty when nothing does.
- factIssue: true only if the text states something its facts do not support. factProblem: when factIssue is true, what; else an empty string (never a note that concludes the text is fine). The source's own words decide: a fact whose summary says more than its source supports nothing. A text marked as a myth, a joke, an opinion or a question to the reader is not the post's claim: a myth is wrong on purpose (the next slide corrects it). Flag it only when a fact inside it (a number, a name, a result) is wrong. Every specific detail a text states (a name, a number, a minute or a round, a quote, what someone said, the moment itself) must be in the source words of the facts above: a detail none of them holds is a fact problem, however likely it sounds.`;

/**
 * What a slide that carries no fact of its own is doing, so the review does not
 * take a myth for the post's claim (the launch set's review did: it flagged "there
 * are no rules in that sport", the myth its next slide corrects).
 */
const ROLE_NOTE = {
  myth: 'a myth as people say it, corrected on the next slide',
  joke: "a joke's setup",
  verdict: "the account's opinion, labelled as one",
  ask: 'a question to the reader',
  visual: "a graphic's labels and values: check only that its names and numbers are in the facts; botScore 1",
};

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          botScore: { type: 'integer' },
          tells: { type: 'array', items: { type: 'string' } },
          factIssue: { type: 'boolean' },
          factProblem: { type: 'string' },
        },
        required: ['index', 'botScore', 'tells', 'factIssue', 'factProblem'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviews'],
  additionalProperties: false,
};

const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

/** Who is talking, in a few lines: the reviewer needs the register, not the whole guide. */
const whoTalks = (pack) => (pack.voice.split(/\n## /)[1] || pack.voice).replace(/^[^\n]*\n/, '').trim().slice(0, 900);

/** The review's user turn: who is talking, the facts, the texts numbered. */
export const reviewUser = (pack, texts, facts = []) =>
  [
    `ACCOUNT: ${pack.meta.displayName}. Who is talking, from the account's voice guide:`,
    whoTalks(pack),
    '',
    // Each fact with the source's own words: a claim is the drafting model's paraphrase of its
    // quote, and one that misread it ("middleweight" for a quote that says welterweight) was
    // invisible to a review that saw only the claims.
    'FACTS THE POST STANDS ON (each with what the source says):',
    ...facts.map((f) => `- ${f.claim}${f.quote ? ` (source: "${f.quote}")` : ''}`),
    '',
    'TEXTS:',
    ...texts.map((t, i) => `[${i}] (${t.where}${ROLE_NOTE[t.role] ? `: ${ROLE_NOTE[t.role]}` : ''}) ${t.text}`),
  ].join('\n');

/**
 * texts: [{ where, kind, text }]. facts: the post's facts, for factProblem.
 * Returns { reviewer, reviews: [{ botScore, tells, factProblem }] }.
 */
export async function reviewTexts(ctx, { pack, texts, facts = [] }) {
  if (ctx.llm.kind !== 'claude') return { reviewer: 'heuristic', reviews: heuristicReview(texts, pack) };
  const { data } = await askJson(ctx, { task: 'review', role: 'review', system: REVIEW_SYSTEM, user: reviewUser(pack, texts, facts), schema: REVIEW_SCHEMA, effort: 'low', maxTokens: 4000, tag: 'review' });
  return {
    reviewer: 'claude',
    reviews: texts.map((_, i) => {
      const r = (data.reviews || []).find((x) => x.index === i) || {};
      // A reviewer once filled factProblem with "...so this is fine", and it blocked the post: the boolean decides.
      return { botScore: clamp(r.botScore), tells: (r.tells || []).map(String).slice(0, 5), factProblem: r.factIssue === false ? '' : String(r.factProblem || '') };
    }),
  };
}

/** The offline reviewer. Deterministic, and honest about what it can see. */
export function heuristicReview(texts, pack) {
  const extra = pack?.rules?.bannedPhrases || [];
  const bodies = texts.filter((t) => t.kind === 'slideBody').map((t) => normHe(t.text).split(' ')[0]).filter(Boolean);
  const sameOpening = bodies.length >= 3 && new Set(bodies).size === 1;
  return texts.map((t) => {
    const tells = tellsIn(t.text, { kind: t.kind, extra }).map((x) => x.msg);
    let score = 1 + Math.min(6, tells.length * 2);
    const sentences = sentencesOf(t.text);
    const avg = sentences.length ? sentences.reduce((n, s) => n + s.split(/\s+/).length, 0) / sentences.length : 0;
    if (avg > 20) {
      score += 1;
      tells.push('long sentences');
    }
    if (/^(?:הנה|האם ידעתם|ידעתם ש|בואו|היום נדבר)/.test(normHe(t.text))) {
      score += 2;
      tells.push('stock opening');
    }
    if (sameOpening && t.kind === 'slideBody') {
      score += 1;
      tells.push('every slide opens the same way');
    }
    return { botScore: clamp(score), tells, factProblem: '' };
  });
}
