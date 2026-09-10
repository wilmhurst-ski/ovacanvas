import {describe, expect, it} from 'vitest';
import {pickClosest3D} from '../interaction/pick';
import {
  projectAnchor3D,
  projectPointToViewport3D,
} from '../interaction/project';
import {
  createRayFromViewport,
  unprojectPoint3D,
} from '../interaction/unproject';
import {Group3D} from '../scene/Group3D';
import {Line3D} from '../scene/Line3D';
import {Mesh3D} from '../scene/Mesh3D';
import {PointCloud3D} from '../scene/PointCloud3D';
import {SceneWorld3D} from '../scene/SceneWorld3D';
import {
  createCrossingTriangles,
  createTestLine,
  createTestPoints,
} from './fixtures';

describe('scene3d / picking & anchors', () => {
  const camera = {
    kind: 'perspective' as const,
    eye: [0, 0, 5] as const,
    target: [0, 0, 0] as const,
    up: [0, 1, 0] as const,
    verticalFovRadians: (60 * Math.PI) / 180,
    near: 0.1,
    far: 100,
  };
  const viewport = {width: 800, height: 600};

  describe('projection & anchors', () => {
    it('projects center world point to center viewport coordinates (0, 0)', () => {
      const proj = projectPointToViewport3D([0, 0, 0], camera, viewport);
      expect(proj.position.x).toBeCloseTo(0, 1);
      expect(proj.position.y).toBeCloseTo(0, 1);
      expect(proj.inFront).toBe(true);
      expect(proj.insideClip).toBe(true);
      expect(proj.insideViewport).toBe(true);
    });

    it('identifies points behind camera', () => {
      const proj = projectPointToViewport3D([0, 0, 10], camera, viewport);
      expect(proj.inFront).toBe(false);
    });

    it('determines if surface normal faces camera for 2D anchors', () => {
      // Normal pointing towards camera (+Z)
      const anchorFront = projectAnchor3D(
        [0, 0, 0],
        camera,
        viewport,
        [0, 0, 1],
      );
      expect(anchorFront.facingCamera).toBe(true);

      // Normal pointing away from camera (-Z)
      const anchorBack = projectAnchor3D(
        [0, 0, 0],
        camera,
        viewport,
        [0, 0, -1],
      );
      expect(anchorBack.facingCamera).toBe(false);
    });
  });

  describe('unprojection & ray generation', () => {
    it('round-trips world point through projection and unprojection', () => {
      const originalPt = {x: 1.0, y: -0.5, z: 2.0};
      const proj = projectPointToViewport3D(originalPt, camera, viewport);
      const unprojected = unprojectPoint3D(
        proj.position,
        proj.depth,
        camera,
        viewport,
      );

      expect(unprojected.x).toBeCloseTo(originalPt.x, 3);
      expect(unprojected.y).toBeCloseTo(originalPt.y, 3);
      expect(unprojected.z).toBeCloseTo(originalPt.z, 3);
    });

    it('creates world ray pointing through screen center', () => {
      const ray = createRayFromViewport({x: 0, y: 0}, camera, viewport);
      expect(ray.direction.x).toBeCloseTo(0, 4);
      expect(ray.direction.y).toBeCloseTo(0, 4);
      expect(ray.direction.z).toBeCloseTo(-1, 4);
    });
  });

  describe('closest-hit CPU picking', () => {
    it('picks the closest visible triangle', () => {
      const world = new SceneWorld3D();
      const {triangleA, triangleB} = createCrossingTriangles();

      world.add(new Mesh3D('meshA', triangleA));
      world.add(new Mesh3D('meshB', triangleB));

      // Pick at screen center (0, 0)
      const hit = pickClosest3D({x: 0, y: 0}, world, camera, viewport);
      expect(hit).not.toBeNull();
      expect(hit!.primitiveKind).toBe('triangle');
      expect(hit!.worldPosition.z).toBeCloseTo(0, 2);
      expect(hit!.barycentric).toBeDefined();
    });

    it('does not pick hidden objects', () => {
      const world = new SceneWorld3D();
      const {triangleA} = createCrossingTriangles();

      const mesh = new Mesh3D('meshA', triangleA);
      mesh.visible = false;
      world.add(mesh);

      const hit = pickClosest3D({x: 0, y: 0}, world, camera, viewport);
      expect(hit).toBeNull();
    });

    it('respects hierarchical group transforms during picking', () => {
      const world = new SceneWorld3D();
      const group = new Group3D('parentGroup');
      group.translation = [10, 0, 0];

      const {triangleA} = createCrossingTriangles();
      const mesh = new Mesh3D('meshA', triangleA);
      group.add(mesh);
      world.add(group);

      // Ray aimed at translated object (x = 10)
      const rayCam = {
        ...camera,
        eye: [10, 0, 5] as const,
        target: [10, 0, 0] as const,
      };

      const hit = pickClosest3D({x: 0, y: 0}, world, rayCam, viewport);
      expect(hit).not.toBeNull();
      expect(hit!.objectId).toBe('meshA');
      expect(hit!.worldPosition.x).toBeCloseTo(10, 2);
    });

    it('picks lines and points', () => {
      const world = new SceneWorld3D();
      world.add(new Line3D('line', createTestLine(), {lineWidth: 5}));
      world.add(
        new PointCloud3D('points', createTestPoints(), {pointSize: 10}),
      );

      // Pick point at (0, 1, 0.5)
      const projPoint = projectPointToViewport3D([0, 1, 0.5], camera, viewport);
      const hit = pickClosest3D(projPoint.position, world, camera, viewport);

      expect(hit).not.toBeNull();
      expect(hit!.objectId).toBe('points');
      expect(hit!.primitiveKind).toBe('point');
    });
  });
});
