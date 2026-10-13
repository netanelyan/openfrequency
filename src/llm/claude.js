import Anthropic from '@anthropic-ai/sdk';
import { doorFetch } from '../core/net.js';

// The real Claude client, on the official SDK.
//
// The SDK is handed the engine's own doorFetch, so its requests pass through the
// same allowlist as everything else (src/core/net.js): POST /v1/messages and
// /v1/messages/batches on api.anthropic.com, and reads of our own batches.
//
// Every call asks for JSON against a schema (output_config.format). The system
// prompt is a list of blocks, stable first: the pack's voice, rules and formats,
// then the task's instructions, each with a cache breakpoint, and only then the
// user turn with what changes per post. A prefix that repeats is billed at the
// cache-read rate. Thinking is adaptive on the 5.x models and `effort` is the
// dial. A refusal on the tiers that take it is re-run server-side by the
// `fallbacks: "default"` mode on direct calls (the Batches API does not take
// the parameter); if the API ever answers that it does not take it, the client
// stops asking for the rest of the process.

const TAKES_EFFORT = /claude-(opus|sonnet|fable|haiku)-5/;
export const TAKES_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeError extends Error {
  constructor(message, code = 'claude') {
    super(message);
    this.name = 'ClaudeError';
    this.code = code;
  }
}

const cacheControl = (ttl) => (ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' });

/**
 * The Messages API body for one JSON call. `system` is a string (one cached
 * block) or [{ text, cache: '5m' | '1h' | false }], stable blocks first. At most
 * four breakpoints, and a 1-hour one never after a 5-minute one.
 */
export function requestParams({ system, user, image = null, schema, model, effort = 'medium', maxTokens = 8000 }) {
  const blocks = (Array.isArray(system) ? system : [{ text: system, cache: '5m' }]).filter((b) => b?.text);
  let marks = 0;
  let sawShort = false;
  const sys = blocks.map((b) => {
    const ttl = b.cache === '1h' && !sawShort ? '1h' : b.cache ? '5m' : null;
    if (ttl === '5m') sawShort = true;
    const mark = ttl && marks < 4;
    if (mark) marks++;
    return { type: 'text', text: b.text, ...(mark ? { cache_control: cacheControl(ttl) } : {}) };
  });
  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.type, data: image.buf.toString('base64') } },
        { type: 'text', text: user },
      ]
    : user;
  const format = { type: 'json_schema', schema };
  return {
    model,
    max_tokens: maxTokens,
    output_config: TAKES_EFFORT.test(model) ? { effort, format } : { format },
    system: sys,
    messages: [{ role: 'user', content }],
  };
}

/**
 * An upper bound on the prompt's tokens: its bytes (no token is shorter than a
 * byte), plus room for the framing and the schema instructions the API adds,
 * plus an image at its largest. The budget's ceiling for a call rests on this.
 */
export function promptTokenBound(params) {
  let bytes = Buffer.byteLength(JSON.stringify(params.system)) + Buffer.byteLength(JSON.stringify(params.output_config));
  let images = 0;
  for (const m of params.messages) {
    if (typeof m.content === 'string') bytes += Buffer.byteLength(m.content);
    else for (const c of m.content) c.type === 'image' ? images++ : (bytes += Buffer.byteLength(c.text || ''));
  }
  return bytes + 2000 + images * 6000;
}

/** A response to { data, usage, model }, or a ClaudeError that carries the usage it was billed for. */
export function readMessage(res, model) {
  const served = res.model || model;
  const fail = (msg, code) => Object.assign(new ClaudeError(msg, code), { usage: res.usage, model: served });
  if (res.stop_reason === 'refusal') throw fail('the model declined this request', 'refusal');
  if (res.stop_reason === 'max_tokens') throw fail('the model ran out of room before it finished', 'max_tokens');
  const text = res.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw fail('the model returned no text', 'empty');
  try {
    return { data: JSON.parse(text), usage: res.usage || {}, model: served };
  } catch {
    throw fail('the model returned something that is not JSON', 'not_json');
  }
}

function sdkFor({ apiKey, workspaceId }) {
  // A key that is not scoped to a workspace must name one on every request.
  const ws = String(workspaceId || '').trim();
  return new Anthropic({ apiKey, fetch: doorFetch, maxRetries: 2, timeout: 10 * 60_000, ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}) });
}

export function claudeClient({ apiKey = process.env.ANTHROPIC_API_KEY, workspaceId = process.env.ANTHROPIC_WORKSPACE_ID } = {}) {
  const sdk = sdkFor({ apiKey, workspaceId });
  let fallbackRefused = false;

  return {
    kind: 'claude',
    /** Does a direct call on this model go out with server-side fallbacks (and so may be billed at another model's rates)? */
    fallsBack: (model) => TAKES_FALLBACK.test(model) && !fallbackRefused,
    async json(req) {
      const body = req.params || requestParams(req);
      const withFallback = TAKES_FALLBACK.test(body.model) && !fallbackRefused;
      let res;
      try {
        res = withFallback
          ? await sdk.messages.create({ ...body, fallbacks: 'default' }, { headers: { 'anthropic-beta': FALLBACK_BETA } })
          : await sdk.messages.create(body);
      } catch (e) {
        if (!withFallback || e?.status !== 400 || !/fallback/i.test(String(e?.message || ''))) throw e;
        fallbackRefused = true;
        res = await sdk.messages.create(body);
      }
      return { ...readMessage(res, body.model), estimated: false, batch: false };
    },
  };
}

/** The Message Batches API, through the same door: create, poll, read results. */
export function claudeBatchApi({ apiKey = process.env.ANTHROPIC_API_KEY, workspaceId = process.env.ANTHROPIC_WORKSPACE_ID } = {}) {
  const sdk = sdkFor({ apiKey, workspaceId });
  return {
    async create(requests) {
      const b = await sdk.messages.batches.create({ requests });
      return { id: b.id, status: b.processing_status };
    },
    async retrieve(id) {
      const b = await sdk.messages.batches.retrieve(id);
      return { id: b.id, status: b.processing_status, counts: b.request_counts };
    },
    async *results(id) {
      for await (const r of await sdk.messages.batches.results(id)) yield r;
    },
  };
}
