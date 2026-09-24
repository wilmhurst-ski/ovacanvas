import * as path from 'path';
import {fileURLToPath} from 'url';
import type {Issue} from '../document/issues.js';
import type {SceneDocument, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {compileLesson, type LessonPart} from '../lesson/compile.js';
import {compileDocument, type CompiledDocument} from './compile.js';

/** The preview page shipped with this package (`preview/`). */
const PREVIEW_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../preview',
);

export interface AuditFindingJson {
  readonly ruleId: string;
  readonly severity: 'blocking' | 'advisory';
  readonly entities: readonly string[];
  readonly message: string;
}

export interface RenderedFrame {
  /** Position in the beat, 0 (first frame) to 1 (last frame). */
  readonly at: number;
  /** PNG, base64 encoded. */
  readonly png: string;
}

export interface NodeLayout {
  /** The node's own `position()`, in its parent's space. */
  readonly position: readonly [number, number];
  /** Its rendered bounding box in world space: [x, y, width, height]. */
  readonly box: readonly [number, number, number, number];
}

/** A node the host moved to make the beat pass (mechanical repair). */
export interface Adjustment {
  readonly node: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

export interface PreviewOutcome {
  /**
   * `true` when the beat passed the host's full gate - compile, render,
   * geometry audit (with mechanical repair), and the multi-frame motion check
   * - and would be shown to a learner.
   */
  readonly ok: boolean;
  /** Where it stopped: `validate`, `compile`, `audit` or `runtime`. */
  readonly stage?: 'validate' | 'compile' | 'audit' | 'runtime';
  readonly issues: readonly Issue[];
  readonly findings: readonly AuditFindingJson[];
  /**
   * The first audit's findings, before mechanical repair moved anything.
   * When a beat is refused these are the cause; `findings` describes the
   * scene after repair already changed it.
   */
  readonly initialFindings: readonly AuditFindingJson[];
  readonly frames: readonly RenderedFrame[];
  readonly durationSeconds: number;
  /** Real rendered position and bounds of every node, when the beat staged. */
  readonly layout?: Readonly<Record<string, NodeLayout>>;
  /**
   * Nodes whose rendered position differs from the document's - the host's
   * mechanical repair nudged them apart. The beat is shown with the nudged
   * positions, so the document should be updated to match (`to`).
   */
  readonly adjustments?: readonly Adjustment[];
  readonly detail?: string;
}

/** One part of a lesson, rendered and audited on its own. */
export interface LessonPartOutcome extends PreviewOutcome {
  readonly id: string;
  readonly scene: number;
  readonly beats: readonly number[];
}

export interface LessonOutcome {
  /** Every part passed the host's gate, and each starts where the last ended. */
  readonly ok: boolean;
  readonly stage?: 'validate' | 'compile' | 'audit' | 'runtime' | 'continuity';
  readonly issues: readonly Issue[];
  readonly parts: readonly LessonPartOutcome[];
  /**
   * For each boundary, how far the next part's first frame is from the last
   * part's final frame: mean absolute difference per channel (0 = identical,
   * 255 = opposite). A scene change is expected to differ; within a scene
   * anything visible is a jump the learner would see.
   */
  readonly continuity: readonly {
    readonly after: string;
    readonly difference: number;
    readonly sceneChange: boolean;
  }[];
  readonly durationSeconds: number;
  readonly detail?: string;
}

export interface LessonPlayback {
  readonly ok: boolean;
  readonly reason?: string;
  readonly played: readonly {readonly index: number; readonly at: number}[];
  readonly finished: boolean;
  readonly elapsedMs: number;
}

/** Within a scene, a boundary this different is a visible jump. */
const CONTINUITY_LIMIT = 1.5;

interface BrowserPreviewResult {
  layout?: Record<string, NodeLayout>;
  staged: boolean;
  reason?: string;
  findings: AuditFindingJson[];
  initialFindings: AuditFindingJson[];
  frames: RenderedFrame[];
  error?: string;
}

/**
 * Renders documents in headless Chromium through the real host pipeline.
 *
 * @remarks
 * Starting Vite and a browser costs a few seconds, so one renderer is meant
 * to be kept alive and reused for many previews (the MCP server holds one for
 * its whole session). Playwright and Vite are loaded lazily, so everything
 * else in this package works on a machine that has neither.
 */
export class PreviewRenderer {
  private server: {
    close(): Promise<void>;
    resolvedUrls?: {local: string[]} | null;
  } | null = null;
  private browser: {close(): Promise<void>} | null = null;
  private page: {
    evaluate<TResult, TArg>(
      fn: (arg: TArg) => TResult | Promise<TResult>,
      arg: TArg,
    ): Promise<TResult>;
    goto(url: string): Promise<unknown>;
    waitForFunction(
      fn: () => unknown,
      arg?: unknown,
      options?: {timeout: number},
    ): Promise<unknown>;
    on(event: 'pageerror', listener: (error: Error) => void): void;
  } | null = null;
  private starting: Promise<void> | null = null;
  private readonly pageErrors: string[] = [];

