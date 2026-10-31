// Server-rendered pages for the web app. Every interpolated value goes through esc(); forms that change
// state carry the session's CSRF token. Pages work without JavaScript; one small script (hashed into the
// CSP by web.mjs) only marks a pressed button as busy during long actions such as test runs.

import crypto from 'node:crypto';
import { esc } from '../report.mjs';
import { TOKENS } from '../theme.mjs';
import { icon } from './icons.mjs';
import { draftCard, reviewedRow } from './drafts-view.mjs';
import { STEPS } from './insights.mjs';

export const BUSY_SCRIPT = "document.addEventListener('submit',function(e){var b=e.submitter;if(!b||!b.dataset.busy)return;setTimeout(function(){b.disabled=true;b.setAttribute('aria-busy','true');b.textContent=b.dataset.busy;},0);});";
export const BUSY_SCRIPT_HASH = `sha256-${crypto.createHash('sha256').update(BUSY_SCRIPT).digest('base64')}`;

const STYLE = `${TOKENS}
.i{flex:none;display:block}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.strong{font-weight:600;color:var(--text)}.nowrap{white-space:nowrap}
.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--rail) 239px,var(--line) 239px 240px,transparent 240px)}
.rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:20px;padding:16px 12px;overflow-y:auto}
.brand{display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:17px;font-weight:600;letter-spacing:-0.03em;color:var(--text)}
.brand:hover{text-decoration:none}
.nav{display:flex;flex-direction:column;gap:1px}
.nav-title{padding:0 10px 6px;font-size:12px;font-weight:500;color:var(--text-3)}
.nav a{display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:var(--r-sm);color:var(--text-2);font-weight:500}
.nav a:hover{background:var(--hover);color:var(--text);text-decoration:none}
.nav a[aria-current=page]{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.nav .count{margin-left:auto;min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:var(--accent);color:var(--on-accent);font-size:11px;font-weight:600;display:grid;place-items:center}
.nav .org-kind{margin-left:auto;font-size:11px;color:var(--text-3)}
.rail-foot{margin-top:auto;border-top:1px solid var(--line);padding:12px 8px 0;display:flex;align-items:center;gap:8px}
.rail-foot .who{min-width:0;flex:1;font-size:13px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-btn{width:30px;height:30px;display:grid;place-items:center;border-radius:var(--r-sm);border:0;background:transparent;color:var(--text-2);cursor:pointer}
.icon-btn:hover{background:var(--hover);color:var(--text)}
.topbar{height:52px;display:flex;align-items:center;gap:8px;padding:0 32px;border-bottom:1px solid var(--line);background:var(--surface);font-size:13px}
.topbar a{color:var(--text-2)}.topbar a:hover{color:var(--text);text-decoration:none}.topbar .sep{color:var(--line-strong)}.topbar .here{color:var(--text);font-weight:500}
.content{max-width:1160px;margin:0 auto;padding:28px 32px 72px}
.page-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.page-head .title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.page-head .sub{margin-top:4px;color:var(--text-2)}
.page-head .actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.panel+.panel,.stack>*+*{margin-top:16px}
.panel-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line)}
.panel-head .aside{margin-left:auto;font-size:13px}
.panel-body{padding:16px}
.panel table th:first-child,.panel table td:first-child{padding-left:16px}.panel table th:last-child,.panel table td:last-child{padding-right:16px}
.grid-2{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
.btn{height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-sm);border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font:500 13px var(--font);cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s}
.btn:hover{background:var(--hover);text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn:disabled{opacity:.6;cursor:progress}
.btn.block{width:100%;justify-content:center;height:36px}
.field{display:block;margin-bottom:16px}.field>span{display:block;font-size:13px;font-weight:500;margin-bottom:6px}
.hint{margin-top:6px;font-size:12.5px;color:var(--text-3)}
input[type=text],input[type=password],input[type=url],input[type=number],select,textarea{width:100%;height:34px;padding:0 10px;border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font:14px var(--font);transition:border-color .15s,box-shadow .15s}
select{padding-right:28px}
input:hover,select:hover,textarea:hover{border-color:var(--text-3)}
input:focus-visible,select:focus-visible,textarea:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
input::placeholder,textarea::placeholder{color:var(--text-3)}
textarea{height:auto;min-height:180px;padding:10px;font:12.5px/1.55 var(--mono);resize:vertical}
input[type=file]{font:13px var(--font);color:var(--text-2)}
input[type=file]::file-selector-button{height:30px;margin-right:10px;padding:0 12px;border-radius:var(--r-sm);border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font:500 13px var(--font);cursor:pointer}
.choice{display:flex;gap:8px}.choice label{flex:1;display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line-strong);border-radius:var(--r-sm);cursor:pointer}
.choice label:has(input:checked){border-color:var(--accent);background:var(--accent-weak)}
.choice input{margin-top:3px;accent-color:var(--accent)}
.check{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--text-2)}.check input{accent-color:var(--accent);margin:0}
.notice{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;margin-bottom:16px;border-radius:var(--r-sm);background:var(--bad-weak);color:var(--bad);font-weight:500}
.notice.good{background:var(--good-weak);color:var(--good)}
.notice .i{margin-top:2px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:4px 0 24px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs a{display:flex;align-items:center;gap:6px;padding:10px 10px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--text-2);font-weight:500;white-space:nowrap}
.tabs a:hover{color:var(--text);text-decoration:none}
.tabs a[aria-current=page]{color:var(--text);border-bottom-color:var(--text)}
.tabs .n{font-size:12px;color:var(--text-3)}.tabs .n.hot{color:var(--accent-text);font-weight:600}
.track{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));padding:18px 16px 16px}
.step{position:relative;padding:26px 12px 0 0}
.step::before{content:"";position:absolute;top:8px;left:18px;right:6px;height:2px;border-radius:2px;background:var(--line)}
.step:last-child::before{display:none}
.step.done::before{background:var(--good)}
.dot{position:absolute;top:0;left:0;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--surface);border:2px solid var(--line-strong);color:var(--surface)}
.step.done .dot{background:var(--good);border-color:var(--good)}
.step.review .dot{border-color:var(--accent);background:var(--accent-weak)}
.step.review .dot::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.step.attention .dot{border-color:var(--bad);background:var(--bad-weak)}
.step.attention .dot::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--bad)}
.step .label{font-size:13px;font-weight:500}
.step .detail{font-size:12px;color:var(--text-3)}
.step.review .detail{color:var(--accent-text)}.step.attention .detail{color:var(--bad)}
.mini{display:flex;gap:3px;align-items:center}
.mini i{width:14px;height:5px;border-radius:3px;background:var(--line)}
.mini i.done{background:var(--good)}.mini i.review{background:var(--accent)}.mini i.attention{background:var(--bad)}
.stage{display:flex;flex-direction:column;gap:5px}.stage .lbl{font-size:12.5px;color:var(--text-2)}
.rows a.row{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);color:inherit}
.rows a.row:last-child{border-bottom:0}
.rows a.row:hover{background:var(--hover);text-decoration:none}
.rows .row .what{min-width:0;flex:1}
.rows .row .what p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rows .row .go{color:var(--text-3)}
.emptystate{padding:28px 16px;text-align:center;color:var(--text-2)}
.emptystate .strong{display:block;margin-bottom:4px}
.result{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.result .rate{font-size:28px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.chart{display:block;width:100%;height:auto;margin-top:16px}
.chart .bar{fill:var(--line-strong)}.chart .bar.good{fill:var(--good)}.chart .bar.bad{fill:var(--bad)}.chart .bar.last{opacity:1}
.chart .goal{stroke:var(--text-3);stroke-dasharray:3 3}
.chart text{fill:var(--text-3);font:11px var(--font)}
.failing li{padding:10px 16px;border-bottom:1px solid var(--line)}.failing code{display:block;margin-bottom:2px;color:var(--text)}.failing li:last-child{border-bottom:0}
.failing{list-style:none;margin:0;padding:0}
.next{display:flex;flex-direction:column;gap:12px}
.feed{list-style:none;margin:0;padding:4px 0}.feed li{display:flex;gap:10px;padding:8px 16px;font-size:13px}
.feed .t{margin-left:auto;color:var(--text-3);white-space:nowrap}
.who-chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--sunken);font-size:12px;color:var(--text-2);white-space:nowrap}
.who-chip.agent{background:var(--accent-weak);color:var(--accent-text)}
.chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--sunken);font-size:12px;color:var(--text-2);margin:2px 0}
.chip.good{background:var(--good-weak);color:var(--good)}.chip.bad{background:var(--bad-weak);color:var(--bad)}.chip.tag{background:transparent;border:1px solid var(--line);color:var(--text-3)}
.draft{overflow:hidden}
.draft-head{display:flex;align-items:flex-start;gap:12px;padding:16px;border-bottom:1px solid var(--line)}
.draft-head .badge{margin-left:auto}
.reasoning{display:flex;gap:10px;padding:12px 16px;background:var(--sunken);border-bottom:1px solid var(--line);color:var(--text-2)}
details.reasoning{display:block}details.reasoning summary{display:flex;gap:10px;list-style:none;cursor:pointer}details.reasoning summary::-webkit-details-marker{display:none}
.reasoning .more{margin-left:auto;font-size:12.5px;font-weight:500;color:var(--accent-text);white-space:nowrap}details.reasoning[open] .more{visibility:hidden}
.reasoning .rest{margin:6px 0 0 26px}
.reasoning .i{color:var(--accent);margin-top:3px}
.reasoning .label{font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px}
.prose{max-width:76ch;line-height:1.6}.prose.lead{font-size:15px;color:var(--text)}
.draft-body{padding:16px}
.draft-body .sub{margin-top:18px}.draft-body h4{margin:0 0 8px;font-size:13px;font-weight:600}
.draft-body table{border:1px solid var(--line);border-radius:var(--r-sm);border-collapse:separate;border-spacing:0;overflow:hidden}
.draft-body .kv th{width:180px;color:var(--text-2);font-size:13px;font-weight:500;background:var(--sunken)}
.draft-body .count{margin-bottom:10px}
.cases td:nth-child(2),.cases td:nth-child(3){min-width:200px}.cases .checks div+div{margin-top:4px}.cases .tags{margin-top:4px}
.scroll{overflow-x:auto}
ul.plain{margin:0;padding-left:18px}ul.plain li+li{margin-top:4px}
ol.fixes{margin:0;padding:0;list-style:none;counter-reset:f}
ol.fixes li{position:relative;padding:12px 0 12px 34px;border-bottom:1px solid var(--line);counter-increment:f}
ol.fixes li:last-child{border-bottom:0}
ol.fixes li::before{content:counter(f);position:absolute;left:0;top:12px;width:22px;height:22px;border-radius:50%;background:var(--sunken);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--text-2)}
ol.fixes .prose{margin-top:4px;color:var(--text-2)}ol.fixes .meta{margin-top:6px;font-size:13px}
pre.raw{margin:0;padding:12px;background:var(--sunken);border-radius:var(--r-sm);font:12.5px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word}
details.edit{border-top:1px solid var(--line);padding:0 16px}
details.edit summary{cursor:pointer;padding:12px 0;font-size:13px;font-weight:500;color:var(--text-2)}
details.edit[open]{padding-bottom:16px}
.draft-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--line);background:var(--sunken)}
.draft-foot input{flex:1}
details.history{border-bottom:1px solid var(--line)}details.history:last-child{border-bottom:0}
details.history summary{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;list-style:none;flex-wrap:wrap}
details.history summary::-webkit-details-marker{display:none}
details.history summary:hover{background:var(--hover)}
details.history .note{font-style:italic}
.auth{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.auth-card{width:100%;max-width:380px}
.auth-card .brand{justify-content:center;margin-bottom:28px;font-size:22px;gap:10px}
.auth-card h1{text-align:center;font-size:20px}
.auth-card .lede{text-align:center;color:var(--text-2);margin:6px 0 24px}
.or{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--text-3);font-size:12px}
.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
.errorpage{max-width:520px;margin:12vh auto 0;text-align:center}
.errorpage h1{margin:12px 0 8px}
@media (max-width:1000px){.grid-2{grid-template-columns:1fr}}
@media (max-width:860px){
  .app{grid-template-columns:1fr;background:none}
  .rail{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;background:var(--rail);border-bottom:1px solid var(--line)}
  .nav{flex-direction:row;flex-wrap:wrap}.nav-title,.orgs-nav{display:none}
  .rail-foot{margin:0 0 0 auto;border:0;padding:0}.rail-foot .who{display:none}
  .topbar{padding:0 16px}.content{padding:20px 16px 56px}
  .track{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:18px}
  .hide-sm{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const pct = x => `${Math.round(x * 1000) / 10}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function ago(iso, now = new Date()) {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso).replace(/,.*$/, '');
}

