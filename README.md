# OvaCanvas

OvaCanvas is an interactive visual runtime for building deterministic,
computational and continuously evolving explanations in the browser.

It is a fork of [Motion Canvas][motion-canvas] that has been extended around
semantic identity, runtime authority, learner interaction, presentation
generations and reusable computational capabilities.

## Why this exists

Most animation tools are built to play back something that was decided in
advance. You write the animation, it runs, and the viewer watches it. That is
the right design for a video, and the wrong one for an explanation that has to
respond to the person receiving it.

OvaCanvas is built for the second case: one visual world that stays alive while
a learner pokes at it, changes their mind, asks a follow-up, and gets shown
something new — without the picture and the truth drifting apart. The hard part
turns out not to be drawing. It is knowing, at every moment, which of the three
things on screen is authoritative: the state the system has actually accepted,
the value a learner is provisionally holding while they drag something, and the
presentation currently being rendered. Conflating those is how interactive
explanations quietly start lying.

So the runtime keeps them separate and makes the boundaries explicit. Exploring
writes nothing. Committing goes through one narrow, generation-scoped path. A
replacement presentation is built offstage and refused if the world moved on
while it was being built. A retiring presentation loses its authority the
instant a new one takes over, even while both are still visible. None of this is
about graphics; it is about not being wrong in front of someone who is trying to
learn.

## What OvaCanvas provides

The scene system is inherited from Motion Canvas: TypeScript, generator-driven
animation, Canvas2D rendering, and a Vite-based development pipeline.

On top of that, OvaCanvas adds a runtime whose organising idea is that
**rendered objects are not the authority on what is true**:

- a deterministic runtime authority that owns accepted state, hands out
  generation-scoped write capabilities, and refuses stale writes;
- presentation generations that are prepared offstage, activated at a single
  atomic boundary, and retired terminally;
- semantic-target picking and pointer interaction over the scene graph;
- temporary learner exploration held as an overlay, separate from accepted
  state, so exploring changes nothing until it is deliberately committed;
- semantic continuity across generations — the same semantic id resolving to a
  different node object in a different presentation;
- runtime-constructed presentations, assembled while the application is running
  rather than imported from a build-time project module;
- revision-checked activation, so a presentation prepared against state the
  learner has since changed is refused rather than shown;
- bounded overlap between an outgoing and an incoming presentation;
- zero-idle scheduling: when nothing requires presentation work, the runtime
  requests no animation frames at all.

Alongside these are several self-contained computational capabilities used to
derive what a scene displays: relational graph layout, planar computational
geometry and polygon algebra, 3D projection with depth ordering, and
deterministic fixed-step numerical integration for dynamical state.

## Design philosophy

OvaCanvas owns visual realization and runtime behaviour. It does not define the
semantic truth of an explanation.

The architecture is intended to let a higher-level system drive one persistent
interactive visual world without treating renderer objects as semantic
authority. That is why accepted state, the provisional value a learner is
holding, and the thing currently on screen are three separate concerns with
three separate owners — and why reaching quiescence never means silently
accepting what a learner had not accepted.

## Authoring beats: `@ovacanvas/wire`

A beat is authored as a **scene document** - plain JSON - never as code. This is
the ManimWire approach (a typed graph compiled deterministically to code)
applied to OvaCanvas. It exists because models writing scene code directly kept
failing on the same low-level mistakes: invented props and exports, wrong import
packages, positional constructor arguments, `[x, y]` coordinates widened to
`number[]`, `fill: "none"`, and missing or one-sided `mayTouch` registration.

```text
document.json --validate--> located issues (node / prop / step, with "did you mean")
      |
      +--generate--> beat module (.ts) --tsc backstop--> host gate: render, audit, repair, motion check
```

- **Catalogue** - every component, prop, type, default, easing, theme colour and
  text role is extracted from the compiled `@ovacanvas/2d` and `@ovacanvas/core`
  declarations (`npm run wire:catalogue`). A test fails if the checked-in
  catalogue drifts from the engine.
