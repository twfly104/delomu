// Design partner applications from the public /design-partners page. Each one is stored first, so nothing is
// lost when no notifier is set; then the operator is told by Slack-style webhook (GRAPIM_LEADS_WEBHOOK) and by
// email through Resend (GRAPIM_LEADS_TO, when sign-in email is configured). The operator reads them at
// /operator/applications when signed in with an email listed in GRAPIM_OPERATOR_EMAILS.
import crypto from 'node:crypto';

export const COHORT_SIZE = 5;
export const TIMING = [['now', 'This month'], ['soon', 'In the next 1 to 3 months'], ['later', 'Later']];
// The demand question Grapim is built on: did the client's legal or security review hold up the last go-live?
// Every applicant answers it, so the answer is counted, not guessed (research_notes/biggest-pain-2026.md).
export const REVIEW = [['weeks', 'Yes, by weeks'], ['days', 'Yes, by days'], ['no', 'No, they trusted us'], ['unsure', 'Not sure']];

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Checks a submitted form. Returns { values, error }.
export function readApplication(form) {
  const values = {
    name: clean(form.name, 80),
    email: clean(form.email, 254).toLowerCase(),
    company: clean(form.company, 80),
    website: clean(form.website, 200),
    timing: TIMING.some(([k]) => k === form.timing) ? form.timing : '',
    review: REVIEW.some(([k]) => k === form.review) ? form.review : '',
    note: String(form.note ?? '').trim().slice(0, 2000),
  };
  if (!values.name) return { values, error: 'Enter your name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return { values, error: 'Enter a work email address.' };
  if (!values.company) return { values, error: 'Enter your company.' };
  if (!values.timing) return { values, error: 'Choose when your next client goes live.' };
  if (!values.review) return { values, error: 'Say whether a client’s legal or security review held up your last go-live.' };
  if (values.website && !/^https?:\/\//i.test(values.website)) values.website = `https://${values.website}`;
  return { values, error: null };
}

export function saveApplication(db, values, now = new Date()) {
  const id = `app_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare('INSERT INTO partner_applications (id, name, email, company, website, timing, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, values.name, values.email, values.company, values.website, values.timing, [values.review ? `Last client's legal/security review held up go-live: ${(REVIEW.find(([k]) => k === values.review) ?? ['', values.review])[1]}.` : '', values.note].filter(Boolean).join('\n\n'), now.toISOString());
  return id;
}

export const listApplications = db => db.prepare('SELECT * FROM partner_applications ORDER BY created_at DESC').all();

const summary = v => `New design partner application: ${v.name} (${v.email}), ${v.company}${v.website ? ` ${v.website}` : ''}. Next client: ${(TIMING.find(([k]) => k === v.timing) ?? ['', v.timing])[1]}.${v.review ? ` Legal/security review held up the last go-live: ${(REVIEW.find(([k]) => k === v.review) ?? ['', v.review])[1]}.` : ''}${v.note ? `\n\n${v.note}` : ''}`;

// Tells the operator. Failures are logged, never shown to the applicant: the application is already stored.
export async function notifyApplication(ctx, values) {
  const text = summary(values);
  const hook = ctx.env?.GRAPIM_LEADS_WEBHOOK;
  if (hook) {
    try { const res = await (ctx.fetch ?? fetch)(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); if (!res.ok) throw new Error(`webhook answered ${res.status}`); } catch (e) { ctx.log?.(`lead webhook failed: ${e.message}`); }
  }
  const to = ctx.env?.GRAPIM_LEADS_TO;
  if (to && ctx.emailLogin) {
    const message = { from: ctx.emailLogin.from, to: [to], reply_to: values.email, subject: `Design partner: ${values.company}`, text };
    try {
      if (ctx.sendEmail) await ctx.sendEmail(message);
      else { const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${ctx.emailLogin.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(message) }); if (!res.ok) throw new Error(`email provider answered ${res.status}`); }
    } catch (e) { ctx.log?.(`lead email failed: ${e.message}`); }
  }
}

export const isOperator = (env, email) => String(env?.GRAPIM_OPERATOR_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(String(email ?? '').toLowerCase());
