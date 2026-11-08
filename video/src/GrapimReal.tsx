// The real-product video: a screen recording of Grapim on the local server with the real model (sample client
// Quillby Bank), cut by scripts/build-real.mjs into segments. Each segment has a camera (a crop of the 1440x900
// recording) so the part that matters fills the frame and the text stays readable on a phone; captions sit in a
// band above the app instead of on top of it. Sped-up stretches say so on screen.
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import cues from './real-cues.json';

const INK = '#14161a';
const FONT = 'Geist, Segoe UI, sans-serif';
const fontCss = `@font-face{font-family:"Geist";src:url(${staticFile('Geist-Variable.woff2')}) format("woff2");font-weight:100 900}`;
export const REAL_DURATION = cues.total;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Layout of the 1440x900 frame: a caption band on top, the app in a card below that runs off the bottom edge.
const BAND = 112;
const CARD = { x: 40, y: BAND, w: 1360, h: 900 - BAND };
const ASPECT = CARD.w / CARD.h;

// Camera per cue, in recording pixels: left, top and width of the crop (height follows the card's aspect).
// Keyed by each cue's role in real-cues.json.
type Cam = { x: number; y: number; w: number; then?: { at: number; x: number; y: number; w: number; caption?: string } };
const CAMS: Record<string, Cam> = {
  clients: { x: 292, y: 64, w: 1100 },
  agents: { x: 292, y: 64, w: 1100 },
  check: { x: 300, y: 40, w: 1080 },
  drafting: { x: 300, y: 20, w: 1080 },
  approve: { x: 300, y: 10, w: 1080 },
  judging: { x: 296, y: 70, w: 1080 },
  left: { x: 300, y: 274, w: 1080 },
  second: { x: 296, y: 60, w: 1080 },
  kept: { x: 300, y: 200, w: 1080 },
  link: { x: 300, y: 160, w: 1080 },
  // the client's sign-off form, then (once accepted, the page re-centres lower) the 'Accepted by' line
  signoff: { x: 270, y: 20, w: 900, then: { at: 110, x: 270, y: 190, w: 900, caption: 'Accepted. Signed, in the audit log.' } },
};
const camH = (c: Cam) => c.w / ASPECT;
const fit = (c: Cam): Cam => ({ ...c, y: Math.max(0, Math.min(c.y, 900 - camH(c))) });

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

type Cue = (typeof cues.cues)[number];

const Segment: React.FC<{ c: Cue; i: number; caption: string; newCaption: boolean }> = ({ c, i, caption, newCaption }) => {
  const f = useCurrentFrame();
  // The camera eases from the previous segment's crop to this one's.
  const camOf = (k?: number) => (k == null || k < 0 ? undefined : CAMS[(cues.cues[k] as { role?: string }).role ?? 'clients']);
  const to = fit(camOf(i) ?? CAMS.clients);
  const from = fit(camOf(i - 1) ?? to);
  const k = spring({ frame: f, fps: 30, config: { damping: 200, stiffness: 90 } });
  let cam = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k };
  if (to.then) {
    const t = to.then; const k2 = spring({ frame: f - t.at, fps: 30, config: { damping: 200, stiffness: 90 } });
    cam = { x: cam.x + (t.x - cam.x) * k2, y: cam.y + (t.y - cam.y) * k2, w: cam.w + (t.w - cam.w) * k2 };
  }
  const s = CARD.w / cam.w;
  const late = to.then?.caption && f >= to.then.at + 4 ? to.then : null;
  const capIn = late ? spring({ frame: f - late.at - 4, fps: 30, config: { damping: 200, stiffness: 160 } }) : newCaption ? spring({ frame: f - 2, fps: 30, config: { damping: 200, stiffness: 160 } }) : 1;
  const shown = late ? late.caption : caption;
  const mask = 'maskFrom' in c && f >= (c as { maskFrom: number }).maskFrom;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BAND, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 40, fontWeight: 640, letterSpacing: -1.2, color: INK, opacity: capIn, transform: `translateY(${(1 - capIn) * 12}px)` }}>{shown}</div>
        {c.speed >= 3 ? <div style={{ fontSize: 20, fontWeight: 600, color: '#4a4f57', padding: '5px 12px', borderRadius: 999, background: '#e6e8ee', opacity: capIn }}>{Math.round(c.speed)}× speed</div> : null}
      </div>
      <div style={{ position: 'absolute', left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h + 40, overflow: 'hidden', borderRadius: '16px 16px 0 0', background: '#fafafa', border: '1px solid #e2e4ea', borderBottom: 'none', boxShadow: '0 30px 80px -30px rgba(20,22,26,.35)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1440, height: 900, transformOrigin: '0 0', transform: `scale(${s}) translate(${-cam.x}px, ${-cam.y}px)` }}>
          <OffthreadVideo src={staticFile('rec.mp4')} startFrom={Math.round(c.from * 30)} playbackRate={c.speed} muted style={{ width: 1440, height: 900 }} />
          {/* The recording's test-account email (sidebar footer) and the assistant button are not part of the story. */}
          <div style={{ position: 'absolute', left: 0, top: 840, width: 239, height: 60, background: '#fafafa' }} />
          <div style={{ position: 'absolute', left: 1364, top: 824, width: 76, height: 76, background: '#fafafa' }} />
          {mask ? (
            <div style={{ position: 'absolute', left: 334, top: 614, width: 660, height: 26, background: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 6, fontSize: 13.5, color: '#171717', letterSpacing: 0.1 }}>https://grapim.com/signoff/Z6e0sDLlWW8SeROUlNbJ_6jRJ3YoQt0MqO_GaPSjBgc</div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// A segment with no caption keeps the one before it, so the band never goes blank mid-story.
const captions = cues.cues.reduce<string[]>((acc, c, i) => [...acc, c.caption || acc[i - 1] || ''], []);

export const GrapimReal: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(180deg,#f6f7fa 0%,#eef0f5 100%)', fontFamily: FONT, color: INK }}>
    <style>{fontCss}</style>
    <Audio src={staticFile('real.wav')} />
    <Sequence durationInFrames={cues.introLen}><Card top="Grapim" bottom="Recorded live. Real product, sample client." len={cues.introLen} /></Sequence>
    {cues.cues.map((c, i) => (
      <Sequence key={i} from={c.start} durationInFrames={c.len}>
        <Segment c={c} i={i} caption={captions[i]} newCaption={captions[i] !== captions[i - 1]} />
      </Sequence>
    ))}
    <Sequence from={cues.total - Math.round(3.6 * 30)}><Card top="Grapim" bottom={<>Every new client, deployed<br />with signed proof. <span style={{ color: '#006bff' }}>grapim.com</span></>} len={999} /></Sequence>
  </AbsoluteFill>
);
