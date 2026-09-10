import type {GeoFeatureSource, GeoProjectionSpec} from './types';

/**
 * Generate a deterministic string fingerprint for a GeoProjectionSpec.
 */
export function fingerprintProjection(spec: GeoProjectionSpec): string {
  const parts: string[] = [
    spec.kind,
    spec.center ? `c:${spec.center[0]},${spec.center[1]}` : '',
    spec.rotate
      ? `r:${spec.rotate[0]},${spec.rotate[1]},${spec.rotate[2] ?? 0}`
      : '',
    spec.angle ? `a:${spec.angle}` : '',
    spec.scale !== undefined ? `s:${spec.scale}` : '',
    spec.translate ? `t:${spec.translate[0]},${spec.translate[1]}` : '',
    spec.clipAngle !== undefined ? `ca:${spec.clipAngle}` : '',
    spec.clipExtent
      ? `ce:${spec.clipExtent[0][0]},${spec.clipExtent[0][1]},${spec.clipExtent[1][0]},${spec.clipExtent[1][1]}`
      : '',
    spec.precision !== undefined ? `p:${spec.precision}` : '',
    spec.reflectX ? 'rx:1' : '',
    spec.reflectY ? 'ry:1' : '',
  ];

  if (spec.fit) {
    const ext = spec.fit.extent;
    const targetIds = Array.isArray(spec.fit.target)
      ? spec.fit.target
          .map(t => t.id)
          .sort()
          .join(',')
      : (spec.fit.target as GeoFeatureSource).id;
    parts.push(
      `fit:${targetIds}:${ext[0][0]},${ext[0][1]},${ext[1][0]},${ext[1][1]}`,
    );
  }

  return parts.filter(Boolean).join('|');
}

/**
 * Generate a fingerprint for a GeoFeatureSource.
 */
export function fingerprintFeature(source: GeoFeatureSource): string {
  return source.id;
}
