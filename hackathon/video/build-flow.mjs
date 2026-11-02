// Turns a record-flow take into the demo video: each marked stretch keeps its real footage, sped up where it
// is only waiting (the speed in the mark), with its caption in a bar at the bottom, between a title card and an
// end card. The footage itself is never edited, only timed.
// usage: node hackathon/video/build-flow.mjs <take-dir> <out.mp4> "<title>" "<end line>"

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [dir, out, title, endLine] = process.argv.slice(2);
const marks = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf8'));
const work = path.join(dir, 'build');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const FONT = 'C\\:/Windows/Fonts/segoeui.ttf';
const BOLD = 'C\\:/Windows/Fonts/segoeuib.ttf';
const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: work });

// A card: the product's ink background, a line of text, for a few seconds.
function card(name, lines, seconds) {
  lines.forEach((l, i) => fs.writeFileSync(path.join(work, `${name}-${i}.txt`), l));
  const draw = lines.map((_, i) => `drawtext=fontfile='${i === 0 ? BOLD : FONT}':textfile=${name}-${i}.txt:fontcolor=${i === 0 ? 'white' : '0xa3adc0'}:fontsize=${i === 0 ? 46 : 26}:x=(w-text_w)/2:y=(h/2)-60+${i * 70}`).join(',');
  ff(['-f', 'lavfi', '-i', `color=c=0x0b1324:s=1280x800:r=30:d=${seconds}`, '-vf', `${draw},format=yuv420p`, '-c:v', 'libx264', '-crf', '18', `${name}.mp4`]);
  return `${name}.mp4`;
}

const parts = [card('title', [title, 'Recorded live: real clicks, real AI, nothing staged'], 3.5)];
marks.forEach((m, i) => {
  const next = marks[i + 1];
  if (!next || m.label === 'end') return;
  const dur = next.t - m.t;
  if (dur < 0.3) return;
  const speed = m.speed ?? 1;
  fs.writeFileSync(path.join(work, `cap-${i}.txt`), (m.caption || '') + (speed > 1 ? `   ${speed}x` : ''));
  const vf = [
    `setpts=PTS/${speed}`,
    'drawbox=x=0:y=ih-64:w=iw:h=64:color=0x0b1324@0.88:t=fill',
    `drawtext=fontfile='${FONT}':textfile=cap-${i}.txt:fontcolor=white:fontsize=24:x=(w-text_w)/2:y=h-44`,
    'format=yuv420p',
  ].join(',');
  ff(['-ss', m.t.toFixed(3), '-t', dur.toFixed(3), '-i', path.resolve(dir, 'raw.mp4'), '-vf', vf, '-r', '30', '-an', '-c:v', 'libx264', '-crf', '18', `seg-${i}.mp4`]);
  parts.push(`seg-${i}.mp4`);
});
parts.push(card('end', [endLine, 'delomu-production.up.railway.app'], 4));
fs.writeFileSync(path.join(work, 'list.txt'), parts.map(p => `file '${p}'`).join('\n') + '\n');
ff(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(out)]);
console.log(`${parts.length} parts -> ${out}`);
