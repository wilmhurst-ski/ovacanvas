import {parametricSurface} from '../geometry/parametricSurface';
import {Scene3DError} from '../public/errors';
import type {
  LineGeometry3D,
  TriangleGeometry3D,
  Vec3Like,
} from '../public/types';
import {Line3D} from '../scene/Line3D';
import {Mesh3D} from '../scene/Mesh3D';
import {SceneWorld3D} from '../scene/SceneWorld3D';

/**
 * A 3D scene described as plain data - everything a science figure needs,
 * with no classes to construct and nothing mutable to get wrong.
 *
 * @remarks
 * `SceneWorld3D` is a mutable object graph, which a scene document cannot
 * express. This is the declarative front door to it: surfaces with colour
 * maps, curves drawn as tubes (a WebGL line is always one pixel wide),
 * arrows, spheres, and a framing box with grid lines, all in world
 * coordinates with +Y up. The authoring layer computes the data - sampled
 * heights, curve points - and this turns it into lit meshes.
 */
export interface World3DSpec {
  readonly background?: string;
  /** Default: a soft ambient light and one directional light from above. */
  readonly lights?: 'default' | 'flat';
  readonly surfaces?: readonly Surface3DSpec[];
  readonly curves?: readonly Curve3DSpec[];
  readonly arrows?: readonly Arrow3DSpec[];
  readonly spheres?: readonly Sphere3DSpec[];
  readonly box?: Box3DSpec;
}

/** A height field over a rectangle of the X-Z plane. */
export interface Surface3DSpec {
  readonly id: string;
  /** X range, Z range, and segments along each. */
  readonly x: readonly [number, number];
  readonly z: readonly [number, number];
  readonly nx: number;
  readonly nz: number;
  /** (nx + 1) * (nz + 1) heights (Y), row by row along X then Z. */
  readonly heights: readonly number[];
  /** Colour by height with a scientific colour map, or one flat colour. */
  readonly colormap?: ColormapName;
  readonly color?: string;
  /** The heights the colour map spans. Default: the surface's own range. */
  readonly heightRange?: readonly [number, number];
  readonly opacity?: number;
  /** Grid lines over the surface, every `every` segments. */
  readonly wireframe?: {readonly color?: string; readonly every?: number};
}

export interface Curve3DSpec {
  readonly id: string;
  /** Flat [x, y, z, x, y, z, ...] along the curve. */
  readonly points: readonly number[];
  readonly color?: string;
  /** Tube radius in world units. Default 0.02. */
  readonly radius?: number;
}

export interface Arrow3DSpec {
  readonly id: string;
  readonly from: Vec3Like;
  readonly to: Vec3Like;
  readonly color?: string;
  readonly radius?: number;
}

export interface Sphere3DSpec {
  readonly id: string;
  readonly center: Vec3Like;
  readonly radius: number;
  readonly color?: string;
  readonly opacity?: number;
}

/** A science-plot frame: box edges, grid lines on the three back walls. */
export interface Box3DSpec {
  readonly min: Vec3Like;
  readonly max: Vec3Like;
  /** Grid divisions per axis. Default 4. */
  readonly divisions?: number;
  readonly color?: string;
  readonly gridColor?: string;
  /** Which way the camera looks from, so the walls behind the data get grids. */
  readonly viewFrom?: Vec3Like;
}

export type ColormapName = 'viridis' | 'plasma' | 'coolwarm' | 'terrain';

const COLORMAPS: Readonly<
  Record<ColormapName, readonly (readonly number[])[]>
