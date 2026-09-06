import {
  Circle,
  InteractionTargets,
  Line,
  Node,
  PointerDispatcher,
  Rect,
  Scene2D,
  Txt,
  View2D,
  convexHull,
  layoutLayeredGraph,
  makeScene2D,
} from '@ovacanvas/2d';
import type {
  FullSceneDescription,
  Project,
  ThreadGeneratorFactory,
  Versions,
} from '@ovacanvas/core';
import {
  MetaFile,
  Player,
  Stage,
  Vector2,
  bootstrap,
  createSignal,
  waitFor,
} from '@ovacanvas/core';
import type {
  MutationCapability,
  PreparationContext,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority, TransitionOwner} from '@ovacanvas/core/lib/internal';

export const EvidenceWidth = 760;
export const EvidenceHeight = 460;
export const VerificationTarget = 'relationship.destination';
export const InteractiveTarget = 'control.destination';

export const rafLedger = {requested: 0, fired: 0};
const NativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  rafLedger.requested++;
  return NativeRaf((time: number) => {
    rafLedger.fired++;
    callback(time);
  });
};

export interface EvidenceState {
  shift: number;
}

export type EvidenceMode =
  | 'baseline'
  | 'shared-defect'
  | 'composed-pass'
  | 'composed-fail';

interface SceneFacts {
  cap02Kind: string | null;
  cap02Vertices: number;
  cap02Edges: number;
  cap03HullPoints: number;
  destinationBase: {x: number; y: number} | null;
  edgeWitnessBase: {x: number; y: number} | null;
}

interface EvaluationObservations {
  semanticTarget: string | null;
  relationPixels: number;
  cap02Pixels: number;
  cap03Pixels: number;
}

export interface EvidenceCertification {
  readonly generation: number;
  readonly runtimeRevision: number;
  readonly result: 'PASS' | 'FAIL';
  readonly observations: Readonly<EvaluationObservations>;
}

const RuntimeVersions: Versions = {
  core: 'contract-evidence',
  two: 'contract-evidence',
  ui: null,
  vitePlugin: null,
};

function buildProject(
  name: string,
  runner: ThreadGeneratorFactory<View2D>,
): Project {
  const description = {
    ...makeScene2D(runner),
    name,
  } as unknown as FullSceneDescription<ThreadGeneratorFactory<View2D>>;

  return bootstrap(
    name,
    RuntimeVersions,
    [],
    {scenes: [description]},
    new MetaFile(`${name}.project`),
    new MetaFile(`${name}.settings`),
  );
}

class EvidenceBinding {
  public readonly semanticTargets = new InteractionTargets();
  public readonly interactionTargets: InteractionTargets;
  public readonly shift;
  public readonly facts: SceneFacts = {
    cap02Kind: null,
    cap02Vertices: 0,
    cap02Edges: 0,
    cap03HullPoints: 0,
    destinationBase: null,
    edgeWitnessBase: null,
  };

  public constructor(
    public readonly mode: EvidenceMode,
    initialShift: number,
  ) {
    // This is the intentionally broken configuration used to reproduce the
    // finding. Correct candidates give pointer dispatch a separate registry.
    this.interactionTargets =
      mode === 'shared-defect'
        ? this.semanticTargets
        : new InteractionTargets();
    this.shift = createSignal(initialShift);
  }
}

function scenePoint(
  point: {x: number; y: number},
  offset: {x: number; y: number},
) {
  return {x: point.x + offset.x, y: point.y + offset.y};
}

