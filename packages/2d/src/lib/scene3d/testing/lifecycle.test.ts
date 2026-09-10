import {describe, expect, it} from 'vitest';
import {Scene3DError} from '../public/errors';
import {Scene3DContextOwner} from '../render/Scene3DContextOwner';
import {Scene3DRenderer} from '../render/Scene3DRenderer';
import {Group3D} from '../scene/Group3D';
import {Mesh3D} from '../scene/Mesh3D';
import {SceneWorld3D} from '../scene/SceneWorld3D';
import {MockWebGL2RenderingContext, createCrossingTriangles} from './fixtures';

describe('scene3d / lifecycle', () => {
  it('updates world transforms down the hierarchy', () => {
    const root = new Group3D('groupA');
    root.translation = [10, 0, 0];

    const child = new Group3D('groupB');
    child.translation = [0, 5, 0];
    root.add(child);

    const {triangleA} = createCrossingTriangles();
    const mesh = new Mesh3D('mesh', triangleA);
    mesh.translation = [0, 0, 2];
    child.add(mesh);

    const worldMatrix = mesh.getWorldMatrix();
    const pos = worldMatrix.transformPoint([0, 0, 0]);

    expect(pos.x).toBe(10);
    expect(pos.y).toBe(5);
    expect(pos.z).toBe(2);

    // Modifying parent marks child world matrix dirty
    root.translation = [20, 0, 0];
    const newPos = mesh.getWorldMatrix().transformPoint([0, 0, 0]);
    expect(newPos.x).toBe(20);
    expect(newPos.y).toBe(5);
    expect(newPos.z).toBe(2);
  });

  it('rejects duplicate object IDs in SceneWorld3D', () => {
    const world = new SceneWorld3D();
    const {triangleA, triangleB} = createCrossingTriangles();

    const mesh1 = new Mesh3D('duplicate_id', triangleA);
    const mesh2 = new Mesh3D('duplicate_id', triangleB);

    world.add(mesh1);
    expect(() => world.add(mesh2)).toThrow(Scene3DError);
  });

  it('reuses GPU buffers when geometry fingerprints are unchanged', () => {
    const canvas = document.createElement('canvas');
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner = new Scene3DContextOwner();
    owner.setup(gl as any);

    const {triangleA} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('mesh', triangleA));

    const renderer = new Scene3DRenderer();
    const cam = {
      kind: 'perspective' as const,
      eye: [0, 0, 5] as const,
      target: [0, 0, 0] as const,
      verticalFovRadians: Math.PI / 4,
      near: 0.1,
      far: 10,
    };

    // Frame 1: allocates buffers
    const obs1 = renderer.render(owner, world, cam, {width: 100, height: 100});
    expect(obs1.allocatedBuffers).toBe(1);
    expect(obs1.reusedBuffers).toBe(0);

    // Frame 2: identical fingerprint reuses buffers
    const obs2 = renderer.render(owner, world, cam, {width: 100, height: 100});
    expect(obs2.allocatedBuffers).toBe(1);
    expect(obs2.reusedBuffers).toBe(1);
  });

  it('terminally disposes resources and returns to baseline', () => {
    const canvas = document.createElement('canvas');
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner = new Scene3DContextOwner();
    owner.setup(gl as any);

    const {triangleA, triangleB} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('meshA', triangleA));
    world.add(new Mesh3D('meshB', triangleB));

    const renderer = new Scene3DRenderer();
    const cam = {
      kind: 'perspective' as const,
      eye: [0, 0, 5] as const,
      target: [0, 0, 0] as const,
      verticalFovRadians: Math.PI / 4,
      near: 0.1,
      far: 10,
    };

    renderer.render(owner, world, cam, {width: 100, height: 100});
    expect(owner.geometries.activeVAOCount).toBe(2);

    // Dispose owner
    owner.dispose();
    expect(owner.geometries.activeVAOCount).toBe(0);
    expect(owner.geometries.activeBufferCount).toBe(0);

    // Dispose world
    world.dispose();
    expect(world.isDisposed()).toBe(true);
    expect(
      world.raycast({
        origin: {x: 0, y: 0, z: 5},
        direction: {x: 0, y: 0, z: -1},
      }),
    ).toBeNull();
  });
});
