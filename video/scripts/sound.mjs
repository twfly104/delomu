// Writes public/sound.wav: an original 24-second track at 120 BPM plus UI sounds placed on the video's cue frames.
// Everything is synthesized here; no samples, no downloads.
import { writeFileSync } from 'node:fs';

const SR = 44100, FPS = 30, LEN = 24;
const N = SR * LEN;
const L = new Float32Array(N), R = new Float32Array(N);
const fr = (f) => Math.round((f / FPS) * SR);
const beat = 0.5; // seconds
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

const add = (start, buf, gain = 1, pan = 0) => {
  const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < buf.length && start + i < N; i++) { if (start + i < 0) continue; L[start + i] += buf[i] * gl; R[start + i] += buf[i] * gr; }
};
const env = (n, a, d) => (i) => { const t = i / SR; return t < a ? t / a : Math.exp(-(t - a) / d); };

// ---- instruments
const kick = () => { const n = SR * 0.4, b = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += (2 * Math.PI * (45 + 110 * Math.exp(-t * 30))) / SR; b[i] = Math.sin(ph) * Math.exp(-t * 9); } return b; };
const hat = () => { const n = SR * 0.06, b = new Float32Array(n); let p = 0;
  for (let i = 0; i < n; i++) { const x = rnd(); b[i] = (x - p) * Math.exp(-i / SR * 70); p = x; } return b; };
const pad = (notes, dur) => { const n = Math.round(SR * dur), b = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; let s = 0;
    for (const m of notes) for (const det of [-0.12, 0.12]) { const ph = (t * hz(m + det)) % 1; s += (ph * 2 - 1) * 0.5; }
    lp += (s - lp) * 0.035; const a = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.3); b[i] = lp * a / notes.length; } return b; };
const bass = (m, dur) => { const n = Math.round(SR * dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(4 * Math.PI * hz(m) * t)) * Math.min(1, t / 0.01) * Math.exp(-t * 2.2); } return b; };
const pluck = (m) => { const n = SR * 0.35, b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * hz(m) * t) + 0.4 * Math.sin(2 * Math.PI * hz(m) * 2 * t) * Math.exp(-t * 20)) * Math.exp(-t * 9); } return b; };
// UI sounds
const tick = (m = 96) => { const n = SR * 0.08, b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * hz(m) * t) * Math.exp(-t * 60); } return b; };
const click = () => { const n = SR * 0.05, b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (rnd() * 0.6 + Math.sin(2 * Math.PI * 1800 * t)) * Math.exp(-t * 140); } return b; };
const thud = () => { const n = SR * 0.35, b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * hz(43) * t) + 0.5 * Math.sin(2 * Math.PI * hz(42) * 1.5 * t)) * Math.exp(-t * 10); } return b; };
const chime = (ms) => { const n = SR * 1.2, b = new Float32Array(n);
  ms.forEach((m, k) => { const o = Math.round(SR * 0.06 * k);
    for (let i = 0; i + o < n; i++) { const t = i / SR; b[i + o] += Math.sin(2 * Math.PI * hz(m) * t) * Math.exp(-t * 3.5) * 0.5; } }); return b; };
const whoosh = (dur = 0.35) => { const n = Math.round(SR * dur), b = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / n; const cut = 0.02 + 0.25 * t * t; lp += (rnd() - lp) * cut; b[i] = lp * Math.sin(Math.PI * t) ** 2; } return b; };
const riser = (dur) => { const n = Math.round(SR * dur), b = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / n; ph += 2 * Math.PI * (300 + 500 * t) / SR; b[i] = Math.sin(ph) * t * 0.5; } return b; };
const impact = () => { const n = SR * 1.4, b = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; lp += (rnd() - lp) * 0.08; b[i] = (Math.sin(2 * Math.PI * 50 * t) * Math.exp(-t * 4) + lp * Math.exp(-t * 6) * 0.6); } return b; };

// ---- music: C G Am F, one chord per bar (2 s)
const prog = [[60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69]];
const roots = [36, 43, 45, 41];
for (let bar = 0; bar < 12; bar++) {
  const t0 = bar * 2, c = prog[bar % 4];
  add(Math.round(t0 * SR), pad(c.map((m) => m - 12).concat(c), 2.05), bar < 11 ? 0.32 : 0.28, 0);
  if (bar >= 1 && bar < 12) for (let k = 0; k < 4; k++) add(Math.round((t0 + k * beat) * SR), bass(roots[bar % 4], 0.45), 0.35);
  if (bar >= 1 && bar < 11) for (let k = 0; k < 4; k++) {
    add(Math.round((t0 + k * beat) * SR), kick(), 0.55);
    add(Math.round((t0 + k * beat + beat / 2) * SR), hat(), 0.12, 0.3);
  }
  if (bar >= 6 && bar < 11) for (let k = 0; k < 8; k++) add(Math.round((t0 + k * beat / 2) * SR), pluck(c[k % 3] + 12 + (k >= 4 ? 7 : 0) * (k % 2)), 0.08, k % 2 ? 0.4 : -0.4);
}

// ---- UI sounds on the picture's cues (scene starts from src/cues.ts, offsets from the scene code)
const S = { hook: 0, deploy: 90, find: 210, fix: 390, sign: 540, end: 630 };
add(fr(S.hook), click(), 0.25); add(fr(S.hook + 30), click(), 0.25);
[S.deploy - 6, S.find - 6, S.fix - 6, S.sign - 6, S.end - 6].forEach((f) => add(fr(f), whoosh(), 0.35));
[22, 42, 62].forEach((o, i) => add(fr(S.deploy + o), chime([84 + i * 3, 91 + i * 3]), 0.16));
add(fr(S.deploy + 82), click(), 0.2);
const bankBroken = [false, false, false, true, false, false, false, true];
bankBroken.forEach((b, i) => add(fr(S.find + 16 + i * 8), b ? thud() : tick(91), b ? 0.45 : 0.16));
add(fr(S.find + 120), impact(), 0.35);
add(fr(S.fix + 38), click(), 0.4);
add(fr(S.fix + 45), riser(31 / FPS), 0.06);
for (let i = 0; i < 8; i++) add(fr(S.fix + 80 + i * 4), tick(88 + [0, 2, 4, 5, 7, 9, 11, 12][i]), 0.15);
add(fr(S.fix + 112), chime([84, 88, 91, 96]), 0.3);
add(fr(S.sign + 42), click(), 0.4);
add(fr(S.sign + 45), chime([79, 84, 88]), 0.3);
add(fr(S.end), impact(), 0.45); add(fr(S.end), chime([72, 79, 84, 88]), 0.25);

// ---- master: fade, soft clip, normalize
const fadeIn = SR * 0.05, fadeOut = SR * 1.6;
let peak = 0;
for (let i = 0; i < N; i++) {
  const g = Math.min(1, i / fadeIn) * Math.min(1, (N - i) / fadeOut);
  L[i] = Math.tanh(L[i] * g * 1.2); R[i] = Math.tanh(R[i] * g * 1.2);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { out.writeInt16LE(Math.round(L[i] * norm * 32767), 44 + i * 4); out.writeInt16LE(Math.round(R[i] * norm * 32767), 46 + i * 4); }
writeFileSync(new URL('../public/sound.wav', import.meta.url), out);
console.log('wrote public/sound.wav', (out.length / 1e6).toFixed(1), 'MB');
