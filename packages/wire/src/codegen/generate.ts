import {getCatalogue, getComponent, getProp, isA} from '../catalogue/index.js';
import type {Catalogue, ComponentSpec} from '../catalogue/types.js';
import {
  constructionOrder,
  initialOpacities,
  timelineDuration,
} from '../document/analysis.js';
import {hasErrors, type Issue} from '../document/issues.js';
import {
  DEFAULT_ITEM_HALO,
  DEFAULT_ROUTE_HALO,
  type SceneDocument,
  type SceneNode,
  type Step,
} from '../document/model.js';
import {prepareDocument} from '../document/prepare.js';
import {isObject} from '../document/values.js';
import {emitValue, type EmitContext} from './values.js';

/**
 * Where each part of the document landed in the generated module, as
 * 1-based line numbers - so a compiler diagnostic or a runtime error on a line
 * can be reported against the node or step that produced it.
 */
export interface SourceMap {
  readonly nodes: Readonly<
    Record<string, {readonly start: number; readonly end: number}>
  >;
  readonly steps: Readonly<Record<string, number>>;
}

export interface GeneratedBeat {
  /** The complete beat module, or `''` when the document has errors. */
  readonly source: string;
  readonly sourceMap: SourceMap;
  /**
   * The core document the source was generated from - the input itself, or
   * its expansion when it used kits or beats.
   */
  readonly document?: SceneDocument;
  /** Expanded node id to kit instance id, for locating issues on kits. */
  readonly origins: Readonly<Record<string, string>>;
  /** Everything the validator reported, warnings included. */
  readonly issues: readonly Issue[];
  readonly durationSeconds: number;
}

const EMBED_PREFIX = 'export const ovwDocument = ';

/** The document a module generated with `embedDocument` was built from. */
export function extractEmbeddedDocument(source: string): SceneDocument | null {
  const line = source.split('\n').find(l => l.startsWith(EMBED_PREFIX));
  if (!line) return null;
  try {
    return JSON.parse(
      line.slice(EMBED_PREFIX.length).replace(/;\s*$/, ''),
    ) as SceneDocument;
  } catch {
    return null;
  }
}

/** The safe area every shipped beat hands the audit (stage pixels). */
const SAFE_AREA = 'new BBox(60, 60, 1800, 960)';

class Writer {
  public readonly lines: string[] = [];
  public line(text = ''): number {
    this.lines.push(text);
    return this.lines.length;
  }
  public get next(): number {
    return this.lines.length + 1;
  }
}

/**
 * Compile a scene document into a complete OvaCanvas beat module.
 *
 * @remarks
 * Deterministic: the same document always produces byte-identical source.
 * The document is validated first and nothing is generated if it has
 * errors - exactly ManimWire's contract, so a caller never has to guess
 * whether a module came from a document that was actually valid.
 *
 * What the module gets for free, that a model writing code had to remember:
 * - one props object per constructor, vectors as inline literals
 * - every node declared with `let` and re-assigned inside the generator, so
 *   repeated scene runs never accumulate stale nodes
 * - `buildAuditSpec` registering every node, with `mayTouch` written on both
 *   sides of each declared touch, and connectors automatically allowed to
 *   touch the nodes their endpoints are attached to
 * - `requiredIds` limited to nodes that are actually visible at frame 0,
 *   which is what the host's visibility gate checks
 */
