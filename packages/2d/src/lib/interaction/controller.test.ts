import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';
import {describe, expect, it, vi} from 'vitest';
import {InteractionController} from './InteractionController';
import {
  InteractionOutcome,
  InteractionPolicy,
  InteractionRefused,
} from './policy';

interface ProbeState {
  amplitude: number;
  offset: number;
  label: string;
}

/** A neutral policy: one inspect-only, one explore-only, one committable. */
const BasePolicy: InteractionPolicy = {
  inspectOnly: {inspect: true},
  explorable: {inspect: true, explore: true},
  committable: {inspect: true, explore: true, commit: true},
};

function harness(policy: InteractionPolicy = BasePolicy) {
  const authority = new RuntimeAuthority<ProbeState>({
    amplitude: 10,
    offset: 4,
    label: 'accepted',
  });
  const generation = authority.prepare();
  generation.markReady();
  expect(authority.activate(generation).ok).toBe(true);

  const presentation = {hold: vi.fn(), release: vi.fn()};
  const described: string[] = [];

  const controller = new InteractionController<ProbeState>({
    capability: generation.capability,
    read: () => authority.read(),
    valueOf: (target, state) =>
      target === 'offset' ? state.offset : state.amplitude,
    apply: (draft, target, value) => {
      if (target === 'offset') draft.offset = value;
      else draft.amplitude = value;
    },
    describe: (target, state) => {
      described.push(target);
      return {target, label: state.label, amplitude: state.amplitude};
    },
    policy,
    presentation,
  });

  // What used to be an option is now an event, so a reader can subscribe
  // after construction and unsubscribe on its own.
  const onProvisionalChange = vi.fn();
  const unsubscribe =
    controller.onProvisionalChanged.subscribe(onProvisionalChange);

  return {
    authority,
    generation,
    controller,
    presentation,
    onProvisionalChange,
    unsubscribe,
    described,
  };
}

/** Narrow a result the test expects to have been accepted. */
function accepted<TValue>(outcome: InteractionOutcome<TValue>): TValue {
  if (!outcome.ok) {
    throw new Error(`expected acceptance, was refused: ${outcome.reason}`);
  }
  return outcome.value;
}

function refusal<TValue>(
  outcome: InteractionOutcome<TValue>,
): InteractionRefused {
  if (outcome.ok) {
    throw new Error('expected a refusal, was accepted');
  }
  return outcome;
}

// --- A. INSPECTION IS READ-ONLY ---

describe('inspection', () => {
  it('returns semantic information without touching authority', () => {
    const {
      controller,
      authority,
      described,
      presentation,
      onProvisionalChange,
    } = harness();
    const before = authority.revision;

    const result = accepted(controller.inspect('inspectOnly'));

    expect(result.target).toBe('inspectOnly');
    expect((result.data as {label: string}).label).toBe('accepted');
    expect(described).toEqual(['inspectOnly']);
    // Nothing was written, nothing was opened, nothing was scheduled.
    expect(authority.revision).toBe(before);
    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.isPresentationHeld).toBe(false);
    expect(presentation.hold).not.toHaveBeenCalled();
    expect(onProvisionalChange).not.toHaveBeenCalled();
  });

  it('hands the describe callback no way to write', () => {
    const {controller} = harness();
    const result = accepted(controller.inspect('explorable'));

    // The inspection payload is plain data: no node, no capability, no draft.
    const data = result.data as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(Object.values(data).some(v => typeof v === 'function')).toBe(false);
  });

  // --- B. DISALLOWED INTERACTION ---

  it('refuses inspection of a target the policy does not name', () => {
    const {controller, authority} = harness();
    const before = authority.revision;

    const denied = refusal(controller.inspect('absent'));

    expect(denied.reason).toBe('unknown-target');
    expect(denied.operation).toBe('inspect');
    expect(authority.revision).toBe(before);
    expect(controller.hasActiveExploration).toBe(false);
  });

  it('refuses exploration of an inspect-only target with no side effects', () => {
    const {controller, authority, presentation, onProvisionalChange} =
      harness();
    const before = authority.revision;

    const denied = refusal(controller.begin('inspectOnly'));

    expect(denied.reason).toBe('not-permitted');
    expect(denied.operation).toBe('begin');
    expect(denied.target).toBe('inspectOnly');
    expect(authority.revision).toBe(before);
    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.isPresentationHeld).toBe(false);
    expect(presentation.hold).not.toHaveBeenCalled();
    expect(onProvisionalChange).not.toHaveBeenCalled();
    expect(controller.valueFor('inspectOnly')).toBe(10);
  });
});

