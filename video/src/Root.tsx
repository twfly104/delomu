import React from 'react';
import { Composition } from 'remotion';
import { Grapim, DURATION } from './Grapim';

export const Root: React.FC = () => (
  <Composition id="Grapim" component={Grapim} durationInFrames={DURATION} fps={30} width={1080} height={1080} />
);
