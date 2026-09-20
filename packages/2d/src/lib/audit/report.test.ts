import {BBox, Vector2} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {evaluateVisualAudit, runVisualAudit} from './report';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

const SAFE_AREA = BBox.fromPoints(new Vector2(0, 0), new Vector2(1000, 1000));

function item(node: StubAuditNode): AuditItem {
  return {id: node.key, node, halo: 0};
}

describe('evaluateVisualAudit', () => {
  it('refuses a scene with a real collision, and passes once it is fixed', () => {
    // The anti-fakeability property the readiness gate depends on: this
    // reads real geometry, not a flag. Same code path, only the positions
    // change.
    const curveLabel = new StubAuditNode('curve_label', {
      x: 100,
      y: 50,
      width: 80,
      height: 20,
    });
    const tangentLabel = new StubAuditNode('tangent_label', {
      x: 130,
      y: 55,
      width: 90,
      height: 20,
    });
    const items = [item(curveLabel), item(tangentLabel)];

    const broken = evaluateVisualAudit({
      items,
      safeArea: SAFE_AREA,
      requiredIds: ['curve_label', 'tangent_label'],
    });
    expect(broken.passed).toBe(false);
    expect(broken.findings.some(f => f.ruleId === 'collision')).toBe(true);

    tangentLabel.moveTo(400, 400);

    const fixed = evaluateVisualAudit({
      items,
      safeArea: SAFE_AREA,
      requiredIds: ['curve_label', 'tangent_label'],
    });
    expect(fixed.passed).toBe(true);
    expect(fixed.findings).toHaveLength(0);
  });

  it('refuses when an unplanned node draws visibly outside the registry', () => {
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const unplanned = new StubAuditNode('derivation_title', {
      x: 400,
      width: 200,
      height: 30,
    });
    const root = new StubAuditNode('root', {children: [registered, unplanned]});

    const report = evaluateVisualAudit({
      items: [item(registered)],
      safeArea: SAFE_AREA,
      requiredIds: ['curve'],
      root,
    });

    expect(report.passed).toBe(false);
    expect(report.findings.some(f => f.ruleId === 'unregistered-node')).toBe(
      true,
    );
  });

  it('collects every violation rather than stopping at the first', () => {
    const outside = new StubAuditNode('offscreen', {
      x: 5000,
      y: 5000,
      width: 20,
      height: 20,
    });
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 40, height: 40});
    const b = new StubAuditNode('b', {x: 10, y: 10, width: 40, height: 40});

    const report = evaluateVisualAudit({
      items: [item(outside), item(a), item(b)],
      safeArea: SAFE_AREA,
      requiredIds: ['a', 'b', 'offscreen', 'missing'],
    });

    const ruleIds = new Set(report.findings.map(f => f.ruleId));
    expect(ruleIds.has('coverage')).toBe(true);
    expect(ruleIds.has('safe-area')).toBe(true);
    expect(ruleIds.has('collision')).toBe(true);
  });
});

describe('runVisualAudit', () => {
  it('throws on the first blocking finding for direct script/test use', () => {
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 40, height: 40});
    const b = new StubAuditNode('b', {x: 10, y: 10, width: 40, height: 40});

    expect(() =>
      runVisualAudit({
        items: [item(a), item(b)],
        safeArea: SAFE_AREA,
        requiredIds: ['a', 'b'],
      }),
    ).toThrow();
  });

  it('does not throw on a clean scene', () => {
    const a = new StubAuditNode('a', {x: 100, y: 100, width: 40, height: 40});
    expect(() =>
      runVisualAudit({
        items: [item(a)],
        safeArea: SAFE_AREA,
        requiredIds: ['a'],
      }),
    ).not.toThrow();
  });
});