function buildEvidenceScene(
  binding: EvidenceBinding,
): ThreadGeneratorFactory<View2D> {
  return function* (view) {
    if (binding.mode === 'baseline') {
      view.add(
        new Rect({
          width: 680,
          height: 380,
          radius: 28,
          fill: '#182332',
          stroke: '#38506b',
          lineWidth: 3,
        }),
      );
      view.add(
        new Txt({
          text: 'CURRENT ACCEPTED PRESENTATION',
          fill: '#d9e8f5',
          fontFamily: 'sans-serif',
          fontSize: 28,
          fontWeight: 700,
        }),
      );
      yield* waitFor(1);
      return;
    }

    view.add(
      new Rect({
        x: -200,
        width: 330,
        height: 380,
        radius: 24,
        fill: '#142536',
        stroke: '#2f5874',
        lineWidth: 3,
      }),
    );
    view.add(
      new Rect({
        x: 205,
        width: 360,
        height: 380,
        radius: 24,
        fill: '#241d35',
        stroke: '#614777',
        lineWidth: 3,
      }),
    );
    view.add(
      new Txt({
        x: -200,
        y: -166,
        text: 'RELATIONAL FLOW · CAP-02',
        fill: '#aee8e0',
        fontFamily: 'sans-serif',
        fontSize: 19,
        fontWeight: 700,
      }),
    );
    view.add(
      new Txt({
        x: 205,
        y: -166,
        text: 'PLANAR ENVELOPE · CAP-03',
        fill: '#e5c6ff',
        fontFamily: 'sans-serif',
        fontSize: 19,
        fontWeight: 700,
      }),
    );

    const graph = layoutLayeredGraph(
      {
        vertices: [
          {id: 'input', width: 88, height: 54},
          {id: 'transform', width: 104, height: 54},
          {id: 'result', width: 92, height: 62},
        ],
        edges: [
          {id: 'input-to-transform', source: 'input', target: 'transform'},
          {id: 'transform-to-result', source: 'transform', target: 'result'},
        ],
      },
      {
        direction: 'TB',
        nodeSeparation: 34,
        rankSeparation: 48,
      },
    );
    binding.facts.cap02Kind = graph.kind;
    binding.facts.cap02Vertices = graph.vertices.length;
    binding.facts.cap02Edges = graph.edges.length;

    const minX = Math.min(...graph.vertices.map(vertex => vertex.x));
    const maxX = Math.max(...graph.vertices.map(vertex => vertex.x));
    const minY = Math.min(...graph.vertices.map(vertex => vertex.y));
    const maxY = Math.max(...graph.vertices.map(vertex => vertex.y));
    const graphOffset = {
      x: -200 - (minX + maxX) / 2,
      y: 6 - (minY + maxY) / 2,
    };
    const graphGroup = new Node({x: () => binding.shift()});

    for (const edge of graph.edges) {
      const points = edge.points.map(point => scenePoint(point, graphOffset));
      graphGroup.add(
        new Line({
          points: points.map(point => [point.x, point.y]),
          stroke: '#72dfd0',
          lineWidth: 7,
          endArrow: true,
          arrowSize: 11,
        }),
      );
      if (edge.id === 'transform-to-result') {
        const end = points[points.length - 1];
        const previous = points[points.length - 2];
        binding.facts.edgeWitnessBase = {
          x: (end.x + previous.x) / 2,
          y: (end.y + previous.y) / 2,
        };
      }
    }

    const labels: Record<string, string> = {
      input: 'SOURCE',
      transform: 'RELATION',
      result: 'RESULT',
    };
    for (const vertex of graph.vertices) {
      const point = scenePoint(vertex, graphOffset);
      if (vertex.id === 'result') {
        // The circle is a legitimate interactive target. The smaller rectangle
        // is the verification-only semantic anchor drawn on top of it.
        const control = new Circle({
          x: point.x,
          y: point.y,
          size: 96,
          fill: '#173f48',
          stroke: '#72dfd0',
          lineWidth: 4,
        });
        const anchor = new Rect({
          x: point.x,
          y: point.y,
          width: 124,
          height: 58,
          radius: 13,
          fill: '#f2b55f',
          stroke: '#ffe1a7',
          lineWidth: 3,
        });
        graphGroup.add(control);
        graphGroup.add(anchor);
        binding.interactionTargets.bind(InteractiveTarget, control);
        binding.semanticTargets.bind(VerificationTarget, anchor);
        binding.facts.destinationBase = point;
      } else {
        graphGroup.add(
          new Rect({
            x: point.x,
            y: point.y,
            width: vertex.width,
            height: vertex.height,
            radius: 13,
            fill: vertex.id === 'input' ? '#315c79' : '#356b70',
            stroke: '#8cd9d0',
            lineWidth: 3,
          }),
        );
      }
      graphGroup.add(
        new Txt({
          x: point.x,
          y: point.y,
          text: labels[vertex.id],
          fill: '#10202a',
          fontFamily: 'sans-serif',
          fontSize: 15,
          fontWeight: 800,
        }),
      );
    }
    view.add(graphGroup);

    const rawPoints = [
      {x: -112, y: 28},
      {x: -74, y: -86},
      {x: 28, y: -118},
      {x: 116, y: -42},
      {x: 91, y: 78},
      {x: -12, y: 122},
      {x: -87, y: 88},
      {x: 12, y: 6},
    ];
    const hull = convexHull(rawPoints);
    binding.facts.cap03HullPoints = hull.length;
    const hullGroup = new Node({x: 205, y: 12});
    hullGroup.add(
      new Line({
        points: hull.map(point => [point.x, point.y]),
        closed: true,
        fill: '#6f3f83',
        stroke: '#e0a5ff',
        lineWidth: 7,
      }),
    );
    for (const point of rawPoints) {
      hullGroup.add(
        new Circle({
          x: point.x,
          y: point.y,
          size: 15,
          fill: '#f7d7ff',
          stroke: '#4a2258',
          lineWidth: 2,
        }),
      );
    }
    hullGroup.add(
      new Txt({
        y: 152,
        text: 'computed hull enclosing observed points',
        fill: '#d8c5e8',
        fontFamily: 'sans-serif',
        fontSize: 15,
      }),
    );
    view.add(hullGroup);

    yield* waitFor(1);
  };
}