export const orgPath = org => `/orgs/${encodeURIComponent(org.id)}`;
export const depPath = (org, name) => `${orgPath(org)}/deployments/${encodeURIComponent(name)}`;

const VERDICT = { accepted: ['good', 'Accepted'], not_accepted: ['bad', 'Not accepted'], pending_review: ['warn', 'Needs review'] };
export const verdictBadge = v => { const [cls, text] = VERDICT[v] ?? ['', v]; return `<span class="badge ${cls}">${esc(text)}</span>`; };

// The Delomu mark: a "D" cut by one diagonal slash (assets/brand/delomu-mark.svg), drawn in the text colour.
export const mark = (size, id) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><mask id="${id}"><rect width="64" height="64" fill="#fff"/><path d="M14 66 L34 -2" fill="none" stroke="#000" stroke-width="5.5"/></mask></defs><path d="M8 6 H30 A26 26 0 0 1 30 58 H8 Z" fill="currentColor" mask="url(#${id})"/></svg>`;

// nav: { orgs, org?, active, pending, canAudit }
function rail({ user, csrf, nav = {} }) {
  const org = nav.org;
  const link = (href, label, ic, key, extra = '') => `<a href="${esc(href)}"${nav.active === key ? ' aria-current="page"' : ''}>${icon(ic)}${esc(label)}${extra}</a>`;
  const orgLinks = (nav.orgs ?? []).length ? `<div class="nav orgs-nav"><p class="nav-title">Organizations</p>${nav.orgs.map(o => `<a href="${esc(orgPath(o))}"${org?.id === o.id ? ' aria-current="page"' : ''}>${icon('building')}<span>${esc(o.name)}</span>${o.partner_org_id ? '<span class="org-kind">managed</span>' : ''}</a>`).join('')}</div>` : '';
  return `<nav class="rail" aria-label="Main">
