/* eslint-disable @typescript-eslint/naming-convention -- region and marker names are written as people write them */
import {describe, expect, it} from 'vitest';
import {generateBeatSource} from '../codegen/generate.js';
import type {SceneDocument, SceneNode} from '../document/model.js';
import {validateDocument} from '../document/prepare.js';
import {prepareDocument} from './expand.js';
import {resolveCity, resolveCountry} from './geo/atlas.js';

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
function byId(document: SceneDocument, id: string): SceneNode {
  const node = document.nodes.find(n => n.id === id);
  expect(node, id).toBeDefined();
  return node!;
}

describe('place names', () => {
  it('reads the names people use', () => {
    expect(resolveCountry('USA')).toBe('United States of America');
    expect(resolveCountry('ivory coast')).toBe("Côte d'Ivoire");
    expect(resolveCountry('DRC')).toBe('Dem. Rep. Congo');
    expect(resolveCountry('Czech Republic')).toBe('Czechia');
    expect(resolveCountry('the Gambia')).toBe('Gambia');
    expect(resolveCountry('nigeria')).toBe('Nigeria');
    expect(resolveCountry('Wakanda')).toBeNull();
    expect(resolveCity('Lagos')).toEqual([3.38, 6.52]);
    expect(resolveCity('new york')).not.toBeNull();
  });
});

describe('engine values', () => {
  it('names boundary data instead of spelling it out, and checks the names', () => {
    const plain = (feature: unknown) =>
      doc([
        {
          id: 'shape',
          component: 'GeoPath',
          props: {feature, fill: '#88AAEE'},
        },
      ]);
    const ok = generateBeatSource(
      plain({$engine: 'countryFeature', args: ['Ivory Coast']}),
    );
    expect(ok.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(ok.source).toContain(`feature: countryFeature("Côte d'Ivoire")`);
    expect(ok.source).toMatch(
      /import \{[^}]*countryFeature[^}]*\} from '@ovacanvas\/2d'/,
    );

    const typo = validateDocument(
      plain({$engine: 'countryFeature', args: ['Nigera']}),
    );
    expect(typo[0]).toMatchObject({code: 'bad_value', prop: 'feature'});
    expect(typo[0].hint).toContain('Nigeria');

    const unknown = validateDocument(plain({$engine: 'countryFeatures'}));
    expect(unknown[0].message).toContain('unknown engine value');
    expect(unknown[0].hint).toContain('countryFeature');

    const world = generateBeatSource(plain({$engine: 'WORLD_COUNTRIES'}));
    expect(world.source).toContain('feature: WORLD_COUNTRIES,');
  });
});

describe('the map kit', () => {
  it('turns a few names into a framed, shaded, labelled map', () => {
    const document = expanded(
      doc([
        {
          id: 'map',
          kit: 'map',
          highlight: ['Nigeria', 'Ghana'],
          markers: ['Lagos', 'Accra'],
          routes: ['Lagos->Accra'],
        },
      ]),
    );
    const map = byId(document, 'map_map');
    expect(map.component).toBe('GeoMap');
    const projection = map.props!.projection as Record<string, unknown>;
    // The view is computed here, not fitted by the engine, so labels match.
    expect(projection.kind).toBe('mercator');
    expect(projection.fit).toBeUndefined();
    expect(typeof projection.scale).toBe('number');

    const shaded = document.nodes.filter(
      n =>
        n.component === 'GeoPath' &&
        JSON.stringify(n.props?.feature).includes('countryFeature'),
    );
    expect(shaded).toHaveLength(2);
    const texts = document.nodes
      .filter(n => n.component === 'Txt')
      .map(n => n.props!.text);
    expect(texts.sort()).toEqual(['Accra', 'Ghana', 'Lagos', 'Nigeria']);

    // Every label and dot lies inside the map's box.
    for (const n of document.nodes) {
      if (n.parent || !Array.isArray(n.props?.position)) continue;
      const [x, y] = n.props!.position as number[];
      if (n.id === 'map_map') continue;
      expect(Math.abs(x), n.id).toBeLessThan(820);
      expect(Math.abs(y - 75), n.id).toBeLessThan(360);
    }

    const route = document.nodes.find(n => n.component === 'Line');
    expect((route!.props!.points as unknown[]).length).toBeGreaterThan(10);
    const source = generateBeatSource(document);
    expect(source.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('frames a continent by its window, and turns a globe to face its focus', () => {
    const flat = expanded(doc([{id: 'map', kit: 'map', focus: 'Europe'}]));
    const spec = byId(flat, 'map_map').props!.projection as {rotate: number[]};
    expect(spec.rotate[0]).toBeLessThan(0);
    const globe = expanded(
      doc([{id: 'map', kit: 'map', view: 'globe', focus: 'Japan'}]),
    );
    const g = byId(globe, 'map_map').props!.projection as {
      kind: string;
      rotate: number[];
    };
    expect(g.kind).toBe('orthographic');
    expect(g.rotate[0]).toBeLessThan(-120);
    expect(globe.nodes.some(n => n.component === 'GeoGraticule')).toBe(true);
  });

  it('shades a continent or region as one outline', () => {
    const document = expanded(
      doc([
        {
          id: 'map',
          kit: 'map',
          focus: 'Africa',
          highlight: {Sahel: 'yellow'},
          regions: {'Coastal trio': ['Ghana', 'Togo', 'Benin']},
        },
      ]),
    );
    const merged = document.nodes.filter(n =>
      JSON.stringify(n.props?.feature ?? '').includes('countriesFeature'),
    );
    expect(merged).toHaveLength(2);
  });

  it('lets a beat show or highlight a country the kit never listed', () => {
    const document = expanded(
      doc(
        [{id: 'map', kit: 'map', focus: 'West Africa', highlight: ['Ghana']}],
        [
          {show: 'map.Nigeria'},
          {highlight: 'map.Ghana'},
          {hide: 'map.borders'},
        ],
      ),
    );
    const nigeria = document.nodes.find(n =>
      JSON.stringify(n.props?.feature ?? '').includes('"Nigeria"'),
    );
    expect(nigeria?.props?.opacity).toBe(0);
    const overlay = document.nodes.find(n => n.id.endsWith('Hi'));
    expect(overlay?.props?.opacity).toBe(0);
  });

  it('reports unknown places with a suggestion', () => {
    const issues = errors(
      doc([
        {
          id: 'map',
          kit: 'map',
          highlight: ['Nigera'],
          markers: ['Lagoss'],
          routes: ['Lagos->Atlantis'],
        },
      ]),
    );
    expect(issues.map(i => i.prop)).toEqual(['highlight', 'markers', 'routes']);
    expect(issues[0].hint).toContain('Nigeria');
    expect(issues[1].hint).toContain('lagos');
    expect(issues[2].hint).toContain('[longitude, latitude]');
  });

  it('refuses coordinates written latitude first', () => {
    const issues = errors(
      doc([{id: 'map', kit: 'map', markers: {Somewhere: [6.5, 200]}}]),
    );
    expect(issues[0].hint).toContain('longitude first');
  });
});
