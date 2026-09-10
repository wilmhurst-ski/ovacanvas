# ADR-002: General 3D Scene and Rendering Substrate

- **Status:** Accepted
- **Date:** 2026-09-10
- **Applies to:** `@ovacanvas/2d`, `@ovacanvas/core`
- **Consumer:** Ovareel compiler and realization host
- **Supersedes:** Pure 2D lowering for projected 3D geometry; amends Ovareel
  ADR-010

---

## Context & Problem Statement

OvaCanvas previously contained a projection utility
(`packages/2d/src/lib/projection/`) providing model/view/projection
transformations, near-plane polygon clipping, optional back-face culling, and
deterministic painter ordering. While mathematically accurate on the CPU, its
visual realization in Ovareel required lowering projected faces and edges into
ordinary 2D `Path` or `Line` instances.

This produced fundamental runtime limitations:

1. **Lack of Depth Buffering:** Average-face or centroid painter sorting cannot
   resolve intersecting, interpenetrating, or non-convex mutually occluding
   triangles.
2. **Missing Shading Mechanics:** Surfaces were drawn as flat single-color lines
   or unshaded fills without hardware-rasterized per-vertex color interpolation,
   normal calculation, or lighting models (such as Lambert).
3. **Absence of Real 3D Primitives:** Points and lines lacked true 3D
   depth-testing against meshes.
4. **No Native Canvas2D Bridge:** There was no retained 3D scene node
   participating in OvaCanvas 2D transforms, opacity, layout, and rendering
   pipelines.

Ovareel already defines 3D objects, point sets, curves, parametric surfaces, and
cameras. However, the runtime substrate in OvaCanvas lacked depth-correct
rendering capabilities.

---

## Architectural Decisions

This record formalizes the ten foundational decisions governing the 3D
subsystem:

### 1. Subsystem Location and Packaging

The 3D scene and rendering substrate lives under `packages/2d/src/lib/scene3d/`
and is exported through `@ovacanvas/2d`. We do not introduce a separate
`@ovacanvas/3d` package in this mission, preventing package dependency cycles
and avoiding premature component system fragmentation.

### 2. Canvas2D Bridge Architecture

`Scene3D` is the bridge between the OvaCanvas Canvas2D scene graph and the
renderer-private WebGL2 pass. It extends `Layout` / `Shape`, participates in
normal 2D transforms, opacity, and clipping, borrows the shared WebGL2 context,
renders depth-buffered geometry to the GL canvas, and composites the completed
GL canvas into Canvas2D using `drawImage` during normal traversal. It renders
zero DOM overlays and creates no independent visible canvas.

### 3. Sole Time Authority

The existing OvaCanvas player remains the sole time authority. `Scene3D` has no
secondary animation clock, no internal `requestAnimationFrame` loop, and reads
zero wall-clock time. Camera motion, transforms, and material properties are
reactive OvaCanvas signals evaluated deterministically at the requested frame.

### 4. Shared WebGL Context Hardening and State Isolation

The existing `SharedWebGLContext` is reused and hardened by requesting a depth
buffer (`depth: true`).

- **State Reinitialization:** Rather than fragile snapshot saving and
  restoration, every `WebGLContextOwner` (`Shaders` and `Scene3DContextOwner`)
  explicitly establishes every WebGL state it depends on during `setup()`,
  including viewport, scissor test, depth test, depth func/mask, culling,
  blending, color mask, framebuffer/renderbuffer bindings, and texture units.
- **Teardown Contract:** `teardown()` releases owner-scoped resources (buffers,
  vertex arrays, textures) and disables exceptional states.
- **Single 3D Owner Per Scene:** To avoid continuous allocation and teardown
  across multiple `Scene3D` panels in a frame, panels in a scene pass through
  one retained 3D context owner with dynamic viewport and scene bindings.

### 5. Strict Encapsulation of WebGL Types

Public contracts expose only OvaCanvas-native types (`Vec3Like`,
`Transform3DSpec`, `TriangleGeometry3D`, `Camera3DSpec`, `PickResult3D`). No raw
WebGL handles (`WebGLBuffer`, `WebGLProgram`, `WebGLTexture`), shader locations,
or mutable GL context objects leak into public APIs.

### 6. Closed Material and Light Unions

Public materials form a finite tagged union:

- `unlit`: constant color or per-vertex color, opacity, face side policy
  (`front`, `back`, `double`).
- `lambert`: diffuse lighting with directional and ambient lights, per-vertex
  colors, opacity, face side policy. Public arbitrary GLSL shader strings are
  strictly excluded.

### 7. Compatibility with Existing Projection Utilities

The existing `packages/2d/src/lib/projection/` module remains completely intact
and backward compatible. Existing imports, tests, and outputs remain stable.

### 8. General Geometry Substrate vs. Pedagogical Semantics

The 3D subsystem is strictly general geometry infrastructure (vertices,
triangles, lines, points, transforms, camera, depth). Mathematical semantics,
equations, function sampling ($z = f(x,y)$), axis construction, tick generation,
contour solving, educational narration, themes, and pedagogical choreography
remain entirely the responsibility of Ovareel.

### 9. Explicit Diagnostics on WebGL Failure

If WebGL2 is unavailable or context loss occurs, the system produces an explicit
typed diagnostic (`WEBGL2_UNAVAILABLE` or `CONTEXT_LOST`). It never silently
degrades into an inaccurate or misleading Canvas2D wireframe fallback.

### 10. Terminal and Deterministic Resource Lifecycle

GPU resources (VBOs, IBOs, VAOs) are keyed by deterministic geometry
fingerprints. Unchanged buffers are reused across frames; modified geometry
updates only its resources. Component or scene disposal is terminal, idempotent,
and immediately releases all allocated GPU memory.

---

## Line Rendering Strategy (Thick Lines)

WebGL implementations across browser and platform backends (notably Windows
ANGLE/D3D) restrict native `gl.lineWidth` to `1.0`.

- Native hardware lines are supported with `lineWidth: 1.0` and depth testing.
- For lines requesting `lineWidth > 1.0`, geometry is lowered into camera-facing
  billboard triangle strips with depth testing.

---

## Consequences

### Positive

- **Depth Correctness:** Complex intersecting geometries, non-convex meshes, and
  mixed primitives (lines, points, surfaces) render with true hardware depth
  testing (`gl.DEPTH_TEST`).
- **Seamless Compositing:** `Scene3D` panels integrate naturally into existing
  2D animations, layouts, typography, and LaTeX callouts.
- **Zero Scope Invention:** The rendering core stays clean of domain-specific
  graphing or equation logic.
- **Robust Resource Lifecycle:** Geometry caching avoids per-frame GPU
  reallocations while guaranteeing total cleanup on scene disposal.

### Trade-offs

- The shared WebGL2 canvas requires depth buffer allocation (`depth: true`),
  adding minimal GPU memory overhead (~4 MB at 1080p).
- Transparent meshes require depth writes disabled and back-to-front sorting by
  object center, which is bounded and documented as not order-independent for
  mutually intersecting transparent polygons.
