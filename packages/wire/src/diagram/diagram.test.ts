// Part names are written as a person writes them (W, N, Jan), and set keys
// are dotted paths.
/* eslint-disable @typescript-eslint/naming-convention */
import {describe, expect, it} from 'vitest';
import type {SceneDocument, SceneNode, Step} from '../document/model.js';
import {prepareDocument} from '../kits/expand.js';
import {resolveDiagram, type RawPart} from './resolve.js';

/**
 * The diagram layer's general abilities, each on the smallest drawing that
 * shows it - nothing here is about a subject.
 */

function resolve(parts: Record<string, RawPart>) {
  const issues: string[] = [];
  const result = resolveDiagram({
    parts,
    params: {},
    scale: 100,
    font: 1,
    report: (prop, message, hint) =>
      issues.push(`${prop}: ${message}${hint ? ` (${hint})` : ''}`),
  });
  return {...result, issues};
}

function prepare(input: unknown) {
  const result = prepareDocument(input, undefined, {split: true});
  const errors = result.issues.filter(i => i.severity === 'error');
  return {
    errors,
    nodes: new Map(
      ((result.document as SceneDocument).nodes ?? []).map(n => [n.id, n]),
    ),
    timeline: (result.document as SceneDocument).timeline ?? [],
  };
}

function flatten(steps: readonly Step[]): Step[] {
  return steps.flatMap(s =>
    'steps' in s ? [s, ...flatten((s as {steps: readonly Step[]}).steps)] : [s],
  );
}

function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

describe('diagram: placing by relation', () => {
  it('rests a box on the upward edge of a polygon, turned with it', () => {
    const {placed, issues} = resolve({
      slope: {polygon: [[0, 0], [4, 0], [4, -3]]},
      block: {box: [1, 0.5], on: 'slope', t: 0.5},
    });
    expect(issues).toEqual([]);
    const block = placed.get('block')!;
    // The hypotenuse from (0,0) to (4,-3): 3-4-5, so it rises at 36.87°.
    expect(close(block.rotation, (Math.atan2(-3, 4) * 180) / Math.PI)).toBe(true);
    // Its middle is half its height off the slope's midpoint (2, -1.5).
    const n = [-3 / 5, -4 / 5];
    expect(close(block.center[0], 2 + n[0] * 0.25)).toBe(true);
    expect(close(block.center[1], -1.5 + n[1] * 0.25)).toBe(true);
  });

  it('works out a component and a perpendicular from the surface', () => {
    const {placed} = resolve({
      slope: {polygon: [[0, 0], [4, 0], [4, -3]]},
      block: {box: [1, 0.5], on: 'slope'},
      W: {arrow: {from: 'block', dir: 'down', length: 5}},
      along: {arrow: {from: 'block', component: 'W', dir: 'down slope'}},
      N: {arrow: {from: 'block', dir: 'out slope', length: 1}},
    });
    const along = placed.get('along')!.vector!;
    // |W| sin θ = 5 · 3/5 = 3, pointing down the slope (left and down).
    expect(close(Math.hypot(...along.v), 3)).toBe(true);
    expect(along.v[0]).toBeLessThan(0);
    expect(along.v[1]).toBeGreaterThan(0);
    const out = placed.get('N')!.vector!.v;
    expect(close(out[0] * 4 + out[1] * -3, 0)).toBe(true); // perpendicular
    expect(out[1]).toBeLessThan(0); // away from the slope, upwards
  });

  it('meets two rays from one point where they cross again, not at the start', () => {
    const {placed, issues} = resolve({
      tip: {at: [-6, -2]},
      r1: {ray: ['tip', [0, -2], [3, 0]]},
      r2: {ray: ['tip', [0, 0]]},
      image: {at: {meet: ['r1', 'r2']}},
    });
    expect(issues).toEqual([]);
    const image = placed.get('image')!.center;
    // r2 through the origin: y = -x/3; r1 beyond (3,0): y = 2(x-3)/3.
    expect(close(image[0], 6)).toBe(true);
    expect(close(image[1], -2)).toBe(false);
    expect(close(image[1], 2)).toBe(true);
  });

  it('points at an item from the side it is told', () => {
    const {placed} = resolve({
      cells: {row: [4, 8, 15]},
      p: {arrow: {to: 'cells.2', from: 'below'}},
    });
    const cell = placed.get('cells')!.items![2];
    const [tail, head] = placed.get('p')!.points!;
    expect(close(head[0], cell.center[0])).toBe(true);
    expect(tail[1]).toBeGreaterThan(head[1]);
    expect(head[1]).toBeGreaterThan(cell.bounds.maxY);
  });

  it('spreads items evenly round a ring', () => {
    const {placed} = resolve({
      shell: {ring: 2},
      e: {items: 4, on: 'shell'},
    });
    const items = placed.get('e')!.items!;
    for (const item of items) {
      expect(close(Math.hypot(...item.center), 2)).toBe(true);
    }
    expect(close(items[0].center[1], -2)).toBe(true); // the first at the top
  });

  it('reports loops, unknown parts and unknown templates, with a way out', () => {
    expect(resolve({a: {circle: 1, below: 'b'}, b: {circle: 1, above: 'a'}}).issues.join()).toMatch(
      /loop of references/,
    );
    expect(resolve({shell: {ring: 1}, e: {dot: true, on: 'shel'}}).issues.join()).toMatch(
      /no part "shel".*did you mean "shell"/,
    );
    expect(resolve({m: {use: 'water'}}).issues.join()).toMatch(/no template "water"/);
  });
});

