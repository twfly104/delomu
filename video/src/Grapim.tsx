// Grapim's 20-second LinkedIn video, cut to music (120 BPM: one beat = 15 frames, one bar = 60).
// One idea per shot, a few words each, the product does the explaining: a camera that tilts the UI in 3D, pushes in
// on the one thing that matters, and a hand cursor that presses it. Rules, verdicts and the fix are from real
// Grapim checks on made-up sample clients (src/data.json). Sound: public/sound.wav from scripts/sound.mjs, built on
// the same cue frames as below, so every click and tick lands on its picture.
import React from 'react';
import {
  AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, Easing,
} from 'remotion';
import data from './data.json';
import { SCENES } from './cues';

const C = {
  bg: '#f6f7fa', surface: '#ffffff', line: '#e4e6eb', ink: '#14161a', text2: '#4a4f57', text3: '#7a808a',
  accent: '#006bff', violet: '#7c5cff', good: '#16a34a', goodWeak: '#eefaf2', bad: '#d92d20', badWeak: '#fff1f0', sunken: '#f1f2f5',
};
const GRAD = `linear-gradient(95deg, ${C.accent}, ${C.violet})`;
const FONT = 'Geist, Segoe UI, sans-serif';
const fontCss = `@font-face{font-family:"Geist";src:url(${staticFile('Geist-Variable.woff2')}) format("woff2");font-weight:100 900}`;

export const DURATION = SCENES.end.from + SCENES.end.len;

const sp = (f: number, delay: number, damping = 200, stiffness = 100) =>
  spring({ frame: f - delay, fps: 30, config: { damping, stiffness } });
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) };
const k = (f: number, t: number[], v: number[]) => interpolate(f, t, v, ease);

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <rect x="25" y="9" width="30" height="30" rx="5" transform="rotate(45 40 24)" fill="none" stroke={C.ink} strokeWidth="5" />
    <rect x="6" y="26" width="34" height="34" rx="8" fill={C.ink} />
  </svg>
);

// A pointing-hand cursor; `press` squashes it on the click.
const Hand: React.FC<{ x: number; y: number; press?: number; opacity?: number; size?: number }> = ({ x, y, press = 1, opacity = 1, size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" style={{ position: 'absolute', left: x, top: y, opacity, transform: `scale(${press})`, transformOrigin: '35% 10%', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.25))' }}>
    <path d="M9 12V4.5a1.6 1.6 0 0 1 3.2 0V11m0-.5V9a1.6 1.6 0 0 1 3.2 0v2m0-.5a1.6 1.6 0 0 1 3.2 0V12m0-.4a1.6 1.6 0 0 1 3.2 0V17a7 7 0 0 1-7 7h-1.4a7 7 0 0 1-5.4-2.6L3.6 16.4a1.7 1.7 0 0 1 2.6-2.2L9 16.6Z"
      fill="#fff" stroke={C.ink} strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

// Every shot enters with a short push and leaves with a fade, so cuts land on the beat without jumping.
const Shot: React.FC<{ len: number; children: React.ReactNode }> = ({ len, children }) => {
  const f = useCurrentFrame();
  const inP = sp(f, 0, 200, 180);
  const out = interpolate(f, [len - 8, len], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: Math.min(inP * 1.5, 1) * out, transform: `scale(${0.97 + 0.03 * inP})`, filter: `blur(${(1 - out) * 8}px)` }}>{children}</AbsoluteFill>;
};

// The one line of words a shot gets. Words in `hl` carry the gradient. Letters arrive out of a blur.
const Title: React.FC<{ text: string; hl?: string[]; delay?: number; top?: number; size?: number }> = ({ text, hl = [], delay = 2, top = 104, size = 80 }) => {
  const f = useCurrentFrame();
  let n = 0;
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, textAlign: 'center', fontSize: size, fontWeight: 660, letterSpacing: -size * 0.045, color: C.ink }}>
      {text.split(' ').map((w, wi) => {
        const isHl = hl.includes(w.replace(/[.,]/g, ''));
        return (
          <span key={wi} style={{ display: 'inline-block', margin: `0 ${size * 0.12}px`, whiteSpace: 'nowrap' }}>
            {[...w].map((ch, ci) => {
              const p = sp(f, delay + (n++) * 1.1, 200, 170);
              return <span key={ci} style={{
                display: 'inline-block', opacity: p, filter: `blur(${(1 - p) * 10}px)`, transform: `translateY(${(1 - p) * 26}px)`,
                ...(isHl ? { backgroundImage: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}),
              }}>{ch}</span>;
            })}
          </span>
        );
      })}
    </div>
  );
};

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.surface, border: `1.5px solid ${C.line}`, borderRadius: 30, boxShadow: '0 2px 4px rgba(0,0,0,.04), 0 60px 100px -40px rgba(20,30,80,.32)', ...style }}>{children}</div>
);

