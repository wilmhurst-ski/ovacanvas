// Set keys are document paths ("graph.k") and point names capitals, as authored.
/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {walkSteps} from '../document/analysis.js';
import type {SceneDocument, Step} from '../document/model.js';
import {compileLesson} from '../lesson/compile.js';
import {
  asTerms,
  colorize,
  engineAccepts,
  locateTerm,
  splitTerms,
  texProblem,
} from '../tex/terms.js';
import {KITS, prepareDocument} from './expand.js';
import {rigidTurnForTest} from './pieces.js';
import {applySet, lerpValue, numericDifference, parseSetKey} from './set.js';

const EXAMPLES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples',
);
function example(name: string) {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), 'utf8'));
}

function steps(doc: SceneDocument): Step[] {
  const out: Step[] = [];
  walkSteps(doc.timeline, s => out.push(s));
  return out;
}

function prepared(input: unknown) {
  const result = prepareDocument(input, undefined, {split: true});
  const errors = result.issues.filter(i => i.severity === 'error');
  expect(errors).toEqual([]);
  return result.document as SceneDocument;
}

describe('set paths', () => {
  it('reads kit, field and nested paths, and params by name', () => {
    expect(parseSetKey('graph.areas.0.rects')).toEqual({
      kitId: 'graph',
      path: ['areas', '0', 'rects'],
    });
    expect(parseSetKey('graph')).toBeNull();
    const node = {id: 'g', kit: 'plot', x: [0, 1], params: {k: 1}};
    const bySpec = applySet(node, KITS.plot, ['k'], 3);
    expect(bySpec.ok && bySpec.node.params).toEqual({k: 3});
    const missing = applySet(node, KITS.plot, ['q'], 3);
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.hint).toContain('functions');
  });

  it('interpolates numbers and switches everything else at the end', () => {
    expect(
      lerpValue({a: 1, b: [0, 10], s: 'x'}, {a: 3, b: [10, 20], s: 'y'}, 0.5),
    ).toEqual({
      a: 2,
      b: [5, 15],
      s: 'x',
    });
    expect(numericDifference({a: 1, s: 'x'}, {a: 2, s: 'x'})).toBe(true);
    expect(numericDifference({layout: 'a'}, {layout: 'b'})).toBe(false);
  });
});

