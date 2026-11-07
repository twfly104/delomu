// public/real.wav: a calm, original music bed (synthesized here, no samples) for the real-recording video.
// Usage: node scripts/real-sound.mjs <seconds> '[cut times in seconds]'
import { writeFileSync } from 'node:fs';

const SR = 44100, LEN = Number(process.argv[2] || 40), CUTS = JSON.parse(process.argv[3] || '[]');
const N = Math.ceil(SR * LEN);
const L = new Float32Array(N), R = new Float32Array(N);
const hz = m => 440 * 2 ** ((m - 69) / 12);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (t, buf, gain = 1, pan = 0) => { const s = Math.round(t * SR); for (let i = 0; i < buf.length && s + i < N; i++) { L[s + i] += buf[i] * gain * Math.min(1, 1 - pan); R[s + i] += buf[i] * gain * Math.min(1, 1 + pan); } };
const pad = (notes, dur) => { const n = Math.round(SR * dur), b = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (const m of notes) for (const d of [-0.1, 0.1]) s += ((t * hz(m + d)) % 1) * 2 - 1;
    lp += (s - lp) * 0.03; b[i] = (lp / notes.length) * Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.4); } return b; };
const kick = () => { const n = SR * 0.35, b = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 30))) / SR; b[i] = Math.sin(ph) * Math.exp(-t * 10); } return b; };
const hat = () => { const n = SR * 0.05, b = new Float32Array(n); let p = 0; for (let i = 0; i < n; i++) { const x = rnd(); b[i] = (x - p) * Math.exp(-i / SR * 80); p = x; } return b; };
const pluck = m => { const n = SR * 0.5, b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * hz(m) * t) * Math.exp(-t * 6); } return b; };
const click = () => { const n = SR * 0.04, b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (rnd() * 0.5 + Math.sin(2 * Math.PI * 2000 * t)) * Math.exp(-t * 160); } return b; };

// Fmaj7 - Am7 - Dm7 - Bbmaj7 at 100 BPM, one chord per bar (2.4 s); a light beat after the intro.
const BAR = 2.4, prog = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60], [46, 50, 53, 57]];
for (let b = 0; b * BAR < LEN; b++) {
  const t0 = b * BAR, c = prog[b % 4];
  add(t0, pad(c, BAR + 0.1), 0.34);
  if (b >= 1 && t0 < LEN - BAR) for (let k = 0; k < 4; k++) { add(t0 + k * BAR / 4, kick(), 0.32); add(t0 + k * BAR / 4 + BAR / 8, hat(), 0.07, 0.3); }
  if (b >= 2 && t0 < LEN - BAR) for (let k = 0; k < 8; k++) add(t0 + k * BAR / 8, pluck(c[k % 4] + 12), 0.05, k % 2 ? 0.35 : -0.35);
}
for (const t of CUTS) add(t, click(), 0.12);

let peak = 0;
for (let i = 0; i < N; i++) { const g = Math.min(1, i / (SR * 0.6)) * Math.min(1, (N - i) / (SR * 2)); L[i] = Math.tanh(L[i] * g); R[i] = Math.tanh(R[i] * g); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const out = Buffer.alloc(44 + N * 4); const k = 0.85 / peak;
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { out.writeInt16LE(Math.round(L[i] * k * 32767), 44 + i * 4); out.writeInt16LE(Math.round(R[i] * k * 32767), 46 + i * 4); }
writeFileSync(new URL('../public/real.wav', import.meta.url), out);
console.log('wrote public/real.wav', LEN.toFixed(1), 's');
