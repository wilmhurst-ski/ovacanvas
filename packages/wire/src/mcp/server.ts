import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import {z} from 'zod';
import {
  describeComponent,
  getCatalogue,
  getComponent,
  listComponents,
  suggest,
} from '../catalogue/index.js';
import {generateBeatSource} from '../codegen/generate.js';
import {applyEdit, type EditOp} from '../document/edit.js';
import {formatIssues, hasErrors, type Issue} from '../document/issues.js';
import {emptyDocument, type SceneDocument} from '../document/model.js';
import {KITS, validateDocument} from '../document/prepare.js';
import {
  compileLesson,
  isLessonDocument,
  type CompiledLesson,
} from '../lesson/compile.js';
import {compileDocument} from '../node/compile.js';
import {
  PreviewRenderer,
  type LessonOutcome,
  type PreviewOutcome,
} from '../node/preview.js';
import {
  coreComponentReference,
  documentReference,
  kitReference,
} from '../reference.js';

interface Scene {
  document: SceneDocument;
  /** File the scene is saved to after every successful edit, if any. */
  file?: string;
  lastRender?: PreviewOutcome;
}

export interface WireServerOptions {
  /** Directory relative scene paths resolve against. Defaults to the cwd. */
  readonly workspace?: string;
  /** Injected so tests can run without a browser. */
  readonly renderer?: Pick<
    PreviewRenderer,
    'render' | 'renderLesson' | 'close'
  >;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function text(value: string) {
  return {content: [{type: 'text' as const, text: value}]};
}

function failure(value: string) {
  return {content: [{type: 'text' as const, text: value}], isError: true};
}

function summarizeIssues(issues: readonly Issue[]) {
  return {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    issues,
  };
}

/** Ops accepted by `edit_scene`, spelled out so clients can show the shape. */
const EDIT_OP = z.union([
  z.object({op: z.literal('set_title'), title: z.string()}),
  z.object({
    op: z.literal('add_node'),
    node: z
      .object({
        id: z.string(),
        component: z
          .string()
          .optional()
          .describe('a catalogue component, or...'),
        kit: z
          .string()
          .optional()
          .describe("...a kit name, with the kit's fields alongside"),
        props: z.record(z.string(), z.any()).optional(),
        parent: z.string().optional(),
        role: z.string().optional(),
        halo: z.number().optional(),
      })
      .passthrough(),
    index: z.number().int().optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string(),
    props: z
      .record(z.string(), z.any())
      .optional()
      .describe('props to set, merged over existing ones'),
    unset: z.array(z.string()).optional().describe('prop names to remove'),
    parent: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    halo: z.number().nullable().optional(),
    fixed: z.boolean().nullable().optional(),
    fields: z
      .record(z.string(), z.any())
      .optional()
      .describe('for a kit instance: fields to set (null removes one)'),
  }),
  z.object({op: z.literal('remove_node'), id: z.string()}),
  z.object({
    op: z.literal('set_beats'),
    beats: z.array(z.record(z.string(), z.any())),
  }),
  z.object({
    op: z.literal('add_beat'),
    beat: z.record(z.string(), z.any()),
    index: z.number().int().optional(),
  }),
  z.object({
    op: z.literal('replace_beat'),
    index: z.number().int(),
    beat: z.record(z.string(), z.any()),
  }),
  z.object({op: z.literal('remove_beat'), index: z.number().int()}),
  z.object({op: z.literal('rename_node'), id: z.string(), to: z.string()}),
  z.object({
    op: z.literal('add_step'),
    step: z.record(z.string(), z.any()),
    index: z.number().int().optional(),
  }),
  z.object({
    op: z.literal('replace_step'),
    index: z.number().int(),
    step: z.record(z.string(), z.any()),
  }),
  z.object({op: z.literal('remove_step'), index: z.number().int()}),
  z.object({
    op: z.literal('set_timeline'),
    timeline: z.array(z.record(z.string(), z.any())),
  }),
  z.object({
    op: z.literal('add_touch'),
    touch: z.object({a: z.string(), b: z.string(), reason: z.string()}),
  }),
  z.object({op: z.literal('remove_touch'), a: z.string(), b: z.string()}),
]);

/**
 * The OvaCanvas wire MCP server.
 *
 * @remarks
 * Two ways to work, both backed by the same validator:
 * - **Incremental** - `create_scene` / `open_scene`, then `edit_scene` with
 *   small ops. An op that would introduce an error is refused and the
 *   document is left unchanged, so the working scene never contains an
 *   invented component, prop, easing or reference.
 * - **Whole document** - `validate`, `generate_code` and
 *   `render_scene` also accept a full document inline.
 *
 * `render_scene` is the closed loop: it runs the real host gate (render,
 * geometry audit, mechanical repair, motion sampling) and returns the audit
 * findings, the real layout of every node, and the rendered frames as images.
 */
export function createWireServer(options: WireServerOptions = {}): {
  server: McpServer;
  close(): Promise<void>;
} {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const catalogue = getCatalogue();
  const scenes = new Map<string, Scene>();
  let renderer = options.renderer ?? null;
  let counter = 0;

  const server = new McpServer(
    {name: 'ovacanvas-wire', version: '0.1.0'},
    {
      instructions:
        'Build OvaCanvas animated explanation beats as JSON scene documents instead of code. ' +
        'Start with `reference` (the format and rules), use `list_components` / `describe_component` for the catalogue, ' +
        'then build progressively with `create_scene` + `edit_scene` (structure first, then relations, then detail), ' +
        'and check the real result with `render_scene` after each stage. Every issue names the node, prop or step to fix. ' +
        'For explanations longer than one beat, write more beats or a lesson with scenes (see `reference`); render_scene renders every part.',
    },
  );

  const resolvePath = (file: string) => path.resolve(workspace, file);
  const sceneFile = (file: string) =>
    /\.json$/i.test(file) ? file : `${file}.ovw.json`;

  const save = (scene: Scene) => {
    if (!scene.file) return;
    fs.mkdirSync(path.dirname(scene.file), {recursive: true});
    fs.writeFileSync(scene.file, `${json(scene.document)}\n`);
  };

  const getScene = (id: string): Scene | string => {
    const scene = scenes.get(id);
    if (scene) return scene;
    const known = [...scenes.keys()];
    return known.length
      ? `no scene "${id}" - open scenes: ${known.join(', ')}`
      : `no scene "${id}" - call create_scene or open_scene first`;
  };

  /** A document from either a scene id or an inline document. */
  const documentFrom = (args: {
    scene?: string;
    document?: unknown;
  }): {doc: unknown; scene?: Scene} | string => {
    if (args.document !== undefined) return {doc: args.document};
    if (args.scene !== undefined) {
      const scene = getScene(args.scene);
      return typeof scene === 'string' ? scene : {doc: scene.document, scene};
    }
    return 'pass either "scene" (a scene id) or "document" (a full document)';
  };

  const sceneState = (id: string, scene: Scene) => {
    const issues = validateDocument(scene.document, {catalogue});
    return {
      scene: id,
      ...(scene.file
        ? {file: path.relative(workspace, scene.file) || scene.file}
        : {}),
      nodes: scene.document.nodes.map(
        n =>
          `${n.id}: ${n.component ?? `kit ${(n as {kit?: string}).kit}`}${n.parent ? ` (in ${n.parent})` : ''}`,
      ),
      timelineSteps: scene.document.timeline?.length ?? 0,
      beats: ((scene.document as {beats?: unknown[]}).beats ?? []).length,
      ...summarizeIssues(issues),
    };
  };

  // ---- reference & catalogue ----------------------------------------------

  server.registerTool(
    'reference',
    {
      title: 'Document format reference',
      description:
        'The scene document format, value forms, timeline steps, stage rules, and the core components with their essential props. Read this first.',
      annotations: {readOnlyHint: true},
    },
    async () =>
      text(
        `${documentReference(catalogue)}\n${kitReference()}\n${coreComponentReference(catalogue)}`,
      ),
  );

  server.registerTool(
    'list_components',
    {
      title: 'List catalogue components',
      description: `Every kit and component a document may use (${Object.keys(KITS).length} kits; ${Object.keys(catalogue.components).length} components extracted from ${catalogue.engine}). Prefer kits: one kit instance replaces dozens of nodes. Optional query filters by name or summary.`,
      inputSchema: {query: z.string().optional()},
      annotations: {readOnlyHint: true},
    },
    async ({query}) => {
      const needle = query?.toLowerCase();
      const rows = listComponents(catalogue).filter(
        c =>
          !needle ||
          c.name.toLowerCase().includes(needle) ||
          c.summary?.toLowerCase().includes(needle),
      );
      const kits = Object.values(KITS).filter(
        k =>
          !needle ||
          k.name.includes(needle) ||
          k.summary.toLowerCase().includes(needle),
      );
      return text(
        [
          ...(kits.length
            ? [
                'KITS (use "kit": name):',
                ...kits.map(k => `  ${k.name} - ${k.summary}`),
                '',
              ]
            : []),
          'COMPONENTS (use "component": name):',
          ...rows.map(
            c =>
              `  ${c.name} (${c.role}, extends ${c.extends})${c.summary ? ` - ${c.summary}` : ''}`,
          ),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'describe_component',
    {
      title: 'Describe a component',
      description:
        "A kit's fields, addressable parts and example - or a component's props with accepted value forms, defaults and tweenability (essential props by default; all=true for every prop).",
      inputSchema: {name: z.string(), all: z.boolean().optional()},
      annotations: {readOnlyHint: true},
    },
    async ({name, all}) => {
      const kit = KITS[name];
      if (kit) {
        return text(
          json({
            kit: kit.name,
            summary: kit.summary,
            fields: kit.fields,
            parts: kit.parts,
            example: kit.example,
          }),
        );
      }
      const component = getComponent(name, catalogue);
      if (!component) {
        const close = suggest(name, [
          ...Object.keys(KITS),
          ...Object.keys(catalogue.components),
        ]);
        return failure(
          `"${name}" is not a catalogue component.${close.length ? ` Did you mean ${close.join(' or ')}?` : ''}`,
        );
      }
      return text(json(describeComponent(component, {all, catalogue})));
    },
  );

  // ---- scenes ---------------------------------------------------------------

  server.registerTool(
    'create_scene',
    {
      title: 'Create a scene',
      description:
        'Start a new, empty scene document. With "file", it is saved there (as .ovw.json) after every successful edit.',
      inputSchema: {title: z.string().optional(), file: z.string().optional()},
    },
    async ({title, file}) => {
      const id = `scene${++counter}`;
      const scene: Scene = {
        document: emptyDocument(title),
        ...(file ? {file: resolvePath(sceneFile(file))} : {}),
      };
      if (scene.file && fs.existsSync(scene.file)) {
        return failure(
          `${scene.file} already exists - use open_scene to edit it`,
        );
      }
      scenes.set(id, scene);
      save(scene);
      return text(json(sceneState(id, scene)));
    },
  );

  server.registerTool(
    'open_scene',
    {
      title: 'Open a scene file',
      description:
        'Load a scene document from a .ovw.json file. Later edits are saved back to it.',
      inputSchema: {file: z.string()},
    },
    async ({file}) => {
      const full = resolvePath(file);
      if (!fs.existsSync(full)) return failure(`${full} does not exist`);
      let document: SceneDocument;
      try {
        document = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (error) {
        return failure(
          `${full} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const id = `scene${++counter}`;
      const scene: Scene = {document, file: full};
      scenes.set(id, scene);
      return text(json(sceneState(id, scene)));
    },
  );

  server.registerTool(
    'get_scene',
    {
      title: 'Get a scene document',
      description: 'The full current document of a scene.',
      inputSchema: {scene: z.string()},
      annotations: {readOnlyHint: true},
    },
    async ({scene: id}) => {
      const scene = getScene(id);
      return typeof scene === 'string'
        ? failure(scene)
        : text(json(scene.document));
    },
  );

  server.registerTool(
    'edit_scene',
    {
      title: 'Edit a scene',
      description:
        'Apply a batch of edit ops atomically: if any op would introduce an error, none are applied and the response says exactly what that op got wrong. ' +
        'Ops: set_title, add_node (a component or a kit), update_node (props, or kit fields), remove_node, rename_node, ' +
        'set_beats, add_beat, replace_beat, remove_beat, add_step, replace_step, remove_step, set_timeline, add_touch, remove_touch.',
      inputSchema: {scene: z.string(), ops: z.array(EDIT_OP).min(1)},
    },
    async ({scene: id, ops}) => {
      const scene = getScene(id);
      if (typeof scene === 'string') return failure(scene);
      // Atomic: ops are applied to a working copy, and the scene only changes
      // if every op is accepted - so a refused batch can simply be corrected
      // and sent again, with no half-applied state to reason about.
      let working = scene.document;
      const applied: string[] = [];
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i] as unknown as EditOp;
        const result = applyEdit(working, op, {catalogue});
        if (!result.ok) {
          return failure(
            json({
              changed: false,
              refused: {
                index: i,
                op: describeOp(op),
                ...(result.error ? {error: result.error} : {}),
              },
              ...(result.introduced.length
                ? {wouldIntroduce: formatIssues(result.introduced)}
                : {}),
              note: 'no op in this batch was applied - fix the refused op and send the batch again',
              ...(applied.length ? {acceptedBeforeRefusal: applied} : {}),
              state: sceneState(id, scene),
            }),
          );
        }
        working = result.document;
        applied.push(describeOp(op));
      }
      scene.document = working;
      save(scene);
      return text(json({changed: true, applied, state: sceneState(id, scene)}));
    },
  );

  server.registerTool(
    'save_scene',
    {
      title: 'Save a scene',
      description:
        'Write the scene document to a .ovw.json file (and keep saving there after later edits).',
      inputSchema: {scene: z.string(), file: z.string()},
    },
    async ({scene: id, file}) => {
      const scene = getScene(id);
      if (typeof scene === 'string') return failure(scene);
      scene.file = resolvePath(sceneFile(file));
      save(scene);
      return text(`saved ${scene.file}`);
    },
  );

  // ---- checking & output ------------------------------------------------------

  const target = {
    scene: z
      .string()
      .optional()
      .describe('a scene id from create_scene/open_scene'),
    document: z
      .any()
      .optional()
      .describe('a full scene document, instead of a scene id'),
  };

  server.registerTool(
    'validate',
    {
      title: 'Validate a document',
      description:
        'All issues for a scene or inline document, each located on a node, prop or timeline step, with a fix hint where one exists.',
      inputSchema: target,
      annotations: {readOnlyHint: true},
    },
    async args => {
      const found = documentFrom(args);
      if (typeof found === 'string') return failure(found);
      const issues = validateDocument(found.doc, {catalogue});
      return text(
        json({
          ...summarizeIssues(issues),
          ...(issues.length ? {summary: formatIssues(issues)} : {}),
        }),
      );
    },
  );

  server.registerTool(
    'generate_code',
    {
      title: 'Generate the beat module',
      description:
        'Compile a valid document into its OvaCanvas beat module (TypeScript), typecheck it against the real engine, and optionally write it to a file.',
      inputSchema: {
        ...target,
        file: z.string().optional().describe('write the .ts module here'),
      },
    },
    async args => {
      const found = documentFrom(args);
      if (typeof found === 'string') return failure(found);
      const compiled = compileDocument(found.doc);
      if (!compiled.ok) {
        return failure(
          json({
            ...summarizeIssues(compiled.issues),
            summary: formatIssues(compiled.issues),
          }),
        );
      }
      if (args.file) {
        const out = resolvePath(
          args.file.endsWith('.ts') ? args.file : `${args.file}.ts`,
        );
        fs.mkdirSync(path.dirname(out), {recursive: true});
        fs.writeFileSync(out, compiled.source);
      }
      return text(
        `${args.file ? `written to ${args.file}\n` : ''}duration ${compiled.durationSeconds}s, ${compiled.issues.length} warning(s)\n\n${compiled.source}`,
      );
    },
  );

  server.registerTool(
    'render_scene',
    {
      title: 'Render and audit',
      description:
        'Render the scene through the real host pipeline in a headless browser: compile, render, geometry audit with mechanical repair, and the mid-animation motion check. ' +
        "Returns whether a learner would see it, the audit findings, each node's real position and bounds, any positions the host had to adjust, and frame images.",
      inputSchema: {
        ...target,
        frames: z
          .array(z.number().min(0).max(1))
          .max(4)
          .optional()
          .describe('points in the beat to capture, 0..1 (default [0, 1])'),
      },
    },
    async args => {
      const found = documentFrom(args);
      if (typeof found === 'string') return failure(found);
      // A lesson - scenes, or more beats than one engine beat holds - renders
      // part by part.
      const lesson = compileLesson(found.doc, {catalogue});
      if (isLessonDocument(found.doc) || lesson.parts.length > 1) {
        return renderLessonReport(found.doc, lesson, args.frames);
      }
      const early = validateDocument(found.doc, {catalogue});
      if (hasErrors(early)) {
        return failure(
          json({
            ok: false,
            stage: 'validate',
            ...summarizeIssues(early),
            summary: formatIssues(early),
          }),
        );
      }
      renderer ??= new PreviewRenderer();
      let outcome: PreviewOutcome;
      try {
        outcome = await renderer.render(found.doc, {
          frames: args.frames ?? [0, 1],
        });
      } catch (error) {
        return failure(
          `the preview renderer failed to start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (found.scene) found.scene.lastRender = outcome;
      const report = {
        ok: outcome.ok,
        ...(outcome.stage ? {stage: outcome.stage} : {}),
        durationSeconds: outcome.durationSeconds,
        ...(outcome.issues.length
          ? {issues: formatIssues(outcome.issues)}
          : {}),
        findings: outcome.findings.map(
          f => `[${f.severity}] ${f.ruleId}: ${f.message}`,
        ),
        ...(!outcome.ok && outcome.initialFindings.length
          ? {
              beforeRepair: outcome.initialFindings.map(
                f => `[${f.severity}] ${f.ruleId}: ${f.message}`,
              ),
              beforeRepairNote:
                'the first audit, before the host tried moving things - fix these in the document',
            }
          : {}),
        ...(outcome.adjustments
          ? {
              adjustments: outcome.adjustments,
              note: 'the host nudged these nodes apart to pass the audit; apply_adjustments writes the new positions into the scene',
            }
          : {}),
        ...(outcome.layout
          ? {
              layout: outcome.layout,
              layoutNote:
                'box = [x, y, width, height] in stage pixels, origin top-left of the 1920x1080 stage',
            }
          : {}),
        ...(outcome.detail ? {detail: outcome.detail} : {}),
      };
      return {
        content: [
          {type: 'text' as const, text: json(report)},
          ...outcome.frames.map(frame => ({
            type: 'image' as const,
            data: frame.png,
            mimeType: 'image/png',
          })),
        ],
        ...(outcome.ok ? {} : {isError: true}),
      };
    },
  );

  async function renderLessonReport(
    doc: unknown,
    lesson: CompiledLesson,
    frames: readonly number[] | undefined,
  ) {
    if (!lesson.ok) {
      return failure(
        json({
          ok: false,
          stage: 'validate',
          lesson: true,
          ...summarizeIssues(lesson.issues),
          summary: formatIssues(lesson.issues),
        }),
      );
    }
    renderer ??= new PreviewRenderer();
    let outcome: LessonOutcome;
    try {
      outcome = await renderer.renderLesson(doc, {frames: frames ?? [1]});
    } catch (error) {
      return failure(
        `the preview renderer failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const report = {
      ok: outcome.ok,
      lesson: true,
      ...(outcome.stage ? {stage: outcome.stage} : {}),
      durationSeconds: outcome.durationSeconds,
      ...(outcome.issues.length ? {issues: formatIssues(outcome.issues)} : {}),
      parts: outcome.parts.map(part => ({
        id: part.id,
        scene: part.scene,
        beats: part.beats,
        ok: part.ok,
        durationSeconds: part.durationSeconds,
        findings: part.findings.map(
          f => `[${f.severity}] ${f.ruleId}: ${f.message}`,
        ),
      })),
      continuity: outcome.continuity,
      note: 'one image per part: its last frame',
      ...(outcome.detail ? {detail: outcome.detail} : {}),
    };
    return {
      content: [
        {type: 'text' as const, text: json(report)},
        ...outcome.parts.map(part => ({
          type: 'image' as const,
          data: part.frames[part.frames.length - 1]?.png ?? '',
          mimeType: 'image/png',
        })),
      ],
      ...(outcome.ok ? {} : {isError: true}),
    };
  }

  server.registerTool(
    'apply_adjustments',
    {
      title: "Apply the host's layout adjustments",
      description:
        'Write the positions the host moved nodes to (from the last render_scene of this scene) back into the document.',
      inputSchema: {scene: z.string()},
    },
    async ({scene: id}) => {
      const scene = getScene(id);
      if (typeof scene === 'string') return failure(scene);
      const adjustments = scene.lastRender?.adjustments ?? [];
      if (!adjustments.length) {
        return text('nothing to apply - the last render needed no adjustments');
      }
      const authored = new Set(scene.document.nodes.map(n => n.id));
      const skipped = adjustments
        .filter(a => !authored.has(a.node))
        .map(a => a.node);
      for (const adjustment of adjustments) {
        if (!authored.has(adjustment.node)) continue;
        const result = applyEdit(
          scene.document,
          {
            op: 'update_node',
            id: adjustment.node,
            props: {position: [...adjustment.to]},
            unset: ['x', 'y'],
          },
          {catalogue},
        );
        if (result.ok) scene.document = result.document;
      }
      save(scene);
      return text(
        json({
          applied: adjustments.filter(a => authored.has(a.node)),
          ...(skipped.length
            ? {
                skipped,
                note: 'these nodes are generated and placed by kits; change the kit instead',
              }
            : {}),
          state: sceneState(id, scene),
        }),
      );
    },
  );

  return {
    server,
    async close() {
      await renderer?.close();
    },
  };
}

function describeOp(op: EditOp): string {
  switch (op.op) {
    case 'add_node':
      return `add_node ${op.node.id} (${op.node.component ?? `kit ${(op.node as {kit?: string}).kit}`})`;
    case 'update_node':
    case 'remove_node':
      return `${op.op} ${op.id}`;
    case 'rename_node':
      return `rename_node ${op.id} -> ${op.to}`;
    case 'add_step':
      return `add_step ${op.step.kind}${op.index !== undefined ? ` at ${op.index}` : ''}`;
    case 'replace_step':
    case 'remove_step':
      return `${op.op} ${op.index}`;
    case 'add_touch':
      return `add_touch ${op.touch.a} x ${op.touch.b}`;
    case 'remove_touch':
      return `remove_touch ${op.a} x ${op.b}`;
    default:
      return op.op;
  }
}

export {generateBeatSource};
