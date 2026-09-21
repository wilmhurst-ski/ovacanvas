import {Circle, Line, Rect, Txt, makeScene2D} from '@ovacanvas/2d';
import {theme} from '@ovacanvas/2d/lib/theme/theme';
import {
  BBox,
  DynamicalSystem,
  waitFor,
  type SimulationModel,
} from '@ovacanvas/core';
import type {BeatAuditSpec, BeatManifest} from './BeatManifest';

const SAFE_AREA = new BBox(60, 60, 1800, 960);

/**
 * 1. Damped Harmonic Oscillator Simulation Model
 *
 * Differential equation: m * x'' + c * x' + k * x = 0
 * State vector: [x (displacement), v (velocity)]
 */
export const HarmonicOscillatorModel: SimulationModel = {
  id: 'sim-harmonic-oscillator',
  revision: 1,
  dt: 0.01,
  initialState: [200, 0], // Start 200px displaced
  parameters: {
    k: 9.0, // Spring stiffness
    c: 0.6, // Damping coefficient
    m: 1.0, // Mass
  },
  derivative: (_time, state, params) => {
    const x = state[0];
    const v = state[1];
    // x' = v
    // v' = -(k*x + c*v) / m
    const a = -(params.k * x + params.c * v) / params.m;
    return [v, a];
  },
};

/**
 * Creates a beat demonstrating a damped harmonic oscillator driven by DynamicalSystem.
 */
