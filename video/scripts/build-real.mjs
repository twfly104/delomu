// Turns a real screen recording of Grapim (frames + step marks from a CDP screencast, made by
// .impeccable/rec-video.mjs) into the inputs of the GrapimReal composition: public/rec.mp4 at 30 fps,
// src/real-cues.json (which stretch of the recording plays, how fast, under which caption) and public/real.wav
// (music, with a click on every cut). Every number in a caption comes from the recording's marks.json.
// Usage: node scripts/build-real.mjs <recording dir with frames/ and marks.json>  (CUES_ONLY=1 keeps public/rec.mp4)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const recDir = process.argv[2];
const { marks, frames, facts, viewport = { w: 1440, h: 900 } } = JSON.parse(fs.readFileSync(path.join(recDir, 'marks.json'), 'utf8'));
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const FPS = 30;

// 1. Variable-rate frames to a constant 30 fps video.
const list = frames.map((f, i) => `file '${path.join(recDir, 'frames', f.f).replace(/\\/g, '/')}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? f.t + 0.5) - f.t)).toFixed(3)}`).join('\n') + `\nfile '${path.join(recDir, 'frames', frames.at(-1).f).replace(/\\/g, '/')}'\n`;
const listFile = path.join(recDir, 'frames.txt');
fs.writeFileSync(listFile, list);
if (!process.env.CUES_ONLY) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', path.join(root, 'public', 'rec.mp4')]);
const t0 = frames[0].t;
const markOf = name => marks.find(x => x.name === name);
const at = name => { const m = markOf(name); return m ? m.t - t0 : null; };