export function generateBeatSource(
  input: unknown,
  options: {
    catalogue?: Catalogue;
    /**
     * Also export the document itself (`ovwDocument`), so a later follow-up
     * can recover and edit it from the beat's source instead of starting over.
     */
    embedDocument?: boolean;
  } = {},
): GeneratedBeat {
  const catalogue = options.catalogue ?? getCatalogue();
  const prepared = prepareDocument(input, catalogue);
  const issues = prepared.issues;
  const origins = prepared.origins;
  const empty = {nodes: {}, steps: {}};
  if (hasErrors(issues)) {
    return {source: '', sourceMap: empty, issues, origins, durationSeconds: 0};
  }
  const document = prepared.document as SceneDocument;
  const components = new Map<string, ComponentSpec>(
    document.nodes.map(node => [
      node.id,
      getComponent(node.component, catalogue)!,
    ]),
  );
  const isLayout = (id: string) => {
    const component = components.get(id);
    return component ? isA(component, 'Layout') : false;
  };

  const context: EmitContext = {
    usesTheme: false,
    usesOrigin: false,
    engine: new Set(),
  };
  const flow = new Set<string>();
  const easings = new Set<string>();
  let usesTypeScale = false;

  // ---- body first, so the imports can be computed from what it used ----
  const body = new Writer();
  const nodeLines: Record<string, {start: number; end: number}> = {};
  const stepLines: Record<string, number> = {};

  const ordered = constructionOrder(document, catalogue)!;
  for (const node of ordered) {
    const component = components.get(node.id)!;
    const start = body.line(`  ${node.id} = new ${component.name}({`);
    if (node.role) {
      usesTypeScale = true;
      body.line(`    ...typeScale.${node.role},`);
    }
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      const spec = getProp(component, prop)!;
      body.line(
        `    ${propKey(prop)}: ${emitValue(value, spec.type, context, isLayout)},`,
      );
    }
    const end = body.line('  });');
    nodeLines[node.id] = {start, end};
  }

  const topLevel = document.nodes.filter(node => node.parent === undefined);
  if (topLevel.length) {
    body.line(`  view.add([${topLevel.map(node => node.id).join(', ')}]);`);
  }
  for (const parent of document.nodes) {
    const children = document.nodes.filter(node => node.parent === parent.id);
    if (children.length) {
      body.line(
        `  ${parent.id}.add([${children.map(node => node.id).join(', ')}]);`,
      );
    }
  }

  if (document.timeline.length) body.line();
  const emitStep = (
    step: Step,
    path: string,
    indent: string,
    asExpression: boolean,
  ): string => {
    switch (step.kind) {
      case 'wait':
        flow.add('waitFor');
        return `waitFor(${step.seconds})`;
      case 'tween': {
        const spec = getProp(components.get(step.node)!, step.prop)!;
        const args = [
          emitValue(step.to, spec.type, context, isLayout),
          String(step.seconds),
        ];
        if (step.easing) {
          easings.add(step.easing);
          args.push(step.easing);
        }
        return `${step.node}.${step.prop}(${args.join(', ')})`;
      }
      case 'set': {
        const spec = getProp(components.get(step.node)!, step.prop)!;
        const assignment = `${step.node}.${step.prop}(${emitValue(step.value, spec.type, context, isLayout)})`;
        // Inside a flow combinator a set must still be a task, so it is
        // wrapped as a zero-length generator that applies the value.
        return asExpression
          ? `(function* () { ${assignment}; })()`
          : assignment;
      }
      case 'all':
      case 'chain':
      case 'sequence': {
        flow.add(step.kind);
        const inner = step.steps.map(
          (child, index) =>
            `${indent}  ${emitStep(child, `${path}.steps.${index}`, `${indent}  `, true)},`,
        );
        const head =
          step.kind === 'sequence'
            ? `sequence(${step.delay},`
            : `${step.kind}(`;
        return `${head}\n${inner.join('\n')}\n${indent})`;
      }
    }
  };
  // Nested step lines are recorded against the line of their top-level step.
  document.timeline.forEach((step, index) => {
    const path = String(index);
    const line = body.next;
    const text = emitStep(step, path, '  ', false);
    recordStepPaths(step, path, line, stepLines);
    body.line(step.kind === 'set' ? `  ${text};` : `  yield* ${text};`);
  });

  // ---- audit spec ----
  const initial = initialOpacities(document);
  const touches = collectTouches(document, components);
  const audit = new Writer();
  audit.line('export function buildAuditSpec() {');
  audit.line('  return {');
  audit.line('    items: [');
  for (const node of document.nodes) {
    const component = components.get(node.id)!;
    const halo =
      node.halo ??
      (component.role === 'route' ? DEFAULT_ROUTE_HALO : DEFAULT_ITEM_HALO);
    const mayTouch = touches.get(node.id);
    const touchText = mayTouch?.size
      ? `, mayTouch: new Map<string, string>([${[...mayTouch].map(([other, reason]) => `[${JSON.stringify(other)}, ${JSON.stringify(reason)}]`).join(', ')}])`
      : '';
    // Only an explicit `fixed` pins a node; the host already pins
    // point-defined lines, which are the other thing repair must not move.
    const pinned = node.fixed === true;
    audit.line(
      `      {id: ${JSON.stringify(node.id)}, node: ${node.id}, halo: ${halo}${pinned ? ', fixed: true' : ''}${touchText}},`,
    );
  }
  audit.line('    ],');
  const required = document.nodes
    .filter(node => (initial.get(node.id) ?? 1) > 0.01)
    .map(node => JSON.stringify(node.id));
  audit.line(`    requiredIds: [${required.join(', ')}],`);
  audit.line(`    safeArea: ${SAFE_AREA},`);
  audit.line('  };');
  audit.line('}');

  // ---- assemble ----
  const imports2d = [
    'makeScene2D',
    ...new Set([...components.values()].map(c => c.name)),
  ];
  if (context.usesTheme) imports2d.push('theme');
  if (usesTypeScale) imports2d.push('typeScale');
  imports2d.push(...context.engine);
  const importsCore = ['BBox', ...flow, ...easings];
  if (context.usesOrigin) importsCore.push('Origin');

  const header = new Writer();
  header.line(
    `// Generated by @ovacanvas/wire from a scene document${document.title ? `: ${oneLine(document.title)}` : ''}.`,
  );
  header.line(
    '// Edit the document, not this file - it is regenerated deterministically.',
  );
  header.line(
    `import {${sortNames(imports2d).join(', ')}} from '@ovacanvas/2d';`,
  );
  header.line(
    `import {${sortNames(importsCore).join(', ')}} from '@ovacanvas/core';`,
  );
  header.line();
  for (const node of document.nodes) {
    header.line(`let ${node.id}: ${components.get(node.id)!.name};`);
  }
  header.line();
  header.line('export default makeScene2D(function* (view) {');

  const offset = header.lines.length;
  const shift = (line: number) => line + offset;
  const lines = [...header.lines, ...body.lines, '});', '', ...audit.lines, ''];
  if (options.embedDocument) {
    // The authored form (kits and beats intact), so a follow-up edits that.
    lines.push(`${EMBED_PREFIX}${JSON.stringify(prepared.authored)};`, '');
  }

  return {
    source: lines.join('\n'),
    sourceMap: {
      nodes: Object.fromEntries(
        Object.entries(nodeLines).map(([id, range]) => [
          id,
          {start: shift(range.start), end: shift(range.end)},
        ]),
      ),
      steps: Object.fromEntries(
        Object.entries(stepLines).map(([path, line]) => [path, shift(line)]),
      ),
    },
    document,
    origins,
    issues,
    durationSeconds:
      Math.round(timelineDuration(document.timeline) * 1000) / 1000,
  };
}

