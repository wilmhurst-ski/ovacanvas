import {describe, expect, it} from 'vitest';
import {evaluateVisualAudit} from './report';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';
import {collectInvisibleRequiredItems} from './visibility';

const SAFE_AREA = {left: -500, top: -500, right: 500, bottom: 500} as never;

function item(
  node: StubAuditNode,
  overrides: Partial<AuditItem> = {},
): AuditItem {
  return {id: node.key, node, halo: 0, ...overrides};
}

describe('collectInvisibleRequiredItems', () => {
  it('flags required content that is registered but drawing nothing', () => {
    const ghost = new StubAuditNode('ghost', {
      width: 40,
      height: 20,
      opacity: 0,
    });
    const findings = collectInvisibleRequiredItems([item(ghost)], ['ghost']);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('invisible-required-item');
    expect(findings[0].severity).toBe('blocking');
    expect(findings[0].entities).toEqual(['ghost']);
  });

  it('leaves visible required content alone', () => {
    const shown = new StubAuditNode('shown', {width: 40, height: 20});
    expect(collectInvisibleRequiredItems([item(shown)], ['shown'])).toEqual([]);
  });

  it("does not double-report a missing id - that is the coverage check's finding", () => {
    expect(collectInvisibleRequiredItems([], ['absent'])).toEqual([]);
  });

  it('ignores registered items that were never required', () => {
    const hidden = new StubAuditNode('hidden', {
      width: 40,
      height: 20,
      opacity: 0,
    });
    expect(
      collectInvisibleRequiredItems([item(hidden)], ['something-else']),
    ).toEqual([]);
  });

  it("respects inherited opacity, not just a node's own", () => {
    // A child at full opacity inside an invisible parent draws nothing, and
    // `absoluteOpacity()` is what every other check already trusts.
    const parent = new StubAuditNode('parent', {
      width: 200,
      height: 200,
      opacity: 0,
      children: [new StubAuditNode('child', {width: 40, height: 20})],
    });
    const child = parent.children()[0];
    const findings = collectInvisibleRequiredItems([item(child)], ['child']);
    expect(findings).toHaveLength(1);
  });
});

describe('evaluateVisualAudit with requireVisibleIds', () => {
  const invisible = new StubAuditNode('body', {
    width: 100,
    height: 60,
    opacity: 0,
  });

  it('passes an all-invisible scene when the flag is off - the hole this closes', () => {
    // Worth pinning explicitly: this is the exact state that reported
    // `passed: true` for a beat that rendered a blank canvas.
    const report = evaluateVisualAudit({
      items: [item(invisible)],
      safeArea: SAFE_AREA,
      requiredIds: ['body'],
    });
    expect(report.passed).toBe(true);
  });

  it('refuses the same scene when the flag is on', () => {
    const report = evaluateVisualAudit({
      items: [item(invisible)],
      safeArea: SAFE_AREA,
      requiredIds: ['body'],
      requireVisibleIds: true,
    });
    expect(report.passed).toBe(false);
    expect(report.findings.map(finding => finding.ruleId)).toContain(
      'invisible-required-item',
    );
  });

  it('still passes a visible scene with the flag on', () => {
    const visible = new StubAuditNode('body', {width: 100, height: 60});
    const report = evaluateVisualAudit({
      items: [item(visible)],
      safeArea: SAFE_AREA,
      requiredIds: ['body'],
      requireVisibleIds: true,
    });
    expect(report.passed).toBe(true);
  });
});