- **Validator** - checks the document against the catalogue and the host's beat
  rules (6 s cap, content visible at frame 0, plain-text math, empty text,
  reference sides and parent spaces, touches with reasons, ...). Every issue is
  located.
- **Generator** - deterministic TypeScript: one props object per constructor,
  inline vector literals, nodes re-created on every scene run, `buildAuditSpec`
  with every node registered, declared touches written on both sides, connectors
  automatically allowed to touch what they attach to, and `requiredIds` limited
  to what is visible at frame 0. A source map attributes any compiler error back
  to a node or step.
- **Preview** - renders a document in headless Chromium through the real
  `LessonHost` gate and returns the audit findings, every node's real position
  and bounds, any positions the host's mechanical repair had to change, and
  frames as PNG.
- **MCP server** - the whole loop as tools for an agent (below).
- **Studio** - the learner app's general path is now the `scene-document`
  strategy: the model returns a document, wire validates it, and located issues
  go back through the existing retry loop. `OVACANVAS_STRATEGY=full-code-gen`
  switches back to full code generation for comparison.

A document looks like this (`packages/wire/examples/` has complete ones):

```json
{
  "version": 1,
  "title": "Solving 2x + 3 = 11",
  "nodes": [
    {
      "id": "title",
      "component": "Txt",
      "role": "title",
      "props": {"text": "Solve for x", "position": [0, -380]}
    },
    {
      "id": "equation",
      "component": "Latex",
      "props": {"tex": "2x + 3 = 11", "fontSize": 72}
    },
    {
      "id": "note",
      "component": "AnchoredLabel",
      "props": {
        "anchor": {"ref": "equation"},
        "origin": "Bottom",
        "distance": 110,
        "text": "subtract 3",
        "opacity": 0
      }
    }
  ],
  "timeline": [
    {
      "kind": "tween",
      "node": "note",
      "prop": "opacity",
      "to": 1,
      "seconds": 0.3
    },
    {
      "kind": "tween",
      "node": "equation",
      "prop": "tex",
      "to": "2x = 8",
      "seconds": 1
    }
  ]
}
```

### Kits and beats

