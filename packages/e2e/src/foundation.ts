import {
  FoundationHost,
  assetSubscriberCount,
  rafLedger,
  resourceLedger,
  wait,
} from './foundationHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

function makeContainer(id: string) {
  const container = document.createElement('div');
  container.className = 'stage';
  container.dataset.runtime = id;
  Stages.append(container);
  return container;
}

/**
 * Asset subscribers already present before any runtime exists.
 *
 * @remarks
 * Not zero: `Img` registers one module-lifetime subscriber in a static block,
 * which is exactly the pattern the multiplexer exists to support. Per-runtime
 * subscriptions must return to *this* number, not to zero.
 */
const AssetBaseline = assetSubscriberCount();

const HostA = new FoundationHost('A', makeContainer('A'));
const HostB = new FoundationHost('B', makeContainer('B'));

const State: {
  suite: Record<string, any> | null;
  failure: string | null;
  started: boolean;
} = {suite: null, failure: null, started: false};

async function awaitReady() {
  const deadline = Date.now() + 30000;
  while ((!HostA.ready || !HostB.ready) && Date.now() < deadline) await wait(5);
  if (!HostA.ready || !HostB.ready) throw new Error('runtimes never rendered');
}

async function runSuite() {
  const result: Record<string, any> = {};

  // Frame 0 is drawn before any playback progresses time.
  result.frameZero = {a: HostA.snapshot(), b: HostB.snapshot()};

  // A truly idle runtime performs no continuous RAF/render loop.
  const idle = {
    aRender: HostA.renderCount,
    bRender: HostB.renderCount,
    raf: rafLedger.requested,
  };
  await wait(500);
  result.idle = {
    aRenderDelta: HostA.renderCount - idle.aRender,
    bRenderDelta: HostB.renderCount - idle.bRender,
    rafDelta: rafLedger.requested - idle.raf,
  };

  // Synchronous dirty changes coalesce into exactly one render.
  for (const writes of [1, 10, 100]) {
    const beforeRender = HostA.renderCount;
    const beforeRaf = rafLedger.requested;
    const bBefore = HostB.renderCount;
    for (let i = 0; i < writes; i++) HostA.write(140 + i);
    while (HostA.renderCount === beforeRender) await wait(2);
    await wait(60);
    result[`dirty${writes}`] = {
      renders: HostA.renderCount - beforeRender,
      raf: rafLedger.requested - beforeRaf,
      frame: HostA.player.playback.frame,
      width: HostA.store.width(),
      bRenderDelta: HostB.renderCount - bBefore,
    };
  }

  // Runtime ownership is isolated between simultaneous runtimes.
  const aBeforePresentation = HostA.snapshot();
  await HostB.present();
  result.presentation = {
    aBefore: aBeforePresentation,
    aAfter: HostA.snapshot(),
    b: HostB.snapshot(),
  };

  // Repeated dirty cycles must not leave a residual loop behind.
  for (let i = 0; i < 100; i++) await HostA.writeAndWait(160 + i);
  const afterCycles = {render: HostA.renderCount, raf: rafLedger.requested};
  await wait(400);
  result.hundredCycles = {
    idleRenderDelta: HostA.renderCount - afterCycles.render,
    idleRafDelta: rafLedger.requested - afterCycles.raf,
    snapshot: HostA.snapshot(),
  };

  // Reset and seek reconstruct presentation without rewinding semantic truth.
  const semanticBeforeSeek = {
    width: HostA.store.width(),
    revision: HostA.store.revision,
  };
  const seekSnapshots = [];
  for (const frame of [10, 2, 15, 0]) {
    await HostA.seek(Math.min(frame, HostA.player.playback.duration));
    seekSnapshots.push(HostA.snapshot());
  }
  result.seek = {semanticBeforeSeek, snapshots: seekSnapshots};

  // Export uses a frozen semantic snapshot and repeats bit-exactly.
  const frames = [
    0,
    Math.floor(HostB.player.playback.duration / 2),
    HostB.player.playback.duration,
  ];
  const passOne = await HostB.exportPass(frames);
  const passTwo = await HostB.exportPass(frames);
  result.export = {
    frames,
    passOne,
    passTwo,
    deterministic: JSON.stringify(passOne) === JSON.stringify(passTwo),
    // A constant image would satisfy determinism trivially, so require the
    // sampled frames to actually differ from one another.
    framesDiffer: new Set(passOne).size === passOne.length,
  };

  // ---- Wake-source matrix ------------------------------------------------
  // Foundation invariant 21 fixes the wake-source classes. Each must wake the
  // scheduler for exactly the work it asks for and then let it sleep again,
  // with a fully quiet window in between.
  const wakeSources: Record<string, {raf: number; renders: number}> = {};
  const measure = async (name: string, action: () => Promise<void>) => {
    await wait(120);
    const quietRaf = rafLedger.requested;
    const quietRender = HostA.renderCount;
    await wait(200);
    const idleRaf = rafLedger.requested - quietRaf;
    const idleRender = HostA.renderCount - quietRender;
    const beforeRaf = rafLedger.requested;
    const beforeRender = HostA.renderCount;
    await action();
    await wait(80);
    wakeSources[name] = {
      raf: rafLedger.requested - beforeRaf,
      renders: HostA.renderCount - beforeRender,
    };
    wakeSources[`${name}Idle`] = {raf: idleRaf, renders: idleRender};
  };

  await measure('dirtyDependency', () => HostA.writeAndWait(301));
  await measure('explicitSeek', () => HostA.seek(5));
  await measure('explicitRender', () => HostA.requestRenderAndWait());
  await measure('hostResize', () => HostA.resizeAndWait(320));
  await measure('presentation', () => HostA.present());
  result.wakeSources = wakeSources;

  // ---- Terminal disposal ------------------------------------------------
  // Disposal is terminal, idempotent, fails closed, and does not disturb a
  // peer runtime. Extra runtimes are created and destroyed so the page can be
  // shown to return to its resource baseline.
  const contextsBeforeCycles = resourceLedger.openAudioContexts;
  const cycleHosts: FoundationHost[] = [];
  for (let i = 0; i < 5; i++) {
    const host = new FoundationHost(`cycle${i}`, makeContainer(`cycle${i}`));
    cycleHosts.push(host);
  }
  const deadline = Date.now() + 30000;
  while (cycleHosts.some(host => !host.ready) && Date.now() < deadline) {
    await wait(5);
  }
  const contextsWhileAlive = resourceLedger.openAudioContexts;
  for (const host of cycleHosts) host.dispose();
  await wait(200);
  result.lifecycleCycles = {
    allReady: cycleHosts.every(host => host.ready),
    contextsBeforeCycles,
    contextsWhileAlive,
    contextsAfterDispose: resourceLedger.openAudioContexts,
    callbacksAfterDispose: cycleHosts.reduce(
      (total, host) => total + host.callbacksAfterDispose,
      0,
    ),
  };

  // A runtime disposed while a peer keeps working must not disturb the peer.
  const victim = new FoundationHost('victim', makeContainer('victim'));
  while (!victim.ready) await wait(5);
  const bBeforeVictim = HostB.snapshot();
  const victimRenders = victim.renderCount;
  victim.dispose();
  // A write attempted after terminal disposal must now fail closed rather
  // than quietly landing on a dead runtime.
  let postDisposeWriteRejected = false;
  try {
    victim.write(999);
  } catch {
    postDisposeWriteRejected = true;
  }
  await wait(150);
  const failClosed = victim.failClosed();
  for (let i = 0; i < 100; i++) victim.dispose();
  await HostB.writeAndWait(77);
  result.disposal = {
    failClosed,
    postDisposeWriteRejected,
    rendersAfterDispose: victim.renderCount - victimRenders,
    snapshot: victim.snapshot(),
    peerBefore: bBeforeVictim,
    peerAfter: HostB.snapshot(),
  };

  // ---- Media ownership --------------------------------------------------
  // Two runtimes showing the *same* source must own distinct elements, and
  // disposing one must release only its own. A process-global element pool
  // would fail both halves of this.
  const mediaA = new FoundationHost('mediaA', makeContainer('mediaA'), true);
  const mediaB = new FoundationHost('mediaB', makeContainer('mediaB'), true);
  const mediaDeadline = Date.now() + 30000;
  while ((!mediaA.ready || !mediaB.ready) && Date.now() < mediaDeadline) {
    await wait(5);
  }
  const elementA = mediaA.videoElement();
  const elementB = mediaB.videoElement();

  // ---- Audio synchronisation ---------------------------------------------
  // syncAudio() maps presentation seconds onto the audio clock through the
  // offset/trim/rate transform. The mapping must round-trip exactly, and a
  // seek must leave the audio clock aligned with the presentation clock.
  const roundTrip = mediaA.audioTimeRoundTrip(0.5, 1.25);
  mediaA.audioTimeRoundTrip(0, 0);
  const seekFrame = Math.min(20, mediaA.player.playback.duration);
  await mediaA.seek(seekFrame);
  // Player.syncAudio(-3) is applied after a seek.
  const expectedAudioTime = mediaA.framesToSeconds(seekFrame - 3);
  const audioElement = mediaA.audioElement();
  result.audio = {
    roundTrip,
    roundTripExact: Math.abs(roundTrip - 1.25) < 1e-9,
    expectedAudioTime,
    actualAudioTime: mediaA.audioTime(),
    pausedWhileIdle: audioElement.paused,
    sourceBeforeDispose: !!audioElement.getAttribute('src'),
  };

  mediaA.dispose();
  await wait(150);
  result.audioAfterDispose = {
    paused: audioElement.paused,
    released: !audioElement.getAttribute('src'),
  };
  result.media = {
    bothReady: mediaA.ready && mediaB.ready,
    distinctElements: elementA !== elementB,
    disposedReleased: elementA.paused && !elementA.getAttribute('src'),
    peerRetained: !!elementB.getAttribute('src'),
  };
  mediaB.dispose();
  await wait(100);
  result.mediaAfterBoth = {
    peerReleased: elementB.paused && !elementB.getAttribute('src'),
  };

  result.assertions = {
    frameZeroRendered:
      result.frameZero.a.renderCount > 0 &&
      result.frameZero.b.renderCount > 0 &&
      result.frameZero.a.frame === 0 &&
      result.frameZero.b.frame === 0,
    frameZeroBoundSemanticNode:
      result.frameZero.a.nodeKey !== null &&
      result.frameZero.b.nodeKey !== null,
    idleZeroRender:
      result.idle.aRenderDelta === 0 && result.idle.bRenderDelta === 0,
    idleZeroRaf: result.idle.rafDelta === 0,
    dirty1OneRender: result.dirty1.renders === 1,
    dirty10OneRender: result.dirty10.renders === 1,
    dirty100OneRender: result.dirty100.renders === 1,
    dirty100OneRaf: result.dirty100.raf === 1,
    dirtyDidNotAdvanceTime: result.dirty100.frame === 0,
    dirtyAppliedLastWrite: result.dirty100.width === 239,
    dirtyIsolatedToOneRuntime:
      result.dirty1.bRenderDelta === 0 &&
      result.dirty10.bRenderDelta === 0 &&
      result.dirty100.bRenderDelta === 0,
    presentationWokeAndSlept:
      result.presentation.b.mode === 'idle' && result.presentation.b.frame > 0,
    peerSleptWhileOtherAnimated:
      result.presentation.aAfter.renderCount ===
      result.presentation.aBefore.renderCount,
    hundredCyclesNoIdleLoop:
      result.hundredCycles.idleRenderDelta === 0 &&
      result.hundredCycles.idleRafDelta === 0,
    seekPreservedAuthority: result.seek.snapshots.every(
      (snapshot: any) =>
        snapshot.width === semanticBeforeSeek.width &&
        snapshot.revision === semanticBeforeSeek.revision,
    ),
    seekReturnedToIdle: result.seek.snapshots.every(
      (snapshot: any) => snapshot.mode === 'idle',
    ),
    seekReboundSemanticNode: result.seek.snapshots.every(
      (snapshot: any) => snapshot.nodeKey !== null,
    ),
    exportDeterministic: result.export.deterministic,
    exportSampledDistinctFrames: result.export.framesDiffer,
    disposeIsTerminal:
      result.disposal.rendersAfterDispose === 0 &&
      result.disposal.snapshot.playerDisposed,
    disposeFailsClosed: Object.values(result.disposal.failClosed).every(
      value => value === true,
    ),
    disposeRejectedAuthorityWrite: result.disposal.postDisposeWriteRejected,
    disposeIsIdempotent:
      result.disposal.snapshot.disposeCalls === 101 &&
      result.disposal.snapshot.disposeExecutions === 1,
    disposeLeftPeerWorking:
      result.disposal.peerAfter.width === 77 &&
      result.disposal.peerAfter.renderCount >
        result.disposal.peerBefore.renderCount,
    lifecycleCyclesAllStarted: result.lifecycleCycles.allReady,
    lifecycleCyclesOpenedContexts:
      result.lifecycleCycles.contextsWhileAlive >
      result.lifecycleCycles.contextsBeforeCycles,
    lifecycleCyclesReturnedToBaseline:
      result.lifecycleCycles.contextsAfterDispose ===
      result.lifecycleCycles.contextsBeforeCycles,
    lifecycleCyclesNoResurrection:
      result.lifecycleCycles.callbacksAfterDispose === 0,
    wakeSourcesQuietBetween: [
      'dirtyDependency',
      'explicitSeek',
      'explicitRender',
      'hostResize',
      'presentation',
    ].every(name => {
      const idle = result.wakeSources[`${name}Idle`];
      return idle.raf === 0 && idle.renders === 0;
    }),
    wakeSourceDirtyDependencyOneFrame:
      result.wakeSources.dirtyDependency.raf === 1 &&
      result.wakeSources.dirtyDependency.renders === 1,
    wakeSourceExplicitSeekOneFrame:
      result.wakeSources.explicitSeek.raf === 1 &&
      result.wakeSources.explicitSeek.renders === 1,
    wakeSourceExplicitRenderOneFrame:
      result.wakeSources.explicitRender.raf === 1 &&
      result.wakeSources.explicitRender.renders === 1,
    wakeSourceHostResizeWokeOnce: result.wakeSources.hostResize.renders === 1,
    wakeSourcePresentationRanManyFrames:
      result.wakeSources.presentation.renders > 1,
    audioClockRoundTripsExactly: result.audio.roundTripExact,
    audioFollowedTheSeek:
      Math.abs(result.audio.actualAudioTime - result.audio.expectedAudioTime) <
      1 / 30,
    audioPausedWhileRuntimeIdle: result.audio.pausedWhileIdle,
    audioHeldSourceBeforeDispose: result.audio.sourceBeforeDispose,
    audioStoppedOnDispose:
      result.audioAfterDispose.paused && result.audioAfterDispose.released,
    mediaNodesMounted: result.media.bothReady,
    mediaElementsAreNodeScoped: result.media.distinctElements,
    mediaDisposalReleasedOwnElement: result.media.disposedReleased,
    mediaDisposalLeftPeerElementIntact: result.media.peerRetained,
    mediaPeerReleasedOnItsOwnDisposal: result.mediaAfterBoth.peerReleased,
    runtimeIdsIsolated:
      HostA.snapshot().nodeKey !== null &&
      HostB.snapshot().nodeKey !== null &&
      HostA.store !== HostB.store,
  };

  State.suite = result;
  Status.textContent = JSON.stringify(result.assertions, null, 2);
  return result;
}

