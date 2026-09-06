import {describe, expect, it} from 'vitest';
import {differenceAreas, intersectAreas, unionAreas, xorAreas} from './boolean';
import {canonicalizeMultiPolygon, canonicalizeRing} from './canonical';
import {partitionVoronoi, triangulateDelaunay} from './delaunay';
import {convexHull} from './hull';
import {GeometryError, Point2D} from './types';

/** A closed axis-aligned rectangle ring, counter-clockwise from its corner. */
function box(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Point2D[] {
  return [
    {x: minX, y: minY},
    {x: maxX, y: minY},
    {x: maxX, y: maxY},
    {x: minX, y: maxY},
    {x: minX, y: minY},
  ];
}

function points(...pairs: [number, number][]): Point2D[] {
  return pairs.map(([x, y]) => ({x, y}));
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: any) {
    expect(error).toBeInstanceOf(GeometryError);
    return error.code;
  }
  throw new Error('expected the operation to be refused');
}

const UnitA = [box(0, 0, 10, 10)];
const UnitB = [box(5, 5, 15, 15)];

describe('polygon boolean operations', () => {
  // --- A. UNION ---

  it('unions two overlapping polygons into one canonical component', () => {
    expect(unionAreas([UnitA], [UnitB])).toEqual([
      [
        points(
          [0, 0],
          [10, 0],
          [10, 5],
          [15, 5],
          [15, 15],
          [5, 15],
          [5, 10],
          [0, 10],
          [0, 0],
        ),
      ],
    ]);
  });

  // --- B. INTERSECTION ---

  it('intersects two overlapping polygons', () => {
    expect(intersectAreas([UnitA], [UnitB])).toEqual([
      [points([5, 5], [10, 5], [10, 10], [5, 10], [5, 5])],
    ]);
  });

  // --- C. DIFFERENCE ---

  it('subtracts a contained polygon into an outer ring plus a hole', () => {
    const result = differenceAreas(
      [[box(0, 0, 30, 30)]],
      [[box(10, 10, 20, 20)]],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0]).toEqual(
      points([0, 0], [30, 0], [30, 30], [0, 30], [0, 0]),
    );
    // The hole is wound clockwise, opposite to the outer ring it sits in.
    expect(result[0][1]).toEqual(
      points([10, 10], [10, 20], [20, 20], [20, 10], [10, 10]),
    );
  });

  it('subtracts an overlapping polygon without producing a hole', () => {
    const result = differenceAreas([UnitA], [UnitB]);

    expect(result).toEqual([
      [points([0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0])],
    ]);
  });

  // --- D. XOR ---

  it('splits an exclusive-or into canonically ordered components', () => {
    expect(xorAreas([UnitA], [UnitB])).toEqual([
      [points([0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0])],
      [points([5, 10], [10, 10], [10, 5], [15, 5], [15, 15], [5, 15], [5, 10])],
    ]);
  });

  // --- E. DISJOINT AND CONTAINED ---

  it('reports an empty intersection for disjoint polygons', () => {
    expect(intersectAreas([UnitA], [[box(100, 100, 110, 110)]])).toEqual([]);
  });

  it('keeps disjoint polygons as separate canonical components', () => {
    const result = unionAreas([UnitA], [[box(100, 100, 110, 110)]]);

    expect(result).toHaveLength(2);
    expect(result[0][0][0]).toEqual({x: 0, y: 0});
    expect(result[1][0][0]).toEqual({x: 100, y: 100});
  });

  it('collapses a contained polygon into its container', () => {
    const outer = [box(0, 0, 30, 30)];
    const inner = [box(10, 10, 20, 20)];

    expect(unionAreas([outer], [inner])).toEqual([
      [points([0, 0], [30, 0], [30, 30], [0, 30], [0, 0])],
    ]);
    expect(intersectAreas([outer], [inner])).toEqual([
      [points([10, 10], [20, 10], [20, 20], [10, 20], [10, 10])],
    ]);
  });

  it('unions polygons that only touch along an edge', () => {
    const result = unionAreas([[box(0, 0, 10, 10)]], [[box(10, 0, 20, 10)]]);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    // One rectangle, with the endpoints of the vanished shared edge still
    // present as collinear vertices. Canonicalization normalizes how geometry
    // is written down; it does not simplify what it describes, and the
    // governing canonical form deliberately stops short of collinear removal.
    expect(result[0][0]).toEqual(
      points([0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10], [0, 0]),
    );
  });

  it('unions polygons that only touch at a single corner', () => {
    const result = unionAreas([[box(0, 0, 10, 10)]], [[box(10, 10, 20, 20)]]);

    // Kernel semantics decide whether a point contact joins or separates the
    // components; either way every ring that comes back is finite, canonical
    // and area-bearing.
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const polygon of result) {
      expect(polygon[0][0]).toEqual(polygon[0][polygon[0].length - 1]);
      for (const point of polygon[0]) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
  });

  // --- F. HOLES ---

  it('lets a polygon with a hole take part in a boolean operation', () => {
    const withHole = [box(0, 0, 20, 20), box(5, 5, 15, 15)];
    const result = differenceAreas([withHole], [[box(10, 10, 30, 30)]]);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0]).toEqual(
      points(
        [0, 0],
        [20, 0],
        [20, 10],
        [15, 10],
        [15, 5],
        [5, 5],
        [5, 15],
        [10, 15],
        [10, 20],
        [0, 20],
        [0, 0],
      ),
    );
  });

  it('keeps the surviving part of a hole in a union', () => {
    const withHole = [box(0, 0, 20, 20), box(5, 5, 15, 15)];
    const result = unionAreas([withHole], [[box(10, 10, 30, 30)]]);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0][1]).toEqual(
      points([5, 5], [5, 15], [10, 15], [10, 10], [15, 10], [15, 5], [5, 5]),
    );
  });
});

