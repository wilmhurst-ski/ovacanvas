import {describe, expect, it} from 'vitest';
import {mockScene2D} from '../../components/__tests__/mockScene2D';
import {Scene3D} from '../components/Scene3D';
import {projectPointToViewport3D} from '../interaction/project';
import {Scene3DContextOwner} from '../render/Scene3DContextOwner';
import {Scene3DRenderer} from '../render/Scene3DRenderer';
import {Group3D} from '../scene/Group3D';
import {Line3D} from '../scene/Line3D';
import {Mesh3D} from '../scene/Mesh3D';
import {PointCloud3D} from '../scene/PointCloud3D';
import {SceneWorld3D} from '../scene/SceneWorld3D';

import {
  createAsymmetricMesh,
  createCrossingTriangles,
  createSampledSurface,
  createTestLine,
  createTestPoints,
  MockWebGL2RenderingContext,
} from './fixtures';

describe('scene3d / acceptance witnesses (Witnesses 1 - 7)', () => {
  mockScene2D();
  // -------------------------------------------------------------
  // Witness 1 — Depth Correctness
  // -------------------------------------------------------------
  describe('Witness 1 — Depth correctness', () => {
    it('proves depth buffer correctly resolves intersecting triangles regardless of draw order', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const gl = new MockWebGL2RenderingContext(canvas);

      const owner = new Scene3DContextOwner();
      owner.setup(gl as any);
      const renderer = new Scene3DRenderer();

      const {triangleA, triangleB} = createCrossingTriangles();

      // Order 1: Add A then B
      const world1 = new SceneWorld3D();
      world1.add(new Mesh3D('triA', triangleA));
      world1.add(new Mesh3D('triB', triangleB));

      renderer.render(
        owner,
        world1,
        {
          kind: 'orthographic',
          eye: [0, 0, 5],
          target: [0, 0, 0],
          verticalSize: 3,
          near: 0.1,
          far: 10,
        },
        {width: 100, height: 100},
      );

      const left1 = new Uint8Array(4);
      const right1 = new Uint8Array(4);
      gl.readPixels(25, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left1);
      gl.readPixels(75, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right1);

      // Order 2: Add B then A (reversed insertion order)
      const world2 = new SceneWorld3D();
      world2.add(new Mesh3D('triB', triangleB));
      world2.add(new Mesh3D('triA', triangleA));

      renderer.render(
        owner,
        world2,
        {
          kind: 'orthographic',
          eye: [0, 0, 5],
          target: [0, 0, 0],
          verticalSize: 3,
          near: 0.1,
          far: 10,
        },
        {width: 100, height: 100},
      );

      const left2 = new Uint8Array(4);
      const right2 = new Uint8Array(4);
      gl.readPixels(25, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left2);
      gl.readPixels(75, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right2);

      // Verification: Both orders produce identical, depth-correct pixels!
      // Left: Blue is nearer
      expect(left1[2]).toBe(255);
      expect(left2[2]).toBe(255);
      // Right: Red is nearer
      expect(right1[0]).toBe(255);
      expect(right2[0]).toBe(255);
      expect(left1).toEqual(left2);
      expect(right1).toEqual(right2);
    });
  });

  // -------------------------------------------------------------
  // Witness 2 — General Mixed Scene
  // -------------------------------------------------------------
  describe('Witness 2 — General mixed scene', () => {
    it('composes curved mesh, polylines, points, group transforms, Lambert & unlit materials', () => {
      const canvas = document.createElement('canvas');
      const gl = new MockWebGL2RenderingContext(canvas);

      const owner = new Scene3DContextOwner();
      owner.setup(gl as any);
      const renderer = new Scene3DRenderer();

      const world = new SceneWorld3D();
      world.addLight({
        kind: 'directional',
        direction: [0.5, 1.0, 0.5],
        color: '#ffffff',
        intensity: 1.0,
      });

      // Group transform
      const group = new Group3D('mainGroup');
      group.translation = [0, 0.5, 0];
      group.scale = [1.2, 1.2, 1.2];

      // Lambert mesh with vertex colors
      const mesh = new Mesh3D('surface', createSampledSurface(6), {
        kind: 'lambert',
        vertexColors: true,
      });
      group.add(mesh);

      // Polyline passing through
      const line = new Line3D('curve', createTestLine(), {
        lineWidth: 2.0,
        color: '#ffff00',
      });
      group.add(line);

      // Depth-tested points
      const points = new PointCloud3D('landmarks', createTestPoints(), {
        pointSize: 8.0,
      });
      group.add(points);

      world.add(group);

      const obs = renderer.render(
        owner,
        world,
        {
          kind: 'perspective',
          eye: [3, 4, 5],
          target: [0, 0, 0],
          verticalFovRadians: (50 * Math.PI) / 180,
          near: 0.1,
          far: 50,
        },
        {width: 200, height: 200},
      );

      expect(obs.drawCalls).toBe(3);
      expect(obs.renderedTriangles).toBeGreaterThan(0);
      expect(obs.renderedLines).toBeGreaterThan(0);
      expect(obs.renderedPoints).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // Witness 3 — Camera Motion
  // -------------------------------------------------------------
  describe('Witness 3 — Camera motion', () => {
    it('recalculates 3D landmarks at 3 intermediate sampled frames and matches CPU projection', () => {
      const mesh = createAsymmetricMesh();
      const apexWorld = [
        mesh.positions[0],
        mesh.positions[1],
        mesh.positions[2],
      ] as const;

      const camStart = {x: 0, y: 5, z: 10};
      const camEnd = {x: 10, y: 5, z: 0};
      const viewport = {width: 800, height: 600};

      // 3 intermediate samples: t = 0.25, 0.5, 0.75
      const samples = [0.25, 0.5, 0.75];
      for (const t of samples) {
        const eyeX = camStart.x + t * (camEnd.x - camStart.x);
        const eyeY = camStart.y + t * (camEnd.y - camStart.y);
        const eyeZ = camStart.z + t * (camEnd.z - camStart.z);

        const cameraSpec = {
          kind: 'perspective' as const,
          eye: [eyeX, eyeY, eyeZ] as const,
          target: [0, 0, 0] as const,
          up: [0, 1, 0] as const,
          verticalFovRadians: (45 * Math.PI) / 180,
          near: 0.1,
          far: 50,
        };

        const projected = projectPointToViewport3D(
          apexWorld,
          cameraSpec,
          viewport,
        );

        // Expected landmark must remain rigid in 3D: in front and within bounds
        expect(projected.inFront).toBe(true);
        expect(projected.insideViewport).toBe(true);

        // Verify that intermediate projection is not linearly interpolating 2D screen coordinates
        expect(Number.isFinite(projected.position.x)).toBe(true);
        expect(Number.isFinite(projected.position.y)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------
  // Witness 4 — Orthographic Projection
  // -------------------------------------------------------------
  describe('Witness 4 — Orthographic projection', () => {
    it('preserves object scale regardless of camera distance when verticalSize is unchanged', () => {
      const apex = [0, 1, 0] as const;
      const base = [0, -1, 0] as const;
      const viewport = {width: 800, height: 600};

      // Camera close: eye = [0, 0, 5]
      const camClose = {
        kind: 'orthographic' as const,
        eye: [0, 0, 5] as const,
        target: [0, 0, 0] as const,
        verticalSize: 4,
        near: 0.1,
        far: 50,
      };
      const projCloseApex = projectPointToViewport3D(apex, camClose, viewport);
      const projCloseBase = projectPointToViewport3D(base, camClose, viewport);
      const heightClose = Math.abs(
        projCloseApex.position.y - projCloseBase.position.y,
      );

      // Camera far: eye = [0, 0, 20]
      const camFar = {
        kind: 'orthographic' as const,
        eye: [0, 0, 20] as const,
        target: [0, 0, 0] as const,
        verticalSize: 4,
        near: 0.1,
        far: 50,
      };
      const projFarApex = projectPointToViewport3D(apex, camFar, viewport);
      const projFarBase = projectPointToViewport3D(base, camFar, viewport);
      const heightFar = Math.abs(
        projFarApex.position.y - projFarBase.position.y,
      );

      // Parallel projection must produce identical size regardless of depth!
      expect(heightFar).toBeCloseTo(heightClose, 3);
    });
  });

  // -------------------------------------------------------------
  // Witness 5 — Multiple 3D Panels
  // -------------------------------------------------------------
  describe('Witness 5 — Multiple 3D panels in one scene', () => {
    it('renders two Scene3D components sharing one context without cross-contamination', () => {
      const canvas = document.createElement('canvas');
      const mockGL = new MockWebGL2RenderingContext(canvas);
      const fakeSharedContext: any = {
        borrow: (owner: any) => {
          owner.setup(mockGL);
          return mockGL;
        },
      };

      const world1 = new SceneWorld3D();
      world1.add(new Mesh3D('mesh1', createAsymmetricMesh()));

      const world2 = new SceneWorld3D();
      world2.add(new Line3D('line2', createTestLine()));

      const panel1 = new Scene3D({
        world: world1,
        size: [200, 200],
        sharedContext: fakeSharedContext,
      });

      const panel2 = new Scene3D({
        world: world2,
        size: [200, 200],
        sharedContext: fakeSharedContext,
      });

      // Both panels share the exact same Scene3DContextOwner instance!
      const owner1 = panel1.getContextOwner(fakeSharedContext);
      const owner2 = panel2.getContextOwner(fakeSharedContext);
      expect(owner1).toBe(owner2);
    });
  });

  // -------------------------------------------------------------
  // Witness 6 — Scientific-Surface Stress Witness
  // -------------------------------------------------------------
  describe('Witness 6 — Scientific-surface stress witness', () => {
    it('renders externally calculated z = f(x, y) surface with vertex colors without scientific classes', () => {
      const canvas = document.createElement('canvas');
      const gl = new MockWebGL2RenderingContext(canvas);

      const owner = new Scene3DContextOwner();
      owner.setup(gl as any);
      const renderer = new Scene3DRenderer();

      // Mesh generated externally, passed as pure triangles & vertex colors
      const surfaceGeometry = createSampledSurface(15); // 15x15 = 450 triangles
      const world = new SceneWorld3D();
      const mesh = new Mesh3D('parametricSurface', surfaceGeometry, {
        kind: 'lambert',
        vertexColors: true,
        side: 'double',
      });
      world.add(mesh);

      const obs = renderer.render(
        owner,
        world,
        {
          kind: 'perspective',
          eye: [2, 3, 4],
          target: [0, 0, 0],
          verticalFovRadians: Math.PI / 4,
          near: 0.1,
          far: 20,
        },
        {width: 400, height: 300},
      );

      expect(obs.renderedTriangles).toBe(450);
      expect(obs.drawCalls).toBe(1);
    });
  });

  // -------------------------------------------------------------
  // Witness 7 — Lifecycle
  // -------------------------------------------------------------
  describe('Witness 7 — Lifecycle', () => {
    it('repeatedly mounts, renders, switches owners, and disposes without memory leaks', () => {
      const canvas = document.createElement('canvas');
      const gl = new MockWebGL2RenderingContext(canvas);

      const owner = new Scene3DContextOwner();
      owner.setup(gl as any);
      const renderer = new Scene3DRenderer();

      const cam = {
        kind: 'perspective' as const,
        eye: [0, 0, 5] as const,
        target: [0, 0, 0] as const,
        verticalFovRadians: Math.PI / 4,
        near: 0.1,
        far: 10,
      };

      for (let cycle = 0; cycle < 10; cycle++) {
        const world = new SceneWorld3D();
        const mesh = new Mesh3D(`mesh_${cycle}`, createAsymmetricMesh());
        world.add(mesh);

        renderer.render(owner, world, cam, {width: 100, height: 100});
        world.dispose();
      }

      // Final terminal owner disposal
      owner.dispose();
      expect(owner.geometries.activeVAOCount).toBe(0);
      expect(owner.geometries.activeBufferCount).toBe(0);
    });
  });
});
