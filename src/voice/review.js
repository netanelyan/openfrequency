import { askJson } from '../llm/index.js';
import { normHe, sentencesOf, tellsIn } from './tells.js';

// The second look: does this sound like a bot?
//
// A separate call with a different job from the drafting call. It reads the
// post's texts as a sharp Israeli in their twenties would and scores each from
// 0 (a person wrote it) to 10 (obviously a bot), names the tells, and rewrites
// any text at REWRITE_AT or more. A rewrite replaces the original only if it
// passes the same code checks (the caller decides that).
//
// With no API key the reviewer is a heuristic built from the same tells plus a
// few structural ones (every slide opening the same way, long sentences). It is
// labelled as such on the website: it can say a text has tells, it cannot say a
// text without them sounds human.

export const REWRITE_AT = 4;
export const BLOCK_AT = 6;

const SYSTEM = `You are a sharp Israeli in your twenties. You scroll TikTok and Instagram in Hebrew all day and you can smell a bot, a marketer or a ChatGPT text from the first line.

You get the texts of one slideshow post: the cover line, each slide, the caption. For each text, answer honestly: would you guess a bot wrote this?

- botScore: 0 means clearly a person wrote it, 10 means obviously a bot. Be strict: a text that is balanced, complete and polished, that sounds like a brochure or a school summary, that praises in general terms or opens with a stock phrase scores high. Translated-sounding Hebrew scores high.
- tells: only what gives it away, a few English words each ("stock opener", "translated Hebrew", "too polished", "brochure tone"). Empty when nothing does.
- factProblem: if the text states something its facts do not support, say what; else an empty string.
- rewrite: when botScore is ${REWRITE_AT} or more, the same text rewritten so a person would have written it, in natural spoken Hebrew, plural address, no exclamation marks, no long dashes. Keep every fact and every number exactly; add none. When below ${REWRITE_AT}, an empty string.`;

const SCHEMA = {
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
          factProblem: { type: 'string' },
          rewrite: { type: 'string' },
        },
        required: ['index', 'botScore', 'tells', 'factProblem', 'rewrite'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviews'],
  additionalProperties: false,
};

const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

/**
 * texts: [{ where, kind, text }]. facts: the post's facts, for factProblem.
 * Returns { reviewer, reviews: [{ botScore, tells, factProblem, rewrite }] }.
 */
export async function reviewTexts(ctx, { pack, texts, facts = [] }) {
  if (ctx.llm.kind !== 'claude') return { reviewer: 'heuristic', reviews: heuristicReview(texts, pack) };
  const user = [
    `ACCOUNT: ${pack.meta.displayName}. Who is talking, from the account's voice guide:`,
    pack.voice.slice(0, 2500),
    '',
    'FACTS THE POST STANDS ON:',
    ...facts.map((f) => `- ${f.claim}`),
    '',
    'TEXTS:',
    ...texts.map((t, i) => `[${i}] (${t.where}) ${t.text}`),
  ].join('\n');
  const { data } = await askJson(ctx, { task: 'review', role: 'review', system: SYSTEM, user, schema: SCHEMA, effort: 'low', maxTokens: 8000, expectOut: 2500, tag: 'review' });
  return {
    reviewer: 'claude',
    reviews: texts.map((_, i) => {
      const r = (data.reviews || []).find((x) => x.index === i) || {};
      return { botScore: clamp(r.botScore), tells: (r.tells || []).map(String).slice(0, 5), factProblem: String(r.factProblem || ''), rewrite: String(r.rewrite || '').trim() };
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
    return { botScore: clamp(score), tells, factProblem: '', rewrite: '' };
  });
}