describe('diagram: in documents', () => {
  it('moves items by identity when a beat sets new values', () => {
    const {errors, nodes, timeline} = prepare({
      version: 1,
      nodes: [{id: 'd', kit: 'diagram', parts: {list: {row: [5, 3, 8]}}}],
      beats: [{hold: 0.2}, {set: {'d.list.row': [3, 5, 8]}}],
    });
    expect(errors).toEqual([]);
    // Node d_list0 holds the 5; the swap slides it right, never re-lettered.
    expect(nodes.get('d_list0T')!.props!.text).toBe('5');
    const moves = flatten(timeline).filter(
      s => s.kind === 'tween' && s.prop === 'position' && s.node === 'd_list0',
    );
    expect(moves).toHaveLength(1);
    const to = (moves[0] as unknown as {to: number[]}).to;
    expect(to[0]).toBeGreaterThan((nodes.get('d_list0')!.props!.position as number[])[0]);
    expect(
      flatten(timeline).some(s => s.kind === 'tween' && s.prop === 'text'),
    ).toBe(false);
  });

  it('addresses items, runs of items and the parts of a template', () => {
    const {errors} = prepare({
      version: 1,
      nodes: [
        {
          id: 'd',
          kit: 'diagram',
          define: {
            atom: {
              params: {ang: 90},
              parts: {
                shell: {ring: 1},
                electron: {dot: true, on: 'shell', angle: 'ang', color: 'coral'},
              },
            },
          },
          parts: {
            a: {use: 'atom', at: [-2, 0]},
            b: {use: 'atom', at: [2, 0], with: {ang: 270}},
            cells: {row: [1, 2, 3, 4, 5]},
          },
        },
      ],
      beats: [
        {show: 'd.a.electron'},
        {focus: 'd.cells.1-3'},
        {set: {'d.a.with.ang': 0}},
      ],
    });
    expect(errors).toEqual([]);
  });

  it('lets a vector cross the words of the shape it is drawn from', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [
        {
          id: 'd',
          kit: 'diagram',
          parts: {
            block: {box: [2, 1], text: 'm'},
            F: {arrow: {from: 'block', dir: 'right', length: 3}, label: 'F'},
          },
        },
      ],
      beats: [{hold: 0.2}],
    });
    expect(errors).toEqual([]);
    // A block with words in it: the arrow leaves from its edge.
    const block = nodes.get('d_block')!.props!;
    const start = (nodes.get('d_F')!.props!.points as number[][])[0];
    const [bx] = block.position as number[];
    const [bw] = block.size as number[];
    expect(close(start[0], bx + bw / 2, 1)).toBe(true);
  });

  it('refuses a part that is two things at once', () => {
    const {errors} = prepare({
      version: 1,
      nodes: [{id: 'd', kit: 'diagram', parts: {x: {box: [1, 1], circle: 1}}}],
      beats: [{hold: 0.2}],
    });
    expect(errors.map(e => e.message).join()).toMatch(/a part is one thing/);
  });
});

