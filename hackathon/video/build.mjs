// Builds the narrated 1080p demo video from storyboard.json: title cards with a slow push-in, and app
// screens shown as a floating window on a dark stage with an eased camera move between two elements.
// Steps: node capture.mjs … (screens), then this script. Voice lines are generated with edge-tts.
// usage: node hackathon/video/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderCards, WIN } from './cards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(here, 'build');
const board = JSON.parse(fs.readFileSync(path.join(here, 'storyboard.json'), 'utf8'));
const rects = JSON.parse(fs.readFileSync(path.join(build, 'rects.json'), 'utf8'));
const FPS = 30;
const LEAD = 0.35;
const TAIL = 0.85;
const FONT = 'C\\:/Windows/Fonts/segoeui.ttf';

const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const duration = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const ffPath = p => p.replace(/\\/g, '/').replace(':', '\\:');

function voice(i, text) {
  const file = path.join(build, 'voice', `${i}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let a = 0; ; a++) {
    try { execFileSync('python', ['-m', 'edge_tts', '--voice', board.voice, `--rate=${board.rate}`, '--text', text, '--write-media', file], { stdio: 'pipe' }); return file; } catch (e) { if (a === 3) throw e; }
  }
}

// Wraps a caption to at most two lines of ~78 characters.
function wrap(text, width = 78) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    if ((lines.at(-1) + ' ' + w).trim().length > width) lines.push(w);
    else lines[lines.length - 1] = `${lines.at(-1)} ${w}`.trim();
  }
  return lines.join('\n');
}

// A camera rectangle (CSS px) around an element, at the window's aspect ratio, inside the page.
function frame(shot, key) {
  const [pageX, pageY, pageW, pageH] = rects[shot].page;
  const r = key === 'viewport' ? [0, 0, 1280, 800] : rects[shot][key];
  if (!r) throw new Error(`no rect ${shot}.${key}`);
  const aspect = WIN.w / WIN.h;
  const pad = 36;
  let w = Math.min(pageW, 1280, Math.max(r[2] + 2 * pad, (r[3] + 2 * pad) * aspect, 600));
  let h = w / aspect;
  if (h > pageH) { h = pageH; w = h * aspect; }
  const x = Math.min(Math.max(r[0] + r[2] / 2 - w / 2, pageX), pageW - w);
  const y = Math.min(Math.max(r[1] + Math.min(r[3], h) / 2 - h / 2, pageY), pageH - h);
  return { x, y, w, h };
}

// Captions in chunks of at most two lines, each shown for its share of the spoken line.
function captionFilter(i, text, spoken) {
  const sentences = text.match(/[^.!?:]+[.!?:]?/g).map(x => x.trim()).filter(Boolean);
  const chunks = [];
  for (const s of sentences) {
    const last = chunks.at(-1);
    if (last && wrap(`${last} ${s}`).split('\n').length <= 2) chunks[chunks.length - 1] = `${last} ${s}`;
    else chunks.push(s);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let at = LEAD;
  return chunks.map((c, n) => {
    const file = path.join(build, `caption-${i}-${n}.txt`);
    fs.writeFileSync(file, wrap(c));
    const from = n === 0 ? 0 : at;
    at += spoken * (c.length / total);
    const to = n === chunks.length - 1 ? 9999 : at;
    return `drawtext=fontfile='${FONT}':textfile='${ffPath(file)}':fontsize=31:fontcolor=0xE9EAF4:line_spacing=10:x=(w-text_w)/2:y=${WIN.y + WIN.h + 26}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`;
  }).join(',');
}

renderCards(board);
const parts = [];
board.segments.forEach((s, i) => {
  const audio = voice(i, s.say);
  const D = +(LEAD + duration(audio) + TAIL).toFixed(2);
  const frames = Math.round(D * FPS);
  const out = path.join(build, `seg-${i}.mp4`);
  const audioArgs = ['-i', audio];
  const audioFilter = `[1:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,atrim=0:${D},afade=t=in:st=0:d=0.15,afade=t=out:st=${D - 0.25}:d=0.25[a]`;
  const fades = `fade=t=in:st=0:d=0.3,fade=t=out:st=${D - 0.3}:d=0.3`;

  if (s.type === 'title') {
    const card = path.join(build, `card-${i}.png`);
    ff(['-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', card, ...audioArgs, '-filter_complex',
      `[0:v]scale=3840:-2,zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS},${captionFilter(i, s.say, duration(audio))},${fades},format=yuv420p[v];${audioFilter}`,
      '-map', '[v]', '-map', '[a]', '-t', String(D), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out]);
  } else {
    const A = frame(s.shot, s.from);
    const B = frame(s.shot, s.to);
    // The union of both camera frames, widened to the window's aspect so zoompan's view keeps that aspect.
    const aspect = WIN.w / WIN.h;
    let ux = Math.min(A.x, B.x); let uy = Math.min(A.y, B.y);
    let uw = Math.max(A.x + A.w, B.x + B.w) - ux; let uh = Math.max(A.y + A.h, B.y + B.h) - uy;
    if (uw / uh < aspect) { const nw = uh * aspect; ux -= (nw - uw) / 2; uw = nw; } else { const nh = uw / aspect; uy -= (nh - uh) / 2; uh = nh; }
    const [, , pageW, pageH] = rects[s.shot].page;
    // Outside the page the canvas is white (the app's own surface), so a union wider than the page still frames cleanly.
    const S = 3; // canvas pixels per CSS px; zoompan rounds to whole pixels, so a dense canvas keeps the move smooth
    const pad = { l: Math.max(0, -ux), t: Math.max(0, -uy), r: Math.max(0, ux + uw - pageW), b: Math.max(0, uy + uh - pageH) };
    const frames = Math.round(D * FPS);
    const move = Math.min(2.4, Math.max(1.2, D * 0.45));
    const P = `((1-cos(PI*clip((on/${FPS}-0.5)/${move},0,1)))/2)`;
    const lerp = (a, b) => `(${a.toFixed(3)}+(${(b - a).toFixed(3)})*${P})`;
    const W = lerp(A.w, B.w);
    const X = lerp(A.x - ux, B.x - ux);
    const Y = lerp(A.y - uy, B.y - uy);
    const cropX = Math.max(0, ux) * 2; const cropY = Math.max(0, uy) * 2;
    const cropW = Math.min(pageW, ux + uw) * 2 - cropX; const cropH = Math.min(pageH, uy + uh) * 2 - cropY;
    ff(['-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, 'stage.png'),
      ...audioArgs,
      '-i', path.join(build, 'shots', `${s.shot}.png`),
      '-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(build, 'mask.png'),
      '-filter_complex',
      `[2:v]crop=${Math.round(cropW)}:${Math.round(cropH)}:${Math.round(cropX)}:${Math.round(cropY)},`
      + `pad=${Math.round(uw * 2)}:${Math.round(uh * 2)}:${Math.round(pad.l * 2)}:${Math.round(pad.t * 2)}:color=white,`
      + `scale=${Math.round(uw * S)}:${Math.round(uh * S)}:flags=lanczos,`
      + `zoompan=z='${uw.toFixed(3)}/${W}':x='${X}*${S}':y='${Y}*${S}':d=${frames}:s=${WIN.w}x${WIN.h}:fps=${FPS},format=rgba[shot];`
      + `[3:v]format=gray[m];[shot][m]alphamerge[win];[0:v][win]overlay=${WIN.x}:${WIN.y},${captionFilter(i, s.say, duration(audio))},${fades},format=yuv420p[v];${audioFilter}`,
      '-map', '[v]', '-map', '[a]', '-t', String(D), '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out]);
  }
  parts.push(out);
  console.log(`segment ${i + 1}/${board.segments.length} ${s.type} ${D}s`);
});

const list = path.join(build, 'segments.txt');
fs.writeFileSync(list, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const final = path.join(here, 'delomu-demo.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final]);
const total = duration(final);
console.log(`wrote ${final} (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')})`);