<a class="brand" href="/" aria-label="Delomu home">${mark(20, 'm-rail')}<span>Delomu</span></a>
<div class="nav">
${link('/', 'Home', 'home', 'home', nav.pending ? `<span class="count" aria-label="${nav.pending} waiting">${nav.pending}</span>` : '')}
${org ? link(orgPath(org), 'Deployments', 'layers', 'deployments') : ''}
${org && nav.canAudit ? link(`${orgPath(org)}/audit`, 'Audit log', 'shield', 'audit') : ''}
</div>
${orgLinks}
<div class="rail-foot"><span class="who" title="${esc(user.email)}">${esc(user.email)}</span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="icon-btn" title="Sign out" aria-label="Sign out">${icon('logout')}</button></form></div>
</nav>`;
}

function doc(title, body, bodyClass = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${esc(title)} · Delomu</title><style>${STYLE}</style></head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>${body}<script data-ui="busy">${BUSY_SCRIPT}</script></body></html>
`;
}

// crumbs: [[label, href?], ...]
export function layout({ title, user, csrf, nav, crumbs = [], body }) {
  if (!user) return doc(title, `<main class="auth">${body}</main>`);
  const trail = crumbs.map(([label, href], i) => (i === crumbs.length - 1 || !href
    ? `<span class="here">${esc(label)}</span>`
    : `<a href="${esc(href)}">${esc(label)}</a><span class="sep">/</span>`)).join('');
  return doc(title, `<div class="app">${rail({ user, csrf, nav })}
<div><header class="topbar">${trail}</header><main class="content">${body}</main></div></div>`);
}

