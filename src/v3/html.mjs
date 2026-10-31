// Server-rendered pages for the v3 web UI. Every interpolated value goes through esc(); forms that
// change state carry the session's CSRF token. The look follows the acceptance report (src/report.mjs).

import { esc } from '../report.mjs';

const STYLE = `
:root{--bg:#fff;--fg:#1a1a1f;--muted:#5d5d6b;--line:#e3e3ea;--card:#f7f7fa;--good:#1f7a4d;--bad:#b42318;--warn:#a15c07;--accent:#4b4bd6}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#ececf1;--muted:#a3a3b2;--line:#2c2c35;--card:#1b1b22;--good:#4cc38a;--bad:#f97066;--warn:#f5b546;--accent:#8f8ff5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
header{border-bottom:1px solid var(--line)}header div{max-width:920px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header .brand{font-weight:700;color:var(--fg);text-decoration:none}header .who{margin-left:auto;color:var(--muted);font-size:14px}
main{max-width:920px;margin:0 auto;padding:28px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}
a{color:var(--accent)}.muted{color:var(--muted)}.crumbs{font-size:14px;color:var(--muted);margin-bottom:6px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:600}
.card{border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:12px 0;background:var(--card)}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid currentColor}
.good{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input[type=text],input[type=password],textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
textarea{font:13px/1.5 ui-monospace,Consolas,monospace;min-height:160px}
button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.notice{border-left:4px solid var(--bad);padding:8px 12px;background:var(--card);margin:12px 0}
pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:10px;background:var(--bg);border-radius:6px;font:13px/1.5 ui-monospace,Consolas,monospace}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:640px){.grid{grid-template-columns:1fr}}`;

const VERDICT_CLASS = { accepted: 'good', not_accepted: 'bad', pending_review: 'warn' };
const STATUS_CLASS = { approved: 'good', rejected: 'bad', pending: 'warn' };

export const orgPath = org => `/orgs/${encodeURIComponent(org.id)}`;
const depPath = (org, name) => `${orgPath(org)}/deployments/${encodeURIComponent(name)}`;
const pct = x => `${Math.round(x * 1000) / 10}%`;

export function layout({ title, user, csrf, body }) {
  const who = user
    ? `<span class="who">${esc(user.email)}</span><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button>Sign out</button></form>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Delomu</title><style>${STYLE}</style></head><body>
<header><div><a class="brand" href="/">Delomu</a>${who}</div></header>
<main>${body}</main></body></html>
`;
}

export function loginPage({ csrf, error }) {
  return layout({
    title: 'Sign in',
    body: `<h1>Sign in</h1><p class="muted">Use your company's single sign-on, or an API key.</p>
${error ? `<div class="notice">${esc(error)}</div>` : ''}
<div class="grid">
<form class="card" method="get" action="/sso/start"><h2>Single sign-on</h2>
<label for="org">Organization (slug)</label><input type="text" id="org" name="org" required maxlength="60" autocomplete="organization">
<div class="row"><button class="primary">Continue with SSO</button></div></form>
<form class="card" method="post" action="/login"><h2>API key</h2><input type="hidden" name="csrf" value="${esc(csrf)}">
<label for="api_key">API key</label><input type="password" id="api_key" name="api_key" required autocomplete="off">
<div class="row"><button class="primary">Sign in</button></div></form>
</div>`,
  });
}

export function errorPage({ status, message, user, csrf }) {
  return layout({ title: 'Error', user, csrf, body: `<h1>${esc(status === 404 ? 'Not found' : 'Something is not right')}</h1><div class="notice">${esc(message)}</div><p><a href="/">Back to start</a></p>` });
}

export function orgsPage({ user, csrf, orgs }) {
  const rows = orgs.map(o => `<tr><td><a href="${esc(orgPath(o))}">${esc(o.name)}</a></td><td>${esc(o.kind)}${o.partner_org_id ? ' (managed)' : ''}</td><td><code>${esc(o.slug)}</code></td></tr>`).join('\n');
  return layout({ title: 'Organizations', user, csrf, body: `<h1>Organizations</h1>
<table><thead><tr><th>Name</th><th>Kind</th><th>Slug</th></tr></thead><tbody>${rows}</tbody></table>` });
}

