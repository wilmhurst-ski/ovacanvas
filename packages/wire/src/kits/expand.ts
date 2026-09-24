import {getCatalogue, getComponent, isA, suggest} from '../catalogue/index.js';
import type {Catalogue} from '../catalogue/types.js';
import {timelineDuration} from '../document/analysis.js';
import {repairJsonEscapes} from '../document/escapes.js';
import type {Issue} from '../document/issues.js';
import type {
  SceneDocument,
  SceneNode,
  Step,
  Touch,
  Value,
} from '../document/model.js';
import {MAX_BEAT_SECONDS} from '../document/model.js';
import {validateCoreDocument} from '../document/validate.js';
import {isObject} from '../document/values.js';
import {TEX_EM, locateTerm} from '../tex/terms.js';
import {circuit} from './circuit.js';
import {derivation} from './derivation.js';
import {diagram} from './diagram.js';
import {placementBox} from './fields.js';
import {geometryFigure} from './geometry.js';
import {graph} from './graph.js';
import {graph3d} from './graph3d.js';
import {icon, icons} from './icon.js';
import {map} from './map.js';
import {motion} from './motion.js';
import {pieces} from './pieces.js';
import {plot} from './plot.js';
import {applySet, lerpValue, numericDifference, parseSetKey} from './set.js';
import {list as listKit, title} from './text.js';
import {transition, type Live} from './transition.js';
import type {Beat, KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

/**
 * A range of numbered parts, "cells.2-5": everything items 2 to 5 draw -
 * for walking through a slice of an array, a run of bars.
 */
function rangeOf(expansion: KitExpansion, name: string): KitPart | undefined {
  const m = name.match(/^(.+)\.(\d+)-(\d+)$/);
  if (!m) return undefined;
  const from = Number(m[2]);
  const to = Number(m[3]);
  if (to < from || to - from > 500) return undefined;
  const nodes: string[] = [];
  const traceable: string[] = [];
  for (let i = from; i <= to; i++) {
    const part = expansion.parts.get(`${m[1]}.${i}`);
    if (!part) return undefined;
    nodes.push(...part.nodes);
    traceable.push(...(part.traceable ?? []));
  }
  return {nodes, ...(traceable.length ? {traceable} : {})};
}

/** Every kit, by name. */
export const KITS: Readonly<Record<string, KitSpec>> = {
  [geometryFigure.name]: geometryFigure,
  [derivation.name]: derivation,
  [graph.name]: graph,
  [plot.name]: plot,
  [motion.name]: motion,
  [map.name]: map,
  [graph3d.name]: graph3d,
  [icon.name]: icon,
  [icons.name]: icons,
  [circuit.name]: circuit,
  [pieces.name]: pieces,
  [diagram.name]: diagram,
  [listKit.name]: listKit,
  [title.name]: title,
};

const KIT_ID = /^[a-z][A-Za-z0-9]{0,23}$/;
const BEAT_KEYS = [
  'show',
  'hide',
  'highlight',
  'trace',
  'morph',
  'play',
  'set',
  'focus',
  'from',
  'seconds',
  'hold',
  'pace',
  'keep',
];
const PACE = {quick: 0.25, normal: 0.4, slow: 0.7} as const;
const HIGHLIGHT = {theme: 'blue'} as const;
/** How long a `set` change takes when the beat does not say. */
const SET_SECONDS = 1;
/** How far `focus` dims everything else. */
const DIMMED = 0.2;

export interface PreparedDocument {
  /** The core document (kits expanded, beats compiled), or the input as-is. */
  readonly document: unknown;
  /** Every issue, located on what the author wrote (kit ids, beat indexes). */
  readonly issues: readonly Issue[];
  /** Whether the input used kits or beats. */
  readonly expanded: boolean;
  /** Expanded node id to the kit instance it came from. */
  readonly origins: Readonly<Record<string, string>>;
  /** The input as authored, after exact JSON-escape repairs. */
  readonly authored: unknown;
  /**
   * For each top-level timeline step, the beat it came from - set when the
   * document used beats. A lesson splits the timeline at these boundaries.
   */
  readonly beatSteps?: readonly number[];
  /**
   * Each kit instance as the beats leave it, after every `set` - a lesson
   * carries a kit into the next scene in this state.
   */
  readonly kitStates?: Readonly<Record<string, KitNode>>;
  /** Every version of each kit instance the beats draw, in order. */
  readonly kitVariants?: Readonly<Record<string, readonly KitNode[]>>;
}

/** Beat references by kit id: which parts beats highlight, and name at all. */
export interface KitReferences {
  readonly highlighted: ReadonlySet<string>;
  readonly referenced: ReadonlySet<string>;
  readonly shown?: ReadonlySet<string>;
}

export interface PrepareOptions {
  /**
   * Keep the whole timeline instead of fitting it into one beat's time
   * budget - a lesson splits it into several beats afterwards.
   */
  readonly split?: boolean;
  /**
   * References from beats elsewhere in a lesson, so a kit that appears in
   * several scenes expands identically in each (a map prepares the same
   * countries and overlays everywhere, and state carries across by node id).
   */
  readonly references?: ReadonlyMap<string, KitReferences>;
  /**
   * Every version of a kit across the whole lesson, for a kit kept from
   * scene to scene: it is fitted to all of them, so its frame holds still
   * across the scene change as well as within a scene.
   */
  readonly frames?: ReadonlyMap<string, readonly KitNode[]>;
}

/** What beats refer to, per kit id - for expanding a kit the same way in every scene. */
export function beatReferences(beats: unknown): Map<string, KitReferences> {
  const out = new Map<
    string,
    {highlighted: Set<string>; referenced: Set<string>; shown: Set<string>}
  >();
  const entry = (kitId: string) => {
    if (!out.has(kitId)) {
      out.set(kitId, {
        highlighted: new Set(),
        referenced: new Set(),
        shown: new Set(),
      });
    }
    return out.get(kitId)!;
  };
  for (const beat of Array.isArray(beats) ? beats : []) {
    if (!isObject(beat)) continue;
    for (const key of ['show', 'hide', 'highlight', 'trace']) {
      for (const target of list(beat[key])) {
        const dot = target.indexOf('.');
        if (dot === -1) continue;
        const part = target.slice(dot + 1);
        entry(target.slice(0, dot)).referenced.add(part);
        if (key === 'highlight') {
          entry(target.slice(0, dot)).highlighted.add(part);
        }
        // A traced part is revealed too (a 3D curve fades in when traced).
        if (key === 'show' || key === 'trace') {
          entry(target.slice(0, dot)).shown.add(part);
        }
      }
    }
  }
  return out;
}

export function usesKits(input: unknown): boolean {
  if (!isObject(input)) return false;
  if ('beats' in input) return true;
  return (
    Array.isArray(input.nodes) &&
    input.nodes.some(n => isObject(n) && 'kit' in n)
  );
}

function list(value: Value | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => typeof v === 'string',
  );
}

