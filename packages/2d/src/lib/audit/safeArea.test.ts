import {BBox, Vector2} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {collectEmptyBounds, collectSafeAreaViolations} from './safeArea';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

function item(node: StubAuditNode): AuditItem {
  return {id: node.key, node, halo: 0};
}

describe('collectSafeAreaViolations', () => {
  it('flags an item that extends past the safe area', () => {
    const safeArea = BBox.fromPoints(
      new Vector2(0, 0),
      new Vector2(1000, 1000),
    );
    const offscreen = new StubAuditNode('label', {
      x: 980,
      y: 0,
      width: 100,
      height: 20,
    });

    const findings = collectSafeAreaViolations([item(offscreen)], safeArea);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('safe-area');
  });

  it('passes an item fully inside the safe area', () => {
    const safeArea = BBox.fromPoints(
      new Vector2(0, 0),
      new Vector2(1000, 1000),
    );
    const inside = new StubAuditNode('label', {
      x: 100,
      y: 100,
      width: 50,
      height: 20,
    });

    expect(collectSafeAreaViolations([item(inside)], safeArea)).toHaveLength(0);
  });

  it('reports a node with unresolved geometry as non-finite-bounds, not safe-area', () => {
    // The observed failure: a label whose position came out NaN (an
    // undefined value in a coordinate expression) reached the audit as
    // `BBox(Infinity, Infinity, NaN, NaN)` and was reported as a safe-area
    // violation - feedback that told the scene author to *move* a node whose
    // bounds do not exist, which cannot be acted on. The finding must name
    // the real defect instead.
    const safeArea = BBox.fromPoints(
      new Vector2(0, 0),
      new Vector2(1000, 1000),
    );
    const broken = new StubAuditNode('label_0', {
      x: NaN,
      y: 100,
      width: 50,
      height: 20,
    });

    const findings = collectSafeAreaViolations([item(broken)], safeArea);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('non-finite-bounds');
    expect(findings[0].severity).toBe('blocking');
    expect(findings[0].entities).toEqual(['label_0']);
    expect(findings[0].message).toContain('NaN or Infinity');
  });
});

describe('collectEmptyBounds', () => {
  it('flags a registered, visible item with a zero-size box', () => {
    // Only the derivatives.tsx reimplementation had this check; neither
    // skill helper file does. A zero-size box on a visible item usually
    // means a detached or never-laid-out node - a real defect, not a
    // stylistic nit.
    const detached = new StubAuditNode('phantom', {width: 0, height: 0});
    expect(collectEmptyBounds([item(detached)])).toHaveLength(1);
  });

  it('does not flag a normally-sized item', () => {
    const normal = new StubAuditNode('curve', {width: 40, height: 40});
    expect(collectEmptyBounds([item(normal)])).toHaveLength(0);
  });
});
