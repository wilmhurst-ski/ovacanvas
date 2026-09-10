# ADR-001: Adoption of `d3-geo` as Renderer-Private Cartographic Kernel

- **Status:** Accepted
- **Date:** 2026-09-10
- **Authors:** OvaCanvas Core Team & Director of Architecture
- **Applies to:** `@ovacanvas/2d`
- **Consumer:** Ovareel compiler and realization host
- **Supersedes:** Commit `b9d4182` no-dependency geographic constraint; amends
  Ovareel ADR-010

---

## Context & Problem Statement

OvaCanvas commit `b9d4182` introduced an initial renderer-private geographic
projection module under `packages/2d/src/lib/geography/` with zero external
dependencies. While this bounded implementation proved valuable for validating
coordinate typing, antimeridian seam splitting, and basic polyline rendering, it
demonstrated fundamental cartographic limitations during complex real-world map
recreation:

1. **Projection Scope:** Admitted only two cylindrical projections
   (`EQUIRECTANGULAR` and `WEB_MERCATOR`). Lacked orthographic globe
   projections, three-axis spherical rotations, and aspect control.
2. **Clipping & Spherical Mathematics:** Lacked small-circle / hemisphere
   clipping and adaptive segment resampling. Polygons enclosing a pole were
   rejected as `POLAR_RING_UNSUPPORTED`.
3. **Compound Paths & Holes:** Output was reduced to disconnected planar
   polylines drawn as separate `Line` instances, failing to reliably render
   compound polygons with holes as unified geographic paths.
4. **Scene Integration:** Lacked first-class geographic scene nodes (`GeoMap`,
   `GeoPath`, `GeoRoute`, `GeoGraticule`, `GeoSphere`) capable of reactive
   reprojection, viewport fitting, inspection, and caching.

Extending the custom mathematics piece-by-piece to match mature cartographic
standards would reinvent decades of spherical trigonometry and projection
algorithms while incurring substantial ongoing maintenance risk.

---

## Decision

We adopt `d3-geo` as an internal, renderer-private computational dependency of
`@ovacanvas/2d`.

### Architectural Boundary & Separation of Responsibilities

1. **Strict Encapsulation:** All D3 types, mutable projection objects, streams,
   accessors, and configuration details remain strictly private to
   `@ovacanvas/2d`. No D3 types or instances leak into public OvaCanvas APIs,
   TypeScript definitions, or Ovareel compiler contracts.
2. **OvaCanvas Ownership:** OvaCanvas owns:
   - Public geographic contracts (`GeoProjectionSpec`, `GeoFeatureSource`,
     `GeoRouteSpec`, `GeoPoint`, `GeoBounds`);
   - Geographic scene graph nodes (`GeoMap`, `GeoPath`, `GeoRoute`, `GeoMarker`,
     `GeoGraticule`, `GeoSphere`);
   - Reactive projection state and signal invalidation;
   - Generation-scoped caching and terminal resource disposal;
   - Canvas2D rendering, compound path rasterization, hit-testing, and spatial
     picking;
   - Deterministic integration with the OvaCanvas animation clock and
     scheduling.
3. **`d3-geo` Kernel Responsibilities:** `d3-geo` operates purely as a
   synchronous computational kernel providing:
   - Spherical GeoJSON streaming and adaptive resampling;
   - Radian-degree conversions and three-axis spherical rotation;
   - Spherical pre-clipping (antimeridian and small circle) and planar
     post-clipping;
   - Projection mathematics (Equirectangular, Mercator, Orthographic, Equal
     Earth, Natural Earth 1);
   - Projection fitting into viewports;
   - Spherical shape generators (graticule, sphere outline);
   - Spherical trigonometry (distance, interpolation, area, bounds, centroid,
     containment).
4. **Single Migration Path:** The previous custom projection engine in
   `packages/2d/src/lib/geography/` will not remain as a competing or
   alternative engine. Existing entry points (such as `projectPlate`) will be
   migrated into one-way adapters delegating to the unified D3 adapter pipeline
   before being fully retired.
5. **Ovareel Consumer Contract:** Ovareel defines semantic map intent, atlas
   bindings, and board choreography. Ovareel artifacts must never contain D3
   projection instances, callbacks, streams, or renderer commands.

---

## Dependency Provenance & Audit Facts

| Attribute                   | Specification         | Evidence / Verification                                                      |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| **Package**                 | `d3-geo`              | Version `3.1.1` (pinned exact)                                               |
| **License**                 | ISC                   | Permissive, compatible with OvaCanvas MIT license                            |
| **Transitive Dependencies** | `d3-array@3.2.4`      | Version range `2.5.0 - 3`, ISC licensed, zero sub-dependencies               |
| **Module Format**           | Pure ESM              | Declares `"type": "module"`, `"sideEffects": false`                          |
| **Bundle Impact**           | ~227.1 kB unpacked    | Minified + gzip impact estimated at ~18–25 kB                                |
| **Runtime Requirements**    | Pure JavaScript       | Zero DOM, Canvas, WebGL, WebWorker, or Timer dependencies                    |
| **Browser Compatibility**   | Modern ESM            | Chrome/Chromium, Firefox, Safari/WebKit, Edge, Node.js >= 12                 |
| **Typing Strategy**         | Internal declarations | Private `d3-geo.d.ts` inside adapter directory; zero external `@types` leaks |

---

## Consequences

### Positive

- **Instant Cartographic Maturity:** Immediate support for orthographic globes,
  spherical rotations, graticules, sphere outlines, and hemisphere clipping.
- **Robust Compound Paths:** Complex geographic polygons with holes and
  multipolygons render cleanly into native `Path2D` instances via Canvas context
  sinks.
- **True Route Semantics:** Authoritative great-circle geodesic curves and
  constant-bearing rhumb lines with accurate spherical distance measurements.
- **Zero Public Leakage:** Consuming applications and compilers interact solely
  with native OvaCanvas types.
- **Elimination of Unsupported Rings:** Polar-enclosing rings (e.g. Antarctica)
  are correctly handled by spherical clipping rather than rejected.

### Negative / Trade-offs

- Adds one direct dependency (`d3-geo`) and one transitive dependency
  (`d3-array`) to `@ovacanvas/2d`.
- Requires careful adapter design to instantiate fresh, private D3 projection
  instances and prevent mutable state contamination across scene graph nodes.
