import { isSet } from '../core/env.js';
import { ceilingUsd, claudeCost, MODEL_RATES, release, reserve, settle, WORST } from '../budget/ledger.js';
import { claudeClient, requestParams, promptTokenBound } from './claude.js';
import { recordedClient } from './recorded.js';

// One entry point for every model call: the ceiling reserved before, the real
// cost recorded after.
//
// Which model does which job (docs/costs.md has the measurements behind it):
//   draft    the outline and the slides: Claude Sonnet 5.5
//   rewrite  a text the reviewer flagged, rewritten: Claude Sonnet 5.5
//   review   "does this sound like a bot, does it say more than its facts":
//            Claude Sonnet 5.5. Measured on the same drafts, Haiku scored
//            nearly every text 1 and found no fact problems, where Sonnet and
//            Opus both flagged the same stock lines and the same unsupported
//            claims. The review is the only check of the sentence around a
//            quoted number, so it gets the model that can do it; Opus found
//            nothing Sonnet missed, at twice the price.
//   judge    sorting and scoring: sources in onboarding, a trend's format: Claude Haiku 5.5
// Each is overridable in .env, because the right split is a question for the
// numbers, not for code.

export const ROLES = {
  draft: () => process.env.MODEL_DRAFT || 'claude-sonnet-5-5',
  rewrite: () => process.env.MODEL_REWRITE || process.env.MODEL_DRAFT || 'claude-sonnet-5-5',
  review: () => process.env.MODEL_REVIEW || 'claude-sonnet-5-5',
  judge: () => process.env.MODEL_JUDGE || 'claude-haiku-5-5',
};

/** The live client when a key is set and recordings are not forced; otherwise the recorded one. */
export function makeLlm(env = process.env) {
  const live = isSet('ANTHROPIC_API_KEY', env) && env.OF_LLM !== 'recorded';
  return live ? claudeClient({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID }) : recordedClient();
}

/**
 * Tokens in a string, approximately, for estimates when no usage block exists.
 * Hebrew costs more tokens per character than English; these ratios are a
 * conservative reading of what the current tokenizer does with each.
 */
export function estimateTokens(text) {
  const s = String(text || '');
  const he = (s.match(/[֐-׿]/g) || []).length;
  return Math.ceil(he / 2.2 + (s.length - he) / 3.6);
}

export function estimateUsd(model, inTokens, outTokens) {
  const r = MODEL_RATES[model] || WORST;
  return (inTokens * r.in + outTokens * r.out) / 1e6;
}

const textOf = (system) => (Array.isArray(system) ? system.map((b) => b?.text || '').join('\n') : String(system || ''));

/**
 * Ask for JSON. ctx: { db, pack, postId, llm }. req: { task, system, user, schema,
 * role, effort, maxTokens, image, meta, tag }.
 *
 * Before the call, its ceiling is reserved against the caps (ledger.js): the
 * prompt's bytes and max_tokens at the dearest rate the call can be billed at.
 * After it, the reservation is replaced by the real cost from the usage block,
 * at the batch rate when it went through a batch. A recorded answer has no usage
 * block; it is recorded as the estimate of what that exact prompt and answer
 * would have cost, and flagged as an estimate.
 */
export async function askJson(ctx, req) {
  const model = req.model || ROLES[req.role || 'draft']();
  const params = requestParams({ ...req, model });
  const batch = Boolean(ctx.llm.batch);
  const fallback = Boolean(ctx.llm.fallsBack?.(model));
  const tag = req.tag || req.task;
  const ceiling = ceilingUsd({ model, promptTokens: promptTokenBound(params), maxTokens: params.max_tokens, batch, fallback });
  const reservation = reserve(ctx.db, { pack: ctx.pack, postId: ctx.postId, usd: ceiling, tag });
  const row = { accountId: ctx.pack?.id ?? null, postId: ctx.postId, api: 'claude', tag, batch };

  let res;
  try {
    res = await ctx.llm.json({ ...req, model, params, reservation, meta: { ...(req.meta || {}), model, postId: ctx.postId, accountId: ctx.pack?.id ?? null } });
  } catch (e) {
    // A failed call that was billed (a refusal, a cut-off answer) still costs money.
    if (!e.settled) {
      if (e.usage) settle(ctx.db, reservation, { ...row, model: e.model || model, usd: claudeCost(e.usage, e.model || model, { batch }), usage: e.usage });
      else release(ctx.db, reservation);
    }
    throw e;
  }
  if (res.settled) return { data: res.data, usd: res.usd, estimated: false, model: res.model || model, usage: res.usage };
  let usd;
  if (res.usage) usd = claudeCost(res.usage, res.model || model, { batch });
  else {
    // A recorded answer: thinking and the answer, estimated from the answer's length.
    const inTokens = estimateTokens(textOf(req.system)) + estimateTokens(req.user) + estimateTokens(JSON.stringify(req.schema)) / 3 + (req.image ? 1600 : 0);
    usd = estimateUsd(model, inTokens, estimateTokens(JSON.stringify(res.data)) * 2.5);
  }
  settle(ctx.db, reservation, { ...row, model: res.model || model, usd, estimated: res.estimated, usage: res.usage || null });
  return { data: res.data, usd, estimated: res.estimated, model: res.model || model, usage: res.usage || null };
}
