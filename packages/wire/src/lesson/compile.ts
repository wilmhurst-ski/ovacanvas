import {getCatalogue, suggest} from '../catalogue/index.js';
import type {Catalogue} from '../catalogue/types.js';
import {generateBeatSource} from '../codegen/generate.js';
import {timelineDuration, walkSteps} from '../document/analysis.js';
import type {Issue} from '../document/issues.js';
import {
  MAX_BEAT_SECONDS,
  type SceneDocument,
  type SceneNode,
  type Step,
  type Value,
} from '../document/model.js';
import {isObject} from '../document/values.js';
import {
  beatReferences,
  fitToBudget,
  prepareDocument,
  type KitReferences,
} from '../kits/expand.js';
import type {KitNode} from '../kits/types.js';

/**
 * A lesson: explanations longer than one beat, written as short beats.
 *
 * @remarks
 * The engine plays one beat for at most 6 seconds. A lesson lifts that limit
 * without asking a model for more JSON: it writes the same short beats
 * (`{"show": "map.Nigeria"}`), as many as the explanation needs, and the
 * lesson splits them into engine beats of up to 5.8s. Every part starts
 * exactly where the previous one ended - what was shown stays shown, a
 * traced route stays drawn, a moved body stays put - so the crossfade
 * between parts is invisible and the learner sees one continuous lesson.
 *
 * Longer explanations change scene: each scene has its own nodes, and
 * `keep` carries anything from earlier scenes forward, in the state it was
 * left in, without writing it again:
 *
 * ```json
 * {"version": 1, "title": "Trade winds", "scenes": [
 *   {"nodes": [{"id": "map", "kit": "map", "focus": "Atlantic"}], "beats": [...]},
 *   {"keep": ["map"], "nodes": [{"id": "why", "kit": "list", ...}], "beats": [...]}
 * ]}
 * ```
 *
 * A plain scene document whose beats run past 6s is a one-scene lesson.
 */
export interface LessonDocument {
  readonly version: 1;
  readonly title?: string;
  readonly scenes: readonly LessonScene[];
}

export interface LessonScene {
  readonly title?: string;
  /** Ids of nodes or kits from earlier scenes to carry into this one. */
  readonly keep?: readonly string[];
  readonly nodes?: readonly unknown[];
  readonly beats?: readonly unknown[];
  readonly touches?: readonly unknown[];
}

/** One engine beat of a compiled lesson. */
export interface LessonPart {
  readonly id: string;
  readonly title: string;
  /** Which scene it belongs to, and which of that scene's beats it plays. */
  readonly scene: number;
  readonly beats: readonly number[];
  /** The core document this part plays, starting from where the last ended. */
  readonly document: SceneDocument;
  readonly source: string;
  readonly durationSeconds: number;
  /** Expanded node id to the kit it came from, for locating runtime findings. */
  readonly origins: Readonly<Record<string, string>>;
}

export interface CompiledLesson {
  readonly ok: boolean;
  readonly title: string;
  /** Located on what was written: `scenes.1.beats.3`, kit ids. */
  readonly issues: readonly Issue[];
  readonly parts: readonly LessonPart[];
  readonly durationSeconds: number;
}

/** Room left in each engine beat, as the single-beat fitter uses. */
const PART_BUDGET = MAX_BEAT_SECONDS - 0.2;
/** How long a scene with no beats is held on screen. */
const STILL_SECONDS = 2;

export function isLessonDocument(input: unknown): boolean {
  return isObject(input) && Array.isArray(input.scenes);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'lesson'
  );
}

function located(issue: Issue, prefix: string): Issue {
  if (!prefix) return issue;
  if (issue.step !== undefined) {
    return {...issue, step: `${prefix}.${issue.step}`};
  }
  return {...issue, message: `${prefix}: ${issue.message}`};
}

/** Where the beats of one scene leave every node: node id to prop to value. */
type State = Map<string, Map<string, Value>>;

function applySteps(state: State, steps: readonly Step[]): void {
  walkSteps(steps, step => {
    if (step.kind !== 'tween' && step.kind !== 'set') return;
    const value = step.kind === 'tween' ? step.to : step.value;
    if (!state.has(step.node)) state.set(step.node, new Map());
    state.get(step.node)!.set(step.prop, value);
  });
}

