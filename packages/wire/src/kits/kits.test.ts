/* eslint-disable @typescript-eslint/naming-convention -- geometry point names are capital letters */
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {
  extractEmbeddedDocument,
  generateBeatSource,
} from '../codegen/generate.js';
import {timelineDuration, walkSteps} from '../document/analysis.js';
import type {SceneDocument} from '../document/model.js';
import {compileDocument} from '../node/compile.js';
import {prepareDocument} from './expand.js';

const EXAMPLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples',
);
const PROOF = JSON.parse(
  fs.readFileSync(path.join(EXAMPLES_DIR, 'geometry-proof.ovw.json'), 'utf8'),
);

const TRIANGLE = {
  id: 'tri',
  kit: 'geometry.figure',
  region: 'left',
  points: {A: [0, 3], B: [4, 3], C: [0, 0]},
  segments: 'AB BC CA',
  rightAngles: ['BAC'],
  angles: {ABC: '\\theta'},
};

function doc(nodes: unknown[], beats?: unknown[]): unknown {
  return {version: 1, nodes, ...(beats ? {beats} : {timeline: []})};
}

function errors(input: unknown) {
  return prepareDocument(input).issues.filter(i => i.severity === 'error');
}

describe('kit validation', () => {
  it('locates problems on the kit instance and field, with hints', () => {
    const [issue] = errors(doc([{...TRIANGLE, segments: 'AB BD'}]));
    expect(issue).toMatchObject({
      node: 'tri',
      prop: 'segments',
      code: 'bad_value',
    });
    expect(issue.message).toContain('unknown point "D"');
    expect(issue.hint).toContain('A, B, C');
  });

  it('suggests the real kit for a misspelt one', () => {
    const [issue] = errors(
      doc([{id: 'fig', kit: 'geometry.figur', points: {}}]),
    );
    expect(issue).toMatchObject({code: 'unknown_component', node: 'fig'});
    expect(issue.hint).toContain('"geometry.figure"');
  });

  it('rejects unknown kit fields instead of dropping them', () => {
    const [issue] = errors(doc([{...TRIANGLE, colour: 'red'}]));
    expect(issue).toMatchObject({
      code: 'unknown_prop',
      node: 'tri',
      prop: 'colour',
    });
  });

  it('locates bad beat targets on the beat, with the real parts as hints', () => {
    const [issue] = errors(doc([TRIANGLE], [{show: 'tri.AD'}]));
    expect(issue).toMatchObject({code: 'unknown_ref', step: 'beats.0'});
    expect(
      errors(doc([TRIANGLE], [{show: 'TRIANGLE.AB'}]))[0].message,
    ).toContain('no kit "TRIANGLE"');
    // Tracing something that is not a line brings it in anyway, with a warning.
    const traced = prepareDocument(doc([TRIANGLE], [{trace: 'tri.A'}])).issues;
    expect(traced.filter(i => i.severity === 'error')).toEqual([]);
    expect(traced.map(i => i.message).join(' ')).toContain(
      'fades in instead of being drawn',
    );
  });

  it('refuses a document with both beats and a timeline', () => {
    const input = {
      version: 1,
      nodes: [TRIANGLE],
      beats: [{hold: 1}],
      timeline: [{kind: 'wait', seconds: 1}],
    };
    expect(
      errors(input).some(i =>
        i.message.includes('either "beats" or "timeline"'),
      ),
    ).toBe(true);
  });
});

