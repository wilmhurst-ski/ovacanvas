import {getCatalogue} from '../catalogue/index.js';
import type {Catalogue} from '../catalogue/types.js';
import type {Issue} from './issues.js';
import type {SceneDocument, SceneNode, Step, Touch, Value} from './model.js';
import {validateDocument} from './prepare.js';
import {isObject} from './values.js';

/**
 * One incremental change to a document.
 *
 * @remarks
 * These are what an agent drives through MCP to build a scene progressively
 * - structure first, then relations, then detail - checking each stage,
 * rather than emitting a whole scene in one pass (the failure mode the
 * project's own ADRs describe).
 */
export type EditOp =
  | {readonly op: 'set_title'; readonly title: string}
  | {readonly op: 'add_node'; readonly node: SceneNode; readonly index?: number}
  | {
      readonly op: 'update_node';
      readonly id: string;
      /** Props to set (merged over the existing ones). */
      readonly props?: Readonly<Record<string, Value>>;
      /** Prop names to remove. */
      readonly unset?: readonly string[];
      /** New parent id, or `null` to move the node onto the stage. */
      readonly parent?: string | null;
      readonly role?: string | null;
      readonly halo?: number | null;
      readonly fixed?: boolean | null;
      /** For a kit instance: fields to set (merged), or null to remove one. */
      readonly fields?: Readonly<Record<string, Value | null>>;
    }
  | {readonly op: 'remove_node'; readonly id: string}
  | {readonly op: 'rename_node'; readonly id: string; readonly to: string}
  | {readonly op: 'add_step'; readonly step: Step; readonly index?: number}
  | {readonly op: 'replace_step'; readonly index: number; readonly step: Step}
  | {readonly op: 'remove_step'; readonly index: number}
  | {readonly op: 'set_timeline'; readonly timeline: readonly Step[]}
  | {readonly op: 'set_beats'; readonly beats: readonly Record<string, Value>[]}
  | {
      readonly op: 'add_beat';
      readonly beat: Record<string, Value>;
      readonly index?: number;
    }
  | {
      readonly op: 'replace_beat';
      readonly index: number;
      readonly beat: Record<string, Value>;
    }
  | {readonly op: 'remove_beat'; readonly index: number}
  | {readonly op: 'add_touch'; readonly touch: Touch}
  | {readonly op: 'remove_touch'; readonly a: string; readonly b: string};

export interface EditResult {
  /** Whether the edit was applied. */
  readonly ok: boolean;
  /** The document after the edit (unchanged when `ok` is false). */
  readonly document: SceneDocument;
  /** Errors the edit would have introduced (why it was refused). */
  readonly introduced: readonly Issue[];
  /** Every issue on the resulting document, warnings included. */
  readonly issues: readonly Issue[];
  /** A structural problem with the op itself (unknown id, bad index). */
  readonly error?: string;
}

/**
 * Errors that are expected while a document is still being built, and so do
 * not block an edit: a scene with only secondary, faded-in nodes so far has a
 * blank first frame until its main content is added.
 */
const TRANSIENT_CODES = new Set(['blank_first_frame']);

function issueKey(issue: Issue): string {
  // Step paths shift when steps are inserted, so they are not part of the key.
  return [issue.code, issue.node ?? '', issue.prop ?? '', issue.message].join(
    '\u0000',
  );
}

/**
 * Apply one edit, refusing it if it would introduce a new error.
 *
 * @remarks
 * Errors already present are not held against an edit - a document loaded
 * from disk may start invalid, and fixing it one step at a time must be
 * possible. Only errors the edit itself creates cause a refusal, and they are
 * returned so the caller can see exactly what was wrong with the edit.
 */
export function applyEdit(
  document: SceneDocument,
  op: EditOp,
  options: {catalogue?: Catalogue; force?: boolean} = {},
): EditResult {
  const catalogue = options.catalogue ?? getCatalogue();
  const before = validateDocument(document, {catalogue});
  const structural = (error: string): EditResult => ({
    ok: false,
    document,
    introduced: [],
    issues: before,
    error,
  });

  let next: SceneDocument;
  try {
    const result = mutate(document, op);
    if (typeof result === 'string') return structural(result);
    next = result;
  } catch (cause) {
    return structural(cause instanceof Error ? cause.message : String(cause));
  }

  const after = validateDocument(next, {catalogue});
  const known = new Set(before.map(issueKey));
  const introduced = after.filter(
    issue =>
      issue.severity === 'error' &&
      !TRANSIENT_CODES.has(issue.code) &&
      !known.has(issueKey(issue)),
  );
  if (introduced.length && !options.force) {
    return {ok: false, document, introduced, issues: before};
  }
  return {ok: true, document: next, introduced, issues: after};
}

