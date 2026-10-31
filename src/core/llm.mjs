// The one place that calls Claude for structured JSON. Every agent task and the judge go through here,
// so model choice, refusal fallback and error handling stay consistent. Tests inject a fake client.

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export function createLlm({ client, model = DEFAULT_MODEL } = {}) {
  let anthropic = client;

  // Returns { ok: true, data } or { ok: false, reason } where reason is "refusal" or "max_tokens".
  async function json({ system, prompt, schema, effort = 'medium', maxTokens = 16000 }) {
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
  }

  return { json, model };
}

// True when an error means "no usable Anthropic credentials", so callers can degrade instead of crash.
export function isAuthError(e) {
  return e instanceof Anthropic.AuthenticationError || /api key|credentials|authentication/i.test(e?.message ?? '');
}
