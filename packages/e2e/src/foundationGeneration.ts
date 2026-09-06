import {
  FoundationHost,
  assetSubscriberCount,
  rafLedger,
  resourceLedger,
  wait,
} from './foundationHost';

/**
 * The five attack regressions demanded by the post-first-green architecture
 * attack, run in a real browser against real Players, Stages and Scenes.
 *
 * @remarks
 * Each one is a property, not an API proposal. Nothing here fixes a public
 * runtime API, a serialization format, a transition implementation or an
 * interaction vocabulary.
 */
const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

function makeContainer(id: string) {
  const container = document.createElement('div');
  container.className = 'stage';
  container.dataset.runtime = id;
  Stages.append(container);
  return container;
}

async function bootHost(id: string) {
  const host = new FoundationHost(id, makeContainer(id));
  const deadline = Date.now() + 30000;
  while (!host.ready && Date.now() < deadline) await wait(5);
  if (!host.ready) throw new Error(`runtime ${id} never rendered`);
  return host;
}

/**
 * 1. STALE MUTATION.
 *
 * Capture a mutation capability from generation N, retire N by activating
 * N+1, then use the old capability.
 */
async function staleMutation() {
  const active = await bootHost('stale-active');
  const staleCapability = active.mutationCapability();
  const before = active.snapshot();

  const replacement = active.prepareReplacement('stale-replacement');
  const prepared = await FoundationHost.awaitPrepared(replacement);
  const commit = active.commitReplacement(replacement);

  let rejected = false;
  let rejectionMessage = '';
  try {
    staleCapability.write(draft => {
      draft.width = 777;
    });
  } catch (error: any) {
    rejected = true;
    rejectionMessage = String(error?.message ?? error);
  }
  await wait(120);

  const after = replacement.snapshot();
  replacement.dispose();

  return {
    prepared,
    committed: commit.ok,
    capabilityStillValid: staleCapability.isValid(),
    rejected,
    rejectionMessage,
    revisionBefore: before.revision,
    revisionAfter: after.revision,
    widthBefore: before.width,
    widthAfter: after.width,
    canvasHashBefore: before.canvasHash,
    canvasHashAfter: after.canvasHash,
    nodeKeyAfter: after.nodeKey,
  };
}

/**
 * 2. FAILED PREPARATION.
 *
 * A is active and valid; B fails before ever reporting readiness. A must be
 * untouched, still bound, still idle, and nothing may leak.
 */
async function failedPreparation() {
  const active = await bootHost('failure-active');
  const before = active.snapshot();
  const subscribersBefore = assetSubscriberCount();
  const contextsBefore = resourceLedger.openAudioContexts;
  const renderBefore = active.renderCount;

  const attempt = active.prepareReplacement('failure-replacement', {
    failOnPrepare: true,
  });
  const becameReady = await FoundationHost.awaitPrepared(attempt, 3000);

  // Preparation failed, so the host discards the staged work. The accepted
  // presentation was never involved.
  attempt.dispose();
  await wait(200);

  const rafBeforeIdle = rafLedger.requested;
  await wait(250);
  const idleRafDelta = rafLedger.requested - rafBeforeIdle;

  const after = active.snapshot();
  const stillWritable = (() => {
    try {
      active.write(before.width);
      return true;
    } catch {
      return false;
    }
  })();

  const result = {
    becameReady,
    stagedState: attempt.generation.state,
    activeStillAccepted: after.isAccepted,
    acceptedGenerationUnchanged:
      after.acceptedGeneration === before.acceptedGeneration,
    bindingPreserved: after.nodeKey !== null,
    authorityUnchanged:
      after.width === before.width && after.revision === before.revision,
    presentationUnchanged: after.canvasHash === before.canvasHash,
    activeRendersDuringFailure: after.renderCount - renderBefore,
    returnedToIdle: after.mode === 'idle',
    idleRafDelta,
    subscribersReturned: assetSubscriberCount() === subscribersBefore,
    contextsReturned: resourceLedger.openAudioContexts === contextsBefore,
    stillWritable,
  };

  active.dispose();
  return result;
}

/**
 * 3. STALE ACTIVATION.
 *
 * B is prepared against revision R; the accepted projection advances to R+1
 * before B activates. The commit must be refused.
 */