function mutate(document: SceneDocument, op: EditOp): SceneDocument | string {
  if (typeof op !== 'object' || op === null || typeof op.op !== 'string') {
    return 'an edit must be an object with an "op"';
  }
  const nodes = [...document.nodes];
  const timeline = [...document.timeline];
  const indexOf = (id: string) => nodes.findIndex(node => node.id === id);

  switch (op.op) {
    case 'set_title':
      return {...document, title: String(op.title)};

    case 'add_node': {
      if (!isObject(op.node)) return '"node" must be an object';
      if (indexOf(op.node.id) !== -1) {
        return `a node with id "${op.node.id}" already exists`;
      }
      const at =
        op.index === undefined
          ? nodes.length
          : clampIndex(op.index, nodes.length);
      nodes.splice(at, 0, op.node);
      return {...document, nodes};
    }

    case 'update_node': {
      const i = indexOf(op.id);
      if (i === -1) return `no node with id "${op.id}"`;
      const current = nodes[i];
      const props: Record<string, Value> = {
        ...(current.props ?? {}),
        ...(op.props ?? {}),
      };
      for (const name of op.unset ?? []) delete props[name];
      const updated: {-readonly [K in keyof SceneNode]: SceneNode[K]} = {
        ...current,
        props,
      };
      // A kit instance has fields, not props: "unset" removes fields.
      const isKit = 'kit' in current;
      if (isKit) {
        for (const name of op.unset ?? []) {
          delete (updated as unknown as Record<string, unknown>)[name];
        }
      }
      if (Object.keys(props).length === 0 || isKit) delete updated.props;
      if (op.parent !== undefined) {
        if (op.parent === null) delete updated.parent;
        else updated.parent = op.parent;
      }
      if (op.role !== undefined) {
        if (op.role === null) delete updated.role;
        else updated.role = op.role;
      }
      if (op.halo !== undefined) {
        if (op.halo === null) delete updated.halo;
        else updated.halo = op.halo;
      }
      if (op.fixed !== undefined) {
        if (op.fixed === null) delete updated.fixed;
        else updated.fixed = op.fixed;
      }
      if (op.fields) {
        const target = updated as unknown as Record<string, Value | undefined>;
        for (const [key, value] of Object.entries(op.fields)) {
          if (['id', 'kit', 'component'].includes(key)) continue;
          if (value === null) delete target[key];
          else target[key] = value;
        }
      }
      nodes[i] = updated;
      return {...document, nodes};
    }

    case 'remove_node': {
      const i = indexOf(op.id);
      if (i === -1) return `no node with id "${op.id}"`;
      nodes.splice(i, 1);
      // Steps and touches that only exist for this node go with it; anything
      // still referencing it (a child, an anchored label, a connector) is left
      // for validation to report, since silently deleting those would change
      // the scene in ways the caller did not ask for.
      return {
        ...document,
        nodes,
        timeline: pruneSteps(timeline, op.id),
        ...(document.touches
          ? {
              touches: document.touches.filter(
                t => t.a !== op.id && t.b !== op.id,
              ),
            }
          : {}),
      };
    }

    case 'rename_node': {
      const i = indexOf(op.id);
      if (i === -1) return `no node with id "${op.id}"`;
      if (indexOf(op.to) !== -1) {
        return `a node with id "${op.to}" already exists`;
      }
      const rename = (id: string) => (id === op.id ? op.to : id);
      return {
        ...document,
        nodes: nodes.map(node => ({
          ...node,
          id: rename(node.id),
          ...(node.parent !== undefined ? {parent: rename(node.parent)} : {}),
          ...(node.props
            ? {
                props: renameRefs(node.props, op.id, op.to) as Record<
                  string,
                  Value
                >,
              }
            : {}),
        })),
        timeline: timeline.map(step => renameInStep(step, op.id, op.to)),
        ...(document.touches
          ? {
              touches: document.touches.map(t => ({
                ...t,
                a: rename(t.a),
                b: rename(t.b),
              })),
            }
          : {}),
      };
    }

    case 'add_step': {
      const at =
        op.index === undefined
          ? timeline.length
          : clampIndex(op.index, timeline.length);
      timeline.splice(at, 0, op.step);
      return {...document, timeline};
    }

    case 'replace_step': {
      if (
        !Number.isInteger(op.index) ||
        op.index < 0 ||
        op.index >= timeline.length
      ) {
        return `no top-level step at index ${op.index}`;
      }
      timeline[op.index] = op.step;
      return {...document, timeline};
    }

    case 'remove_step': {
      if (
        !Number.isInteger(op.index) ||
        op.index < 0 ||
        op.index >= timeline.length
      ) {
        return `no top-level step at index ${op.index}`;
      }
      timeline.splice(op.index, 1);
      return {...document, timeline};
    }

    case 'set_timeline':
      if (!Array.isArray(op.timeline)) return '"timeline" must be a list';
      return {...document, timeline: [...op.timeline]};

    case 'set_beats':
      if (!Array.isArray(op.beats)) return '"beats" must be a list';
      return {...document, beats: [...op.beats]} as SceneDocument;

    case 'add_beat': {
      const beats = [
        ...(((document as {beats?: unknown[]}).beats ?? []) as Record<
          string,
          Value
        >[]),
      ];
      beats.splice(
        op.index === undefined
          ? beats.length
          : clampIndex(op.index, beats.length),
        0,
        op.beat,
      );
      return {...document, beats} as SceneDocument;
    }

    case 'replace_beat':
    case 'remove_beat': {
      const beats = [
        ...(((document as {beats?: unknown[]}).beats ?? []) as Record<
          string,
          Value
        >[]),
      ];
      if (
        !Number.isInteger(op.index) ||
        op.index < 0 ||
        op.index >= beats.length
      ) {
        return `no beat at index ${op.index}`;
      }
      if (op.op === 'replace_beat') beats[op.index] = op.beat;
      else beats.splice(op.index, 1);
      return {...document, beats} as SceneDocument;
    }

    case 'add_touch':
      return {...document, touches: [...(document.touches ?? []), op.touch]};

    case 'remove_touch': {
      const touches = (document.touches ?? []).filter(
        t =>
          !((t.a === op.a && t.b === op.b) || (t.a === op.b && t.b === op.a)),
      );
      if (touches.length === (document.touches ?? []).length) {
        return `no touch between "${op.a}" and "${op.b}"`;
      }
      return {...document, touches};
    }

    default:
      return `unknown op ${JSON.stringify((op as {op: unknown}).op)}`;
  }
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) return length;
  return Math.max(0, Math.min(length, index));
}

