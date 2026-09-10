/**
 * Cartographic realization mechanics and geographic scene graph capability.
 *
 * @remarks
 * This module turns trusted geographic geometry into drawable scene content.
 * It is the renderer-private half of a map: it knows how to place a boundary
 * on a plate, and nothing about which boundaries matter.
 *
 * Projection is backed by `d3-geo` as a renderer-private computational
 * kernel, per ADR-001. Every mutable D3 projection object, stream, accessor
 * and configuration detail stays behind this boundary; what crosses it is the
 * declarative vocabulary in `public/types`, and nothing else.
 *
 * **One vocabulary.** `public/types` is the single set of geographic types.
 * An earlier dependency-free kernel here defined a parallel set - its own
 * `GeoPoint`, `GeoBounds`, projection and route enums - which left two
 * spellings of the same concept live at once and two different answers to
 * whether an antimeridian crossing had to be declared. It is superseded by
 * the d3 kernel, which is strictly more capable: it projects the
 * pole-enclosing rings the old one had to refuse, inverts screen coordinates
 * back to geographic ones, and admits five projections rather than two.
 *
 * @packageDocumentation
 *
 * @internal Not a public API. Names, shape and granularity are deliberately
 *           not frozen, and no dataset, provider or contract is implied.
 */

export * from './labels/mapLabelPlacement';
export * from './nodes';
export * from './public/fingerprint';
export * from './public/types';
export * from './routes/rhumb';
export * from './routes/routeGenerator';