// A rule tile. It flips over (rotateX) when its verdict comes in.
const Tile: React.FC<{ title: string; f: number; at: number; verdict: 'good' | 'bad'; before?: 'wait' | 'good' | 'bad'; style?: React.CSSProperties }> = ({ title, f, at, verdict, before = 'wait', style }) => {
  const t = interpolate(f, [at - 5, at + 5], [0, 1], clamp);
  const state = t < 0.5 ? before : verdict;
  const rot = t < 0.5 ? t * 180 : (t - 1) * 180;
  const col = state === 'good' ? C.good : state === 'bad' ? C.bad : '#cfd3da';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', height: 92, borderRadius: 18, fontSize: 27, fontWeight: 520, letterSpacing: -0.5,
      background: state === 'good' ? C.goodWeak : state === 'bad' ? C.badWeak : C.surface,
      border: `2px solid ${state === 'wait' ? C.line : col}`, color: state === 'wait' ? C.text3 : C.ink,
      transform: `perspective(800px) rotateX(${rot}deg)`, boxShadow: state === 'bad' ? '0 0 0 6px rgba(217,45,32,.08)' : 'none', ...style,
    }}>
      <i style={{ flex: 'none', width: 18, height: 18, borderRadius: 5, background: col, display: 'inline-block' }} />
      <span>{title}</span>
    </div>
  );
};

// Light: two soft glows that drift, and a faint dot field (the landing page's pips).
const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const glow = (x: number, y: number, c: string, s: number) =>
    <div style={{ position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: '50%', background: c, filter: 'blur(120px)' }} />;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {glow(250 + 80 * Math.sin(f / 70), 880 + 40 * Math.cos(f / 60), 'rgba(0,107,255,.16)', 760)}
      {glow(900 + 60 * Math.cos(f / 80), 180 + 50 * Math.sin(f / 50), 'rgba(124,92,255,.14)', 680)}
      <AbsoluteFill style={{
        backgroundImage: 'radial-gradient(circle, rgba(20,22,26,.08) 1.6px, transparent 1.8px)', backgroundSize: '36px 36px',
        backgroundPosition: `${-f * 0.3}px ${-f * 0.15}px`,
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 35%, #000 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 35%, #000 100%)',
      }} />
    </AbsoluteFill>
  );
};

// Who is who, said the same way in every shot: the viewer's company (an AI vendor) and its new client. Both made up.
const VENDOR = 'Brightdesk AI', CLIENT = 'Quillby Bank';
const Pair: React.FC = () => (
  <div style={{ fontSize: 26, color: C.text3, marginBottom: 18, textAlign: 'center' }}>{VENDOR} agent → {CLIENT} <span style={{ opacity: 0.7 }}>(sample)</span></div>
);

// A company card for the hook: a mark, a name, and a small label of what it is to the viewer.
const Party: React.FC<{ name: string; label: string; mark: React.ReactNode; p: number; from: number }> = ({ name, label, mark, p, from }) => (
  <Card style={{ width: 400, height: 140, boxSizing: 'border-box', whiteSpace: 'nowrap', padding: '0 30px', display: 'flex', alignItems: 'center', gap: 22, opacity: Math.min(p * 1.4, 1), transform: `translateX(${(1 - p) * from}px) rotateY(${(1 - p) * (from > 0 ? -30 : 30)}deg)` }}>
    <div style={{ flex: 'none', width: 70, height: 70, borderRadius: 18, display: 'grid', placeItems: 'center', ...(typeof mark === 'string' ? { background: mark } : {}) }}>{typeof mark === 'string' ? null : mark}</div>
    <div>
      <div style={{ fontSize: 22, color: C.text3, fontWeight: 560, textTransform: 'uppercase', letterSpacing: 1.5 }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 650, letterSpacing: -1.2, marginTop: 4 }}>{name}</div>
    </div>
  </Card>
);