const notice = (text, kind = '') => (text ? `<div class="notice ${kind}" role="${kind ? 'status' : 'alert'}">${icon(kind === 'good' ? 'check' : 'alert')}<span>${esc(text)}</span></div>` : '');

export function loginPage({ csrf, error }) {
  return layout({
    title: 'Sign in',
    body: `<div class="auth-card">
<a class="brand" href="/login" aria-label="Delomu">${mark(26, 'm-auth')}<span>Delomu</span></a>
<h1>Sign in</h1><p class="lede">Continue with your company account.</p>
${notice(error)}
<form method="get" action="/sso/start">
<label class="field"><span>Organization</span><input type="text" id="org" name="org" required maxlength="60" autocomplete="organization" placeholder="your-company"></label>
<button class="btn primary block">Continue with single sign-on</button></form>
<div class="or">or use an API key</div>
<form method="post" action="/login"><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>API key</span><input type="password" id="api_key" name="api_key" required autocomplete="off" placeholder="dk_…"></label>
<button class="btn block">Sign in with API key</button></form>
</div>`,
  });
}

export function errorPage({ status, message, user, csrf, nav }) {
  const title = status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong';
  return layout({ title, user, csrf, nav, crumbs: [[title]], body: `<div class="errorpage">${icon('alert', { size: 24 })}
<h1>${esc(title)}</h1><p class="muted">${esc(message)}</p><p style="margin-top:20px"><a class="btn" href="/">Go to Home</a></p></div>` });
}

const miniTrack = steps => `<span class="mini" aria-hidden="true">${steps.map(s => `<i class="${esc(s.state)}"></i>`).join('')}</span>`;

function stageCell(d) {
  const s = d.current;
  const n = STEPS.findIndex(x => x.key === s.key) + 1;
  return `<div class="stage">${miniTrack(d.steps)}<span class="lbl">${esc(`${n}. ${s.label}`)} · <span class="${s.state === 'attention' ? 'bad' : s.state === 'review' ? '' : ''}">${esc(s.detail)}</span></span></div>`;
}

// rows: [{ org, name, ov (overview), customer }]
function deploymentsTable(rows, { showOrg, now }) {
  if (!rows.length) return '';
  return `<div class="scroll"><table><thead><tr><th>Deployment</th>${showOrg ? '<th class="hide-sm">Organization</th>' : ''}<th>Stage</th><th>Latest result</th><th class="hide-sm">Last run</th></tr></thead><tbody>
${rows.map(({ org, name, ov, customer }) => `<tr>
<td><a class="strong" href="${esc(depPath(org, name))}">${esc(name)}</a>${customer ? `<div class="subtle">${esc(customer)}</div>` : ''}</td>
${showOrg ? `<td class="hide-sm muted">${esc(org.name)}</td>` : ''}
<td>${stageCell(ov)}</td>
<td>${ov.latest ? `${verdictBadge(ov.latest.summary.verdict)} <span class="num muted">${ov.latest.summary.pass}/${ov.latest.summary.total}</span>` : '<span class="subtle">Not run</span>'}</td>
<td class="hide-sm subtle nowrap">${ov.latest ? esc(ago(ov.latest.generatedAt, now)) : '—'}</td></tr>`).join('\n')}
</tbody></table></div>`;
}