Plain nodes make a model spell out every detail by hand - each segment, each
label position, each fade. **Kits** are the layer above: one kit instance stands
for a whole structure, and its expander owns the layout models get wrong (label
placement clear of lines, arc angles, spacing, audit authorizations). **Beats**
replace a raw timeline with moments: `show`, `highlight`, `trace`, `morph`, then
a hold.

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "fig",
      "kit": "geometry.figure",
      "region": "left",
      "points": {"A": [0, 3], "B": [4, 3], "C": [0, 0]},
      "segments": "AB BC CA",
      "rightAngles": ["BAC"]
    },
    {
      "id": "proof",
      "kit": "derivation",
      "region": "right",
      "steps": [
        {"tex": "a^2 + b^2 = c^2"},
        {"tex": "3^2 + 4^2 = 25", "why": "\\text{legs } 3, 4"},
        {"tex": "c = 5"}
      ]
    }
  ],
  "beats": [
    {"hold": 0.5},
    {"highlight": "fig.ABC", "show": "proof.1"},
    {"show": "proof.2", "hold": 1}
  ]
}
```

Kits expand into ordinary nodes before validation, code generation and the
audit, and every issue is reported on what was written: the kit and its field,
or the beat. Plain nodes can still be mixed in and can point at kit parts
(`{"ref": "fig.AB"}`).

| Kit               | What a model writes                                    | What the kit handles                                                                        |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `title`           | a heading and subtitle                                 | position and type scale                                                                     |
| `geometry.figure` | named points, segments, angles, side labels            | scaling, letters and angle labels clear of lines, arcs, crossings, marks                    |
| `derivation`      | equation steps (`stack`, `flow` or `morph`), colours   | row heights, fitting, terms that travel between steps, lines aligned on `=`                 |
| `plot`            | functions, points, tangents, areas; bars, lines, dots  | a safe expression parser, axes and ticks, category axes, keys, clipping, Riemann bars, labels |
| `graph`           | nodes and `"a->b: label"` edges, a layout              | dagre flow/tree, cycle, hub and grid layouts, box sizes, arrow sides, labels                |
| `list`            | points or steps in words                               | wrapping, stacking, numbering                                                               |
| `motion`          | a projectile, fall, pendulum or orbit, with physics    | the trajectory, equal-time motion, and `play` in a beat                                     |
| `map`             | countries, regions and cities by name, routes, a globe | true borders, framing, projection, labels inside shapes, great-circle routes                |
| `graph3d`         | a surface `z = f(x, y)`, paths, points, vectors        | sampling, colour maps, a camera that keeps marked points in view, ticks, orbit              |
| `icon` / `icons`  | an idea in plain words: "house", "thunder", "db"       | 1,848 icons found by name, tag or synonym; badges, rows, flows with arrows, tracing         |
| `circuit`         | parts and one line: `"B1 - S1 - (R1 \| L1)"`           | a textbook schematic, junctions, current flow, lamps that light, open switches that stop it |
| `pieces`          | where each piece is in each arrangement                | solid slides and turns, copies peeling off a match, one frame for every arrangement         |
| `diagram`         | parts placed by relation: on, around, below, inside    | resting and riding, vectors and components, rays and meets, groups with identity, templates, labels |

Beats act on kit parts (`"fig.ABC"`, `"graph.f"`, `"map.Nigeria"`,
`"plot.path"`) or a whole kit (`"play": "throw"`, `"show": "steps"`). LaTeX
whose backslashes a JSON escape swallowed (`"\frac"` written with one backslash)
is repaired with a warning instead of failing.

**Choreography.** Every kit is a function of its fields, so change is one more
beat: `{"set": {"graph.k": 3}}`. The kit is drawn again from the new fields and
the difference is animated - positions, points, colours and equations glide, new
parts fade in as the change settles, dropped ones fade out first, turns take the
short way. Where a quantity does not move in a straight line as the field
changes (a sine wave as its frequency grows, a tangent rolling along a curve, an
angle arc as a vertex moves) the drawing is sampled along the way, so every
frame in between is a true drawing. Kits that fit their content fit every state
the beats visit, so the frame holds still. `params` make figures into functions
(`"a*sin(k*x)"`, a corner at `["a+b", 0]`); `focus` dims the rest of a figure
while one part is discussed; the `pieces` kit moves same-shaped pieces as solid
bodies and peels copies off a matching piece; derivations split equations into
terms the engine can match - checked against the engine's own MathJax setup
before use - so terms travel between steps, and in `flow` mode each new line
comes out of the line above, lined up on its relation. `"from"` on a beat makes
labels fly into the equation it shows or morphs: a label whose maths reappears
as a new term (`f(0.5)` beside a bar, `c^2` in a square) travels into its place
and lands as the term appears. wire finds that place itself - MathJax, set up as
the engine sets it up, gives every glyph's position inside the equation - so the
flight lands on the exact pixels with no engine change and no tagging. The
examples `pythagoras-rearrange`, `riemann-sum` and `am-gm-flow` rebuild
Monocurl's geometry-proof, Riemann-sum and tagged-TeX demos in 1,586, 1,135 and
532 characters of JSON (the Monocurl sources are 3,606, 4,542 and 7,150
characters of code).

**Lessons.** An explanation is not limited to one 6 s beat. Write as many beats
as it needs and `compileLesson` splits them into engine beats of up to 5.8 s,
each starting on the exact frame the last one ended on (measured: identical
pixels at every boundary), so the host's crossfade between them is invisible.
When the picture has to change, a lesson has `scenes`, and `"keep": ["map"]`
carries a kit into the next scene in the state it was left in. The host's
`LessonPlayer` stages each part offstage while the one before it plays and
advances on the last frame; `render_scene` renders and audits every part, and
the studio plays a generated lesson straight through.

**Icons.** Anything a model names can carry a picture: an `icon` kit, a row or
flow of `icons`, an `"icon"` on a graph node or a list point. The vocabulary is
Lucide's 1,848 line icons (ISC, `packages/wire/data/LICENSE-lucide.txt`) plus
schematic symbol families (44 electrical and logic symbols with terminals, in
`src/icons/symbols.ts`; another domain is another table). Names resolve by exact
name, then symbol, everyday synonym and tag, so "thunder", "db" and "power
plant" all find something and a miss comes back with the nearest real names.
Icons are converted once (`scripts/build-icons.mjs`) into explicit absolute
paths, because the engine's path code misreads compact arc flags, smooth curves
after a move and arcs a hair too narrow; `scripts/check-icons.mjs` draws all
1,848 through the engine and against the original SVG in Chromium and lists any
that differ.

**Measured layout.** Kits place text by what will be drawn, not by rules of
thumb. The engine draws text in its own embedded variable Roboto
(`packages/2d/src/lib/theme/fonts`, SIL OFL; registered by `loadEngineFonts()`
before any beat renders), so text is the same width on every machine - before,
text nodes asked for Roboto but nothing loaded it, and each machine drew
whatever it had. wire measures text with the same font (fontkit, TTF copies made
by `scripts/embed-measure-fonts.mjs`) and equations with MathJax set up as the
engine sets it up; a browser test holds both to within a few pixels of the
rendered boxes. The audit now judges a text node by the text it draws (plus a
tenth of an em for overhanging glyphs) rather than its render cache, which is
padded half an em each side and used to refuse labels that did not touch.

**Diagrams.** The special kits each own one subject; `diagram` holds what they
have in common, so a subject no kit was built for is still a few lines, not a
page of coordinates. A part is one thing - a box, circle, ring, ellipse, dot,
polygon, line, arrow, ray, words, an icon, or a row, column, grid or set of
items - placed by relation: a block `"on"` a slope sits on it, turned with it; a
planet `"on"` an orbit rides it; `"below": "cells.3"`, `"inside": "box"`. Arrows
can be vectors in words (`"dir": "down slope"`, `"out slope"`) or components of
other vectors, worked out for you; points can be constructions (`{"meet":
["r1", "r2"]}`, `foot`, `mid`, `mirror`), and coordinates can refer to parts
(`["lens.x", "tip.y"]`). Items keep their identity, so setting a list to new
values moves them (a sort, a push onto a stack), and a template - `"define"`
once, `"use"` many times, with params - makes molecules, atoms in a molecule
or a lattice that melts into a liquid. Everything is fitted to its region,
labels are placed clear of every shape, line and label (smaller, or on a paper
patch over a thin line, when space is tight), shapes may overlap by design and
words are drawn on top. None of it knows a subject: atoms and solar systems,
ramps and pulleys, lenses and mirrors, arrays and linked lists are the same
few ideas. Charts are data against axes, so they are part of `plot`: `bars`
on named categories, `lines` and `dots` on numbers, a key for several series,
values on the bars, and a trend line or average from an ordinary function.

**Engine values.** Data too large to write - a country's boundary, a 3D world -
is named inside a JSON prop,
`{"$engine": "countryFeature", "args": ["Nigeria"]}`, and the generated module
calls the engine's helper. Names are allowlisted and every country is checked
against the boundary data before any code is generated.

`packages/wire/examples/geometry-proof.ovw.json` is ovareel's 37,527-character
`geometry-proof.json` rebuilt with kits: about 1,300 characters, and it passes
the full audit.

### MCP server

`packages/wire/lib/mcp/cli.js` is an MCP server over stdio. It is registered for
Claude Code in [`.mcp.json`](./.mcp.json), with scenes saved under `scenes/`.
For another client:

```bash
node packages/wire/lib/mcp/cli.js --workspace <directory for scene files>
```

| Tool                 | What it does                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `reference`          | The document format, value forms, timeline steps, stage rules and core components.           |
| `list_components`    | Every kit and catalogue component (optionally filtered).                                     |
| `describe_component` | A kit's fields, parts and example, or a component's props and accepted values.               |
| `create_scene`       | A new empty scene, optionally saved to a `.ovw.json` file after every change.                |
| `open_scene`         | Load a `.ovw.json` scene.                                                                    |
| `edit_scene`         | Apply a batch of edit ops **atomically**; a batch that would add an error is refused whole.  |
| `get_scene`          | The current document.                                                                        |
| `save_scene`         | Save to a file.                                                                              |
| `validate`           | Located issues for a scene or an inline document.                                            |
| `generate_code`      | The beat module, typechecked against the engine, optionally written to a `.ts` file.         |
| `render_scene`       | Render through the real host gate: pass/fail, findings (also before repair), layout, frames. |
| `apply_adjustments`  | Write the positions the host's repair moved nodes to back into the scene.                    |

Because an edit that introduces an error is refused, the working scene can never
contain an invented component, prop, easing, theme token or reference.

## Project status

The runtime foundation (authority, interaction, transitions, capabilities) is
implemented and covered by unit tests. The authoring layer (`host`, `studio`,
`wire`) works end to end offline: documents validate, generate, typecheck,
render and pass the real audit in a headless browser. It has **not** yet been
measured against live models - the scene-document strategy's first-attempt rate
with a real provider is the next number to collect (`npm run corpus`).

This project has not been proven in production use.

## Development

```bash
npm install
npm run build      # core -> 2d -> host -> wire, in dependency order
npm test           # every package's unit suite (wire's includes a real-browser render)
```

| Package    | Description                                                                     |
| ---------- | ------------------------------------------------------------------------------- |
| `core`     | Runtime authority, playback, signals, capabilities.                             |
| `2d`       | The 2D scene system, components, audit and interaction.                         |
| `host`     | Beat staging: offstage render, geometry audit, mechanical repair, lessons.      |
| `wire`     | Scene documents: catalogue, validator, generator, preview renderer, MCP server. |
| `studio`   | The learner app: ask a question, get an audited beat (`npm run studio:dev`).    |
| `internal` | Build helpers used by `core` and `2d`.                                          |

Individual suites: `npm run core:test`, `2d:test`, `host:test`, `wire:test`,
`studio:test`. Set `OVC_SKIP_BROWSER=1` to skip wire's browser test.

The studio needs a provider key (`GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, ...) in
`packages/studio/.env.local` or the environment - see
`packages/studio/src/providers.ts`. Note that Vite also reads keys from the
system environment, so a globally set key is used even without `.env.local`.