// --- C / D / E. EXPLORE, DISCARD, COMMIT ---

describe('temporary exploration', () => {
  it('shows a held value without advancing the accepted revision', () => {
    const {controller, authority, presentation} = harness();
    const before = authority.revision;

    const opened = accepted(controller.begin('explorable'));
    expect(opened.value).toBe(10);
    controller.update(opened.id, 42);

    expect(controller.valueFor('explorable')).toBe(42);
    expect(controller.provisionalValue('explorable')).toBe(42);
    // Accepted state and revision are untouched while exploring.
    expect(controller.acceptedValue('explorable')).toBe(10);
    expect(authority.read().amplitude).toBe(10);
    expect(authority.revision).toBe(before);
    expect(controller.hasActiveExploration).toBe(true);
    expect(presentation.hold).toHaveBeenCalledTimes(1);
  });

  it('restores the accepted value on discard', () => {
    const {controller, authority, presentation} = harness();
    const opened = accepted(controller.begin('explorable'));
    controller.update(opened.id, 42);

    const discarded = accepted(controller.discard(opened.id));

    expect(discarded.value).toBe(10);
    expect(controller.valueFor('explorable')).toBe(10);
    expect(controller.provisionalValue('explorable')).toBeNull();
    expect(authority.read().amplitude).toBe(10);
    expect(authority.revision).toBe(0);
    expect(controller.hasActiveExploration).toBe(false);
    expect(presentation.release).toHaveBeenCalledTimes(1);
  });

  it('a stale continuation cannot resurrect a discarded value', () => {
    const {controller, authority} = harness();
    const opened = accepted(controller.begin('explorable'));
    controller.update(opened.id, 42);
    controller.discard(opened.id);

    expect(refusal(controller.update(opened.id, 99)).reason).toBe(
      'exploration-already-resolved',
    );
    expect(controller.valueFor('explorable')).toBe(10);
    expect(authority.revision).toBe(0);
  });

  // --- E / F. COMMIT ---

  it('promotes a held value through the authorized mutation path', () => {
    const {controller, authority, generation} = harness();
    const writes: number[] = [];
    const realWrite = generation.capability.write.bind(generation.capability);
    const spy = vi
      .spyOn(generation.capability, 'write')
      .mockImplementation(mutate => {
        writes.push(1);
        return realWrite(mutate);
      });

    const opened = accepted(controller.begin('committable'));
    controller.update(opened.id, 33);
    const committed = accepted(controller.commit(opened.id));

    expect(committed.value).toBe(33);
    expect(committed.revision).toBe(1);
    expect(authority.read().amplitude).toBe(33);
    expect(authority.revision).toBe(1);
    // Exactly one write, and it went through the generation capability.
    expect(writes).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    // The overlay is gone; the accepted value now answers.
    expect(controller.provisionalValue('committable')).toBeNull();
    expect(controller.valueFor('committable')).toBe(33);
    expect(controller.hasActiveExploration).toBe(false);
    spy.mockRestore();
  });

  it('refuses commit when the policy grants exploring but not committing', () => {
    const {controller, authority} = harness();
    const opened = accepted(controller.begin('explorable'));
    controller.update(opened.id, 42);

    const denied = refusal(controller.commit(opened.id));

    expect(denied.reason).toBe('not-permitted');
    expect(authority.revision).toBe(0);
    expect(authority.read().amplitude).toBe(10);
    // The exploration survives a refused commit; it was not silently ended.
    expect(controller.hasActiveExploration).toBe(true);
    expect(controller.valueFor('explorable')).toBe(42);
  });

  // --- G / H. TERMINAL RESOLUTION ---

  it('refuses commit after discard and discard after commit', () => {
    const {controller, authority} = harness();

    const first = accepted(controller.begin('committable'));
    controller.update(first.id, 20);
    controller.discard(first.id);
    expect(refusal(controller.commit(first.id)).reason).toBe(
      'exploration-already-resolved',
    );
    expect(authority.revision).toBe(0);

    const second = accepted(controller.begin('committable'));
    controller.update(second.id, 25);
    controller.commit(second.id);
    expect(refusal(controller.discard(second.id)).reason).toBe(
      'exploration-already-resolved',
    );
    expect(authority.revision).toBe(1);
    expect(authority.read().amplitude).toBe(25);
  });

  it('refuses an exploration identity it never issued', () => {
    const {controller} = harness();
    expect(refusal(controller.update(999, 1)).reason).toBe(
      'unknown-exploration',
    );
    expect(refusal(controller.commit(999)).reason).toBe('unknown-exploration');
    expect(refusal(controller.discard(999)).reason).toBe('unknown-exploration');
  });

  it('holds one exploration at a time', () => {
    const {controller} = harness();
    accepted(controller.begin('committable'));

    const denied = refusal(controller.begin('explorable'));
    expect(denied.reason).toBe('exploration-in-progress');
  });

  it('refuses a value that is not a finite number', () => {
    const {controller} = harness();
    const opened = accepted(controller.begin('explorable'));

    for (const bad of [NaN, Infinity, -Infinity, '3' as any, null as any]) {
      expect(refusal(controller.update(opened.id, bad)).reason).toBe(
        'invalid-value',
      );
    }
    // The held value survived every refusal unchanged.
    expect(controller.valueFor('explorable')).toBe(10);
    expect(controller.hasActiveExploration).toBe(true);
  });
});