// 2. Segments: real time in the recording, the speed it plays at (each stretch is fitted to a length on screen), its
// caption and its role. Each segment starts where the recorder framed a shot, and carries that framing: `cams`, the
// boxes of what the shot is about (recording pixels), with the frame each one takes over. GrapimReal crops to them.
const rounds = marks.filter(m => /^rechecked-\d$/.test(m.name)).length;
const lastRound = `rechecked-${rounds}`;
const { initial, final, pressure } = facts;
const repaired = facts.repairs1?.length ?? 0;
const moved1 = markOf('rechecked-1')?.moved ?? [];
const repairedAfter1 = (moved1.find(t => t.startsWith('Broken → kept'))?.split('\n').length ?? 1) - 1;
const left1 = facts.recheck1?.broken ?? 0;
const seg = (from, to, secs, caption, role) => (from != null && to != null && to > from ? [{ from, to, speed: +Math.max(1, (to - from) / secs).toFixed(3), caption, role }] : []);
const segments = [
  // The video opens on the first check's verdict (the check itself ran before, while the recorder waited).
  ...seg(at('results'), at('broken'), 2.6, `First check on the sample agent: ${initial.broken} of ${initial.rules} rules broken.`, 'results'),
  ...seg(at('broken'), at('pressure') ?? at('fix-1'), 2.6, 'Each break shows the exact reply.', 'broken'),
  ...seg(at('pressure'), at('fix-1'), 3.6, pressure?.gaveIn ? `Under pressure, it gave in on message ${pressure.brokeAt}.` : `It held a pressure conversation of ${pressure?.turns} messages.`, 'pressure'),
  ...seg(at('fix-1'), at('approve-1'), 2.6, repaired === 1 ? 'Grapim drafts the fix and names the rule it repairs.' : `Grapim drafts the fix and names the ${repaired} rules it repairs.`, 'fix'),
  // the first re-check's live timeline, one row per rule filling in (recordings without it: that re-check, sped up)
  ...(at('rejudging-1') != null
    ? seg(at('rejudging-1'), at('rejudged-1') ?? at('rechecked-1'), 2.4, 'Approved. Every rule, judged live.', 'recheck')
    : seg(at('rechecking-1'), at('rechecked-1'), 1.8, 'You approve. The same messages run again.', 'recheck')),
  // the first re-check's result, with its 'Broken → kept' chips; a later round (if any) shows only its result
  ...(rounds === 1
    ? seg(at('rechecked-1'), at('link'), 2.4, `Broken → kept. All ${final.rules} rules kept.`, 'kept')
    : [
      ...seg(at('rechecked-1'), at('fix-2'), 2.4, `Broken → kept for ${repairedAfter1} rules. ${left1} left to fix.`, 'kept'),
      ...seg(at(lastRound), at('link'), 2.0, rounds === 2 ? 'After a second fix, every rule is kept.' : `After ${rounds} rounds of fixes, every rule is kept.`, 'kept'),
    ]),
  // ends before the client's page loads ('link-made' + the 2.3 s the cursor rests on the link)
  ...seg(at('link'), at('leave-rollout') ?? (at('link-made') != null ? Math.min(at('client'), at('link-made') + 2.3) : at('client')), 2.4, 'One link for the client.', 'link'),
  ...seg(at('client'), at('review-2'), 3.0, 'The client reviews one rule per screen.', 'review'),
  ...seg(at('review-2'), at('review-3'), 2.6, 'They can ask about any rule.', 'review'),
  ...seg(at('review-3'), at('decide'), 1.6, `All ${facts.reviewRules} rules reviewed.`, 'review'),
  ...seg(at('decide'), at('evidence'), 3.0, 'Then they accept. No account needed.', 'review'),
  ...seg(at('ev-signoff'), at('ev-frameworks'), 2.4, 'The sign-off goes into the evidence pack.', 'evidence'),
  ...seg(at('ev-frameworks'), at('end'), 2.8, 'Mapped to common AI frameworks.', 'evidence'),
];
const INTRO = 0, OUTRO = Math.round(3.2 * FPS);
let f = INTRO; // no intro card: the video opens on the product
// Optional <recording>/framing.json corrects a recorded framing by hand: { "set": { "<mark>": box }, "add": [{ "after":
// "<mark>", "dt": seconds, "box": box }] } (boxes in recording pixels). Used when a recorded box took in a full-width
// block around the element that matters, e.g. { "set": { "results": <the verdict line> }, "add": [{ "after": "results", ... }] }.
const framingFile = path.join(recDir, 'framing.json');
const framing = fs.existsSync(framingFile) ? JSON.parse(fs.readFileSync(framingFile, 'utf8')) : {};
for (const [name, box] of Object.entries(framing.set ?? {})) { const m = markOf(name); if (m) m.box = box; }
for (const a of framing.add ?? []) { const m = markOf(a.after); if (m) marks.push({ name: 'cam', t: m.t + a.dt, box: a.box }); }
marks.sort((x, y) => x.t - y.t);
const boxes = marks.filter(m => m.box).map(m => ({ t: m.t - t0, box: m.box }));
// The sign-off link was made on the local test server: from the moment it appears, show the address it has on grapim.com.
const lm = markOf('link-made');
const linkAt = lm ? at('link-page') - 0.1 : null;
const mask = lm?.mask ? { ...lm.mask, text: `https://grapim.com/signoff/${lm.token}` } : null;
const cues = segments.map(s => {
  const len = Math.round(((s.to - s.from) / s.speed) * FPS);
  const frameAt = t => Math.max(0, Math.round(((t - s.from) / s.speed) * FPS));
  const before = boxes.filter(b => b.t <= s.from + 0.05).at(-1);
  const cams = [...(before ? [{ at: 0, box: before.box }] : []), ...boxes.filter(b => b.t > s.from + 0.05 && b.t < s.to).map(b => ({ at: frameAt(b.t), box: b.box }))];
  const c = { ...s, start: f, len, cams, ...(mask && linkAt > s.from && linkAt < s.to ? { mask, maskFrom: frameAt(linkAt) } : {}) };
  f += len; return c;
});
const total = f + OUTRO;
fs.writeFileSync(path.join(root, 'src', 'real-cues.json'), JSON.stringify({ fps: FPS, total, introLen: INTRO, outroLen: OUTRO, rec: viewport, cues }, null, 1));
console.log(`rounds ${rounds}, ${cues.length} segments, ${(total / FPS).toFixed(1)} s`);
for (const c of cues) console.log(`${(c.start / FPS).toFixed(1).padStart(5)}s +${(c.len / FPS).toFixed(1)}s x${c.speed} ${c.role} [${c.cams.map(k => `${k.at}:${k.box.w}x${k.box.h}`).join(' ')}]: ${c.caption}`);

// 3. Music bed for the whole length, with a soft click on each cut.
execFileSync('node', [path.join(root, 'scripts', 'real-sound.mjs'), String(total / FPS), JSON.stringify(cues.map(c => c.start / FPS))], { stdio: 'inherit' });
