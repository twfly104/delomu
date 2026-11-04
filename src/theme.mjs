// Design tokens and base styles shared by the web app (src/v3/html.mjs) and the customer-facing
// acceptance report (src/report.mjs), so both read as one product. Light by default, dark when the
// visitor's system asks for it. See PRODUCT.md: calm, precise product UI at the Linear/Vercel/Stripe bar.

export const TOKENS = `
:root{
  color-scheme:light;
  --font:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:"Geist Mono",ui-monospace,"SF Mono","Cascadia Mono",Consolas,"Liberation Mono",monospace;
  --canvas:#fafafa;--surface:#ffffff;--rail:#fafafa;--sunken:#f5f5f5;--hover:#ebebeb;
  --line:#ebebeb;--line-strong:#d6d6d6;
  --text:#171717;--text-2:#4d4d4d;--text-3:#6b6b6b;
  --ink:#171717;--ink-hover:#383838;--on-ink:#ffffff;
  --accent:#006bff;--accent-hover:#005be0;--accent-text:#005ad4;--accent-weak:#f0f6ff;--on-accent:#ffffff;
  --good:#16a34a;--good-weak:#f0faf3;--warn:#b25e00;--warn-weak:#fff7ec;--bad:#d92d20;--bad-weak:#fff2f1;
  --focus:0 0 0 2px var(--surface),0 0 0 4px color-mix(in srgb,var(--accent) 55%,transparent);
  --shadow:0 1px 2px rgb(0 0 0/.04);
  --r-sm:6px;--r:10px;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --canvas:#000000;--surface:#0a0a0a;--rail:#000000;--sunken:#141414;--hover:#1f1f1f;
  --line:#1f1f1f;--line-strong:#333333;
  --text:#ededed;--text-2:#a1a1a1;--text-3:#8f8f8f;
  --ink:#ededed;--ink-hover:#ffffff;--on-ink:#0a0a0a;
  --accent:#3b8eff;--accent-hover:#5c9fff;--accent-text:#62a4ff;--accent-weak:#0b1a33;--on-accent:#000000;
  --good:#3fc58f;--good-weak:#0e2219;--warn:#f0b35b;--warn-weak:#2a1f10;--bad:#ff6b61;--bad-weak:#2c1414;
  --shadow:0 1px 2px rgb(0 0 0/.45);
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--text);font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-feature-settings:"tnum" 0}
::selection{background:color-mix(in srgb,var(--accent) 24%,transparent);color:inherit}
:focus-visible{outline:none;box-shadow:var(--focus);border-radius:var(--r-sm)}
a{color:var(--accent-text);text-decoration:none;text-underline-offset:3px}a:hover{text-decoration:underline}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-0.02em;text-wrap:balance}
h1{font-size:24px;line-height:1.25;letter-spacing:-0.03em}h2{font-size:15px;line-height:1.4}h3{font-size:14px}
p{margin:0}
code,.mono{font-family:var(--mono);font-size:12.5px;letter-spacing:0}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-2)}.subtle{color:var(--text-3)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:12px;font-weight:500;color:var(--text-3);text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
.badge{--dot:var(--text-3);display:inline-flex;align-items:center;gap:6px;height:20px;padding:0;font-size:13px;font-weight:500;white-space:nowrap;background:none;color:var(--text)}
.badge::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot)}
.badge.plain{height:22px;padding:0 8px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--text-2)}.badge.plain::before{display:none}
.badge.good{--dot:var(--good)}.badge.warn{--dot:var(--warn)}
.badge.bad{--dot:var(--bad);color:var(--bad)}.badge.accent{--dot:var(--accent)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:10px;border:3px solid var(--canvas)}::-webkit-scrollbar-track{background:transparent}
`;