/**
 * Validate and expand a document that uses kits or beats into a core
 * document, then validate that - locating every issue on what the author
 * actually wrote.
 */
export function prepareDocument(
  input: unknown,
  catalogue: Catalogue = getCatalogue(),
  options: PrepareOptions = {},
): PreparedDocument {
  // First, restore LaTeX commands that JSON escapes swallowed.
  const repaired = repairJsonEscapes(input);
  const prepared = prepareRepaired(repaired.value, catalogue, options);
  return {
    ...prepared,
    authored: repaired.value,
    issues: [...repaired.issues, ...prepared.issues],
  };
}

function prepareRepaired(
  input: unknown,
  catalogue: Catalogue,
  options: PrepareOptions,
): Omit<PreparedDocument, 'authored'> {
  // A lesson checks each split part's length itself.
  const lengthChecked = (issue: Issue) =>
    !(options.split && (issue.code === 'too_long' || issue.code === 'long'));
  if (!usesKits(input)) {
    return {
      document: input,
      issues: validateCoreDocument(input, {catalogue}).filter(lengthChecked),
      expanded: false,
      origins: {},
    };
  }
  const doc = input as Record<string, Value>;
  const issues: Issue[] = [];
  const error = (issue: Omit<Issue, 'severity'>) =>
    issues.push({...issue, severity: 'error'});
  const fail = (): Omit<PreparedDocument, 'authored'> => ({
    document: input,
    issues,
    expanded: true,
    origins: {},
  });

  if (!Array.isArray(doc.nodes)) {
    return {
      document: input,
      issues: validateCoreDocument(input, {catalogue}),
      expanded: true,
      origins: {},
    };
  }
  if (
    doc.beats !== undefined &&
    Array.isArray(doc.timeline) &&
    doc.timeline.length > 0
  ) {
    error({
      code: 'bad_document',
      message: 'use either "beats" or "timeline", not both',
      hint: 'beats compile into the timeline',
    });
  }

  // ---- kit instances ------------------------------------------------------
  const kitNodes: KitNode[] = [];
  const ids = new Set<string>();
  for (const raw of doc.nodes) {
    if (!isObject(raw)) continue;
    if (typeof raw.id === 'string') {
      if (ids.has(raw.id)) {
        error({
          node: raw.id,
          code: 'duplicate_id',
          message: `id "${raw.id}" is used by more than one node`,
        });
      }
      ids.add(raw.id);
    }
    if (!('kit' in raw)) continue;
    const node = raw as KitNode;
    const at = {node: String(raw.id)};
    if (typeof raw.id !== 'string' || !KIT_ID.test(raw.id)) {
      error({
        ...at,
        code: 'bad_id',
        message: `kit id ${JSON.stringify(raw.id)} must be a lower-camel identifier of at most 24 characters`,
      });
      continue;
    }
    if ('component' in raw) {
      error({
        ...at,
        code: 'bad_document',
        message: 'a node has either "kit" or "component", not both',
      });
    }
    const spec = typeof raw.kit === 'string' ? KITS[raw.kit] : undefined;
    if (!spec) {
      const close =
        typeof raw.kit === 'string' ? suggest(raw.kit, Object.keys(KITS)) : [];
      error({
        ...at,
        code: 'unknown_component',
        message: `unknown kit ${JSON.stringify(raw.kit)}`,
        hint: close.length
          ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
          : `kits: ${Object.keys(KITS).join(', ')}`,
      });
      continue;
    }
    issues.push(...spec.validate(node));
    kitNodes.push(node);
  }

  // ---- beats: shape, and which kit parts will be highlighted ---------------
  const beats: Beat[] = [];
  if (doc.beats !== undefined) {
    if (!Array.isArray(doc.beats)) {
      error({code: 'bad_document', message: '"beats" must be a list'});
    } else {
      doc.beats.forEach((raw, index) => {
        const at = {step: `beats.${index}`};
        if (!isObject(raw)) {
          error({...at, code: 'bad_step', message: 'a beat must be an object'});
          return;
        }
        for (const key of Object.keys(raw)) {
          if (!BEAT_KEYS.includes(key)) {
            error({
              ...at,
              code: 'bad_step',
              message: `unknown beat key "${key}"`,
              hint: `a beat has ${BEAT_KEYS.join(', ')}`,
            });
          }
        }
        for (const key of ['show', 'hide', 'highlight', 'trace', 'play']) {
          const value = raw[key];
          if (
            value !== undefined &&
            typeof value !== 'string' &&
            !(Array.isArray(value) && value.every(v => typeof v === 'string'))
          ) {
            error({
              ...at,
              code: 'bad_step',
              message: `"${key}" is a target or a list of targets`,
            });
          }
        }
        if (raw.morph !== undefined && typeof raw.morph !== 'string') {
          error({
            ...at,
            code: 'bad_step',
            message: '"morph" is one target, e.g. "proof.2"',
          });
        }
        if (
          raw.hold !== undefined &&
          !(typeof raw.hold === 'number' && raw.hold >= 0 && raw.hold <= 3)
        ) {
          error({
            ...at,
            code: 'bad_duration',
            message: '"hold" is seconds from 0 to 3',
          });
        }
        if (
          raw.pace !== undefined &&
          !(typeof raw.pace === 'string' && raw.pace in PACE)
        ) {
          error({
            ...at,
            code: 'bad_step',
            message: '"pace" is "quick", "normal" or "slow"',
          });
        }
        if (raw.keep !== undefined && typeof raw.keep !== 'boolean') {
          error({...at, code: 'bad_step', message: '"keep" is true or false'});
        }
        if (
          raw.from !== undefined &&
          typeof raw.from !== 'string' &&
          !(
            Array.isArray(raw.from) &&
            raw.from.every(v => typeof v === 'string')
          )
        ) {
          error({
            ...at,
            code: 'bad_step',
            message:
              '"from" is a target or a list of targets whose labels fly into the equation',
          });
        }
        if (raw.set !== undefined && !isObject(raw.set)) {
          error({
            ...at,
            code: 'bad_step',
            message: '"set" is an object of changes, e.g. {"graph.k": 3}',
          });
        }
        if (
          raw.focus !== undefined &&
          raw.focus !== false &&
          raw.focus !== null &&
          typeof raw.focus !== 'string' &&
          !(
            Array.isArray(raw.focus) &&
            raw.focus.every(v => typeof v === 'string')
          )
        ) {
          error({
            ...at,
            code: 'bad_step',
            message: '"focus" is a target, a list of targets, or false',
          });
        }
        if (
          raw.seconds !== undefined &&
          !(
            typeof raw.seconds === 'number' &&
            raw.seconds >= 0.2 &&
            raw.seconds <= 5
          )
        ) {
          error({
            ...at,
            code: 'bad_duration',
            message: '"seconds" is how long the changes take, 0.2 to 5',
          });
        }
        beats.push(raw as Beat);
      });
    }
  }
  if (issues.some(i => i.severity === 'error')) return fail();

  const highlightedByKit = new Map<string, Set<string>>();
  const referencedByKit = new Map<string, Set<string>>();
  const shownByKit = new Map<string, Set<string>>();
  for (const [kitId, refs] of options.references ?? []) {
    highlightedByKit.set(kitId, new Set(refs.highlighted));
    referencedByKit.set(kitId, new Set(refs.referenced));
    shownByKit.set(kitId, new Set(refs.shown ?? []));
  }
  for (const beat of beats) {
    for (const key of ['show', 'hide', 'highlight', 'trace'] as const) {
      for (const target of list(beat[key] as Value)) {
        const dot = target.indexOf('.');
        if (dot === -1) continue;
        const kitId = target.slice(0, dot);
        if (!referencedByKit.has(kitId)) referencedByKit.set(kitId, new Set());
        referencedByKit.get(kitId)!.add(target.slice(dot + 1));
        if (key === 'show' || key === 'trace') {
          if (!shownByKit.has(kitId)) shownByKit.set(kitId, new Set());
          shownByKit.get(kitId)!.add(target.slice(dot + 1));
        }
      }
    }
    for (const target of list(beat.highlight as Value)) {
      const dot = target.indexOf('.');
      if (dot === -1) continue;
      const kitId = target.slice(0, dot);
      if (!highlightedByKit.has(kitId)) highlightedByKit.set(kitId, new Set());
      highlightedByKit.get(kitId)!.add(target.slice(dot + 1));
    }
  }

  // ---- set beats: every version of every kit the beats will draw ----------
  const rawNodes = new Map<string, SceneNode>(
    doc.nodes
      .filter(
        (n): n is Record<string, Value> =>
          isObject(n) && !('kit' in n) && typeof n.id === 'string',
      )
      .map(n => [n.id as string, n as unknown as SceneNode]),
  );
  const kitById = new Map(kitNodes.map(k => [k.id, k]));
  const variants = new Map<string, KitNode[]>(kitNodes.map(k => [k.id, [k]]));
  /** Per beat: which kits it changes (variant indexes), and raw node props. */
  const beatChanges: {kitId: string; from: number; to: number}[][] = [];
  const beatProps: {node: string; prop: string; value: Value}[][] = [];
  beats.forEach((beat, index) => {
    const at = {step: `beats.${index}`};
    const changes: {kitId: string; from: number; to: number}[] = [];
    const props: {node: string; prop: string; value: Value}[] = [];
    beatChanges.push(changes);
    beatProps.push(props);
    if (!isObject(beat.set as Value)) return;
    const touched = new Map<string, KitNode>();
    for (const [key, value] of Object.entries(
      beat.set as Record<string, Value>,
    )) {
      const parsed = parseSetKey(key);
      if (!parsed) {
        error({
          ...at,
          code: 'bad_step',
          message: `set key "${key}" must be "<id>.<field>"`,
          hint: 'e.g. {"graph.k": 3} or {"proof.layout": "square"}',
        });
        continue;
      }
      const kit = kitById.get(parsed.kitId);
      if (!kit) {
        if (rawNodes.has(parsed.kitId) && parsed.path.length === 1) {
          props.push({node: parsed.kitId, prop: parsed.path[0], value});
          continue;
        }
        const close = suggest(parsed.kitId, [
          ...kitById.keys(),
          ...rawNodes.keys(),
        ]);
        error({
          ...at,
          code: 'unknown_ref',
          message: `set "${key}": no kit or node "${parsed.kitId}"`,
          ...(close.length
            ? {hint: `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`}
            : {}),
        });
        continue;
      }
      const base = touched.get(kit.id) ?? variants.get(kit.id)!.at(-1)!;
      const result = applySet(base, KITS[kit.kit], parsed.path, value);
      if (!result.ok) {
        error({
          ...at,
          code: 'bad_step',
          message: result.message,
          ...(result.hint ? {hint: result.hint} : {}),
        });
        continue;
      }
      touched.set(kit.id, result.node);
    }
    for (const [kitId, node] of touched) {
      const problems = KITS[node.kit].validate(node);
      for (const problem of problems) {
        issues.push({
          ...problem,
          step: at.step,
          message: `after this set, ${problem.message}`,
        });
      }
      if (problems.some(p => p.severity === 'error')) continue;
      const list = variants.get(kitId)!;
      list.push(node);
      changes.push({kitId, from: list.length - 2, to: list.length - 1});
    }
  });
  if (issues.some(i => i.severity === 'error')) return fail();

  // ---- expand -------------------------------------------------------------
  const contextFor = (node: KitNode) => ({
    box: placementBox(node),
    highlighted: highlightedByKit.get(node.id) ?? new Set<string>(),
    referenced: referencedByKit.get(node.id) ?? new Set<string>(),
    shown: shownByKit.get(node.id) ?? new Set<string>(),
    variants: options.frames?.get(node.id) ?? variants.get(node.id) ?? [node],
  });
  const drawings = new Map<string, KitExpansion[]>();
  for (const node of kitNodes) {
    drawings.set(
      node.id,
      variants
        .get(node.id)!
        .map(v =>
          KITS[node.kit].expand(v, {...contextFor(node), box: placementBox(v)}),
        ),
    );
  }
  // The first drawing is what the document starts with.
  const expansions = new Map<string, KitExpansion>(
    [...drawings].map(([id, list]) => [id, list[0]]),
  );
  const current = new Map<string, number>(kitNodes.map(k => [k.id, 0]));
  const drawn = (kitId: string): KitExpansion | undefined =>
    drawings.get(kitId)?.[current.get(kitId) ?? 0];
  // Every node any drawing has, in drawing order: one that only a later
  // drawing has goes in after its neighbour there, and starts invisible.
  const kitOrder = new Map<string, SceneNode[]>();
  const absentAtStart = new Set<string>();
  const origins: Record<string, string> = {};
  for (const [kitId, list] of drawings) {
    const order = [...list[0].nodes];
    const seen = new Set(order.map(n => n.id));
    for (const drawing of list.slice(1)) {
      let anchor = -1;
      for (const n of drawing.nodes) {
        if (seen.has(n.id)) {
          anchor = order.findIndex(o => o.id === n.id);
          continue;
        }
        order.splice(anchor + 1, 0, n);
        anchor++;
        seen.add(n.id);
        absentAtStart.add(n.id);
      }
    }
    kitOrder.set(kitId, order);
    for (const n of order) origins[n.id] = kitId;
  }

  // ---- resolve beat targets ---------------------------------------------------
  const resolve = (
    target: string,
    at: {step: string},
    key: string,
    quiet = false,
  ): KitPart | null => {
    const report = (issue: Omit<Issue, 'severity'>) => {
      if (!quiet) error(issue);
    };
    const dot = target.indexOf('.');
    if (dot === -1) {
      if (rawNodes.has(target)) return {nodes: [target]};
      // A bare kit id is the whole kit: everything it draws (and its motion).
      const whole = drawn(target);
      if (whole) {
        const own = whole.parts.get('');
        return {
          nodes:
            own?.nodes ??
            whole.nodes.filter(n => n.props?.opacity !== 0).map(n => n.id),
          ...(own?.play ? {play: own.play} : {}),
        };
      }
      const close = suggest(target, [...rawNodes.keys(), ...drawings.keys()]);
      report({
        ...at,
        code: 'unknown_ref',
        message: `${key} target "${target}" is not a node`,
        hint: close.length
          ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
          : 'kit parts are written "<kitId>.<part>"',
      });
      return null;
    }
    const kitId = target.slice(0, dot);
    const partName = target.slice(dot + 1);
    const expansion = drawn(kitId);
    if (!expansion) {
      report({
        ...at,
        code: 'unknown_ref',
        message: `${key} target "${target}": no kit "${kitId}"`,
      });
      return null;
    }
    const part = expansion.parts.get(partName) ?? rangeOf(expansion, partName);
    if (!part) {
      const close = suggest(partName, expansion.parts.keys());
      report({
        ...at,
        code: 'unknown_ref',
        message: `${key} target "${target}": kit "${kitId}" has no part "${partName}"`,
        hint: close.length
          ? `did you mean ${close.map(c => `"${kitId}.${c}"`).join(' or ')}?`
          : KITS[kitNodes.find(k => k.id === kitId)!.kit].parts,
      });
      return null;
    }
    return part;
  };

  // ---- what starts hidden: everything a beat will bring in ------------------
  // Found before compiling, because a change earlier on (a focus dimming the
  // rest, a set moving it) must leave a not-yet-shown node hidden.
  const revealed = new Set<string>();
  beats.forEach((beat, index) => {
    const at = {step: `beats.${index}`};
    for (const target of list(beat.show as Value)) {
      for (const n of resolve(target, at, 'show', true)?.nodes ?? []) {
        revealed.add(n);
      }
    }
    for (const target of list(beat.trace as Value)) {
      const part = resolve(target, at, 'trace', true);
      if (part && !part.traceable?.length && !part.grow?.length) {
        part.nodes.forEach(n => revealed.add(n));
      }
    }
    for (const change of beatChanges[index]) {
      current.set(change.kitId, change.to);
    }
  });
  for (const kitId of current.keys()) current.set(kitId, 0);

  // ---- compile beats ------------------------------------------------------
  const startHidden = new Set<string>();
  const startUntraced = new Set<string>();
  const startProps = new Map<string, Record<string, Value>>();
  const timeline: Step[] = [];
  const beatForStep: number[] = [];
  const allNodes = new Map<string, SceneNode>([
    ...rawNodes,
    ...[...kitOrder.values()].flatMap(list =>
      list.map(n => [n.id, n] as const),
    ),
  ]);
  // Where every node's props stand as the beats go, for animating changes.
  const live: Live = new Map(
    [...allNodes].map(([id, n]) => [id, {...(n.props ?? {})}]),
  );
  // Hidden by beats right now: not yet shown, or hidden. (A kit's own
  // invisible overlays are not: their opacity is the kit's to change.)
  const hidden = new Set<string>(revealed);
  const onScreen = (id: string) => {
    if (hidden.has(id)) return false;
    const kitId = origins[id];
    if (kitId && !drawn(kitId)?.nodes.some(n => n.id === id)) return false;
    return live.get(id)?.opacity !== 0;
  };
  let dimmed = new Set<string>();
  const everShown = new Set<string>();
  let lit: {part: KitPart; keep: boolean}[] = [];
  const recolorProp = (nodeId: string) => {
    const component = getComponent(
      allNodes.get(nodeId)?.component ?? '',
      catalogue,
    );
    return component && (isA(component, 'Txt') || isA(component, 'Latex'))
      ? 'fill'
      : 'stroke';
  };
  const titleNodes = new Set(
    kitNodes
      .filter(k => k.kit === 'title')
      .flatMap(k => kitOrder.get(k.id)!.map(n => n.id)),
  );
  for (const n of rawNodes.values()) {
    if (n.role === 'heading') titleNodes.add(n.id);
  }
  const isLatex = (id: string) => {
    const component = getComponent(
      allNodes.get(id)?.component ?? '',
      catalogue,
    );
    return component !== undefined && isA(component, 'Latex');
  };
  const isTex = (v: Value | undefined): v is string | readonly string[] =>
    typeof v === 'string' ||
    (Array.isArray(v) && v.every(t => typeof t === 'string'));
  const texString = (v: string | readonly string[]) =>
    typeof v === 'string' ? v : v.join('');
  // Copies of labels flying into equations ("from"): drawn on top, hidden
  // until their beat.
  const flights: SceneNode[] = [];
  const flightTouches: Touch[] = [];

  beats.forEach((beat, index) => {
    const at = {step: `beats.${index}`};
    const seconds: number = beat.seconds ?? PACE[beat.pace ?? 'normal'];
    const ops: Step[] = [];
    /** Equations this beat brings in or changes, for labels to fly into. */
    const arrivals: {
      node: string;
      /** What the equation said before (a new line: the line it came from). */
      previous?: string;
      seconds: number;
      /** For a plain fade-in: its step, delayed so the label lands first. */
      fade?: number;
    }[] = [];
    const tween = (
      node: string,
      prop: string,
      to: Value,
      s = seconds,
    ): Step => ({kind: 'tween', node, prop, to, seconds: s});
    const reveal = (n: string) => {
      if (!everShown.has(n)) startHidden.add(n);
      everShown.add(n);
      hidden.delete(n);
      dimmed.delete(n);
    };

    // Last beat's highlights go out as this beat starts.
    const stillLit: typeof lit = [];
    for (const entry of lit) {
      if (entry.keep) {
        stillLit.push({...entry, keep: false});
        continue;
      }
      if (entry.part.overlay) ops.push(tween(entry.part.overlay, 'opacity', 0));
      else {
        for (const n of entry.part.nodes) {
          const prop = recolorProp(n);
          ops.push(tween(n, prop, live.get(n)?.[prop] ?? {theme: 'ink'}));
        }
      }
    }
    lit = stillLit;

    // Changes of fields: each kit drawn again, the difference animated.
    for (const change of beatChanges[index]) {
      const list = drawings.get(change.kitId)!;
      const kit = kitById.get(change.kitId)!;
      const a = variants.get(change.kitId)![change.from];
      const b = variants.get(change.kitId)![change.to];
      const context = contextFor(kit);
      const result = transition({
        from: list[change.from].nodes,
        to: list[change.to].nodes,
        seconds: beat.seconds ?? Math.max(SET_SECONDS, seconds),
        live,
        hidden,
        catalogue,
        ...((KITS[kit.kit].interpolates?.(a, b) ?? true) &&
        numericDifference(a as unknown as Value, b as unknown as Value)
          ? {
              sample: (t: number) => {
                try {
                  const mid = lerpValue(
                    a as unknown as Value,
                    b as unknown as Value,
                    t,
                  ) as unknown as KitNode;
                  return KITS[kit.kit].expand(mid, {
                    ...context,
                    box: placementBox(mid),
                  }).nodes;
                } catch {
                  return null;
                }
              },
            }
          : {}),
      });
      ops.push(...result.steps);
      current.set(change.kitId, change.to);
    }
    for (const {node, prop, value} of beatProps[index]) {
      const component = getComponent(
        allNodes.get(node)?.component ?? '',
        catalogue,
      );
      ops.push(
        component?.props[prop]?.tweenable
          ? tween(
              node,
              prop,
              value,
              beat.seconds ?? Math.max(SET_SECONDS, seconds),
            )
          : {kind: 'set', node, prop, value},
      );
      live.set(node, {...(live.get(node) ?? {}), [prop]: value});
    }

    for (const target of list(beat.show as Value)) {
      const part = resolve(target, at, 'show');
      if (!part) continue;
      // A part that comes out of another one already on screen (the next
      // line of working out of the line above) moves there from it.
      const source =
        part.emerge && target.includes('.')
          ? resolve(
              `${target.slice(0, target.indexOf('.'))}.${part.emerge.after}`,
              at,
              'show',
              true,
            )
          : null;
      const emerging =
        part.emerge && source?.nodes.length && source.nodes.every(onScreen);
      for (const n of part.nodes) {
        reveal(n);
        const from = emerging
          ? part.emerge!.nodes.find(e => e.node === n)?.from
          : undefined;
        if (from) {
          for (const [prop, value] of Object.entries(from)) {
            ops.push({kind: 'set', node: n, prop, value});
          }
          ops.push({kind: 'set', node: n, prop: 'opacity', value: 1});
          const own = live.get(n) ?? {};
          const texSeconds = Math.max(0.9, seconds * 2.2);
          for (const prop of Object.keys(from)) {
            ops.push(
              tween(
                n,
                prop,
                own[prop] as Value,
                prop === 'tex' ? texSeconds : Math.max(0.7, seconds * 1.8),
              ),
            );
          }
          if (isLatex(n)) {
            arrivals.push({
              node: n,
              ...(isTex(from.tex) ? {previous: texString(from.tex)} : {}),
              seconds: texSeconds,
            });
          }
        } else {
          if (isLatex(n)) {
            arrivals.push({node: n, seconds, fade: ops.length});
          }
          ops.push(tween(n, 'opacity', 1));
        }
      }
    }
    for (const target of list(beat.hide as Value)) {
      for (const n of resolve(target, at, 'hide')?.nodes ?? []) {
        hidden.add(n);
        dimmed.delete(n);
        ops.push(tween(n, 'opacity', 0));
      }
    }
    for (const target of list(beat.trace as Value)) {
      const part = resolve(target, at, 'trace');
      if (part?.grow?.length) {
        // Drawn by growing: bars rise from their axis.
        for (const {node, from} of part.grow) {
          if (!startProps.has(node)) startProps.set(node, {...from});
          for (const prop of Object.keys(from)) {
            ops.push(
              tween(
                node,
                prop,
                live.get(node)?.[prop] as Value,
                Math.max(seconds, 0.8),
              ),
            );
          }
        }
        continue;
      }
      if (part && !part.traceable?.length) {
        // Not a line (a 3D curve, a shape): "draw it" still means bring it
        // in, so it fades in the way show would, rather than failing.
        if (!part.nodes.length) {
          error({
            ...at,
            code: 'bad_step',
            message: `"${target}" is not a line that can be traced`,
            hint: 'trace segments, polygons or connectors',
          });
        } else {
          issues.push({
            ...at,
            code: 'bad_step',
            severity: 'warning',
            message: `"${target}" is not a line, so it fades in instead of being drawn`,
            hint: 'use "show" for anything that is not a line',
          });
          for (const n of part.nodes) {
            reveal(n);
            ops.push(tween(n, 'opacity', 1));
          }
        }
      }
      for (const n of part?.traceable ?? []) {
        startUntraced.add(n);
        ops.push(tween(n, 'end', 1, Math.max(seconds, 0.6)));
      }
    }
    for (const target of list(beat.highlight as Value)) {
      const part = resolve(target, at, 'highlight');
      if (!part) continue;
      if (part.overlay) ops.push(tween(part.overlay, 'opacity', 1));
      else {
        for (const n of part.nodes) {
          ops.push(tween(n, recolorProp(n), HIGHLIGHT));
        }
      }
      lit.push({part, keep: beat.keep === true});
    }
    for (const target of list(beat.play as Value)) {
      const part = resolve(target, at, 'play');
      if (part && !part.play?.length) {
        error({
          ...at,
          code: 'bad_step',
          message: `"${target}" has nothing to play`,
          hint: 'play runs a motion kit, e.g. "play": "throw"',
        });
      }
      for (const step of part?.play ?? []) ops.push(step);
    }
    if (beat.morph !== undefined) {
      const part = resolve(beat.morph, at, 'morph');
      if (part && !part.morph) {
        error({
          ...at,
          code: 'bad_step',
          message: `"${beat.morph}" cannot morph`,
          hint: 'morph targets a step of a derivation in "morph" mode',
        });
      } else if (part?.morph) {
        const morphSeconds = Math.max(0.8, seconds * 2);
        const previousTex = live.get(part.morph.node)?.tex;
        ops.push(
          tween(part.morph.node, 'tex', part.morph.tex as Value, morphSeconds),
        );
        live.set(part.morph.node, {
          ...(live.get(part.morph.node) ?? {}),
          tex: part.morph.tex as Value,
        });
        arrivals.push({
          node: part.morph.node,
          ...(isTex(previousTex) ? {previous: texString(previousTex)} : {}),
          seconds: morphSeconds,
        });
        if (part.morph.note) {
          const {node, text} = part.morph.note;
          if (text) {
            ops.push({kind: 'set', node, prop: 'text', value: text});
            ops.push(tween(node, 'opacity', 1));
          } else ops.push(tween(node, 'opacity', 0));
        }
      }
    }

    // From: each label in these parts whose maths reappears as a new term
    // of an equation arriving now flies there - a copy of it travels from
    // the figure into its place in the equation and lands as the term
    // appears, the way a measured quantity becomes a term of the formula.
    if (beat.from !== undefined) {
      const labels: string[] = [];
      for (const target of list(beat.from as Value)) {
        for (const n of resolve(target, at, 'from')?.nodes ?? []) {
          if (isLatex(n) && isTex(live.get(n)?.tex)) labels.push(n);
        }
      }
      let flown = 0;
      for (const label of labels) {
        const own = live.get(label)!;
        const labelTex = texString(own.tex as string | string[]);
        for (const arrival of arrivals) {
          const props = live.get(arrival.node) ?? {};
          if (!isTex(props.tex)) continue;
          const place = locateTerm(
            labelTex,
            texString(props.tex),
            arrival.previous,
          );
          if (!place) continue;
          const size = typeof props.fontSize === 'number' ? props.fontSize : 48;
          const at0 = (props.position as number[] | undefined) ?? [0, 0];
          const k = (size * TEX_EM) / 1000;
          const landing = [
            Math.round((at0[0] + (place.dx - place.ownDx) * k) * 10) / 10,
            Math.round((at0[1] + (place.dy - place.ownDy) * k) * 10) / 10,
          ];
          // A plain fade-in waits for the label to land; a morph already
          // brings new terms in at its end.
          const flight =
            arrival.fade !== undefined
              ? Math.max(1, seconds * 2.5)
              : arrival.seconds;
          if (arrival.fade !== undefined) {
            ops[arrival.fade] = {
              kind: 'chain',
              steps: [
                {kind: 'wait', seconds: round3(flight * 0.75)},
                tween(arrival.node, 'opacity', 1, round3(flight * 0.25)),
              ],
            };
          }
          const id = `${arrival.node}_from${flights.length}`;
          flights.push({
            id,
            component: 'Latex',
            props: {
              tex: own.tex as Value,
              fontSize: (own.fontSize as Value) ?? 32,
              position: (own.position as Value) ?? [0, 0],
              fill: (own.fill as Value) ?? {theme: 'ink'},
              opacity: 0,
            },
          });
          allNodes.set(id, flights[flights.length - 1]);
          origins[id] = origins[arrival.node] ?? arrival.node;
          flightTouches.push({
            a: id,
            b: '*',
            reason: 'a label flies across the stage into its equation',
          });
          ops.push({
            kind: 'chain',
            steps: [
              {kind: 'set', node: id, prop: 'opacity', value: 1},
              {
                kind: 'all',
                steps: [
                  tween(id, 'position', landing, round3(flight * 0.8)),
                  tween(id, 'fontSize', size, round3(flight * 0.8)),
                  tween(
                    id,
                    'fill',
                    (props.fill as Value) ?? {theme: 'ink'},
                    round3(flight * 0.8),
                  ),
                ],
              },
              tween(id, 'opacity', 0, round3(flight * 0.2)),
            ],
          });
          flown++;
          break;
        }
      }
      if (!flown) {
        issues.push({
          ...at,
          code: 'bad_step',
          severity: 'warning',
          message: `nothing in ${JSON.stringify(beat.from)} matches a new term of what this beat shows or morphs`,
          hint: 'from names labels (point, side or piece labels, dimension labels) whose maths appears in the equation this beat brings in',
        });
      }
    }

    // Focus: everything else on screen dims until the focus moves on.
    if (beat.focus !== undefined) {
      const targets =
        beat.focus === false || beat.focus === null ? [] : list(beat.focus);
      // Focusing a part dims the rest of its figure (a formula beside it
      // stays readable); focusing a whole kit or node dims everything else.
      const kept = new Set<string>();
      const scope = new Set<string>();
      let everything = false;
      for (const target of targets) {
        const part = resolve(target, at, 'focus');
        part?.nodes.forEach(n => kept.add(n));
        if (part?.overlay) kept.add(part.overlay);
        if (target.includes('.')) {
          scope.add(target.slice(0, target.indexOf('.')));
        } else everything = true;
      }
      const next = new Set(
        targets.length
          ? [...allNodes.keys()].filter(
              n =>
                !kept.has(n) &&
                !titleNodes.has(n) &&
                (everything || scope.has(origins[n] ?? '')) &&
                onScreen(n),
            )
          : [],
      );
      for (const n of dimmed) {
        if (!next.has(n)) ops.push(tween(n, 'opacity', 1));
      }
      for (const n of next) {
        if (!dimmed.has(n)) ops.push(tween(n, 'opacity', DIMMED));
      }
      dimmed = next;
    }

    if (ops.length === 1) {
      timeline.push(ops[0]);
      beatForStep.push(index);
    } else if (ops.length > 1) {
      timeline.push({kind: 'all', steps: ops});
      beatForStep.push(index);
    }
    const hold = beat.hold ?? 0.6;
    if (hold > 0) {
      timeline.push({kind: 'wait', seconds: hold});
      beatForStep.push(index);
    }
  });
  if (issues.some(i => i.severity === 'error')) return fail();

  // ---- fit the beats into the engine's time budget --------------------------
  // A model cannot see how long its beats add up to, and the recorded failure
  // is overshooting 6s by a few tenths, attempt after attempt. Timing is the
  // kit layer's job: shorten the holds first, then the changes, down to
  // readable minimums, and only fail if even that does not fit.
  const compiled = options.split
    ? {timeline, before: 0, after: 0}
    : fitToBudget(timeline);
  if (compiled.before > compiled.after + 1e-9) {
    issues.push({
      code: 'long',
      severity: 'warning',
      message: `the beats ran ${compiled.before.toFixed(2)}s and were compressed to ${compiled.after.toFixed(2)}s to fit the ${MAX_BEAT_SECONDS}s limit`,
      hint: 'fewer beats, or shorter holds, keep the pacing you chose',
    });
  }
  timeline.splice(0, timeline.length, ...compiled.timeline);

  // ---- assemble, with the starting state beats imply -----------------------
  const patch = (node: SceneNode): SceneNode => {
    const extra: Record<string, Value> = {};
    if (startHidden.has(node.id)) extra.opacity = 0;
    if (startUntraced.has(node.id)) extra.end = 0;
    if (absentAtStart.has(node.id)) extra.opacity = 0;
    Object.assign(extra, startProps.get(node.id) ?? {});
    return Object.keys(extra).length
      ? {...node, props: {...(node.props ?? {}), ...extra}}
      : node;
  };
  // Plain nodes and touches may point at kit parts ("fig.AB"): a part
  // resolves to the node that draws it.
  const partNode = (target: string): string | null => {
    const dot = target.indexOf('.');
    if (dot === -1) return null;
    const part = expansions
      .get(target.slice(0, dot))
      ?.parts.get(target.slice(dot + 1));
    return part?.nodes[0] ?? part?.overlay ?? null;
  };
  const refError = (node: string, prop: string, target: string) => {
    const dot = target.indexOf('.');
    const kitId = target.slice(0, dot);
    const expansion = expansions.get(kitId);
    const close = expansion
      ? suggest(target.slice(dot + 1), expansion.parts.keys())
      : [];
    error({
      node,
      prop,
      code: 'unknown_ref',
      message: expansion
        ? `kit "${kitId}" has no part "${target.slice(dot + 1)}"`
        : `reference to unknown kit "${kitId}"`,
      ...(close.length
        ? {
            hint: `did you mean ${close.map(c => `"${kitId}.${c}"`).join(' or ')}?`,
          }
        : {}),
    });
  };
  const resolveRefs = (value: Value, node: string, prop: string): Value => {
    if (Array.isArray(value)) return value.map(v => resolveRefs(v, node, prop));
    if (isObject(value)) {
      if (typeof value.ref === 'string' && value.ref.includes('.')) {
        const dot = value.ref.indexOf('.');
        const target = expansions
          .get(value.ref.slice(0, dot))
          ?.parts.get(value.ref.slice(dot + 1));
        if (prop === 'anchor' && target?.traceable?.length) {
          // A line's own position is the origin its points are measured
          // from, not its middle, so a label anchored to it lands elsewhere.
          error({
            node,
            prop,
            code: 'bad_ref',
            message: `"${value.ref}" is a line; a label anchored to it would not sit on it`,
            hint: `label sides with the kit's "sideLabels" field, e.g. "sideLabels": {"${value.ref.slice(dot + 1)}": "4"}`,
          });
          return value;
        }
        const resolved = partNode(value.ref);
        if (!resolved) {
          refError(node, prop, value.ref);
          return value;
        }
        return {...value, ref: resolved};
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolveRefs(v, node, prop)]),
      );
    }
    return value;
  };
  const withPartRefs = (node: SceneNode): SceneNode =>
    node.props
      ? {
          ...node,
          props: Object.fromEntries(
            Object.entries(node.props).map(([prop, v]) => [
              prop,
              resolveRefs(v, node.id, prop),
            ]),
          ),
        }
      : node;

  const nodes: SceneNode[] = [];
  const touches: Touch[] = (
    (Array.isArray(doc.touches) ? doc.touches : []) as unknown as Touch[]
  ).map(touch => {
    const a = touch.a?.includes('.') ? partNode(touch.a) : touch.a;
    const b = touch.b?.includes('.') ? partNode(touch.b) : touch.b;
    if (a === null) refError(touch.a, 'touches', touch.a);
    if (b === null) refError(touch.a, 'touches', touch.b);
    return {...touch, a: a ?? touch.a, b: b ?? touch.b};
  });
  for (const raw of doc.nodes) {
    if (!isObject(raw) || typeof raw.id !== 'string') continue;
    const order = kitOrder.get(raw.id);
    if (order) {
      nodes.push(...order.map(patch));
      const seen = new Set<string>();
      for (const drawing of drawings.get(raw.id)!) {
        for (const touch of drawing.touches) {
          const key = `${touch.a}|${touch.b}`;
          if (seen.has(key)) continue;
          seen.add(key);
          touches.push(touch);
        }
      }
    } else if (!('kit' in raw)) {
      nodes.push(patch(withPartRefs(raw as unknown as SceneNode)));
    }
  }
  // Flying labels go on top of everything they cross.
  nodes.push(...flights);
  touches.push(...flightTouches);
  if (issues.some(i => i.severity === 'error')) return fail();
  const document: SceneDocument = {
    version: 1,
    ...(typeof doc.title === 'string' ? {title: doc.title} : {}),
    nodes,
    timeline:
      doc.beats !== undefined
        ? timeline
        : ((doc.timeline ?? []) as unknown as Step[]),
    ...(touches.length ? {touches} : {}),
  };

  // ---- validate the expansion, located on what the author wrote -------------
  const core = validateCoreDocument(document, {catalogue})
    .filter(lengthChecked)
    // A kit's own motion is intended; the multi-frame audit still checks it.
    .filter(
      issue =>
        !(
          issue.code === 'moves_node' &&
          issue.node !== undefined &&
          origins[issue.node]
        ),
    )
    .map(issue => {
      let located: Issue = issue;
      const kitId = issue.node !== undefined ? origins[issue.node] : undefined;
      if (kitId) {
        located = {
          ...located,
          node: kitId,
          hint: `${issue.hint ? `${issue.hint}; ` : ''}in ${issue.node}, generated by kit ${kitId}`,
        };
      }
      if (doc.beats !== undefined && located.step !== undefined) {
        const top = Number(located.step.split('.')[0]);
        if (Number.isInteger(top) && beatForStep[top] !== undefined) {
          located = {...located, step: `beats.${beatForStep[top]}`};
        }
      }
      return located;
    });
  return {
    document,
    issues: [...issues, ...core],
    expanded: true,
    origins,
    ...(doc.beats !== undefined ? {beatSteps: beatForStep} : {}),
    kitStates: Object.fromEntries(
      [...variants].map(([id, list]) => [id, list[list.length - 1]]),
    ),
    kitVariants: Object.fromEntries(variants),
  };
}