describe('kit expansion', () => {
  it('expands the geometry proof into a valid core document', () => {
    const prepared = prepareDocument(PROOF);
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const expanded = prepared.document as SceneDocument;
    expect(expanded.nodes.length).toBeGreaterThan(40);
    expect(JSON.stringify(PROOF).length).toBeLessThan(1500);
    // Highlight overlays exist, start hidden, and are cleared by the next beat.
    const overlays = expanded.nodes.filter(n => n.id.startsWith('fig_hl'));
    expect(overlays.map(n => n.id).sort()).toEqual([
      'fig_hlKLP',
      'fig_hlPKN',
      'fig_hlPMN',
    ]);
    expect(overlays.every(n => n.props?.opacity === 0)).toBe(true);
    // What a beat shows starts hidden; the first step does not.
    const step = (id: string) => expanded.nodes.find(n => n.id === id)!;
    expect(step('proof_s0').props?.opacity).toBeUndefined();
    expect(step('proof_s1').props?.opacity).toBe(0);
    expect(step('proof_w1').props?.opacity).toBe(0);
    expect(timelineDuration(expanded.timeline)).toBeLessThanOrEqual(6);
  });

  it('pins the figure vertices and places every letter away from its point', () => {
    const expanded = prepareDocument(PROOF).document as SceneDocument;
    for (const name of ['K', 'L', 'M', 'N', 'P']) {
      const point = expanded.nodes.find(n => n.id === `fig_pt${name}`)!;
      const letter = expanded.nodes.find(n => n.id === `fig_lb${name}`)!;
      expect(point.fixed).toBe(true);
      const [px, py] = point.props!.position as number[];
      const [lx, ly] = letter.props!.position as number[];
      expect(Math.hypot(lx - px, ly - py)).toBeGreaterThanOrEqual(30);
    }
  });

  it('addresses a declared angle as "angle.ABC" and recolours it on highlight', () => {
    const prepared = prepareDocument(
      doc([TRIANGLE], [{highlight: 'tri.angle.ABC'}]),
    );
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const steps: string[] = [];
    walkSteps((prepared.document as SceneDocument).timeline, s => {
      if (s.kind === 'tween') steps.push(`${s.node}.${s.prop}`);
    });
    expect(steps).toContain('tri_arABC.stroke');
  });

  it('compiles beats: trace draws, morph morphs, highlight draws overlays', () => {
    const input = doc(
      [
        TRIANGLE,
        {
          id: 'eq',
          kit: 'derivation',
          mode: 'morph',
          region: 'right',
          steps: [
            {tex: 'a^2 + b^2 = c^2'},
            {tex: 'c = \\sqrt{a^2 + b^2}', why: 'take square roots'},
          ],
        },
      ],
      [{trace: 'tri.AB'}, {morph: 'eq.1', highlight: 'tri.ABC'}, {hold: 0.5}],
    );
    const prepared = prepareDocument(input);
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const expanded = prepared.document as SceneDocument;
    expect(expanded.nodes.find(n => n.id === 'tri_sgAB')!.props?.end).toBe(0);
    const steps: string[] = [];
    walkSteps(expanded.timeline, s => {
      if (s.kind === 'tween') steps.push(`${s.node}.${s.prop}`);
      if (s.kind === 'set') steps.push(`set ${s.node}.${s.prop}`);
    });
    expect(steps).toContain('tri_sgAB.end');
    expect(steps).toContain('eq_eq.tex');
    expect(steps).toContain('set eq_note.text');
    // "tri.ABC" is the TRIANGLE: highlight draws its overlay.
    expect(steps).toContain('tri_hlABC.opacity');
  });

  it('compresses beats that overshoot the time limit instead of refusing them', () => {
    const beats = Array.from({length: 5}, () => ({show: 'tri.AB', hold: 1.2}));
    const prepared = prepareDocument(doc([TRIANGLE], beats));
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(prepared.issues.find(i => i.code === 'long')?.message).toMatch(
      /compressed/,
    );
    expect(
      timelineDuration((prepared.document as SceneDocument).timeline),
    ).toBeLessThanOrEqual(6);
  });

  it('still refuses beats that cannot fit even when compressed', () => {
    const beats = Array.from({length: 40}, () => ({show: 'tri.AB', hold: 1}));
    const issue = prepareDocument(doc([TRIANGLE], beats)).issues.find(
      i => i.code === 'too_long',
    );
    expect(issue?.severity).toBe('error');
  });

  it('generates, typechecks and embeds the authored (kit) form', () => {
    const compiled = compileDocument(PROOF);
    expect(compiled.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(compiled.ok).toBe(true);
    const source = generateBeatSource(PROOF, {embedDocument: true}).source;
    expect(extractEmbeddedDocument(source)).toEqual(PROOF);
  });

  it('lets plain nodes reference kit parts', () => {
    const label = {
      id: 'legLabel',
      component: 'AnchoredLabel',
      props: {anchor: {ref: 'tri.A'}, text: 'corner'},
    };
    const prepared = prepareDocument(doc([TRIANGLE, label]));
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const expanded = prepared.document as SceneDocument;
    expect(
      expanded.nodes.find(n => n.id === 'legLabel')!.props?.anchor,
    ).toEqual({ref: 'tri_ptA'});
    const [issue] = errors(
      doc([
        TRIANGLE,
        {...label, props: {...label.props, anchor: {ref: 'tri.AX'}}},
      ]),
    );
    expect(issue).toMatchObject({
      code: 'unknown_ref',
      node: 'legLabel',
      prop: 'anchor',
    });
  });

  it('lets angle and right-angle marks touch a polygon drawn through their vertex', () => {
    const polyTriangle = {...TRIANGLE, segments: undefined, polygons: ['ABC']};
    const prepared = prepareDocument(doc([polyTriangle]));
    const touches = (prepared.document as SceneDocument).touches ?? [];
    expect(touches.some(t => t.a === 'tri_raBAC' && t.b === 'tri_pg0')).toBe(
      true,
    );
    expect(touches.some(t => t.a === 'tri_arABC' && t.b === 'tri_pg0')).toBe(
      true,
    );
  });

  it('knows when a segment passes through a named point', () => {
    // The 180-degree proof's construction: a line DE through the apex C, parallel to AB.
    const figure = {
      id: 'fig',
      kit: 'geometry.figure',
      points: {A: [0, 4], B: [6, 4], C: [2, 0], D: [-2, 0], E: [6, 0]},
      segments: 'AB BC CA DE',
      angles: {BCA: 'gamma', DCA: 'alpha'},
    };
    const prepared = prepareDocument(doc([figure]));
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const touches = (prepared.document as SceneDocument).touches ?? [];
    const has = (a: string, b: string) =>
      touches.some(t => (t.a === a && t.b === b) || (t.a === b && t.b === a));
    expect(has('fig_sgDE', 'fig_ptC')).toBe(true);
    expect(has('fig_sgDE', 'fig_sgBC')).toBe(true);
    expect(has('fig_sgDE', 'fig_sgCA')).toBe(true);
    expect(has('fig_arBCA', 'fig_sgDE')).toBe(true);
  });

  it('places side labels outside the figure, and refuses labels anchored to a line', () => {
    const labelled = {...TRIANGLE, sideLabels: {AB: '4', CA: '3', BC: '5'}};
    const prepared = prepareDocument(doc([labelled], [{show: 'tri.side.BC'}]));
    expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
    const nodes = (prepared.document as SceneDocument).nodes;
    const position = (id: string) =>
      nodes.find(n => n.id === id)!.props!.position as number[];
    const [ax, ay] = position('tri_ptA');
    const [, by] = position('tri_ptB');
    const [cx, cy] = position('tri_ptC');
    // AB is the bottom side (y down): its label sits below it; CA is the left side.
    expect(position('tri_slAB')[1]).toBeGreaterThan(Math.max(ay, by));
    expect(position('tri_slCA')[0]).toBeLessThan(Math.min(ax, cx));
    expect(nodes.find(n => n.id === 'tri_slBC')!.props!.opacity).toBe(0);
    void cy;

    const anchored = {
      id: 'len',
      component: 'AnchoredLabel',
      props: {anchor: {ref: 'tri.AB'}, text: 'four'},
    };
    const [issue] = errors(doc([TRIANGLE, anchored]));
    expect(issue).toMatchObject({code: 'bad_ref', node: 'len', prop: 'anchor'});
    expect(issue.hint).toContain('sideLabels');
  });

  it('keeps plain documents on the plain path', () => {
    const plain = {
      version: 1,
      nodes: [{id: 'title', component: 'Txt', props: {text: 'Hi'}}],
      timeline: [],
    };
    const prepared = prepareDocument(plain);
    expect(prepared.expanded).toBe(false);
    expect(prepared.document).toBe(plain);
  });
});

describe('derivation layout estimates', () => {
  it('knows fractions, limits and roots are taller than a line', async () => {
    const {texHeightEm} = await import('./derivation.js');
    expect(texHeightEm('x^2 + 1')).toBe(1.25);
    expect(texHeightEm(String.raw`\frac{a}{b}`)).toBeGreaterThan(2);
    expect(
      texHeightEm(String.raw`\lim_{h \to 0} \frac{(x+h)^3 - x^3}{h}`),
    ).toBeGreaterThan(texHeightEm(String.raw`\frac{a}{b}`));
    expect(texHeightEm(String.raw`\sqrt{2}`)).toBeGreaterThan(1.25);
  });
});