async function staleActivation() {
  const active = await bootHost('stale-activation-active');
  const staged = active.prepareReplacement('stale-activation-replacement');
  const preparedAtRevision = staged.generation.preparedAtRevision;
  const prepared = await FoundationHost.awaitPrepared(staged);

  // The accepted runtime projection moves on while B waited.
  await active.writeAndWait(455);
  const revisionAtCommit = active.store.revision;

  const commit = active.commitReplacement(staged);
  await wait(150);

  const after = active.snapshot();
  const result = {
    prepared,
    preparedAtRevision,
    revisionAtCommit,
    commitRejected: !commit.ok,
    rejectionReason: commit.reason,
    stagedState: staged.generation.state,
    activeStillAccepted: after.isAccepted,
    activeBindingPreserved: after.nodeKey !== null,
    activeWidth: after.width,
    activeMode: after.mode,
    stagedDisposed: staged.snapshot().playerDisposed,
  };

  active.dispose();
  return result;
}

/**
 * 4. READY BEFORE VISIBLE.
 *
 * B prepares in a detached container, reaches ready without being shown, costs
 * no continuous animation frames while it waits, and still activates later.
 */
async function readyBeforeVisible() {
  const active = await bootHost('ready-active');
  const staged = active.prepareReplacement('ready-replacement');
  const prepared = await FoundationHost.awaitPrepared(staged);

  const connectedWhilePrepared = staged.stage.finalBuffer.isConnected;
  const acceptedWhilePrepared = staged.snapshot().isAccepted;
  const stateWhilePrepared = staged.generation.state;

  const rafBeforeIdle = rafLedger.requested;
  const rendersBeforeIdle = staged.renderCount + active.renderCount;
  await wait(400);
  const idleRafDelta = rafLedger.requested - rafBeforeIdle;
  const idleRenderDelta =
    staged.renderCount + active.renderCount - rendersBeforeIdle;

  const commit = active.commitReplacement(staged);
  await wait(120);

  const after = staged.snapshot();
  const result = {
    prepared,
    connectedWhilePrepared,
    acceptedWhilePrepared,
    stateWhilePrepared,
    idleRafDelta,
    idleRenderDelta,
    activatedAfterWaiting: commit.ok,
    connectedAfterCommit: staged.stage.finalBuffer.isConnected,
    acceptedAfterCommit: after.isAccepted,
  };

  staged.dispose();
  return result;
}

/**
 * 5. SUCCESSFUL REPLACEMENT.
 *
 * A is active; B prepares and commits; the old capability goes stale; semantic
 * identity rebinds; retiring A does not corrupt B.
 */
async function successfulReplacement() {
  const active = await bootHost('replace-active');
  const oldCapability = active.mutationCapability();
  const before = active.snapshot();

  const staged = active.prepareReplacement('replace-incoming');
  const prepared = await FoundationHost.awaitPrepared(staged);
  const commit = active.commitReplacement(staged);
  await wait(150);

  const oldStillValid = oldCapability.isValid();
  const afterCommit = staged.snapshot();

  // The incoming generation holds real authority and its writes render.
  const revisionAfterWrite = staged.write(321);
  await wait(200);
  const afterWrite = staged.snapshot();

  const result = {
    prepared,
    committed: commit.ok,
    activatedGeneration: commit.activated,
    retiredGeneration: commit.retired,
    oldGenerationBefore: before.acceptedGeneration,
    oldCapabilityStale: !oldStillValid,
    oldPlayerDisposed: active.snapshot().playerDisposed,
    incomingAccepted: afterCommit.isAccepted,
    incomingBoundSemanticNode: afterCommit.nodeKey !== null,
    incomingCanvasConnected: staged.stage.finalBuffer.isConnected,
    revisionAfterWrite,
    incomingWidthAfterWrite: afterWrite.width,
    incomingRendered: afterWrite.renderCount > afterCommit.renderCount,
    incomingReturnedToIdle: afterWrite.mode === 'idle',
    trackedGenerations: staged.store.authority.trackedGenerations,
  };

  staged.dispose();
  return result;
}

const State: {suite: Record<string, any> | null; failure: string | null} = {
  suite: null,
  failure: null,
};