export function homePage({ user, csrf, nav, now, deployments, review }) {
  const queue = review.length
    ? `<div class="rows">${review.map(({ org, name, draft }) => `<a class="row" href="${esc(depPath(org, name))}/drafts">
${icon('inbox')}<div class="what"><p class="strong">${esc(draftLabel(draft))} for ${esc(name)}</p><p class="subtle">${esc(org.name)} · drafted ${esc(ago(draft.createdAt, now))}${draft.rationale ? ` · ${esc(draft.rationale)}` : ''}</p></div>
<span class="btn">Review</span></a>`).join('')}</div>`
    : `<div class="emptystate"><span class="strong">You're all caught up</span>New drafts from the agent appear here for your decision.</div>`;
  const attention = deployments.filter(d => d.ov.latest && d.ov.latest.summary.verdict !== 'accepted').length;
  const summary = deployments.length
    ? `${deployments.length} deployment${deployments.length > 1 ? 's' : ''} · ${review.length} waiting for review · ${attention} with failing tests`
    : 'No deployments yet.';
  const orgs = nav.orgs ?? [];
  return layout({ title: 'Home', user, csrf, nav: { ...nav, active: 'home' }, crumbs: [['Home']], body: `
<div class="page-head"><div><h1>Home</h1><p class="sub num">${esc(summary)}</p></div>
${orgs.length === 1 ? `<div class="actions"><a class="btn primary" href="${esc(orgPath(orgs[0]))}/new-deployment">${icon('plus')}New deployment</a></div>` : ''}</div>
<section class="panel"><div class="panel-head"><h2>Needs your review</h2>${review.length ? `<span class="badge accent plain num">${review.length}</span>` : ''}</div>${queue}</section>
<section class="panel"><div class="panel-head"><h2>Deployments</h2></div>
${deployments.length ? deploymentsTable(deployments, { showOrg: orgs.length > 1, now }) : `<div class="emptystate"><span class="strong">No deployments yet</span>Create one to start a customer rollout.</div>`}</section>` });
}

const draftLabel = d => ({ mapping: 'Data mapping', integration: 'Integration', cases: 'Test cases', fixes: 'Fixes', 'launch-report': 'Launch report' })[d.kind] ?? 'Draft';

export function orgPage({ user, csrf, nav, now, org, deployments, canWrite, notice: msg }) {
  return layout({ title: org.name, user, csrf, nav: { ...nav, org, active: 'deployments' }, crumbs: [[org.name, orgPath(org)], ['Deployments']], body: `
<div class="page-head"><div><h1>Deployments</h1><p class="sub">${esc(org.name)} · ${deployments.length} deployment${deployments.length === 1 ? '' : 's'}</p></div>
${canWrite ? `<div class="actions"><a class="btn primary" href="${esc(orgPath(org))}/new-deployment">${icon('plus')}New deployment</a></div>` : ''}</div>
${notice(msg, 'good')}
<section class="panel">${deployments.length ? deploymentsTable(deployments, { now }) : `<div class="emptystate"><span class="strong">No deployments yet</span>${canWrite ? 'Create one for each customer rollout.' : 'An engineer creates one for each customer rollout.'}</div>`}</section>` });
}

export function newDeploymentPage({ user, csrf, nav, org, error, values = {} }) {
  const v = k => esc(values[k] ?? '');
  const isCommand = values.type === 'command';
  return layout({ title: 'New deployment', user, csrf, nav: { ...nav, org, active: 'deployments' }, crumbs: [[org.name, orgPath(org)], ['Deployments', orgPath(org)], ['New']], body: `
<div class="page-head"><div><h1>New deployment</h1><p class="sub">One deployment per customer rollout. You can add the customer's material after this.</p></div></div>
${notice(error)}
<form method="post" action="${esc(orgPath(org))}/new-deployment" class="panel" style="max-width:720px"><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Name</span><input type="text" name="name" required maxlength="63" pattern="[a-z0-9]([a-z0-9\\-]*[a-z0-9])?" value="${v('name')}" placeholder="acme-support-bot"><p class="hint">Lowercase letters, numbers and dashes.</p></label>
<label class="field"><span>Customer</span><input type="text" name="customer" maxlength="120" value="${v('customer')}" placeholder="Acme Inc."></label>
<div class="field"><span>How Delomu reaches the customer's AI</span><div class="choice">
<label><input type="radio" name="type" value="http"${isCommand ? '' : ' checked'}><span><span class="strong">HTTP endpoint</span><span class="hint" style="display:block;margin:2px 0 0">The AI answers a POST request.</span></span></label>
<label><input type="radio" name="type" value="command"${isCommand ? ' checked' : ''}><span><span class="strong">Command</span><span class="hint" style="display:block;margin:2px 0 0">A program on this server; off unless the operator allows it.</span></span></label>
</div></div>
<label class="field"><span>Endpoint URL</span><input type="url" name="url" value="${v('url')}" placeholder="https://ai.customer.example/chat"></label>
<label class="field"><span>Authorization header</span><input type="text" name="auth" value="${v('auth')}" placeholder="Bearer \${CUSTOMER_API_KEY}"><p class="hint">Reference a server environment variable; never paste a key here.</p></label>
<label class="field"><span>Field holding the answer</span><input type="text" name="output" value="${v('output')}" placeholder="reply"><p class="hint">Dot path in the JSON response, for example <code>choices.0.message.content</code>.</p></label>
<label class="field"><span>Command</span><input type="text" name="command" value="${v('command')}" placeholder="node bot.mjs"></label>
<label class="field"><span>Required pass rate (%)</span><input type="number" name="pass" min="1" max="100" value="${v('pass') || '90'}" style="max-width:120px"></label>
</div><div class="draft-foot"><a class="btn" href="${esc(orgPath(org))}">Cancel</a><span style="flex:1"></span><button class="btn primary" data-busy="Creating…">Create deployment</button></div></form>` });
}