// --- I / J. POLICY CHANGE AND REVOCATION ---

describe('policy', () => {
  it('can change while the presentation exists', () => {
    const {controller} = harness();
    expect(refusal(controller.begin('inspectOnly')).reason).toBe(
      'not-permitted',
    );

    controller.setPolicy({
      ...BasePolicy,
      inspectOnly: {inspect: true, explore: true},
    });

    const opened = accepted(controller.begin('inspectOnly'));
    expect(controller.update(opened.id, 7).ok).toBe(true);
    expect(controller.valueFor('inspectOnly')).toBe(7);
  });

  it('revoking mid-exploration drops the held value and blocks continuation', () => {
    const {controller, authority, presentation} = harness();
    const opened = accepted(controller.begin('committable'));
    controller.update(opened.id, 42);
    expect(controller.valueFor('committable')).toBe(42);

    const revoked = controller.setPolicy({
      ...BasePolicy,
      committable: {inspect: true},
    });

    expect(revoked).toBe(true);
    // Resolved at the moment of revocation, not at the next pointer event.
    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.valueFor('committable')).toBe(10);
    expect(presentation.release).toHaveBeenCalledTimes(1);

    // The very first continuation is refused, and nothing is written.
    expect(refusal(controller.update(opened.id, 50)).reason).toBe(
      'policy-revoked',
    );
    expect(refusal(controller.commit(opened.id)).reason).toBe('policy-revoked');
    expect(authority.revision).toBe(0);
    expect(authority.read().amplitude).toBe(10);
  });

  it('removing a target entirely also revokes an open exploration', () => {
    const {controller} = harness();
    const opened = accepted(controller.begin('explorable'));
    controller.update(opened.id, 60);

    expect(controller.setPolicy({})).toBe(true);
    expect(controller.hasActiveExploration).toBe(false);
    expect(refusal(controller.commit(opened.id)).reason).toBe('policy-revoked');
  });
});

// --- K / L / M. LIFECYCLE ---