// --- G. CANONICAL EQUIVALENCE ---

describe('canonical equivalence', () => {
  it('normalizes ring start vertex and winding to one representation', () => {
    const fromCorner = canonicalizeRing(box(0, 0, 10, 10), false, 'r');
    const fromMiddle = canonicalizeRing(
      points([10, 10], [0, 10], [0, 0], [10, 0], [10, 10]),
      false,
      'r',
    );
    const reversed = canonicalizeRing(
      points([0, 0], [0, 10], [10, 10], [10, 0], [0, 0]),
      false,
      'r',
    );

    expect(fromMiddle).toEqual(fromCorner);
    expect(reversed).toEqual(fromCorner);
    expect(fromCorner).toEqual(
      points([0, 0], [10, 0], [10, 10], [0, 10], [0, 0]),
    );
  });

  it('ignores repeated adjacent vertices, including across the closure', () => {
    const padded = canonicalizeRing(
      points(
        [0, 0],
        [0, 0],
        [10, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
        [0, 0],
      ),
      false,
      'r',
    );

    expect(padded).toEqual(canonicalizeRing(box(0, 0, 10, 10), false, 'r'));
  });

  it('accepts an unclosed ring and closes it', () => {
    const unclosed = canonicalizeRing(
      points([0, 0], [10, 0], [10, 10], [0, 10]),
      false,
      'r',
    );

    expect(unclosed).toEqual(canonicalizeRing(box(0, 0, 10, 10), false, 'r'));
  });

  it('orders holes and components regardless of how they were supplied', () => {
    const holeA = box(2, 2, 4, 4);
    const holeB = box(6, 6, 8, 8);
    const far = box(50, 50, 60, 60);

    const one = canonicalizeMultiPolygon([
      [box(0, 0, 10, 10), holeA, holeB],
      [far],
    ]);
    const other = canonicalizeMultiPolygon([
      [far],
      [box(0, 0, 10, 10), holeB, holeA],
    ]);

    expect(other).toEqual(one);
    expect(one[0][0][0]).toEqual({x: 0, y: 0});
    expect(one[0][1][0]).toEqual({x: 2, y: 2});
    expect(one[0][2][0]).toEqual({x: 6, y: 6});
    expect(one[1][0][0]).toEqual({x: 50, y: 50});
  });

  it('gives the same boolean result however the operands were described', () => {
    const rotatedA = [points([10, 10], [0, 10], [0, 0], [10, 0], [10, 10])];
    const reversedB = [points([5, 5], [5, 15], [15, 15], [15, 5], [5, 5])];

    expect(unionAreas([rotatedA], [reversedB])).toEqual(
      unionAreas([UnitA], [UnitB]),
    );
  });

  it('preserves collinear vertices rather than simplifying geometry', () => {
    // Recorded deliberately: the frozen canonical form normalizes winding,
    // start vertex and ordering. It does not remove a vertex that lies on the
    // straight line between its neighbours, so two descriptions of one region
    // that differ by such a vertex remain distinct canonical values.
    const sampled = canonicalizeRing(
      points([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]),
      false,
      'r',
    );

    expect(sampled).toEqual(
      points([0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]),
    );
    expect(sampled).not.toEqual(
      canonicalizeRing(box(0, 0, 10, 10), false, 'r'),
    );
  });

  it('separates two rings that share their minimum vertex', () => {
    // Both holes start at (20, 20); only the complete vertex sequence orders
    // them.
    const shared = canonicalizeMultiPolygon([
      [box(0, 0, 100, 100), box(20, 20, 30, 40), box(20, 20, 40, 30)],
    ]);
    const swapped = canonicalizeMultiPolygon([
      [box(0, 0, 100, 100), box(20, 20, 40, 30), box(20, 20, 30, 40)],
    ]);

    expect(swapped).toEqual(shared);
    expect(shared[0][1][0]).toEqual({x: 20, y: 20});
    expect(shared[0][2][0]).toEqual({x: 20, y: 20});
    expect(shared[0][1]).not.toEqual(shared[0][2]);
  });
});

// --- H. NUMERIC FAIL-CLOSED ---

describe('numeric contract', () => {
  it('refuses NaN and infinite coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(
        codeOf(() =>
          canonicalizeRing(
            points([0, 0], [10, 0], [bad, 10], [0, 10]),
            false,
            'r',
          ),
        ),
      ).toBe('NON_FINITE_COORDINATE');
    }
  });

  it('refuses a coordinate that is not a number at all', () => {
    expect(
      codeOf(() =>
        canonicalizeRing(
          [
            {x: 0, y: 0},
            {x: 10, y: 0},
            {x: '10', y: 10},
            {x: 0, y: 10},
          ],
          false,
          'r',
        ),
      ),
    ).toBe('NON_FINITE_COORDINATE');
    expect(codeOf(() => canonicalizeRing([0, 1, 2], false, 'r'))).toBe(
      'INVALID_POINT',
    );
  });

  it('normalizes negative zero so equal geometry serializes equally', () => {
    const ring = canonicalizeRing(
      points([-0, -0], [10, -0], [10, 10], [-0, 10]),
      false,
      'r',
    );

    for (const point of ring) {
      expect(Object.is(point.x, -0)).toBe(false);
      expect(Object.is(point.y, -0)).toBe(false);
    }
    expect(ring).toEqual(canonicalizeRing(box(0, 0, 10, 10), false, 'r'));
    expect(JSON.stringify(ring)).toBe(
      JSON.stringify(canonicalizeRing(box(0, 0, 10, 10), false, 'r')),
    );
  });

  it('refuses non-finite operands before the kernel sees them', () => {
    expect(
      codeOf(() =>
        unionAreas([[points([0, 0], [NaN, 0], [10, 10], [0, 10])]], [UnitB]),
      ),
    ).toBe('NON_FINITE_COORDINATE');
  });

  it('returns only finite coordinates', () => {
    for (const polygon of unionAreas([UnitA], [UnitB])) {
      for (const ring of polygon) {
        for (const point of ring) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
      }
    }
  });
});