export type {KitSpec};

const TIME_BUDGET = MAX_BEAT_SECONDS - 0.2;
const MIN_HOLD = 0.15;
const MIN_CHANGE = 0.2;

function scaleTweens(step: Step, factor: number): Step {
  switch (step.kind) {
    case 'tween':
      return {
        ...step,
        // Never below a readable minimum - but a step already shorter than
        // that (one segment of a camera orbit) is never made longer.
        seconds: Math.max(
          Math.min(step.prop === 'tex' ? 0.5 : MIN_CHANGE, step.seconds),
          Math.round(step.seconds * factor * 1000) / 1000,
        ),
      };
    case 'all':
    case 'chain':
    case 'sequence':
      return {...step, steps: step.steps.map(s => scaleTweens(s, factor))};
    default:
      return step;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Compress holds, then changes, until the timeline fits the budget. */
export function fitToBudget(timeline: readonly Step[]): {
  timeline: Step[];
  before: number;
  after: number;
} {
  const before = timelineDuration(timeline);
  let steps = [...timeline];
  if (before <= TIME_BUDGET) return {timeline: steps, before, after: before};

  const waits = steps.reduce(
    (sum, s) => sum + (s.kind === 'wait' ? s.seconds : 0),
    0,
  );
  const others = before - waits;
  if (waits > 0) {
    const factor = Math.max(0, (TIME_BUDGET - others) / waits);
    steps = steps.map(s =>
      s.kind === 'wait'
        ? {...s, seconds: Math.max(MIN_HOLD, round2(s.seconds * factor))}
        : s,
    );
  }
  let after = timelineDuration(steps);
  if (after > TIME_BUDGET) {
    const factor = TIME_BUDGET / after;
    steps = steps.map(s => (s.kind === 'wait' ? s : scaleTweens(s, factor)));
    after = timelineDuration(steps);
  }
  return {timeline: steps, before, after};
}