describe('plot data', () => {
  function barsOf(nodes: Map<string, SceneNode>) {
    return [...nodes.values()].filter(n => /^c_dbars\d+$/.test(n.id));
  }

  it('stands bars on named categories, from zero', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [{id: 'c', kit: 'plot', bars: {Jan: 5, Feb: 8, Mar: 3}}],
      beats: [{hold: 0.2}, {highlight: 'c.bars.Feb'}],
    });
    expect(errors).toEqual([]);
    const bars = barsOf(nodes);
    expect(bars).toHaveLength(3);
    const tops = bars.map(b => Math.min(...(b.props!.points as number[][]).map(p => p[1])));
    // Feb is the tallest (smallest y), Mar the shortest.
    expect(tops[1]).toBeLessThan(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    expect(nodes.get('c_tc1')!.props!.text).toBe('Feb');
    // The highlighted bar has an overlay of its own.
    expect(nodes.has('c_dbars1h')).toBe(true);
  });

  it('changes a bar smoothly when a beat sets its value', () => {
    const {errors, timeline} = prepare({
      version: 1,
      nodes: [{id: 'c', kit: 'plot', bars: {a: 2, b: 4}}],
      beats: [{hold: 0.2}, {set: {'c.bars.b': 6}}],
    });
    expect(errors).toEqual([]);
    expect(
      flatten(timeline).some(
        s => s.kind === 'tween' && s.node === 'c_dbars1' && s.prop === 'points',
      ),
    ).toBe(true);
  });

  it('draws a scatter with its trend line on number axes', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [
        {
          id: 'c',
          kit: 'plot',
          dots: [
            [1, 2],
            [2, 4.1],
            [3, 5.9],
          ],
          functions: {trend: '2x'},
        },
      ],
      beats: [{hold: 0.2}],
    });
    expect(errors).toEqual([]);
    expect([...nodes.keys()].filter(k => k.startsWith('c_ddotsp'))).toHaveLength(3);
    expect(nodes.has('c_ctrend0')).toBe(true);
  });
});

