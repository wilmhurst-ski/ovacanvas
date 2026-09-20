import {feature} from 'topojson-client';
import type {Topology} from 'topojson-specification';
// @ts-expect-error - JSON import; no bundled .d.ts, shape confirmed by the
// `objects.land` access below and covered by `worldData.test.ts`.
import landTopology from 'world-atlas/land-110m.json';
import type {GeoFeatureSource} from './types';

/**
 * Real land geometry (continents and islands, ~110m resolution) from the
 * public, MIT-licensed `world-atlas` dataset (itself derived from Natural
 * Earth, public domain) - not a hand-drawn approximation.
 *
 * @remarks
 * `packages/2d/src/lib/geography`'s own module doc says the kernel implies
 * no dataset, and that stays true: nothing here requires this constant.
 * It exists because a `GeoSphere` + `GeoGraticule` alone is a globe with a
 * lat/lon grid on it, not a map - there is no coastline anywhere else in
 * this engine, real or fake, to put on it. Add a `GeoPath` with
 * `feature: WORLD_LAND` inside a `GeoMap` to draw actual landmasses.
 */
export const WORLD_LAND: GeoFeatureSource = {
  id: 'world-land-110m',
  geometry: feature(
    landTopology as unknown as Topology,
    (landTopology as unknown as Topology).objects.land,
  ),
};
