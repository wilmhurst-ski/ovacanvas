import type {Camera3DSpec, PickResult3D} from '../public/types';
import type {SceneWorld3D} from '../scene/SceneWorld3D';
import {createRayFromViewport} from './unproject';

export function pickClosest3D(
  localCoord: {x: number; y: number},
  world: SceneWorld3D,
  cameraSpec: Camera3DSpec,
  viewport: {width: number; height: number},
): PickResult3D | null {
  const ray = createRayFromViewport(localCoord, cameraSpec, viewport);
  const hit = world.raycast(ray);
  if (!hit) return null;

  return {
    objectId: hit.objectId,
    primitiveKind: hit.primitiveKind,
    primitiveIndex: hit.primitiveIndex,
    worldPosition: {
      x: hit.worldPosition.x,
      y: hit.worldPosition.y,
      z: hit.worldPosition.z,
    },
    localPosition: {
      x: hit.localPosition.x,
      y: hit.localPosition.y,
      z: hit.localPosition.z,
    },
    distance: hit.distance,
    barycentric: hit.barycentric,
  };
}
