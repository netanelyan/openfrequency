// The bot-score review as it was before phase 2 (git 8c33c1f, src/voice/review.js):
// one call that scored and rewrote. Kept for the comparison's "before" runs only.

const REWRITE_AT = 4;

export const REVIEW_SYSTEM_V1 = `You are a sharp Israeli in your twenties. You scroll TikTok and Instagram in Hebrew all day and you can smell a bot, a marketer or a ChatGPT text from the first line.

You get the texts of one slideshow post: the cover line, each slide, the caption. For each text, answer honestly: would you guess a bot wrote this?

- botScore: 0 means clearly a person wrote it, 10 means obviously a bot. Be strict: a text that is balanced, complete and polished, that sounds like a brochure or a school summary, that praises in general terms or opens with a stock phrase scores high. Translated-sounding Hebrew scores high.
- tells: only what gives it away, a few English words each ("stock opener", "translated Hebrew", "too polished", "brochure tone"). Empty when nothing does.
- factProblem: if the text states something its facts do not support, say what; else an empty string.
- rewrite: when botScore is ${REWRITE_AT} or more, the same text rewritten so a person would have written it, in natural spoken Hebrew, plural address, no exclamation marks, no long dashes. Keep every fact and every number exactly; add none. When below ${REWRITE_AT}, an empty string.`;

export const REVIEW_SCHEMA_V1 = {
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

/** The user turn, as v1 built it: the first 2,500 characters of the voice guide, the facts, the texts. */
export const reviewUserV1 = (pack, texts, facts) =>
  [
    `ACCOUNT: ${pack.meta.displayName}. Who is talking, from the account's voice guide:`,
    pack.voice.slice(0, 2500),
    '',
    'FACTS THE POST STANDS ON:',
    ...facts.map((f) => `- ${f.claim}`),
    '',
    'TEXTS:',
    ...texts.map((t, i) => `[${i}] (${t.where}) ${t.text}`),
  ].join('\n');
