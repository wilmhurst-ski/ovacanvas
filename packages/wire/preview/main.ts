import {worldBBox, type AuditFinding, type AuditableNode} from '@ovacanvas/2d';
import {LessonHost, LessonPlayer, resolveBeatSource} from '@ovacanvas/host';

/**
 * The preview page: stage one compiled beat through the real host pipeline
 * (offstage render, geometry audit, mechanical repair, multi-frame motion
 * check) and hand back the audit report plus rendered frames.
 *
 * It is deliberately the same path the studio's learner page uses - a
 * preview that audited differently from production would be a second, weaker
 * judge.
 */

export interface PreviewResult {
  readonly staged: boolean;
  readonly reason?: string;
  readonly findings: readonly AuditFinding[];
  /** The first audit, before mechanical repair moved anything. */
  readonly initialFindings: readonly AuditFinding[];
  readonly frames: readonly {readonly at: number; readonly png: string}[];
  /** Where each node really ended up at frame 0, after any mechanical repair. */
  readonly layout?: Readonly<Record<string, NodeLayout>>;
  readonly error?: string;
}

export interface NodeLayout {
  /** The node's own `position()`, in its parent's space. */
  readonly position: readonly [number, number];
  /** Its rendered bounding box in world space: [x, y, width, height]. */
  readonly box: readonly [number, number, number, number];
}

const StageElement = document.getElementById('stage') as HTMLElement;
let ActiveHost: LessonHost | null = null;

async function capture(
  ratios: readonly number[],
): Promise<PreviewResult['frames']> {
  const presentation = ActiveHost?.current;
  if (!presentation) return [];
  const duration = presentation.player.playback.duration;
  const frames: {at: number; png: string}[] = [];
  for (const ratio of ratios) {
    presentation.seek(Math.round(Math.max(0, Math.min(1, ratio)) * duration));
    await presentation.renderOnce();
    const url = presentation.canvas.toDataURL('image/png');
    frames.push({at: ratio, png: url.slice(url.indexOf(',') + 1)});
  }
  presentation.seek(0);
  return frames;
}

function readLayout(
  buildAuditSpec: (view: never) => {
    items: readonly {id: string; node: AuditableNode}[];
  },
): Record<string, NodeLayout> {
  const presentation = ActiveHost?.current;
  if (!presentation) return {};
  const layout: Record<string, NodeLayout> = {};
  for (const item of buildAuditSpec(presentation.view as never).items) {
    const node = item.node as AuditableNode & {
      position?: () => {x: number; y: number};
    };
    const position = node.position?.() ?? {x: 0, y: 0};
    const box = worldBBox(node);
    layout[item.id] = {
      position: [round(position.x), round(position.y)],
      box: [round(box.x), round(box.y), round(box.width), round(box.height)],
    };
  }
  return layout;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

async function preview(
  code: string,
  title: string,
  ratios: readonly number[],
): Promise<PreviewResult> {
  ActiveHost?.dispose();
  const host = new LessonHost('wire-preview', title, StageElement, {
    showScrubber: false,
    transitionDurationMs: 1,
  });
  ActiveHost = host;
  const opened = await host.start();
  if (!opened.ok) {
    return {
      staged: false,
      reason: 'opener-failed',
      findings: [],
      initialFindings: [],
      frames: [],
    };
  }
  const manifest = await resolveBeatSource('wire-beat', title, code);
  const staged = await host.stage({beat: manifest});
  // The beat's own report: its candidate generation while it is still being
  // judged, otherwise the newest report the host recorded (generations only
  // ever increase, and this host has staged nothing but the opener before it).
  const status = host.status();
  let generation = status.candidateGeneration;
  for (let g = 12; generation === null && g >= 2; g--) {
    if (host.lastReportFor(g)) generation = g;
  }
  const findings =
    generation === null ? [] : (host.lastReportFor(generation)?.findings ?? []);
  const initialFindings =
    generation === null
      ? []
      : (host.initialReportFor(generation)?.findings ?? []);
  if (!staged.ok) {
    return {
      staged: false,
      reason: staged.reason,
      ...(staged.detail ? {error: String(staged.detail)} : {}),
      findings,
      initialFindings,
      frames: [],
    };
  }
  host.activate();
  host.retireOutgoing();
  await new Promise(resolve => setTimeout(resolve, 50));
  const frames = await capture(ratios);
  await host.current?.renderOnce();
  return {
    staged: true,
    findings,
    initialFindings,
    frames,
    layout: readLayout(manifest.buildAuditSpec as never),
  };
}

/** Mean absolute difference of two PNGs, per channel, 0 (identical) to 255. */
async function diffPngs(a: string, b: string): Promise<number> {
  const decode = async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const [x, y] = await Promise.all([decode(a), decode(b)]);
  if (x.length !== y.length) return 255;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

export interface LessonPlayResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Parts that came on screen, in order, with when (ms from start). */
  readonly played: readonly {readonly index: number; readonly at: number}[];
  readonly finished: boolean;
  readonly elapsedMs: number;
}

/**
 * Play a compiled lesson straight through, in real time, with the real
 * host: staging, background cooking, crossfades and auto-advance.
 */
async function playLesson(
  parts: readonly {id: string; title: string; code: string}[],
  timeoutMs: number,
): Promise<LessonPlayResult> {
  ActiveHost?.dispose();
  const host = new LessonHost('wire-lesson', 'lesson', StageElement, {
    showScrubber: false,
  });
  ActiveHost = host;
  const started = performance.now();
  const opened = await host.start();
  if (!opened.ok) {
    return {
      ok: false,
      reason: 'opener-failed',
      played: [],
      finished: false,
      elapsedMs: 0,
    };
  }
  const manifests = await Promise.all(
    parts.map(p => resolveBeatSource(p.id, p.title, p.code)),
  );
  const played: {index: number; at: number}[] = [];
  return new Promise<LessonPlayResult>(resolve => {
    const done = (ok: boolean, reason?: string) => {
      player.stop();
      resolve({
        ok,
        ...(reason ? {reason} : {}),
        played,
        finished: player.isFinished,
        elapsedMs: Math.round(performance.now() - started),
      });
    };
    const timer = setTimeout(() => done(false, 'timeout'), timeoutMs);
    const player = new LessonPlayer(host, manifests, {
      onPart: index =>
        played.push({index, at: Math.round(performance.now() - started)}),
      onEnd: () => {
        clearTimeout(timer);
        done(true);
      },
      onError: (reason, detail) => {
        clearTimeout(timer);
        done(false, `${reason}${detail ? `: ${detail}` : ''}`);
      },
    });
    void player.start();
  });
}

declare global {
  interface Window {
    ovcDiffPngs(a: string, b: string): Promise<number>;
    ovcPlayLesson(
      parts: readonly {id: string; title: string; code: string}[],
      timeoutMs: number,
    ): Promise<LessonPlayResult>;
    ovcPreview(
      code: string,
      title: string,
      ratios: readonly number[],
    ): Promise<PreviewResult>;
    ovcReady: boolean;
  }
}

window.ovcPreview = async (code, title, ratios) => {
  try {
    return await preview(code, title, ratios);
  } catch (error) {
    return {
      staged: false,
      reason: 'runtime-error',
      findings: [],
      initialFindings: [],
      frames: [],
      error:
        error instanceof Error
          ? `${error.message}\n${error.stack ?? ''}`
          : String(error),
    };
  }
};
window.ovcDiffPngs = diffPngs;
window.ovcPlayLesson = playLesson;
window.ovcReady = true;
