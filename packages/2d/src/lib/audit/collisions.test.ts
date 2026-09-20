import {Vector2} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {collectCollisions, collectMayTouchReasonErrors} from './collisions';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

function item(
  node: StubAuditNode,
  overrides: Partial<AuditItem> = {},
): AuditItem {
  return {id: node.key, node, halo: 0, ...overrides};
}

describe('collectCollisions', () => {
  it('flags two overlapping visible items', () => {
    // The lab 2 scene shipped exactly this: a "Tangent: f'(1)=2" label
    // overlapping the "f(x)=x^2" curve label, both fully opaque.
    const label = new StubAuditNode('curve_label', {
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

    const findings = collectCollisions([item(label), item(tangentLabel)]);

    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toEqual(['curve_label', 'tangent_label']);
    expect(findings[0].severity).toBe('blocking');
  });

  it('skips items whose bounds never resolved, instead of reporting garbage pairs', () => {
    // A node at a NaN/Infinity position has no real footprint; the defect is
    // reported once by the safe-area check as `non-finite-bounds`. Reporting
    // it here too would bury that finding under meaningless collision pairs
    // against every other item in the scene.
    const broken = new StubAuditNode('label_0', {
      x: NaN,
      y: 100,
      width: 50,
      height: 20,
    });
    const normal = new StubAuditNode('label_1', {
      x: 100,
      y: 100,
      width: 50,
      height: 20,
    });

    const findings = collectCollisions([item(broken), item(normal)]);

    expect(findings).toHaveLength(0);
  });

  it('does not flag items authorized via mayTouch', () => {
    const point = new StubAuditNode('point_p', {
      x: 100,
      y: 100,
      width: 10,
      height: 10,
    });
    const label = new StubAuditNode('point_p_label', {
      x: 100,
      y: 100,
      width: 40,
      height: 16,
    });

    const findings = collectCollisions([
      item(point, {
        mayTouch: new Map([
          ['point_p_label', 'label sits on its own anchor point'],
        ]),
      }),
      item(label),
    ]);

    expect(findings).toHaveLength(0);
  });

  it('authorizes against everything via a "*" entry, still requiring a reason', () => {
    const board = new StubAuditNode('board', {
      x: 0,
      y: 0,
      width: 2000,
      height: 1000,
    });
    const anything = new StubAuditNode('anything', {
      x: 50,
      y: 50,
      width: 40,
      height: 40,
    });

    const findings = collectCollisions([
      item(board, {
        mayTouch: new Map([['*', 'board is the paper the scene is drawn on']]),
      }),
      item(anything),
    ]);

    expect(findings).toHaveLength(0);
  });

  it('does not check invisible items', () => {
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 50, height: 50});
    const b = new StubAuditNode('b', {
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      opacity: 0,
    });

    expect(collectCollisions([item(a), item(b)])).toHaveLength(0);
  });

  it("does not flag a container against its own child - a container's bounding box always encloses its children, that is not an accidental overlap", () => {
    // The exact real failure this exists to catch: a `GeoMap` registered
    // alongside its own `GeoSphere`/`GeoMarker` children, which are
    // themselves added as children of the map so they inherit its
    // projection - guaranteed geometric containment, not a mistake.
    const marker = new StubAuditNode('marker', {
      x: 50,
      y: 50,
      width: 20,
      height: 20,
    });
    const map = new StubAuditNode('map', {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [marker],
    });

    const findings = collectCollisions([item(map), item(marker)]);

    expect(findings).toHaveLength(0);
  });

  it('does not flag a grandparent against a grandchild either', () => {
    const leaf = new StubAuditNode('leaf', {x: 5, y: 5, width: 10, height: 10});
    const child = new StubAuditNode('child', {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      children: [leaf],
    });
    const root = new StubAuditNode('root', {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [child],
    });

    expect(collectCollisions([item(root), item(leaf)])).toHaveLength(0);
  });

  it('still flags two real siblings that overlap, even when both have a parent in the registry', () => {
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 50, height: 50});
    const b = new StubAuditNode('b', {x: 10, y: 10, width: 50, height: 50});
    const parent = new StubAuditNode('parent', {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [a, b],
    });

    const findings = collectCollisions([item(parent), item(a), item(b)]);

    expect(findings).toHaveLength(1);
    expect(findings[0].entities.sort()).toEqual(['a', 'b']);
  });

  describe('sub-pixel rounding tolerance', () => {
    it('does not flag a thin sliver overlap from grid rounding (e.g. boardWidth / 8 landing off-integer)', () => {
      // Two adjacent cells whose shared edge overlaps by 1px due to
      // floating-point division, spanning the whole 60px cell height - a
      // real chessboard's own arithmetic, not a visible defect.
      const cellLeft = new StubAuditNode('sq_1', {
        x: 0,
        y: 0,
        width: 80,
        height: 60,
      });
      const cellRight = new StubAuditNode('sq_2', {
        x: 79,
        y: 0,
        width: 80,
        height: 60,
      });

      expect(collectCollisions([item(cellLeft), item(cellRight)])).toHaveLength(
        0,
      );
    });

    it('still flags a substantial 2D overlap even when one dimension is smallish', () => {
      const a = new StubAuditNode('a', {x: 0, y: 0, width: 100, height: 100});
      const b = new StubAuditNode('b', {x: 70, y: 0, width: 100, height: 100});

      const findings = collectCollisions([item(a), item(b)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities).toEqual(['a', 'b']);
    });
  });

  describe('implicit containment (a container/content relationship the LLM never declared)', () => {
    it("does not flag a piece sitting inside a board's much larger border frame", () => {
      // The exact real failure this exists to fix: a chess board gets a
      // border added in a follow-up edit, and every existing piece on the
      // board - never re-registered against the new border - reports as
      // colliding with it. Border spans the whole board; a piece is a small
      // fraction of that area, sitting well inside it.
      const border = new StubAuditNode('border', {
        x: 0,
        y: 0,
        width: 900,
        height: 900,
      });
      const piece = new StubAuditNode('piece_16', {
        x: 50,
        y: 50,
        width: 40,
        height: 55,
      });

      expect(collectCollisions([item(border), item(piece)])).toHaveLength(0);
    });

    it('does not flag a label sitting inside a much larger card/badge', () => {
      const card = new StubAuditNode('card', {
        x: 0,
        y: 0,
        width: 400,
        height: 200,
      });
      const label = new StubAuditNode('label', {
        x: 20,
        y: 20,
        width: 60,
        height: 20,
      });

      expect(collectCollisions([item(card), item(label)])).toHaveLength(0);
    });

    it('still flags two similarly-sized items overlapping by mistake, even though each is "mostly inside" the other', () => {
      // Two same-sized labels placed almost on top of each other are also
      // ~100% mutually contained - the size-ratio requirement is what keeps
      // this a real, reported collision instead of a silent pass.
      const a = new StubAuditNode('label_a', {
        x: 0,
        y: 0,
        width: 100,
        height: 30,
      });
      const b = new StubAuditNode('label_b', {
        x: 5,
        y: 2,
        width: 100,
        height: 30,
      });

      const findings = collectCollisions([item(a), item(b)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities.sort()).toEqual(['label_a', 'label_b']);
    });

    it('still flags a piece that only partly strays onto a neighboring square, not substantially inside it', () => {
      // A genuine small positioning error (a piece drifted onto the edge of
      // the square next to its own) must NOT be swallowed by this - the
      // piece is only marginally overlapping sq_10, not sitting inside it.
      const sq10 = new StubAuditNode('sq_10', {
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      });
      const piece9 = new StubAuditNode('piece_9', {
        x: 55,
        y: 0,
        width: 50,
        height: 60,
      });

      const findings = collectCollisions([item(sq10), item(piece9)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities.sort()).toEqual(['piece_9', 'sq_10']);
    });

    it('does not weaken the circle-aware check - a filled disk genuinely resting on its own orbit is still flagged', () => {
      // This pair would otherwise satisfy a bare containment+size-ratio
      // test (a small disk box sitting inside a much bigger ring's box) -
      // proving the containment fallback never overrides the more precise
      // circle geometry already covering this case.
      const orbit = new StubAuditNode('orbit', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });
      const electron = new StubAuditNode('electron', {
        x: 160,
        y: 0,
        width: 24,
        height: 24,
        circle: true,
        fill: '#fff',
      });

      const findings = collectCollisions([item(orbit), item(electron)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities.sort()).toEqual(['electron', 'orbit']);
    });
  });

  describe('circle-aware geometry', () => {
    // The exact real failure this exists to catch: "show me an atom" -
    // a small filled nucleus at the center of two much larger stroke-only
    // orbit rings. Every pair's bounding box overlaps (the nucleus's and
    // both orbits' boxes are all centered at the same point), but nothing
    // about the real drawn shapes ever touches.
    it('does not flag two concentric stroke-only rings of different radii', () => {
      const orbit1 = new StubAuditNode('orbit1', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });
      const orbit2 = new StubAuditNode('orbit2', {
        x: 0,
        y: 0,
        width: 540,
        height: 540,
        circle: true,
      });

      expect(collectCollisions([item(orbit1), item(orbit2)])).toHaveLength(0);
    });

    it('does not flag a small filled disk at the center of a much larger ring', () => {
      const nucleus = new StubAuditNode('nucleus', {
        x: 0,
        y: 0,
        width: 70,
        height: 70,
        circle: true,
        fill: '#fff',
      });
      const orbit = new StubAuditNode('orbit', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });

      expect(collectCollisions([item(nucleus), item(orbit)])).toHaveLength(0);
    });

    it("does not flag a small label sitting inside a ring's empty center", () => {
      const orbit = new StubAuditNode('orbit', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });
      const label = new StubAuditNode('label', {
        x: 0,
        y: 0,
        width: 60,
        height: 24,
        text: 'p+ n0',
      });

      expect(collectCollisions([item(orbit), item(label)])).toHaveLength(0);
    });

    it('still flags a filled disk actually touching a ring (an electron resting on its orbit)', () => {
      const orbit = new StubAuditNode('orbit', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });
      // Orbit radius is 160; a small disk centered exactly on that radius
      // genuinely crosses the ring's own line.
      const electron = new StubAuditNode('electron', {
        x: 160,
        y: 0,
        width: 24,
        height: 24,
        circle: true,
        fill: '#fff',
      });

      const findings = collectCollisions([item(orbit), item(electron)]);
      expect(findings).toHaveLength(1);
      expect(findings[0].entities.sort()).toEqual(['electron', 'orbit']);
    });

    it('still flags two overlapping filled disks', () => {
      const a = new StubAuditNode('a', {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        circle: true,
        fill: '#fff',
      });
      const b = new StubAuditNode('b', {
        x: 60,
        y: 0,
        width: 100,
        height: 100,
        circle: true,
        fill: '#fff',
      });

      expect(collectCollisions([item(a), item(b)])).toHaveLength(1);
    });

    it('still flags a genuinely misplaced label overlapping a filled disk', () => {
      const nucleus = new StubAuditNode('nucleus', {
        x: 0,
        y: 0,
        width: 70,
        height: 70,
        circle: true,
        fill: '#fff',
      });
      const label = new StubAuditNode('label', {
        x: 20,
        y: 0,
        width: 60,
        height: 24,
        text: 'stray',
      });

      expect(collectCollisions([item(nucleus), item(label)])).toHaveLength(1);
    });

    it('falls back to the bounding-box check for a non-full circle (a sector/arc)', () => {
      // A pie-slice sector's real footprint is a wedge, not a ring/disk -
      // this deliberately keeps the conservative bounding-box behavior
      // rather than guess at wedge geometry.
      const orbit = new StubAuditNode('orbit', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        circle: true,
      });
      const sector = new StubAuditNode('sector', {
        x: 0,
        y: 0,
        width: 320,
        height: 320,
      });
      // Simulate a non-full arc by not marking it `circle` - it still
      // overlaps orbit's bounding box, and with no circle geometry on
      // either side to refine it, the box check still applies.
      expect(collectCollisions([item(orbit), item(sector)])).toHaveLength(1);
    });
  });

  describe('line-aware geometry', () => {
    it('does not flag two sibling edges that only share a common starting point', () => {
      // The exact binary-tree shape that was failing live: two edges drawn
      // from the same parent point out to two different children have
      // fully-overlapping bounding boxes (each box spans the rectangle
      // between its own two endpoints, and both rectangles contain the
      // shared parent corner) even though the actual drawn strokes only
      // ever meet at that one shared point.
      const edgeToLeftChild = new StubAuditNode('edge_0', {
        points: [new Vector2(0, -220), new Vector2(-300, -80)],
      });
      const edgeToRightChild = new StubAuditNode('edge_1', {
        points: [new Vector2(0, -220), new Vector2(300, -80)],
      });

      expect(
        collectCollisions([item(edgeToLeftChild), item(edgeToRightChild)]),
      ).toHaveLength(0);
    });

    it('still flags two edges that genuinely cross', () => {
      const diagonalA = new StubAuditNode('edge_a', {
        points: [new Vector2(-100, -100), new Vector2(100, 100)],
      });
      const diagonalB = new StubAuditNode('edge_b', {
        points: [new Vector2(-100, 100), new Vector2(100, -100)],
      });

      const findings = collectCollisions([item(diagonalA), item(diagonalB)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities).toEqual(['edge_a', 'edge_b']);
    });

    it("does not flag a line passing near a box outside its own bounding rectangle's occupied path", () => {
      // A vertical edge's AABB is a thin sliver, so this case is already
      // fine under the plain box check too - this instead proves a
      // DIAGONAL line's much larger AABB (which would wrongly overlap a box
      // sitting in the rectangle's "empty corner") is correctly cleared by
      // the real segment-vs-box check.
      const diagonal = new StubAuditNode('edge', {
        points: [new Vector2(0, 0), new Vector2(200, 200)],
      });
      // Sits inside the diagonal's bounding box (0,0)-(200,200) but far from
      // the actual line, in the corner the line never visits.
      const label = new StubAuditNode('label', {
        x: 180,
        y: 20,
        width: 30,
        height: 30,
      });

      expect(collectCollisions([item(diagonal), item(label)])).toHaveLength(0);
    });

    it('still flags a line that genuinely passes through a box', () => {
      const diagonal = new StubAuditNode('edge', {
        points: [new Vector2(0, 0), new Vector2(200, 200)],
      });
      const label = new StubAuditNode('label', {
        x: 100,
        y: 100,
        width: 30,
        height: 30,
      });

      const findings = collectCollisions([item(diagonal), item(label)]);

      expect(findings).toHaveLength(1);
      expect(findings[0].entities).toEqual(['edge', 'label']);
    });
  });
});

describe('collectMayTouchReasonErrors', () => {
  it('rejects an authorization with no stated reason, even if nothing currently overlaps', () => {
    // The lab 2 failure hid a real overlap behind a mayTouch list broad
    // enough to authorize almost everything. Requiring a reason on every
    // entry does not stop someone writing a broad list, but it stops that
    // list from being silent: an empty reason is refused outright.
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 10, height: 10});

    const findings = collectMayTouchReasonErrors([
      item(a, {mayTouch: new Map([['b', '   ']])}),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('mayTouch-reason');
  });

  it('accepts a non-empty reason', () => {
    const a = new StubAuditNode('a', {x: 0, y: 0, width: 10, height: 10});
    const findings = collectMayTouchReasonErrors([
      item(a, {mayTouch: new Map([['b', 'shared construction point']])}),
    ]);
    expect(findings).toHaveLength(0);
  });
});