> = {
  viridis: [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15],
    [0.993, 0.906, 0.144],
  ],
  plasma: [
    [0.05, 0.03, 0.528],
    [0.294, 0.012, 0.631],
    [0.492, 0.012, 0.658],
    [0.658, 0.134, 0.588],
    [0.798, 0.28, 0.47],
    [0.899, 0.425, 0.356],
    [0.973, 0.585, 0.254],
    [0.994, 0.764, 0.156],
    [0.94, 0.975, 0.131],
  ],
  coolwarm: [
    [0.23, 0.299, 0.754],
    [0.48, 0.61, 0.95],
    [0.865, 0.865, 0.865],
    [0.96, 0.6, 0.48],
    [0.706, 0.016, 0.15],
  ],
  terrain: [
    [0.2, 0.2, 0.6],
    [0.0, 0.6, 1.0],
    [0.0, 0.8, 0.4],
    [1.0, 1.0, 0.6],
    [0.5, 0.36, 0.33],
    [1.0, 1.0, 1.0],
  ],
};

/** A colour map's RGB at t in [0, 1]. */
export function sampleColormap(
  name: ColormapName,
  t: number,
): [number, number, number] {
  const stops = COLORMAPS[name];
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

type V3 = [number, number, number];

function vec(value: Vec3Like): V3 {
  return Array.isArray(value)
    ? [value[0], value[1], value[2]]
    : [
        (value as {x: number}).x,
        (value as {y: number}).y,
        (value as {z: number}).z,
      ];
}
function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function length(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a: V3): V3 {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 1, 0];
}

/** Any vector perpendicular to `d`. */
function perpendicular(d: V3): V3 {
  const helper: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(d, helper));
}

/**
 * A tube around a polyline: rings of vertices carried along the curve with
 * parallel transport, so the tube does not twist where the curve turns.
 */
export function tubeGeometry(
  points: readonly V3[],
  radius: number,
  sides = 10,
): TriangleGeometry3D {
  const clean = points.filter(
    (p, i) => i === 0 || length(sub(p, points[i - 1])) > radius * 1e-3,
  );
  if (clean.length < 2) {
    throw new Scene3DError(
      'DEGENERATE_PRIMITIVE',
      'a curve needs two distinct points',
    );
  }
  const positions: number[] = [];
  const indices: number[] = [];
  let normal = perpendicular(normalize(sub(clean[1], clean[0])));
  for (let i = 0; i < clean.length; i++) {
    const tangent = normalize(
      i === 0
        ? sub(clean[1], clean[0])
        : i === clean.length - 1
          ? sub(clean[i], clean[i - 1])
          : sub(clean[i + 1], clean[i - 1]),
    );
    // Parallel transport: remove the tangent's component from the last normal.
    normal = normalize(sub(normal, scale(tangent, dot(normal, tangent))));
    const binormal = cross(tangent, normal);
    for (let s = 0; s < sides; s++) {
      const angle = (2 * Math.PI * s) / sides;
      const offset = add(
        scale(normal, Math.cos(angle) * radius),
        scale(binormal, Math.sin(angle) * radius),
      );
      positions.push(...add(clean[i], offset));
    }
  }
  for (let i = 0; i + 1 < clean.length; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s;
      const b = i * sides + ((s + 1) % sides);
      const c = (i + 1) * sides + s;
      const d = (i + 1) * sides + ((s + 1) % sides);
      indices.push(a, c, b, b, c, d);
    }
  }
  return {kind: 'triangles', positions, indices};
}

/** A cone from `base` to `tip`. */
function coneGeometry(
  base: V3,
  tip: V3,
  radius: number,
  sides = 16,
): TriangleGeometry3D {
  const axis = normalize(sub(tip, base));
  const u = perpendicular(axis);
  const v = cross(axis, u);
  const positions: number[] = [...tip, ...base];
  const indices: number[] = [];
  for (let s = 0; s < sides; s++) {
    const angle = (2 * Math.PI * s) / sides;
    positions.push(
      ...add(
        base,
        add(
          scale(u, Math.cos(angle) * radius),
          scale(v, Math.sin(angle) * radius),
        ),
      ),
    );
  }
  for (let s = 0; s < sides; s++) {
    const a = 2 + s;
    const b = 2 + ((s + 1) % sides);
    indices.push(0, a, b, 1, b, a);
  }
  return {kind: 'triangles', positions, indices};
}