function countPixels(
  stage: Stage,
  predicate: (
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ) => boolean,
  bounds: {x: number; y: number; width: number; height: number},
): number {
  const {data} = stage.context.getImageData(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (
      predicate(data[index], data[index + 1], data[index + 2], data[index + 3])
    ) {
      count++;
    }
  }
  return count;
}

/**
 * One phenomenon-specific evaluator owned by the fixture, not the producer.
 * It observes actual pixels plus the semantic point query for the exact
 * offstage presentation generation and accepted runtime revision.
 */
export function evaluateActualOutput(
  presentation: EvidencePresentation,
  authority: RuntimeAuthority<EvidenceState>,
): EvidenceCertification {
  const destination = presentation.destinationPoint();
  const witness = presentation.edgeWitnessPoint();
  const semantic = destination
    ? presentation.scene.probeInteraction(
        presentation.bufferPoint(destination.x, destination.y),
        presentation.binding.semanticTargets,
      )
    : null;
  const relationPixels = witness
    ? countPixels(
        presentation.stage,
        (red, green, blue, alpha) =>
          alpha > 0 && red < 170 && green > 170 && blue > 150,
        {
          x: Math.max(0, Math.round(witness.x + EvidenceWidth / 2) - 7),
          y: Math.max(0, Math.round(witness.y + EvidenceHeight / 2) - 7),
          width: 15,
          height: 15,
        },
      )
    : 0;
  const cap02Pixels = countPixels(
    presentation.stage,
    (red, green, blue, alpha) =>
      alpha > 0 && red < 170 && green > 170 && blue > 145,
    {x: 10, y: 35, width: 360, height: 390},
  );
  const cap03Pixels = countPixels(
    presentation.stage,
    (red, green, blue, alpha) =>
      alpha > 0 && red > 170 && blue > 170 && green < 210,
    {x: 390, y: 35, width: 350, height: 390},
  );
  const expectedTarget =
    presentation.mode === 'composed-fail'
      ? 'deliberately-wrong-target'
      : VerificationTarget;
  const observations = Object.freeze({
    semanticTarget: semantic?.hit?.target ?? null,
    relationPixels,
    cap02Pixels,
    cap03Pixels,
  });
  const passed =
    presentation.binding.facts.cap02Kind === 'layered' &&
    presentation.binding.facts.cap02Vertices === 3 &&
    presentation.binding.facts.cap02Edges === 2 &&
    presentation.binding.facts.cap03HullPoints >= 4 &&
    observations.semanticTarget === expectedTarget &&
    observations.relationPixels > 3 &&
    observations.cap02Pixels > 80 &&
    observations.cap03Pixels > 80;

  return Object.freeze({
    generation: presentation.generation,
    runtimeRevision: authority.revision,
    result: passed ? 'PASS' : 'FAIL',
    observations,
  });
}

export class EvidencePresentation {
  public readonly project: Project;
  public readonly player: Player;
  public readonly stage: Stage;
  public readonly scene: Scene2D;
  public readonly container: HTMLDivElement;
  public readonly dispatcher: PointerDispatcher<EvidenceState>;
  public readonly binding: EvidenceBinding;
  public renderCount = 0;
  public disposeCount = 0;
  public ready = false;
  public lastPointerId: number | null = null;
  public lastPointerTarget: string | null = null;
  public interactivePresses = 0;
  public deniedPresses = 0;

  private readonly disposers: Array<() => void> = [];
  private settle: (() => void) | null = null;