// The shared header of every deployment page: title, actions and the six-step track.
function deploymentHeader({ org, name, config, ov, tab, can, csrf }) {
  const base = depPath(org, name);
  const tabs = [['overview', 'Overview', base], ['runs', 'Runs', `${base}/runs`, ov.runs.length], ['drafts', 'Review', `${base}/drafts`, ov.pending.length, true], ['inputs', 'Customer material', `${base}/inputs`, ov.inputs.length], ['settings', 'Settings', `${base}/settings`]];
  const agentForm = can.write ? `<form method="post" action="${esc(base)}/agent" class="actions" style="margin:0">
<input type="hidden" name="csrf" value="${esc(csrf)}"><label class="sr" for="task">Agent task</label>
<select id="task" name="task" style="width:auto">${STEPS.slice(0, 5).map(s => `<option value="${esc(s.key)}"${ov.next.task === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
<button class="btn" data-busy="Agent is drafting…">${icon('spark')}Ask agent to draft</button></form>` : '';
  const runForm = can.run ? `<form method="post" action="${esc(base)}/run" class="actions" style="margin:0"><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="check"><input type="checkbox" name="judge" value="1" checked>Grade with judge</label>
<button class="btn primary" data-busy="Running tests…">${icon('play')}Run tests</button></form>` : '';
  return `<div class="page-head"><div><div class="title"><h1>${esc(name)}</h1>${ov.latest ? verdictBadge(ov.latest.summary.verdict) : '<span class="badge plain">Not run</span>'}</div>
<p class="sub">${esc([config.customer, config.target?.type === 'http' ? 'HTTP endpoint' : config.target?.type === 'command' ? 'Command' : '', `needs ${pct(config.acceptance?.minPassRate ?? 0.9)} to pass`].filter(Boolean).join(' · '))}</p></div>
<div class="actions">${agentForm}${runForm}</div></div>
<section class="panel" aria-label="Rollout progress"><ol class="track" style="list-style:none;margin:0">
${ov.steps.map(s => `<li class="step ${esc(s.state)}"><span class="dot">${s.state === 'done' ? icon('check', { size: 12 }) : ''}</span><p class="label">${esc(s.label)}</p><p class="detail">${esc(s.detail)}</p></li>`).join('')}
</ol></section>
<nav class="tabs" aria-label="Deployment">${tabs.map(([key, label, href, n, hot]) => `<a href="${esc(href)}"${tab === key ? ' aria-current="page"' : ''}>${esc(label)}${n ? ` <span class="n${hot ? ' hot' : ''}">${n}</span>` : ''}</a>`).join('')}</nav>`;
}

function deploymentShell(args, body) {
  const { user, csrf, nav, org, name, title, flash, error } = args;
  return layout({ title: title ? `${title} · ${name}` : name, user, csrf, nav: { ...nav, org, active: 'deployments' },
    crumbs: [[org.name, orgPath(org)], ['Deployments', orgPath(org)], [name, title ? depPath(org, name) : undefined], ...(title ? [[title]] : [])],
    body: `${deploymentHeader(args)}${notice(error)}${notice(flash, 'good')}${body}` });
}

function historyChart(runs, goal) {
  const shown = runs.slice(-12);
  if (shown.length < 2) return '';
  const W = 560; const H = 120; const pad = 24; const bw = Math.min(28, (W - pad) / shown.length - 8);
  const y = r => H - 18 - r * (H - 34);
  const bars = shown.map((r, i) => {
    const x = pad + i * ((W - pad) / shown.length) + 4;
    const rate = r.summary.passRate;
    return `<rect class="bar ${rate >= goal ? 'good' : 'bad'}" x="${x.toFixed(1)}" y="${y(rate).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - 18 - y(rate)).toFixed(1)}" rx="3"><title>Run ${r.number}: ${pct(rate)}</title></rect>
<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${r.number}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pass rate of the last ${shown.length} runs against the ${pct(goal)} goal">
<line class="goal" x1="${pad}" x2="${W}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/><text x="0" y="${(y(goal) + 4).toFixed(1)}">${Math.round(goal * 100)}%</text>${bars}</svg>`;
}

export function deploymentOverviewPage(args) {
  const { org, name, ov, now, config, can } = args;
  const goal = config.acceptance?.minPassRate ?? 0.9;
  const latest = ov.latest;
  const base = depPath(org, name);
  const failing = latest ? latest.cases.filter(c => c.status !== 'pass') : [];
  const reportHref = latest ? `${base}/runs/${encodeURIComponent(latest.runId)}/report.html` : '';
  const result = latest ? `<section class="panel"><div class="panel-head"><h2>Latest result</h2><span class="aside subtle">Run ${latest.number} · ${esc(fmtDate(latest.generatedAt))}</span></div><div class="panel-body">
<div class="result"><span class="rate">${esc(pct(latest.summary.passRate))}</span><span class="muted num">${latest.summary.pass} of ${latest.summary.total} cases pass · needs ${esc(pct(goal))}</span></div>
${historyChart(ov.runs, goal)}
<p style="margin-top:14px"><a href="${esc(reportHref)}">Open the acceptance report ${icon('arrow', { size: 14 }).replace('class="i"', 'class="i" style="display:inline;vertical-align:-2px"')}</a></p></div>
${failing.length ? `<div class="panel-head" style="border-top:1px solid var(--line)"><h2>Failing cases</h2><span class="aside subtle num">${failing.length}</span></div>
<ul class="failing">${failing.slice(0, 8).map(c => {
    const why = c.error ? `No answer: ${c.error}` : (c.checks.find(k => k.status !== 'pass')?.reason ?? '');
    return `<li><code>${esc(c.id)}</code><span class="muted">${esc(why)}</span></li>`;
  }).join('')}</ul>${failing.length > 8 ? `<p class="panel-body subtle">${failing.length - 8} more in the report.</p>` : ''}` : ''}</section>`
    : `<section class="panel"><div class="emptystate"><span class="strong">No test runs yet</span>${can.run ? 'Run the test set to see how the customer’s AI does.' : 'An engineer runs the tests.'}</div></section>`;

  const nextBtn = {
    review: `<a class="btn primary" href="${esc(base)}/drafts">${icon('inbox')}Review drafts</a>`,
    inputs: `<a class="btn primary" href="${esc(base)}/inputs">${icon('upload')}Add customer material</a>`,
  }[ov.next.action] ?? '';
  const feed = ov.activity.length ? `<ul class="feed">${ov.activity.map(e => {
    const agent = e.actor === 'agent';
    const who = agent ? 'Agent' : e.actor === 'system' ? 'System' : e.actor.replace(/^human:/, '').split('@')[0];
    return `<li><span class="who-chip${agent ? ' agent' : ''}">${esc(who)}</span><span class="muted">${esc(e.action.replace(/[._]/g, ' '))}</span><span class="t">${esc(ago(e.ts, now))}</span></li>`;
  }).join('')}</ul>` : '<p class="panel-body subtle">Nothing yet.</p>';

  return deploymentShell({ ...args, tab: 'overview' }, `<div class="grid-2"><div>${result}</div>
<div class="stack"><section class="panel"><div class="panel-head"><h2>Next step</h2></div><div class="panel-body next"><p>${esc(ov.next.text)}</p>${nextBtn}</div></section>
<section class="panel"><div class="panel-head"><h2>Activity</h2></div>${feed}</section></div></div>`);
}

export function runsPage(args) {
  const { org, name, ov, now } = args;
  const base = depPath(org, name);
  const runs = [...ov.runs].reverse();
  const body = runs.length ? `<section class="panel"><div class="scroll"><table><thead><tr><th>Run</th><th>Result</th><th>Passed</th><th class="hide-sm">Failed</th><th class="hide-sm">Graded by</th><th></th></tr></thead><tbody>
${runs.map(r => `<tr><td><span class="strong">Run ${r.number}</span><div class="subtle">${esc(fmtDate(r.generatedAt))} · ${esc(ago(r.generatedAt, now))}</div></td>
<td>${verdictBadge(r.summary.verdict)}</td><td class="num">${r.summary.pass}/${r.summary.total} <span class="subtle">(${esc(pct(r.summary.passRate))})</span></td>
<td class="num hide-sm">${r.summary.fail + r.summary.error}</td><td class="hide-sm muted">${esc(r.judge === 'off' ? 'Rules only' : r.judge)}</td>
<td style="text-align:right"><a href="${esc(base)}/runs/${esc(encodeURIComponent(r.runId))}/report.html">Report</a></td></tr>`).join('\n')}
</tbody></table></div></section>` : `<section class="panel"><div class="emptystate"><span class="strong">No runs yet</span>Use Run tests above.</div></section>`;
  return deploymentShell({ ...args, tab: 'runs', title: 'Runs' }, body);
}

export function draftsPage(args) {
  const { org, name, ov, csrf, can, now } = args;
  const when = iso => ago(iso, now);
  const base = depPath(org, name);
  const pending = ov.drafts.filter(d => d.status === 'pending');
  const done = ov.drafts.filter(d => d.status !== 'pending').sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)));
  const body = `<p class="muted" style="margin-bottom:16px">The agent proposes; a person approves, edits or rejects. Nothing changes until a draft is approved, and every decision goes into the audit log.</p>
${pending.length ? `<div class="stack">${pending.map(d => draftCard(d, { action: `${base}/drafts/${encodeURIComponent(d.id)}/review`, csrf, canReview: can.review, when })).join('')}</div>`
    : `<section class="panel"><div class="emptystate"><span class="strong">Nothing waiting for review</span>${can.write ? 'Use Ask agent to draft above to start the next step.' : 'New drafts from the agent appear here.'}</div></section>`}
${done.length ? `<h2 style="margin:32px 0 12px">Decided</h2><section class="panel">${done.map(d => reviewedRow(d, { when })).join('')}</section>` : ''}`;
  return deploymentShell({ ...args, tab: 'drafts', title: 'Review' }, body);
}

