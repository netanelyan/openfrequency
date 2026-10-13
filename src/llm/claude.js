import Anthropic from '@anthropic-ai/sdk';
import { doorFetch } from '../core/net.js';

// The real Claude client, on the official SDK.
//
// The SDK is handed the engine's own doorFetch, so its requests pass through the
// same allowlist as everything else (src/core/net.js): POST api.anthropic.com
// /v1/messages and nothing more.
//
// Every call asks for JSON against a schema (output_config.format) and caches the
// system prompt, which is the stable part. Thinking is on for the Claude 5 models
// and cannot be turned off; `effort` is the dial. A refusal on the Opus/Sonnet 5.5
// tier is re-run server-side by the `fallbacks: "default"` mode, which picks the
// fallback model by refusal category; if the API ever answers that it does not
// take the parameter, the client stops asking for the rest of the process.

const TAKES_EFFORT = /claude-(opus|sonnet|fable)-5/;
const TAKES_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeError extends Error {
  constructor(message, code = 'claude') {
    super(message);
    this.name = 'ClaudeError';
    this.code = code;
  }
}

export function claudeClient({ apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const sdk = new Anthropic({ apiKey, fetch: doorFetch, maxRetries: 2, timeout: 10 * 60_000 });
  let fallbackRefused = false;

  return {
    kind: 'claude',
    async json({ system, user, image = null, schema, model, effort = 'medium', maxTokens = 16000 }) {
      const content = image
        ? [
            { type: 'image', source: { type: 'base64', media_type: image.type, data: image.buf.toString('base64') } },
            { type: 'text', text: user },
          ]
        : user;
      const body = {
        model,
        max_tokens: maxTokens,
        output_config: TAKES_EFFORT.test(model) ? { effort, format: { type: 'json_schema', schema } } : { format: { type: 'json_schema', schema } },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
      };
      const withFallback = TAKES_FALLBACK.test(model) && !fallbackRefused;
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
      // The model that actually answered is what the tokens are billed at.
      const served = res.model || model;
      if (res.stop_reason === 'refusal') throw Object.assign(new ClaudeError('the model declined this request', 'refusal'), { usage: res.usage, model: served });
      if (res.stop_reason === 'max_tokens') throw Object.assign(new ClaudeError('the model ran out of room before it finished', 'max_tokens'), { usage: res.usage, model: served });
      const text = res.content?.find((b) => b.type === 'text')?.text;
      if (!text) throw Object.assign(new ClaudeError('the model returned no text', 'empty'), { usage: res.usage, model: served });
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Object.assign(new ClaudeError('the model returned something that is not JSON', 'not_json'), { usage: res.usage, model: served });
      }
      return { data, usage: res.usage || {}, model: served, estimated: false };
    },
  };
}
