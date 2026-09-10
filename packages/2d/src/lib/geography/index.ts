/**
 * Cartographic realization mechanics.
 *
 * @remarks
 * This module turns trusted geographic geometry into drawable canvas paths.
 * It is the renderer-private half of a map: it knows how to place a boundary
 * on a plate, and nothing at all about which boundaries matter.
 *
 * **What it owns.** Canonical longitude/latitude handling, the two admitted
 * cartographic projections, seam behaviour at the cut meridian, mechanical
 * route sampling, fitting a plate to a viewport, and projected geometry that
 * carries enough correspondence for someone else to check it.
 *
 * **What it must never own.** Which places matter, which route was intended,
 * what a region means, which value is authoritative, whether an interaction
 * is permitted, or whether the result is good. There are no colours, fonts,
 * labels, provider names or dataset identities anywhere in this module, and
 * there is no atlas: normalized geometry arrives already trusted.
 *
 * ## Decisions this module records
 *
 * **Cartographic projection is not camera projection.** The sibling
 * `projection` module projects a 3D scene through a camera. The two are
 * unrelated, and neither borrows the other's name or types, because the only
 * thing they share is an English word.
 *
 * **Two projections, admitted explicitly.** `EQUIRECTANGULAR` is the
 * baseline: linear in both axes, reaches both poles, and can be checked by
 * hand. `WEB_MERCATOR` is the familiar planar web map, and carries a latitude
 * limit rather than a clamp - a coordinate beyond it is refused, because
 * clamping would move a position the caller declared.
 *
 * **No live tiles, no map engine, no dependency.** V1 renders a deterministic
 * local vector plate using the scene primitives that already exist. A live
 * engine owning its own canvas, workers, tiles and idle events is a separate
 * lifecycle problem and is deferred pending an explicit decision; nothing
 * here is shaped to accommodate one, and there is no provider seam to fill.
 *
 * **The plate is projected once.** A caller that wants motion animates the
 * transform of the group it builds from a result, over geometry that does not
 * move underneath it. Nothing here reprojects per frame.
 *
 * **Seams are cut; viewports are not.** A shape crossing the plate's cut
 * meridian is genuinely split, because the alternative is a stripe across the
 * map. A shape leaving the viewport keeps every vertex it was given and is
 * merely labelled `CLIPPED`, because the renderer can clip exactly and this
 * module would have to invent boundary vertices that no coordinate
 * corresponds to.
 *
 * **What cannot be drawn is reported, not approximated.** A ring winding
 * around a pole needs its pieces closed along the pole edge as well as the
 * seam; drawn partially it smears across the whole plate. Such a ring is
 * returned in `unsupported`. A silently missing country is a wrong map that
 * looks right.
 *
 * @packageDocumentation
 *
 * @internal Not a public API. Names, shape and granularity are deliberately
 *           not frozen, and no dataset, provider or contract is implied.
 */

export * from './canonical';
export * from './project';
export * from './projection';
export * from './route';
export * from './seams';
export * from './types';
