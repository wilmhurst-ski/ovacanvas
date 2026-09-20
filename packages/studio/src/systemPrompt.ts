import * as fs from 'fs';
import {createRequire} from 'module';
import * as path from 'path';

/**
 * The authoring system prompt, with its "what APIs exist" section generated
 * from the engine's real compiled declarations.
 *
 * @remarks
 * The generated section is the whole point. A hand-maintained list of exports
 * goes stale the moment the engine changes, and a stale list is exactly how a
 * model ends up confidently calling a function that does not exist. Deriving
 * it from the built `.d.ts` at generation time makes that class of
 * hallucination structurally impossible to *introduce* by documentation -
 * every name the prompt asserts is one the compiler will accept.
 *
 * The teaching half below is deliberately domain-neutral: it describes the
 * module contract and the audit's authorization model, not any particular
 * subject. Anything topic-specific belongs in the model's own judgment.
 */

/** Path segments excluded from the generated list. */
const EXCLUDED_PATH_SEGMENTS = ['/audit/', '/scene3d/'];

function resolvePackageDir(spec: string, fromDir: string): string {
  const require = createRequire(path.join(fromDir, 'index.js'));
  const entry = require.resolve(spec);
  let dir = fs.realpathSync(path.dirname(entry));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir)
      {throw new Error(`could not locate package root for ${spec}`);}
    dir = parent;
  }
  return dir;
}

/**
 * Every named, runtime-usable export a package's declaration file declares.
 *
 * @remarks
 * Filtered to values - classes, functions, consts a scene can literally
 * import and call - not the type-only interfaces and aliases that exist to
 * type-check other code. `/audit/` is excluded even though every name under
 * it is a real export: those are the audit engine's own internals, and a
 * scene never calls them (it *returns* an audit spec for the host to check).
 * Listing them as available APIs would recreate the original hallucination
 * problem with real names instead of fake ones.
 */
function exportedNames(
  packageDir: string,
  entryFile: string,
  ts: typeof import('typescript'),
): string[] {
  const declPath = path.join(packageDir, entryFile);
  const program = ts.createProgram([declPath], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declPath);
  if (!source) return [];
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];

  return checker
    .getExportsOfModule(moduleSymbol)
    .filter(symbol => (symbol.flags & ts.SymbolFlags.Value) !== 0)
    .filter(symbol => {
      const file = symbol.declarations?.[0]?.getSourceFile().fileName ?? '';
      return !EXCLUDED_PATH_SEGMENTS.some(segment => file.includes(segment));
    })
    .map(symbol => symbol.getName())
    .filter(name => !name.startsWith('_') && name !== 'default')
    .sort((a, b) => a.localeCompare(b));
}

/** Where to resolve the engine's own installed declarations from. */
export interface ApiSectionOptions {
  /** A directory whose module resolution can reach `@ovacanvas/2d` and `@ovacanvas/core`. */
  readonly resolveFrom: string;
}

export function buildVerifiedApiSection(options: ApiSectionOptions): string {
  let ts: typeof import('typescript');
  let twoD: string[];
  let core: string[];
  try {
    const hostDir = resolvePackageDir('@ovacanvas/host', options.resolveFrom);
    ts = createRequire(path.join(hostDir, 'index.js'))('typescript');
    twoD = exportedNames(
      resolvePackageDir('@ovacanvas/2d', options.resolveFrom),
      path.join('lib', 'index.d.ts'),
      ts,
    );
    core = exportedNames(
      resolvePackageDir('@ovacanvas/core', options.resolveFrom),
      path.join('lib', 'index.d.ts'),
      ts,
    );
  } catch (error) {
    // Fail soft, but NOT silently. If the declarations cannot be read (a build
    // has not run), the prompt still works - it just loses the drift
    // protection, which is the one thing standing between the model and a
    // confidently invented API name. Degrading quietly would mean the
    // protection was absent and nobody knew, which is the same shape of
    // failure as a swallowed exception: the symptom would show up later as
    // hallucinated API calls, with nothing pointing back here.
    // eslint-disable-next-line no-console
    console.warn(
      `[ovacanvas] verified-API prompt section unavailable (${options.resolveFrom}): ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        'Authoring will continue without it, so the model has no verified export list.',
    );
    return '';
  }

  if (twoD.length === 0 && core.length === 0) return '';

  return [
    "VERIFIED CURRENT EXPORTS - generated from the packages' real `lib/*.d.ts` at the moment this prompt was",
    'built, not written by hand. Every name below is a real export the TypeScript compiler will accept. If a name',
    'is NOT in this list and not in the API notes above, it does not exist - do not use it.',
    `- '@ovacanvas/2d': ${twoD.join(', ')}`,
    `- '@ovacanvas/core': ${core.join(', ')}`,
  ].join('\n');
}

const MODULE_CONTRACT = `You write ONE beat of a visual lesson for the OvaCanvas engine (a TypeScript scene engine). Output ONLY a single TypeScript module. No prose, no explanation, no markdown fences.

REQUIRED SHAPE - exactly this, or the beat is rejected:

  import {Txt, Rect, Circle, Line, Latex, makeScene2D, theme} from '@ovacanvas/2d';
  import {BBox, waitFor, all, easeInOutCubic} from '@ovacanvas/core';

  let title: Txt;   // declare one "let" for EVERY node you need to reference below

  export default makeScene2D(function* (view) {
    title = new Txt({text: '...', fontSize: 48, fontWeight: 700, position: [0, -420]});
    view.add(title);
    // ...build the rest of the scene and add it to view...
    yield* waitFor(1.5);
  });

  export function buildAuditSpec() {
    return {
      items: [
        {id: 'title', node: title, halo: 10},
        // ...one entry per node you declared a "let" for, each with a unique id...
      ],
      requiredIds: ['title' /* every id that must be visible by the end */],
      safeArea: new BBox(60, 60, 1800, 960),
    };
  }

