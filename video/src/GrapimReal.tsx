// The real-product video: a screen recording of Grapim on the local server with the real model (sample client
// Quillby Bank), cut by scripts/build-real.mjs into segments with captions. Sped-up stretches say so on screen.
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import cues from './real-cues.json';

const INK = '#14161a';
const FONT = 'Geist, Segoe UI, sans-serif';
const fontCss = `@font-face{font-family:"Geist";src:url(${staticFile('Geist-Variable.woff2')}) format("woff2");font-weight:100 900}`;
export const REAL_DURATION = cues.total;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <rect x="25" y="9" width="30" height="30" rx="5" transform="rotate(45 40 24)" fill="none" stroke={INK} strokeWidth="5" />
    <rect x="6" y="26" width="34" height="34" rx="8" fill={INK} />
  </svg>
);

const Card: React.FC<{ top: string; bottom: React.ReactNode; len: number }> = ({ top, bottom, len }) => {
  const f = useCurrentFrame();
  const a = spring({ frame: f, fps: 30, config: { damping: 200, stiffness: 120 } });
  const out = interpolate(f, [len - 8, len], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: '#f6f7fa', justifyContent: 'center', alignItems: 'center', opacity: out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 92, fontWeight: 680, letterSpacing: -4, opacity: a, transform: `translateY(${(1 - a) * 24}px)` }}><Logo size={86} />{top}</div>
      <div style={{ marginTop: 26, fontSize: 38, color: '#4a4f57', letterSpacing: -1, textAlign: 'center', opacity: interpolate(f, [10, 24], [0, 1], clamp) }}>{bottom}</div>
    </AbsoluteFill>
  );
};

const Segment: React.FC<{ c: (typeof cues.cues)[number] }> = ({ c }) => {
  const f = useCurrentFrame();
  const inA = interpolate(f, [0, 6], [0, 1], clamp);
  const capIn = spring({ frame: f - 4, fps: 30, config: { damping: 200, stiffness: 160 } });
  return (
    <AbsoluteFill>
      <OffthreadVideo src={staticFile('rec.mp4')} startFrom={Math.round(c.from * 30)} playbackRate={c.speed} muted style={{ width: '100%', height: '100%', opacity: inA }} />
      {'maskFrom' in c && f >= (c as { maskFrom: number }).maskFrom ? (
        <div style={{ position: 'absolute', left: 334, top: 645, width: 640, height: 26, background: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 6, fontSize: 13.5, color: '#171717', letterSpacing: 0.1 }}>https://grapim.com/signoff/Z6e0sDLlWW8SeROUlNbJ_6jRJ3YoQt0MqO_GaPSjBgc</div>
      ) : null}
      {c.caption ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center', opacity: capIn, transform: `translateY(${(1 - capIn) * 16}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 28px', borderRadius: 999, background: 'rgba(20,22,26,.92)', color: '#fff', fontSize: 34, fontWeight: 600, letterSpacing: -0.6, boxShadow: '0 18px 40px -16px rgba(0,0,0,.5)' }}>
            {c.caption}
            {c.speed >= 3 ? <span style={{ fontSize: 22, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.16)' }}>{Math.round(c.speed)}× speed</span> : null}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const GrapimReal: React.FC = () => (
  <AbsoluteFill style={{ background: '#fafafa', fontFamily: FONT, color: INK }}>
    <style>{fontCss}</style>
    <Audio src={staticFile('real.wav')} />
    <Sequence durationInFrames={cues.introLen}><Card top="Grapim" bottom="Recorded live. Real product, sample client." len={cues.introLen} /></Sequence>
    {cues.cues.map((c, i) => <Sequence key={i} from={c.start} durationInFrames={c.len}><Segment c={c} /></Sequence>)}
    <Sequence from={cues.total - Math.round(3.6 * 30)}><Card top="Grapim" bottom={<>Every new client, deployed<br />with signed proof. <span style={{ color: '#006bff' }}>grapim.com</span></>} len={999} /></Sequence>
  </AbsoluteFill>
);
