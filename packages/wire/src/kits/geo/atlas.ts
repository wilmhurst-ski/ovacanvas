import {geoArea} from 'd3-geo';
// A default import, so this entry still links in a browser bundle (where
// only expanding a map needs Node).
import nodeModule from 'module';
import {feature, merge} from 'topojson-client';
import type {GeometryCollection, Topology} from 'topojson-specification';
import {suggest} from '../../catalogue/index.js';
import {CITIES, COUNTRY_ALIASES, PLACE_GROUPS} from './places.js';

/**
 * The same boundary data the engine draws (`world-atlas` countries-50m),
 * read here so the map kit can fit views and place labels exactly where
 * the engine will put the shapes.
 */
type Geometry = GeometryCollection['geometries'][number];

function nameOf(geometry: Geometry): string {
  return (geometry.properties as {name: string}).name;
}

interface Atlas {
  readonly topology: Topology;
  readonly byName: ReadonlyMap<string, Geometry>;
  readonly names: readonly string[];
}
let Loaded: Atlas | null = null;

/**
 * The boundary data, read on first use: most documents have no map, and
 * this is the largest thing wire loads. Read with `require` rather than a
 * JSON import so every bundler and test runner in the repo can load it.
 */
function load(): Atlas {
  if (!Loaded) {
    const topology = nodeModule.createRequire(import.meta.url)(
      'world-atlas/countries-50m.json',
    ) as Topology;
    const countries = topology.objects.countries as GeometryCollection;
    Loaded = {
      topology,
      byName: new Map(
        countries.geometries.map(g => [nameOf(g).toLowerCase(), g]),
      ),
      names: countries.geometries.map(nameOf),
    };
  }
  return Loaded;
}

/** Every country name exactly as the data (and the engine) spells it. */
export function countryNames(): readonly string[] {
  return load().names;
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A country as written by a person, to the data's spelling - or null. */
export function resolveCountry(name: string): string | null {
  const key = normalise(name);
  const direct = load().byName.get(key);
  if (direct) return nameOf(direct);
  const alias =
    COUNTRY_ALIASES[key] ?? COUNTRY_ALIASES[key.replace(/^the /, '')];
  return alias ?? null;
}

/** Close country names for a hint. */
export function suggestCountry(name: string): string[] {
  return suggest(name, [...countryNames(), ...Object.keys(COUNTRY_ALIASES)]);
}

/** A continent or region by name (`"West Africa"`), or null. */
export function resolveGroup(name: string) {
  return PLACE_GROUPS[normalise(name)] ?? null;
}

export const GROUP_NAMES = Object.keys(PLACE_GROUPS);

/** A city's [lon, lat], or null. */
export function resolveCity(name: string): readonly [number, number] | null {
  return CITIES[normalise(name)] ?? null;
}

export function suggestCity(name: string): string[] {
  return suggest(normalise(name), Object.keys(CITIES));
}

/** One country's GeoJSON feature. */
export function countryGeo(name: string): GeoJSON.Feature {
  const {topology, byName} = load();
  return feature(topology, byName.get(name.toLowerCase())!) as GeoJSON.Feature;
}

/** Several countries merged into one outline. */
export function mergedGeo(names: readonly string[]): GeoJSON.MultiPolygon {
  const {topology, byName} = load();
  return merge(topology, names.map(n => byName.get(n.toLowerCase())!) as never);
}

/**
 * The polygons of a country that matter for framing and labelling: the
 * largest, plus any at least a fifth of its size - mainland France without
 * French Guiana, the USA without Alaska's islands, Indonesia's big islands.
 */
export function mainPolygons(
  geometry: GeoJSON.Geometry,
): GeoJSON.Polygon['coordinates'][] {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const areas = polygons.map(p => geoArea({type: 'Polygon', coordinates: p}));
  const largest = Math.max(0, ...areas);
  return polygons.filter((_, i) => areas[i] >= largest * 0.2);
}

/** The largest polygon alone, where a label goes. */
export function largestPolygon(
  geometry: GeoJSON.Geometry,
): GeoJSON.Polygon['coordinates'] | null {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  let best: GeoJSON.Polygon['coordinates'] | null = null;
  let bestArea = -1;
  for (const p of polygons) {
    const area = geoArea({type: 'Polygon', coordinates: p});
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best;
}