export function createHarmonicOscillatorBeat(
  id = 'sim-oscillator',
  title = 'Damped Harmonic Oscillator',
): BeatManifest {
  let titleNode: Txt;
  let massBlock: Rect;
  let centerLine: Line;

  const system = new DynamicalSystem(HarmonicOscillatorModel);

  const runner = makeScene2D(function* (view) {
    const currentTheme = theme();

    titleNode = new Txt({
      text: title,
      fontSize: 48,
      fontWeight: 700,
      fill: currentTheme.ink,
      position: [0, -380],
    });

    centerLine = new Line({
      points: [
        [-400, 0],
        [400, 0],
      ],
      stroke: currentTheme.hairline,
      lineWidth: 2,
    });

    massBlock = new Rect({
      width: 100,
      height: 100,
      fill: currentTheme.blue,
      radius: 12,
      position: [200, 0],
    });

    view.add([titleNode, centerLine, massBlock]);

    // Animate across 180 frames (6 seconds at 30 fps)
    const totalFrames = 180;
    const dtPerFrame = 1 / 30;

    for (let frame = 0; frame <= totalFrames; frame++) {
      const time = frame * dtPerFrame;
      const sample = system.stateAtTime(time, 'nearest');
      massBlock.position([sample.state[0], 0]);
      yield* waitFor(dtPerFrame);
    }
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [
      {id: 'title', node: titleNode as never, halo: 10},
      {id: 'mass', node: massBlock as never, halo: 20},
    ],
    requiredIds: ['title', 'mass'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}

/**
 * 2. Keplerian Gravitational Two-Body Orbit Simulation Model
 *
 * Differential equation: r'' = -G * M * r / |r|^3
 * State vector: [x, y, vx, vy]
 */
export const KeplerianOrbitModel: SimulationModel = {
  id: 'sim-keplerian-orbit',
  revision: 1,
  dt: 0.005,
  initialState: [300, 0, 0, 160], // Initial circular-like orbit
  parameters: {
    gm: 8000000, // Gravitational parameter
  },
  derivative: (_time, state, params) => {
    const x = state[0];
    const y = state[1];
    const vx = state[2];
    const vy = state[3];

    const r2 = x * x + y * y;
    const r = Math.sqrt(r2);
    const r3 = r2 * r;
    const ax = (-params.gm * x) / r3;
    const ay = (-params.gm * y) / r3;

    return [vx, vy, ax, ay];
  },
};

/**
 * Creates a beat demonstrating a gravitational planetary orbit.
 */
export function createKeplerianOrbitBeat(
  id = 'sim-orbit',
  title = 'Planetary Gravitational Orbit',
): BeatManifest {
  let titleNode: Txt;
  let sunNode: Circle;
  let planetNode: Circle;

  const system = new DynamicalSystem(KeplerianOrbitModel);

  const runner = makeScene2D(function* (view) {
    const currentTheme = theme();

    titleNode = new Txt({
      text: title,
      fontSize: 48,
      fontWeight: 700,
      fill: currentTheme.ink,
      position: [0, -380],
    });

    sunNode = new Circle({
      size: 80,
      fill: '#f59e0b',
      position: [0, 0],
    });

    planetNode = new Circle({
      size: 32,
      fill: currentTheme.blue,
      position: [300, 0],
    });

    view.add([titleNode, sunNode, planetNode]);

    const totalFrames = 180;
    const dtPerFrame = 1 / 30;

    for (let frame = 0; frame <= totalFrames; frame++) {
      const time = frame * dtPerFrame;
      const sample = system.stateAtTime(time, 'nearest');
      planetNode.position([sample.state[0], sample.state[1]]);
      yield* waitFor(dtPerFrame);
    }
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [
      {id: 'title', node: titleNode as never, halo: 10},
      {id: 'sun', node: sunNode as never, halo: 20},
      {id: 'planet', node: planetNode as never, halo: 15},
    ],
    requiredIds: ['title', 'sun', 'planet'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}

/**
 * 3. Projectile Motion with Quadratic Air Drag
 *
 * Differential equation: m * r'' = m * g - 0.5 * rho * Cd * A * |v| * v
 * State vector: [x, y, vx, vy]
 */
export const ProjectileDragModel: SimulationModel = {
  id: 'sim-projectile-drag',
  revision: 1,
  dt: 0.005,
  initialState: [-400, 200, 220, -300], // Firing upward from bottom-left
  parameters: {
    g: 250, // Gravity down (+y)
    drag: 0.0015, // Drag coefficient factor
  },
  derivative: (_time, state, params) => {
    const vx = state[2];
    const vy = state[3];
    const speed = Math.sqrt(vx * vx + vy * vy);

    const ax = -params.drag * speed * vx;
    const ay = params.g - params.drag * speed * vy;

    return [vx, vy, ax, ay];
  },
};

/**
 * Creates a beat demonstrating projectile motion with realistic air resistance.
 */
export function createProjectileDragBeat(
  id = 'sim-projectile',
  title = 'Projectile Motion with Air Resistance',
): BeatManifest {
  let titleNode: Txt;
  let projectileNode: Circle;
  let groundLine: Line;

  const system = new DynamicalSystem(ProjectileDragModel);

  const runner = makeScene2D(function* (view) {
    const currentTheme = theme();

    titleNode = new Txt({
      text: title,
      fontSize: 48,
      fontWeight: 700,
      fill: currentTheme.ink,
      position: [0, -380],
    });

    groundLine = new Line({
      points: [
        [-500, 220],
        [500, 220],
      ],
      stroke: currentTheme.hairline,
      lineWidth: 3,
    });

    projectileNode = new Circle({
      size: 24,
      fill: currentTheme.coral,
      position: [-400, 200],
    });

    view.add([titleNode, groundLine, projectileNode]);

    const totalFrames = 150;
    const dtPerFrame = 1 / 30;

    for (let frame = 0; frame <= totalFrames; frame++) {
      const time = frame * dtPerFrame;
      const sample = system.stateAtTime(time, 'nearest');
      projectileNode.position([sample.state[0], sample.state[1]]);
      yield* waitFor(dtPerFrame);
    }
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [
      {id: 'title', node: titleNode as never, halo: 10},
      {id: 'projectile', node: projectileNode as never, halo: 10},
    ],
    requiredIds: ['title', 'projectile'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}
