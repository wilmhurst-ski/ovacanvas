import {describe, expect, it} from 'vitest';
import {generateBeatSource} from '../codegen/generate.js';
import {walkSteps} from '../document/analysis.js';
import type {SceneDocument} from '../document/model.js';
import {prepareDocument} from './expand.js';

function doc(nodes: unknown[], beats?: unknown[]): unknown {
  return {version: 1, nodes, ...(beats ? {beats} : {timeline: []})};
}
function expanded(input: unknown): SceneDocument {
  const prepared = prepareDocument(input);
  expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
  return prepared.document as SceneDocument;
}
function worldSpec(document: SceneDocument, id: string) {
  const node = document.nodes.find(n => n.id === id)!;
  return (node.props!.world as {args: Record<string, unknown>[]}).args[0];
}

const BOWL = {
  id: 'plot',
  kit: 'graph3d',
  surface: '0.5x^2 + y^2',
  x: [-2, 2],
  y: [-2, 2],
  curves: {path: {x: '1.8(0.55)^t', y: '1.5(0.3)^t', t: [0, 6]}},
  points: {start: [1.8, 1.5], minimum: [0, 0]},
  vectors: {uphill: {at: [1.8, 1.5], direction: 'gradient'}},
};

describe('the graph3d kit', () => {
  it('samples the surface and builds a lit world through the engine', () => {
    const document = expanded(doc([BOWL]));
    const spec = worldSpec(document, 'plot_base');
    const surface = (
      spec.surfaces as {heights: number[]; colormap: string}[]
    )[0];
    expect(surface.heights).toHaveLength(41 * 41);
    expect(surface.colormap).toBe('viridis');
    expect(spec.curves).toHaveLength(1);
    expect(spec.spheres).toHaveLength(2);
    expect(spec.arrows).toHaveLength(1);
    const source = generateBeatSource(document).source;
    expect(source).toContain('world: buildWorld3D({');
    expect(source).toMatch(
      /import \{[^}]*buildWorld3D[^}]*\} from '@ovacanvas\/2d'/,
    );
  });

  it('draws a gradient up along the surface, not into it', () => {
    const document = expanded(doc([BOWL]));
    const arrow = (
      worldSpec(document, 'plot_base').arrows as {
        from: number[];
        to: number[];
      }[]
    )[0];
    expect(arrow.to[1]).toBeGreaterThan(arrow.from[1]);
  });

  it('gives each shown part its own layer, stacked in the order the beats show them', () => {
    const document = expanded(
      doc(
        [BOWL],
        [
          {show: 'plot.uphill'},
          {show: 'plot.path'},
          {highlight: 'plot.minimum'},
        ],
      ),
    );
    const layers = document.nodes
      .filter(n => n.component === 'Scene3D')
      .map(n => n.id);
    expect(layers).toEqual([
      'plot_base',
      'plot_show0',
      'plot_show1',
      'plot_hi3',
      'plot_labels',
    ]);
    expect(worldSpec(document, 'plot_base').curves).toBeUndefined();
    expect(worldSpec(document, 'plot_show0').arrows).toHaveLength(1);
    expect(worldSpec(document, 'plot_show1').curves).toHaveLength(1);
    // Layers a beat shows start hidden; the highlight is an overlay.
    const opacity = (id: string) =>
      document.nodes.find(n => n.id === id)!.props!.opacity;
    expect(opacity('plot_show0')).toBe(0);
    expect(opacity('plot_hi3')).toBe(0);
  });

  it('turns every layer around together when played, labels resting meanwhile', () => {
    const document = expanded(doc([BOWL], [{play: 'plot'}]));
    const cameraTweens = new Map<string, number>();
    const labelFades: number[] = [];
    walkSteps(document.timeline, step => {
      if (step.kind !== 'tween') return;
      if (step.prop === 'camera') {
        cameraTweens.set(step.node, (cameraTweens.get(step.node) ?? 0) + 1);
      }
      if (step.prop === 'opacity' && step.node.startsWith('plot_t')) {
        labelFades.push(step.to as number);
      }
    });
    expect([...cameraTweens.keys()].sort()).toEqual([
      'plot_base',
      'plot_labels',
    ]);
    expect(cameraTweens.get('plot_base')).toBe(24);
    expect(labelFades).toContain(0);
    expect(labelFades).toContain(1);
  });

  it('does not let one spike flatten the rest of the surface', () => {
    const document = expanded(
      doc([
        {
          id: 'g',
          kit: 'graph3d',
          surface: '1/(x^2 + y^2)',
          x: [-2, 2],
          y: [-2, 2],
        },
      ]),
    );
    const heights = (
      worldSpec(document, 'g_base').surfaces as {heights: number[]}[]
    )[0].heights;
    const distinct = new Set(heights.map(h => Math.round(h * 100)));
    expect(distinct.size).toBeGreaterThan(20);
  });

  it('reports bad expressions and fields where they are', () => {
    const issues = prepareDocument(
      doc([
        {
          id: 'g',
          kit: 'graph3d',
          surface: 'sin(x',
          curves: {c: {x: 't', y: 'q'}},
          colormap: 'rainbow',
          view: 'overhead',
        },
      ]),
    ).issues.filter(i => i.severity === 'error');
    expect(issues.map(i => i.prop)).toEqual([
      'surface',
      'curves.c.y',
      'colormap',
      'view',
    ]);
    expect(issues[1].message).toContain('unknown name "q"');
  });
});
