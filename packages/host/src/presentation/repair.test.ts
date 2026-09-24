import type {AuditFinding, AuditItem} from '@ovacanvas/2d';
import {theme} from '@ovacanvas/2d/lib/theme/theme';
import {BBox, Matrix2D, Vector2} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {
  attemptMechanicalRepair,
  autoRegisterUnregisteredNodes,
  dropEmptyMayTouchReasons,
} from './repair';

/** Just enough of `Node` for `attemptMechanicalRepair` and `AuditItem` both. */
class FakeNode {
  private pos: Vector2;
  private fillColor: string | null = null;
  private readonly size: number;
  /** A real node's own key, independent of whatever id a scene registers it under. */
  public readonly key: string;
  public constructor(x: number, y: number, key = 'fake-node', size = 20) {
    this.pos = new Vector2(x, y);
    this.key = key;
    this.size = size;
  }
  public position(value?: Vector2): Vector2 {
    if (value !== undefined) this.pos = value;
    return this.pos;
  }
  public fill(value?: string): string | null {
    if (value !== undefined) this.fillColor = value;
    return this.fillColor;
  }
  public cacheBBox(): BBox {
    return BBox.fromSizeCentered(new Vector2(this.size, this.size));
  }
  public localContentBBox(): BBox {
    return this.cacheBBox();
  }
  public localToWorld(): Matrix2D {
    return new Matrix2D(1, 0, 0, 1, this.pos.x, this.pos.y);
  }
  public absoluteOpacity(): number {
    return 1;
  }
  public children(): readonly FakeNode[] {
    return [];
  }
  public parent(): null {
    return null;
  }
}

function item(
  id: string,
  node: FakeNode,
  mayTouch?: ReadonlyMap<string, string>,
): AuditItem {
  return {id, node: node as never, halo: 0, mayTouch};
}

/** A point-defined line: `position()` only offsets its points. */
class FakeLine extends FakeNode {
  public parsedPoints(): Vector2[] {
    return [new Vector2(-50, 0), new Vector2(50, 0)];
  }
}

function collision(a: string, b: string): AuditFinding {
  return {
    ruleId: 'collision',
    severity: 'blocking',
    entities: [a, b],
    geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
    message: `Visual collision: ${a} x ${b}`,
  };
}

describe('attemptMechanicalRepair and pinned items', () => {
  it('moves only the free item when the other is declared fixed', () => {
    const vertex = new FakeNode(0, 0);
    const label = new FakeNode(10, 0);
    const result = attemptMechanicalRepair(
      [{...item('vertex', vertex), fixed: true}, item('label', label)],
      [collision('vertex', 'label')],
    );
    expect(result.changedIds).toEqual(['label']);
    expect(vertex.position()).toEqual(new Vector2(0, 0));
    expect(label.position().x).toBeGreaterThan(10);
  });

  it('never moves a point-defined line, which would detach it from its endpoints', () => {
    const connector = new FakeLine(0, 0);
    const label = new FakeNode(10, 0);
    const result = attemptMechanicalRepair(
      [item('connector', connector), item('label', label)],
      [collision('connector', 'label')],
    );
    expect(result.changedIds).toEqual(['label']);
    expect(connector.position()).toEqual(new Vector2(0, 0));
  });

  it('does nothing when every item in a collision is pinned', () => {
    const a = new FakeLine(0, 0);
    const b = new FakeNode(5, 0);
    const result = attemptMechanicalRepair(
      [item('a', a), {...item('b', b), fixed: true}],
      [collision('a', 'b')],
    );
    expect(result.attempted).toBe(false);
  });

  it('does not nudge a pinned item back into the safe area', () => {
    const vertex = new FakeNode(900, 0);
    const finding: AuditFinding = {
      ruleId: 'safe-area',
      severity: 'blocking',
      entities: ['vertex'],
      geometry: new BBox(890, -10, 20, 20),
      message: 'Safe-area violation: vertex',
    };
    const result = attemptMechanicalRepair(
      [{...item('vertex', vertex), fixed: true}],
      [finding],
      new BBox(-800, -400, 1600, 800),
    );
    expect(result.attempted).toBe(false);
  });
});