  public constructor(
    public readonly name: string,
    public readonly mode: EvidenceMode,
    public readonly generation: number,
    private readonly capability: MutationCapability<EvidenceState>,
    private readonly authority: RuntimeAuthority<EvidenceState>,
  ) {
    this.binding = new EvidenceBinding(mode, authority.read().shift);
    this.project = buildProject(name, buildEvidenceScene(this.binding));
    this.player = new Player(
      this.project,
      {
        size: new Vector2(EvidenceWidth, EvidenceHeight),
        resolutionScale: 1,
        fps: 30,
      },
      {paused: true, loop: false, muted: true},
      0,
    );
    this.stage = new Stage();
    this.stage.configure({
      size: new Vector2(EvidenceWidth, EvidenceHeight),
      resolutionScale: 1,
      background: '#0d131d',
    });
    this.scene = this.player.playback.currentScene as Scene2D;

    this.container = document.createElement('div');
    this.container.className = 'presentation';
    this.container.dataset.presentation = name;
    this.container.append(this.stage.finalBuffer);

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.disposeCount > 0) return;
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;
        this.player.sleep();
        const settle = this.settle;
        this.settle = null;
        settle?.();
      }),
    );
    this.disposers.push(
      this.authority.onRevisionChanged.subscribe(() => {
        this.binding.shift(this.authority.read().shift);
        if (this.ready) this.markDirty();
      }),
    );

    this.dispatcher = new PointerDispatcher<EvidenceState>({
      element: this.stage.finalBuffer,
      scene: this.scene,
      targets: this.binding.interactionTargets,
      capability,
      handlers: {
        onPress: (session, commit) => {
          this.lastPointerId = session.pointerId;
          this.lastPointerTarget = session.target;
          if (session.target !== InteractiveTarget) {
            this.deniedPresses++;
            return;
          }
          this.interactivePresses++;
          commit.commit(draft => {
            draft.shift += 18;
          });
        },
      },
    });
  }

  public get canvas(): HTMLCanvasElement {
    return this.stage.finalBuffer;
  }

  public destinationPoint(): {x: number; y: number} | null {
    const point = this.binding.facts.destinationBase;
    return point ? {x: point.x + this.binding.shift(), y: point.y} : null;
  }

  public edgeWitnessPoint(): {x: number; y: number} | null {
    const point = this.binding.facts.edgeWitnessBase;
    return point ? {x: point.x + this.binding.shift(), y: point.y} : null;
  }

  public bufferPoint(sceneX: number, sceneY: number): Vector2 {
    return new Vector2(sceneX + EvidenceWidth / 2, sceneY + EvidenceHeight / 2);
  }

  public async renderOnce(timeout = 6000): Promise<boolean> {
    if (this.disposeCount > 0) return false;
    const before = this.renderCount;
    const settled = new Promise<void>(resolve => (this.settle = resolve));
    this.player.requestRender();
    this.player.wake();
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) {
      await Promise.race([settled, delay(4)]);
    }
    return this.renderCount > before;
  }

  public captureSnapshot() {
    const pointerId = this.lastPointerId;
    return {
      activeSessions: this.dispatcher.activeSessions,
      pointerId,
      captured:
        pointerId === null ? false : this.canvas.hasPointerCapture(pointerId),
      target: this.lastPointerTarget,
      interactivePresses: this.interactivePresses,
      deniedPresses: this.deniedPresses,
    };
  }

  public nodeFor(target: string): object | null {
    return this.binding.semanticTargets.nodeFor(target) as object | null;
  }

  public snapshot() {
    return {
      name: this.name,
      mode: this.mode,
      generation: this.generation,
      ready: this.ready,
      visible: this.canvas.isConnected,
      writable: this.capability.isValid(),
      renderCount: this.renderCount,
      disposeCount: this.disposeCount,
      semanticTargets: this.binding.semanticTargets.targets.slice().sort(),
      interactionTargets: this.binding.interactionTargets.targets
        .slice()
        .sort(),
      sharedRegistry:
        this.binding.semanticTargets === this.binding.interactionTargets,
      facts: {...this.binding.facts},
      capture: this.captureSnapshot(),
    };
  }

  public dispose(): void {
    this.disposeCount++;
    if (this.disposeCount > 1) return;
    this.dispatcher.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.container.remove();
  }

  private markDirty(): void {
    queueMicrotask(() => {
      if (this.disposeCount > 0) return;
      this.player.requestRender();
      this.player.wake();
    });
  }
}

export class ContractEvidenceRuntime {
  public readonly authority = new RuntimeAuthority<EvidenceState>({shift: 0});
  public readonly owner: TransitionOwner<EvidenceState, EvidencePresentation>;
  public readonly slot: HTMLDivElement;
  public nextMode: EvidenceMode = 'baseline';
  public lastEvaluation: EvidenceCertification | null = null;
  public currentCertification: EvidenceCertification | null = null;
  public certificationStale = false;

  private nextName = 0;
  private readonly disposeRevision: () => void;
  private readonly failedCandidates: EvidencePresentation[] = [];

