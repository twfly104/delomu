// Records the landing video's raw footage on a running local Grapim server with the real model: a vendor runs the
// first check on the sample agent (quick depth), opens a broken reply and a high-risk rule's pressure conversation,
// approves the fix Grapim drafted, re-checks until every rule is kept, creates the sign-off link; then the client
// does the guided review (one rule per screen, one question asked) and accepts; it ends on the evidence pack.
// Frames (CDP screencast, with timestamps) go to <out>/frames; step marks, the box of what each shot is about (the
// camera framing) and the real numbers go to <out>/marks.json, which video/scripts/build-real.mjs turns into the
// GrapimReal composition's inputs.
//
// usage: node .impeccable/rec-video.mjs <out-dir> <server data dir> [base-url, default http://localhost:8810]
// Keep only a run where a pressure conversation gave in on message 2 or later (one fresh server data dir per run,
// since the account's address is fixed): REQUIRE_GAVE_IN=1 MIN_TURNS=2 node .impeccable/rec-video.mjs ...  (exit 3 otherwise)
// The server: DELOMU_SIGNUP=open DELOMU_KEY_PEPPER=... node --env-file=examples/linden-agent/.env bin/delomu.mjs serve --port 8810 --data <data dir>
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const [out, DATA, base = 'http://localhost:8810'] = process.argv.slice(2);
if (!out || !DATA) { console.error('usage: node .impeccable/rec-video.mjs <out-dir> <server data dir> [base-url]'); process.exit(1); }
// A narrow window, so long blocks (the fix, a conversation turn) wrap and one block can be framed close.
const W = 1024, H = 720;
fs.rmSync(path.join(out, 'frames'), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--hide-scrollbars', '--lang=en-US', '--force-device-scale-factor=2', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 50 && !t; i++) { await wait(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const frames = []; const marks = []; const facts = {};
const t0 = Date.now(); const now = () => (Date.now() - t0) / 1000;
const send = (method, params = {}) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.addEventListener('message', m => {
  const d = JSON.parse(m.data);
  if (d.id) return pend.get(d.id)?.(d);
  if (d.method === 'Page.screencastFrame') {
    const f = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(out, 'frames', f), Buffer.from(d.params.data, 'base64'));
    frames.push({ f, t: now() });
    send('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  }
});
const mark = (name, extra = {}) => { marks.push({ name, t: now(), ...extra }); console.log(now().toFixed(1), name, Object.keys(extra).length ? JSON.stringify(extra).slice(0, 300) : ''); };
const ev = async expr => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), wait(15000).then(() => ({ result: { result: { value: undefined } } }))]); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };

// A visible cursor on every page, kept where it was across reloads (the check page refreshes itself every 2 s).
const CURSOR = `(() => { const add = () => { if (document.getElementById('rec-cur')) return; const c = document.createElement('div'); c.id = 'rec-cur';
  let p = { x: ${W * 0.62}, y: ${H * 0.6} }; try { p = JSON.parse(sessionStorage.getItem('rec-cur')) || p; } catch {}
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-7 1.6L9 20.5Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: p.x + 'px', top: p.y + 'px', zIndex: 2147483647, pointerEvents: 'none', transition: 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), transform .12s', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.3))' });
  document.documentElement.appendChild(c); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add(); })();`;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Page.setBypassCSP', { enabled: true });
// 2x pixel density (with --force-device-scale-factor=2 the screencast frames really are 2x), so the video can zoom
// into one element and stay sharp. Boxes are CSS pixels.
const DPR = 2;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: CURSOR });