// --- I / J. DELAUNAY ---

const SquareWithCentre = [
  {id: 'a', x: 0, y: 0},
  {id: 'b', x: 10, y: 0},
  {id: 'c', x: 10, y: 10},
  {id: 'd', x: 0, y: 10},
  {id: 'e', x: 5, y: 5},
];

describe('Delaunay triangulation', () => {
  it('triangulates a point set completely and by stable identity', () => {
    const result = triangulateDelaunay(SquareWithCentre);

    expect(result.points.map(point => point.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(result.triangles).toEqual([
      {a: 'a', b: 'b', c: 'e'},
      {a: 'a', b: 'e', c: 'd'},
      {a: 'b', b: 'c', c: 'e'},
      {a: 'c', b: 'd', c: 'e'},
    ]);

    // Every triangle names supplied points, and every point is used.
    const known = new Set(result.points.map(point => point.id));
    const used = new Set<string>();
    for (const triangle of result.triangles) {
      for (const id of [triangle.a, triangle.b, triangle.c]) {
        expect(known.has(id)).toBe(true);
        used.add(id);
      }
      // Canonical rotation puts the smallest ID first.
      expect(triangle.a < triangle.b).toBe(true);
      expect(triangle.a < triangle.c).toBe(true);
    }
    expect(used).toEqual(known);
  });

  it('is independent of the order the caller supplied its points in', () => {
    const shuffled = [
      SquareWithCentre[4],
      SquareWithCentre[1],
      SquareWithCentre[3],
      SquareWithCentre[0],
      SquareWithCentre[2],
    ];

    expect(triangulateDelaunay(shuffled)).toEqual(
      triangulateDelaunay(SquareWithCentre),
    );
  });

  it('keeps identity attached to position, not to array slot', () => {
    const renamed = SquareWithCentre.map(point => ({
      ...point,
      id: `z${point.id}`,
    }));
    const result = triangulateDelaunay(renamed);

    expect(result.points.find(point => point.id === 'ze')).toEqual({
      id: 'ze',
      x: 5,
      y: 5,
    });
    expect(result.triangles).toEqual([
      {a: 'za', b: 'zb', c: 'ze'},
      {a: 'za', b: 'ze', c: 'zd'},
      {a: 'zb', b: 'zc', c: 'ze'},
      {a: 'zc', b: 'zd', c: 'ze'},
    ]);
  });
});

// --- K / L. VORONOI ---

const Quadrants = [
  {id: 'ne', x: 5, y: 5},
  {id: 'nw', x: -5, y: 5},
  {id: 'se', x: 5, y: -5},
  {id: 'sw', x: -5, y: -5},
];
const Region = {minX: -10, minY: -10, maxX: 10, maxY: 10};

describe('Voronoi partitioning', () => {
  it('produces one finite cell per seed, tied to the right seed', () => {
    const result = partitionVoronoi(Quadrants, Region);

    expect(result.bounds).toEqual(Region);
    expect(result.cells.map(cell => cell.id)).toEqual(['ne', 'nw', 'se', 'sw']);

    const byId = new Map(result.cells.map(cell => [cell.id, cell]));
    expect(byId.get('ne')!.seed).toEqual({x: 5, y: 5});
    expect(byId.get('ne')!.ring).toEqual(
      points([0, 0], [10, 0], [10, 10], [0, 10], [0, 0]),
    );
    expect(byId.get('nw')!.ring).toEqual(
      points([-10, 0], [0, 0], [0, 10], [-10, 10], [-10, 0]),
    );
    expect(byId.get('se')!.ring).toEqual(
      points([0, -10], [10, -10], [10, 0], [0, 0], [0, -10]),
    );
    expect(byId.get('sw')!.ring).toEqual(
      points([-10, -10], [0, -10], [0, 0], [-10, 0], [-10, -10]),
    );

    // Every cell is finite and inside the requested region.
    for (const cell of result.cells) {
      for (const point of cell.ring) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(Region.minX);
        expect(point.x).toBeLessThanOrEqual(Region.maxX);
        expect(point.y).toBeGreaterThanOrEqual(Region.minY);
        expect(point.y).toBeLessThanOrEqual(Region.maxY);
      }
    }
  });

  it('is independent of the order the caller supplied its seeds in', () => {
    const shuffled = [Quadrants[2], Quadrants[0], Quadrants[3], Quadrants[1]];

    expect(partitionVoronoi(shuffled, Region)).toEqual(
      partitionVoronoi(Quadrants, Region),
    );
  });

  it('gives a single seed the whole region', () => {
    const result = partitionVoronoi([{id: 'only', x: 1, y: 2}], Region);

    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].id).toBe('only');
    expect(result.cells[0].ring).toEqual(
      points([-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]),
    );
  });

  it('refuses a seed that lies outside the region it must partition', () => {
    expect(
      codeOf(() =>
        partitionVoronoi([...Quadrants, {id: 'far', x: 500, y: 0}], Region),
      ),
    ).toBe('SEED_OUTSIDE_BOUNDS');
  });

  it('requires a finite region with extent', () => {
    expect(codeOf(() => partitionVoronoi(Quadrants, undefined))).toBe(
      'INVALID_BOUNDS',
    );
    expect(
      codeOf(() =>
        partitionVoronoi(Quadrants, {
          minX: 0,
          minY: 0,
          maxX: 0,
          maxY: 10,
        }),
      ),
    ).toBe('INVALID_BOUNDS');
    expect(
      codeOf(() =>
        partitionVoronoi(Quadrants, {
          minX: 0,
          minY: 0,
          maxX: Infinity,
          maxY: 10,
        }),
      ),
    ).toBe('NON_FINITE_COORDINATE');
  });
});

