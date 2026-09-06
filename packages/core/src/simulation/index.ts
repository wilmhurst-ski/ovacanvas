/**
 * Deterministic fixed-step numerical integration and derived dynamical state.
 *
 * @remarks
 * Internal capability primitives. Nothing here is a frozen public API, and
 * nothing here is authoritative: a trajectory is derived state that can
 * always be recomputed from its model.
 *
 * @packageDocumentation
 */

export * from './DynamicalSystem';
export * from './rk4';
export * from './types';
