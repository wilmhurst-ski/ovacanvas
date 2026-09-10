import type {GeoFeature, GeoPart, GeoPoint} from '../types';

/**
 * Convert a GeoPoint `{longitude, latitude}` to a GeoJSON [lon, lat] coordinate pair.
 */
export function geoPointToCoordinates(point: GeoPoint): [number, number] {
  return [point.longitude, point.latitude];
}

/**
 * Convert legacy GeoFeature to standard GeoJSON Feature for consumption by d3-geo.
 */
export function geoFeatureToGeoJson(feature: GeoFeature): any {
  if (!feature.parts || feature.parts.length === 0) {
    return {
      type: 'Feature',
      id: feature.id,
      properties: {id: feature.id},
      geometry: {
        type: 'GeometryCollection',
        geometries: [],
      },
    };
  }

  const closedParts = feature.parts.filter(p => p.closed);
  const openParts = feature.parts.filter(p => !p.closed);

  if (closedParts.length > 0 && openParts.length === 0) {
    if (closedParts.length === 1) {
      // Single Polygon
      const coordinates = convertPolygonRings(closedParts[0]);
      return {
        type: 'Feature',
        id: feature.id,
        properties: {id: feature.id},
        geometry: {
          type: 'Polygon',
          coordinates,
        },
      };
    } else {
      // MultiPolygon
      const coordinates = closedParts.map(convertPolygonRings);
      return {
        type: 'Feature',
        id: feature.id,
        properties: {id: feature.id},
        geometry: {
          type: 'MultiPolygon',
          coordinates,
        },
      };
    }
  }

  if (openParts.length > 0 && closedParts.length === 0) {
    if (openParts.length === 1) {
      // Single LineString
      const coordinates =
        openParts[0].rings[0]?.points.map(geoPointToCoordinates) ?? [];
      return {
        type: 'Feature',
        id: feature.id,
        properties: {id: feature.id},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      };
    } else {
      // MultiLineString
      const coordinates = openParts.map(
        p => p.rings[0]?.points.map(geoPointToCoordinates) ?? [],
      );
      return {
        type: 'Feature',
        id: feature.id,
        properties: {id: feature.id},
        geometry: {
          type: 'MultiLineString',
          coordinates,
        },
      };
    }
  }

  // Mixed geometries
  const geometries = feature.parts.map(part => {
    if (part.closed) {
      return {
        type: 'Polygon',
        coordinates: convertPolygonRings(part),
      };
    } else {
      return {
        type: 'LineString',
        coordinates: part.rings[0]?.points.map(geoPointToCoordinates) ?? [],
      };
    }
  });

  return {
    type: 'Feature',
    id: feature.id,
    properties: {id: feature.id},
    geometry: {
      type: 'GeometryCollection',
      geometries,
    },
  };
}

function convertPolygonRings(part: GeoPart): [number, number][][] {
  return part.rings.map(ring => {
    const coords = ring.points.map(geoPointToCoordinates);
    // Ensure ring is closed in GeoJSON
    if (coords.length > 0) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
    }
    return coords;
  });
}
