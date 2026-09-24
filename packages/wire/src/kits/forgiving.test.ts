import {describe, expect, it} from 'vitest';
import type {SceneDocument} from '../document/model.js';
import {prepareDocument} from './expand.js';
import {mixedTextToTex} from './fields.js';

/**
 * Mistakes real models made in live runs, which the kits now absorb instead
 * of sending the document back.
 */
function expanded(input: unknown): {
  document: SceneDocument;
  warnings: string[];
} {
  const prepared = prepareDocument(input);
  expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
  return {
    document: prepared.document as SceneDocument,
    warnings: prepared.issues.map(i => i.message),
  };
}

describe('mistakes the kits absorb', () => {
  it('typesets maths written into words', () => {
    expect(mixedTextToTex('Plain words only')).toBeNull();
    expect(mixedTextToTex('The surface z = x^2 + y^2')).toBe(
      String.raw`\text{The surface}\ z = x^{2} + y^{2}`,
    );
    expect(mixedTextToTex('Energy E = mc^2, always')).toBe(
      String.raw`\text{Energy}\ E = mc^{2}\text{,}\ \text{always}`,
    );
  });

  it('sets a title or list point with maths in it as Latex', () => {
    const {document} = expanded({
      version: 1,
      nodes: [
        {id: 'heading', kit: 'title', text: 'The surface z = x^2 + y^2'},
        {
          id: 'facts',
          kit: 'list',
          items: ['Along y = 0 it is z = x^2', 'Words'],
        },
      ],
      timeline: [],
    });
    const heading = document.nodes.find(n => n.id === 'heading_h')!;
    expect(heading.component).toBe('Latex');
    const components = document.nodes
      .filter(n => n.id.startsWith('facts_') && !n.id.includes('_m'))
      .map(n => n.component);
    expect(components).toEqual(['Latex', 'Txt']);
  });

  it('fades in a 3D curve a beat asks to trace', () => {
    const {document, warnings} = expanded({
      version: 1,
      nodes: [
        {id: 'heading', kit: 'title', text: 'A bowl'},
        {
          id: 'plot',
          kit: 'graph3d',
          surface: 'x^2 + y^2',
          curves: {cut: {x: 't', y: '0', t: [-2, 2]}},
        },
      ],
      beats: [{trace: 'plot.cut'}],
    });
    const layer = document.nodes.find(n => n.id === 'plot_show0')!;
    expect(layer.props!.opacity).toBe(0);
    expect(warnings.join(' ')).toContain('fades in instead of being drawn');
  });

  it('lets a number sit close to its own point', () => {
    const {document} = expanded({
      version: 1,
      nodes: [
        {id: 'steps', kit: 'list', numbered: true, items: ['One', 'Two']},
      ],
      timeline: [],
    });
    expect(
      document.touches?.some(t => t.a === 'steps_m0' && t.b === 'steps_t0_0'),
    ).toBe(true);
  });
});
