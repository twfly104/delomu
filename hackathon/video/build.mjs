// Builds the narrated 1080p demo video from storyboard.json: title cards with a slow push-in, and app
// screens shown as a floating window on a dark stage. The camera moves between elements on the narrated
// word that names them, captions follow the spoken words, and a quiet music bed sits under the voice.
// Steps: node capture.mjs … (screens), then this script. Voice lines come from tts.py (edge-tts).
// usage: node hackathon/video/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderCards, renderRing, WIN } from './cards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, 'build');
const board = JSON.parse(fs.readFileSync(path.join(here, 'storyboard.json'), 'utf8'));
const rects = JSON.parse(fs.readFileSync(path.join(build, 'rects.json'), 'utf8'));
const FPS = 30;
const LEAD = 0.35;
const TAIL = 0.85;
const MOVE = 0.85; // seconds for one camera move
const CUE = 0.2; // a move starts this long before its word, so the picture lands with the voice
const FONT = 'C\\:/Windows/Fonts/segoeui.ttf';

const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const duration = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const ffPath = p => p.replace(/\\/g, '/').replace(':', '\\:');
const norm = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');

// The spoken line as an mp3 plus the time of every word; cached by voice, rate and text.
function voice(text) {
  const key = crypto.createHash('sha1').update(`${board.voice}|${board.rate}|${text}`).digest('hex').slice(0, 12);
  const dir = path.join(build, 'voice');
  const media = path.join(dir, `${key}.mp3`);
  const words = path.join(dir, `${key}.json`);
  fs.mkdirSync(dir, { recursive: true });
  for (let a = 0; !(fs.existsSync(words) && fs.statSync(media).size > 1000); a++) {
    try { execFileSync('python', [path.join(here, 'tts.py'), board.voice, board.rate, text, media, words], { stdio: 'pipe' }); } catch (e) { if (a === 3) throw e; }
  }
  return { media, words: JSON.parse(fs.readFileSync(words, 'utf8')) };
}

// Start time (segment seconds) of the first spoken word that begins with `token`, after `after`.
function wordAt(words, token, after = 0) {
  const w = words.find(x => LEAD + x.start >= after && norm(x.word).startsWith(norm(token)));
  if (!w) throw new Error(`no word "${token}" after ${after}s in: ${words.map(x => x.word).join(' ')}`);
  return LEAD + w.start;
}

// A camera rectangle (CSS px) around an element, at the window's aspect ratio, inside the page.
function frame(shot, key) {
  const [, , pageW, pageH] = rects[shot].page;
  const r = key === 'viewport' ? [0, 0, 1280, 800] : rects[shot][key];
  if (!r) throw new Error(`no rect ${shot}.${key}`);
  const aspect = WIN.w / WIN.h;
  const pad = 36;
  let w = Math.min(pageW, 1280, Math.max(r[2] + 2 * pad, (r[3] + 2 * pad) * aspect, 600));
  let h = w / aspect;
  if (h > pageH) { h = pageH; w = h * aspect; }
  const x = Math.min(Math.max(r[0] + r[2] / 2 - w / 2, 0), pageW - w);
  const y = Math.min(Math.max(r[1] + Math.min(r[3], h) / 2 - h / 2, 0), pageH - h);
  return { x, y, w, h };
}

// Captions: the script's own words (edge-tts drops punctuation), timed by the spoken words, in phrases of
// at most ~64 characters that break after a sentence, each shown from its first word.
function captionFilter(i, text, words, D) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let j = 0;
  const timed = tokens.map(token => {
    const want = norm(token);
    const start = words[j] ? LEAD + words[j].start : D;
    for (let got = ''; j < words.length && got.length < want.length && want.startsWith(got + norm(words[j].word));) got += norm(words[j++].word);
    return { token, start };
  });
  const phrases = [];
  for (const t of timed) {
    const last = phrases.at(-1);
    if (last && `${last.text} ${t.token}`.length <= 64 && !/[.!?:]$/.test(last.text)) { last.text += ` ${t.token}`; continue; }
    phrases.push({ text: t.token, start: t.start });
  }
  return phrases.map((p, n) => {
    const file = path.join(build, `caption-${i}-${n}.txt`);
    fs.writeFileSync(file, p.text);
    const from = n === 0 ? 0 : p.start - 0.08;
    const to = n === phrases.length - 1 ? D : phrases[n + 1].start - 0.08;
    return `drawtext=fontfile='${FONT}':textfile='${ffPath(file)}':fontsize=32:fontcolor=0xE9EAF4:x=(w-text_w)/2:y=${WIN.y + WIN.h + 40}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`;
  }).join(',');
}

