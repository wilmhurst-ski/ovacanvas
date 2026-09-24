import {describe, expect, it} from 'vitest';
// @ts-expect-error - a plain .mjs build script with no declarations
import {extractCatalogue} from '../../scripts/extract-catalogue.mjs';
import {GENERATED_CATALOGUE} from './generated.js';
import {
  describeComponent,
  getComponent,
  isA,
  suggest,
  suggestProp,
} from './index.js';

describe('the generated catalogue', () => {
  it('matches a fresh extraction from the installed engine declarations', () => {
    // The ManimWire compatibility-table rule: the checked-in vocabulary may not
    // drift from the engine. If this fails, run `npm run catalogue -w packages/wire`.
    const fresh = extractCatalogue();
    expect(JSON.parse(JSON.stringify(GENERATED_CATALOGUE))).toEqual(fresh);
  });

  it('covers the components beats are built from', () => {
    for (const name of [
      'Txt',
      'Latex',
      'AnchoredLabel',
      'Rect',
      'Circle',
      'Line',
      'Layout',
      'Node',
      'GeoMap',
      'Scene3D',
    ]) {
      expect(getComponent(name), name).toBeDefined();
    }
    // Not authorable content: the stage itself, abstract bases, network media.
    for (const name of ['View2D', 'Shape', 'Curve', 'Video', 'Img']) {
      expect(getComponent(name), name).toBeUndefined();
    }
  });

  it('reads real prop types, requirements and defaults', () => {
    const label = getComponent('AnchoredLabel')!;
    expect(label.props.anchor.type).toEqual({kind: 'node'});
    expect(label.props.anchor.required).toBe(true);
    expect(label.props.origin.type).toEqual({kind: 'origin'});
    expect(label.props.distance.default).toBe('24');
    expect(getComponent('Latex')!.props.tex.type).toEqual({kind: 'tex'});
    expect(getComponent('Line')!.props.points.type).toEqual({kind: 'points'});
    expect(getComponent('Wire')!.props.from.type).toEqual({kind: 'endpoint'});
    expect(getComponent('Rect')!.props.fill.type).toEqual({kind: 'color'});
    expect(getComponent('Line')!.role).toBe('route');
    expect(getComponent('Rect')!.role).toBe('item');
  });

  it('records the class hierarchy', () => {
    expect(isA(getComponent('AnchoredLabel')!, 'Txt')).toBe(true);
    expect(isA(getComponent('Rect')!, 'Layout')).toBe(true);
    expect(isA(getComponent('Node')!, 'Layout')).toBe(false);
  });

  it('keeps the default description small', () => {
    const txt = describeComponent(getComponent('Txt')!);
    expect(Object.keys(txt.props).length).toBeLessThan(25);
    expect(txt.advancedProps?.length).toBeGreaterThan(40);
    expect(
      Object.keys(describeComponent(getComponent('Txt')!, {all: true}).props)
        .length,
    ).toBeGreaterThan(60);
  });

  it('suggests the real name for a hallucinated one', () => {
    expect(
      suggest('Latx', Object.keys(GENERATED_CATALOGUE.components)),
    ).toContain('Latex');
    expect(suggestProp(getComponent('Line')!, 'color')[0]).toBe('fill');
    expect(suggestProp(getComponent('Rect')!, 'strokeWidth')[0]).toBe(
      'lineWidth',
    );
    expect(suggestProp(getComponent('Txt')!, 'fontsize')).toContain('fontSize');
  });
});
