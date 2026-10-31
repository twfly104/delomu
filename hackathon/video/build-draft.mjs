// Builds a silent, captioned draft of the 3-minute demo from real screenshots, to show pacing before the
// founder records the narrated version. Needs ffmpeg on PATH and the screenshots in .impeccable/review/.
// usage: node hackathon/video/build-draft.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shots = path.join(root, '.impeccable', 'review');
const work = path.join(here, 'build');
fs.mkdirSync(work, { recursive: true });

const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';
// [screenshot, seconds, caption, panToBottom]
const SEGMENTS = [
  ['scan.png', 12, 'An AI startup just won an enterprise customer.\nWhat will their support AI promise that customer?'],
  ['overview-full.png', 18, 'Delomu is an AI forward-deployed engineer.\nIt does the rollout work, and a person approves every step.'],
  ['inputs.png', 12, 'The input: the customer’s own refund policy and API docs.'],
  ['scan.png', 14, 'One click. Muse Spark reads the policy, lists the rules,\nand writes the messages most likely to break each one.'],
  ['scan-full.png', 46, 'Under a minute later: 4 of 8 rules broken.\nEach verdict quotes the exact clause and proposes the smallest fix.', true],
  ['drafts.png', 18, 'Nothing changes on its own. The probes become a draft for the test set;\nan engineer approves. Every action goes into a hash-chained audit log.'],
  ['report.png', 15, 'The customer gets a readable acceptance report:\npass rate by area, every gap, every decision and why.'],
  ['scan.png', 20, 'Muse Spark does three jobs: red-teaming from policy,\nclause-grounded judging, and drafting the whole rollout.'],
  ['home.png', 12, 'Delomu: find what your AI will get wrong at a customer,\nbefore your customer does.'],
];

const parts = [];
SEGMENTS.forEach(([shot, seconds, caption, pan], i) => {
  const src = path.join(shots, shot);
  if (!fs.existsSync(src)) throw new Error(`missing screenshot ${src}`);
  const textFile = path.join(work, `cap-${i}.txt`);
  fs.writeFileSync(textFile, caption);
  const out = path.join(work, `part-${i}.mp4`);
  const crop = pan
    ? `crop=1280:800:0:'min(ih-800,(ih-800)*t/${seconds - 4})'`
    : 'crop=1280:800:0:0';
  const text = `drawtext=fontfile='${FONT}':textfile='${textFile.replace(/\\/g, '/').replace(':', '\\:')}':fontsize=26:fontcolor=white:line_spacing=8:box=1:boxcolor=black@0.72:boxborderw=18:x=(w-text_w)/2:y=h-text_h-48`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', src,
    '-vf', `scale=1280:-2,pad=1280:max(800\\,ih):0:0:color=white,${crop},${text},fade=t=in:st=0:d=0.4,fade=t=out:st=${seconds - 0.4}:d=0.4,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', out]);
  parts.push(out);
});

const list = path.join(work, 'parts.txt');
fs.writeFileSync(list, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const final = path.join(here, 'delomu-demo-draft.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final]);
const total = SEGMENTS.reduce((n, s) => n + s[1], 0);
console.log(`wrote ${final} (${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')})`);
