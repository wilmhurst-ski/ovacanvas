import {Origin} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {AnchoredLatex} from './AnchoredLatex';
import {Node} from './Node';
import {mockScene2D} from './__tests__/mockScene2D';

describe('AnchoredLatex', () => {
  mockScene2D();

  it('positions itself relative to its anchor, ignoring any raw position prop', () => {
    const anchor = new Node({position: [100, 50]});
    const label = new AnchoredLatex({
      tex: 'a = 3',
      anchor,
      origin: Origin.Right,
      distance: 20,
      position: [0, 0],
    });

    expect(label.position().x).toBeCloseTo(120);
    expect(label.position().y).toBeCloseTo(50);
  });

  it('follows the anchor when it moves', () => {
    const anchor = new Node({position: [0, 0]});
    const label = new AnchoredLatex({
      tex: 'x',
      anchor,
      origin: Origin.Top,
      distance: 10,
    });

    expect(label.position().y).toBeCloseTo(-10);
    anchor.position([40, 40]);
    expect(label.position().x).toBeCloseTo(40);
    expect(label.position().y).toBeCloseTo(30);
  });
});
