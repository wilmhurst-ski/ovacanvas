import {describe, expect, it} from 'vitest';
import {mockScene2D} from '../../components/__tests__/mockScene2D';
import {placeMapLabels} from '../labels/mapLabelPlacement';
import {
  GeoGraticule,
  GeoMap,
  GeoMarker,
  GeoPath,
  GeoRoute,
  GeoSphere,
} from '../nodes';
import type {GeoProjectionSpec, GeoRouteSpec} from '../public/types';
import {
  BRITISH_ISLES_LAND,
  EURASIA_LAND,
  JFK_COORDINATES,
  LHR_COORDINATES,
  NORTH_AMERICA_LAND,
} from './fixtures/world110m';

describe('Atlantic Recreation Witness', () => {
  mockScene2D();

  const geodesicRouteSpec: GeoRouteSpec = {
    id: 'transatlantic-geodesic',
    kind: 'geodesic',
    waypoints: [JFK_COORDINATES, LHR_COORDINATES],
    samples: 33,
  };

  const rhumbRouteSpec: GeoRouteSpec = {
    id: 'transatlantic-rhumb',
    kind: 'rhumb',
    waypoints: [JFK_COORDINATES, LHR_COORDINATES],
    samples: 33,
  };

  describe('Mercator Regional Plate', () => {
    it('composes a full transatlantic plate with coastlines, markers, and both routes', () => {
      const mercatorSpec: GeoProjectionSpec = {
        kind: 'mercator',
        center: [-37, 46], // Transatlantic midpoint
        scale: 450,
        translate: [960, 540],
      };

      const map = new GeoMap({
        projection: mercatorSpec,
        width: 1920,
        height: 1080,
      });

      const sphere = new GeoSphere({fill: '#1a2234'});
      const graticule = new GeoGraticule({stroke: '#2c374d', lineWidth: 1});

      const landNA = new GeoPath({
        feature: NORTH_AMERICA_LAND,
        fill: '#374151',
      });
      const landEU = new GeoPath({feature: EURASIA_LAND, fill: '#374151'});
      const landUK = new GeoPath({
        feature: BRITISH_ISLES_LAND,
        fill: '#374151',
      });

      const geodesicRoute = new GeoRoute({
        route: geodesicRouteSpec,
        stroke: '#38bdf8', // Blue curve
        lineWidth: 3,
      });

      const rhumbRoute = new GeoRoute({
        route: rhumbRouteSpec,
        stroke: '#f59e0b', // Orange line
        lineWidth: 3,
        lineDash: [6, 4],
      });

      const markerJFK = new GeoMarker({coordinates: JFK_COORDINATES});
      const markerLHR = new GeoMarker({coordinates: LHR_COORDINATES});

      map.add([
        sphere,
        graticule,
        landNA,
        landEU,
        landUK,
        geodesicRoute,
        rhumbRoute,
        markerJFK,
        markerLHR,
      ]);

      // Verify node hierarchy
      expect(map.children()).toHaveLength(9);

      // Verify markers project to screen
      const posJFK = markerJFK.projectedPosition();
      const posLHR = markerLHR.projectedPosition();
      expect(posJFK).not.toBeNull();
      expect(posLHR).not.toBeNull();
      // JFK is west of LHR
      expect(posJFK!.x).toBeLessThan(posLHR!.x);

      // Verify routes build valid profiles
      const profileGeodesic = geodesicRoute.profile();
      const profileRhumb = rhumbRoute.profile();
      expect(profileGeodesic.segments.length).toBeGreaterThan(0);
      expect(profileRhumb.segments.length).toBeGreaterThan(0);
      expect(profileGeodesic.arcLength).toBeGreaterThan(0);
      expect(profileRhumb.arcLength).toBeGreaterThan(0);

      // On a Mercator projection, a rhumb line is a straight line on the map!
      // Therefore, the projected screen length of the straight rhumb line is shorter
      // than the curved screen arc of the geodesic route on the Mercator plane.
      expect(profileRhumb.arcLength).toBeLessThan(profileGeodesic.arcLength);

      // But real spherical distance is shorter for the geodesic route!
      const measureGeodesic = geodesicRoute.measure()!;
      const measureRhumb = rhumbRoute.measure()!;
      expect(measureGeodesic.distanceMeters).toBeLessThan(
        measureRhumb.distanceMeters,
      );

      // Verify label placement for JFK and LHR
      const labelResult = placeMapLabels(
        [
          {
            id: 'jfk-label',
            anchor: [posJFK!.x, posJFK!.y],
            text: 'JFK (New York)',
            size: [100, 20],
            priority: 10,
          },
          {
            id: 'lhr-label',
            anchor: [posLHR!.x, posLHR!.y],
            text: 'LHR (London Heathrow)',
            size: [140, 20],
            priority: 10,
          },
        ],
        [1920, 1080],
      );

      expect(labelResult.placed).toHaveLength(2);
      expect(labelResult.unplaced).toHaveLength(0);
    });
  });

  describe('Rotated Orthographic Globe', () => {
    it('shows the identical route and marker identities on a 3D orthographic globe', () => {
      // Globe rotated to route midpoint (lambda = 37 W, phi = 46 N)
      const globeSpec: GeoProjectionSpec = {
        kind: 'orthographic',
        rotate: [37, -46, 0],
        scale: 300,
        translate: [960, 540],
      };

      const globeMap = new GeoMap({
        projection: globeSpec,
        width: 1920,
        height: 1080,
      });

      const globeSphere = new GeoSphere({
        fill: '#0f172a',
        stroke: '#38bdf8',
        lineWidth: 2,
      });

      const globeGraticule = new GeoGraticule({
        stroke: '#334155',
        lineWidth: 1,
      });

      const landNA = new GeoPath({
        feature: NORTH_AMERICA_LAND,
        fill: '#1e293b',
      });
      const landEU = new GeoPath({feature: EURASIA_LAND, fill: '#1e293b'});

      const geodesicRoute = new GeoRoute({
        route: geodesicRouteSpec,
        stroke: '#38bdf8',
        lineWidth: 4,
      });

      const rhumbRoute = new GeoRoute({
        route: rhumbRouteSpec,
        stroke: '#f59e0b',
        lineWidth: 3,
        lineDash: [4, 4],
      });

      const markerJFK = new GeoMarker({coordinates: JFK_COORDINATES});
      const markerLHR = new GeoMarker({coordinates: LHR_COORDINATES});

      globeMap.add([
        globeSphere,
        globeGraticule,
        landNA,
        landEU,
        geodesicRoute,
        rhumbRoute,
        markerJFK,
        markerLHR,
      ]);

      // Both JFK and LHR are on the front hemisphere and must be visible
      expect(markerJFK.isVisibleOnPlate()).toBe(true);
      expect(markerLHR.isVisibleOnPlate()).toBe(true);

      const posJFK = markerJFK.projectedPosition()!;
      const posLHR = markerLHR.projectedPosition()!;

      // Verify distance from center is less than radius (300px)
      const distJFK = Math.hypot(posJFK.x - 960, posJFK.y - 540);
      const distLHR = Math.hypot(posLHR.x - 960, posLHR.y - 540);
      expect(distJFK).toBeLessThanOrEqual(300);
      expect(distLHR).toBeLessThanOrEqual(300);

      // Verify route curves render on globe
      const profile = geodesicRoute.profile();
      expect(profile.arcLength).toBeGreaterThan(0);

      // Test back-hemisphere antipodal point (Tokyo 139 E, -46 S) is culled
      const backMarker = new GeoMarker({
        coordinates: [139.69, -46.0],
      });
      globeMap.add(backMarker);
      expect(backMarker.isVisibleOnPlate()).toBe(false);
      expect(backMarker.absoluteOpacity()).toBe(0);
    });
  });
});
