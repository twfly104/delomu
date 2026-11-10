// The real-product video: a screen recording of Grapim on the local server with the real model (the sample
// agent of Linden & Co.), cut by scripts/build-real.mjs into segments. The recorder stored, for every shot, the box of
// the one element that matters (a verdict line, a reply, the chips, a review card), so each segment's camera crops the
// recording to that box and the text reads at landing-page size. Captions sit in a band above the app. It opens
// straight on the product (the first check's verdict) and ends on a card with the headline.
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import cues from './real-cues.json';

const INK = '#14161a';
const FONT = 'Geist, Segoe UI, sans-serif';
const fontCss = `@font-face{font-family:"Geist";src:url(${staticFile('Geist-Variable.woff2')}) format("woff2");font-weight:100 900}`;
export const REAL_DURATION = cues.total;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Layout of the 1440x900 frame: a caption band on top, the app in a card below.
const BAND = 112;
const CARD = { x: 60, y: BAND + 4, w: 1320, h: 900 - BAND - 4 - 44 };
const ASPECT = CARD.w / CARD.h;
// The recording is REC CSS pixels (the recorder's window, captured at 2x density). A crop is at least MINW wide, so a small element
// keeps some context and is never blown up past the 2x capture.
const REC = (cues as { rec?: { w: number; h: number } }).rec ?? { w: 1440, h: 900 };
const PAD = 30;
const MINW = 600;

type Box = { x: number; y: number; w: number; h: number };
type Crop = { x: number; y: number; w: number };
const MAXW = 780; // a tall box may widen the crop only this far (text stays readable at 960 px wide)
// In the vendor's app the sidebar (240 px) is never what a shot is about: crops start right of it when they fit.
const APP_LEFT = 250;
const cropOf = (b: Box, app = false): Crop => {
  const w = Math.min(REC.w, Math.max(MINW, b.w + 2 * PAD, Math.min((b.h + 2 * PAD) * ASPECT, Math.max(MAXW, b.w + 2 * PAD))));
  const h = w / ASPECT;
  const x = Math.max(app && APP_LEFT + w <= REC.w ? APP_LEFT : 0, Math.min(REC.w - w, b.x + b.w / 2 - w / 2));
  // a box taller than the crop keeps its end in frame: that is where the reply, the question or the button is
  const y = Math.max(0, Math.min(REC.h - h, b.h + 2 * PAD > h ? b.y + b.h + PAD - h : b.y + b.h / 2 - h / 2));
  return { x, y, w };
};
const FULL: Crop = { x: 0, y: 0, w: REC.w };

// Roles recorded inside the vendor's app (sidebar and assistant button on screen); the rest are the client's pages.
const APP = new Set(['run', 'live', 'results', 'broken', 'pressure', 'fix', 'recheck', 'kept', 'link']);

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

type Cue = (typeof cues.cues)[number] & { cams: { at: number; box: Box }[]; mask?: Box & { text: string }; maskFrom?: number };

const Segment: React.FC<{ c: Cue; caption: string; newCaption: boolean }> = ({ c, caption, newCaption }) => {
  const f = useCurrentFrame();
  // The camera cuts to the shot's first framing, then eases to each later one (a look within the same page).
  const keys = c.cams.length ? c.cams : [{ at: 0, box: { x: 0, y: 0, w: REC.w, h: REC.h } }];
  const app = APP.has(c.role);
  let cam = cropOf(keys[0].box, app) ?? FULL;
  for (const k of keys.slice(1)) {
    if (f < k.at) break;
    const to = cropOf(k.box, app);
    const e = spring({ frame: f - k.at, fps: 30, config: { damping: 200, stiffness: 110 } });
    cam = { x: cam.x + (to.x - cam.x) * e, y: cam.y + (to.y - cam.y) * e, w: cam.w + (to.w - cam.w) * e };
  }
  const s = CARD.w / cam.w;
  const capIn = newCaption ? spring({ frame: f - 2, fps: 30, config: { damping: 200, stiffness: 160 } }) : 1;
  const m = c.mask;
  const mask = !!m && f >= (c.maskFrom ?? 0);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 640, letterSpacing: -1.2, color: INK, opacity: capIn, transform: `translateY(${(1 - capIn) * 12}px)` }}>{caption}</div>
      </div>
      <div style={{ position: 'absolute', left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, overflow: 'hidden', borderRadius: 18, background: '#fafafa', border: '1px solid #e2e4ea', boxShadow: '0 30px 80px -30px rgba(20,22,26,.35)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: REC.w, height: REC.h, transformOrigin: '0 0', transform: `scale(${s}) translate(${-cam.x}px, ${-cam.y}px)` }}>
          <OffthreadVideo src={staticFile('rec.mp4')} startFrom={Math.round(c.from * 30)} playbackRate={c.speed} muted style={{ width: REC.w, height: REC.h }} />
          {/* The sidebar's account footer and the assistant button are not part of the story. */}
          {APP.has(c.role) ? <div style={{ position: 'absolute', left: 0, top: REC.h - 60, width: 239, height: 60, background: '#fafafa' }} /> : null}
          {APP.has(c.role) ? <div style={{ position: 'absolute', left: REC.w - 76, top: REC.h - 76, width: 76, height: 76, background: '#fafafa' }} /> : null}
          {mask ? (
            <div style={{ position: 'absolute', left: m!.x, top: m!.y, width: m!.w, height: m!.h, background: '#fff', display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 13.5, color: '#171717', letterSpacing: 0.1, overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box', border: '1px solid #e5e5e5', borderRadius: 6, fontFamily: 'Consolas, ui-monospace, monospace' }}>{m!.text}</div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// A segment with no caption keeps the one before it, so the band never goes blank mid-story.
const all = cues.cues as Cue[];
const captions = all.reduce<string[]>((acc, c, i) => [...acc, c.caption || acc[i - 1] || ''], []);

export const GrapimReal: React.FC = () => (
  <AbsoluteFill style={{ background: 'linear-gradient(180deg,#f6f7fa 0%,#eef0f5 100%)', fontFamily: FONT, color: INK }}>
    <style>{fontCss}</style>
    <Audio src={staticFile('real.wav')} />
    {all.map((c, i) => (
      <Sequence key={i} from={c.start} durationInFrames={c.len}>
        <Segment c={c} caption={captions[i]} newCaption={captions[i] !== captions[i - 1]} />
      </Sequence>
    ))}
    <Sequence from={cues.total - cues.outroLen}><Card top="Grapim" bottom={<>Go-live never waits on your client’s legal team.<br /><span style={{ color: '#006bff' }}>grapim.com</span></>} len={999} /></Sequence>
  </AbsoluteFill>
);