const loaded = async () => { for (let k = 0; k < 80; k++) { await wait(150); if (await ev(`document.readyState === 'complete' && !!document.getElementById('rec-cur')`).catch(() => false)) return; } };
const go = async url => { await Promise.race([send('Page.navigate', { url: base + url }), wait(15000)]); await loaded(); await wait(500); };
// The camera: each shot frames the elements that matter. `els` is a page expression for an array of elements; their
// union box (of their content, not their full-width block; viewport pixels = recording pixels) is stored with the mark, and GrapimReal crops the recording to it.
const UNION = `(els => { els = els.flat().filter(Boolean); const rs = els.map(e => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return r.width && r.height ? r : e.getBoundingClientRect(); }).filter(r => r.width || r.height); if (!rs.length) return null; const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top)); return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...rs.map(r => r.right)) - x), h: Math.round(Math.max(...rs.map(r => r.bottom)) - y) }; })`;
// A framing that fails is logged and the shot keeps the previous camera, so a long real run is never lost to it.
const boxOf = els => ev(`${UNION}(${els})`).catch(e => { console.log('no box:', e.message.slice(0, 160)); return null; });
// Jumps the page (no smooth scroll: shots change at cuts) so the elements' top sits `top` px down, then marks the shot.
const focus = async (name, els, { top = 120, extra = {}, settle = 250 } = {}) => {
  const b0 = await boxOf(els);
  if (!b0) { console.log('nothing to frame for', name); mark(name, extra); return; }
  await ev(`scrollBy({ top: ${b0.y} - ${top}, behavior: 'instant' }); true`);
  await wait(settle);
  mark(name, { box: await boxOf(els), ...extra });
};
// Moves the camera within a shot, without scrolling.
const look = async els => { const box = await boxOf(els); if (box) mark('cam', { box }); };
const glide = async (x, y) => { await ev(`(() => { const c = document.getElementById('rec-cur'); c.style.left = '${x}px'; c.style.top = '${y}px'; sessionStorage.setItem('rec-cur', JSON.stringify({ x: ${x}, y: ${y} })); })()`); };
// Glides the cursor to the element (jumping the page first if it is off screen), presses and clicks. The camera stays.
const point = async (sel, { click = true, pause = 450 } = {}) => {
  const r = await ev(`(() => { const e = ${sel}; if (!e) return null; const b0 = e.getBoundingClientRect(); let moved = false; if (b0.top < 60 || b0.bottom > innerHeight - 40) { scrollBy({ top: b0.top - innerHeight / 2, behavior: 'instant' }); moved = true; } const b = e.getBoundingClientRect(); return { x: b.left + Math.min(b.width * 0.5, 60), y: b.top + Math.min(b.height * 0.55, 20), moved }; })()`);
  if (!r) throw new Error('not found: ' + sel);
  await glide(r.x, r.y);
  await wait(800 + pause);
  if (click) { await ev(`(() => { const c = document.getElementById('rec-cur'); c.style.transform = 'scale(.82)'; setTimeout(() => c.style.transform = '', 140); })()`); await wait(160); await ev(`(${sel}).click()`); }
};
const typeInto = async (sel, text) => { await point(sel, { click: false, pause: 150 }); await ev(`(${sel}).focus()`); for (const ch of text) { await ev(`(() => { const e = ${sel}; e.value += ${JSON.stringify(ch)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(40); } };
const until = async (expr, ms, every = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await wait(every); } return false; };
const text = () => ev('document.body.innerText');
const q = s => `document.querySelector(${JSON.stringify(s)})`;
const qa = s => `[...document.querySelectorAll(${JSON.stringify(s)})]`;
const byText = (s, re) => `${qa(s)}.find(e => ${re}.test(e.innerText.trim()))`;

// --- setup (not recorded): a vendor account with a neutral test address (the client's pages show it), its client
// and the sample agent, up to the wizard's last step.
const jar = new Map(); const keep = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } return r; };
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const fget = async u => keep(await fetch(base + u, { headers: { cookie: ck() }, redirect: 'manual' }));
const fpost = async (u, b) => keep(await fetch(base + u, { method: 'POST', redirect: 'manual', headers: { cookie: ck(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b) }));
const csrf = h => /name="csrf" value="([^"]+)"/.exec(h)?.[1];
const actionOf = (h, re) => [...h.matchAll(/<form[^>]*action="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).find(a => re.test(a));
const sp = await (await fget('/signup')).text();
await fpost('/signup', { csrf: csrf(sp), email: process.env.REC_EMAIL ?? 'sam@acme-ai.example', company: 'Acme AI', kind: 'vendor' });
let wz = await (await fget('/welcome')).text();
await fpost(actionOf(wz, /\/clients$/), { csrf: csrf(wz), next: 'welcome', name: 'Linden & Co.' });
wz = await (await fget('/welcome')).text();
await fpost(actionOf(wz, /sample-agent$/), { csrf: csrf(wz) });
wz = await (await fget('/welcome')).text();
const dep = actionOf(wz, /\/scan$/).replace(/\/scan$/, '');
const depDir = path.join(DATA, 'deployments', dep.split('/')[2], dep.split('/').pop());
const scans = () => { try { return fs.readdirSync(path.join(depDir, 'scans')).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(depDir, 'scans', f), 'utf8'))); } catch { return []; } };
for (const [k, v] of jar) await send('Network.setCookie', { name: k, value: v, url: base });
console.log('deployment', dep);

// --- 1. the first check
await go('/welcome');
// Every frame while something happens; every 8th while a check runs (it plays many times faster, and the 2x frames are big).
const cast = async (nth = 1) => { await send('Page.stopScreencast'); await send('Page.startScreencast', { format: 'jpeg', quality: 86, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: nth }); };
await cast();
const RUN = `${qa('form[action$="/scan"] button')}[0]`;
// the wizard's card: the run button's widest ancestor that is still card-sized
await focus('welcome', `[(() => { let e = ${RUN}; while (e.parentElement && e.parentElement.getBoundingClientRect().width < 700) e = e.parentElement; return e.querySelector('h1'); })(), ${RUN}]`, { top: 220 });
await wait(1200);
mark('run'); await point(RUN, { pause: 600 });
await until(`!!document.querySelector('.scan-live')`, 20000, 300); await loaded();
const LIVE = `[${q('.scan-live .live-head .big')}, ${q('.scan-live p.muted')}, ${q('.scan-live .probegrid')}, ${q('.scan-live .legend')}]`;
// while answers are judged: the live timeline, one row per rule (older builds: the grid of answer tiles)
const RUNLINE = `[${q('.scan-live .live-head .big')}, ${q('.scan-live .runline')} || ${q('.scan-live .probegrid')}]`;
await focus('checking', LIVE, { top: 240 });
await cast(8);
// A full check says 'Found N rules' while it writes the messages; the quick sample check goes straight to judging.
for (let k = 0; k < 900; k++) {
  const tx = await text().catch(() => '');
  if (!marks.some(m => m.name === 'found') && /Found (\d+) rules/.test(tx)) await focus('found', LIVE, { top: 240, extra: { found: Number(/Found (\d+) rules/.exec(tx)[1]) } });
  if (!marks.some(m => m.name === 'judging') && /Judging (\d+) answers/.test(tx)) await focus('judging', RUNLINE, { top: 150, extra: { total: Number(/Judging (\d+) answers/.exec(tx)[1]) } });
  if (marks.some(m => m.name === 'judging') && !marks.some(m => m.name === 'drafting') && /Drafting the fix/.test(tx)) mark('drafting');
  if (!(await ev(`!!document.querySelector('.scan-live')`).catch(() => true))) break;
  await wait(500);
}
await cast(); await loaded(); await wait(600);
const first = scans()[0];
facts.initial = first.summary;
facts.highRisk = first.rules.filter(r => r.severity === 'high').length;
// The pressure conversation where the agent gave in, found first so a run without one stops early.
const conv = await ev(`(() => { const t = document.querySelector('.pturn.broke'); const c = t ? t.closest('.pconv') : document.querySelector('.pconv'); if (!c) return null; const d = c.closest('details'); if (d) d.open = true; c.id = 'rec-conv'; const turns = [...c.querySelectorAll('.pturn')]; return { cap: c.querySelector('.cap').innerText, rule: c.closest('section.panel')?.querySelector('h3')?.innerText ?? '', gaveIn: !!t, turns: turns.length, brokeAt: t ? turns.indexOf(t) + 1 : null }; })()`);
facts.pressure = conv;
// The pressure conversations go to the first high-risk rules the model lists; the agent gives in on one only when
// it lands on a rule the agent breaks. With REQUIRE_GAVE_IN=1 a run without one that gave in on message MIN_TURNS
// or later (default 2) stops here (exit 3), to run again.
if (process.env.REQUIRE_GAVE_IN && !(conv?.gaveIn && conv.brokeAt >= Number(process.env.MIN_TURNS ?? 2))) { console.log('no pressure conversation that gave in late enough', JSON.stringify(conv)); await send('Page.stopScreencast'); await send('Browser.close'); chrome.kill(); process.exit(3); }
// the verdict, with the first rule tiles under it
// the video opens here, close on the verdict, then widens to the first rule tiles
await focus('results', `[${q('.verdict')}, ${q('.scan-head .meta')}]`, { top: 220 });
await wait(1500);
await look(`[${q('.verdict')}, ${qa('.rulemap .rt')}.slice(0, 3)]`);
await wait(1600);
// one broken reply: the rule and what the customer wrote, then the reply
const PROBE = `${qa('.probe.broken:not(.is-conv)')}[0]`;
await focus('broken', `[${PROBE}.closest('section').querySelector('h3'), ${PROBE}.children[0]]`, { top: 160 });
await wait(1300);
await look(`[${PROBE}.children[1]]`);
await glide(...(await ev(`(() => { const b = ${PROBE}.children[1].getBoundingClientRect(); return [b.left + 40, b.bottom - 14]; })()`)));
await wait(1900);
if (conv) {
  // the turns before the one where it gave in, then that turn
  const TURNS = qa('#rec-conv .pturn');
  const k = (conv.brokeAt ?? conv.turns) - 1;
  await focus('pressure', k > 0 ? `[${q('#rec-conv .cap')}, ${TURNS}.slice(${Math.max(0, k - 2)}, ${k})]` : `[${q('#rec-conv .cap')}, ${TURNS}[${k}]]`, { top: 110, extra: conv });
  await wait(k > 0 ? 2600 : 1200);
  if (k > 0) { await ev(`(() => { const b = ${TURNS}[${k}].getBoundingClientRect(); if (b.bottom > innerHeight - 30) scrollTo({ top: scrollY + b.bottom - innerHeight + 60, behavior: 'instant' }); return true; })()`); await look(`[${TURNS}[${k}]]`); }
  await glide(...(await ev(`(() => { const b = ${TURNS}[${k}].querySelector('.pn').getBoundingClientRect(); return [b.left + 8, b.top + 8]; })()`)));
  await wait(2600);
}

// --- 2. the drafted fix, approve, re-check, until every rule is kept
for (let round = 1; round <= 4; round++) {
  if (!(await until(`!!document.querySelector('form[action$="/fix/approve"]') || !!document.querySelector('form[action$="/fix/draft"]')`, 5000))) break;
  if (!(await ev(`!!document.querySelector('form[action$="/fix/approve"]')`))) {
    await point(`document.querySelector('form[action$="/fix/draft"] button')`);
    await until(`!!document.querySelector('form[action$="/fix/approve"]')`, 180000); await loaded();
  }
  const repairs = await ev(`${qa('.fix-covers a')}.map(a => a.innerText.trim())`);
  facts['repairs' + round] = repairs;
  await focus('fix-' + round, `[${q('form[action$="/fix/approve"] h2')}, ${q('form[action$="/fix/approve"] h2')}.nextElementSibling, ${qa('.fix-covers > *')}]`, { top: 200, extra: { repairs } });
  await point(`document.querySelector('.fix-covers a') || document.querySelector('form[action$="/fix/approve"] h2')`, { click: false, pause: 1600 });
  const before = scans().length;
  mark('approve-' + round); await point(`document.querySelector('form[action$="/fix/approve"] button[name=mode]')`, { pause: 400 });
  await until(`!!document.querySelector('.scan-live')`, 20000, 300); await loaded();
  await focus('rechecking-' + round, LIVE, { top: 240 });
  await cast(8);
  // the re-check's live timeline filling in, rule by rule
  if (await until(`!!document.querySelector('.scan-live .runline') || !document.querySelector('.scan-live')`, 200000, 500) && await ev(`!!document.querySelector('.scan-live .runline')`)) {
    await focus('rejudging-' + round, RUNLINE, { top: 150 });
    await until(`!document.querySelector('.scan-live .runline')`, 200000, 400);
    mark('rejudged-' + round);
  }
  for (let k = 0; k < 200 && scans().length <= before; k++) await wait(2000);
  await until(`!document.querySelector('.scan-live')`, 120000); await wait(1200);
  const last = scans().at(-1);
  facts['recheck' + round] = last.summary;
  await cast(); await go(dep + '/scan');
  const moved = await ev(`${qa('.moved p')}.map(p => p.innerText.trim())`);
  await focus('rechecked-' + round, `[${q('.scan-head > div')}]`, { top: 200, extra: { summary: last.summary, moved } });
  await point(`document.querySelector('.moved .mv.good') || document.querySelector('.verdict')`, { click: false, pause: 2200 });
  // The story needs a clean re-check: every rule kept, none left for a person (otherwise run again).
  // (A re-check can have one rule fewer: 'No invented policy' only exists while some answer invents a term.)
  if (last.summary.broken === 0 && last.summary.unjudged) { console.log('NOT CLEAN: re-check left answers unjudged'); await send('Page.stopScreencast'); await send('Browser.close'); chrome.kill(); process.exit(4); }
  if (last.summary.broken === 0) break;
  if (round === 4) { console.log('NOT ALL KEPT'); await send('Page.stopScreencast'); await send('Browser.close'); process.exit(2); }
}
facts.final = scans().at(-1).summary;

// --- 3. the sign-off link, then the client's guided review
const MAKE = `document.querySelector('form[action$="/signoff/link"] button')`;
await focus('link', `[${MAKE}.closest('section') || ${MAKE}]`, { top: 300 });
await point(MAKE, { pause: 700 });
await loaded(); mark('link-page');
const COPY = q('[data-copy-src]');
await focus('link-made', `[${byText('p, span, label, div', /^Send this link to the client$/)}, ${COPY}, ${byText('button', /^Copy$/)}]`, { top: 330, settle: 100 });
const lm = marks.at(-1);
lm.mask = await boxOf(`[${COPY}]`);
lm.token = new URL(await ev(`${COPY}.value || ${COPY}.innerText`)).pathname.split('/').pop();
await point(COPY, { click: false, pause: 1500 });
mark('leave-rollout');
await go(`/signoff/${lm.token}`);
await focus('client', `[${q('h1')}, ${q('.rv-panel')}]`, { top: 70 });
await wait(1000);
await point(`${qa('.rv-panel a.btn')}[0]`, { pause: 500 });
await loaded();
const nRules = await ev(`document.querySelectorAll('.rv-dots a').length`);
facts.reviewRules = nRules;
const CARD_TOP = `[${q('.rv-top')}, ${q('.rv-bar')}, ${q('.rv-card h1')}, ${q('.rv-res')}]`;
for (let n = 1; n <= nRules; n++) {
  if (!(await until(`location.pathname.endsWith('/review/${n}')`, 8000, 300))) break;
  await focus('review-' + n, CARD_TOP, { top: 60 });
  if (n === 1) {
    await wait(1200);
    // the reply the client reads, their name and the 'Looks right' button
    await focus('cam', `[${q('.rv-ex > div:last-child')}, ${q('.rv-acts form')}]`, { top: 120 });
    await typeInto(`document.querySelector('form input[name=name]')`, 'Dana Lee, Linden & Co.'); await wait(300);
    await point(`${qa('.rv-acts form button.primary')}[0]`, { pause: 300 });
  } else if (n === 2) {
    await wait(900);
    await focus('ask', `[${q('.rv-acts form')}, ${q('details.rv-ask')}]`, { top: 160 });
    await point(`document.querySelector('details.rv-ask summary')`, { pause: 200 }); await wait(400);
    await look(`[${q('.rv-acts form')}, ${q('details.rv-ask')}]`);
    await typeInto(`document.querySelector('details.rv-ask textarea')`, 'Does this also cover orders placed by phone?');
    await wait(400);
    await point(`document.querySelector('details.rv-ask button')`, { pause: 300 });
  } else {
    await wait(n <= 3 ? 900 : 350);
    await point(`${qa('.rv-acts form button.primary')}[0]`, { pause: n <= 3 ? 300 : 50 });
  }
  await loaded();
}
await until(`!!document.querySelector('#decide')`, 8000, 300); await wait(400);
await ev(`(() => { const r = document.querySelector('input[name=decision][value=accepted]'); r.checked = true; const n = document.querySelector('#decide input[name=name]'); if (!n.value) n.value = 'Dana Lee, Linden & Co.'; return true; })()`);
await focus('decide', `[${q('#decide .choice')}, ${byText('#decide button', /Record my decision/)}]`, { top: 200 });
await point(`document.querySelector('input[name=decision][value=accepted]')`, { pause: 400 });
mark('accept'); await point(byText('#decide button', /Record my decision/), { pause: 400 });
await loaded(); await wait(300);
const ACCEPTED = byText('.notice', /^Accepted by/);
await focus('accepted', `[${q('.so-history')}, ${ACCEPTED}]`, { top: 160, extra: { line: await ev(`${ACCEPTED}?.innerText ?? ''`) } });
await point(ACCEPTED, { click: false, pause: 2000 });

// --- 4. the evidence pack: the client's sign-off, then the framework table's first rows
mark('evidence'); await go(dep + '/evidence.html');
// the pack is a printable document (860 px wide): read at 125% browser zoom, as on a laptop
await ev(`document.documentElement.style.zoom = '1.25'; true`); await wait(300);
const SECTION = re => `(() => { const h = ${byText('h2', re)}; const out = [h]; for (let e = h.nextElementSibling; e && e.tagName !== 'H2'; e = e.nextElementSibling) out.push(e); return out; })()`;
await focus('ev-signoff', `${SECTION(/^Client sign-off$/)}.slice(0, 2)`, { top: 200 });
await wait(2600);
await focus('ev-frameworks', `(() => { const s = ${SECTION(/common AI frameworks/)}; const t = s.map(e => e.matches('table') ? e : e.querySelector('table')).find(Boolean); return [s[0], s[1], ...[...t.querySelectorAll('tr')].slice(0, 4)]; })()`, { top: 160 });
await wait(3200);
await send('Page.stopScreencast'); mark('end');
fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify({ marks, frames, facts, initial: facts.initial, dpr: DPR, viewport: { w: W, h: H } }, null, 1));
console.log('frames', frames.length, 'facts', JSON.stringify(facts));
await send('Browser.close'); chrome.kill(); process.exit(0);