describe('found by the held-out live batch', () => {
  it('keeps a kept diagram in one frame across scenes, items keeping who they are', async () => {
    const {compileLesson} = await import('../lesson/compile.js');
    const lesson = compileLesson({
      version: 1,
      title: 'sort',
      scenes: [
        {
          nodes: [
            {
              id: 'arr',
              kit: 'diagram',
              parts: {
                caption: {text: 'short', above: 'cells'},
                cells: {row: [5, 1, 4], index: true},
              },
            },
          ],
          beats: [{hold: 0.3}, {set: {'arr.cells.row': [1, 5, 4]}}],
        },
        {
          keep: ['arr'],
          beats: [
            {set: {'arr.caption.text': 'a much longer caption than before'}},
            {set: {'arr.cells.row': [1, 4, 5]}},
          ],
        },
      ],
    });
    expect(lesson.issues.filter(i => i.severity === 'error')).toEqual([]);
    const cellAt = (part: number, id: string) =>
      lesson.parts[part].document.nodes.find(n => n.id === id)!.props!
        .position as number[];
    const index = (part: number) =>
      lesson.parts[part].document.nodes.find(n => n.id === 'arr_cellsIx0')!
        .props!.position as number[];
    const last = lesson.parts.length - 1;
    // The index numbers do not move between scenes: one frame for both.
    expect(index(last)).toEqual(index(0));
    // The 5 (item 0) is still node arr_cells0 in the second scene.
    expect(cellAt(last, 'arr_cells0T')).toBeDefined();
    expect(
      lesson.parts[last].document.nodes.find(n => n.id === 'arr_cells0T')!.props!.text,
    ).toBe('5');
  });

  it('reads an arrow written flat on its part, and draws no empty words', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [
        {
          id: 'd',
          kit: 'diagram',
          parts: {
            s: {column: ['', 'B', 'A']},
            top: {arrow: true, to: 's.1', from: 'right', label: 'top'},
          },
        },
      ],
      beats: [{hold: 0.2}],
    });
    expect(errors).toEqual([]);
    expect(nodes.has('d_top')).toBe(true);
    expect(nodes.has('d_s0T')).toBe(false);
  });

  it('turns every word to ink when the colours would exceed two accents', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [
        {
          id: 'q',
          kit: 'diagram',
          parts: {
            cells: {row: ['Ada', 'Ben']},
            front: {text: 'front', left: 'cells', color: 'green'},
            back: {text: 'back', right: 'cells', color: 'coral'},
          },
        },
      ],
      beats: [{highlight: 'q.front'}],
    });
    expect(errors).toEqual([]);
    expect(nodes.get('q_front')!.props!.fill).toEqual({theme: 'ink'});
    expect(nodes.get('q_back')!.props!.fill).toEqual({theme: 'ink'});
  });

  it('keeps line-chart values off their line', () => {
    const {errors, nodes} = prepare({
      version: 1,
      nodes: [
        {
          id: 'c',
          kit: 'plot',
          lines: {'1900': 1.6, '1950': 2.5, '2000': 6.1, '2020': 7.8},
          values: true,
        },
      ],
      beats: [{hold: 0.2}],
    });
    expect(errors).toEqual([]);
    const line = nodes.get('c_dline')!.props!.points as number[][];
    for (let i = 0; i < 4; i++) {
      const [x, y] = nodes.get(`c_dlinev${i}`)!.props!.position as number[];
      // Distance from the value's centre to the nearest piece of the line.
      let best = Infinity;
      for (let k = 1; k < line.length; k++) {
        const [ax, ay] = line[k - 1];
        const [bx, by] = line[k];
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
      }
      expect(best).toBeGreaterThan(14);
    }
  });
});

describe('arrows that bend and turn', () => {
  it('bows a connector between parts and still stops short of both', () => {
    const {placed, issues} = resolve({
      a: {box: [1, 1], at: [0, 0]},
      b: {box: [1, 1], at: [4, 0]},
      link: {arrow: ['a', 'b'], bend: 0.4},
    });
    expect(issues).toEqual([]);
    const points = placed.get('link')!.points!;
    const lowest = Math.min(...points.map(p => p[1]));
    // Bowed to the left of its direction (up, on screen) by a good margin.
    expect(lowest).toBeLessThan(-0.6);
    // Leaves and reaches each box outside it.
    expect(Math.abs(points[0][0]) > 0.5 || Math.abs(points[0][1]) > 0.5).toBe(true);
    const last = points[points.length - 1];
    expect(Math.abs(last[0] - 4) > 0.5 || Math.abs(last[1]) > 0.5).toBe(true);
  });

  it('runs an arrow round a circle, the way the angles go', () => {
    const {placed} = resolve({
      wheel: {circle: 2},
      spin: {arrow: {along: 'wheel', from: 0, to: 90}},
    });
    const points = placed.get('spin')!.points!;
    const [sx, sy] = points[0];
    const [ex, ey] = points[points.length - 1];
    // From the right (0) round to the top (90), just outside the rim.
    expect(sx).toBeGreaterThan(2);
    expect(Math.abs(sy)).toBeLessThan(1e-6);
    expect(Math.abs(ex)).toBeLessThan(1e-6);
    expect(ey).toBeLessThan(-2);
    for (const [x, y] of points) expect(Math.hypot(x, y)).toBeGreaterThan(2);
  });

  it('smooths a line through its points', () => {
    const {placed} = resolve({
      rope: {line: [[0, 0], [1, 1], [2, 0]], smooth: true},
    });
    const points = placed.get('rope')!.points!;
    expect(points.length).toBeGreaterThan(10);
    // It passes through the middle point.
    expect(points.some(([x, y]) => Math.hypot(x - 1, y - 1) < 1e-6)).toBe(true);
  });
});

