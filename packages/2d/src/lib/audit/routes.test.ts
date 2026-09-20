import {BBox, Vector2} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {collectRouteCollisions, segmentHitsBox} from './routes';
import {StubAuditNode, StubAuditRoute} from './testing/StubAuditNode';
import type {AuditItem, RouteItem} from './types';

function item(node: StubAuditNode): AuditItem {
  return {id: node.key, node, halo: 0};
}

describe('collectRouteCollisions', () => {
  it('flags a long route passing through a label it never declared crossing', () => {
    // The lab 2 scene called runVisualAudit with `routes` always omitted,
    // so this exact check - the one built for long lines running past text -
    // never ran, despite the scene being made almost entirely of lines.
    const secantLine: RouteItem = {
      id: 'secant_line',
      route: new StubAuditRoute([new Vector2(0, 0), new Vector2(200, 200)]),
      halo: 2,
    };
    const label = new StubAuditNode('curve_label', {
      x: 90,
      y: 90,
      width: 40,
      height: 20,
    });

    const findings = collectRouteCollisions([secantLine], [item(label)]);

    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toEqual(['secant_line', 'curve_label']);
  });

  it('does not flag a route authorized to cross a specific obstacle', () => {
    const axis: RouteItem = {
      id: 'x_axis',
      route: new StubAuditRoute([new Vector2(0, 100), new Vector2(400, 100)]),
      halo: 1,
      mayCross: new Map([
        ['origin_tick', 'axis is expected to pass through its own tick marks'],
      ]),
    };
    const tick = new StubAuditNode('origin_tick', {
      x: 200,
      y: 100,
      width: 4,
      height: 10,
    });

    expect(collectRouteCollisions([axis], [item(tick)])).toHaveLength(0);
  });

  it('does not flag a route that never comes near an obstacle', () => {
    const route: RouteItem = {
      id: 'far_line',
      route: new StubAuditRoute([new Vector2(0, 0), new Vector2(10, 0)]),
      halo: 1,
    };
    const farAway = new StubAuditNode('label', {
      x: 900,
      y: 900,
      width: 40,
      height: 20,
    });

    expect(collectRouteCollisions([route], [item(farAway)])).toHaveLength(0);
  });
});

describe('segmentHitsBox', () => {
  it('detects a segment passing through a box', () => {
    const box = BBox.fromPoints(new Vector2(5, -5), new Vector2(15, 5));
    expect(segmentHitsBox(new Vector2(0, 0), new Vector2(20, 0), box)).toBe(
      true,
    );
  });

  it('misses a segment that stays clear of a box', () => {
    const box = BBox.fromPoints(new Vector2(5, 5), new Vector2(15, 15));
    expect(segmentHitsBox(new Vector2(0, 0), new Vector2(20, 0), box)).toBe(
      false,
    );
  });
});
