// The one place that calls a model for structured JSON. Every agent task and the judge go through here,
// so provider and model choice, refusal handling and errors stay consistent. Tests inject a fake client.
//
// Providers:
//   anthropic  Claude through the official SDK (ANTHROPIC_API_KEY or an "ant auth login" profile)
//   meta       Meta Model API, OpenAI-style chat completions at https://api.meta.ai/v1 (MODEL_API_KEY or LLAMA_API_KEY)
// DELOMU_LLM_PROVIDER picks one. Unset: anthropic when ANTHROPIC_API_KEY is set, else meta when a Meta key is set,
// else anthropic (which may still find a saved profile).

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_META_MODEL = 'muse-spark-1.3';
const META_BASE_URL = 'https://api.meta.ai/v1';
const META_TIMEOUT_MS = 180_000;
const META_RETRIES = 3;

const metaKey = env => env.MODEL_API_KEY || env.LLAMA_API_KEY;

export function pickProvider(env = process.env) {
  const chosen = env.DELOMU_LLM_PROVIDER?.trim().toLowerCase();
  if (chosen) {
    if (!['anthropic', 'meta'].includes(chosen)) throw new Error(`DELOMU_LLM_PROVIDER must be "anthropic" or "meta", not "${chosen}"`);
    return chosen;
  }
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return metaKey(env) ? 'meta' : 'anthropic';
}

export class AuthError extends Error {}

function anthropicJson(clientOrNull, model) {
  let anthropic = clientOrNull;
  return async ({ system, prompt, schema, effort, maxTokens }) => {
    anthropic ??= new Anthropic();
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal' };
    if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { ok: true, data: JSON.parse(text) };
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The model ids this key can use, for an actionable "model not found" message; null when the list fails.
async function metaModels(fetchImpl, base, key) {
  try {
    const res = await fetchImpl(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const ids = (await res.json()).data?.map(m => m.id).filter(id => typeof id === 'string' && !/contributor/i.test(id));
    return ids?.length ? ids : null;
  } catch {
    return null;
  }
}

function metaJson({ fetchImpl = fetch, env, model }) {
  const base = String(env.DELOMU_META_URL || META_BASE_URL).replace(/\/+$/, '');
  // Contributor models let Meta train on what is sent; customer material must never go there.
  if (/contributor/i.test(model)) throw new Error(`refusing Meta model "${model}": contributor models allow training on the data sent`);
  return async ({ system, prompt, schema, effort, maxTokens }) => {
    const key = metaKey(env);
    if (!key) throw new AuthError('no Meta Model API key (set MODEL_API_KEY or LLAMA_API_KEY)');
    const body = JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      reasoning_effort: effort,
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    });

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(META_TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt >= META_RETRIES) throw new Error(`Meta Model API unreachable: ${e.message}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new AuthError(`Meta Model API rejected the key (HTTP ${res.status}): authentication failed`);
      if ((res.status === 429 || res.status === 408 || res.status >= 500) && attempt < META_RETRIES) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(after > 0 ? after * 1000 : 500 * 2 ** attempt + Math.floor(Math.random() * 250));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let message = text.slice(0, 300);
        try { message = JSON.parse(text).error?.message ?? message; } catch {}
        if (res.status === 404) {
          const ids = await metaModels(fetchImpl, base, key);
          if (ids) message += ` "${model}" is not available to this key; set DELOMU_META_MODEL to one of: ${ids.slice(0, 12).join(', ')}.`;
        }
        throw new Error(`Meta Model API error (HTTP ${res.status}): ${message}`);
      }
      const choice = JSON.parse(text).choices?.[0];
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) return { ok: false, reason: 'refusal' };
      if (choice?.finish_reason === 'length') return { ok: false, reason: 'max_tokens' };
      return { ok: true, data: JSON.parse(choice?.message?.content ?? '') };
    }
  };
}

// createLlm({ client?, model?, provider?, env?, fetch? }).json({ system, prompt, schema, effort?, maxTokens? })
// returns { ok: true, data } or { ok: false, reason: 'refusal' | 'max_tokens' }.
// A Claude model name passed while the provider is meta falls back to the Meta default model.
export function createLlm({ client, model, provider, env = process.env, fetch: fetchImpl } = {}) {
  const chosen = provider ?? (client ? 'anthropic' : pickProvider(env));
  let name;
  let call;
  if (chosen === 'meta') {
    name = model && !model.startsWith('claude-') ? model : env.DELOMU_META_MODEL || DEFAULT_META_MODEL;
    call = metaJson({ fetchImpl, env, model: name });
  } else {
    name = model ?? DEFAULT_MODEL;
    call = anthropicJson(client, name);
  }
  return {
    provider: chosen,
    model: name,
    json: ({ system, prompt, schema, effort = 'medium', maxTokens = 16000 }) => call({ system, prompt, schema, effort, maxTokens }),
  };
}

// True when an error means "no usable model credentials", so callers can degrade instead of crash.
export function isAuthError(e) {
  return e instanceof AuthError || e instanceof Anthropic.AuthenticationError || /api key|credentials|authentication/i.test(e?.message ?? '');
}