// 1. Two beats of words, each with its company: your agent, then the new client it has to go live for.
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const a = sp(f, 0, 200, 200), b = sp(f, 30, 200, 200);
  const pa = sp(f, 6, 16, 140), pb = sp(f, 36, 16, 140);
  const link = interpolate(f, [44, 66], [0, 1], ease);
  return (
    <AbsoluteFill style={{ alignItems: 'center', perspective: 1400 }}>
      <div style={{ marginTop: 250, fontSize: 124, fontWeight: 690, letterSpacing: -6, lineHeight: 1.04, textAlign: 'center' }}>
        <div style={{ opacity: a, filter: `blur(${(1 - a) * 12}px)`, transform: `translateY(${(1 - a) * 50}px)` }}>Your AI agent.</div>
        <div style={{ opacity: b, filter: `blur(${(1 - b) * 12}px)`, transform: `translateY(${(1 - b) * 50}px)`, backgroundImage: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>A new client.</div>
      </div>
      <div style={{ position: 'absolute', top: 660, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0 }}>
        <Party name={VENDOR} label="You" mark={GRAD} p={pa} from={-200} />
        <div style={{ width: 110, height: 6, margin: '0 -2px', background: C.sunken, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${link * 100}%`, height: '100%', backgroundImage: GRAD }} />
        </div>
        <Party name={CLIENT} label="New client" mark={<svg width="70" height="70" viewBox="0 0 70 70"><rect width="70" height="70" rx="18" fill={C.ink} /><path d="M17 30h36M21 30v18M30 30v18M40 30v18M49 30v18M15 52h40M35 15l20 10H15Z" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinejoin="round" /></svg>} p={pb} from={200} />
      </div>
    </AbsoluteFill>
  );
};

// 2. The deployment work for this client, drafted one piece after another. Nothing goes live without the vendor's OK.
const Deploy: React.FC = () => {
  const f = useCurrentFrame();
  const rows: [string, string, number][] = [['Data mapping', 'Their CRM fields → your agent', 22], ['Integration', 'Orders, cards and handoffs', 42], ['Tests', 'One test per client rule', 62]];
  const note = sp(f, 82, 14, 160);
  return (
    <AbsoluteFill>
      <Title text="Drafts the deployment." hl={['deployment']} />
      <div style={{ position: 'absolute', top: 270, left: 130, right: 130, perspective: 1600 }}>
        <Pair />
        <div style={{ display: 'grid', gap: 18, transform: `rotateX(${k(f, [0, 60], [14, 4])}deg)` }}>
          {rows.map(([name, sub, at], i) => {
            const enter = sp(f, 4 + i * 6, 18, 160);
            const done = f >= at;
            const d = sp(f, at, 12, 220);
            return (
              <Card key={name} style={{ borderRadius: 22, padding: '0 34px', height: 124, display: 'flex', alignItems: 'center', gap: 24, opacity: Math.min(enter * 1.4, 1), transform: `translateY(${(1 - enter) * 40}px)`, border: `2px solid ${done ? 'rgba(22,163,74,.45)' : C.line}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 38, fontWeight: 640, letterSpacing: -1.2 }}>{name}</div>
                  <div style={{ fontSize: 25, color: C.text3, marginTop: 4 }}>{sub}</div>
                </div>
                {done
                  ? <span style={{ fontSize: 28, fontWeight: 620, color: C.good, background: C.goodWeak, padding: '12px 22px', borderRadius: 999, transform: `scale(${0.6 + 0.4 * d})`, display: 'inline-block' }}>✓ Drafted</span>
                  : <svg width="46" height="46" viewBox="0 0 46 46" style={{ transform: `rotate(${f * 14}deg)` }}><circle cx="23" cy="23" r="18" stroke={C.line} strokeWidth="5" fill="none" /><path d="M23 5a18 18 0 0 1 18 18" stroke={C.accent} strokeWidth="5" fill="none" strokeLinecap="round" /></svg>}
              </Card>
            );
          })}
        </div>
        <div style={{ marginTop: 34, textAlign: 'center', opacity: note, transform: `translateY(${(1 - note) * 16}px)` }}>
          <span style={{ fontSize: 30, fontWeight: 560, color: C.text2, background: C.surface, border: `1.5px solid ${C.line}`, padding: '14px 28px', borderRadius: 999 }}>You approve each draft</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// 3. The grid of rules, tilted in 3D, gets tested tile by tile; then the camera dives at the broken one.
