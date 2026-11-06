// Scene timing in frames (30 fps, 120 BPM: a beat is 15 frames, a bar 60). scripts/sound.mjs uses the same starts.
export const SCENES = {
  hook: { from: 0, len: 90 },
  deploy: { from: 90, len: 120 },
  find: { from: 210, len: 180 },
  fix: { from: 390, len: 150 },
  sign: { from: 540, len: 90 },
  end: { from: 630, len: 90 },
} as const;