// A slow push-in on the 2x card. perspective samples at sub-pixel precision; zoompan rounds its crop to
// whole pixels, which made the text step unevenly from frame to frame.
function pushIn(frames) {
  const half = (side, sign) => `${side}/2${sign}${side}/2/(1+0.03*on/${frames})`;
  const [l, r, t, b] = [half('W', '-'), half('W', '+'), half('H', '-'), half('H', '+')];
  return `perspective=x0='${l}':y0='${t}':x1='${r}':y1='${t}':x2='${l}':y2='${b}':x3='${r}':y3='${b}':interpolation=cubic:eval=frame`;
}

// Camera keys [{f, t}] → perspective corners on the union canvas (2 canvas px per CSS px), each move an
// eased step that starts at t and lasts MOVE seconds.
function cameraFilter(keys, ux, uy) {
  const ease = t => `((1-cos(PI*clip((on/${FPS}-${t.toFixed(3)})/${MOVE},0,1)))/2)`;
  const track = get => keys.slice(1).reduce((e, k, n) => `${e}+(${(get(k.f) - get(keys[n].f)).toFixed(3)})*${ease(k.t)}`, get(keys[0].f).toFixed(3));
  const X = track(f => (f.x - ux) * 2), Y = track(f => (f.y - uy) * 2), W = track(f => f.w * 2), H = track(f => f.h * 2);
  return `perspective=x0='${X}':y0='${Y}':x1='${X}+${W}':y1='${Y}':x2='${X}':y2='${Y}+${H}':x3='${X}+${W}':y3='${Y}+${H}':interpolation=cubic:eval=frame`;
}

