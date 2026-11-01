// Captures the demo screens at 2x for the video and records where the key elements are, so the build
// can zoom the camera onto them. Needs the local server (docker start delomu-demo) and Chrome.
// usage: node hackathon/video/capture.mjs <apiKeyFile> <orgId> <deployment>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'build', 'shots');
fs.mkdirSync(out, { recursive: true });
const [keyFile, org, depName] = process.argv.slice(2);
const BASE = 'http://localhost:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const login = await fetch(`${BASE}/login`);
const loginCookie = login.headers.getSetCookie()[0].split(';')[0];
const csrf = /name="csrf" value="([^"]+)"/.exec(await login.text())[1];
const res = await fetch(`${BASE}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie }, body: new URLSearchParams({ csrf, api_key: fs.readFileSync(keyFile, 'utf8').trim() }) });
const session = res.headers.getSetCookie().find(c => c.startsWith('delomu_session=')).split(';')[0].split('=')[1];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--hide-scrollbars', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise(r => setTimeout(r, 200));
  try { target = (await (await fetch('http://127.0.0.1:9334/json/list')).json()).find(t => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiters = new Map();
const events = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id) waiters.get(d.id)?.(d); else events.push(d.method); });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiters.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
await send('Network.enable');
await send('Network.setCookie', { name: 'delomu_session', value: session, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
// Native controls (the file picker) follow the browser's locale; pin it so every screen reads in English.
await send('Emulation.setLocaleOverride', { locale: 'en-US' });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

const dep = `/orgs/${org}/deployments/${depName}`;
const report = path.join(here, 'build', 'report.html');
const pages = {
  home: ['/', { panel: '.panel' }],
  overview: [dep, { track: '.track', result: '.grid-2 > div:first-child .panel' }],
  inputs: [`${dep}/inputs`, { files: '.panel:has(table)' }],
  scan: [`${dep}/scan`, {
    button: '.scan-head form button', head: '.scan-head', rule1: '.stack > .panel:nth-child(1)',
    probe1: '.stack > .panel:nth-child(1) .probe:nth-of-type(2)', probe2: '.stack > .panel:nth-child(1) .probe:nth-of-type(3)',
    msg: '.stack > .panel:nth-child(1) .probe:nth-of-type(2) .bubble:not(.ai)', answer: '.stack > .panel:nth-child(1) .probe:nth-of-type(2) .bubble.ai', rule2: '.stack > .panel:nth-child(2)',
  }],
  drafts: [`${dep}/drafts`, { draft: '.draft', foot: '.draft .draft-foot' }],
  audit: [`/orgs/${org}/audit`, { records: '.panel' }],
  report: [pathToFileURL(report).href, { verdict: '.verdict', areas: 'section.panel:nth-of-type(2)' }],
};

const rects = {};
for (const [name, [url, sel]] of Object.entries(pages)) {
  events.length = 0;
  await send('Page.navigate', { url: url.startsWith('file:') ? url : BASE + url });
  for (let i = 0; i < 60 && !events.includes('Page.loadEventFired'); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 200));
  const expr = `(() => { const o = { page: [0, 0, document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
    for (const [k, s] of Object.entries(${JSON.stringify(sel)})) { const e = document.querySelector(s); if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x + scrollX, r.y + scrollY, r.width, r.height]; } }
    return JSON.stringify(o); })()`;
  const ev = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  rects[name] = JSON.parse(ev.result.result.value);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
}
fs.writeFileSync(path.join(here, 'build', 'rects.json'), JSON.stringify(rects, null, 2));
ws.close();
chrome.kill();
console.log(`captured ${Object.keys(pages).length} screens`);
