import {BBox} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {auditStaticChecksAcrossFrames} from './multiFrame';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

function item(
  node: StubAuditNode,
  overrides: Partial<AuditItem> = {},
): AuditItem {
  return {id: node.key, node, halo: 0, ...overrides};
}

const SAFE_AREA = new BBox(-1000, -1000, 2000, 2000);

describe('auditStaticChecksAcrossFrames', () => {
  it('drives the seek itself, catching a collision that only exists mid-beat', async () => {
    // The exact gap this closes: a beat's readiness gate only ever checked
    // its first rendered frame. Two elements that are apart at the start and
    // end of a beat but cross paths in the middle (real once `growThrough`
    // exists) would ship undetected by a frame-0-only check.
    const label = new StubAuditNode('label', {
      x: 100,
      y: 100,
      width: 40,
      height: 20,
    });
    const dot = new StubAuditNode('dot', {x: 0, y: 0, width: 10, height: 10});

    const positionsByFrame = new Map<number, [number, number]>([
      [0, [0, 0]],
      [15, [105, 105]], // overlaps the label only at this frame
      [30, [400, 400]],
    ]);

    let seekCalls = 0;
    let renderCalls = 0;

    const report = await auditStaticChecksAcrossFrames({
      seek: frame => {
        seekCalls++;
        const [x, y] = positionsByFrame.get(frame)!;
        dot.moveTo(x, y);
      },
      render: () => {
        renderCalls++;
      },
      frames: [0, 15, 30],
      itemsAtFrame: () => [item(label), item(dot)],
      requiredIds: ['label', 'dot'],
      safeArea: SAFE_AREA,
    });

    expect(seekCalls).toBe(3);
    expect(renderCalls).toBe(3);
    expect(report.passed).toBe(false);
    expect(
      report.findings.some(finding => finding.ruleId === 'collision'),
    ).toBe(true);
    expect(
      report.findings.some(finding => finding.message.includes('[frame 15]')),
    ).toBe(true);
  });

  it('passes when no sampled frame has a finding', async () => {
    const label = new StubAuditNode('label', {
      x: 100,
      y: 100,
      width: 40,
      height: 20,
    });
    const dot = new StubAuditNode('dot', {x: 0, y: 0, width: 10, height: 10});

    const report = await auditStaticChecksAcrossFrames({
      seek: () => {},
      render: () => {},
      frames: [0, 15, 30],
      itemsAtFrame: () => [item(label), item(dot)],
      requiredIds: ['label', 'dot'],
      safeArea: SAFE_AREA,
    });

    expect(report.passed).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it('still runs the coverage/safe-area checks per sampled frame, not just collisions', async () => {
    const label = new StubAuditNode('label', {
      x: 0,
      y: 0,
      width: 40,
      height: 20,
    });

    const report = await auditStaticChecksAcrossFrames({
      seek: () => {},
      render: () => {},
      frames: [0, 10],
      itemsAtFrame: () => [item(label)],
      requiredIds: ['label', 'never-registered'],
      safeArea: SAFE_AREA,
    });

    expect(report.passed).toBe(false);
    expect(
      report.findings.filter(finding => finding.ruleId === 'coverage'),
    ).toHaveLength(2);
  });
});