describe('set beats', () => {
  const plotDoc = (beats: unknown[]) => ({
    version: 1,
    nodes: [
      {
        id: 'graph',
        kit: 'plot',
        x: [-3, 3],
        params: {k: 1},
        functions: {f: 'sin(k*x)'},
        points: {P: {on: 'f', x: 1}},
      },
    ],
    beats,
  });

  it('animates a param change, sampling curves that do not move straight', () => {
    const doc = prepared(plotDoc([{set: {'graph.k': 2}, seconds: 1.2}]));
    const curve = steps(doc).filter(
      s =>
        s.kind === 'tween' &&
        s.node.startsWith('graph_cf') &&
        s.prop === 'points',
    );
    // A sine's shape at k = 1.5 is not the blend of k = 1 and k = 2.
    expect(curve.length).toBeGreaterThan(5);
    expect(curve.every(s => s.kind === 'tween' && s.easing === 'linear')).toBe(
      true,
    );
    // The frame holds still: the y axis is fitted over both values.
    expect(
      steps(doc).some(s => s.kind === 'tween' && s.node === 'graph_ax'),
    ).toBe(false);
  });

  it('moves a point along its curve and reports bad sets on the beat', () => {
    const doc = prepared(plotDoc([{set: {'graph.points.P.x': 2}}]));
    expect(
      steps(doc).some(
        s =>
          s.kind === 'tween' && s.node === 'graph_pP' && s.prop === 'position',
      ),
    ).toBe(true);
    const bad = prepareDocument(
      plotDoc([{set: {'graph.functions.f': 'sin(q*x)'}}]),
    );
    const issue = bad.issues.find(i => i.severity === 'error');
    expect(issue?.step).toBe('beats.0');
    expect(issue?.message).toMatch(/after this set/);
    const unknown = prepareDocument(plotDoc([{set: {'grph.k': 2}}]));
    expect(unknown.issues[0].hint).toContain('"graph"');
  });

  it('sets a plain node prop with a tween', () => {
    const doc = prepared({
      version: 1,
      nodes: [
        {
          id: 'dot',
          component: 'Circle',
          props: {size: 40, fill: {theme: 'blue'}, position: [0, 0]},
        },
      ],
      beats: [{set: {'dot.size': 80}}],
    });
    expect(steps(doc)).toContainEqual(
      expect.objectContaining({
        kind: 'tween',
        node: 'dot',
        prop: 'size',
        to: 80,
      }),
    );
  });

  it('carries a kit changed by set into the next scene as it was left', () => {
    const lesson = compileLesson({
      version: 1,
      scenes: [
        {nodes: plotDoc([]).nodes, beats: [{set: {'graph.k': 2}}]},
        {keep: ['graph'], beats: [{set: {'graph.k': 3}}]},
      ],
    });
    expect(lesson.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(lesson.ok).toBe(true);
  });
});

describe('pieces', () => {
  it('knows a turned copy of a shape, whichever corner it starts from', () => {
    const tri: [number, number][] = [
      [-1, -1],
      [2, -1],
      [-1, 1],
    ];
    const turned = tri.map(([x, y]) => [-y + 5, x + 3] as [number, number]);
    const shifted = [turned[1], turned[2], turned[0]];
    expect(rigidTurnForTest(tri, shifted)).toBeCloseTo(90, 5);
    const mirrored = tri.map(([x, y]) => [-x, y] as [number, number]);
    expect(rigidTurnForTest(tri, mirrored)).toBeNull();
  });

  it('slides and turns same-shaped pieces, and peels new ones off a match', () => {
    const doc = prepared(example('pythagoras-rearrange.ovw.json'));
    const all = steps(doc);
    // T2 starts tucked under T1 and turns out of it as a solid piece.
    const start = doc.nodes.find(n => n.id === 'proof_T2')!;
    const t1 = doc.nodes.find(n => n.id === 'proof_T1')!;
    expect(start.props?.position).toEqual(t1.props?.position);
    expect(
      all.some(
        s =>
          s.kind === 'tween' && s.node === 'proof_T2' && s.prop === 'rotation',
      ),
    ).toBe(true);
    // Its outline never changes during the rearrangement, only its pose.
    const reshapes = all.filter(
      s => s.kind === 'tween' && s.node === 'proof_T2' && s.prop === 'points',
    );
    const layoutBeats = reshapes.filter(
      s => s.kind === 'tween' && s.seconds >= 1,
    );
    expect(layoutBeats.length).toBeLessThanOrEqual(2);
    // A hole with no match fades in, after the pieces have moved.
    const fade = all.find(
      s =>
        s.kind === 'chain' &&
        s.steps.some(x => x.kind === 'tween' && x.node === 'proof_C'),
    );
    expect(fade?.kind === 'chain' && fade.steps[0].kind).toBe('wait');
  });

  it('reports a layout that does not exist', () => {
    const doc = example('pythagoras-rearrange.ovw.json');
    doc.beats = [{set: {'proof.layout': 'sqaure'}}];
    const result = prepareDocument(doc);
    expect(
      result.issues.some(i => /not one of the layouts/.test(i.message)),
    ).toBe(true);
  });
});

describe('focus', () => {
  it('dims the rest of a figure but not the formula beside it', () => {
    const doc = prepared(example('riemann-sum.ovw.json'));
    const dims = steps(doc).filter(
      s => s.kind === 'tween' && s.prop === 'opacity' && s.to === 0.2,
    );
    expect(dims.length).toBeGreaterThan(5);
    expect(
      dims.every(s => s.kind === 'tween' && s.node.startsWith('graph_')),
    ).toBe(true);
    // Moving the focus to the next bar dims the first and brings it back.
    const restored = steps(doc).filter(
      s =>
        s.kind === 'tween' &&
        s.prop === 'opacity' &&
        s.to === 1 &&
        s.node === 'graph_ar0r1',
    );
    expect(dims.some(s => s.kind === 'tween' && s.node === 'graph_ar0r0')).toBe(
      true,
    );
    expect(restored.length).toBeGreaterThan(0);
  });
});

describe('equations as terms', () => {
  it('splits at the top level and joins back exactly', () => {
    const tex = String.raw`\frac{x^2 + y^2}{2} \ge xy`;
    const terms = splitTerms(tex)!;
    expect(terms.join('')).toBe(tex);
    expect(terms[0]).toBe(String.raw`\frac{x^2 + y^2}{2} `);
    expect(splitTerms(String.raw`a & b \\ c`)).toBeNull();
    expect(splitTerms(String.raw`\left( \frac{a}{b} \right)^2 = 1`)![0]).toBe(
      String.raw`\left( \frac{a}{b} \right)^2 `,
    );
  });

  it('checks a split against the engine typesetting before using it', () => {
    expect(engineAccepts(splitTerms(String.raw`2x + 3 = 11`)!)).toBe(true);
    expect(asTerms(String.raw`E = mc^2`)).toEqual(['E ', '= ', 'm', 'c^2']);
    // A fragment the engine could not match leaves the equation whole.
    expect(engineAccepts(['x', '{{y}}'])).toBe(false);
  });

  it('colours symbols wherever they stand, but not inside words or commands', () => {
    const out = colorize(String.raw`2xy + \max(x) + \text{next}`, {
      x: '#2F66D0',
    });
    expect(out).toBe(
      String.raw`2\textcolor{#2F66D0}{x}y + \max(\textcolor{#2F66D0}{x}) + \text{next}`,
    );
  });

  it('colours inside a fraction without making braces the engine strips', () => {
    // From a live run: two coloured letters in \frac{ab}{2}.
    const out = colorize(String.raw`4\cdot\frac{ab}{2} + c^2`, {
      a: '#F05A3C',
      b: '#F3C742',
      c: '#4E9B62',
    });
    expect(out).not.toMatch(/{{/);
    expect(texProblem(out)).toBeNull();
    // Hex digits are never mistaken for a symbol.
    expect(out.match(/textcolor/g)).toHaveLength(3);
  });

  it('reports LaTeX the engine would fail on, located on the node', () => {
    // The engine reads {{...}} as its own fragment marker: this breaks.
    expect(texProblem(String.raw`\frac{{a}{b}}{2}`)).not.toBeNull();
    const result = prepareDocument({
      version: 1,
      nodes: [{id: 'eq', kit: 'derivation', steps: [String.raw`\frac{a}{`]}],
      beats: [{hold: 0.5}],
    });
    const issue = result.issues.find(i => i.code === 'bad_tex');
    expect(issue?.node).toBe('eq');
    expect(issue?.message).toMatch(/will not typeset/);
  });

  it('finds a term inside an equation, the new occurrence first', () => {
    const before = String.raw`\int f\,dx \approx f(0.5)\Delta x`;
    const after = String.raw`\int f\,dx \approx f(0.5)\Delta x + f(1)\Delta x`;
    const first = locateTerm(String.raw`\Delta x`, after)!;
    const added = locateTerm(String.raw`\Delta x`, after, before)!;
    // The second Delta x - the one this step adds - lies further right.
    expect(added.dx).toBeGreaterThan(first.dx + 500);
    expect(locateTerm('q^3', after)).toBeNull();
  });

  it('flies labels from a figure into the terms they become', () => {
    const doc = prepared(example('riemann-sum.ovw.json'));
    const flights = doc.nodes.filter(n => n.id.startsWith('sum_eq_from'));
    // f(0.5) and \Delta x, then f(1) and \Delta x.
    expect(flights).toHaveLength(4);
    const tex = flights.map(n => n.props?.tex);
    expect(tex).toEqual(['f(0.5)', '\\Delta x', 'f(1)', '\\Delta x']);
    // Each starts on its label, hidden, and flies right, into the sum.
    const label = doc.nodes.find(n => n.id === 'graph_ar0m0hl')!;
    expect(flights[0].props?.position).toEqual(label.props?.position);
    expect(flights[0].props?.opacity).toBe(0);
    const move = steps(doc).find(
      s =>
        s.kind === 'tween' && s.node === flights[0].id && s.prop === 'position',
    );
    const to = move?.kind === 'tween' ? (move.to as number[]) : [0, 0];
    expect(to[0]).toBeGreaterThan(300);
    expect(doc.touches).toContainEqual(
      expect.objectContaining({a: flights[0].id, b: '*'}),
    );
  });

  it('warns when nothing in "from" matches the equation', () => {
    const doc = example('riemann-sum.ovw.json');
    doc.beats[3] = {morph: 'sum.1', from: 'heading'};
    const result = prepareDocument(doc, undefined, {split: true});
    expect(
      result.issues.some(
        i => i.step === 'beats.3' && /matches a new term/.test(i.message),
      ),
    ).toBe(true);
  });

  it('brings each flow line out of the one above, lined up on the relation', () => {
    const doc = prepared(example('am-gm-flow.ovw.json'));
    const all = steps(doc);
    const first = all.find(
      s => s.kind === 'set' && s.node === 'proof_s1' && s.prop === 'tex',
    );
    const row0 = doc.nodes.find(n => n.id === 'proof_s0')!;
    expect(first?.kind === 'set' && first.value).toEqual(row0.props?.tex);
    expect(
      all.some(
        s =>
          s.kind === 'tween' && s.node === 'proof_s1' && s.prop === 'position',
      ),
    ).toBe(true);
    // Rows are not all centred: each is shifted to put its relation in line.
    const xs = doc.nodes
      .filter(n => /^proof_s\d$/.test(n.id))
      .map(n => (n.props?.position as number[])[0]);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });

  it('morphs a derivation term by term', () => {
    const doc = prepared(example('riemann-sum.ovw.json'));
    const morph = steps(doc).find(s => s.kind === 'tween' && s.prop === 'tex');
    expect(Array.isArray(morph?.kind === 'tween' && morph.to)).toBe(true);
  });
});
