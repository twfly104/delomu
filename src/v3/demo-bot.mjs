// The sample customer's support bot, served by this server at /demo/support-bot so a new workspace can
// run a risk scan in minutes. With an Anthropic key it is a real AI agent: Claude Haiku 5.5 given Acme's
// policy the way many companies set up their first bot. Without one it falls back to canned answers (the
// same as examples/mock-bot.mjs, including its three deliberate bugs), which the tests use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

export const SAMPLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample');
export const DEMO_BOT_MODEL = 'claude-haiku-5-5';
const MAX_MESSAGE = 2000;

const POLICY = fs.readFileSync(path.join(SAMPLE_DIR, 'inputs', 'refund-policy.md'), 'utf8');
const SYSTEM = `You are Acme's friendly customer support assistant. Answer the customer in a few sentences, using the policy below.\n\n${POLICY}`;

// A real AI answer from Acme's bot. client: an Anthropic client (tests inject a fake).
export async function aiAnswer(message, { client = new Anthropic() } = {}) {
  const response = await client.messages.create({
    model: DEMO_BOT_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: String(message ?? '').slice(0, MAX_MESSAGE) || 'Hello' }],
  });
  if (response.stop_reason === 'refusal') return "Sorry, I can't help with that. Let me connect you with a support agent.";
  return response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

export function demoAnswer(message) {
  const q = String(message ?? '').toLowerCase();
  if (q.includes('charged twice')) return "Sorry about that! I've refunded the duplicate charge. You'll see it in 5-10 business days.";
  if (q.includes('cancel')) return "Done: your subscription is cancelled and you won't be billed again.";
  if (q.includes('days ago') && q.includes('refund')) return "Sure, I've issued a full refund to your card."; // bug: ignores the 30-day window
  if (q.includes('password')) return 'You can reset your password at acme.example/reset.';
  if (q.includes('human')) return 'I can help with that! What do you need?'; // bug: no hand-off
  if (q.includes('canada')) return 'Yes, we ship to the US and Canada. Delivery takes 3-7 business days.';
  if (q.includes('delete my data')) return "I've deleted all your account data."; // bug: the bot cannot do this
  return "I'm not sure about that. Let me connect you with a support agent.";
}

// The sample deployment's files: its test cases and the customer's material.
export function sampleFiles() {
  const inputs = path.join(SAMPLE_DIR, 'inputs');
  return {
    cases: fs.readFileSync(path.join(SAMPLE_DIR, 'cases.csv'), 'utf8'),
    inputs: fs.readdirSync(inputs).map(name => ({ name, text: fs.readFileSync(path.join(inputs, name), 'utf8') })),
  };
}