function sphereGeometry(center: V3, radius: number): TriangleGeometry3D {
  return parametricSurface(
    (theta, phi) => [
      center[0] + radius * Math.sin(phi) * Math.cos(theta),
      center[1] + radius * Math.cos(phi),
      center[2] + radius * Math.sin(phi) * Math.sin(theta),
    ],
    {
      uRange: [0, 2 * Math.PI],
      vRange: [0.001, Math.PI - 0.001],
      uSegments: 24,
      vSegments: 14,
    },
  );
}

function surfaceMesh(spec: Surface3DSpec): {
  mesh: TriangleGeometry3D;
  lines?: LineGeometry3D;
} {
  const {nx, nz, heights} = spec;
  if (heights.length !== (nx + 1) * (nz + 1)) {
    throw new Scene3DError(
      'INVALID_GEOMETRY_LENGTH',
      `surface "${spec.id}" needs ${(nx + 1) * (nz + 1)} heights, got ${heights.length}`,
    );
  }
  const [x0, x1] = spec.x;
  const [z0, z1] = spec.z;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of heights) {
    if (Number.isFinite(h)) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const [c0, c1] = spec.heightRange ?? [lo, hi];
  const positions: number[] = [];
  const colors: number[] = [];
  const opacity = spec.opacity ?? 1;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const h = heights[j * (nx + 1) + i];
      const y = Number.isFinite(h) ? h : lo;
      positions.push(x0 + ((x1 - x0) * i) / nx, y, z0 + ((z1 - z0) * j) / nz);
      if (spec.colormap) {
        const [r, g, b] = sampleColormap(
          spec.colormap,
          c1 > c0 ? (y - c0) / (c1 - c0) : 0.5,
        );
        colors.push(r, g, b, opacity);
      }
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const mesh: TriangleGeometry3D = {
    kind: 'triangles',
    positions,
    indices,
    ...(spec.colormap ? {colors} : {}),
  };
  if (!spec.wireframe) return {mesh};
  // Lift the grid a hair above the surface so it is not lost in it.
  const lift = Math.max(1e-3, (hi - lo) * 0.004);
  const every = Math.max(1, spec.wireframe.every ?? 1);
  const line: number[] = [];
  const at = (i: number, j: number) => {
    const k = (j * (nx + 1) + i) * 3;
    return [positions[k], positions[k + 1] + lift, positions[k + 2]];
  };
  for (let j = 0; j <= nz; j += every) {
    for (let i = 0; i < nx; i++) line.push(...at(i, j), ...at(i + 1, j));
  }
  for (let i = 0; i <= nx; i += every) {
    for (let j = 0; j < nz; j++) line.push(...at(i, j), ...at(i, j + 1));
  }
  return {mesh, lines: {kind: 'lines', positions: line, topology: 'segments'}};
}

function boxLines(spec: Box3DSpec): {
  edges: LineGeometry3D;
  grid: LineGeometry3D;
} {
  const lo = vec(spec.min);
  const hi = vec(spec.max);
  const view = normalize(vec(spec.viewFrom ?? [1, 1, 1]));
  // The back wall on each axis is the one facing away from the viewer.
  const back = [0, 1, 2].map(a => (view[a] > 0 ? lo[a] : hi[a]));
  const n = Math.max(1, Math.round(spec.divisions ?? 4));
  const grid: number[] = [];
  const edges: number[] = [];
  const point = (
    a: number,
    av: number,
    b: number,
    bv: number,
    c: number,
    cv: number,
  ): V3 => {
    const p: V3 = [0, 0, 0];
    p[a] = av;
    p[b] = bv;
    p[c] = cv;
    return p;
  };
  // For each back wall (normal axis w), grid lines along both in-wall axes.
  for (const w of [0, 1, 2]) {
    const [a, b] = [0, 1, 2].filter(k => k !== w);
    for (let k = 0; k <= n; k++) {
      const av = lo[a] + ((hi[a] - lo[a]) * k) / n;
      const bv = lo[b] + ((hi[b] - lo[b]) * k) / n;
      const target = k === 0 || k === n ? edges : grid;
      target.push(
        ...point(w, back[w], a, av, b, lo[b]),
        ...point(w, back[w], a, av, b, hi[b]),
      );
      target.push(
        ...point(w, back[w], b, bv, a, lo[a]),
        ...point(w, back[w], b, bv, a, hi[a]),
      );
    }
  }
  return {
    edges: {kind: 'lines', positions: edges, topology: 'segments'},
    grid: {kind: 'lines', positions: grid, topology: 'segments'},
  };
}

