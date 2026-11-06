// Scene timing in frames (30 fps, 120 BPM: a beat is 15 frames, a bar 60). scripts/sound.mjs reads the same numbers.
export const SCENES = {
  hook: { from: 0, len: 90 },
  find: { from: 90, len: 180 },
  fix: { from: 270, len: 150 },
  sign: { from: 420, len: 90 },
  end: { from: 510, len: 90 },
} as const;
