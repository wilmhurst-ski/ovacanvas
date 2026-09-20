import {describe, expect, it} from 'vitest';
import {
  collectCoverageGaps,
  collectUnregisteredVisibleNodes,
  findUnregisteredVisibleNodes,
} from './coverage';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

function item(node: StubAuditNode): AuditItem {
  return {id: node.key, node, halo: 0};
}

describe('collectCoverageGaps', () => {
  it('flags a required id with no registered item', () => {
    const findings = collectCoverageGaps([], ['axes', 'curve']);
    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toEqual(['axes', 'curve']);
  });

  it('passes when every required id is registered', () => {
    const axes = new StubAuditNode('axes');
    expect(collectCoverageGaps([item(axes)], ['axes'])).toHaveLength(0);
  });
});

describe('collectUnregisteredVisibleNodes', () => {
  it('flags a visible node that draws content but was never registered', () => {
    // This reproduces the exact lab 2 defect: an unplanned
    // "Difference Quotient & Derivative" heading rendered at full opacity
    // from frame 0, never declared as an entity, so no prior implementation
    // (either skill helper, or the derivatives.tsx reimplementation) ever
    // looked at it - all of them only check declared items.
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const unplannedHeading = new StubAuditNode('derivation_title', {
      x: 400,
      y: 0,
      width: 300,
      height: 40,
    });
    const root = new StubAuditNode('root', {
      children: [registered, unplannedHeading],
    });

    const findings = collectUnregisteredVisibleNodes(root, [item(registered)]);

    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toContain('derivation_title');
  });

  it('does not flag an invisible unregistered node', () => {
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const hiddenDraft = new StubAuditNode('scratch', {
      width: 300,
      height: 40,
      opacity: 0,
    });
    const root = new StubAuditNode('root', {
      children: [registered, hiddenDraft],
    });

    expect(
      collectUnregisteredVisibleNodes(root, [item(registered)]),
    ).toHaveLength(0);
  });

  it('does not flag a pure grouping node with no content of its own', () => {
    const child = new StubAuditNode('label', {width: 40, height: 16});
    const group = new StubAuditNode('point_with_label', {children: [child]});
    const root = new StubAuditNode('root', {children: [group]});

    // The whole group is registered by its container id; the group node
    // itself has no own drawable content (zero-size localContentBBox), so
    // it must not be reported as a second, separate offender.
    expect(collectUnregisteredVisibleNodes(root, [item(group)])).toHaveLength(
      0,
    );
  });

  it('does not flag a node registered indirectly through an ancestor', () => {
    const leaf = new StubAuditNode('leaf', {width: 20, height: 20});
    const wrapper = new StubAuditNode('wrapper', {children: [leaf]});
    const root = new StubAuditNode('root', {children: [wrapper]});

    // Registering the wrapper covers every content-bearing descendant,
    // matching how a scene typically registers one id per composed group.
    expect(collectUnregisteredVisibleNodes(root, [item(wrapper)])).toHaveLength(
      0,
    );
  });

  it('never flags the root itself, even when the root has its own non-zero content bounds', () => {
    // A real `View2D` root is a `Rect` subclass, so `getCacheBBox()` reports
    // a non-zero box for its own defined size regardless of fill - every
    // real scene would trip this check on its own root unless the root is
    // structurally exempt. Every other test here uses a zero-size root
    // (the default), which is exactly why this case was never covered
    // before it shipped as a real bug.
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const root = new StubAuditNode('root', {
      width: 1920,
      height: 1080,
      children: [registered],
    });

    expect(
      collectUnregisteredVisibleNodes(root, [item(registered)]),
    ).toHaveLength(0);
  });
});

describe('findUnregisteredVisibleNodes', () => {
  it('returns the real offending node, not just its key - what an auto-repair pass needs to actually register it', () => {
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const strayLabel = new StubAuditNode('stray_label', {
      x: 200,
      width: 60,
      height: 16,
    });
    const root = new StubAuditNode('root', {
      children: [registered, strayLabel],
    });

    const offenders = findUnregisteredVisibleNodes(root, [item(registered)]);

    expect(offenders).toEqual([strayLabel]);
  });

  it('returns an empty array when everything visible is already covered', () => {
    const registered = new StubAuditNode('curve', {width: 100, height: 20});
    const root = new StubAuditNode('root', {children: [registered]});

    expect(findUnregisteredVisibleNodes(root, [item(registered)])).toEqual([]);
  });
});
