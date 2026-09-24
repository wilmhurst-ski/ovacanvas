import {feature, merge, mesh} from 'topojson-client';
import type {GeometryCollection, Topology} from 'topojson-specification';
// @ts-expect-error - JSON import; no bundled .d.ts, shape confirmed by the
// `objects.countries` access below and covered by `countries.test.ts`.
import countriesTopology from 'world-atlas/countries-50m.json';
// @ts-expect-error - JSON import; same shape as the 50m file.
import countriesTopology110 from 'world-atlas/countries-110m.json';
import type {GeoFeatureSource} from './types';

const TOPOLOGY = countriesTopology as unknown as Topology;
const COUNTRIES = TOPOLOGY.objects.countries as GeometryCollection;

function nameOf(geometry: {properties?: unknown}): string {
  return (geometry.properties as {name: string}).name;
}

/** Every country's name and ISO 3166-1 numeric id, as the data spells them. */
export const COUNTRY_NAMES: readonly {
  readonly name: string;
  readonly id?: string;
}[] = COUNTRIES.geometries.map(g => ({
  name: nameOf(g),
  ...(g.id !== undefined ? {id: String(g.id)} : {}),
}));

function findGeometries(names: readonly string[]) {
  return names.map(name => {
    const wanted = name.trim().toLowerCase();
    const found = COUNTRIES.geometries.find(
      g =>
        nameOf(g).toLowerCase() === wanted ||
        (g.id !== undefined && String(g.id) === name.trim()),
    );
    if (!found) {
      throw new Error(
        `unknown country "${name}" - use a name from COUNTRY_NAMES or an ISO numeric id`,
      );
    }
    return found;
  });
}

/** One country's outline, by its data name or ISO numeric id. */
export function countryFeature(name: string): GeoFeatureSource {
  const [geometry] = findGeometries([name]);
  return {
    id: `country-${nameOf(geometry)}`,
    geometry: feature(TOPOLOGY, geometry),
  };
}

/**
 * Several countries merged into one outline - a region such as "West
 * Africa" drawn as a single shape, with no borders inside it.
 */
export function countriesFeature(
  names: readonly string[],
  id = `region-${names.join('-')}`,
): GeoFeatureSource {
  const geometries = findGeometries(names);
  return {id, geometry: merge(TOPOLOGY, geometries as never)};
}

/**
 * Each of several countries as its own feature, in one collection - for
 * drawing them together (a continent's countries) or fitting a view to them.
 */
export function countryGroupFeature(
  names: readonly string[],
  id = `group-${names.join('-')}`,
): GeoFeatureSource {
  const geometries = findGeometries(names);
  return {
    id,
    geometry: {
      type: 'FeatureCollection',
      features: geometries.map(g => feature(TOPOLOGY, g)),
    },
  };
}

/**
 * The borders between countries (not coastlines), optionally only those
 * between countries in `names`.
 */
export function countryBordersFeature(
  names?: readonly string[],
): GeoFeatureSource {
  const within = names ? new Set(findGeometries(names)) : null;
  return {
    id: names ? `borders-${names.join('-')}` : 'borders-world',
    geometry: mesh(
      TOPOLOGY,
      COUNTRIES,
      (a, b) =>
        a !== b &&
        (!within || (within.has(a as never) && within.has(b as never))),
    ),
  };
}

/** Every country, each as its own feature. */
export const WORLD_COUNTRIES: GeoFeatureSource = {
  id: 'world-countries-50m',
  geometry: feature(TOPOLOGY, COUNTRIES),
};

const TOPOLOGY_110 = countriesTopology110 as unknown as Topology;
const COUNTRIES_110 = TOPOLOGY_110.objects.countries as GeometryCollection;

/**
 * Every country at 1:110m - a fifth of the detail, for a world, continent
 * or globe view where 1:50m coastlines are finer than a pixel and only cost
 * drawing time on every frame.
 */
export const WORLD_COUNTRIES_110M: GeoFeatureSource = {
  id: 'world-countries-110m',
  geometry: feature(TOPOLOGY_110, COUNTRIES_110),
};

/** The borders between countries at 1:110m, for the same views. */
export const WORLD_BORDERS_110M: GeoFeatureSource = {
  id: 'world-borders-110m',
  geometry: mesh(TOPOLOGY_110, COUNTRIES_110, (a, b) => a !== b),
};