  public constructor(private readonly options: {headless?: boolean} = {}) {}

  private async start(): Promise<void> {
    if (this.page) return;
    if (!this.starting) {
      this.starting = (async () => {
        const vite = await import('vite');
        const server = await vite.createServer({
          configFile: path.join(PREVIEW_ROOT, 'vite.config.ts'),
          root: PREVIEW_ROOT,
          logLevel: 'error',
          server: {host: '127.0.0.1', port: 0},
        });
        await server.listen();
        this.server = server;
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error('the preview server did not report a URL');

        const {chromium} = await import('playwright');
        const browser = await chromium.launch({
          headless: this.options.headless ?? true,
        });
        this.browser = browser;
        const page = await browser.newPage({
          viewport: {width: 1000, height: 600},
        });
        page.on('pageerror', error => this.pageErrors.push(String(error)));
        await page.goto(url);
        await page.waitForFunction(
          () => (window as unknown as {ovcReady?: boolean}).ovcReady === true,
          undefined,
          {
            timeout: 120000,
          },
        );
        this.page = page as unknown as NonNullable<PreviewRenderer['page']>;
      })();
    }
    try {
      await this.starting;
    } catch (error) {
      this.starting = null;
      await this.close();
      throw error;
    }
  }

  /**
   * Validate, compile and render a document, returning located issues, the
   * audit's findings and the rendered frames.
   */
  public async render(
    document: SceneDocument | unknown,
    options: {frames?: readonly number[]} = {},
  ): Promise<PreviewOutcome> {
    const compiled: CompiledDocument = compileDocument(document);
    const base = {
      issues: compiled.issues,
      durationSeconds: compiled.durationSeconds,
    };
    if (!compiled.ok) {
      const stage = compiled.issues.some(i => i.code === 'typescript')
        ? 'compile'
        : 'validate';
      return {
        ...base,
        ok: false,
        stage,
        findings: [],
        initialFindings: [],
        frames: [],
      };
    }
    await this.start();
    const title = (document as SceneDocument).title ?? 'preview';
    this.pageErrors.length = 0;
    const result = await this.page!.evaluate(
      ({
        code,
        title,
        ratios,
      }: {
        code: string;
        title: string;
        ratios: readonly number[];
      }) =>
        (
          window as unknown as {
            ovcPreview(
              code: string,
              title: string,
              ratios: readonly number[],
            ): Promise<BrowserPreviewResult>;
          }
        ).ovcPreview(code, title, ratios),
      {code: compiled.code, title, ratios: options.frames ?? [0, 0.5, 1]},
    );
    const toJson = (f: AuditFindingJson): AuditFindingJson => ({
      ruleId: f.ruleId,
      severity: f.severity,
      entities: f.entities,
      message: f.message,
    });
    const findings = result.findings.map(toJson);
    const initialFindings = (result.initialFindings ?? []).map(toJson);
    if (result.reason === 'runtime-error') {
      return {
        ...base,
        ok: false,
        stage: 'runtime',
        findings,
        initialFindings,
        frames: [],
        detail: result.error,
      };
    }
    if (!result.staged) {
      const errors = this.pageErrors.length
        ? `\npage errors:\n${this.pageErrors.join('\n')}`
        : '';
      return {
        ...base,
        ok: false,
        stage: 'audit',
        findings,
        initialFindings,
        frames: result.frames,
        detail: `the host refused the beat (${result.reason ?? 'unknown'})${result.error ? `: ${result.error}` : ''}${errors}`,
      };
    }
    const adjustments = findAdjustments(
      compiled.document ?? (document as SceneDocument),
      result.layout ?? {},
    );
    return {
      ...base,
      ok: true,
      findings,
      initialFindings,
      frames: result.frames,
      ...(result.layout ? {layout: result.layout} : {}),
      ...(adjustments.length ? {adjustments} : {}),
    };
  }