  public constructor(
    public readonly id: string,
    container: HTMLElement,
  ) {
    this.slot = document.createElement('div');
    this.slot.className = 'slot';
    this.slot.dataset.runtime = id;
    container.append(this.slot);
    this.disposeRevision = this.authority.onRevisionChanged.subscribe(
      revision => {
        if (
          this.currentCertification &&
          this.currentCertification.runtimeRevision !== revision
        ) {
          this.certificationStale = true;
        }
      },
    );

    this.owner = new TransitionOwner<EvidenceState, EvidencePresentation>({
      authority: this.authority,
      adapter: {
        prepare: context => this.buildCandidate(context),
        activate: incoming => {
          this.slot.replaceChildren(incoming.container);
          this.currentCertification = this.lastEvaluation;
          this.certificationStale = false;
        },
        dispose: presentation => presentation.dispose(),
      },
    });
  }

  public async initialize(): Promise<void> {
    this.nextMode = 'baseline';
    const staged = await this.owner.stage();
    if (staged.ok === false)
      {throw new Error(`baseline staging failed: ${staged.reason}`);}
    const activated = this.owner.activate();
    if (activated.ok === false) {
      throw new Error(`baseline activation failed: ${activated.reason}`);
    }
  }

  public async stage(mode: EvidenceMode) {
    this.nextMode = mode;
    return this.owner.stage();
  }

  public activate() {
    return this.owner.activate();
  }

  public reevaluateCurrent(): EvidenceCertification | null {
    const current = this.owner.current;
    if (!current) return null;
    const certification = evaluateActualOutput(current, this.authority);
    this.currentCertification = certification;
    this.lastEvaluation = certification;
    this.certificationStale = certification.result !== 'PASS';
    return certification;
  }

  public clientPoint(kind: 'anchor-only' | 'overlap') {
    const current = this.owner.current;
    const point = current?.destinationPoint();
    if (!current || !point) return null;
    // The verification anchor extends beyond the interactive control's
    // conservative 96px square pick bounds. This point is inside the anchor
    // but outside the control; the centre is inside both.
    const scene = kind === 'overlap' ? point : {x: point.x + 55, y: point.y};
    const rect = current.canvas.getBoundingClientRect();
    return {
      x: rect.left + scene.x + EvidenceWidth / 2,
      y: rect.top + scene.y + EvidenceHeight / 2,
    };
  }

  public semanticProbe(kind: 'anchor-only' | 'overlap') {
    const current = this.owner.current;
    const point = current?.destinationPoint();
    if (!current || !point) return null;
    const scene = kind === 'overlap' ? point : {x: point.x + 55, y: point.y};
    const probe = current.scene.probeInteraction(
      current.bufferPoint(scene.x, scene.y),
      current.binding.semanticTargets,
    );
    return probe?.hit?.target ?? null;
  }

  public async settled(before: number): Promise<boolean> {
    const current = this.owner.current;
    if (!current) return false;
    const deadline = Date.now() + 4000;
    while (current.renderCount <= before && Date.now() < deadline) {
      await delay(4);
    }
    return current.renderCount > before;
  }

  public snapshot() {
    return {
      id: this.id,
      ...this.owner.status(),
      runtimeRevision: this.authority.revision,
      runtimeState: {...this.authority.read()},
      currentCertification: this.currentCertification,
      certificationStale: this.certificationStale,
      lastEvaluation: this.lastEvaluation,
      failedCandidateDisposals: this.failedCandidates.filter(
        candidate => candidate.disposeCount > 0,
      ).length,
      current: this.owner.current?.snapshot() ?? null,
      candidate: this.owner.pendingCandidate?.snapshot() ?? null,
    };
  }

  public dispose(): void {
    this.disposeRevision();
    this.owner.dispose();
    this.authority.dispose();
    this.slot.remove();
  }

  private async buildCandidate(
    context: PreparationContext<EvidenceState>,
  ): Promise<EvidencePresentation> {
    const presentation = new EvidencePresentation(
      `${this.id}-e${++this.nextName}`,
      this.nextMode,
      context.generation,
      context.capability,
      this.authority,
    );
    const rendered = await presentation.renderOnce();
    if (!rendered) throw new Error('candidate never rendered');

    if (this.nextMode === 'baseline') {
      presentation.ready = true;
      context.markReady();
      return presentation;
    }

    const certification = evaluateActualOutput(presentation, this.authority);
    this.lastEvaluation = certification;
    if (certification.result === 'PASS' && !context.isCancelled()) {
      presentation.ready = true;
      context.markReady();
    } else {
      // Retained only so the test can inspect TransitionOwner's subsequent
      // terminal disposal. The producer still has no readiness authority.
      this.failedCandidates.push(presentation);
    }
    return presentation;
  }
}

export const delay = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));
