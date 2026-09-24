import type {SceneNode, Step, Touch} from '../document/model.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  colorValue,
  placementBox,
} from './fields.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

const KINDS = ['projectile', 'orbit', 'pendulum', 'freefall'] as const;
const SEGMENTS = 24;

type Vec = [number, number];

interface Trajectory {
  /** World positions at equal time steps (y up). */
  points: Vec[];
  /** Whether the path closes (an orbit). */
  closed: boolean;
  /**
   * The drawn path, when it differs from where the body goes (a pendulum's
   * arc is drawn once; the bob swings along it and back).
   */
  drawn?: Vec[];
  /** A fixed point: the pivot or the central body. */
  anchor?: Vec;
  /** Draw the ground line under the motion. */
  ground: boolean;
}

function num(node: KitNode, field: string, fallback: number): number {
  const value = node[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function trajectory(node: KitNode): Trajectory {
  const kind = node.kind as (typeof KINDS)[number];
  const g = num(node, 'gravity', 9.8);
  if (kind === 'projectile') {
    const speed = num(node, 'speed', 20);
    const angle = (num(node, 'angle', 45) * Math.PI) / 180;
    const vx = speed * Math.cos(angle);
    const vy = speed * Math.sin(angle);
    const flight = (2 * vy) / g;
    return {
      points: Array.from({length: SEGMENTS + 1}, (_, i) => {
        const t = (flight * i) / SEGMENTS;
        return [vx * t, vy * t - 0.5 * g * t * t] as Vec;
      }),
      closed: false,
      ground: true,
    };
  }
  if (kind === 'freefall') {
    const height = num(node, 'height', 20);
    const fall = Math.sqrt((2 * height) / g);
    return {
      points: Array.from({length: SEGMENTS + 1}, (_, i) => {
        const t = (fall * i) / SEGMENTS;
        return [0, height - 0.5 * g * t * t] as Vec;
      }),
      closed: false,
      ground: true,
    };
  }
  if (kind === 'pendulum') {
    const length = num(node, 'length', 2);
    const amplitude = (num(node, 'amplitude', 30) * Math.PI) / 180;
    // One full swing, out and back: theta(t) = A cos(2 pi t).
    return {
      points: Array.from({length: SEGMENTS + 1}, (_, i) => {
        const theta = amplitude * Math.cos((2 * Math.PI * i) / SEGMENTS);
        return [length * Math.sin(theta), -length * Math.cos(theta)] as Vec;
      }),
      drawn: Array.from({length: SEGMENTS + 1}, (_, i) => {
        const theta = -amplitude + (2 * amplitude * i) / SEGMENTS;
        return [length * Math.sin(theta), -length * Math.cos(theta)] as Vec;
      }),
      closed: false,
      anchor: [0, 0],
      ground: false,
    };
  }
  // Orbit: an ellipse with the central body at a focus, swept at equal
  // time steps (Kepler's equation), so the body speeds up near the centre.
  const e = Math.min(0.8, Math.max(0, num(node, 'eccentricity', 0.3)));
  const a = 1;
  const b = a * Math.sqrt(1 - e * e);
  const points: Vec[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const meanAnomaly = (2 * Math.PI * i) / SEGMENTS;
    let E = meanAnomaly;
    for (let k = 0; k < 20; k++) {
      E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
    }
    points.push([a * Math.cos(E), b * Math.sin(E)]);
  }
  // The outline is drawn smoothly; the body still moves in equal-time steps.
  const drawn: Vec[] = Array.from({length: 97}, (_, i) => {
    const E = (2 * Math.PI * i) / 96;
    return [a * Math.cos(E), b * Math.sin(E)] as Vec;
  });
  return {points, drawn, closed: true, anchor: [a * e, 0], ground: false};
}

export const motion: KitSpec = {
  name: 'motion',
  summary:
    'A physics simulation drawn and played for you: a projectile, a falling body, a swinging pendulum or an orbit. The path is computed from the physics; `play` runs the motion in real proportions.',
  fields: {
    kind: {
      type: '"projectile" | "freefall" | "pendulum" | "orbit"',
      required: true,
      doc: 'What moves.',
    },
    speed: {
      type: 'number',
      doc: 'projectile: launch speed in m/s (default 20).',
    },
    angle: {
      type: 'number',
      doc: 'projectile: launch angle in degrees (default 45).',
    },
    height: {
      type: 'number',
      doc: 'freefall: drop height in metres (default 20).',
    },
    length: {type: 'number', doc: 'pendulum: rod length (default 2).'},
    amplitude: {
      type: 'number',
      doc: 'pendulum: swing in degrees (default 30).',
    },
    eccentricity: {
      type: 'number',
      doc: 'orbit: 0 (circle) to 0.8 (long ellipse), default 0.3.',
    },
    gravity: {type: 'number', doc: 'm/s^2, default 9.8.'},
    seconds: {type: 'number', doc: 'How long `play` takes (default 2.5).'},
    color: {
      type: 'theme colour name or CSS colour',
      doc: 'The moving body (default coral).',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where it goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts: '"<id>.body", "<id>.path"; a beat with "play": "<id>" runs the motion',
  example: {
    id: 'throw',
    kit: 'motion',
    kind: 'projectile',
    speed: 18,
    angle: 50,
    region: 'left',
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields([
      'kind',
      'speed',
      'angle',
      'height',
      'length',
      'amplitude',
      'eccentricity',
      'gravity',
      'seconds',
      'color',
      ...PLACEMENT_FIELDS,
    ]);
    checkPlacement(node, errors);
    if (!(KINDS as readonly string[]).includes(String(node.kind))) {
      errors.error('kind', `kind must be one of ${KINDS.join(', ')}`);
    }
    const ranges: Record<string, [number, number]> = {
      speed: [0.1, 1000],
      angle: [1, 89],
      height: [0.1, 10000],
      length: [0.1, 100],
      amplitude: [1, 80],
      eccentricity: [0, 0.8],
      gravity: [0.1, 100],
      seconds: [0.5, 5],
    };
    for (const [field, [lo, hi]] of Object.entries(ranges)) {
      const value = node[field];
      if (
        value !== undefined &&
        !(typeof value === 'number' && value >= lo && value <= hi)
      ) {
        errors.error(field, `${field} must be a number from ${lo} to ${hi}`);
      }
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const box = placementBox(node);
    const id = node.id;
    const path = trajectory(node);
    const seconds = num(node, 'seconds', 2.5);

    // Fit the world (y up) into the box (y down), keeping proportions.
    const all = [...path.points, ...(path.anchor ? [path.anchor] : [])];
    const xs = all.map(p => p[0]);
    const ys = all.map(p => p[1]);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const spanY = Math.max(...ys) - Math.min(...ys) || 1;
    const scale = Math.min(
      (box.width - 120) / spanX,
      (box.height - 120) / spanY,
    );
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const S = (p: Vec): [number, number] => [
      Math.round(box.x + (p[0] - cx) * scale),
      Math.round(box.y - (p[1] - cy) * scale),
    ];
    const screen = path.points.map(S);
    // A line must not repeat a point: zero-length segments break its length.
    const drawn = (path.drawn ?? path.points)
      .map(S)
      .filter(
        (p, i, all) =>
          i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1],
      );
    const traced = !path.closed && !path.drawn;

    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const pathId = `${id}_path`;
    const bodyId = `${id}_body`;

    if (path.ground) {
      const groundY = Math.max(...screen.map(p => p[1])) + 9;
      const gid = `${id}_ground`;
      nodes.push({
        id: gid,
        component: 'Line',
        halo: 0,
        props: {
          points: [
            [box.x - box.width / 2 + 30, groundY],
            [box.x + box.width / 2 - 30, groundY],
          ],
          stroke: {theme: 'secondaryInk'},
          lineWidth: 3,
        },
      });
      touches.push({a: gid, b: '*', reason: 'the ground everything stands on'});
    }
    // The path: drawn as the body travels (an orbit is shown whole, faint).
    nodes.push({
      id: pathId,
      component: 'Line',
      halo: 2,
      props: {
        points: path.closed ? drawn.slice(0, -1) : drawn,
        ...(path.closed ? {closed: true} : traced ? {end: 0} : {}),
        stroke: {theme: 'hairline'},
        lineWidth: 3,
        lineDash: [8, 8],
      },
    });
    if (path.anchor) {
      const anchorId = `${id}_anchor`;
      const isOrbit = node.kind === 'orbit';
      nodes.push({
        id: anchorId,
        component: 'Circle',
        fixed: true,
        props: {
          size: isOrbit ? 64 : 16,
          fill: isOrbit ? {theme: 'yellow'} : {theme: 'ink'},
          position: S(path.anchor),
        },
      });
      touches.push({
        a: anchorId,
        b: pathId,
        reason: 'the path is drawn around its centre',
      });
      if (node.kind === 'pendulum') {
        const rodId = `${id}_rod`;
        nodes.push({
          id: rodId,
          component: 'Line',
          props: {
            points: [{ref: anchorId}, {ref: bodyId}],
            stroke: {theme: 'ink'},
            lineWidth: 3,
          },
        });
        touches.push({
          a: rodId,
          b: pathId,
          reason: 'the rod sweeps across the arc',
        });
        parts.set('rod', {nodes: [rodId]});
      }
      parts.set('anchor', {nodes: [anchorId]});
    }
    nodes.push({
      id: bodyId,
      component: 'Circle',
      props: {
        size: 36,
        fill: colorValue(node.color, 'coral'),
        position: screen[0],
      },
    });
    touches.push({
      a: bodyId,
      b: pathId,
      reason: 'the body travels along its path',
    });
    touches.push({
      a: bodyId,
      b: '*',
      reason: 'the body moves through the scene along its computed path',
    });

    // Equal-time segments, each linear: speed changes show as it would in reality.
    const segment = Math.round((seconds / SEGMENTS) * 1000) / 1000;
    const moves: Step[] = screen.slice(1).map(p => ({
      kind: 'tween',
      node: bodyId,
      prop: 'position',
      to: p,
      seconds: segment,
      easing: 'linear',
    }));
    const play: Step[] = !traced
      ? [{kind: 'chain', steps: moves}]
      : [
          {
            kind: 'all',
            steps: [
              {
                kind: 'tween',
                node: pathId,
                prop: 'end',
                to: 1,
                seconds,
                easing: 'linear',
              },
              {kind: 'chain', steps: moves},
            ],
          },
        ];

    parts.set('body', {nodes: [bodyId]});
    parts.set('path', {
      nodes: [pathId],
      ...(traced ? {traceable: [pathId]} : {}),
    });
    parts.set('', {nodes: [bodyId, pathId], play});
    return {nodes, touches, parts};
  },
};
