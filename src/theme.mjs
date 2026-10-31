// Design tokens and base styles shared by the web app (src/v3/html.mjs) and the customer-facing
// acceptance report (src/report.mjs), so both read as one product. Light by default, dark when the
// visitor's system asks for it. See PRODUCT.md: calm, precise product UI at the Linear/Vercel/Stripe bar.

export const TOKENS = `
:root{
  color-scheme:light;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,"Liberation Mono",monospace;
  --canvas:#fafafb;--surface:#ffffff;--rail:#f4f4f6;--sunken:#f4f4f6;--hover:#efeff2;
  --line:#e4e4e9;--line-strong:#d1d1d9;
  --text:#18181b;--text-2:#4f4f58;--text-3:#6b6b75;
  --accent:#3e63dd;--accent-hover:#3457c9;--accent-text:#2f50bf;--accent-weak:#edf1fd;--on-accent:#ffffff;
  --good:#18794e;--good-weak:#e8f5ee;--warn:#9a5300;--warn-weak:#fdf3e4;--bad:#c4302b;--bad-weak:#fdeceb;
  --focus:0 0 0 2px var(--surface),0 0 0 4px color-mix(in srgb,var(--accent) 55%,transparent);
  --shadow:0 1px 2px rgb(16 16 24/.05),0 2px 8px rgb(16 16 24/.04);
  --r-sm:6px;--r:10px;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --canvas:#0f0f12;--surface:#16161a;--rail:#121215;--sunken:#1c1c21;--hover:#212127;
  --line:#26262d;--line-strong:#34343d;
  --text:#ececf0;--text-2:#a8a8b3;--text-3:#8b8b96;
  --accent:#6d8cff;--accent-hover:#84a0ff;--accent-text:#93a9ff;--accent-weak:#1c2340;--on-accent:#0b1026;
  --good:#4cc38a;--good-weak:#12281d;--warn:#f0b35b;--warn-weak:#2c2112;--bad:#ff7a70;--bad-weak:#2f1615;
  --shadow:0 1px 2px rgb(0 0 0/.4);
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--text);font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 0}
::selection{background:color-mix(in srgb,var(--accent) 24%,transparent);color:inherit}
:focus-visible{outline:none;box-shadow:var(--focus);border-radius:var(--r-sm)}
a{color:var(--accent-text);text-decoration:none;text-underline-offset:3px}a:hover{text-decoration:underline}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-0.015em;text-wrap:balance}
h1{font-size:22px;line-height:1.3}h2{font-size:15px;line-height:1.4}h3{font-size:14px}
p{margin:0}
code,.mono{font-family:var(--mono);font-size:12.5px}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-2)}.subtle{color:var(--text-3)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:12px;font-weight:500;color:var(--text-3);text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
.badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--sunken);color:var(--text-2)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9}
.badge.plain::before{display:none}
.badge.good{background:var(--good-weak);color:var(--good)}.badge.warn{background:var(--warn-weak);color:var(--warn)}
.badge.bad{background:var(--bad-weak);color:var(--bad)}.badge.accent{background:var(--accent-weak);color:var(--accent-text)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:10px;border:3px solid var(--canvas)}::-webkit-scrollbar-track{background:transparent}
`;