  /**
   * Compile a lesson (or a long scene document), then render and audit every
   * part through the host's gate, and check that each part starts on the
   * frame the one before it ended on.
   */
  public async renderLesson(
    input: unknown,
    options: {frames?: readonly number[]} = {},
  ): Promise<LessonOutcome> {
    const lesson = compileLesson(input);
    if (!lesson.ok) {
      return {
        ok: false,
        stage: 'validate',
        issues: lesson.issues,
        parts: [],
        continuity: [],
        durationSeconds: 0,
      };
    }
    const ratios = [...new Set([0, ...(options.frames ?? []), 1])].sort(
      (a, b) => a - b,
    );
    const parts: LessonPartOutcome[] = [];
    for (const part of lesson.parts) {
      const outcome = await this.render(part.document, {frames: ratios});
      parts.push({
        ...outcome,
        id: part.id,
        scene: part.scene,
        beats: part.beats,
      });
      if (!outcome.ok) {
        return {
          ok: false,
          stage: outcome.stage,
          issues: [...lesson.issues, ...outcome.issues],
          parts,
          continuity: [],
          durationSeconds: lesson.durationSeconds,
          detail: `part ${parts.length} (${part.id}): ${outcome.detail ?? 'refused'}`,
        };
      }
    }
    const continuity: LessonOutcome['continuity'][number][] = [];
    for (let i = 0; i + 1 < parts.length; i++) {
      const last = parts[i].frames[parts[i].frames.length - 1];
      const first = parts[i + 1].frames[0];
      const difference = await this.page!.evaluate(
        ({a, b}: {a: string; b: string}) =>
          (
            window as unknown as {
              ovcDiffPngs(a: string, b: string): Promise<number>;
            }
          ).ovcDiffPngs(a, b),
        {a: last.png, b: first.png},
      );
      continuity.push({
        after: parts[i].id,
        difference: Math.round(difference * 100) / 100,
        sceneChange: parts[i].scene !== parts[i + 1].scene,
      });
    }
    const jump = continuity.find(
      c => !c.sceneChange && c.difference > CONTINUITY_LIMIT,
    );
    return {
      ok: !jump,
      ...(jump ? {stage: 'continuity' as const} : {}),
      issues: lesson.issues,
      parts,
      continuity,
      durationSeconds: lesson.durationSeconds,
      ...(jump
        ? {
            detail: `the part after ${jump.after} does not start where it ended (difference ${jump.difference})`,
          }
        : {}),
    };
  }

  /**
   * Play a lesson straight through in real time with the real host - the
   * staging, background cooking, crossfades and auto-advance a learner gets.
   */
  public async playLesson(
    input: unknown,
    options: {timeoutMs?: number} = {},
  ): Promise<LessonPlayback> {
    const lesson = compileLesson(input);
    if (!lesson.ok) {
      return {
        ok: false,
        reason: 'invalid',
        played: [],
        finished: false,
        elapsedMs: 0,
      };
    }
    const codes: {id: string; title: string; code: string}[] = [];
    for (const part of lesson.parts as readonly LessonPart[]) {
      const compiled = compileDocument(part.document);
      if (!compiled.ok) {
        return {
          ok: false,
          reason: `compile ${part.id}`,
          played: [],
          finished: false,
          elapsedMs: 0,
        };
      }
      codes.push({id: part.id, title: part.title, code: compiled.code});
    }
    await this.start();
    const timeoutMs =
      options.timeoutMs ??
      Math.round(lesson.durationSeconds * 1000 * 3 + 30000);
    return this.page!.evaluate(
      ({parts, timeoutMs}: {parts: typeof codes; timeoutMs: number}) =>
        (
          window as unknown as {
            ovcPlayLesson(p: typeof parts, t: number): Promise<LessonPlayback>;
          }
        ).ovcPlayLesson(parts, timeoutMs),
      {parts: codes, timeoutMs},
    );
  }

  public async close(): Promise<void> {
    const browser = this.browser;
    const server = this.server;
    this.page = null;
    this.browser = null;
    this.server = null;
    this.starting = null;
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}

function explicitPosition(
  props: Readonly<Record<string, Value>>,
): [number, number] | null {
  const position = props.position;
  if (
    Array.isArray(position) &&
    typeof position[0] === 'number' &&
    typeof position[1] === 'number'
  ) {
    return [position[0], position[1]];
  }
  if (
    isObject(position) &&
    typeof position.x === 'number' &&
    typeof position.y === 'number'
  ) {
    return [position.x, position.y];
  }
  if (typeof position === 'number') return [position, position];
  if (typeof props.x === 'number' || typeof props.y === 'number') {
    return [
      typeof props.x === 'number' ? props.x : 0,
      typeof props.y === 'number' ? props.y : 0,
    ];
  }
  return null;
}

/** Compare authored positions with where the host actually drew each node. */
export function findAdjustments(
  document: SceneDocument,
  layout: Readonly<Record<string, NodeLayout>>,
): Adjustment[] {
  const adjustments: Adjustment[] = [];
  for (const node of document.nodes ?? []) {
    const authored = explicitPosition(node.props ?? {});
    const rendered = layout[node.id]?.position;
    if (!authored || !rendered) continue;
    if (
      Math.abs(authored[0] - rendered[0]) > 1 ||
      Math.abs(authored[1] - rendered[1]) > 1
    ) {
      adjustments.push({node: node.id, from: authored, to: rendered});
    }
  }
  return adjustments;
}
