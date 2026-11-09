// Screenshots a list of pages of a running local Grapim in four variants (desktop/phone x light/dark).
// usage: node .impeccable/shot-walk.mjs <base> <session-cookie-value> <out-dir> <name=path> [name=path ...]
// A name ending in "!" is shot desktop-light only.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const [base, session, out, ...pairs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
let target; for (let i = 0; i < 80 && !target; i++) { await wait(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiters = new Map(); const ev = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id) waiters.get(d.id)?.(d); else ev.push(d.method); });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiters.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
const host = new URL(base).hostname;
if (session && session !== '-') await send('Network.setCookie', { name: 'delomu_session', value: session, domain: host, path: '/' });
const variants = [['desktop-light', 1440, 900, 'light'], ['desktop-dark', 1440, 900, 'dark'], ['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark']];
for (const pair of pairs) {
  const i = pair.indexOf('='); let name = pair.slice(0, i); const url = pair.slice(i + 1);
  const only = name.endsWith('!'); if (only) name = name.slice(0, -1);
  for (const [v, w, h, scheme] of only ? variants.slice(0, 1) : variants) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    ev.length = 0; await send('Page.navigate', { url: base + url });
    for (let k = 0; k < 60 && !ev.includes('Page.loadEventFired'); k++) await wait(100); await wait(500);
    const m = await send('Page.getLayoutMetrics'); const fh = Math.min(5000, Math.ceil(m.result.cssContentSize.height));
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: fh, scale: 1 } });
    fs.writeFileSync(path.join(out, `${name}--${v}.png`), Buffer.from(s.result.data, 'base64'));
  }
  console.log('shot', name);
}
await send('Browser.close'); chrome.kill(); process.exit(0);
