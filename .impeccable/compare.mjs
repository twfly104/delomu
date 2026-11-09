// Builds reports/unicorn-walk/compare.html: each fixed screen, before and after, from the two walk folders.
// usage: node .impeccable/compare.mjs
import fs from 'node:fs'; import path from 'node:path';
const root = 'reports/unicorn-walk';
const find = (dir, name, variant) => fs.readdirSync(path.join(root, dir)).find(f => f.replace(/^\d+-/, '') === `${name}--${variant}.png`);
const rows = [
  ['1. First check on the sample agent', 'Before: all 8 rules kept, nothing to fix. After: 3 rules broken and a drafted fix to approve.', 'check-result', 'check-result', 'desktop-light'],
  ['1b. Approve, apply and re-check', 'After approving the drafted fix, the same messages run again; a passing re-check offers the client sign-off.', null, 'recheck-result', 'desktop-light'],
  ['2. The client’s sign-off page', 'The ask, who sent it and the decision come first; possessive fixed.', 'client-signoff', 'client-signoff', 'desktop-light'],
  ['3. Sign-off link on the vendor side', 'Copy button, panel head fixed, and whether the client opened it.', 'rollout-after-link', 'rollout-link-made', 'desktop-light'],
  ['3b. After the client opened it', '', null, 'rollout-opened', 'desktop-light'],
  ['3c. A withdrawn link', 'Before: a bare 404. After: what happened and who to ask.', null, 'client-link-closed', 'desktop-light'],
  ['4. Home: waiting for your decision', 'Agent name instead of internal ids and timestamps.', 'home', 'home', 'desktop-light'],
  ['5. Setup wizard, last step', 'What will be checked, and an honest time.', 'welcome-check', 'welcome-check', 'desktop-light'],
  ['6. Rollout on a phone', 'Steps stack in one column instead of three squeezed ones.', 'rollout', 'rollout', 'phone-dark'],
  ['7. Client sign-off on a phone', '', 'client-signoff', 'client-signoff', 'phone-light'],
];
const img = (dir, f) => (f ? `<a href="${dir}/${f}"><img src="${dir}/${f}" loading="lazy" alt=""></a>` : '<div class="none">Not shown before</div>');
const body = rows.map(([title, note, b, a, v]) => `<section><h2>${title}</h2>${note ? `<p>${note}</p>` : ''}<div class="pair"><figure><figcaption>Before</figcaption>${img('before', b && find('before', b, v))}</figure><figure><figcaption>After</figcaption>${img('after', find('after', a, v))}</figure></div></section>`).join('\n');
fs.writeFileSync(path.join(root, 'compare.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grapim before and after</title>
<style>:root{--bg:#f6f7f9;--fg:#0b1324;--mute:#4a5568;--line:#e3e7ee}@media (prefers-color-scheme:dark){:root{--bg:#0a0d14;--fg:#e8ecf3;--mute:#a3adc0;--line:#212837}}
body{margin:0;padding:32px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}main{max-width:1400px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:40px 0 4px}p{color:var(--mute);margin:0 0 12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}img{display:block;width:100%;border:1px solid var(--line);border-radius:8px}
.none{padding:40px;border:1px dashed var(--line);border-radius:8px;color:var(--mute);text-align:center}@media (max-width:700px){.pair{grid-template-columns:1fr}}</style></head>
<body><main><h1>Grapim: before and after</h1><p>A brand-new vendor's walk on a local server with a real model, 2026-11-09. Full sets in before/ and after/ (desktop and phone, light and dark). Ranked gaps: gaps.md.</p>
${body}</main></body></html>\n`);
console.log('wrote', path.join(root, 'compare.html'));