function renameRefs(value: Value, from: string, to: string): Value {
  if (Array.isArray(value)) return value.map(v => renameRefs(v, from, to));
  if (isObject(value)) {
    if (value.ref === from) return {...value, ref: to};
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, renameRefs(v, from, to)]),
    );
  }
  return value;
}

function renameInStep(step: Step, from: string, to: string): Step {
  switch (step.kind) {
    case 'tween':
      return {
        ...step,
        node: step.node === from ? to : step.node,
        to: renameRefs(step.to, from, to),
      };
    case 'set':
      return {
        ...step,
        node: step.node === from ? to : step.node,
        value: renameRefs(step.value, from, to),
      };
    case 'all':
    case 'chain':
    case 'sequence':
      return {...step, steps: step.steps.map(s => renameInStep(s, from, to))};
    default:
      return step;
  }
}

/** Drop steps that animate `id`, and combinators left empty by that. */
function pruneSteps(steps: readonly Step[], id: string): Step[] {
  const result: Step[] = [];
  for (const step of steps) {
    if ((step.kind === 'tween' || step.kind === 'set') && step.node === id) {
      continue;
    }
    if (
      step.kind === 'all' ||
      step.kind === 'chain' ||
      step.kind === 'sequence'
    ) {
      const inner = pruneSteps(step.steps, id);
      if (inner.length === 0) continue;
      result.push({...step, steps: inner});
      continue;
    }
    result.push(step);
  }
  return result;
}