export function deploymentsPage({ user, csrf, org, deployments, canAudit }) {
  const rows = deployments.map(d => `<tr><td><a href="${esc(depPath(org, d.name))}">${esc(d.name)}</a></td><td>${esc(d.created_at.slice(0, 10))}</td><td>${esc(d.created_by)}</td></tr>`).join('\n');
  return layout({ title: org.name, user, csrf, body: `<div class="crumbs"><a href="/">Organizations</a></div><h1>${esc(org.name)}</h1>
${canAudit ? `<p><a href="${esc(orgPath(org))}/audit">Audit log</a></p>` : ''}
<h2>Deployments (${deployments.length})</h2>
${deployments.length ? `<table><thead><tr><th>Name</th><th>Registered</th><th>By</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No deployments yet. Register one with POST /v1/orgs/{org}/deployments.</p>'}` });
}

export function deploymentPage({ user, csrf, org, name, runs, pending }) {
  const base = depPath(org, name);
  const rows = runs.map(r => `<tr><td><a href="${esc(base)}/runs/${esc(encodeURIComponent(r.id))}/report.html">${esc(r.id)}</a></td>
<td><span class="tag ${VERDICT_CLASS[r.summary.verdict] ?? ''}">${esc(r.summary.verdict.replace('_', ' '))}</span></td>
<td>${r.summary.pass} / ${r.summary.total} (${esc(pct(r.summary.pass_rate))})</td><td>${esc(r.judge)}</td></tr>`).join('\n');
  return layout({ title: name, user, csrf, body: `<div class="crumbs"><a href="/">Organizations</a> / <a href="${esc(orgPath(org))}">${esc(org.name)}</a></div>
<h1>${esc(name)}</h1><p><a href="${esc(base)}/drafts">Drafts</a> · ${pending} waiting for review</p>
<h2>Runs (${runs.length})</h2>
${runs.length ? `<table><thead><tr><th>Run</th><th>Verdict</th><th>Passed</th><th>Judge</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No runs yet.</p>'}` });
}

function draftCard(org, name, d, { csrf, canReview }) {
  const meta = `<div><span class="tag ${STATUS_CLASS[d.status] ?? ''}">${esc(d.status)}</span> <code>${esc(d.id)}</code> · ${esc(d.kind)} · step ${esc(d.step ?? '-')} · by ${esc(d.createdBy)}</div>
${d.rationale ? `<p>${esc(d.rationale)}</p>` : ''}`;
  const content = JSON.stringify(d.content, null, 2);
  if (d.status !== 'pending' || !canReview) {
    const outcome = d.reviewedBy ? `<p class="muted">${esc(d.status)} by ${esc(d.reviewedBy)}${d.edited ? ' (with edits)' : ''}${d.note ? `: ${esc(d.note)}` : ''}</p>` : '';
    return `<div class="card">${meta}${outcome}<pre>${esc(content)}</pre></div>`;
  }
  return `<form class="card" method="post" action="${esc(depPath(org, name))}/drafts/${esc(encodeURIComponent(d.id))}/review">${meta}
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label for="c-${esc(d.id)}">Content (edit before approving if needed)</label><textarea id="c-${esc(d.id)}" name="content">${esc(content)}</textarea>
<label for="n-${esc(d.id)}">Note</label><input type="text" id="n-${esc(d.id)}" name="note" maxlength="2000">
<div class="row"><button class="primary" name="decision" value="approve">Approve</button><button name="decision" value="reject">Reject</button></div></form>`;
}

export function draftsPage({ user, csrf, org, name, drafts, canReview, error }) {
  const pending = drafts.filter(d => d.status === 'pending');
  const done = drafts.filter(d => d.status !== 'pending').reverse();
  return layout({ title: `Drafts · ${name}`, user, csrf, body: `<div class="crumbs"><a href="/">Organizations</a> / <a href="${esc(orgPath(org))}">${esc(org.name)}</a> / <a href="${esc(depPath(org, name))}">${esc(name)}</a></div>
<h1>Drafts</h1><p class="muted">The agent proposes; a person approves, edits or rejects. Nothing changes until a draft is approved.</p>
${error ? `<div class="notice">${esc(error)}</div>` : ''}
<h2>Waiting for review (${pending.length})</h2>
${pending.length ? pending.map(d => draftCard(org, name, d, { csrf, canReview })).join('\n') : '<p class="muted">Nothing to review.</p>'}
<h2>Reviewed (${done.length})</h2>
${done.map(d => draftCard(org, name, d, { csrf, canReview })).join('\n') || '<p class="muted">None yet.</p>'}` });
}

export function auditPage({ user, csrf, org, events, audits }) {
  const evRows = events.map(e => `<tr><td>${esc(e.ts.replace('T', ' ').slice(0, 19))}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td>${esc(e.ip)}</td></tr>`).join('\n');
  const depRows = audits.map(a => `<tr><td>${esc(a.name)}</td><td>${a.entries.length}</td><td>${a.verify.ok
    ? '<span class="tag good">intact</span>'
    : `<span class="tag bad">broken at ${esc(a.verify.brokenAt)}</span> ${esc(a.verify.reason)}`}</td></tr>`).join('\n');
  return layout({ title: `Audit · ${org.name}`, user, csrf, body: `<div class="crumbs"><a href="/">Organizations</a> / <a href="${esc(orgPath(org))}">${esc(org.name)}</a></div>
<h1>Audit log</h1><p class="muted">Export everything as CSV with GET /v1/orgs/${esc(org.id)}/audit_events.csv.</p>
<h2>Deployment logs</h2>
${audits.length ? `<table><thead><tr><th>Deployment</th><th>Entries</th><th>Hash chain</th></tr></thead><tbody>${depRows}</tbody></table>` : '<p class="muted">No deployments.</p>'}
<h2>Organization events (latest ${events.length})</h2>
<table><thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>${evRows}</tbody></table>` });
}