function recordStepPaths(
  step: Step,
  path: string,
  line: number,
  into: Record<string, number>,
): void {
  into[path] = line;
  if (
    step.kind === 'all' ||
    step.kind === 'chain' ||
    step.kind === 'sequence'
  ) {
    // Each child sits on its own line after the combinator's opening line.
    let cursor = line + 1;
    step.steps.forEach((child, index) => {
      recordStepPaths(child, `${path}.steps.${index}`, cursor, into);
      cursor += countLines(child);
    });
  }
}

function countLines(step: Step): number {
  if (
    step.kind === 'all' ||
    step.kind === 'chain' ||
    step.kind === 'sequence'
  ) {
    return 2 + step.steps.reduce((sum, child) => sum + countLines(child), 0);
  }
  return 1;
}

/**
 * Every authorized contact, keyed by node, written on both sides.
 *
 * @remarks
 * Declared touches come from the document. Connector touches are derived:
 * a route whose endpoint is `{"ref": "box"}` necessarily touches `box` - that
 * is what attaching means - so the authorization is generated rather than
 * left for an author to forget, which is the failure the audit's own
 * comments describe shipping over and over.
 */
function collectTouches(
  document: SceneDocument,
  components: Map<string, ComponentSpec>,
): Map<string, Map<string, string>> {
  const touches = new Map<string, Map<string, string>>();
  const add = (a: string, b: string, reason: string) => {
    if (!touches.has(a)) touches.set(a, new Map());
    if (!touches.get(a)!.has(b)) touches.get(a)!.set(b, reason);
  };
  const descendantsOf = (id: string): string[] => {
    const children = document.nodes.filter(n => n.parent === id).map(n => n.id);
    return [...children, ...children.flatMap(descendantsOf)];
  };
  for (const touch of document.touches ?? []) {
    add(touch.a, touch.b, touch.reason);
    if (touch.b !== '*') add(touch.b, touch.a, touch.reason);
  }
  for (const node of document.nodes) {
    const component = components.get(node.id)!;
    if (component.role !== 'route') continue;
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      const kind = getProp(component, prop)?.type.kind;
      if (kind !== 'endpoint' && kind !== 'points') continue;
      const values =
        Array.isArray(value) && kind === 'points' ? value : [value];
      for (const point of values) {
        if (isObject(point) && typeof point.ref === 'string') {
          const reason = `connector ${node.id} attaches to ${point.ref}`;
          add(node.id, point.ref, reason);
          add(point.ref, node.id, reason);
          // What is drawn inside that node (its label) sits where the
          // connector arrives, so the connector may touch it too.
          for (const inside of descendantsOf(point.ref)) {
            const insideReason = `connector ${node.id} arrives at ${point.ref}, which contains ${inside}`;
            add(node.id, inside, insideReason);
            add(inside, node.id, insideReason);
          }
        }
      }
    }
  }
  return touches;
}

function propKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function sortNames(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 100);
}

export type {SceneNode};