const Find: React.FC = () => {
  const f = useCurrentFrame();
  const rules = data.bank.rules as { title: string; broken: boolean }[];
  const dive = k(f, [100, 126], [0, 1]);
  const ev = sp(f, 120, 18, 160);
  return (
    <AbsoluteFill>
      <div style={{ opacity: 1 - dive }}><Title text="Tests every rule." hl={['rule']} /></div>
      {f >= 104 && <Title text="Finds what breaks." hl={['breaks']} delay={106} />}
      <AbsoluteFill style={{ perspective: 1600 }}>
        <div style={{
          position: 'absolute', top: 260, left: 90, right: 90, transformOrigin: '75% 45%',
          transform: `rotateX(${k(f, [0, 90], [26, 10])}deg) rotateZ(${k(f, [0, 90], [-4, 0])}deg) scale(${k(f, [0, 90], [0.92, 1]) + dive * 0.9})`,
          opacity: 1 - dive * 0.75, filter: `blur(${dive * 10}px)`,
        }}>
          <Pair />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {rules.map((r, i) => <Tile key={r.title} title={r.title} f={f} at={16 + i * 8} verdict={r.broken ? 'bad' : 'good'} />)}
          </div>
        </div>
      </AbsoluteFill>
      {/* The broken rule, close up, with what the agent actually did. */}
      <AbsoluteFill style={{ perspective: 1400 }}>
        <div style={{ position: 'absolute', top: 320, left: 110, right: 110, opacity: Math.min(ev * 1.3, 1), transform: `translateY(${(1 - ev) * 60}px) rotateX(${(1 - ev) * 35}deg)` }}>
          <Card style={{ padding: '46px 50px', border: `3px solid ${C.bad}`, boxShadow: '0 0 0 10px rgba(217,45,32,.07), 0 60px 100px -40px rgba(217,45,32,.4)' }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', background: C.bad, padding: '8px 16px', borderRadius: 10 }}>BROKEN</span>
            <div style={{ fontSize: 60, fontWeight: 660, letterSpacing: -2.4, marginTop: 26, lineHeight: 1.05 }}>{data.bank.title}</div>
            <div style={{ fontSize: 34, color: C.text2, marginTop: 24, lineHeight: 1.3 }}>A scam victim asked for help. The agent asked for card digits and never froze the card.</div>
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 3. Close on the button; the hand presses it; the camera pulls back while the same tests run again.
const Fix: React.FC = () => {
  const f = useCurrentFrame();
  const rules = data.bank.rules as { title: string; broken: boolean }[];
  const press = interpolate(f, [38, 42, 48], [1, 0.9, 1], clamp);
  const bar = interpolate(f, [45, 76], [0, 1], ease);
  const allOk = f >= 112;
  const ok = sp(f, 112, 12, 200);
  // Camera: start 2.3x on the button (top-left of the layout), pull back to the whole panel.
  const z = k(f, [0, 30, 50, 80], [2.6, 2.3, 2.3, 1]);
  const tilt = k(f, [50, 80, 150], [0, 8, 4]);
  // The fingertip lands on the button's lower-right corner, so the hand sits below the words, not on them.
  const hx = k(f, [4, 32], [900, 712]), hy = k(f, [4, 32], [900, 566]);
  const tx = k(f, [0, 30, 50, 80], [174, 207, 207, 0]), ty = k(f, [0, 30, 50, 80], [166, 178, 178, 0]);
  return (
    <AbsoluteFill>
      <div style={{ opacity: k(f, [50, 62], [0, 1]) }}><Title text="Fixes it. Tests again." hl={['again']} delay={52} /></div>
      <AbsoluteFill style={{ perspective: 1600 }}>
        <div style={{ position: 'absolute', top: 250, left: 80, right: 80, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${z}) rotateX(${tilt}deg)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 22 }}>
            <span style={{ flex: 'none', fontSize: 30, fontWeight: 600, color: '#fff', background: f >= 42 ? GRAD : C.ink, padding: '20px 30px', borderRadius: 16, transform: `scale(${press})`, boxShadow: f >= 42 ? '0 10px 30px -8px rgba(0,107,255,.6)' : 'none' }}>Approve fix</span>
            <div style={{ flex: 1, height: 12, borderRadius: 12, background: C.sunken, overflow: 'hidden' }}><div style={{ width: `${bar * 100}%`, height: '100%', backgroundImage: GRAD }} /></div>
            <span style={{ flex: 'none', fontSize: 32, fontWeight: 650, color: allOk ? C.good : C.bad, display: 'inline-block', transform: `scale(${allOk ? 0.7 + 0.3 * ok : 1})` }}>{allOk ? '8 / 8 kept' : '2 broken'}</span>
          </div>
          <Pair />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {rules.map((r, i) => <Tile key={r.title} title={r.title} f={f} at={80 + i * 4} verdict="good" before={r.broken ? 'bad' : 'good'} style={{ height: 84, fontSize: 25 }} />)}
          </div>
        </div>
      </AbsoluteFill>
      <Hand x={hx} y={hy} size={120} press={press} opacity={interpolate(f, [2, 8, 52, 60], [0, 1, 1, 0], clamp)} />
    </AbsoluteFill>
  );
};

// 4. The client's page swings in, the camera closes on Accept, the hand presses it.
const Sign: React.FC = () => {
  const f = useCurrentFrame();
  const press = interpolate(f, [42, 45, 50], [1, 0.94, 1], clamp);
  const done = f >= 45;
  const d = sp(f, 45, 12, 200);
  const swing = sp(f, 0, 20, 120);
  const z = k(f, [14, 36, 56, 76], [1, 1.25, 1.25, 1]);
  const hx = k(f, [12, 38], [900, 776]), hy = k(f, [12, 38], [980, 556]);
  return (
    <AbsoluteFill>
      <div style={{ opacity: k(f, [44, 50], [1, 0]) }}><Title text="Your client signs off." hl={['signs', 'off']} size={72} /></div>
      {f >= 46 && <Title text="You launch." hl={['launch']} delay={47} size={72} />}
      <AbsoluteFill style={{ perspective: 1500 }}>
        <div style={{ position: 'absolute', top: 300, left: 170, right: 170, transformOrigin: '50% 72%', transform: `rotateY(${(1 - swing) * -40}deg) rotateX(${(1 - swing) * 12}deg) scale(${z})` }}>
          <Card style={{ padding: '48px 52px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 650, letterSpacing: -1 }}><Logo size={36} />Grapim<span style={{ marginLeft: 'auto', fontSize: 24, fontWeight: 500, color: C.text3 }}>for {CLIENT}</span></div>
            <div style={{ marginTop: 28, fontSize: 40, lineHeight: 1.25, letterSpacing: -1 }}>Accept <b>{VENDOR}’s</b> agent?<span style={{ display: 'block', color: C.good, fontWeight: 600, whiteSpace: 'nowrap' }}>8 / 8 rules kept</span></div>
            <div style={{ marginTop: 34, height: 92, borderRadius: 18, background: done ? C.good : C.ink, color: '#fff', fontSize: 34, fontWeight: 620, display: 'grid', placeItems: 'center', transform: `scale(${press})`, boxShadow: done ? '0 14px 40px -10px rgba(22,163,74,.6)' : 'none' }}>
              {done ? <span style={{ transform: `scale(${0.7 + 0.3 * d})`, display: 'inline-block' }}>✓ Accepted</span> : 'Accept'}
            </div>
            <div style={{ marginTop: 22, fontSize: 26, color: C.text3, textAlign: 'center', opacity: d }}>Signed by {CLIENT} · saved to the audit log</div>
          </Card>
        </div>
      </AbsoluteFill>
      <Hand x={hx} y={hy} size={110} press={press} opacity={interpolate(f, [8, 14, 60, 70], [0, 1, 1, 0], clamp)} />
    </AbsoluteFill>
  );
};

const End: React.FC = () => {
  const f = useCurrentFrame();
  const a = sp(f, 0, 16, 160), b = sp(f, 15, 200, 160);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, fontSize: 136, fontWeight: 690, letterSpacing: -6, opacity: Math.min(a, 1), filter: `blur(${(1 - Math.min(a, 1)) * 14}px)`, transform: `scale(${0.85 + 0.15 * a})` }}><Logo size={130} />Grapim</div>
      <div style={{ marginTop: 40, fontSize: 50, color: C.text2, letterSpacing: -1.6, textAlign: 'center', maxWidth: 940, opacity: b, filter: `blur(${(1 - b) * 8}px)`, transform: `translateY(${(1 - b) * 20}px)` }}>
        Every new client, deployed<span style={{ display: 'block', backgroundImage: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>with signed proof.</span>
      </div>
    </AbsoluteFill>
  );
};

export const Grapim: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.ink }}>
    <style>{fontCss}</style>
    <Backdrop />
    <Audio src={staticFile('sound.wav')} />
    {([['hook', Hook], ['deploy', Deploy], ['find', Find], ['fix', Fix], ['sign', Sign], ['end', End]] as const).map(([key, Comp]) => (
      <Sequence key={key} from={SCENES[key].from} durationInFrames={SCENES[key].len}>
        <Shot len={key === 'end' ? 999 : SCENES[key].len}><Comp /></Shot>
      </Sequence>
    ))}
  </AbsoluteFill>
);