const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function inputsPage(args) {
  const { org, name, ov, csrf, can, now } = args;
  const base = depPath(org, name);
  const files = ov.inputs.length ? `<table><thead><tr><th>File</th><th>Size</th><th class="hide-sm">Added</th></tr></thead><tbody>
${ov.inputs.map(f => `<tr><td><span style="display:inline-flex;gap:8px;align-items:center">${icon('file')}${esc(f.name)}</span></td><td class="num muted">${esc(size(f.size))}</td><td class="hide-sm subtle">${esc(ago(f.modified, now))}</td></tr>`).join('')}
</tbody></table>` : `<div class="emptystate"><span class="strong">No material yet</span>The agent reads only what is here: policies, API docs and past tickets.</div>`;
  const upload = can.write ? `<form method="post" action="${esc(base)}/inputs" enctype="multipart/form-data" class="panel" style="margin-top:16px"><div class="panel-head"><h2>Add files</h2></div><div class="panel-body">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span class="sr">Files</span><input type="file" name="files" multiple required accept=".md,.txt,.csv,.json,.yaml,.yml,.html"></label>
<p class="hint" style="margin:-8px 0 14px">Markdown, text, CSV, JSON, YAML or HTML, up to 1 MB each. A file with the same name is replaced.</p>
<button class="btn primary" data-busy="Uploading…">${icon('upload')}Upload</button></div></form>` : '';
  return deploymentShell({ ...args, tab: 'inputs', title: 'Customer material' }, `<section class="panel">${files}</section>${upload}`);
}