renderCards(board);
const parts = [];
let clock = 0;
board.segments.forEach((s, i) => {
  const { media, words } = voice(s.say);
  const D = +(LEAD + duration(media) + TAIL).toFixed(2);
  const frames = Math.round(D * FPS);
  const out = path.join(build, `seg-${i}.mp4`);
  const audioFilter = `[1:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,atrim=0:${D},afade=t=in:st=0:d=0.15,afade=t=out:st=${D - 0.25}:d=0.25[a]`;
  // Dip to black only around title cards; screen to screen is a straight cut.
  const titleNear = n => !board.segments[n] || board.segments[n].type === 'title';
  const fades = [titleNear(i - 1) || s.type === 'title' ? 'fade=t=in:st=0:d=0.3' : null,
    titleNear(i + 1) || s.type === 'title' ? `fade=t=out:st=${D - 0.3}:d=0.3` : null].filter(Boolean).join(',') || 'null';
  const captions = captionFilter(i, s.say, words, D);
  const encode = ['-map', '[v]', '-map', '[a]', '-t', String(D), '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out];

  if (s.type === 'title') {
    ff(['-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, `card-${i}.png`), '-i', media, '-filter_complex',
      `[0:v]${pushIn(frames)},scale=1920:1080:flags=lanczos,${captions},${fades},format=yuv420p[v];${audioFilter}`, ...encode]);
  } else {
    // Camera keys: the first frame holds from 0; each later one moves in on its word.
    const keys = [];
    for (const [key, token] of s.camera) {
      const f = frame(s.shot, key);
      if (!token) { keys.push({ f, t: 0 }); continue; }
      const prev = keys.at(-1);
      keys.push({ f, t: Math.max(prev.t + (keys.length > 1 ? MOVE + 0.1 : 0.3), wordAt(words, token, prev.t) - CUE) });
    }
    // The union of every camera frame, widened to the window's aspect; outside the page it is white.
    const aspect = WIN.w / WIN.h;
    let ux = Math.min(...keys.map(k => k.f.x)); let uy = Math.min(...keys.map(k => k.f.y));
    let uw = Math.max(...keys.map(k => k.f.x + k.f.w)) - ux; let uh = Math.max(...keys.map(k => k.f.y + k.f.h)) - uy;
    if (uw / uh < aspect) { const nw = uh * aspect; ux -= (nw - uw) / 2; uw = nw; } else { const nh = uw / aspect; uy -= (nh - uh) / 2; uh = nh; }
    const [, , pageW, pageH] = rects[s.shot].page;
    const pad = { l: Math.max(0, -ux), t: Math.max(0, -uy) };
    const cropX = Math.max(0, ux) * 2; const cropY = Math.max(0, uy) * 2;
    const cropW = Math.min(pageW, ux + uw) * 2 - cropX; const cropH = Math.min(pageH, uy + uh) * 2 - cropY;
    const inputs = ['-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, 'stage.png'), '-i', media,
      '-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, 'shots', `${s.shot}.png`),
      '-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, 'mask.png')];
    let graph = `[2:v]crop=${Math.round(cropW)}:${Math.round(cropH)}:${Math.round(cropX)}:${Math.round(cropY)},`
      + `pad=${Math.round(uw * 2)}:${Math.round(uh * 2)}:${Math.round(pad.l * 2)}:${Math.round(pad.t * 2)}:color=white,`
      + `${cameraFilter(keys, ux, uy)},scale=${WIN.w}:${WIN.h}:flags=lanczos,format=rgba[shot];`
      + `[3:v]format=gray[m];[shot][m]alphamerge[win];[0:v][win]overlay=${WIN.x}:${WIN.y}[base]`;
    let last = 'base';
    if (s.ring) {
      // A red ring around a broken answer, once the camera has come to rest on it.
      const [key, token] = s.ring;
      const r = rects[s.shot][key];
      const k = [...keys].reverse().find(x => x.t <= wordAt(words, token));
      const scale = WIN.w / k.f.w;
      const box = { x: WIN.x + (r[0] - k.f.x) * scale - 12, y: WIN.y + (r[1] - k.f.y) * scale - 12, w: r[2] * scale + 24, h: r[3] * scale + 24 };
      const t = Math.max(wordAt(words, token) - 0.1, k.t + MOVE);
      const ring = renderRing(i, box.w, box.h);
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', ring.file);
      graph += `;[4:v]format=rgba,fade=t=in:st=${t.toFixed(2)}:d=0.3:alpha=1[ring];[base][ring]overlay=${Math.round(box.x - ring.pad)}:${Math.round(box.y - ring.pad)}[ringed]`;
      last = 'ringed';
    }
    ff([...inputs, '-filter_complex', `${graph};[${last}]${captions},${fades},format=yuv420p[v];${audioFilter}`, ...encode]);
  }
  parts.push(out);
  clock += D;
  console.log(`segment ${i + 1}/${board.segments.length} ${s.type} ${D}s`);
});

// A quiet ambient bed made here (so there is no licence to clear): a slow Cmaj9 pad whose voices drift
// in and out at different rates, low-passed and lightly echoed, mixed well under the voice.
const total = clock;
const notes = [130.81, 196.0, 246.94, 293.66, 329.63, 392.0];
const pad = notes.map((f, n) => `sine=f=${f}:d=${Math.ceil(total) + 2},volume='0.5+0.5*sin(2*PI*t/${(9 + n * 2.3).toFixed(1)}+${n})':eval=frame[n${n}]`).join(';');
const bed = path.join(build, 'bed.wav');
ff(['-filter_complex', `${pad};${notes.map((_, n) => `[n${n}]`).join('')}amix=inputs=${notes.length}:normalize=1,lowpass=f=1400,aecho=0.8:0.7:420|780:0.35|0.25,`
  + `afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3,atrim=0:${total.toFixed(2)}[out]`, '-map', '[out]', '-ar', '48000', '-ac', '2', bed]);

const list = path.join(build, 'segments.txt');
fs.writeFileSync(list, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const joined = path.join(build, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
const final = path.join(here, 'delomu-demo.mp4');
ff(['-i', joined, '-i', bed, '-filter_complex', '[1:a]volume=0.8[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final]);
const seconds = duration(final);
console.log(`wrote ${final} (${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')})`);
