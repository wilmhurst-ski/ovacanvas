import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Can a genuinely different presentation, constructed at runtime rather than
 * imported from a build-time `?project` module, enter the presentation
 * lifecycle this project already built?
 *
 * @remarks
 * Presentation A is the compiled learner fixture, which every earlier proof
 * used. Candidate B is assembled while the page is running, out of ordinary
 * exported runtime values, and is put through the same `TransitionOwner`,
 * the same `RuntimeAuthority` activation boundary and the same CAP-01
 * pointer path.
 *
 * The fixture's node choices, target names and construction helper are
 * NON-NORMATIVE. Nothing here is a compiler API or a serialization format.
 */
describe('runtime-constructed presentation lifecycle', () => {
  let app: FoundationApp;

  const snapshot = (): Promise<any> =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.snapshot());
  const stage = (kind: string): Promise<any> =>
    app.page.evaluate(k => window.ovcRuntimeBuilt.stage(k as any), kind);
  const activate = (): Promise<any> =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.activate());
  const retireOutgoing = (): Promise<boolean> =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.retireOutgoing());
  const advanceOverlap = (steps: number): Promise<number> =>
    app.page.evaluate(s => window.ovcRuntimeBuilt.advanceOverlap(s), steps);
  const commit = (): Promise<any> =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.commit());
  const discard = (): Promise<any> =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.discard());
  const inspect = (target: string): Promise<any> =>
    app.page.evaluate(t => window.ovcRuntimeBuilt.inspect(t), target);
  const nodeIdentity = (
    which: 'current' | 'outgoing',
    target: string,
  ): Promise<number | null> =>
    app.page.evaluate(
      a => window.ovcRuntimeBuilt.nodeIdentity(a.which, a.target),
      {which, target},
    );
  const writeFrom = (
    which: 'current' | 'outgoing',
    rate: number,
  ): Promise<number | false | null> =>
    app.page.evaluate(a => window.ovcRuntimeBuilt.writeFrom(a.which, a.rate), {
      which,
      rate,
    });
  const idleWindow = (ms: number): Promise<any> =>
    app.page.evaluate(v => window.ovcRuntimeBuilt.idleWindow(v), ms);
  const quiesce = () =>
    app.page.evaluate(() => window.ovcRuntimeBuilt.quiesce());
  const settled = (before: number) =>
    app.page.evaluate(b => window.ovcRuntimeBuilt.settled(b), before);

  async function movePointerTo(x: number, y: number, steps = 1) {
    const point = await app.page.evaluate(
      a => window.ovcRuntimeBuilt.clientPoint(a.x, a.y),
      {x, y},
    );
    await app.page.mouse.move(point.x, point.y, {steps});
  }

  /** Press the rate handle where it currently is, leaving the pointer down. */
  async function pressRateHandle() {
    const at = await app.page.evaluate(() =>
      window.ovcRuntimeBuilt.rateHandlePoint(),
    );
    await movePointerTo(at.x, at.y);
    await app.page.mouse.down();
    return at;
  }

  /** A real drag that leaves the exploration open after release. */
  async function dragRate(deltaX: number) {
    const at = await pressRateHandle();
    await movePointerTo(at.x + deltaX, at.y, 8);
    await app.page.mouse.up();
    return at;
  }

  beforeAll(async () => {
    app = await startFoundation('/runtimeBuilt.html');
    await app.page.waitForFunction(
      () => (window as any).ovcRuntimeBuilt !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => window.ovcRuntimeBuilt.ready());
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  });

  // --- BASELINE. THE COMPILED PRESENTATION EVERY EARLIER PROOF USED ---

  test('A is the compiled build-time presentation', async () => {
    const state = await snapshot();
    expect(state.phase).toBe('active');
    // The authority starts at revision 0; every later assertion is relative.
    expect(state.revision).toBe(0);
    expect(state.current.kind).toBe('compiled');

    // A came out of the `?project` module, object identity and all.
    expect(state.current.provenance.fromCompiledProject).toBe(true);
    // In dev the bundler's project goes through `editorBootstrap`, so it
    // carries plugins. This is the thing B is being compared against.
    expect(state.current.provenance.pluginCount).toBeGreaterThan(0);
    expect(state.current.targets).toEqual(['offset', 'rate', 'readout']);
  });

  // --- PROOF 1 / 3. RUNTIME CONSTRUCTION, OFFSTAGE ---

  test('a runtime-constructed candidate stages offstage without ?project', async () => {
    const before = await snapshot();

    const staged = await stage('runtime');
    expect(staged.ok).toBe(true);
    expect(staged.preparedAtRevision).toBe(before.revision);

    const withCandidate = await snapshot();
    const candidate = withCandidate.candidate;
    expect(candidate).not.toBeNull();
    expect(candidate.kind).toBe('runtime');

    // Not the compiled project, and not a fresh project wrapped around the
    // bundler's scene description either.
    expect(candidate.provenance.fromCompiledProject).toBe(false);
    expect(candidate.provenance.sharesSceneWithCompiled).toBe(false);
    expect(candidate.provenance.projectName).toMatch(/^ovc-runtime-/);
    expect(candidate.provenance.sceneNames).toEqual([
      candidate.provenance.projectName,
    ]);
    // No editor plugin, and not even the default plugin, participates.
    expect(candidate.provenance.pluginCount).toBe(0);
    expect(candidate.provenance.pluginNames).toEqual([]);
    // Metadata exists with no file behind it.
    expect(candidate.provenance.hasProjectMeta).toBe(true);
    expect(candidate.provenance.hasSettingsMeta).toBe(true);
    // The scene's runtime name is donor bookkeeping, not semantic identity.
    expect(candidate.provenance.sceneName).toBe(
      candidate.provenance.projectName,
    );

    // Offstage: not visible, not writable, not in the slot.
    expect(candidate.visible).toBe(false);
    expect(candidate.writable).toBe(false);
    expect(withCandidate.canvasesInSlot).toBe(1);

    // A is untouched: still current, visible, writable.
    expect(withCandidate.phase).toBe('ready');
    expect(withCandidate.candidateReady).toBe(true);
    expect(withCandidate.current.visible).toBe(true);
    expect(withCandidate.current.writable).toBe(true);
    expect(withCandidate.revision).toBe(before.revision);
  });

  test('A stays interactive while the runtime candidate is staged', async () => {
    const before = await snapshot();
    await dragRate(80);
    await settled(before.current.renderCount);

    const held = await snapshot();
    expect(held.current.hasActiveExploration).toBe(true);
    expect(held.current.displayedRate).toBeGreaterThan(before.acceptedRate);
    // Provisional only.
    expect(held.revision).toBe(before.revision);
    expect(held.acceptedRate).toBe(before.acceptedRate);
    // And the candidate is still exactly where it was.
    expect(held.candidate.writable).toBe(false);
    expect(held.candidateReady).toBe(true);

    const discarded = await discard();
    expect(discarded.ok).toBe(true);
    const after = await snapshot();
    expect(after.current.hasActiveExploration).toBe(false);
    expect(after.revision).toBe(before.revision);
  });

  // --- PROOF 2. THE CONTENT IS GENUINELY DIFFERENT ---

  test('the runtime candidate is materially different content', async () => {
    const state = await snapshot();
    const a = state.current;
    const b = state.candidate;

    // Semantic target sets.
    expect(a.targets).toEqual(['offset', 'rate', 'readout']);
    expect(b.targets).toEqual(['annotation', 'rate', 'vector']);

    // One identity continues.
    expect(a.targets).toContain('rate');
    expect(b.targets).toContain('rate');
    // New identities appear.
    expect(b.targets).toContain('vector');
    expect(b.targets).toContain('annotation');
    // Identities disappear.
    expect(b.targets).not.toContain('offset');
    expect(b.targets).not.toContain('readout');

    // Scene structure.
    expect(new Set(a.structure.nodeKinds)).toEqual(new Set(['Rect']));
    expect(b.structure.nodeKinds).toEqual(['Circle', 'Rect', 'Line', 'Rect']);
    expect(b.structure.nodeKinds).not.toEqual(a.structure.nodeKinds);

    // And they do not draw the same pixels.
    expect(typeof a.hash).toBe('number');
    expect(typeof b.hash).toBe('number');
    expect(b.hash).not.toBe(a.hash);
  });

  // --- PROOF 4. READY ---

  test('readiness is a rendered frame, not a finished constructor', async () => {
    const state = await snapshot();
    // The candidate declared readiness only after one real frame was drawn
    // offstage; the owner refuses to activate anything that has not.
    expect(state.candidateReady).toBe(true);
    expect(state.candidate.renderCount).toBeGreaterThanOrEqual(1);
    expect(state.phase).toBe('ready');
  });

  // --- PROOF 5. ACTIVATION AT THE EXISTING BOUNDARY ---

  test('the runtime-constructed candidate activates through the authority', async () => {
    const before = await snapshot();
    const candidateGeneration = before.candidateGeneration;
    const previousGeneration = before.activeGeneration;

    const result = await activate();
    expect(result.ok).toBe(true);
    expect(result.activated).toBe(candidateGeneration);
    expect(result.retired).toBe(previousGeneration);
    expect(result.presentationError).toBeNull();

    const after = await snapshot();
    // Accepted runtime state did not move because presentation changed.
    expect(after.revision).toBe(before.revision);
    expect(after.phase).toBe('overlapping');
    expect(after.current.kind).toBe('runtime');
    expect(after.current.provenance.fromCompiledProject).toBe(false);
    expect(after.outgoing.kind).toBe('compiled');

    // Exactly one presentation holds write authority, and it is the new one.
    expect(after.current.writable).toBe(true);
    expect(after.outgoing.writable).toBe(false);
    expect(after.canvasesInSlot).toBe(2);
  });

  // --- PROOF 6. SEMANTIC CONTINUITY ACROSS DIFFERENT CONTENT ---

  test('one semantic identity continues onto a different node', async () => {
    const incoming = await nodeIdentity('current', 'rate');
    const outgoing = await nodeIdentity('outgoing', 'rate');
    expect(incoming).not.toBeNull();
    expect(outgoing).not.toBeNull();
    // Same id, different object: continuity is semantic, not structural.
    expect(incoming).not.toBe(outgoing);

    // New identities resolve only in the incoming presentation.
    expect(await nodeIdentity('current', 'vector')).not.toBeNull();
    expect(await nodeIdentity('outgoing', 'vector')).toBeNull();
    // And a dropped identity resolves only in the outgoing one.
    expect(await nodeIdentity('current', 'readout')).toBeNull();
    expect(await nodeIdentity('outgoing', 'readout')).not.toBeNull();
  });

  test('the retiring presentation cannot write while it is still visible', async () => {
    const before = await snapshot();
    expect(await writeFrom('outgoing', 9)).toBe(false);
    const after = await snapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
  });

  // --- PROOF 8. OVERLAP AND RETIREMENT ---

  test('the outgoing presentation overlaps and then retires terminally', async () => {
    const mid = await advanceOverlap(2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const overlapping = await snapshot();
    expect(overlapping.phase).toBe('overlapping');
    expect(overlapping.canvasesInSlot).toBe(2);

    expect(await retireOutgoing()).toBe(true);

    const after = await snapshot();
    expect(after.phase).toBe('active');
    expect(after.outgoing).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    // The runtime-constructed presentation is the surviving one.
    expect(after.current.kind).toBe('runtime');
    expect(after.current.disposeCount).toBe(0);
    expect(after.current.visible).toBe(true);
    // Retiring again is a no-op, not a second disposal.
    expect(await retireOutgoing()).toBe(false);
    // Stale authority is unreachable now.
    expect(await writeFrom('outgoing', 9)).toBeNull();
  });

  // --- PROOF 7. INTERACTION ON RUNTIME-CONSTRUCTED CONTENT ---

  test('a learner interacts with the runtime-constructed presentation', async () => {
    const before = await snapshot();
    expect(before.current.kind).toBe('runtime');

    // A new identity, present only because runtime construction put it there.
    const inspected = await inspect('vector');
    expect(inspected.ok).toBe(true);
    expect(inspected.data.target).toBe('vector');
    expect((await snapshot()).current.hasActiveExploration).toBe(false);

    // A real pointer drag on the continuing identity.
    await dragRate(90);
    await settled(before.current.renderCount);

    const held = await snapshot();
    expect(held.current.hasActiveExploration).toBe(true);
    expect(held.current.displayedRate).toBeGreaterThan(before.acceptedRate);
    expect(held.current.provisionalRate).not.toBeNull();
    // The presentation redrew: runtime-built content is not merely alive.
    expect(held.current.renderCount).toBeGreaterThan(
      before.current.renderCount,
    );
    expect(held.current.hash).not.toBe(before.current.hash);
    // Still provisional.
    expect(held.revision).toBe(before.revision);

    const committed = await commit();
    expect(committed.ok).toBe(true);

    const after = await snapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.acceptedRate).toBeGreaterThan(before.acceptedRate);
    // CAP-05 followed the accepted change.
    expect(after.acceptedToken).not.toBe(before.acceptedToken);
    expect(after.current.provisionalRate).toBeNull();
    expect(after.current.hasActiveExploration).toBe(false);
  });

  // --- PROOF 9. ZERO IDLE ---

  test('the runtime returns to zero idle', async () => {
    expect(await quiesce()).toBe(true);
    const idle = await idleWindow(500);
    expect(idle.raf).toBe(0);
    expect(idle.renders).toBe(0);
  });

  // --- PROOF 10. FAILURE ISOLATION ---

  test('runtime material that is not a presentation cannot damage the current one', async () => {
    const before = await snapshot();

    const staged = await stage('runtime-broken');
    expect(staged.ok).toBe(false);
    expect(staged.reason).toBe('preparation-failed');
    // The failure came from the runtime itself, not from fixture bookkeeping.
    expect(staged.detail).toBe('Invalid scene.');

    const after = await snapshot();
    expect(after.phase).toBe('active');
    expect(after.candidate).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    // Nothing had to be released: construction failed before a presentation
    // object owned a stage, a canvas or anything in the document.
    expect(after.releasedOnFailure).toBe(0);

    // The current presentation is untouched and still authoritative.
    expect(after.current.kind).toBe('runtime');
    expect(after.current.writable).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);

    // And still interactive.
    await dragRate(-40);
    await settled(after.current.renderCount);
    const held = await snapshot();
    expect(held.current.hasActiveExploration).toBe(true);
    expect(await discard()).toMatchObject({ok: true});
    const settledState = await snapshot();
    expect(settledState.current.hasActiveExploration).toBe(false);
    expect(settledState.revision).toBe(before.revision);
    expect(settledState.acceptedRate).toBe(before.acceptedRate);
  });

  // --- FRESHNESS IS STILL THE AUTHORITY'S ---

  test('a runtime-constructed candidate is refused once the learner commits', async () => {
    const before = await snapshot();

    const staged = await stage('runtime');
    expect(staged.ok).toBe(true);
    expect(staged.preparedAtRevision).toBe(before.revision);

    // The learner deliberately accepts a new value, which moves the runtime
    // projection the candidate was prepared against.
    await dragRate(70);
    await settled(before.current.renderCount);
    expect(await commit()).toMatchObject({ok: true});

    const committed = await snapshot();
    expect(committed.revision).toBe(before.revision + 1);

    const refused = await activate();
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(before.revision);
    expect(refused.currentRevision).toBe(committed.revision);

    const after = await snapshot();
    // The refused candidate never became visible and was released.
    expect(after.candidate).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.phase).toBe('active');
    // The learner's committed value was not rolled back.
    expect(after.revision).toBe(committed.revision);
    expect(after.acceptedRate).toBe(committed.acceptedRate);
    expect(after.current.writable).toBe(true);
  });
});
