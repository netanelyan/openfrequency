import { isSet } from '../core/env.js';
import { claudeCost, guard, MODEL_RATES, record, WORST } from '../budget/ledger.js';
import { claudeClient } from './claude.js';
import { recordedClient } from './recorded.js';

// One entry point for every model call: budget-guarded before, recorded after.
//
// Which model does which job. Every role defaults to Claude Opus 5.5 and each is
// overridable, because the right split is an empirical question that should be
// answered with numbers from the Results page, not by editing code.

export const ROLES = {
  draft: () => process.env.MODEL_DRAFT || 'claude-opus-5-5',
  review: () => process.env.MODEL_REVIEW || 'claude-opus-5-5',
  judge: () => process.env.MODEL_JUDGE || 'claude-opus-5-5',
};

/** The live client when a key is set and recordings are not forced; otherwise the recorded one. */
export function makeLlm(env = process.env) {
  const live = isSet('ANTHROPIC_API_KEY', env) && env.OF_LLM !== 'recorded';
  return live ? claudeClient({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID }) : recordedClient();
}

/**
 * Tokens in a string, approximately, for estimates when no usage block exists.
 * Hebrew costs more tokens per character than English; these ratios are a
 * conservative reading of what the Claude 5 tokenizer does with each.
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

/**
 * Ask for JSON. ctx: { db, pack, postId, llm }. req: { task, system, user, schema,
 * role, effort, maxTokens, image, meta, tag, expectOut }.
 *
 * The guard uses a ceiling: the whole prompt plus the expected output, with
 * thinking tokens allowed for. What is recorded is the real cost from the usage
 * block, or, for a recorded answer, the estimate of what that exact prompt and
 * answer would have cost, flagged as an estimate.
 */
export async function askJson(ctx, req) {
  const model = req.model || ROLES[req.role || 'draft']();
  const inTokens = estimateTokens(req.system) + estimateTokens(req.user) + (req.image ? 1600 : 0);
  const ceiling = estimateUsd(model, inTokens, req.expectOut || 4000);
  guard(ctx.db, { pack: ctx.pack, estimateUsd: ceiling });

  let res;
  try {
    res = await ctx.llm.json({ ...req, model, meta: { ...(req.meta || {}), model } });
  } catch (e) {
    // A failed call that was billed (a refusal, a cut-off answer) still costs money.
    if (e.usage) record(ctx.db, { accountId: ctx.pack?.id ?? null, postId: ctx.postId, api: 'claude', model: e.model || model, usd: claudeCost(e.usage, e.model || model), tag: req.tag || req.task });
    throw e;
  }
  const usd = res.usage
    ? claudeCost(res.usage, res.model)
    : estimateUsd(model, inTokens, estimateTokens(JSON.stringify(res.data)) * 2.5); // thinking + answer, for a recorded one
  record(ctx.db, { accountId: ctx.pack?.id ?? null, postId: ctx.postId, api: 'claude', model: res.model || model, usd, estimated: res.estimated, tag: req.tag || req.task });
  return { data: res.data, usd, estimated: res.estimated, model: res.model || model };
}