/**
 * The driver calls this once and awaits the returned promise, so Playwright
 * performs no in-page polling while the suite is measuring scheduling.
 */
async function start() {
  if (State.started) return {suite: State.suite, failure: State.failure};
  State.started = true;
  try {
    await awaitReady();
    await runSuite();
  } catch (error: any) {
    State.failure = String(error?.stack ?? error);
    Status.textContent = State.failure;
  }
  return {suite: State.suite, failure: State.failure};
}

/**
 * Boots the runtimes without running the measurement suite, for drivers that
 * want to drive the page themselves (the HMR suite does).
 */
async function waitReady() {
  await awaitReady();
  return {
    a: HostA.snapshot(),
    b: HostB.snapshot(),
    assetSubscribers: assetSubscriberCount(),
  };
}

(window as any).__OVC_FOUNDATION__ = {
  start,
  waitReady,
  snapshot: () => ({
    a: HostA.snapshot(),
    b: HostB.snapshot(),
    assetSubscribers: assetSubscriberCount(),
  }),
  assetBaseline: () => AssetBaseline,
  disposeAll: () => {
    HostA.dispose();
    HostB.dispose();
    return assetSubscriberCount();
  },
  getSuite: () => State.suite,
  getFailure: () => State.failure,
  hosts: {a: HostA, b: HostB},
};
