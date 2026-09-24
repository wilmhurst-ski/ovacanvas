/* eslint-disable @typescript-eslint/naming-convention -- point names are capital letters */
import {describe, expect, it} from 'vitest';
import {timelineDuration, walkSteps} from '../document/analysis.js';
import type {SceneDocument} from '../document/model.js';
import {prepareDocument} from './expand.js';
import {ExpressionError, derivative, parseExpression} from './expression.js';

function doc(nodes: unknown[], beats?: unknown[]): unknown {
  return {version: 1, nodes, ...(beats ? {beats} : {timeline: []})};
}
function errors(input: unknown) {
  return prepareDocument(input).issues.filter(i => i.severity === 'error');
}
function expanded(input: unknown): SceneDocument {
  const prepared = prepareDocument(input);
  expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
  return prepared.document as SceneDocument;
}
function tweens(document: SceneDocument): string[] {
  const out: string[] = [];
  walkSteps(document.timeline, s => {
    if (s.kind === 'tween') out.push(`${s.node}.${s.prop}`);
  });
  return out;
}
function distanceToSegment(p: number[], a: number[], b: number[]): number {
  const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) /
        (abx * abx + aby * aby || 1),
    ),
  );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

describe('the expression language', () => {
  it('reads ordinary maths notation', () => {
    const cases: [string, number, number][] = [
      ['x^2 - 2x + 1', 3, 4],
      ['2sin(x)', Math.PI / 2, 2],
      ['sqrt x', 9, 3],
      ['3(x+1)^2', 1, 12],
      ['-x^2', 2, -4],
      ['e^x', 0, 1],
      ['pi x', 1, Math.PI],
      ['1/(1+x^2)', 1, 0.5],
    ];
    for (const [source, x, expected] of cases) {
      expect(parseExpression(source).evaluate(x), source).toBeCloseTo(
        expected,
        9,
      );
    }
    expect(derivative(parseExpression('x^3'), 2)).toBeCloseTo(12, 4);
  });

  it('refuses what it cannot read, with the position', () => {
    expect(() => parseExpression('x^^2')).toThrow(ExpressionError);
    expect(() => parseExpression('sin(x')).toThrow(/missing "\)"/);
    expect(() => parseExpression('foo(x)')).toThrow(/unknown name "foo"/);
  });
});

