import {
  geoEqualEarth,
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  geoOrthographic,
  geoPath,
  geoStream,
  type GeoContext,
  type GeoPathGenerator,
  type GeoProjection,
} from 'd3-geo';
import type {
  GeoFeatureSource,
  GeoProjectionKind,
  GeoProjectionSpec,
} from '../public/types';

/**
 * Interface wrapping private D3 projection operations without leaking D3 instances.
 */
export interface PrivateProjector {
  readonly kind: GeoProjectionKind;
  project(
    point: readonly [longitude: number, latitude: number],
  ): readonly [x: number, y: number] | null;
  invert(
    point: readonly [x: number, y: number],
  ): readonly [longitude: number, latitude: number] | null;
  createPath(context?: GeoContext | null): GeoPathGenerator;
  readonly raw: GeoProjection;
}

/**
 * Instantiate a fresh, private D3 projection configured strictly from an immutable GeoProjectionSpec.
 */
export function createProjector(spec: GeoProjectionSpec): PrivateProjector {
  let projection: GeoProjection;

  switch (spec.kind) {
    case 'equirectangular':
      projection = geoEquirectangular();
      break;
    case 'mercator':
      projection = geoMercator();
      break;
    case 'orthographic':
      projection = geoOrthographic();
      // Default to 90 degree hemisphere clip for orthographic unless overridden
      if (spec.clipAngle === undefined) {
        projection.clipAngle(90);
      }
      break;
    case 'equalEarth':
      projection = geoEqualEarth();
      break;
    case 'naturalEarth1':
      projection = geoNaturalEarth1();
      break;
    default:
      throw new Error(`Unsupported projection kind: ${(spec as any).kind}`);
  }

  // 1. Center
  if (spec.center) {
    projection.center([spec.center[0], spec.center[1]]);
  }

  // 2. Three-axis spherical rotation [lambda, phi, gamma]
  if (spec.rotate) {
    const rot = spec.rotate;
    if (rot.length >= 3 && rot[2] !== undefined) {
      projection.rotate([rot[0], rot[1], rot[2]]);
    } else {
      projection.rotate([rot[0], rot[1], 0]);
    }
  }

  // 3. Planar rotation angle
  if (spec.angle !== undefined) {
    projection.angle(spec.angle);
  }

  // 4. Clip angle
  if (spec.clipAngle !== undefined) {
    projection.clipAngle(spec.clipAngle);
  }

  // 5. Precision (adaptive resampling)
  if (spec.precision !== undefined) {
    projection.precision(spec.precision);
  }

  // 6. Reflection
  if (spec.reflectX !== undefined) {
    projection.reflectX(spec.reflectX);
  }
  if (spec.reflectY !== undefined) {
    projection.reflectY(spec.reflectY);
  }

  // 7. Scale & translate or Fit
  if (spec.fit) {
    const targets = Array.isArray(spec.fit.target)
      ? {
          type: 'FeatureCollection',
          features: spec.fit.target.map(t =>
            t.geometry.type === 'Feature'
              ? t.geometry
              : {type: 'Feature', properties: {}, geometry: t.geometry},
          ),
        }
      : (spec.fit.target as GeoFeatureSource).geometry;

    projection.fitExtent(
      [
        [spec.fit.extent[0][0], spec.fit.extent[0][1]],
        [spec.fit.extent[1][0], spec.fit.extent[1][1]],
      ],
      targets,
    );
  } else {
    if (spec.scale !== undefined) {
      projection.scale(spec.scale);
    }
    if (spec.translate) {
      projection.translate([spec.translate[0], spec.translate[1]]);
    }
  }

  // 8. Planar clip extent
  if (spec.clipExtent !== undefined) {
    if (spec.clipExtent === null) {
      projection.clipExtent(null);
    } else {
      projection.clipExtent([
        [spec.clipExtent[0][0], spec.clipExtent[0][1]],
        [spec.clipExtent[1][0], spec.clipExtent[1][1]],
      ]);
    }
  }

  return {
    kind: spec.kind,
    project(point) {
      if (projection.clipAngle() !== null) {
        let streamed: [number, number] | null = null;
        geoStream(
          {type: 'Point', coordinates: [point[0], point[1]]},
          projection.stream({
            point(x, y) {
              streamed = [x, y];
            },
            lineStart() {},
            lineEnd() {},
            polygonStart() {},
            polygonEnd() {},
          }),
        );
        return streamed;
      }
      const res = projection([point[0], point[1]]);
      if (!res || !Number.isFinite(res[0]) || !Number.isFinite(res[1])) {
        return null;
      }
      return [res[0], res[1]];
    },
    invert(point) {
      if (!projection.invert) return null;
      const res = projection.invert([point[0], point[1]]);
      if (!res || !Number.isFinite(res[0]) || !Number.isFinite(res[1])) {
        return null;
      }
      return [res[0], res[1]];
    },
    createPath(context) {
      return geoPath(projection, context ?? null);
    },
    raw: projection,
  };
}
