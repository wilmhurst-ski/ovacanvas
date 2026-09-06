import {Player, Presenter, Renderer, Stage, Vector2} from '@ovacanvas/core';
import project from '../foundation/project?project';
import {RuntimeStore, registerBinding} from '../foundation/runtimeStore';
import {rafLedger, resourceLedger, wait} from './foundationHost';

/**
 * Terminal-owner and async-race regressions for the owners the
 * post-first-green attack proved were retained without a terminal path.
 *
 * @remarks
 * These assert lifecycle properties only. No public API, presentation policy
 * or product surface is implied.
 */
const Status = document.querySelector<HTMLElement>('#status')!;

/**
 * Every scene the fixture project builds needs a binding before it runs.
 * Presenter and Renderer construct their own Scenes from the same project.
 */
function bindScenes(scenes: readonly object[], store: RuntimeStore) {
  for (const scene of scenes) {
    const {binding} = store.prepareGeneration();
    registerBinding(scene as never, binding);
  }
}

function canvasReleased(stage: Stage) {
  return stage.finalBuffer.width === 0 && stage.finalBuffer.height === 0;
}

/** Presenter owns a Stage, Scenes, a shared WebGL context and a frame. */
async function presenterDisposal() {
  const store = new RuntimeStore('presenter');
  const presenter = new Presenter(project);
  bindScenes(presenter.playback.onScenesRecalculated.current, store);

  const scenes = presenter.playback.onScenesRecalculated.current;
  const infoSubscribersBefore = presenter.onInfoChanged.getSubscriberCount();
  const unsubscribe = presenter.onInfoChanged.subscribe(() => {});

  // Run a presentation so a frame is genuinely in flight, then abort.
  const running = presenter.present({
    name: 'owners',
    fps: 30,
    slide: null,
    size: new Vector2(160, 160),
    resolutionScale: 1,
    colorSpace: 'srgb',
    background: '#101216',
  });
  await wait(250);
  const scheduledWhileRunning = rafLedger.requested;
  presenter.abort();
  await wait(200);
  const rafAfterAbort = rafLedger.requested;
  await wait(250);
  const rafDeltaAfterAbort = rafLedger.requested - rafAfterAbort;
  await running;

  const subscribersBeforeDispose = presenter.onInfoChanged.getSubscriberCount();
  presenter.dispose();
  presenter.dispose();
  presenter.dispose();

  let presentRejected = false;
  try {
    await presenter.present({
      name: 'owners',
      fps: 30,
      slide: null,
      size: new Vector2(160, 160),
      resolutionScale: 1,
      colorSpace: 'srgb',
      background: '#101216',
    });
  } catch {
    presentRejected = true;
  }
  await wait(150);

  unsubscribe();
  store.dispose();

  return {
    ranFrames: scheduledWhileRunning > 0,
    rafDeltaAfterAbort,
    subscribersBeforeDispose,
    infoSubscribersBefore,
    subscribersAfterDispose: presenter.onInfoChanged.getSubscriberCount(),
    slidesSubscribersAfterDispose:
      presenter.onSlidesChanged.getSubscriberCount(),
    stateSubscribersAfterDispose: presenter.onStateChanged.getSubscriberCount(),
    scenesDisposed: scenes.every(scene => sceneIsDisposed(scene)),
    stageReleased: canvasReleased(presenter.stage),
    presentRejected,
    disposeIdempotent: true,
  };
}

/**
 * `GeneratorScene` keeps its `disposed` flag protected. Reading it here is a
 * fixture-only shortcut, not a public contract.
 */
function sceneIsDisposed(scene: unknown) {
  return (scene as {disposed?: boolean}).disposed === true;
}

/** Renderer owns a Stage, Scenes and a shared WebGL context. */
async function rendererDisposal() {
  const store = new RuntimeStore('renderer');
  const renderer = new Renderer(project);
  // `Renderer.playback` is private; reaching it is a fixture-only shortcut so
  // the regression can bind the Scenes the Renderer built for itself.
  const scenes = (
    renderer as unknown as {
      playback: {onScenesRecalculated: {current: object[]}};
    }
  ).playback.onScenesRecalculated.current;
  bindScenes(scenes, store);

  const unsubscribe = renderer.onFrameChanged.subscribe(() => {});
  const subscribersBeforeDispose = renderer.onFrameChanged.getSubscriberCount();

  renderer.dispose();
  renderer.dispose();

  let renderRejected = false;
  try {
    await renderer.render({
      name: 'owners',
      fps: 30,
      size: new Vector2(160, 160),
      resolutionScale: 1,
      colorSpace: 'srgb',
      background: '#101216',
      range: [0, Infinity],
      exporter: {name: '@ovacanvas/core/image-sequence', options: {}},
    } as unknown as Parameters<Renderer['render']>[0]);
  } catch {
    renderRejected = true;
  }

  unsubscribe();
  store.dispose();

  return {
    subscribersBeforeDispose,
    subscribersAfterDispose: renderer.onFrameChanged.getSubscriberCount(),
    stateSubscribersAfterDispose: renderer.onStateChanged.getSubscriberCount(),
    finishedSubscribersAfterDispose: renderer.onFinished.getSubscriberCount(),
    scenesDisposed: scenes.every(scene => sceneIsDisposed(scene)),
    stageReleased: canvasReleased(renderer.stage),
    renderRejected,
  };
}

/**
 * Replacing an embedded Player's source definitively retires the old one.
 *
 * @remarks
 * Mirrors the sequence in the embeddable player's `updateSource`. What matters
 * is that the retired Player is terminally disposed rather than merely
 * deactivated, so its scenes, audio managers and AudioContexts are released.
 */
