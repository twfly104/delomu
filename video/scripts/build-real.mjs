// Turns a real screen recording of Grapim (frames + step marks from a CDP screencast) into the inputs of the
// GrapimReal composition: public/rec.mp4 at 30 fps, src/real-cues.json (which stretch of the recording plays,
// how fast, under which caption) and public/real.wav (music, with a click on every cut).
// Usage: node scripts/build-real.mjs <recording dir with frames/ and marks.json>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const recDir = process.argv[2];
const { marks, frames, initial } = JSON.parse(fs.readFileSync(path.join(recDir, 'marks.json'), 'utf8'));
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const FPS = 30;

// 1. Variable-rate frames to a constant 30 fps video.
const list = frames.map((f, i) => `file '${path.join(recDir, 'frames', f.f).replace(/\\/g, '/')}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? f.t + 0.5) - f.t)).toFixed(3)}`).join('\n') + `\nfile '${path.join(recDir, 'frames', frames.at(-1).f).replace(/\\/g, '/')}'\n`;
const listFile = path.join(recDir, 'frames.txt');
fs.writeFileSync(listFile, list);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(root, 'public', 'rec.mp4')]);
const t0 = frames[0].t;
const at = name => { const m = marks.find(x => x.name === name); return m ? m.t - t0 : null; };

// 2. Segments: real time in the recording, the speed it plays at, and its caption.
const rounds = marks.filter(m => /^rechecked-\d$/.test(m.name)).length;
const last = `rechecked-${rounds}`;
const seg = (from, to, speed, caption, role) => (from != null && to != null && to > from ? [{ from, to, speed, caption, role }] : []);
const segments = [
  ...seg(at('clients') + 0.3, at('client-org'), 1.6, 'Every client, one list.', 'clients'),
  ...seg(at('client-org'), at('check'), 2.4, '', 'agents'),
  ...seg(at('check'), at('draft-fix-1'), 1.15, `A real check: ${initial?.broken ?? 2} of ${initial?.rules ?? 8} rules broken.`, 'check'),
  ...seg(at('draft-fix-1'), at('fix-drafted-1'), 4, 'Grapim drafts the fix.', 'drafting'),
  ...seg(at('fix-drafted-1'), at('rechecking-1'), 2.4, 'You approve it.', 'approve'),
  ...seg(at('rechecking-1'), at('rechecked-1'), 10, 'The same 16 messages, run again.', 'judging'),
  ...(rounds > 1 ? [
    ...seg(at('rechecked-1'), at('rechecked-1') + 2.2, 1, 'Still one rule left. Fix it again.', 'left'),
    ...seg(at('draft-fix-2'), at(last), rounds > 2 ? 16 : 13, rounds > 2 ? 'Fixed again, re-checked.' : 'Second fix, re-checked.', 'second'),
  ] : []),
  ...seg(at(last), at(last) + 3.2, 1, `All ${initial?.rules ?? 8} rules kept.`, 'kept'),
  ...seg(at('rollout'), at('client-view'), 1.8, 'One link for the client.', 'link'),
  ...seg(at('client-view'), at('end'), 2, 'The client signs off. No account needed.', 'signoff'),
];
let f = Math.round(2.4 * FPS); // after the intro card
// The sign-off link was made on the local test server: from the moment it appears, show the address it has on grapim.com.
const linkAt = at('signoff-link') + 1.65;
const cues = segments.map(s => { const len = Math.round(((s.to - s.from) / s.speed) * FPS); const c = { ...s, start: f, len, ...(linkAt > s.from && linkAt < s.to ? { maskFrom: Math.round(((linkAt - s.from) / s.speed) * FPS) } : {}) }; f += len; return c; });
const total = f + Math.round(3.6 * FPS);
fs.writeFileSync(path.join(root, 'src', 'real-cues.json'), JSON.stringify({ fps: FPS, total, introLen: Math.round(2.4 * FPS), cues }, null, 1));
console.log(`rounds ${rounds}, ${cues.length} segments, ${(total / FPS).toFixed(1)} s`);

// 3. Music bed for the whole length, with a soft click on each cut.
execFileSync('node', [path.join(root, 'scripts', 'real-sound.mjs'), String(total / FPS), JSON.stringify(cues.map(c => c.start / FPS))], { stdio: 'inherit' });
