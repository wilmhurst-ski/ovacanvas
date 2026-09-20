import type {BBox, Vector2} from '@ovacanvas/core';
import type {AuditFinding, AuditItem, RouteItem} from './types';
import {isItemVisible} from './types';
import {worldBBox} from './worldBBox';

/** Liang-Barsky segment-vs-AABB clip test. */
export function segmentHitsBox(a: Vector2, b: Vector2, box: BBox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let near = 0;
  let far = 1;

  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ] as const) {
    if (p === 0 && q < 0) return false;
    if (p === 0) continue;
    const t = q / p;
    if (p < 0) {
      if (t > far) return false;
      near = Math.max(near, t);
    } else {
      if (t < near) return false;
      far = Math.min(far, t);
    }
  }
  return true;
}

function mayCrossReason(
  route: RouteItem,
  obstacle: AuditItem,
): string | undefined {
  return route.mayCross?.get(obstacle.id) ?? route.mayCross?.get('*');
}

/**
 * Route-vs-obstacle collision. A long line's own bounding box is
 * conservative (it covers empty space around the route), so a plain
 * box-vs-box collision check would either miss real crossings or flag
 * harmless ones. This walks the route's actual segments instead — the check
 * lab 2's scene needed and never invoked, because `routes` was left empty on
 * every `runVisualAudit` call.
 */
export function collectRouteCollisions(
  routes: readonly RouteItem[],
  obstacles: readonly AuditItem[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const route of routes) {
    const matrix = route.route.localToWorld();
    const points = route.route
      .parsedPoints()
      .map(point => point.transformAsPoint(matrix));

    for (const obstacle of obstacles) {
      if (!isItemVisible(obstacle)) continue;
      if (mayCrossReason(route, obstacle) !== undefined) continue;

      const box = worldBBox(obstacle.node).expand(route.halo + obstacle.halo);
      for (let i = 0; i < points.length - 1; i++) {
        if (segmentHitsBox(points[i], points[i + 1], box)) {
          findings.push({
            ruleId: 'route',
            severity: 'blocking',
            entities: [route.id, obstacle.id],
            geometry: box,
            message: `Route collision: ${route.id} x ${obstacle.id} at segment ${i}`,
          });
          break;
        }
      }
    }
  }
  return findings;
}

export function assertRoutesClear(
  routes: readonly RouteItem[],
  obstacles: readonly AuditItem[],
): void {
  const [finding] = collectRouteCollisions(routes, obstacles);
  if (finding) throw new Error(finding.message);
}