describe('attemptMechanicalRepair', () => {
  it('pushes two colliding nodes apart along their center line', () => {
    const a = new FakeNode(0, 0);
    const b = new FakeNode(10, 0);
    const items = [item('a', a), item('b', b)];
    const finding: AuditFinding = {
      ruleId: 'collision',
      severity: 'blocking',
      entities: ['a', 'b'],
      geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
      message: 'Visual collision: a x b',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(true);
    expect(result.changedIds.sort()).toEqual(['a', 'b']);
    // a moves further from b (negative x), b moves further from a (positive x).
    expect(a.position().x).toBeLessThan(0);
    expect(b.position().x).toBeGreaterThan(10);
  });

  it('moves the smaller item much more than a dramatically bigger one, instead of splitting the correction evenly', () => {
    // The real, reported failure this exists to fix: a chess piece
    // colliding with the whole board must not be "repaired" by relocating
    // the board - the piece is the one that should move.
    const board = new FakeNode(0, 0, 'board', 900);
    const piece = new FakeNode(10, 0, 'piece', 20);
    const items = [item('board', board), item('piece', piece)];
    const finding: AuditFinding = {
      ruleId: 'collision',
      severity: 'blocking',
      entities: ['board', 'piece'],
      geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
      message: 'Visual collision: board x piece',
    };

    attemptMechanicalRepair(items, [finding]);

    const boardMoved = Math.abs(board.position().x);
    const pieceMoved = Math.abs(piece.position().x - 10);
    expect(pieceMoved).toBeGreaterThan(boardMoved);
    // The board (900x900 vs 20x20 - a 2025x area ratio) should barely move
    // at all relative to the piece.
    expect(boardMoved).toBeLessThan(pieceMoved * 0.01);
  });

  it('resolves 3+ simultaneous collisions coherently in one pass, not one pair at a time', () => {
    // Three items in a row, each overlapping the next (A-B and B-C, but not
    // A-C). Fixing A-B in isolation and then B-C in isolation is exactly the
    // failure mode this batch solve exists to avoid: nudging B away from A
    // could easily push it right back into C, or vice versa, depending on
    // which pair is "fixed" first and by how much.
    const a = new FakeNode(0, 0, 'a', 20);
    const b = new FakeNode(15, 0, 'b', 20);
    const c = new FakeNode(30, 0, 'c', 20);
    const items = [item('a', a), item('b', b), item('c', c)];
    const findings: AuditFinding[] = [
      {
        ruleId: 'collision',
        severity: 'blocking',
        entities: ['a', 'b'],
        geometry: BBox.fromSizeCentered(new Vector2(5, 5)),
        message: 'Visual collision: a x b',
      },
      {
        ruleId: 'collision',
        severity: 'blocking',
        entities: ['b', 'c'],
        geometry: BBox.fromSizeCentered(new Vector2(5, 5)),
        message: 'Visual collision: b x c',
      },
    ];

    const result = attemptMechanicalRepair(items, findings);

    expect(result.attempted).toBe(true);
    expect(result.changedIds.sort()).toEqual(['a', 'b', 'c']);
    // The real property that matters: nothing is left overlapping anything
    // else once every position settles, all three considered together.
    const overlaps = (x1: FakeNode, x2: FakeNode) =>
      Math.abs(x1.position().x - x2.position().x) < 20;
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, c)).toBe(false);
    expect(overlaps(a, c)).toBe(false);
  });

  it('does nothing for a safe-area finding with no geometry attached', () => {
    const a = new FakeNode(0, 0);
    const items = [item('a', a)];
    const finding: AuditFinding = {
      ruleId: 'safe-area',
      severity: 'blocking',
      entities: ['a'],
      message: 'out of bounds',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(false);
    expect(a.position()).toEqual(new Vector2(0, 0));
  });

  it('ignores a collision finding whose entities are not registered items', () => {
    const items: AuditItem[] = [];
    const finding: AuditFinding = {
      ruleId: 'collision',
      severity: 'blocking',
      entities: ['ghost-a', 'ghost-b'],
      geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
      message: 'Visual collision: ghost-a x ghost-b',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(false);
  });

  it('nudges a safe-area violator back inside the nearest satisfiable area', () => {
    const a = new FakeNode(-500, 0);
    const items = [item('a', a)];
    const box = BBox.fromSizeCentered(new Vector2(20, 20)).translate(
      new Vector2(-500, 0),
    );
    const finding: AuditFinding = {
      ruleId: 'safe-area',
      severity: 'blocking',
      entities: ['a'],
      geometry: box,
      message: 'Safe-area violation: a',
    };
    const safeArea = new BBox(-400, -400, 800, 800);

    const result = attemptMechanicalRepair(items, [finding], safeArea);

    expect(result.attempted).toBe(true);
    expect(result.changedIds).toEqual(['a']);
    expect(a.position().x).toBeGreaterThan(-500);
  });

  it('picks whichever of several safe areas needs the least movement', () => {
    const a = new FakeNode(-500, 0);
    const items = [item('a', a)];
    // Box: left -510, right -490. Both candidate areas exclude it, but by
    // very different amounts.
    const box = BBox.fromSizeCentered(new Vector2(20, 20)).translate(
      new Vector2(-500, 0),
    );
    const finding: AuditFinding = {
      ruleId: 'safe-area',
      severity: 'blocking',
      entities: ['a'],
      geometry: box,
      message: 'Safe-area violation: a',
    };
    const nearArea = new BBox(-480, -400, 880, 800); // needs a ~34px nudge right
    const farArea = new BBox(600, -400, 800, 800); // needs a ~1114px nudge right

    const result = attemptMechanicalRepair(
      items,
      [finding],
      [farArea, nearArea],
    );

    expect(result.attempted).toBe(true);
    // Satisfied by the near area's small nudge, nowhere close to the far one's.
    expect(a.position().x).toBeCloseTo(-466, 0);
  });

  it('does nothing for a safe-area finding when no safe area is supplied', () => {
    const a = new FakeNode(-500, 0);
    const items = [item('a', a)];
    const finding: AuditFinding = {
      ruleId: 'safe-area',
      severity: 'blocking',
      entities: ['a'],
      geometry: BBox.fromSizeCentered(new Vector2(20, 20)),
      message: 'Safe-area violation: a',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(false);
  });

  it('falls every implicated node back to the theme ink on a color-discipline finding', () => {
    // `collectColorOveruse` is a closed-world check: its findings name real
    // node keys, not registered item ids - deliberately different here
    // (`scene/Txt[1]` vs. registered id `a`) so this test only passes if the
    // repair actually looks nodes up by key, the way the real check reports
    // them, not by the id a scene happened to register them under.
    const a = new FakeNode(0, 0, 'scene/Txt[1]');
    const b = new FakeNode(50, 0, 'scene/Txt[2]');
    a.fill('#2F66D0');
    b.fill('#F05A3C');
    const items = [item('a', a), item('b', b)];
    const finding: AuditFinding = {
      ruleId: 'color-discipline',
      severity: 'blocking',
      entities: ['scene/Txt[1]', 'scene/Txt[2]'],
      message: '2 distinct accent colors in use',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(true);
    expect(result.changedIds.sort()).toEqual(['a', 'b']);
    expect(a.fill()).toBe(theme().ink);
    expect(b.fill()).toBe(theme().ink);
  });

  it('ignores a color-discipline entity that names a node with no registered item (e.g. an internal TxtLeaf)', () => {
    const a = new FakeNode(0, 0, 'scene/Txt[1]');
    a.fill('#2F66D0');
    const items = [item('a', a)];
    const finding: AuditFinding = {
      ruleId: 'color-discipline',
      severity: 'blocking',
      entities: ['scene/Txt[1]', 'scene/TxtLeaf[1]'],
      message: '2 distinct accent colors in use',
    };

    const result = attemptMechanicalRepair(items, [finding]);

    expect(result.attempted).toBe(true);
    expect(result.changedIds).toEqual(['a']);
    expect(a.fill()).toBe(theme().ink);
  });
});

describe('autoRegisterUnregisteredNodes', () => {
  /** A minimal real tree: `root.children()` returns the given nodes, so
   * `findUnregisteredVisibleNodes` has something to walk. */
  function fakeRoot(children: readonly FakeNode[]) {
    return {
      key: 'root',
      cacheBBox: () => new BBox(),
      localContentBBox: () => new BBox(),
      localToWorld: () => new Matrix2D(1, 0, 0, 1, 0, 0),
      absoluteOpacity: () => 1,
      children: () => children,
      parent: () => null,
    };
  }

  it('registers a visible node the scene forgot, with a real default halo and no mayTouch', () => {
    const registered = new FakeNode(0, 0, 'registered');
    const stray = new FakeNode(200, 0, 'stray_label');
    const root = fakeRoot([registered, stray]);
    const items = [item('registered', registered)];

    const result = autoRegisterUnregisteredNodes(root as never, items);

    expect(result).not.toBeNull();
    expect(result!.addedIds).toEqual(['stray_label']);
    const added = result!.items.find(i => i.id === 'stray_label');
    expect(added).toBeDefined();
    expect(added!.node).toBe(stray as never);
    expect(added!.mayTouch).toBeUndefined();
    expect(added!.halo).toBeGreaterThan(0);
    // The original, already-registered item is untouched.
    expect(result!.items).toContainEqual(items[0]);
  });

  it('returns null when nothing is unregistered - no-op, not an empty addition', () => {
    const registered = new FakeNode(0, 0, 'registered');
    const root = fakeRoot([registered]);
    const items = [item('registered', registered)];

    expect(autoRegisterUnregisteredNodes(root as never, items)).toBeNull();
  });

  it('an auto-registered node that genuinely overlaps something is still caught by a real re-check - registering is not authorizing', () => {
    // This is the safety property the whole function depends on: it must
    // never be usable to make a real, unauthorized collision invisible.
    const registered = new FakeNode(0, 0, 'registered');
    const strayOverlapping = new FakeNode(5, 0, 'stray_overlap');
    const root = fakeRoot([registered, strayOverlapping]);
    const items = [item('registered', registered)];

    const result = autoRegisterUnregisteredNodes(root as never, items);
    expect(result).not.toBeNull();

    // Re-running collision detection against the augmented item list must
    // still be free to flag this pair - nothing here grants an exemption.
    const finding: AuditFinding = {
      ruleId: 'collision',
      severity: 'blocking',
      entities: ['registered', 'stray_overlap'],
      geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
      message: 'Visual collision: registered x stray_overlap',
    };
    const repair = attemptMechanicalRepair(result!.items, [finding]);
    // Mechanical repair still treats it as a real, ordinary collision -
    // proof the auto-registered item carries no special protection.
    expect(repair.changedIds.sort()).toEqual(['registered', 'stray_overlap']);
  });
});

describe('dropEmptyMayTouchReasons', () => {
  it('returns null when there is nothing to clean up', () => {
    const a = new FakeNode(0, 0, 'a');
    const items = [item('a', a, new Map([['b', 'a real reason']]))];

    expect(dropEmptyMayTouchReasons(items)).toBeNull();
  });

  it('drops an empty-reason entry, leaving the item otherwise untouched', () => {
    const a = new FakeNode(0, 0, 'a');
    const items = [
      item(
        'a',
        a,
        new Map([
          ['b', '   '],
          ['c', 'a real, kept reason'],
        ]),
      ),
    ];

    const result = dropEmptyMayTouchReasons(items);

    expect(result).not.toBeNull();
    expect(result!.changedIds).toEqual(['a']);
    const fixed = result!.items[0];
    expect(fixed.mayTouch?.has('b')).toBe(false);
    expect(fixed.mayTouch?.get('c')).toBe('a real, kept reason');
  });

  it('removes the mayTouch field entirely once its last entry is dropped', () => {
    const a = new FakeNode(0, 0, 'a');
    const items = [item('a', a, new Map([['b', '']]))];

    const result = dropEmptyMayTouchReasons(items);

    expect(result!.items[0].mayTouch).toBeUndefined();
  });

  it('never authorizes a real overlap - the pair is checked normally after cleanup', () => {
    // The actual safety property: an empty-reason entry that WOULD have
    // hidden a real collision must not still hide it once cleaned up -
    // dropping it can only add a check back, never remove one.
    const a = new FakeNode(0, 0, 'a');
    const b = new FakeNode(5, 0, 'b');
    const items = [item('a', a, new Map([['b', '']])), item('b', b)];

    const cleaned = dropEmptyMayTouchReasons(items);
    expect(cleaned).not.toBeNull();

    const finding: AuditFinding = {
      ruleId: 'collision',
      severity: 'blocking',
      entities: ['a', 'b'],
      geometry: BBox.fromSizeCentered(new Vector2(10, 10)),
      message: 'Visual collision: a x b',
    };
    const repair = attemptMechanicalRepair(cleaned!.items, [finding]);
    expect(repair.changedIds.sort()).toEqual(['a', 'b']);
  });
});
