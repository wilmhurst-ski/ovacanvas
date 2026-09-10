import {describe, expect, it} from 'vitest';
import {lookAtViewMatrix, perspectiveMatrix} from '../../projection/matrix';
import {Bounds3} from '../math/bounds3';
import {fitCameraToBounds, resolveCameraMatrices} from '../math/camera';
import {Matrix4} from '../math/matrix4';
import {Quaternion} from '../math/quaternion';
import {Ray3} from '../math/ray3';
import {Vector3} from '../math/vector3';
import {Scene3DError} from '../public/errors';

describe('scene3d / math', () => {
  describe('Vector3', () => {
    it('creates vector and normalizes -0 to 0', () => {
      const v = new Vector3(-0, 1, 2);
      expect(Object.is(v.x, 0)).toBe(true);
      expect(v.y).toBe(1);
      expect(v.z).toBe(2);
    });

    it('rejects non-finite values', () => {
      expect(() => new Vector3(NaN, 0, 0)).toThrow(Scene3DError);
      expect(() => new Vector3(0, Infinity, 0)).toThrow(Scene3DError);
    });

    it('performs vector operations correctly', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(4, 5, 6);

      expect(a.add(b).toArray()).toEqual([5, 7, 9]);
      expect(b.sub(a).toArray()).toEqual([3, 3, 3]);
      expect(a.scale(2).toArray()).toEqual([2, 4, 6]);
      expect(a.dot(b)).toBe(1 * 4 + 2 * 5 + 3 * 6); // 32

      const cross = new Vector3(1, 0, 0).cross(new Vector3(0, 1, 0));
      expect(cross.toArray()).toEqual([0, 0, 1]);

      const len = new Vector3(3, 4, 0).magnitude();
      expect(len).toBe(5);

      const norm = new Vector3(3, 4, 0).normalize();
      expect(norm.x).toBeCloseTo(0.6);
      expect(norm.y).toBeCloseTo(0.8);
      expect(norm.z).toBe(0);
    });
  });

  describe('Quaternion', () => {
    it('creates identity quaternion', () => {
      const q = Quaternion.identity;
      expect(q.toArray()).toEqual([0, 0, 0, 1]);
    });

    it('rotates about Y axis', () => {
      const q = Quaternion.fromAxisAngle([0, 1, 0], Math.PI * 0.5);
      expect(q.x).toBeCloseTo(0);
      expect(q.y).toBeCloseTo(Math.SQRT1_2);
      expect(q.z).toBeCloseTo(0);
      expect(q.w).toBeCloseTo(Math.SQRT1_2);
    });

    it('performs spherical linear interpolation (slerp)', () => {
      const q1 = Quaternion.fromAxisAngle([0, 1, 0], 0);
      const q2 = Quaternion.fromAxisAngle([0, 1, 0], Math.PI);
      const mid = q1.slerp(q2, 0.5);

      expect(mid.y).toBeCloseTo(Math.SQRT1_2);
      expect(mid.w).toBeCloseTo(Math.SQRT1_2);
    });
  });

  describe('Matrix4', () => {
    it('creates identity matrix', () => {
      const m = Matrix4.identity;
      expect(m.elements[0]).toBe(1);
      expect(m.elements[5]).toBe(1);
      expect(m.elements[10]).toBe(1);
      expect(m.elements[15]).toBe(1);
    });

    it('multiplies matrices correctly', () => {
      const t = Matrix4.compose([10, 20, 30]);
      const s = Matrix4.compose(undefined, undefined, [2, 2, 2]);
      const combined = t.multiply(s);

      const pt = combined.transformPoint([1, 2, 3]);
      expect(pt.x).toBe(12); // 1 * 2 + 10
      expect(pt.y).toBe(24); // 2 * 2 + 20
      expect(pt.z).toBe(36); // 3 * 2 + 30
    });

    it('inverts invertible matrix and throws on singular matrix', () => {
      const m = Matrix4.compose(
        [5, -2, 10],
        Quaternion.fromAxisAngle([0, 1, 0], 0.5),
        [2, 3, 4],
      );
      const inv = m.invert();
      const identity = m.multiply(inv);

      for (let i = 0; i < 16; i++) {
        const expected = i % 5 === 0 ? 1 : 0;
        expect(identity.elements[i]).toBeCloseTo(expected, 4);
      }

      const singular = Matrix4.compose([0, 0, 0], undefined, [0, 1, 1]);
      expect(() => singular.invert()).toThrow(Scene3DError);
    });

    it('matches legacy projection matrix conventions for lookAt and perspective', () => {
      const eye = [0, 5, 10] as const;
      const target = [0, 0, 0] as const;
      const up = [0, 1, 0] as const;

      const legacyView = lookAtViewMatrix({
        eye: {x: eye[0], y: eye[1], z: eye[2]},
        target: {x: target[0], y: target[1], z: target[2]},
        up: {x: up[0], y: up[1], z: up[2]},
      });
      const newView = Matrix4.lookAt(eye, target, up);

      for (let i = 0; i < 16; i++) {
        expect(newView.elements[i]).toBeCloseTo(legacyView[i], 5);
      }

      const fov = (60 * Math.PI) / 180;
      const aspect = 16 / 9;
      const near = 0.1;
      const far = 100;

      const legacyProj = perspectiveMatrix({
        kind: 'perspective',
        verticalFovRadians: fov,
        aspect,
        near,
        far,
      });
      const newProj = Matrix4.perspective(fov, aspect, near, far);

      for (let i = 0; i < 16; i++) {
        expect(newProj.elements[i]).toBeCloseTo(legacyProj[i], 5);
      }
    });

    it('computes 3x3 normal matrix correctly', () => {
      // Non-uniform scaling: scale X by 2
      const m = Matrix4.compose(undefined, undefined, [2, 1, 1]);
      const normalMat = m.normalMatrix();

      // Normal matrix is inverse-transpose of upper 3x3: (1/2, 1, 1)
      expect(normalMat[0]).toBeCloseTo(0.5);
      expect(normalMat[4]).toBeCloseTo(1.0);
      expect(normalMat[8]).toBeCloseTo(1.0);
    });
  });

  describe('Bounds3', () => {
    it('computes bounding box from points', () => {
      const pts = [-1, -2, -3, 4, 5, 6];
      const b = Bounds3.fromPoints(pts);

      expect(b.min.toArray()).toEqual([-1, -2, -3]);
      expect(b.max.toArray()).toEqual([4, 5, 6]);
      expect(b.getCenter().toArray()).toEqual([1.5, 1.5, 1.5]);
      expect(b.getSize().toArray()).toEqual([5, 7, 9]);
    });

    it('transforms bounding box with matrix', () => {
      const b = new Bounds3([-1, -1, -1], [1, 1, 1]);
      const t = Matrix4.compose([10, 0, 0], undefined, [2, 2, 2]);
      const transformed = b.transform(t);

      expect(transformed.min.toArray()).toEqual([8, -2, -2]);
      expect(transformed.max.toArray()).toEqual([12, 2, 2]);
    });
  });

  describe('Ray3', () => {
    it('intersects triangle with correct distance and barycentrics', () => {
      const ray = new Ray3([0, 0, 5], [0, 0, -1]);
      const v0 = [-1, -1, 0] as const;
      const v1 = [1, -1, 0] as const;
      const v2 = [0, 1, 0] as const;

      const hit = ray.intersectTriangle(v0, v1, v2);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeCloseTo(5.0);
      expect(hit!.point.toArray()).toEqual([0, 0, 0]);
      expect(
        hit!.barycentric[0] + hit!.barycentric[1] + hit!.barycentric[2],
      ).toBeCloseTo(1.0);
    });

    it('misses triangle outside bounds', () => {
      const ray = new Ray3([5, 5, 5], [0, 0, -1]);
      const v0 = [-1, -1, 0] as const;
      const v1 = [1, -1, 0] as const;
      const v2 = [0, 1, 0] as const;

      expect(ray.intersectTriangle(v0, v1, v2)).toBeNull();
    });

    it('intersects box slab test', () => {
      const ray = new Ray3([0, 0, 5], [0, 0, -1]);
      const box = new Bounds3([-1, -1, -1], [1, 1, 1]);

      const dist = ray.intersectBox(box);
      expect(dist).toBeCloseTo(4.0); // hits z = 1
    });

    it('intersects segment within tolerance', () => {
      const ray = new Ray3([0, 0, 5], [0, 0, -1]);
      const p0 = [-1, 0, 0] as const;
      const p1 = [1, 0, 0] as const;

      const hit = ray.intersectSegment(p0, p1, 0.1);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeCloseTo(5.0);
    });
  });

  describe('Camera', () => {
    it('resolves perspective and orthographic camera matrices', () => {
      const persp = resolveCameraMatrices(
        {
          kind: 'perspective',
          eye: [0, 0, 10],
          target: [0, 0, 0],
          verticalFovRadians: (45 * Math.PI) / 180,
          near: 0.1,
          far: 100,
        },
        16 / 9,
      );
      expect(persp.view).toBeDefined();
      expect(persp.projection).toBeDefined();

      const ortho = resolveCameraMatrices(
        {
          kind: 'orthographic',
          eye: [0, 0, 10],
          target: [0, 0, 0],
          verticalSize: 10,
          near: 0.1,
          far: 100,
        },
        16 / 9,
      );
      expect(ortho.view).toBeDefined();
      expect(ortho.projection).toBeDefined();
    });

    it('fits camera to bounds accounting for aspect ratio and padding', () => {
      const bounds = {
        min: {x: -2, y: -2, z: -2},
        max: {x: 2, y: 2, z: 2},
      };

      const fitted = fitCameraToBounds({
        bounds,
        aspectRatio: 16 / 9,
        padding: 1.2,
      });

      expect(fitted.target).toEqual([0, 0, 0]);
      expect(fitted.near).toBeGreaterThan(0);
      expect(fitted.far).toBeGreaterThan(fitted.near);
    });
  });
});
