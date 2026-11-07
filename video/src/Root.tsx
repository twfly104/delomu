import React from 'react';
import { Composition } from 'remotion';
import { Grapim, DURATION } from './Grapim';
import { GrapimReal, REAL_DURATION } from './GrapimReal';

export const Root: React.FC = () => (
  <>
    <Composition id="Grapim" component={Grapim} durationInFrames={DURATION} fps={30} width={1080} height={1080} />
    <Composition id="GrapimReal" component={GrapimReal} durationInFrames={REAL_DURATION} fps={30} width={1440} height={900} />
  </>
);