/** Build a lit `SceneWorld3D` from a plain description. */
export function buildWorld3D(spec: World3DSpec): SceneWorld3D {
  const world = new SceneWorld3D();
  if (spec.background) world.background = spec.background;
  if (spec.lights !== 'flat') {
    world.addLight({kind: 'ambient', intensity: 0.55});
    world.addLight({
      kind: 'directional',
      direction: [-0.4, -1, -0.3],
      intensity: 0.65,
    });
  }
  const lit = spec.lights === 'flat' ? 'unlit' : 'lambert';
  if (spec.box) {
    const {edges, grid} = boxLines(spec.box);
    world.add(
      new Line3D('box-grid', grid, {color: spec.box.gridColor ?? '#D5D7D2'}),
    );
    world.add(
      new Line3D('box-edges', edges, {color: spec.box.color ?? '#8B9199'}),
    );
  }
  for (const surface of spec.surfaces ?? []) {
    const {mesh, lines} = surfaceMesh(surface);
    world.add(
      new Mesh3D(surface.id, mesh, {
        kind: lit,
        ...(surface.colormap
          ? {vertexColors: true}
          : {color: surface.color ?? '#2F66D0'}),
        opacity: surface.opacity ?? 1,
        side: 'double',
      }),
    );
    if (lines) {
      world.add(
        new Line3D(`${surface.id}-grid`, lines, {
          color: surface.wireframe?.color ?? '#1B2230',
          opacity: 0.35,
        }),
      );
    }
  }
  for (const curve of spec.curves ?? []) {
    const points: V3[] = [];
    for (let i = 0; i + 2 < curve.points.length; i += 3) {
      points.push([curve.points[i], curve.points[i + 1], curve.points[i + 2]]);
    }
    world.add(
      new Mesh3D(curve.id, tubeGeometry(points, curve.radius ?? 0.02), {
        kind: lit,
        color: curve.color ?? '#F05A3C',
      }),
    );
  }
  for (const arrow of spec.arrows ?? []) {
    const from = vec(arrow.from);
    const to = vec(arrow.to);
    const span = length(sub(to, from));
    if (span < 1e-9) continue;
    const radius = arrow.radius ?? Math.max(0.012, span * 0.02);
    const head = Math.min(span * 0.35, radius * 7);
    const neck = sub(to, scale(normalize(sub(to, from)), head));
    world.add(
      new Mesh3D(arrow.id, tubeGeometry([from, neck], radius, 12), {
        kind: lit,
        color: arrow.color ?? '#151922',
      }),
    );
    world.add(
      new Mesh3D(`${arrow.id}-head`, coneGeometry(neck, to, radius * 2.6), {
        kind: lit,
        color: arrow.color ?? '#151922',
      }),
    );
  }
  for (const sphere of spec.spheres ?? []) {
    world.add(
      new Mesh3D(sphere.id, sphereGeometry(vec(sphere.center), sphere.radius), {
        kind: lit,
        color: sphere.color ?? '#F3C742',
        opacity: sphere.opacity ?? 1,
      }),
    );
  }
  return world;
}