export function settingsPage(args) {
  const { config } = args;
  const t = config.target ?? {};
  const rows = [
    ['Customer', config.customer], ['Connection', t.type === 'http' ? 'HTTP endpoint' : t.type === 'command' ? 'Command' : t.type],
    ['URL', t.url], ['Command', t.command], ['Answer at', t.output], ['Timeout', t.timeoutMs ? `${t.timeoutMs / 1000} s` : undefined],
    ['Required pass rate', pct(config.acceptance?.minPassRate ?? 0.9)],
  ].filter(([, v]) => v);
  const headers = Object.entries(t.headers ?? {});
  const decisions = config.decisions ?? [];
  return deploymentShell({ ...args, tab: 'settings', title: 'Settings' }, `<section class="panel"><div class="panel-head"><h2>Connection and acceptance</h2></div>
<div class="draft-body"><table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
${headers.map(([k, v]) => `<tr><th scope="row">Header <code>${esc(k)}</code></th><td><code>${esc(v)}</code></td></tr>`).join('')}</tbody></table></div></section>
<section class="panel"><div class="panel-head"><h2>Decisions</h2><span class="aside subtle">Shown in every acceptance report</span></div>
${decisions.length ? `<table><thead><tr><th>Date</th><th>Decision</th><th>Why</th></tr></thead><tbody>${decisions.map(d => `<tr><td class="num nowrap">${esc(d.date)}</td><td>${esc(d.decision)}</td><td class="muted">${esc(d.reason)}</td></tr>`).join('')}</tbody></table>` : '<p class="panel-body subtle">No decisions recorded.</p>'}</section>`);
}

export function auditPage({ user, csrf, nav, now, org, events, audits }) {
  const actor = a => (a === 'agent' ? '<span class="who-chip agent">Agent</span>' : a === 'system' ? '<span class="who-chip">System</span>' : esc(a.replace(/^human:/, '')));
  return layout({ title: `Audit · ${org.name}`, user, csrf, nav: { ...nav, org, active: 'audit' }, crumbs: [[org.name, orgPath(org)], ['Audit log']], body: `
<div class="page-head"><div><h1>Audit log</h1><p class="sub">Every sign-in, run and decision. Export as CSV from <code>GET /v1/orgs/${esc(org.id)}/audit_events.csv</code>.</p></div></div>
<section class="panel"><div class="panel-head"><h2>Deployment records</h2><span class="aside subtle">Each record is hash-chained; an edit breaks the chain</span></div>
${audits.length ? `<table><thead><tr><th>Deployment</th><th>Entries</th><th>Integrity</th></tr></thead><tbody>
${audits.map(a => `<tr><td class="strong">${esc(a.name)}</td><td class="num">${a.entries.length}</td><td>${a.verify.ok ? '<span class="badge good">Intact</span>' : `<span class="badge bad">Broken at entry ${esc(a.verify.brokenAt)}</span> <span class="muted">${esc(a.verify.reason)}</span>`}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="panel-body subtle">No deployments.</p>'}</section>
<section class="panel"><div class="panel-head"><h2>Organization events</h2><span class="aside subtle num">Latest ${events.length}</span></div>
<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th class="hide-sm">IP</th></tr></thead><tbody>
${events.map(e => `<tr><td class="nowrap"><span title="${esc(fmtDate(e.ts))}">${esc(ago(e.ts, now))}</span></td><td>${actor(e.actor)}</td><td>${esc(e.action.replace(/[._]/g, ' '))}</td><td class="muted">${esc(e.target)}</td><td class="hide-sm subtle mono">${esc(e.ip)}</td></tr>`).join('\n')}
</tbody></table></div></section>` });
}
