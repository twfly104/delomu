// Renders the video's still layers with headless Chrome: title cards at 2x (from storyboard.json), the stage
// background with the window shadow, and the rounded-corner window mask.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, 'build');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const WIN = { x: 224, y: 28, w: 1472, h: 920, r: 22 };

const MARK = size => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><defs><mask id="m"><rect width="64" height="64" fill="#fff"/><path d="M14 66 L34 -2" fill="none" stroke="#000" stroke-width="5.5"/></mask></defs><path d="M8 6 H30 A26 26 0 0 1 30 58 H8 Z" fill="#fff" mask="url(#m)"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const BASE = `*{margin:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:"Segoe UI Variable Display","Segoe UI",sans-serif;color:#fff;-webkit-font-smoothing:antialiased;
background:radial-gradient(1200px 700px at 50% 38%,#1d2140 0%,#101118 55%,#0a0a0e 100%)}`;

function shoot(name, html, scale = 1) {
  const file = path.join(build, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}</style></head><body>${html}</body></html>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, '--window-size=1920,1080', `--screenshot=${path.join(build, `${name}.png`)}`, pathToFileURL(file).href], { stdio: 'ignore' });
}

// A red rounded ring with a soft glow, w×h inside, on a transparent canvas `pad` px larger on each side.
export function renderRing(i, w, h) {
  const pad = 24;
  const [W, H] = [Math.round(w + 2 * pad), Math.round(h + 2 * pad)];
  const name = `ring-${i}`;
  const file = path.join(build, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0}html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
div{position:absolute;left:${pad}px;top:${pad}px;width:${Math.round(w)}px;height:${Math.round(h)}px;box-sizing:border-box;border:4px solid #ff6b61;border-radius:16px;
box-shadow:0 0 18px rgba(255,107,97,.55),inset 0 0 10px rgba(255,107,97,.25)}</style></head><body><div></div></body></html>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--screenshot=${path.join(build, `${name}.png`)}`, pathToFileURL(file).href], { stdio: 'ignore' });
  return { file: path.join(build, `${name}.png`), pad };
}

export function renderCards(storyboard) {
  storyboard.segments.forEach((s, i) => {
    if (s.type !== 'title') return;
    const lines = (s.lines ?? []).map(l => `<li><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="#7d9bff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.2 8.4 3 3 6.6-6.8"/></svg>${esc(l)}</li>`).join('');
    shoot(`card-${i}`, `<main style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;padding:0 200px">
${s.logo ? `<div style="display:flex;align-items:center;gap:22px">${MARK(84)}<span style="font-size:84px;font-weight:600;letter-spacing:-2.5px">${esc(s.heading)}</span></div>`
    : `<h1 style="font-size:68px;font-weight:600;letter-spacing:-1.8px;line-height:1.12;max-width:1400px">${esc(s.heading)}</h1>`}
${s.sub ? `<p style="font-size:34px;color:#a9adc4;max-width:1300px;line-height:1.35">${esc(s.sub)}</p>` : ''}
${lines ? `<ul style="list-style:none;display:flex;flex-direction:column;gap:22px;margin-top:18px;font-size:36px;color:#dfe2f2;text-align:left">${lines.replace(/<li>/g, '<li style="display:flex;align-items:center;gap:18px">')}</ul>` : ''}
${!s.logo ? `<div style="position:absolute;left:72px;bottom:56px;display:flex;align-items:center;gap:12px;font-size:26px;font-weight:600;opacity:.75">${MARK(28)}Delomu</div>` : ''}
</main>`, 2);
  });

  shoot('stage', `<div style="position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px;border-radius:${WIN.r}px;
box-shadow:0 40px 120px rgba(0,0,0,.55),0 8px 30px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.08)"></div>
<div style="position:absolute;left:72px;bottom:44px;display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600;opacity:.7">${MARK(26)}Delomu</div>`);

  // Rounded-corner alpha mask for the window.
  const { w, h, r } = WIN;
  const cx = (w - 1) / 2; const cy = (h - 1) / 2; const ix = w / 2 - r; const iy = h / 2 - r;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=black:s=${w}x${h}`, '-vf',
    `format=gray,geq=lum='if(gt(abs(X-${cx}),${ix})*gt(abs(Y-${cy}),${iy}),255*lte(hypot(abs(X-${cx})-${ix},abs(Y-${cy})-${iy}),${r}),255)'`,
    '-frames:v', '1', path.join(build, 'mask.png')]);
}
