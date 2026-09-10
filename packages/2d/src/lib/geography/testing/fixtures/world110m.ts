import type {GeoFeatureSource} from '../../public/types';

/**
 * Simplified continental landmass polygons for offline deterministic testing.
 */
export const NORTH_AMERICA_LAND: GeoFeatureSource = {
  id: 'north-america',
  geometry: {
    type: 'Feature',
    properties: {name: 'North America'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-168, 65],
          [-140, 70],
          [-120, 75],
          [-80, 72],
          [-60, 50],
          [-70, 42],
          [-80, 25],
          [-97, 18],
          [-105, 20],
          [-117, 32],
          [-124, 48],
          [-165, 55],
          [-168, 65],
        ],
      ],
    },
  },
};

export const EURASIA_LAND: GeoFeatureSource = {
  id: 'eurasia',
  geometry: {
    type: 'Feature',
    properties: {name: 'Eurasia'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-10, 36],
          [-9, 43],
          [2, 51],
          [10, 54],
          [30, 70],
          [60, 73],
          [100, 76],
          [170, 66],
          [140, 35],
          [105, 20],
          [80, 10],
          [60, 25],
          [35, 30],
          [25, 36],
          [-6, 36],
          [-10, 36],
        ],
      ],
    },
  },
};

export const BRITISH_ISLES_LAND: GeoFeatureSource = {
  id: 'british-isles',
  geometry: {
    type: 'Feature',
    properties: {name: 'British Isles'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-5, 50],
          [1.5, 51],
          [0, 53],
          [-2, 58],
          [-5, 58],
          [-6, 54],
          [-5, 50],
        ],
      ],
    },
  },
};

/**
 * Polar polygon enclosing the South Pole (latitude -90), with multiple vertices along the boundary.
 */
export const ANTARCTICA_POLAR_LAND: GeoFeatureSource = {
  id: 'antarctica',
  geometry: {
    type: 'Feature',
    properties: {name: 'Antarctica'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-180, -65],
          [-120, -70],
          [-60, -65],
          [0, -70],
          [60, -65],
          [120, -70],
          [180, -65],
          [180, -90],
          [-180, -90],
          [-180, -65],
        ],
      ],
    },
  },
};

/**
 * Polygon with a hole for compound path testing.
 */
export const COMPOUND_POLYGON_WITH_HOLE: GeoFeatureSource = {
  id: 'polygon-with-hole',
  geometry: {
    type: 'Feature',
    properties: {name: 'Compound Lake'},
    geometry: {
      type: 'Polygon',
      coordinates: [
        // Exterior ring
        [
          [-20, -20],
          [-20, 20],
          [20, 20],
          [20, -20],
          [-20, -20],
        ],
        // Hole ring
        [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
          [-5, -5],
        ],
      ],
    },
  },
};

/**
 * Standard test airports for the Atlantic witness.
 */
export const JFK_COORDINATES: readonly [number, number] = [-73.7781, 40.6413];
export const LHR_COORDINATES: readonly [number, number] = [-0.4543, 51.47];
