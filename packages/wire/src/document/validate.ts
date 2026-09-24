import {
  getCatalogue,
  getComponent,
  getProp,
  isA,
  isTextComponent,
  isTweenableKind,
  suggest,
  suggestProp,
} from '../catalogue/index.js';
import type {Catalogue, ComponentSpec} from '../catalogue/types.js';
import {texProblem} from '../tex/terms.js';
import {
  constructionOrder,
  finalOpacities,
  initialOpacities,
  timelineDuration,
  walkSteps,
} from './analysis.js';
import type {Issue} from './issues.js';
import {
  COMFORTABLE_BEAT_SECONDS,
  MAX_BEAT_SECONDS,
  SAFE_HALF_HEIGHT,
  SAFE_HALF_WIDTH,
  STEP_KINDS,
  type SceneDocument,
  type SceneNode,
  type Step,
  type Value,
} from './model.js';
import {checkValue, isObject, type ValueRef} from './values.js';

const ID_PATTERN = /^[a-z][A-Za-z0-9_]{0,39}$/;

/**
 * Names a node id may not take, because the generated module already uses
 * them (imports, the scene parameter) or JavaScript reserves them.
 */
const RESERVED_IDS = new Set([
  // generated-module identifiers
  'view',
  'theme',
  'typeScale',
  'all',
  'sequence',
  'chain',
  'waitFor',
  'delay',
  'makeScene2D',
  'buildAuditSpec',
  'linear',
  'exports',
  'require',
  'module',
  // JavaScript reserved words and troublesome globals
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'arguments',
  'eval',
  'undefined',
  'window',
  'document',
  'globalThis',
  'console',
]);

const DOCUMENT_KEYS = ['version', 'title', 'nodes', 'timeline', 'touches'];
const NODE_KEYS = [
  'id',
  'component',
  'props',
  'parent',
  'role',
  'halo',
  'fixed',
];
const STEP_KEYS: Record<Step['kind'], string[]> = {
  wait: ['kind', 'seconds'],
  tween: ['kind', 'node', 'prop', 'to', 'seconds', 'easing'],
  set: ['kind', 'node', 'prop', 'value'],
  all: ['kind', 'steps'],
  sequence: ['kind', 'delay', 'steps'],
  chain: ['kind', 'steps'],
};

/** Props whose animation sweeps a node's footprint across the stage. */
const FOOTPRINT_PROPS = new Set([
  'position',
  'x',
  'y',
  'scale',
  'width',
  'height',
  'size',
]);

