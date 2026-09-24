import {
  describeComponent,
  formatType,
  getCatalogue,
  getComponent,
} from './catalogue/index.js';
import type {Catalogue} from './catalogue/types.js';
import {
  ANCHOR_SIDES,
  COMFORTABLE_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  SAFE_HALF_HEIGHT,
  SAFE_HALF_WIDTH,
} from './document/model.js';
import {KITS} from './kits/expand.js';

/**
 * Components worth describing up front in a prompt. Everything else in the
 * catalogue is still valid; a model with tools can describe it on demand.
 */
export const CORE_COMPONENTS = [
  'Txt',
  'Latex',
  'AnchoredLabel',
  'Rect',
  'Circle',
  'Line',
  'Layout',
  'Node',
] as const;

/**
 * The document format, written for a model.
 *
 * @remarks
 * Generated from the same constants and catalogue the validator uses, so it
 * cannot describe a rule the validator does not enforce or a name the
 * catalogue does not contain. It states what the format is and what the
 * checks are; it does not try to teach taste.
 */
export function documentReference(
  catalogue: Catalogue = getCatalogue(),
): string {
  return `# OvaCanvas scene documents

A scene ("beat") is one JSON document. You never write code: the document is validated against a catalogue read from the engine's own type declarations, then compiled into a beat module deterministically. Every problem comes back located on a node, prop or timeline step.

## Shape
{
  "version": 1,
  "title": "short title (not drawn)",
  "nodes": [ { "id": "eq", "component": "Latex", "props": { ... }, "parent"?: "id", "role"?: "title", "halo"?: 8 } ],
  "timeline": [ steps... ],
  "touches"?: [ { "a": "label", "b": "box", "reason": "the label names the box" } ]
}

- id: lower-camel identifier, unique ("title", "eqStep1"). It is the node's identity everywhere.
- component: a catalogue name (${Object.keys(catalogue.components).join(', ')}).
- parent: draw this node inside another; its position becomes relative to the parent's centre. Omit to place it on the stage.
- role: typographic role for text components (${catalogue.textRoles.join(', ')}); explicit fontSize/fontWeight still win.
- Document order is draw order: later nodes draw on top.

## Values
- vector: [x, y], {"x": x, "y": y}, or one number for both.
- colour: CSS string ("#2F66D0", "rgb(...)", named) or a theme token {"theme": "${catalogue.themeColors.join('" | "')}"}. Never "none" - omit the prop instead.
- node reference: {"ref": "id"} (e.g. an AnchoredLabel's anchor).
- endpoint: [x, y] or {"ref": "id", "side"?: "${ANCHOR_SIDES.join('" | "')}"} - a connector attached to a node follows it, and is automatically allowed to touch it.
- origin: ${catalogue.origins.map(o => `"${o}"`).join(', ')}.
- LaTeX goes in a Latex node's "tex" (no $ delimiters). Txt is for words only: math notation in a Txt is rejected.

## Timeline steps (run in order)
- {"kind": "wait", "seconds": 0.5}
- {"kind": "tween", "node": "id", "prop": "opacity", "to": 1, "seconds": 0.4, "easing"?: "easeInOutCubic"}
  Tweening a Latex's "tex" morphs matching glyphs; tweening a Line's "end" from 0 to 1 draws it.
- {"kind": "set", "node": "id", "prop": "text", "value": "..."}   (instant)
- {"kind": "all", "steps": [...]}                   (together; ends with the longest)
- {"kind": "sequence", "delay": 0.15, "steps": [...]} (staggered starts)
- {"kind": "chain", "steps": [...]}                  (one after another)
Easings: ${catalogue.easings.join(', ')}.

## Stage and rules
- The stage is 1920x1080 with (0, 0) at its centre. Keep content within x ±${SAFE_HALF_WIDTH}, y ±${SAFE_HALF_HEIGHT}; a title near y = -380 is conventional.
- A beat is judged, and first seen, at frame 0: the main content must be visible at frame 0. Fade in only secondary parts (start them at "opacity": 0).
- The whole timeline must be under ${MAX_BEAT_SECONDS}s (best under ${COMFORTABLE_BEAT_SECONDS}s). One beat is one held idea.
- Beats loop: do not fade everything out at the end.
- Animating position, x, y, scale, width, height or size sweeps the node across the stage; the audit checks mid-animation frames, so the path must be clear. Prefer opacity for entrances.
- Nothing may overlap unless declared in "touches" with a real reason ("*" as "b" for a genuine background panel). Children overlapping their parent, and connectors touching the nodes they attach to, are allowed automatically.
- Audit registration, required ids and safe areas are generated for you - there is nothing to register.
`;
}

