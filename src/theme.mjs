// Design tokens and base styles shared by the web app (src/v3/html.mjs) and the customer-facing
// acceptance report (src/report.mjs), so both read as one product. Light by default, dark when the
// visitor's system asks for it. See PRODUCT.md: calm, precise product UI at the Linear/Vercel/Stripe bar.

export const TOKENS = `
:root{
  color-scheme:light;
  --font:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:"Geist Mono",ui-monospace,"SF Mono","Cascadia Mono",Consolas,"Liberation Mono",monospace;
  --canvas:#f6f7f9;--surface:#ffffff;--rail:#f1f3f6;--sunken:#f1f3f6;--hover:#eaedf2;
  --line:#e3e7ee;--line-strong:#cfd5df;
  --text:#0b1324;--text-2:#4a5568;--text-3:#646e83;
  --ink:#0b1324;--ink-hover:#1f2a40;--on-ink:#ffffff;
  --accent:#2b59ff;--accent-hover:#1f4ae6;--accent-text:#1d47d6;--accent-weak:#edf1ff;--on-accent:#ffffff;
  --good:#0f7a57;--good-weak:#e8f6f0;--warn:#a15c00;--warn-weak:#fdf4e6;--bad:#cc2a1e;--bad-weak:#fef0ee;
  --focus:0 0 0 2px var(--surface),0 0 0 4px color-mix(in srgb,var(--accent) 55%,transparent);
  --shadow:0 1px 1px rgb(11 19 36/.04),0 2px 8px rgb(11 19 36/.05);
  --r-sm:8px;--r:12px;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --canvas:#0a0d14;--surface:#10141e;--rail:#0c1018;--sunken:#161b27;--hover:#1a2030;
  --line:#212837;--line-strong:#313a4d;
  --text:#e8ecf3;--text-2:#a3adc0;--text-3:#808ba1;
  --ink:#e8ecf3;--ink-hover:#ffffff;--on-ink:#0a0d14;
  --accent:#6b8cff;--accent-hover:#85a0ff;--accent-text:#93aaff;--accent-weak:#151c36;--on-accent:#06102b;
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
.badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--sunken);color:var(--text-2)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9}
.badge.plain::before{display:none}
.badge.good{background:var(--good-weak);color:var(--good)}.badge.warn{background:var(--warn-weak);color:var(--warn)}
.badge.bad{background:var(--bad-weak);color:var(--bad)}.badge.accent{background:var(--accent-weak);color:var(--accent-text)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:10px;border:3px solid var(--canvas)}::-webkit-scrollbar-track{background:transparent}
`;