describe('the plot kit', () => {
  const plotNode = {
    id: 'graph',
    kit: 'plot',
    x: [-3, 3],
    functions: {f: {expr: 'x^2', label: 'f(x) = x^2'}},
    points: {P: {on: 'f', x: 1}},
    tangents: [{of: 'f', at: 1}],
    areas: [{under: 'f', from: 0, to: 1}],
  };

  it('locates a bad expression on the functions field', () => {
    const [issue] = errors(doc([{...plotNode, functions: {f: 'x^^2'}}]));
    expect(issue).toMatchObject({node: 'graph', prop: 'functions'});
    expect(issue.message).toContain('function "f"');
  });

  it('draws axes, the curve, the tangent, the area and the point', () => {
    const d = expanded(
      doc(
        [plotNode],
        [{trace: 'graph.f'}, {trace: 'graph.tangent0', show: 'graph.P'}],
      ),
    );
    const ids = d.nodes.map(n => n.id);
    for (const id of [
      'graph_ax',
      'graph_ay',
      'graph_cf0',
      'graph_tg0',
      'graph_ar0',
      'graph_pP',
      'graph_plP',
      'graph_clf',
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(tweens(d)).toContain('graph_cf0.end');
  });

  it('keeps point and curve labels off the curve', () => {
    const d = expanded(doc([plotNode]));
    const curve = d.nodes.find(n => n.id === 'graph_cf0')!.props!
      .points as number[][];
    for (const label of ['graph_plP', 'graph_clf']) {
      const at = d.nodes.find(n => n.id === label)!.props!.position as number[];
      const nearest = Math.min(
        ...curve.slice(1).map((p, i) => distanceToSegment(at, curve[i], p)),
      );
      expect(nearest, label).toBeGreaterThan(18);
    }
  });
});

describe('the graph kit', () => {
  const cycle = {
    id: 'cycle',
    kit: 'graph',
    layout: 'cycle',
    nodes: {sea: 'Ocean', cloud: 'Clouds', rain: 'Rain'},
    edges: ['sea->cloud: evaporation', 'cloud->rain', 'rain..>sea'],
  };

  it('parses nodes and every edge form', () => {
    const d = expanded(doc([cycle]));
    const edges = d.nodes.filter(n => /^cycle_e\d$/.test(n.id));
    expect(edges).toHaveLength(3);
    expect(edges[0].props?.endArrow).toBe(true);
    expect(edges[2].props?.lineDash).toEqual([10, 8]);
    expect(d.nodes.find(n => n.id === 'cycle_tsea')?.parent).toBe('cycle_nsea');
  });

  it('locates an edge to an unknown node', () => {
    const [issue] = errors(doc([{...cycle, edges: ['sea->sky']}]));
    expect(issue).toMatchObject({node: 'cycle', prop: 'edges'});
    expect(issue.message).toContain('unknown node "sky"');
  });

  it('lays out flows and trees with dagre, in order', () => {
    for (const layout of ['flow', 'tree'] as const) {
      const d = expanded(
        doc([
          {
            id: 'g',
            kit: 'graph',
            layout,
            nodes: ['a', 'b', 'c'],
            edges: ['a->b', 'b->c'],
          },
        ]),
      );
      const pos = (n: string) =>
        d.nodes.find(x => x.id === `g_n${n}`)!.props!.position as number[];
      const axis = layout === 'flow' ? 0 : 1;
      expect(pos('a')[axis]).toBeLessThan(pos('b')[axis]);
      expect(pos('b')[axis]).toBeLessThan(pos('c')[axis]);
    }
  });

  it('runs a cycle round its ring, stopping short of each node', () => {
    const d = expanded(doc([cycle]));
    const edge = d.nodes.find(n => n.id === 'cycle_e0')!;
    const points = edge.props!.points as number[][];
    // A ring, not a chord: many points, bowed outward from the straight line.
    expect(points.length).toBeGreaterThan(10);
    const [x0, y0] = points[0];
    const [x1, y1] = points[points.length - 1];
    const [xm, ym] = points[Math.floor(points.length / 2)];
    const offset =
      Math.abs((x1 - x0) * (y0 - ym) - (x0 - xm) * (y1 - y0)) /
      Math.hypot(x1 - x0, y1 - y0);
    expect(offset).toBeGreaterThan(20);
    // It stops a gap short of the node it leaves, and is allowed to touch it.
    const sea = d.nodes.find(n => n.id === 'cycle_nsea')!;
    const [sx, sy] = sea.props!.position as number[];
    const [sw, sh] = sea.props!.size as number[];
    const clear = Math.abs(x0 - sx) > sw / 2 || Math.abs(y0 - sy) > sh / 2;
    expect(clear).toBe(true);
    expect(
      d.touches?.some(t => t.a === 'cycle_e0' && t.b === 'cycle_nsea'),
    ).toBe(true);
  });
});

describe('the list, title and motion kits', () => {
  it('wraps long points and keeps each point together', () => {
    const long =
      'Sunlight reaches the surface at a steeper angle in summer, so the same beam is spread over less ground';
    const d = expanded(
      doc([{id: 'l', kit: 'list', region: 'right', items: [long, 'short']}]),
    );
    const lines = d.nodes.filter(n => n.id.startsWith('l_t0_'));
    expect(lines.length).toBeGreaterThan(1);
    expect(d.touches?.some(t => t.a === 'l_t0_0' && t.b === 'l_t0_1')).toBe(
      true,
    );
  });

  it('puts the title at the top', () => {
    const d = expanded(
      doc([
        {
          id: 'h',
          kit: 'title',
          text: 'Seasons',
          subtitle: 'tilt, not distance',
        },
      ]),
    );
    expect((d.nodes[0].props!.position as number[])[1]).toBeLessThan(-350);
    expect(d.nodes[1].role).toBe('subtitle');
  });

  it('plays a simulation as equal-time moves along its computed path', () => {
    const d = expanded(
      doc(
        [
          {
            id: 'throw',
            kit: 'motion',
            kind: 'projectile',
            speed: 18,
            angle: 50,
            seconds: 2,
          },
        ],
        [{play: 'throw'}],
      ),
    );
    const moves = tweens(d).filter(t => t === 'throw_body.position');
    expect(moves.length).toBe(24);
    expect(tweens(d)).toContain('throw_path.end');
    expect(timelineDuration(d.timeline)).toBeCloseTo(2 + 0.6, 1);
  });

  it('refuses to play what has no motion, and draws a pendulum arc without repeated points', () => {
    expect(
      errors(doc([{id: 'h', kit: 'title', text: 'x'}], [{play: 'h'}]))[0]
        .message,
    ).toContain('nothing to play');
    const d = expanded(doc([{id: 'swing', kit: 'motion', kind: 'pendulum'}]));
    const arc = d.nodes.find(n => n.id === 'swing_path')!.props!
      .points as number[][];
    expect(
      arc.every(
        (p, i) => i === 0 || p[0] !== arc[i - 1][0] || p[1] !== arc[i - 1][1],
      ),
    ).toBe(true);
    expect(d.nodes.find(n => n.id === 'swing_rod')!.props!.points).toEqual([
      {ref: 'swing_anchor'},
      {ref: 'swing_body'},
    ]);
  });

  it('shows a whole kit by its id', () => {
    const d = expanded(
      doc(
        [
          {id: 'h', kit: 'title', text: 'Seasons'},
          {id: 'l', kit: 'list', items: ['a']},
        ],
        [{show: 'l'}],
      ),
    );
    expect(d.nodes.find(n => n.id === 'l_t0_0')!.props!.opacity).toBe(0);
    expect(tweens(d)).toContain('l_t0_0.opacity');
  });
});

describe('JSON escape repair', () => {
  it('restores LaTeX commands a single backslash lost, and leaves real text alone', () => {
    const input = {
      version: 1,
      nodes: [
        {
          id: 'eq',
          component: 'Latex',
          props: {tex: '\frac{a}{b} + \beta \times \theta'},
        },
        {id: 'words', component: 'Txt', props: {text: 'first\nsecond'}},
        {
          id: 'proof',
          kit: 'derivation',
          steps: [{tex: 'a = b', why: '\text{given}'}],
        },
      ],
      timeline: [],
    };
    const prepared = prepareDocument(input);
    const d = prepared.document as SceneDocument;
    expect(d.nodes.find(n => n.id === 'eq')!.props!.tex).toBe(
      String.raw`\frac{a}{b} + \beta \times \theta`,
    );
    expect(d.nodes.find(n => n.id === 'words')!.props!.text).toBe(
      'first\nsecond',
    );
    expect(d.nodes.find(n => n.id === 'proof_w0')!.props!.tex).toBe(
      String.raw`\text{given}`,
    );
    const warnings = prepared.issues.filter(i => i.code === 'json_escape');
    expect(warnings.map(w => w.node).sort()).toEqual(['eq', 'proof']);
    expect(warnings.every(w => w.severity === 'warning')).toBe(true);
  });
});