/** Compact prop listings for the core components, for a one-shot prompt. */
export function coreComponentReference(
  catalogue: Catalogue = getCatalogue(),
  names: readonly string[] = CORE_COMPONENTS,
): string {
  const sections: string[] = [];
  for (const name of names) {
    const component = getComponent(name, catalogue);
    if (!component) continue;
    const description = describeComponent(component, {catalogue});
    const props = Object.entries(component.props)
      .filter(([, spec]) => spec.essential || spec.required)
      .map(([prop, spec]) => {
        const flags = [
          spec.required ? 'required' : '',
          spec.default !== undefined ? `default ${spec.default}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return `  - ${prop}: ${formatType(spec.type, catalogue)}${flags ? ` (${flags})` : ''}`;
      });
    sections.push(
      `${name}${description.summary ? ` - ${description.summary}` : ''}\n${props.join('\n')}`,
    );
  }
  return `## Core components (essential props; every other catalogue prop is also accepted)\n\n${sections.join('\n\n')}`;
}

/**
 * The kit layer, written for a model: every kit's fields, parts and example,
 * and the beat syntax that animates them. Generated from the kit specs.
 */
export function kitReference(): string {
  const kits = Object.values(KITS).map(kit => {
    const fields = Object.entries(kit.fields)
      .map(
        ([name, field]) =>
          `  - ${name}${field.required ? ' (required)' : ''}: ${field.type} - ${field.doc}`,
      )
      .join('\n');
    return `### ${kit.name}\n${kit.summary}\n${fields}\n  Parts for beats: ${kit.parts}\n  Example: ${JSON.stringify(kit.example)}`;
  });
  return `## Kits - prefer these
A node can be a kit instance instead of a single component: {"id": "fig", "kit": "<name>", ...fields}. One kit instance replaces dozens of nodes, and the kit places labels, arcs and spacing for you, clear of each other. Use plain components only for what no kit covers.

Which kit:
- a heading -> title
- shapes, angles, proofs about figures -> geometry.figure
- equations, algebra steps, a derivation -> derivation
- functions, rates, slopes, areas; data: bar charts, line charts, scatter plots (with a trend line or an average) -> plot
- processes, causes, cycles, hierarchies, "what leads to what" -> graph
- reasons, steps, key points in words -> list
- things that move: throws, falls, swings, orbits -> motion
- places: countries, borders, regions, continents, cities, trade or migration routes, a globe -> map
- 3D: surfaces z = f(x, y), landscapes of a loss or potential, paths on them, gradients and normals, helices -> graph3d
- a picture for an idea (house, database, thunder, factory) -> icon; several side by side, a flow, a cycle -> icons
- electric circuits: batteries, switches, lamps, resistors in series and parallel -> circuit
- cutting and rearranging shapes: dissection proofs, area by rearrangement, fractions of a whole, tangrams -> pieces
- any other picture of things placed relative to each other -> diagram: forces on a body (vectors, components), rays through lenses and mirrors, atoms, orbits and solar systems, molecules and lattices, arrays with pointers, sorting, stacks, queues, linked lists, containers and what is inside them. Describe where things are ("on" the slope, "around" the nucleus, "below" cell 3, the "component" of W "down slope", where two rays "meet") instead of working out coordinates - and never build such pictures from plain nodes.
Icons also go anywhere a thing is named: a graph node {"label": "Database", "icon": "database"}, a list point {"text": "...", "icon": "lock"}. Name them in plain words; add "symbol" for a schematic drawing ("battery symbol").
Put side-by-side kits in "left" and "right", a single big one in "full".

${kits.join('\n\n')}

## Beats - the timeline for kit documents
Instead of "timeline", give "beats": a list of moments, each a set of changes and then a hold.
{"show": "proof.1", "highlight": ["fig.ABC"], "trace": "fig.AB", "hide": "note", "morph": "eq.2", "set": {"graph.k": 3}, "focus": "graph.area0.2", "from": "fig.side.AB", "seconds": 1.2, "hold": 0.8, "pace": "quick" | "normal" | "slow", "keep": false}
- Targets are "<kitId>.<part>" or a plain node id. Plain nodes can also point at kit parts: {"ref": "fig.AB"} (e.g. a label anchored to a segment), and touches can name them.
- show fades in (anything shown by a beat starts hidden); hide fades out; trace draws a line; morph changes a morph-mode derivation to that step.
- A highlight lasts one beat, then clears (unless "keep": true).
- set changes kit fields, and the change animates: every kit is drawn from its fields, so the new drawing glides in and everything that depends on the field follows. {"set": {"graph.k": 3}} reshapes a curve that uses param k; {"set": {"graph.points.P.x": 2}} slides P along its curve (its label with it); {"set": {"graph.tangents.0.at": 2}} rolls a tangent along; {"set": {"graph.areas.0.rects": 20}} refines Riemann rectangles; {"set": {"fig.points.B": [4, 1]}} moves a vertex and its sides, angles and labels follow; {"set": {"proof.layout": "square"}} rearranges pieces. Keys are "<kitId>.<field>", dots going into objects and lists; a bare param name works ("graph.k"). Several keys in one set change together. A plain node prop works too: {"set": {"ball.position": [200, 0]}}.
- focus dims everything else in that figure until the focus moves on ("focus": false clears it) - walk through the bars of a sum, the parts of a diagram, one at a time. A formula beside the figure stays bright.
- from makes labels fly into the equation this beat shows or morphs: each label in the named parts (piece labels, side labels, point labels, a plot area's "measure" marks) whose maths reappears as a new term travels from the figure into its place in the equation. {"morph": "sum.1", "from": "graph.area0.measure0"} sends f(0.5) and \\\\Delta x from the bar into the sum; {"show": "eq.0", "from": "proof"} sends the squares' a^2, b^2, c^2 into c^2 = a^2 + b^2. Write the label and the term the same way.
- seconds sets how long this beat's changes take (0.2 to 5); a set defaults to 1s.
- To show a quantity changing, give the kit "params" and set them in beats, rather than drawing each state separately.
- Default hold 0.6s; pace sets how long each change takes (0.25 / 0.4 / 0.7s).
- Write as many beats as the explanation needs: past ${MAX_BEAT_SECONDS}s the document plays as a lesson (below), split into engine beats automatically.
- Place kits in regions ("left", "right", "full", "center", "top", "bottom") so they do not overlap.

${lessonReference()}`;
}

/** Lessons: explanations longer than one beat, for a model. */
export function lessonReference(): string {
  return `## Lessons - longer than one beat
An explanation can run as long as it needs. Keep writing short beats; they are split into engine beats of up to 5.8s, and each part starts exactly where the last one ended, so it plays as one continuous animation.

When the picture has to change, use scenes. Each scene has its own nodes and beats; "keep" carries nodes or kits from the scene before, in the state they were left in (what was shown stays shown), without writing them again:
{
  "version": 1,
  "title": "Why the Sahel is dry",
  "scenes": [
    {"nodes": [{"id": "heading", "kit": "title", "text": "..."}, {"id": "map", "kit": "map", "focus": "Africa", "highlight": {"Sahel": "yellow"}}],
     "beats": [{"hold": 0.6}, {"highlight": "map.Sahel", "hold": 1}]},
    {"keep": ["heading"],
     "nodes": [{"id": "why", "kit": "list", "region": "right", "items": [...]}, {"id": "globe", "kit": "map", "view": "globe", "region": "left", "focus": "Sahel"}],
     "beats": [{"show": "why.0"}, {"show": "why.1"}]}
  ]
}
- A scene starts fresh: anything not kept fades out as the next scene fades in.
- Every scene is judged on its own first frame, so something must be visible when it starts.
`;
}
