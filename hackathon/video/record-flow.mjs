// Records one continuous take of a scripted flow through Delomu in headless Chrome (DevTools screencast) and
// writes the raw MP4 plus marks.json (the time each step started), so build-flow can speed up the waits and add
// captions. Real clicks and typing, real timing, nothing staged.
// usage: node hackathon/video/record-flow.mjs <base> <steps.json> <out-dir>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const [base, stepsFile, outDir] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(outDir, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${profile}`, '--hide-scrollbars', '--lang=en-US', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  await new Promise(r => setTimeout(r, 200));
  try { target = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find(t => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiters = new Map();
const frames = [];
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowframes-'));
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiters.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.addEventListener('message', m => {
  const d = JSON.parse(m.data);
  if (d.id) { waiters.get(d.id)?.(d); return; }
  if (d.method === 'Page.screencastFrame') {
    const file = path.join(frameDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(d.params.data, 'base64'));
    frames.push({ file, t: d.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: d.params.sessionId } }));
  }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`page script failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};
const text = () => js('document.body.innerText');
const navigate = async url => { await send('Page.navigate', { url }); await sleep(1200); };

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await navigate(base + steps[0].go);
await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
const marks = [];
const now = () => Date.now() / 1000;
const vars = {};

// Moves a visible cursor dot to the element first, so a viewer sees where the click lands.
const CURSOR = `(() => { let c = document.getElementById('__cur'); if (!c) { c = document.createElement('div'); c.id = '__cur'; c.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(43,89,255,.35);border:2px solid #2b59ff;pointer-events:none;transition:left .45s cubic-bezier(.16,1,.3,1),top .45s cubic-bezier(.16,1,.3,1);left:640px;top:400px'; document.body.appendChild(c); } return c; })()`;
const findJs = (sel, label) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent !== null && (e.innerText || e.value || '').trim().includes(${JSON.stringify(label)}))`;

for (const step of steps.slice(1)) {
  if (step.mark) marks.push({ label: step.mark, caption: step.caption ?? '', speed: step.speed ?? 1, t: now() });
  // /__SCAN__ and /__ROLLOUT__ are the current agent's pages; /__CLIENTS__ is the vendor's Clients page.
  if (step.go === '/__SCAN__' || step.go === '/__ROLLOUT__') {
    const dep = await js(`location.pathname.match(/^\\/orgs\\/[^/]+\\/deployments\\/[^/]+/)[0]`);
    vars.dep = dep;
    await navigate(base + dep + (step.go === '/__SCAN__' ? '/scan' : '/rollout'));
  } else if (step.go === '/__CLIENTS__') {
    if (vars.dep) await navigate(base + vars.dep + '/rollout');
    await navigate(base + (await js(`[...document.querySelectorAll('a')].find(a => /\\/orgs\\/[^/]+$/.test(a.getAttribute('href') || '') && a.innerText.includes('Brightdesk AI')).getAttribute('href')`)));
  } else if (step.go) await navigate(base + step.go);
  if (step.goVar) await navigate(vars[step.goVar]);
  if (step.wait) await sleep(step.wait * 1000);
  if (step.fill) {
    await js(`(() => { const e = document.querySelector(${JSON.stringify(step.fill)}); e.scrollIntoView({ block: 'center' }); e.focus(); return true; })()`);
    for (const ch of step.value) { await js(`(() => { const e = document.activeElement; e.value += ${JSON.stringify(ch)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await sleep(45); }
    await sleep(300);
  }
  if (step.check) await js(`(() => { const e = document.querySelector(${JSON.stringify(step.check)}); e.click(); return true; })()`);
  if (step.click) {
    const sel = step.selector ?? 'button, a, label';
    await js(`(() => { const e = ${findJs(sel, step.click)}; if (!e) throw new Error('no element with text ${step.click.replace(/'/g, '')}'); e.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; })()`);
    await sleep(700);
    await js(`(() => { const c = ${CURSOR}; const r = (${findJs(sel, step.click)}).getBoundingClientRect(); c.style.left = (r.left + r.width / 2) + 'px'; c.style.top = (r.top + r.height / 2) + 'px'; return true; })()`);
    await sleep(650);
    await js(`(() => { (${findJs(sel, step.click)}).click(); return true; })()`);
    await sleep(1500);
  }
  if (step.scrollTo) {
    await js(`(() => { const e = ${findJs(step.selector ?? 'h1, h2, h3, p, section, a, span, div', step.scrollTo)}; if (e) e.scrollIntoView({ block: ${JSON.stringify(step.block ?? 'start')}, behavior: 'smooth' }); return true; })()`);
    await sleep((step.hold ?? 2) * 1000);
  }
  if (step.scrollBy) {
    await js(`window.scrollBy({ top: ${step.scrollBy}, behavior: 'smooth' })`);
    await sleep((step.hold ?? 1.5) * 1000);
  }
  if (step.readInput) vars[step.as] = await js(`[...document.querySelectorAll('input')].map(i => i.value).find(v => v.includes(${JSON.stringify(step.readInput)}))`);
  if (step.until) {
    const deadline = now() + (step.max ?? 300);
    let seenStart = !step.after;
    while (now() < deadline) {
      const t = await text();
      if (!seenStart && new RegExp(step.after).test(t)) seenStart = true;
      if (seenStart && new RegExp(step.until).test(t)) break;
      await sleep(1000);
    }
    await sleep((step.hold ?? 1) * 1000);
  }
  console.log('step', JSON.stringify(step).slice(0, 90));
}
marks.push({ label: 'end', t: now() });
await send('Page.stopScreencast');
ws.close();
chrome.kill();

const t0 = frames[0].t;
fs.writeFileSync(path.join(outDir, 'marks.json'), JSON.stringify(marks.map(m => ({ ...m, t: Math.max(0, m.t - t0) })), null, 2));
const list = frames.map((f, i) => `file '${f.file.replace(/\\/g, '/')}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file.replace(/\\/g, '/')}'\n`;
fs.writeFileSync(path.join(frameDir, 'list.txt'), list);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frameDir, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', path.join(outDir, 'raw.mp4')]);
console.log(`${frames.length} frames over ${(frames.at(-1).t - t0).toFixed(1)} s -> ${path.join(outDir, 'raw.mp4')}`);