async function embeddedReplacement() {
  const store = new RuntimeStore('embedded');
  const contextsBefore = resourceLedger.openAudioContexts;

  const build = () => {
    const player = new Player(
      project,
      {size: new Vector2(160, 160), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );
    const {binding} = store.prepareGeneration();
    registerBinding(player.playback.currentScene, binding);
    return player;
  };

  const first = build();
  const firstScene = first.playback.currentScene;
  await wait(250);
  const contextsWithFirst = resourceLedger.openAudioContexts;

  // The element's replacement sequence.
  const second = build();
  first.togglePlayback(false);
  first.dispose();
  await wait(200);

  const contextsAfterReplacement = resourceLedger.openAudioContexts;
  const secondUsable = (() => {
    try {
      second.requestRender();
      return true;
    } catch {
      return false;
    }
  })();

  let oldPlayerRejected = false;
  try {
    first.requestRender();
  } catch {
    oldPlayerRejected = true;
  }

  second.dispose();
  await wait(150);
  store.dispose();

  return {
    contextsBefore,
    contextsWithFirst,
    contextsAfterReplacement,
    oldPlayerDisposed: first.isDisposed(),
    oldPlayerRejected,
    oldSceneDisposed: sceneIsDisposed(firstScene),
    replacementUsable: secondUsable,
    contextsReturned: resourceLedger.openAudioContexts === contextsBefore,
  };
}

/**
 * Async race: dispose a Player while `configure()` is suspended on its lock
 * and while a run is suspended inside `prepare()`.
 */
async function asyncRace() {
  const store = new RuntimeStore('race');
  const player = new Player(
    project,
    {size: new Vector2(160, 160), resolutionScale: 1, fps: 30},
    {paused: true, loop: false, muted: true},
    0,
  );
  const {binding} = store.prepareGeneration();
  registerBinding(player.playback.currentScene, binding);
  await wait(250);

  const settings = {
    size: new Vector2(240, 240),
    resolutionScale: 1,
    fps: 30,
    range: [0, Infinity] as [number, number],
    audioOffset: 0,
  };

  // Two configures: the second suspends on the lock held by the first.
  const firstConfigure = player.configure(settings);
  const suspendedConfigure = player.configure({...settings, fps: 60});

  // Dispose while the second is still waiting for the lock.
  player.dispose();

  let configureThrew = false;
  try {
    await firstConfigure;
    await suspendedConfigure;
  } catch {
    configureThrew = true;
  }
  await wait(250);

  const rafBefore = rafLedger.requested;
  await wait(250);
  const idleRafDelta = rafLedger.requested - rafBefore;

  store.dispose();

  return {
    disposed: player.isDisposed(),
    configureResolvedWithoutThrowing: !configureThrew,
    // A stale continuation must not have reconfigured the dead runtime.
    fpsUnchanged: player.playback.fps === 30,
    idleRafDelta,
  };
}

const State: {suite: Record<string, any> | null; failure: string | null} = {
  suite: null,
  failure: null,
};

async function start() {
  if (State.suite || State.failure) return {...State};
  try {
    const suite: Record<string, any> = {};
    suite.presenter = await presenterDisposal();
    suite.renderer = await rendererDisposal();
    suite.embedded = await embeddedReplacement();
    suite.race = await asyncRace();

    suite.assertions = {
      presenterRanBeforeAbort: suite.presenter.ranFrames,
      presenterAbortStoppedScheduling: suite.presenter.rafDeltaAfterAbort === 0,
      presenterDisposalClearedDispatchers:
        suite.presenter.subscribersBeforeDispose > 0 &&
        suite.presenter.subscribersAfterDispose === 0 &&
        suite.presenter.slidesSubscribersAfterDispose === 0 &&
        suite.presenter.stateSubscribersAfterDispose === 0,
      presenterDisposalReleasedScenes: suite.presenter.scenesDisposed,
      presenterDisposalReleasedStage: suite.presenter.stageReleased,
      presenterFailsClosedAfterDisposal: suite.presenter.presentRejected,

      rendererDisposalClearedDispatchers:
        suite.renderer.subscribersBeforeDispose > 0 &&
        suite.renderer.subscribersAfterDispose === 0 &&
        suite.renderer.stateSubscribersAfterDispose === 0 &&
        suite.renderer.finishedSubscribersAfterDispose === 0,
      rendererDisposalReleasedScenes: suite.renderer.scenesDisposed,
      rendererDisposalReleasedStage: suite.renderer.stageReleased,
      rendererFailsClosedAfterDisposal: suite.renderer.renderRejected,

      embeddedReplacementDisposedOldPlayer:
        suite.embedded.oldPlayerDisposed && suite.embedded.oldPlayerRejected,
      embeddedReplacementReleasedOldScene: suite.embedded.oldSceneDisposed,
      embeddedReplacementKeptNewPlayerUsable: suite.embedded.replacementUsable,
      embeddedReplacementReturnedResources: suite.embedded.contextsReturned,

      raceDisposedDuringConfigure: suite.race.disposed,
      raceStaleContinuationDidNotMutate: suite.race.fpsUnchanged,
      raceLeftNoScheduling: suite.race.idleRafDelta === 0,
    };

    State.suite = suite;
    Status.textContent = JSON.stringify(suite.assertions, null, 2);
  } catch (error: any) {
    State.failure = String(error?.stack ?? error);
    Status.textContent = State.failure;
  }
  return {...State};
}

(window as any).__OVC_OWNERS__ = {
  start,
  getSuite: () => State.suite,
  getFailure: () => State.failure,
};
