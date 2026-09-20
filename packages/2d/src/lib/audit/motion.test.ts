import {describe, expect, it} from 'vitest';
import {transitionSampleFrames} from './motion';

describe('transitionSampleFrames', () => {
  it('samples both endpoints plus the interior quartiles, de-duplicated', () => {
    expect(transitionSampleFrames(0, 40)).toEqual([0, 10, 20, 30, 40]);
  });

  it('collapses a span too short to subdivide into its distinct frames only', () => {
    expect(transitionSampleFrames(7, 7)).toEqual([7]);
    expect(transitionSampleFrames(0, 1)).toEqual([0, 1]);
  });

  it('rejects an inverted interval rather than silently sampling it', () => {
    expect(() => transitionSampleFrames(20, 10)).toThrow(
      /end frame precedes its start frame/,
    );
  });
});
