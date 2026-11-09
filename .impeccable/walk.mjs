// Walks Grapim as a brand-new AI vendor on a running local server and screenshots every step in four variants
// (desktop/phone x light/dark): sign-up, the /welcome wizard, sample agent, first check, drafted fix, approve,
// re-check, rollout, sign-off link, the client's sign-off page, handover, questionnaire, settings.
// usage: node .impeccable/walk.mjs <base-url> <out-dir>
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const jar = {};
const setCookies = res => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function get(p) { const res = await fetch(base + p, { headers: { cookie: cookie() }, redirect: 'manual' }); setCookies(res); if (res.status >= 300 && res.status < 400) return get(res.headers.get('location').replace(base, '')); return { url: p, text: await res.text(), status: res.status }; }
async function post(p, body) { const res = await fetch(base + p, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'manual' }); setCookies(res); if (res.status >= 300 && res.status < 400) return get(res.headers.get('location').replace(base, '')); return { url: p, text: await res.text(), status: res.status }; }
const csrfOf = html => /name="csrf" value="([^"]+)"/.exec(html)?.[1];
const actionOf = (html, re) => [...html.matchAll(/<form[^>]*action="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).find(a => re.test(a));

// Headless Chrome for the shots.
const port = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
let target; for (let i = 0; i < 80 && !target; i++) { await wait(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiters = new Map(); const ev = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id) waiters.get(d.id)?.(d); else ev.push(d.method); });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiters.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
const variants = [['desktop-light', 1440, 900, 'light'], ['desktop-dark', 1440, 900, 'dark'], ['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark']];
let n = 0;
async function shot(name, url, { only } = {}) {
  const host = new URL(base).hostname;
  await send('Network.clearBrowserCookies');
  for (const [k, v] of Object.entries(jar)) await send('Network.setCookie', { name: k, value: v, domain: host, path: '/' });
  const label = `${String(++n).padStart(2, '0')}-${name}`;
  for (const [v, w, h, scheme] of only ? variants.slice(0, 1) : variants) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    ev.length = 0; await send('Page.navigate', { url: base + url });
    for (let k = 0; k < 60 && !ev.includes('Page.loadEventFired'); k++) await wait(100); await wait(400);
    const m = await send('Page.getLayoutMetrics'); const fh = Math.min(6000, Math.ceil(m.result.cssContentSize.height));
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: fh, scale: 1 } });
    fs.writeFileSync(path.join(out, `${label}--${v}.png`), Buffer.from(s.result.data, 'base64'));
  }
  console.log('shot', label, url);
}
const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// 1. Sign up.
let page = await get('/signup');
await shot('signup', '/signup');
page = await post('/signup', { csrf: csrfOf(page.text), email: `walk${Date.now()}@example.com`, company: 'Northwind Agents', kind: 'vendor' });
log('signed up ->', page.url);
await shot('welcome-client', '/welcome', {}); // note: the one-time key was consumed by the GET above
// 2. Client.
page = await get('/welcome');
page = await post(actionOf(page.text, /\/clients$/), { csrf: csrfOf(page.text), next: 'welcome', name: 'Harbor Bank (sample)' });
await shot('welcome-agent', '/welcome');
// 3. Sample agent.
page = await get('/welcome');
page = await post(actionOf(page.text, /sample-agent$/), { csrf: csrfOf(page.text) });
await shot('welcome-check', '/welcome');
// 4. First check.
page = await get('/welcome');
const scanAction = actionOf(page.text, /\/scan$/);
const dep = scanAction.replace(/\/scan$/, '');
await post(scanAction, { csrf: csrfOf(page.text) });
const started = Date.now(); let shotMid = false;
for (;;) {
  await wait(3000);
  page = await get(`${dep}/scan`);
  if (!shotMid && Date.now() - started > 25000) { shotMid = true; await shot('check-running', `${dep}/scan`, { only: true }); }
  if (!/Checking…/.test(page.text) || Date.now() - started > 600000) break;
}
log('first check done in', Math.round((Date.now() - started) / 1000), 's');
await shot('check-result', `${dep}/scan`);
// 5. Fix, when a rule broke.
if (/fix\/draft/.test(page.text)) {
  page = await post(`${dep}/fix/draft`, { csrf: csrfOf(page.text) });
  log('fix drafted');
  await shot('fix-proposed', `${dep}/scan`);
  page = await get(`${dep}/scan`);
  const instructions = /<textarea name="instructions"[^>]*>([\s\S]*?)<\/textarea>/.exec(page.text)?.[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') ?? '';
  const mode = /name="mode" value="apply"/.test(page.text) ? 'apply' : 'manual';
  page = await post(`${dep}/fix/approve`, { csrf: csrfOf(page.text), instructions, mode });
  const s2 = Date.now(); let mid = false;
  for (;;) {
    await wait(3000); page = await get(`${dep}/scan`);
    if (!mid && Date.now() - s2 > 15000) { mid = true; await shot('recheck-running', `${dep}/scan`, { only: true }); }
    if (!/Checking…|Re-checking/.test(page.text) || Date.now() - s2 > 600000) break;
  }
  log('re-check done in', Math.round((Date.now() - s2) / 1000), 's');
  await shot('recheck-result', `${dep}/scan`);
} else log('no rule broke: no fix to draft');
// 6. Home, rollout, sign-off link (made by clicking in the browser, so the once-shown link is captured).
await shot('home', '/');
await shot('rollout', `${dep}/rollout`);
async function clickShot(name, url, selector) {
  const host = new URL(base).hostname;
  await send('Network.clearBrowserCookies');
  for (const [k, v] of Object.entries(jar)) await send('Network.setCookie', { name: k, value: v, domain: host, path: '/' });
  const label = `${String(++n).padStart(2, '0')}-${name}`;
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  ev.length = 0; await send('Page.navigate', { url: base + url });
  for (let k = 0; k < 60 && !ev.includes('Page.loadEventFired'); k++) await wait(100);
  ev.length = 0; await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)}).click()` });
  for (let k = 0; k < 80 && !ev.includes('Page.loadEventFired'); k++) await wait(100); await wait(500);
  const href = (await send('Runtime.evaluate', { expression: 'location.pathname + "|" + (document.querySelector("[data-copy-src]")?.value ?? "")', returnByValue: true })).result.result.value;
  const m = await send('Page.getLayoutMetrics'); const fh = Math.min(6000, Math.ceil(m.result.cssContentSize.height));
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: fh, scale: 1 } });
  fs.writeFileSync(path.join(out, `${label}--desktop-light.png`), Buffer.from(s.result.data, 'base64'));
  console.log('shot', label, href);
  return href;
}
const made = await clickShot('rollout-link-made', `${dep}/rollout`, 'form[action$="/signoff/link"] button');
const link = /\/signoff\/[A-Za-z0-9_-]{20,}/.exec(made)?.[0];
log('sign-off link', link);
// 7. What the client sees (opened by the browser, which counts as the client opening it).
if (link) {
  const saved = { ...jar }; for (const k of Object.keys(jar)) delete jar[k];
  await shot('client-signoff', link);
  await shot('client-handover', `${link}/handover`);
  Object.assign(jar, saved);
  await shot('rollout-opened', `${dep}/rollout`, { only: true });
  await shot('check-result-after-link', `${dep}/scan`, { only: true });
}
await shot('handover', `${dep}/handover`);
await shot('questionnaire', `${dep}/questionnaire`);
await shot('settings', `${dep}/settings`);
await shot('live', `${dep}/live`);
if (link) {
  await clickShot('rollout-revoked', `${dep}/rollout`, 'form[action$="/signoff/revoke"] button');
  const saved = { ...jar }; for (const k of Object.keys(jar)) delete jar[k];
  await shot('client-link-closed', link);
  Object.assign(jar, saved);
}
fs.writeFileSync(path.join(out, 'walk.json'), JSON.stringify({ dep, link, at: new Date().toISOString() }, null, 2));
await send('Browser.close'); chrome.kill(); process.exit(0);