function withState(node: SceneNode, state: State): SceneNode {
  const own = state.get(node.id);
  if (!own?.size) return node;
  return {...node, props: {...(node.props ?? {}), ...Object.fromEntries(own)}};
}

/**
 * Compile a lesson (or a long scene document) into engine beats.
 *
 * @remarks
 * Nothing is generated if any scene has errors, the same contract as a
 * single beat. Each part is also validated again as a core document, so a
 * part that would fail on its own is reported here rather than on screen.
 */
export function compileLesson(
  input: unknown,
  options: {catalogue?: Catalogue} = {},
): CompiledLesson {
  const catalogue = options.catalogue ?? getCatalogue();
  const issues: Issue[] = [];
  const fail = (title: string): CompiledLesson => ({
    ok: false,
    title,
    issues,
    parts: [],
    durationSeconds: 0,
  });
  if (!isObject(input)) {
    issues.push({
      code: 'bad_document',
      severity: 'error',
      message: 'a lesson is a JSON object',
      hint: '{"version": 1, "title": "...", "scenes": [{"nodes": [...], "beats": [...]}]}',
    });
    return fail('lesson');
  }
  const lesson = isLessonDocument(input);
  const title =
    typeof input.title === 'string' && input.title ? input.title : 'Lesson';
  if (input.version !== 1) {
    issues.push({
      code: 'bad_version',
      severity: 'error',
      message: 'a lesson needs "version": 1',
    });
  }
  const scenes: LessonScene[] = lesson
    ? ((input.scenes as unknown[]).filter(isObject) as unknown as LessonScene[])
    : [input as unknown as LessonScene];
  if (lesson) {
    for (const key of Object.keys(input)) {
      if (!['version', 'title', 'scenes', 'touches'].includes(key)) {
        issues.push({
          code: 'bad_document',
          severity: 'error',
          message: `unknown lesson field "${key}"`,
          hint: 'a lesson has version, title, scenes and touches',
        });
      }
    }
  }
  // Touches written once for the whole lesson hold in every scene where both
  // things they name are on screen (a model writes them once, at the top).
  const lessonTouches: Record<string, Value>[] =
    lesson && Array.isArray(input.touches)
      ? (input.touches as Value[]).filter(isObject)
      : [];
  if (!scenes.length) {
    issues.push({
      code: 'bad_document',
      severity: 'error',
      message: 'a lesson needs at least one scene',
    });
  }
  for (const [index, scene] of scenes.entries()) {
    const extra = Object.keys(scene).filter(
      k =>
        !['title', 'keep', 'nodes', 'beats', 'touches'].includes(k) &&
        !(!lesson && ['version', 'timeline'].includes(k)),
    );
    for (const key of extra) {
      issues.push({
        code: 'bad_document',
        severity: 'error',
        message: `scenes.${index}: unknown field "${key}"`,
        hint: 'a scene has title, keep, nodes, beats and touches',
      });
    }
  }
  if (issues.some(i => i.severity === 'error')) return fail(title);

  // ---- which definition every scene sees ----------------------------------
  // A node carried by `keep` is the same definition in every scene it
  // reaches; a node written again is a new one.
  interface Definition {
    readonly key: string;
    readonly node: Record<string, Value>;
  }
  const visible: Map<string, Definition>[] = [];
  const sceneNodes: Definition[][] = [];
  let previous = new Map<string, Definition>();
  const everDefined = new Set<string>();
  scenes.forEach((scene, index) => {
    const prefix = lesson ? `scenes.${index}` : '';
    const here = new Map<string, Definition>();
    const list: Definition[] = [];
    for (const id of Array.isArray(scene.keep) ? scene.keep : []) {
      const carried = previous.get(id);
      if (typeof id !== 'string' || !carried) {
        const close = suggest(String(id), previous.keys());
        issues.push({
          code: 'unknown_ref',
          severity: 'error',
          message: `${prefix || 'lesson'}: keep "${id}" is not on screen in the scene before`,
          hint: close.length
            ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
            : everDefined.has(String(id))
              ? 'keep it in every scene between, or write it again'
              : 'keep names node or kit ids from the previous scene',
        });
        continue;
      }
      here.set(id, carried);
      list.push(carried);
    }
    for (const raw of Array.isArray(scene.nodes) ? scene.nodes : []) {
      if (!isObject(raw) || typeof raw.id !== 'string') {
        // Left for the scene's own validation to report.
        list.push({key: `${index}:?`, node: raw as Record<string, Value>});
        continue;
      }
      if (here.has(raw.id)) {
        issues.push({
          code: 'duplicate_id',
          severity: 'error',
          node: raw.id,
          message: `${prefix}: "${raw.id}" is kept and also written again`,
          hint: 'keep it, or write a new one - not both',
        });
        continue;
      }
      const definition = {key: `${index}:${raw.id}`, node: raw};
      here.set(raw.id, definition);
      list.push(definition);
      everDefined.add(raw.id);
    }
    visible.push(here);
    sceneNodes.push(list);
    previous = here;
  });
  if (issues.some(i => i.severity === 'error')) return fail(title);

  // ---- expand every kit the same way in every scene it appears in ---------
  const references = new Map<
    string,
    {highlighted: Set<string>; referenced: Set<string>; shown: Set<string>}
  >();
  scenes.forEach((scene, index) => {
    for (const [kitId, refs] of beatReferences(scene.beats)) {
      const definition = visible[index].get(kitId);
      if (!definition) continue;
      const entry = references.get(definition.key) ?? {
        highlighted: new Set<string>(),
        referenced: new Set<string>(),
        shown: new Set<string>(),
      };
      refs.highlighted.forEach(r => entry.highlighted.add(r));
      refs.shown?.forEach(r => entry.shown.add(r));
      refs.referenced.forEach(r => entry.referenced.add(r));
      references.set(definition.key, entry);
    }
  });

  const sceneDocumentFor = (
    index: number,
    settledNow: ReadonlyMap<string, Record<string, Value>>,
  ) => {
    const scene = scenes[index];
    return {
      version: 1,
      ...(scene.title ? {title: scene.title} : {}),
      nodes: sceneNodes[index].map(d => settledNow.get(d.key) ?? d.node),
      beats: Array.isArray(scene.beats) ? scene.beats : [],
      ...(() => {
        const own = Array.isArray(scene.touches) ? scene.touches : [];
        const here = (target: Value | undefined) =>
          typeof target === 'string' &&
          (target === '*' ||
            visible[index].has(target.split('.')[0]) ||
            sceneNodes[index].some(d => d.node.id === target.split('.')[0]));
        const shared = lessonTouches.filter(t => here(t.a) && here(t.b));
        const all = [...own, ...shared];
        return all.length ? {touches: all} : {};
      })(),
    };
  };
  const refsFor = (index: number) => {
    const kitRefs = new Map<string, KitReferences>();
    for (const [id, definition] of visible[index]) {
      const refs = references.get(definition.key);
      if (refs) kitRefs.set(id, refs);
    }
    return kitRefs;
  };

  // ---- every version of each kit over the whole lesson --------------------
  // A kit kept from scene to scene is fitted to all of its versions, so it
  // does not reframe (and its items keep who they are) at a scene change.
  const lessonFrames = new Map<string, KitNode[]>();
  if (scenes.length > 1) {
    const settledFirst = new Map<string, Record<string, Value>>();
    for (let index = 0; index < scenes.length; index++) {
      const prepared = prepareDocument(sceneDocumentFor(index, settledFirst), catalogue, {
        split: true,
        references: refsFor(index),
      });
      if (prepared.issues.some(i => i.severity === 'error')) break;
      for (const [id, list] of Object.entries(prepared.kitVariants ?? {})) {
        const definition = visible[index].get(id);
        if (!definition) continue;
        const all = lessonFrames.get(definition.key) ?? [];
        all.push(...list);
        lessonFrames.set(definition.key, all);
      }
      for (const [id, node] of Object.entries(prepared.kitStates ?? {})) {
        const definition = visible[index].get(id);
        if (definition) {
          settledFirst.set(definition.key, node as unknown as Record<string, Value>);
        }
      }
    }
  }

  // ---- compile each scene, then split it into parts ------------------------
  const parts: LessonPart[] = [];
  let state: State = new Map();
  // A kit a scene changed with `set` is carried on in its changed form.
  const settled = new Map<string, Record<string, Value>>();
  let previousOrigins: Record<string, string> = {};
  const lessonSlug = slug(title);
  for (const [index, scene] of scenes.entries()) {
    const prefix = lesson ? `scenes.${index}` : '';
    const kitRefs = refsFor(index);
    const sceneDocument = sceneDocumentFor(index, settled);
    const frames = new Map<string, readonly KitNode[]>();
    for (const [id, definition] of visible[index]) {
      const all = lessonFrames.get(definition.key);
      // Only a kit that lives in more than one scene needs the lesson's frame.
      if (all && visible.filter(v => [...v.values()].some(d => d.key === definition.key)).length > 1) {
        frames.set(id, all);
      }
    }
    const prepared = prepareDocument(sceneDocument, catalogue, {
      split: true,
      references: kitRefs,
      ...(frames.size ? {frames} : {}),
    });
    issues.push(...prepared.issues.map(i => located(i, prefix)));
    if (prepared.issues.some(i => i.severity === 'error')) continue;
    const core = prepared.document as SceneDocument;
    for (const [id, node] of Object.entries(prepared.kitStates ?? {})) {
      const definition = visible[index].get(id);
      if (definition) {
        settled.set(definition.key, node as unknown as Record<string, Value>);
      }
    }
    const origins = prepared.origins;
    const beatSteps = prepared.beatSteps ?? [];

    // State carries only into what this scene kept from the one before.
    const kept = new Set(Array.isArray(scene.keep) ? scene.keep : []);
    const carried: State = new Map();
    for (const [nodeId, props] of state) {
      const owner = previousOrigins[nodeId] ?? nodeId;
      if (kept.has(owner)) carried.set(nodeId, props);
    }
    state = carried;

    // Group top-level steps by beat, then pack beats into parts.
    const beats: {beat: number; steps: Step[]}[] = [];
    core.timeline.forEach((step, i) => {
      const beat = beatSteps[i] ?? 0;
      const last = beats[beats.length - 1];
      if (last && last.beat === beat) last.steps.push(step);
      else beats.push({beat, steps: [step]});
    });
    const groups: {beats: number[]; steps: Step[]}[] = [];
    let current: {beats: number[]; steps: Step[]} = {beats: [], steps: []};
    for (const {beat, steps} of beats) {
      let beatSteps = steps;
      if (timelineDuration(beatSteps) > PART_BUDGET) {
        const fitted = fitToBudget(beatSteps);
        issues.push(
          located(
            {
              code: 'long',
              severity: 'warning',
              step: `beats.${beat}`,
              message: `this beat alone ran ${fitted.before.toFixed(2)}s and was compressed to ${fitted.after.toFixed(2)}s`,
              hint: 'split it into two beats',
            },
            prefix,
          ),
        );
        beatSteps = fitted.timeline;
      }
      if (
        current.steps.length &&
        timelineDuration([...current.steps, ...beatSteps]) > PART_BUDGET
      ) {
        groups.push(current);
        current = {beats: [], steps: []};
      }
      current.beats.push(beat);
      current.steps.push(...beatSteps);
    }
    if (current.steps.length || !groups.length) {
      if (!current.steps.length) {
        current.steps.push({kind: 'wait', seconds: STILL_SECONDS});
      }
      groups.push(current);
    }

    for (const group of groups) {
      const document: SceneDocument = {
        ...core,
        title: scene.title ?? title,
        nodes: core.nodes.map(node => withState(node, state)),
        timeline: group.steps,
      };
      const generated = generateBeatSource(document, {catalogue});
      const partIssues = generated.issues
        // Kit motion is intended; the scene-level check already ran.
        .filter(i => i.severity === 'error')
        .map(i =>
          located(
            i.node !== undefined && origins[i.node]
              ? {
                  ...i,
                  node: origins[i.node],
                  hint: `${i.hint ? `${i.hint}; ` : ''}in ${i.node}`,
                }
              : i,
            `${prefix ? `${prefix}, ` : ''}part ${parts.length + 1}`,
          ),
        );
      issues.push(...partIssues);
      applySteps(state, group.steps);
      parts.push({
        id: `${lessonSlug}-${parts.length + 1}`,
        title: scene.title ?? title,
        scene: index,
        beats: group.beats,
        document,
        source: generated.source,
        durationSeconds: generated.durationSeconds,
        origins,
      });
    }
    previousOrigins = origins;
  }

  const ok =
    !issues.some(i => i.severity === 'error') &&
    parts.length > 0 &&
    parts.every(p => p.source);
  return {
    ok,
    title,
    issues,
    parts: ok ? parts : [],
    durationSeconds: ok
      ? Math.round(
          parts.reduce((sum, p) => sum + p.durationSeconds, 0) * 1000,
        ) / 1000
      : 0,
  };
}