// The same patterns as the engine's blocking `plain-text-math-notation`
// audit rule (packages/2d/src/lib/audit/textNotation.ts), so a document is
// refused here, with a location, instead of after a render.
const PLAIN_TEXT_MATH: readonly [RegExp, string][] = [
  [/\\[a-zA-Z]+|[_^]\{/, 'looks like un-rendered LaTeX command syntax'],
  [/[a-zA-Z0-9]\s*(<=|>=|!=)\s*[a-zA-Z0-9]/, 'looks like an inequality chain'],
  [/[a-zA-Z0-9]\^[a-zA-Z0-9]/, 'looks like caret-exponent notation'],
  [
    /\b[a-zA-Z]\w{0,3}\s*=\s*[a-zA-Z0-9][a-zA-Z0-9+\-*/^.]*\b/,
    'looks like an algebraic equation',
  ],
];

export interface ValidateOptions {
  readonly catalogue?: Catalogue;
}

/**
 * Check a document against the catalogue and the engine's beat rules.
 *
 * @remarks
 * Accepts `unknown` on purpose: this is the first thing that sees a model's
 * output, so it must survive any shape and report what is wrong rather than
 * throw. An empty issue list (or warnings only) means `generateBeatSource`
 * will produce a module that compiles and satisfies every static rule the
 * audit enforces; what is left for the render is real geometry.
 */
export function validateCoreDocument(
  input: unknown,
  options: ValidateOptions = {},
): Issue[] {
  const catalogue = options.catalogue ?? getCatalogue();
  const issues: Issue[] = [];
  const error = (issue: Omit<Issue, 'severity'>) =>
    issues.push({...issue, severity: 'error'});
  const warn = (issue: Omit<Issue, 'severity'>) =>
    issues.push({...issue, severity: 'warning'});

  if (!isObject(input)) {
    error({
      code: 'bad_document',
      message: 'the document must be a JSON object',
    });
    return issues;
  }
  for (const key of Object.keys(input)) {
    if (!DOCUMENT_KEYS.includes(key)) {
      error({
        code: 'bad_document',
        message: `unknown top-level key "${key}"`,
        hint: `a document has only ${DOCUMENT_KEYS.join(', ')}`,
      });
    }
  }
  if (input.version !== 1) {
    error({
      code: 'bad_version',
      message: `"version" must be 1, got ${JSON.stringify(input.version)}`,
    });
  }
  if (input.title !== undefined && typeof input.title !== 'string') {
    error({code: 'bad_document', message: '"title" must be a string'});
  }
  if (!Array.isArray(input.nodes)) {
    error({code: 'bad_document', message: '"nodes" must be a list'});
    return issues;
  }
  if (!Array.isArray(input.timeline)) {
    error({
      code: 'bad_document',
      message: '"timeline" must be a list (it may be empty)',
    });
    return issues;
  }

  // ---- nodes -------------------------------------------------------------
  const nodes: SceneNode[] = [];
  const components = new Map<string, ComponentSpec>();
  const seen = new Set<string>();
  const refsByNode = new Map<string, {prop: string; ref: ValueRef}[]>();

  input.nodes.forEach((raw, index) => {
    if (!isObject(raw)) {
      error({
        code: 'bad_document',
        message: `nodes[${index}] must be an object`,
      });
      return;
    }
    const id = raw.id;
    if (typeof id !== 'string') {
      error({code: 'bad_id', message: `nodes[${index}] has no string "id"`});
      return;
    }
    const at = {node: id};
    if (!ID_PATTERN.test(id)) {
      error({
        ...at,
        code: 'bad_id',
        message: `id "${id}" is not a lower-camel identifier`,
        hint: 'start with a lowercase letter; letters, digits and _ only (e.g. "eqStep1")',
      });
    } else if (RESERVED_IDS.has(id)) {
      error({
        ...at,
        code: 'bad_id',
        message: `id "${id}" is reserved by the generated module`,
        hint: `rename it, e.g. "${id}Node"`,
      });
    }
    if (seen.has(id)) {
      error({
        ...at,
        code: 'duplicate_id',
        message: `id "${id}" is used by more than one node`,
      });
      return;
    }
    seen.add(id);

    for (const key of Object.keys(raw)) {
      if (!NODE_KEYS.includes(key)) {
        const hint =
          key === 'type' || key === 'kind'
            ? 'the component name goes in "component"'
            : key === 'children'
              ? 'nest a node by giving the child "parent": "<id>"'
              : `a node has only ${NODE_KEYS.join(', ')}`;
        error({
          ...at,
          code: 'bad_document',
          message: `unknown node key "${key}"`,
          hint,
        });
      }
    }

    const node = raw as unknown as SceneNode;
    nodes.push(node);

    if (typeof raw.component !== 'string') {
      error({
        ...at,
        code: 'unknown_component',
        message: 'the node has no string "component"',
      });
      return;
    }
    const component = getComponent(raw.component, catalogue);
    if (!component) {
      const close = suggest(raw.component, Object.keys(catalogue.components));
      error({
        ...at,
        code: 'unknown_component',
        message: `"${raw.component}" is not a catalogue component`,
        hint: close.length
          ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
          : 'list the catalogue to see every component',
      });
      return;
    }
    components.set(id, component);

    if (raw.props !== undefined && !isObject(raw.props)) {
      error({
        ...at,
        code: 'bad_document',
        message: '"props" must be an object',
      });
      return;
    }
    const props = (raw.props ?? {}) as Record<string, Value>;
    const refs: {prop: string; ref: ValueRef}[] = [];
    for (const [name, value] of Object.entries(props)) {
      const spec = getProp(component, name);
      if (!spec) {
        if (catalogue.unsupportedProps[component.name]?.includes(name)) {
          error({
            ...at,
            prop: name,
            code: 'unsupported_prop',
            message: `${component.name}.${name} exists but cannot be set from a document`,
          });
        } else {
          const close = suggestProp(component, name);
          error({
            ...at,
            prop: name,
            code: 'unknown_prop',
            message: `${component.name} has no prop "${name}"`,
            hint: close.length
              ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
              : undefined,
          });
        }
        continue;
      }
      const {problem, refs: found} = checkValue(value, spec.type, catalogue);
      if (problem) {
        error({
          ...at,
          prop: name,
          code: 'bad_value',
          message: problem.message,
          hint: problem.hint,
        });
      }
      found.forEach(ref => refs.push({prop: name, ref}));
    }
    refsByNode.set(id, refs);

    for (const [name, spec] of Object.entries(component.props)) {
      if (spec.required && props[name] === undefined) {
        error({
          ...at,
          prop: name,
          code: 'missing_required',
          message: `${component.name} requires "${name}"`,
        });
      }
    }

    if (raw.role !== undefined) {
      if (!isTextComponent(component)) {
        error({
          ...at,
          code: 'bad_role',
          message: `"role" only applies to text components, not ${component.name}`,
        });
      } else if (
        typeof raw.role !== 'string' ||
        !catalogue.textRoles.includes(raw.role)
      ) {
        error({
          ...at,
          code: 'bad_role',
          message: `unknown text role ${JSON.stringify(raw.role)}`,
          hint: `one of ${catalogue.textRoles.join(', ')}`,
        });
      }
    }
    if (
      raw.halo !== undefined &&
      (typeof raw.halo !== 'number' || raw.halo < 0 || raw.halo > 40)
    ) {
      error({
        ...at,
        code: 'bad_halo',
        message: '"halo" must be a number from 0 to 40',
      });
    }
    if (raw.fixed !== undefined && typeof raw.fixed !== 'boolean') {
      error({
        ...at,
        code: 'bad_document',
        message: '"fixed" must be true or false',
      });
    }

    // Text content the audit would reject.
    if (isA(component, 'Txt')) {
      const text = props.text;
      if (typeof text === 'string') {
        for (const [pattern, why] of PLAIN_TEXT_MATH) {
          if (pattern.test(text)) {
            error({
              ...at,
              prop: 'text',
              code: 'plain_text_math',
              message: `text ${JSON.stringify(text)} ${why}`,
              hint: 'put math in a Latex node (tex), and keep Txt for words',
            });
            break;
          }
        }
      }
    }

    // Stage bounds for explicitly placed top-level nodes.
    if (raw.parent === undefined) {
      const [x, y] = explicitPosition(props);
      if (
        (x !== null && Math.abs(x) > SAFE_HALF_WIDTH) ||
        (y !== null && Math.abs(y) > SAFE_HALF_HEIGHT)
      ) {
        warn({
          ...at,
          prop: 'position',
          code: 'outside_safe_area',
          message: `position (${x ?? '?'}, ${y ?? '?'}) is outside the safe area`,
          hint: `the stage centre is (0, 0); keep x within ±${SAFE_HALF_WIDTH} and y within ±${SAFE_HALF_HEIGHT}`,
        });
      }
    }
  });

  const byId = new Map(nodes.map(node => [node.id, node]));

  // ---- parents -----------------------------------------------------------
  for (const node of nodes) {
    if (node.parent === undefined) continue;
    const at = {node: node.id};
    if (typeof node.parent !== 'string' || !byId.has(node.parent)) {
      error({
        ...at,
        code: 'unknown_parent',
        message: `parent ${JSON.stringify(node.parent)} is not a node id`,
      });
      continue;
    }
    const chainSeen = new Set([node.id]);
    let current: string | undefined = node.parent;
    while (current !== undefined) {
      if (chainSeen.has(current)) {
        error({
          ...at,
          code: 'parent_cycle',
          message: `node "${node.id}" is (indirectly) its own parent`,
        });
        break;
      }
      chainSeen.add(current);
      current = byId.get(current)?.parent;
    }
  }

  // ---- references ----------------------------------------------------------
  for (const [id, refs] of refsByNode) {
    const component = components.get(id)!;
    const node = byId.get(id)!;
    for (const {prop, ref} of refs) {
      const at = {node: id, prop};
      if (ref.ref === id) {
        error({
          ...at,
          code: 'bad_ref',
          message: 'a node cannot reference itself',
        });
        continue;
      }
      const target = byId.get(ref.ref);
      const targetComponent = components.get(ref.ref);
      if (!target) {
        const close = suggest(ref.ref, byId.keys());
        error({
          ...at,
          code: 'unknown_ref',
          message: `reference to unknown node "${ref.ref}"`,
          hint: close.length
            ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
            : undefined,
        });
        continue;
      }
      if (!targetComponent) continue;
      const spec = getProp(component, prop)!;
      if (
        spec.type.kind === 'node' &&
        spec.type.component &&
        !isA(targetComponent, spec.type.component)
      ) {
        error({
          ...at,
          code: 'bad_ref',
          message: `"${prop}" must reference a ${spec.type.component}, but "${ref.ref}" is a ${targetComponent.name}`,
        });
      }
      if (ref.via === 'endpoint') {
        if (
          ref.side !== undefined &&
          ref.side !== 'center' &&
          !isA(targetComponent, 'Layout')
        ) {
          error({
            ...at,
            code: 'bad_ref',
            message: `"${ref.ref}" is a ${targetComponent.name}, which has no "${ref.side}" side`,
            hint: 'omit "side" to attach to its position',
          });
        }
        if ((target.parent ?? null) !== (node.parent ?? null)) {
          error({
            ...at,
            code: 'bad_ref',
            message: `"${id}" and "${ref.ref}" have different parents, so the endpoint would be measured in the wrong space`,
            hint: 'give the connector the same "parent" as the node it attaches to',
          });
        }
      }
    }
  }
  if (
    issues.every(issue => issue.code !== 'unknown_ref') &&
    constructionOrder({version: 1, nodes, timeline: []}, catalogue) === null
  ) {
    error({
      code: 'ref_cycle',
      message:
        'node references form a cycle (e.g. two labels anchored to each other)',
    });
  }

  // ---- timeline ----------------------------------------------------------
  let timelineShapeOk = true;
  walkSteps(input.timeline as Step[], (raw, path) => {
    const at = {step: path};
    if (!isObject(raw)) {
      error({...at, code: 'bad_step', message: 'a step must be an object'});
      timelineShapeOk = false;
      return;
    }
    const kind = raw.kind;
    if (
      typeof kind !== 'string' ||
      !(STEP_KINDS as readonly string[]).includes(kind)
    ) {
      error({
        ...at,
        code: 'bad_step',
        message: `unknown step kind ${JSON.stringify(kind)}`,
        hint: `one of ${STEP_KINDS.join(', ')}`,
      });
      timelineShapeOk = false;
      return;
    }
    const step = raw as unknown as Step;
    for (const key of Object.keys(raw)) {
      if (!STEP_KEYS[step.kind].includes(key)) {
        error({
          ...at,
          code: 'bad_step',
          message: `unknown key "${key}" on a ${step.kind} step`,
          hint: `a ${step.kind} step has ${STEP_KEYS[step.kind].join(', ')}`,
        });
      }
    }

    switch (step.kind) {
      case 'wait':
        if (!isNonNegative(step.seconds)) {
          error({
            ...at,
            code: 'bad_duration',
            message: '"seconds" must be a number >= 0',
          });
        }
        return;
      case 'all':
      case 'chain':
      case 'sequence':
        if (!Array.isArray(step.steps) || step.steps.length === 0) {
          error({
            ...at,
            code: 'bad_step',
            message: `a ${step.kind} step needs a non-empty "steps" list`,
          });
          timelineShapeOk = false;
        }
        if (step.kind === 'sequence' && !isNonNegative(step.delay)) {
          error({
            ...at,
            code: 'bad_duration',
            message: '"delay" must be a number >= 0',
          });
        }
        return;
      case 'tween':
      case 'set': {
        const node =
          typeof step.node === 'string' ? byId.get(step.node) : undefined;
        const nodeAt = {
          ...at,
          ...(typeof step.node === 'string' ? {node: step.node} : {}),
        };
        if (!node) {
          const close =
            typeof step.node === 'string'
              ? suggest(step.node, byId.keys())
              : [];
          error({
            ...nodeAt,
            code: 'unknown_node',
            message: `step targets unknown node ${JSON.stringify(step.node)}`,
            hint: close.length
              ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
              : undefined,
          });
          return;
        }
        const component = components.get(node.id);
        if (!component) return;
        const propAt = {
          ...nodeAt,
          ...(typeof step.prop === 'string' ? {prop: step.prop} : {}),
        };
        const spec =
          typeof step.prop === 'string'
            ? getProp(component, step.prop)
            : undefined;
        if (!spec) {
          const close =
            typeof step.prop === 'string'
              ? suggestProp(component, step.prop)
              : [];
          error({
            ...propAt,
            code: 'unknown_prop',
            message: `${component.name} has no prop ${JSON.stringify(step.prop)}`,
            hint: close.length
              ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
              : undefined,
          });
          return;
        }
        const value = step.kind === 'tween' ? step.to : step.value;
        const {problem, refs} = checkValue(value, spec.type, catalogue);
        if (problem) {
          error({
            ...propAt,
            code: 'bad_value',
            message: problem.message,
            hint: problem.hint,
          });
        }
        for (const ref of refs) {
          if (!byId.has(ref.ref)) {
            error({
              ...propAt,
              code: 'unknown_ref',
              message: `reference to unknown node "${ref.ref}"`,
            });
          }
        }
        if (step.kind === 'tween') {
          if (!spec.tweenable || !isTweenableKind(spec.type)) {
            error({
              ...propAt,
              code: 'not_tweenable',
              message: `${component.name}.${step.prop} cannot be animated`,
              hint: 'use a "set" step to change it instantly',
            });
          }
          if (
            !(
              typeof step.seconds === 'number' &&
              step.seconds > 0 &&
              Number.isFinite(step.seconds)
            )
          ) {
            error({
              ...propAt,
              code: 'bad_duration',
              message: '"seconds" must be a number > 0',
            });
          }
          if (
            step.easing !== undefined &&
            (typeof step.easing !== 'string' ||
              !catalogue.easings.includes(step.easing))
          ) {
            const close =
              typeof step.easing === 'string'
                ? suggest(step.easing, catalogue.easings)
                : [];
            error({
              ...propAt,
              code: 'bad_easing',
              message: `unknown easing ${JSON.stringify(step.easing)}`,
              hint: close.length
                ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
                : `e.g. "easeInOutCubic", "linear"`,
            });
          }
          if (FOOTPRINT_PROPS.has(step.prop)) {
            warn({
              ...propAt,
              code: 'moves_node',
              message: `animating ${step.prop} sweeps "${node.id}" across the stage`,
              hint: 'the audit checks frames mid-animation, so the path must be empty; for an entrance, animate opacity instead',
            });
          }
        }
        return;
      }
    }
  });

  if (timelineShapeOk) {
    const seconds = timelineDuration(input.timeline as Step[]);
    if (seconds > MAX_BEAT_SECONDS) {
      error({
        code: 'too_long',
        message: `the timeline runs ${seconds.toFixed(2)}s; a beat may not exceed ${MAX_BEAT_SECONDS}s`,
        hint: 'shorten waits and tweens, or split the idea into two beats',
      });
    } else if (seconds > COMFORTABLE_BEAT_SECONDS) {
      warn({
        code: 'long',
        message: `the timeline runs ${seconds.toFixed(2)}s; beats read best under ${COMFORTABLE_BEAT_SECONDS}s`,
      });
    }
  }

  // ---- visibility ------------------------------------------------------------
  const document = {
    version: 1,
    nodes,
    timeline: (timelineShapeOk ? input.timeline : []) as Step[],
  } as SceneDocument;
  if (nodes.length > 0) {
    const initial = initialOpacities(document);
    if (![...initial.values()].some(opacity => opacity > 0.01)) {
      error({
        code: 'blank_first_frame',
        message: 'every node starts invisible, so the first frame is blank',
        hint: 'a beat is judged and first shown at frame 0 - start the main content visible and fade in only secondary parts',
      });
    }
    for (const node of nodes) {
      const component = components.get(node.id);
      if (!component || (initial.get(node.id) ?? 1) <= 0.01) continue;
      const props = node.props ?? {};
      const emptyText =
        isA(component, 'Txt') &&
        (typeof props.text !== 'string' || props.text.trim() === '');
      const emptyTex =
        isA(component, 'Latex') &&
        (props.tex === undefined ||
          props.tex === '' ||
          (Array.isArray(props.tex) && props.tex.length === 0));
      if (emptyText || emptyTex) {
        error({
          node: node.id,
          prop: emptyTex ? 'tex' : 'text',
          code: 'empty_content',
          message: `"${node.id}" is visible but has no ${emptyTex ? 'tex' : 'text'}, so it has empty bounds`,
          hint: 'give it content, or start it at opacity 0 until it has some',
        });
      }
    }
    if (timelineShapeOk && document.timeline.length > 0) {
      const final = finalOpacities(document);
      if (![...final.values()].some(opacity => opacity > 0.01)) {
        warn({
          code: 'ends_blank',
          message: 'the beat ends with every node invisible',
          hint: 'beats loop, so an exit fade flickers once per pass - end on the finished picture',
        });
      }
    }
  }

  // ---- LaTeX that would not typeset -----------------------------------------
  // The engine throws on it when the beat renders; MathJax, set up the way
  // the engine sets it up, says so here, on the node or step that has it.
  const latexIds = new Set(
    nodes
      .filter(n => {
        const component = components.get(n.id);
        return component !== undefined && isA(component, 'Latex');
      })
      .map(n => n.id),
  );
  const isTex = (v: unknown): v is string | string[] =>
    typeof v === 'string' ||
    (Array.isArray(v) && v.length > 0 && v.every(t => typeof t === 'string'));
  const texError = (tex: string | string[], at: Partial<Issue>) => {
    const problem = texProblem(tex);
    if (!problem) return;
    error({
      ...at,
      code: 'bad_tex',
      message: `LaTeX will not typeset: ${problem}`,
      hint: `in ${JSON.stringify(typeof tex === 'string' ? tex : tex.join(''))}; check braces, and that every command has its arguments`,
    });
  };
  for (const node of nodes) {
    if (latexIds.has(node.id) && isTex(node.props?.tex)) {
      texError(node.props!.tex as string | string[], {
        node: node.id,
        prop: 'tex',
      });
    }
  }
  if (timelineShapeOk) {
    const visit = (steps: readonly Step[], prefix: string) =>
      steps.forEach((step, i) => {
        const at = prefix ? `${prefix}.${i}` : String(i);
        if (
          step.kind === 'all' ||
          step.kind === 'chain' ||
          step.kind === 'sequence'
        ) {
          visit(step.steps, `${at}.steps`);
        } else if (
          (step.kind === 'tween' || step.kind === 'set') &&
          step.prop === 'tex' &&
          latexIds.has(step.node)
        ) {
          const value = step.kind === 'tween' ? step.to : step.value;
          if (isTex(value)) {
            texError(value, {node: step.node, prop: 'tex', step: at});
          }
        }
      });
    visit(document.timeline, '');
  }

  // ---- touches -----------------------------------------------------------
  if (input.touches !== undefined) {
    if (!Array.isArray(input.touches)) {
      error({code: 'bad_touch', message: '"touches" must be a list'});
    } else {
      input.touches.forEach((touch, index) => {
        if (
          !isObject(touch) ||
          typeof touch.a !== 'string' ||
          typeof touch.b !== 'string'
        ) {
          error({
            code: 'bad_touch',
            message: `touches[${index}] must be {"a": id, "b": id | "*", "reason": text}`,
          });
          return;
        }
        const at = {node: touch.a};
        if (!byId.has(touch.a)) {
          error({
            ...at,
            code: 'bad_touch',
            message: `touches[${index}] names unknown node "${touch.a}"`,
          });
        }
        if (touch.b !== '*' && !byId.has(touch.b)) {
          error({
            ...at,
            code: 'bad_touch',
            message: `touches[${index}] names unknown node "${touch.b}"`,
          });
        }
        if (touch.a === touch.b) {
          error({
            ...at,
            code: 'bad_touch',
            message: `touches[${index}] pairs a node with itself`,
          });
        }
        if (
          typeof touch.reason !== 'string' ||
          touch.reason.trim().length < 3
        ) {
          error({
            ...at,
            code: 'bad_touch',
            message: `touches[${index}] needs a real "reason"`,
            hint: 'the audit refuses an authorization without one',
          });
        }
      });
    }
  }

  return issues;
}

function isNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function explicitPosition(
  props: Record<string, Value>,
): [number | null, number | null] {
  let x: number | null = typeof props.x === 'number' ? props.x : null;
  let y: number | null = typeof props.y === 'number' ? props.y : null;
  const position = props.position;
  if (
    Array.isArray(position) &&
    typeof position[0] === 'number' &&
    typeof position[1] === 'number'
  ) {
    [x, y] = [position[0], position[1]];
  } else if (
    isObject(position) &&
    typeof position.x === 'number' &&
    typeof position.y === 'number'
  ) {
    [x, y] = [position.x, position.y];
  } else if (typeof position === 'number') {
    [x, y] = [position, position];
  }
  return [x, y];
}
