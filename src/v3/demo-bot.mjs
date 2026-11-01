// The sample customer's support bot, served by this server at /demo/support-bot so a new workspace can
// run a risk scan in minutes. Same answers as examples/mock-bot.mjs, including its three deliberate bugs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample');

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