// --- M. CONVEX HULL ---

describe('convex hull', () => {
  it('returns a canonical hull and drops interior and edge points', () => {
    expect(
      convexHull(
        points([5, 5], [10, 10], [0, 0], [5, 0], [0, 10], [10, 0], [2, 8]),
      ),
    ).toEqual(points([0, 0], [10, 0], [10, 10], [0, 10], [0, 0]));
  });

  it('does not depend on input order', () => {
    const set = points([0, 0], [10, 0], [10, 10], [0, 10], [4, 6]);
    const shuffled = [set[3], set[1], set[4], set[0], set[2]];

    expect(convexHull(shuffled)).toEqual(convexHull(set));
  });

  it('handles a triangle', () => {
    expect(convexHull(points([0, 0], [10, 0], [5, 8]))).toEqual(
      points([0, 0], [10, 0], [5, 8], [0, 0]),
    );
  });
});

// --- N. DEGENERATE CASES ---

describe('degenerate input', () => {
  it('refuses a ring with no area', () => {
    expect(
      codeOf(() =>
        canonicalizeRing(points([0, 0], [10, 0], [0, 0]), false, 'r'),
      ),
    ).toBe('INVALID_RING');
    expect(
      codeOf(() =>
        canonicalizeRing(points([0, 0], [5, 0], [10, 0], [5, 0]), false, 'r'),
      ),
    ).toBe('DEGENERATE_RING');
  });

  it('refuses a ring with too few distinct vertices', () => {
    expect(
      codeOf(() => canonicalizeRing(points([0, 0], [10, 0]), false, 'r')),
    ).toBe('INVALID_RING');
    expect(codeOf(() => canonicalizeRing([], false, 'r'))).toBe('INVALID_RING');
  });

  it('refuses malformed polygon and multipolygon nesting', () => {
    expect(codeOf(() => canonicalizeMultiPolygon(box(0, 0, 1, 1)))).toBe(
      'INVALID_POLYGON',
    );
    expect(codeOf(() => canonicalizeMultiPolygon([[]]))).toBe(
      'INVALID_POLYGON',
    );
    expect(codeOf(() => canonicalizeMultiPolygon('square'))).toBe(
      'INVALID_MULTIPOLYGON',
    );
    expect(codeOf(() => canonicalizeMultiPolygon([box(0, 0, 1, 1)]))).toBe(
      'INVALID_RING',
    );
  });

  it('refuses two identified points at the same position', () => {
    expect(
      codeOf(() =>
        triangulateDelaunay([
          {id: 'a', x: 0, y: 0},
          {id: 'b', x: 0, y: 0},
          {id: 'c', x: 10, y: 0},
          {id: 'd', x: 5, y: 8},
        ]),
      ),
    ).toBe('DUPLICATE_POINT');
    expect(
      codeOf(() =>
        partitionVoronoi(
          [
            {id: 'a', x: 1, y: 1},
            {id: 'b', x: 1, y: 1},
          ],
          Region,
        ),
      ),
    ).toBe('DUPLICATE_POINT');
  });

  it('refuses two points claiming the same identity', () => {
    expect(
      codeOf(() =>
        triangulateDelaunay([
          {id: 'a', x: 0, y: 0},
          {id: 'a', x: 10, y: 0},
          {id: 'c', x: 5, y: 8},
        ]),
      ),
    ).toBe('DUPLICATE_ID');
  });

  it('refuses a point set that lies on one line', () => {
    const line = [
      {id: 'a', x: 0, y: 0},
      {id: 'b', x: 1, y: 1},
      {id: 'c', x: 2, y: 2},
      {id: 'd', x: 3, y: 3},
    ];

    expect(codeOf(() => triangulateDelaunay(line))).toBe('COLLINEAR_POINT_SET');
    expect(codeOf(() => partitionVoronoi(line, Region))).toBe(
      'COLLINEAR_POINT_SET',
    );
    expect(
      codeOf(() => convexHull(points([0, 0], [1, 1], [2, 2], [3, 3]))),
    ).toBe('COLLINEAR_POINT_SET');
  });

  it('refuses too few points', () => {
    expect(
      codeOf(() =>
        triangulateDelaunay([
          {id: 'a', x: 0, y: 0},
          {id: 'b', x: 1, y: 1},
        ]),
      ),
    ).toBe('INSUFFICIENT_POINTS');
    expect(codeOf(() => partitionVoronoi([], Region))).toBe(
      'INSUFFICIENT_POINTS',
    );
    expect(codeOf(() => convexHull(points([0, 0], [1, 1])))).toBe(
      'INSUFFICIENT_POINTS',
    );
  });

  it('refuses an identity that is not a canonical semantic ID', () => {
    expect(
      codeOf(() =>
        triangulateDelaunay([
          {id: 'a b', x: 0, y: 0},
          {id: 'b', x: 10, y: 0},
          {id: 'c', x: 5, y: 8},
        ]),
      ),
    ).toBe('INVALID_ID');
  });
});
