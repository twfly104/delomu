// Design tokens and base styles shared by the web app (src/v3/html.mjs) and the customer-facing
// acceptance report (src/report.mjs), so both read as one product. Light by default, dark when the
// visitor's system asks for it. See PRODUCT.md: calm, precise product UI at the Linear/Vercel/Stripe bar.

export const TOKENS = `
:root{
  color-scheme:light;
  --font:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:"Geist Mono",ui-monospace,"SF Mono","Cascadia Mono",Consolas,"Liberation Mono",monospace;
  --canvas:#fbfbfb;--surface:#ffffff;--rail:#f7f7f7;--sunken:#f5f5f5;--hover:#f0f0f0;
  --line:#ebebeb;--line-strong:#dadada;
  --text:#111111;--text-2:#555555;--text-3:#737373;
  --ink:#111111;--ink-hover:#333333;--on-ink:#ffffff;
  --accent:#2f5bea;--accent-hover:#2550d8;--accent-text:#254fd0;--accent-weak:#eef2fe;--on-accent:#ffffff;
  --good:#13804b;--good-weak:#ebf7f0;--warn:#a15c00;--warn-weak:#fdf4e6;--bad:#d1291f;--bad-weak:#fdeeed;
  --focus:0 0 0 2px var(--surface),0 0 0 4px color-mix(in srgb,var(--accent) 55%,transparent);
  --shadow:0 1px 1px rgb(0 0 0/.03),0 2px 6px rgb(0 0 0/.04);
  --r-sm:8px;--r:12px;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --canvas:#0a0a0a;--surface:#111111;--rail:#0d0d0d;--sunken:#181818;--hover:#1c1c1c;
  --line:#232323;--line-strong:#333333;
  --text:#ededed;--text-2:#a1a1a1;--text-3:#8a8a8a;
  --ink:#ededed;--ink-hover:#ffffff;--on-ink:#0a0a0a;
  --accent:#5c85ff;--accent-hover:#7598ff;--accent-text:#8aa8ff;--accent-weak:#151d33;--on-accent:#06102b;
  --good:#3fc584;--good-weak:#0f2419;--warn:#f0b35b;--warn-weak:#2a1f10;--bad:#ff6b61;--bad-weak:#2c1312;
  --shadow:0 1px 2px rgb(0 0 0/.4);
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
.badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--sunken);color:var(--text-2)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9}
.badge.plain::before{display:none}
.badge.good{background:var(--good-weak);color:var(--good)}.badge.warn{background:var(--warn-weak);color:var(--warn)}
.badge.bad{background:var(--bad-weak);color:var(--bad)}.badge.accent{background:var(--accent-weak);color:var(--accent-text)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:10px;border:3px solid var(--canvas)}::-webkit-scrollbar-track{background:transparent}
`;
