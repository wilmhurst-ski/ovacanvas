import {describe, expect, it} from 'vitest';
import {renderToPath2D, renderToSvgPathString} from '../d3-adapter/pathSink';
import {createProjector} from '../d3-adapter/projectionFactory';
import type {GeoProjectionSpec} from '../public/types';
import {
  ANTARCTICA_POLAR_LAND,
  COMPOUND_POLYGON_WITH_HOLE,
} from './fixtures/world110m';

describe('D3 Cartographic Kernel Projection & Clipping', () => {
  describe('Equirectangular Projection', () => {
    const spec: GeoProjectionSpec = {
      kind: 'equirectangular',
      scale: 360 / (2 * Math.PI), // 1 degree = 1 pixel
      translate: [180, 90],
    };
    const projector = createProjector(spec);

    it('projects known hand-checkable geographic anchors exactly', () => {
      // Origin [0, 0] -> [180, 90]
      const origin = projector.project([0, 0]);
      expect(origin).not.toBeNull();
      expect(origin![0]).toBeCloseTo(180, 5);
      expect(origin![1]).toBeCloseTo(90, 5);

      // Northwest [-180, 90] -> [0, 0]
      const nw = projector.project([-180, 90]);
      expect(nw).not.toBeNull();
      expect(nw![0]).toBeCloseTo(0, 5);
      expect(nw![1]).toBeCloseTo(0, 5);

      // Southeast [180, -90] -> [360, 180]
      const se = projector.project([180, -90]);
      expect(se).not.toBeNull();
      expect(se![0]).toBeCloseTo(360, 5);
      expect(se![1]).toBeCloseTo(180, 5);
    });

    it('inverts screen coordinates back to geographic coordinates', () => {
      const lonLat: [number, number] = [-74.006, 40.7128];
      const screen = projector.project(lonLat)!;
      const roundTrip = projector.invert(screen)!;

      expect(roundTrip[0]).toBeCloseTo(lonLat[0], 5);
      expect(roundTrip[1]).toBeCloseTo(lonLat[1], 5);
    });
  });

  describe('Mercator Projection', () => {
    const spec: GeoProjectionSpec = {
      kind: 'mercator',
      scale: 100,
      translate: [200, 200],
    };
    const projector = createProjector(spec);

    it('pins the equator to exact center Y', () => {
      const p = projector.project([0, 0]);
      expect(p).not.toBeNull();
      expect(p![0]).toBeCloseTo(200, 5);
      expect(p![1]).toBeCloseTo(200, 5);
    });

    it('preserves conformal inversion round trip across the globe', () => {
      const testPoints: [number, number][] = [
        [0, 0],
        [-73.7781, 40.6413], // JFK
        [-0.4543, 51.47], // LHR
        [139.6917, 35.6895], // Tokyo
        [-43.1729, -22.9068], // Rio de Janeiro
      ];

      for (const pt of testPoints) {
        const screen = projector.project(pt)!;
        expect(Number.isFinite(screen[0])).toBe(true);
        expect(Number.isFinite(screen[1])).toBe(true);

        const inverted = projector.invert(screen)!;
        expect(inverted[0]).toBeCloseTo(pt[0], 5);
        expect(inverted[1]).toBeCloseTo(pt[1], 5);
      }
    });
  });

  describe('Orthographic Projection (Globe)', () => {
    it('centers on declared spherical center and clips the back hemisphere', () => {
      // Globe centered on London [0, 51.5]
      const spec: GeoProjectionSpec = {
        kind: 'orthographic',
        center: [0, 0],
        rotate: [0, -51.5, 0], // Rotate to center on 51.5 N
        scale: 200,
        translate: [300, 300],
      };
      const projector = createProjector(spec);

      // Point at center should project to translate point [300, 300]
      const centerPt = projector.project([0, 51.5]);
      expect(centerPt).not.toBeNull();
      expect(centerPt![0]).toBeCloseTo(300, 4);
      expect(centerPt![1]).toBeCloseTo(300, 4);

      // Point on the exact antipodal back hemisphere should be clipped (null)
      const backPt = projector.project([180, -51.5]);
      expect(backPt).toBeNull();
    });

    it('renders the projected sphere outline without back-hemisphere leakage', () => {
      const spec: GeoProjectionSpec = {
        kind: 'orthographic',
        scale: 150,
        translate: [200, 200],
      };
      const projector = createProjector(spec);
      const svg = renderToSvgPathString(projector, {type: 'Sphere'});

      expect(svg).toBeTruthy();
      // An orthographic sphere outline is a closed path with diameter = 2 * scale (300px)
      expect(svg).toContain('M');
      expect(svg).toContain('Z');
      const bounds = projector.createPath(null).bounds({type: 'Sphere'});
      expect(bounds[1][0] - bounds[0][0]).toBeCloseTo(300, 1);
      expect(bounds[1][1] - bounds[0][1]).toBeCloseTo(300, 1);
    });
  });

  describe('Spherical Clipping & Polar Rings', () => {
    it('successfully projects polar-enclosing rings without rejection', () => {
      // In the legacy custom projector, Antarctica was rejected as POLAR_RING_UNSUPPORTED.
      // D3 spherical pre-clipping naturally handles polar polygons.
      const spec: GeoProjectionSpec = {
        kind: 'orthographic',
        rotate: [0, 90, 0], // Centered directly on South Pole
        scale: 150,
        translate: [200, 200],
      };
      const projector = createProjector(spec);

      const path2d = renderToPath2D(projector, ANTARCTICA_POLAR_LAND.geometry);
      expect(path2d).toBeInstanceOf(Path2D);

      const svg = renderToSvgPathString(
        projector,
        ANTARCTICA_POLAR_LAND.geometry,
      );
      expect(svg).toBeTruthy();
      expect(svg).toContain('M');
      expect(svg).toContain('Z');
    });

    it('correctly handles compound polygons with holes', () => {
      const spec: GeoProjectionSpec = {
        kind: 'equirectangular',
        scale: 100,
        translate: [200, 200],
      };
      const projector = createProjector(spec);

      const svg = renderToSvgPathString(
        projector,
        COMPOUND_POLYGON_WITH_HOLE.geometry,
      );
      expect(svg).toBeTruthy();
      // Should have two distinct subpaths (M ... Z M ... Z)
      const moveCount = (svg.match(/M/g) || []).length;
      const closeCount = (svg.match(/Z/g) || []).length;
      expect(moveCount).toBe(2);
      expect(closeCount).toBe(2);
    });

    it('correctly cuts antimeridian-crossing features', () => {
      // Feature crossing the 180 antimeridian
      const crossingFeature: any = {
        type: 'LineString',
        coordinates: [
          [170, 10],
          [-170, 10],
        ],
      };

      const spec: GeoProjectionSpec = {
        kind: 'equirectangular',
        scale: 360 / (2 * Math.PI),
        translate: [180, 90],
      };
      const projector = createProjector(spec);
      const svg = renderToSvgPathString(projector, crossingFeature);

      // A line crossing the antimeridian split into two separate projected segments:
      // one ending at the right edge (+180), another starting at the left edge (-180)
      const moveCount = (svg.match(/M/g) || []).length;
      expect(moveCount).toBe(2);
    });
  });

  describe('Adaptive Resampling', () => {
    it('changes vertex resolution when precision threshold is modified', () => {
      const lineFeature: any = {
        type: 'LineString',
        coordinates: [
          [-73.7781, 40.6413],
          [-0.4543, 51.47],
        ],
      };

      const highPrecisionSpec: GeoProjectionSpec = {
        kind: 'orthographic',
        rotate: [37, -46, 0],
        scale: 200,
        translate: [250, 250],
        precision: 0.1, // Fine resampling
      };

      const lowPrecisionSpec: GeoProjectionSpec = {
        ...highPrecisionSpec,
        precision: 10.0, // Coarse resampling
      };

      const svgHigh = renderToSvgPathString(
        createProjector(highPrecisionSpec),
        lineFeature,
      );
      const svgLow = renderToSvgPathString(
        createProjector(lowPrecisionSpec),
        lineFeature,
      );

      // Higher precision produces more intermediate lineTo commands
      const lineToCountHigh = (svgHigh.match(/L/g) || []).length;
      const lineToCountLow = (svgLow.match(/L/g) || []).length;

      expect(lineToCountHigh).toBeGreaterThan(lineToCountLow);
    });
  });
});