describe('lifecycle', () => {
  it('resolves an open exploration on reset without committing it', () => {
    const {controller, authority, presentation} = harness();
    const opened = accepted(controller.begin('committable'));
    controller.update(opened.id, 88);

    expect(controller.resolveActive('reset')).toBe(1);

    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.valueFor('committable')).toBe(10);
    expect(authority.revision).toBe(0);
    expect(presentation.release).toHaveBeenCalledTimes(1);
    expect(refusal(controller.commit(opened.id)).reason).toBe(
      'exploration-already-resolved',
    );
  });

  it('a retired generation blocks the first continuation', () => {
    const {controller, authority, generation} = harness();
    const opened = accepted(controller.begin('committable'));
    controller.update(opened.id, 77);

    // Accept a successor: the old generation loses its authority.
    const successor = authority.prepare();
    successor.markReady();
    expect(authority.activate(successor).ok).toBe(true);
    expect(generation.capability.isValid()).toBe(false);

    expect(refusal(controller.update(opened.id, 78)).reason).toBe(
      'generation-retired',
    );
    expect(controller.hasActiveExploration).toBe(false);
    expect(refusal(controller.commit(opened.id)).reason).toBe(
      'generation-retired',
    );
    expect(authority.read().amplitude).toBe(10);

    // A new exploration under the retired generation cannot even open.
    expect(refusal(controller.begin('committable')).reason).toBe(
      'generation-retired',
    );
  });

  it('disposal discards an exploration rather than committing it', () => {
    const {controller, authority, presentation} = harness();
    const opened = accepted(controller.begin('committable'));
    controller.update(opened.id, 99);

    controller.dispose();

    expect(authority.revision).toBe(0);
    expect(authority.read().amplitude).toBe(10);
    expect(controller.isDisposed).toBe(true);
    expect(controller.hasActiveExploration).toBe(false);
    expect(presentation.release).toHaveBeenCalledTimes(1);

    expect(refusal(controller.commit(opened.id)).reason).toBe(
      'controller-disposed',
    );
    expect(refusal(controller.begin('committable')).reason).toBe(
      'controller-disposed',
    );
    expect(refusal(controller.inspect('inspectOnly')).reason).toBe(
      'controller-disposed',
    );

    // Idempotent.
    controller.dispose();
    expect(presentation.release).toHaveBeenCalledTimes(1);
  });

  it('holds and releases the presentation exactly once per exploration', () => {
    const {controller, presentation} = harness();

    const first = accepted(controller.begin('committable'));
    expect(presentation.hold).toHaveBeenCalledTimes(1);
    expect(controller.isPresentationHeld).toBe(true);
    controller.commit(first.id);
    expect(presentation.release).toHaveBeenCalledTimes(1);
    expect(controller.isPresentationHeld).toBe(false);

    const second = accepted(controller.begin('explorable'));
    expect(presentation.hold).toHaveBeenCalledTimes(2);
    controller.discard(second.id);
    expect(presentation.release).toHaveBeenCalledTimes(2);
  });

  it('is the quiescence seam a transition owner will ask', () => {
    const {controller} = harness();
    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.resolveActive('reset')).toBe(0);

    controller.begin('committable');
    expect(controller.hasActiveExploration).toBe(true);
    expect(controller.activeExploration()?.target).toBe('committable');

    expect(controller.resolveActive('reset')).toBe(1);
    expect(controller.hasActiveExploration).toBe(false);
    expect(controller.activeExploration()).toBeNull();
  });
});

// --- P. ZERO SCHEDULING ---

describe('scheduling', () => {
  it('schedules nothing of its own', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const raf = vi.fn();
    const previous = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = raf;

    try {
      const {controller} = harness();
      controller.inspect('inspectOnly');
      const opened = accepted(controller.begin('committable'));
      controller.update(opened.id, 5);
      controller.commit(opened.id);
      controller.setPolicy(BasePolicy);
      controller.dispose();

      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      interval.mockRestore();
      (globalThis as any).requestAnimationFrame = previous;
    }
  });
});