## Where this copy came from

This folder consolidates several scattered copies of the fork. It was built from
`Desktop/mvp2/ovacanvas` at commit `e5c1af7` - the only copy with committed
progress past the shared `e2e55cb` base, and the only one with the learner app.
Removed on purpose:

- `ui`, `player`, `template`, `vite-plugin`, `e2e` and `2d/src/editor` - the
  inherited Motion Canvas editor toolchain, which neither the learner app nor
  the authoring pipeline uses. They remain in `Desktop/mvp2/ovacanvas`.
- Hard-coded provider keys (`tools/test-apmix-*.mjs`) and `.env.local` files,
  scratch output, corpus results and build artifacts.
- Upstream changelogs, contribution files, git hooks and CI configuration.

## Upstream and attribution

OvaCanvas began as a fork of **Motion Canvas**, created by aarthificial and its
contributors:

<https://github.com/motion-canvas/motion-canvas>

Motion Canvas is MIT licensed. A substantial part of this repository is upstream
Motion Canvas code, and OvaCanvas preserves the applicable upstream copyright
and license notices. The upstream copyright notice remains in
[LICENSE](./LICENSE) alongside OvaCanvas's own. The scene-document design in
`packages/wire` follows [ManimWire](https://github.com/Sidsector9/ManimWire)'s
architecture; no ManimWire code is included.

## License

MIT — see [LICENSE](./LICENSE).

[motion-canvas]: https://github.com/motion-canvas/motion-canvas