async function start() {
  if (State.suite || State.failure) return {...State};
  try {
    const suite: Record<string, any> = {};
    suite.staleMutation = await staleMutation();
    suite.failedPreparation = await failedPreparation();
    suite.staleActivation = await staleActivation();
    suite.readyBeforeVisible = await readyBeforeVisible();
    suite.successfulReplacement = await successfulReplacement();

    suite.assertions = {
      staleMutationRejected:
        suite.staleMutation.committed &&
        !suite.staleMutation.capabilityStillValid &&
        suite.staleMutation.rejected,
      staleMutationLeftRevisionUnchanged:
        suite.staleMutation.revisionAfter ===
        suite.staleMutation.revisionBefore,
      staleMutationLeftValueUnchanged:
        suite.staleMutation.widthAfter === suite.staleMutation.widthBefore,
      staleMutationLeftPresentationUnchanged:
        suite.staleMutation.canvasHashAfter ===
        suite.staleMutation.canvasHashBefore,

      failedPreparationNeverBecameReady: !suite.failedPreparation.becameReady,
      failedPreparationLeftActiveAccepted:
        suite.failedPreparation.activeStillAccepted &&
        suite.failedPreparation.acceptedGenerationUnchanged,
      failedPreparationLeftBindingLive:
        suite.failedPreparation.bindingPreserved,
      failedPreparationLeftAuthorityUnchanged:
        suite.failedPreparation.authorityUnchanged,
      failedPreparationLeftPresentationUnchanged:
        suite.failedPreparation.presentationUnchanged &&
        suite.failedPreparation.activeRendersDuringFailure === 0,
      failedPreparationReturnedToIdle:
        suite.failedPreparation.returnedToIdle &&
        suite.failedPreparation.idleRafDelta === 0,
      failedPreparationLeakedNothing:
        suite.failedPreparation.subscribersReturned &&
        suite.failedPreparation.contextsReturned,
      failedPreparationLeftHostUsable: suite.failedPreparation.stillWritable,

      staleActivationRefused:
        suite.staleActivation.prepared &&
        suite.staleActivation.commitRejected &&
        suite.staleActivation.rejectionReason === 'stale-revision',
      staleActivationLeftActiveValid:
        suite.staleActivation.activeStillAccepted &&
        suite.staleActivation.activeBindingPreserved &&
        suite.staleActivation.activeWidth === 455 &&
        suite.staleActivation.activeMode === 'idle',
      staleActivationRetiredStagedCleanly:
        suite.staleActivation.stagedState === 'discarded' &&
        suite.staleActivation.stagedDisposed,

      readyBeforeVisiblePrepared:
        suite.readyBeforeVisible.prepared &&
        !suite.readyBeforeVisible.connectedWhilePrepared &&
        !suite.readyBeforeVisible.acceptedWhilePrepared &&
        suite.readyBeforeVisible.stateWhilePrepared === 'ready',
      readyBeforeVisibleCostNoFrames:
        suite.readyBeforeVisible.idleRafDelta === 0 &&
        suite.readyBeforeVisible.idleRenderDelta === 0,
      readyBeforeVisibleActivatedLater:
        suite.readyBeforeVisible.activatedAfterWaiting &&
        suite.readyBeforeVisible.connectedAfterCommit &&
        suite.readyBeforeVisible.acceptedAfterCommit,

      replacementCommitted:
        suite.successfulReplacement.committed &&
        suite.successfulReplacement.retiredGeneration ===
          suite.successfulReplacement.oldGenerationBefore,
      replacementMadeOldCapabilityStale:
        suite.successfulReplacement.oldCapabilityStale,
      replacementDisposedOutgoingPresentation:
        suite.successfulReplacement.oldPlayerDisposed,
      replacementRebound:
        suite.successfulReplacement.incomingAccepted &&
        suite.successfulReplacement.incomingBoundSemanticNode &&
        suite.successfulReplacement.incomingCanvasConnected,
      replacementSurvivedRetirement:
        suite.successfulReplacement.incomingWidthAfterWrite === 321 &&
        suite.successfulReplacement.incomingRendered &&
        suite.successfulReplacement.incomingReturnedToIdle,
      replacementLeftBoundedGenerations:
        suite.successfulReplacement.trackedGenerations === 1,
    };

    State.suite = suite;
    Status.textContent = JSON.stringify(suite.assertions, null, 2);
  } catch (error: any) {
    State.failure = String(error?.stack ?? error);
    Status.textContent = State.failure;
  }
  return {...State};
}

(window as any).__OVC_GENERATION__ = {
  start,
  getSuite: () => State.suite,
  getFailure: () => State.failure,
};