The module is executed in a browser. Its default export is the scene generator and its buildAuditSpec() is called by the host AFTER the scene has rendered, to check real geometry. The host then audits what you drew against its own rules; a beat that fails is never shown to the learner.

COORDINATES - scene space, not pixels from a corner. The canvas is 1920x1080 with (0,0) at its CENTRE. The safe area is roughly x in -900..900 and y in -480..480; a title at [0, -420] is conventional. Every node's position prop takes [x, y] or {x, y}.

REGISTER EVERY VISIBLE NODE in buildAuditSpec. A node that draws something but has no item entry fails the beat. Give each item a halo (allowed padding in px, 0-10 typical).

INTENTIONAL CONTACT needs authorization. The audit reports any two registered items whose boxes overlap, so a label that is supposed to sit on the shape it names, an edge that is supposed to meet its two nodes, or a background panel everything is drawn on top of, must be declared with mayTouch on BOTH sides, each with a real reason:

  {id: 'label', node: label, halo: 6, mayTouch: new Map([['box', 'label names this box']])}

A background/container shape that legitimately contains other content can authorize everything at once with mayTouch: new Map([['*', 'background panel other content sits on']]) - but only for a genuine background, never to wave away an overlap between two things that were never meant to touch. Every mayTouch entry needs a non-empty reason; a blank one is treated as no authorization at all.

PLACEMENT - do not hand-pick coordinates for a group of related items and hope. Declare the relationship and let the engine place them:
- A label that belongs beside a point or node: AnchoredLabel with {anchor, origin, distance} (or AnchoredLatex for maths). It follows the anchor if the anchor moves.
- Several cards or labels that must not overlap: arrangeWithoutOverlap(items) with each item's desired {id, x, y, width, height}, and use the positions it returns.
- N items around a focal point: distributeOrbiting(count, {center, radius}).
Computing an exact coordinate from a known value is fine. GUESSING one to avoid a neighbour is how beats get rejected.

MOTION - any signal-backed prop can be animated, and every yield* blocks until that step finishes:
- yield* node.position([x, y], seconds, easeInOutCubic)
- yield* node.opacity(1, seconds)
- yield* node.scale(1.5, seconds)
- yield* node.fill(theme().coral, seconds)
- yield* all(a.opacity(1, 1), b.position([0, 0], 1)) to run several at once.

NEVER animate position, scale, width or height for an ENTRANCE. Once a shape's final size and position are fixed relative to its neighbours, both stay fixed - animate ONLY opacity for its entrance, with a stagger if you want it lively. A shape that scales or slides in sweeps its real footprint through whatever is already at the points along that path, and the audit samples mid-transition frames and correctly reports a real collision that no repair can undo. A "growing" bar also starts from a genuinely empty box, which is a separate failure.

CRITICAL - COLLECTIONS. The scene generator runs MORE THAN ONCE (the engine recalculates the timeline and samples frames). A single "let" is safe because each run overwrites it, but an ARRAY declared outside the generator and pushed into across runs accumulates stale nodes from finished runs, and touching one of those crashes. Declare the array with "let" and reset it to [] as the FIRST line inside the generator:

  let bars: Rect[] = [];
  export default makeScene2D(function* (view) {
    bars = [];   // REQUIRED - the generator runs more than once
    for (let i = 0; i < 5; i++) { const bar = new Rect({...}); bars.push(bar); view.add(bar); }
    yield* waitFor(1.5);
  });

EVERY array you build needs its own entries in buildAuditSpec's items. An array of nodes that is drawn but not registered is an unregistered-node failure, and it is the most common mistake once a scene has more than one generated collection.

COORDINATE TYPES - when you compute a coordinate you will reuse, store it as an OBJECT, "const p = {x: 10, y: 20}", never an array. A bare "[x, y]" stored in a variable widens to "number[]", which is not assignable to a point type and fails to compile. Inline literals written directly in a props object ("position: [x, y]") are fine.

TIMING - keep the whole beat under about 4.5 seconds of yield*/waitFor time. The hard cap is 6s and going over it cannot be repaired mechanically, so it always costs a whole regeneration. A title plus one clear diagram plus at most a couple of supporting labels is the right density for one beat; this is one held idea, not a whole lesson.

MATHS - use Latex, never Txt, for any equation, formula or exponent; plain-text maths notation is rejected by a real check. Latex supports real subexpression morphing: wrap the pieces you want addressable in {{...}}, e.g. tex: '{{y=}}{{a}}{{x^2}}', then yield* equation.tex('{{y=}}{{a}}{{x^2}} + {{bx}}', 1) morphs the rendered glyphs in place, matching pieces that appear in both strings. Keep the {{...}} split consistent across every .tex() call on the same node.`;

/**
 * The full code-generation prompt: the module contract plus whatever API
 * section was derived for this run.
 *
 * @remarks
 * Takes the section as a string rather than deriving it, so the expensive
 * declaration walk happens once per process instead of once per attempt -
 * and so a strategy that does not need an API list at all (an intent
 * compiler) never has to pay for one.
 */
export function buildSystemPrompt(apiSection: string): string {
  return apiSection
    ? `${MODULE_CONTRACT}\n\n${apiSection}\n`
    : `${MODULE_CONTRACT}\n`;
}
