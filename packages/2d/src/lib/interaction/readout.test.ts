import {createComputed, createEffect} from '@ovacanvas/core';
// `RuntimeAuthority` is implementation machinery: the public barrel
// deliberately does not carry it, so it is reached deliberately.
import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';
import {describe, expect, it, vi} from 'vitest';
import {InteractionController} from './InteractionController';
import {InteractionReadout} from './InteractionReadout';
import type {InteractionOutcome, InteractionPolicy} from './policy';

interface ProbeState {
  amplitude: number;
  offset: number;
  label: string;
}

const Policy: InteractionPolicy = {
  amplitude: {inspect: true, explore: true, commit: true},
  offset: {inspect: true, explore: true},
};

function harness() {
  const authority = new RuntimeAuthority<ProbeState>({
    amplitude: 10,
    offset: 4,
    label: 'accepted',
  });
  const generation = authority.prepare();
  generation.markReady();
  expect(authority.activate(generation).ok).toBe(true);

  const controller = new InteractionController<ProbeState>({
    capability: generation.capability,
    read: () => authority.read(),
    valueOf: (target, state) =>
      target === 'offset' ? state.offset : state.amplitude,
    apply: (draft, target, value) => {
      if (target === 'offset') draft.offset = value;
      else draft.amplitude = value;
    },
    policy: Policy,
  });

  const readout = new InteractionReadout<ProbeState>(controller);
  return {authority, generation, controller, readout};
}

function accepted<TValue>(outcome: InteractionOutcome<TValue>): TValue {
  if (!outcome.ok) {
    throw new Error(`expected acceptance, was refused: ${outcome.reason}`);
  }
  return outcome.value;
}

/**
 * The reactive half of the provisional-value seam.
 *
 * @remarks
 * Four product fixtures each grew the same version-counter bridge to get here.
 * These pin the behaviour they were reinventing: a reactive read of what
 * presentation should show, which is provisional while a learner holds
 * something and accepted otherwise, and which holds no authority of its own.
 */
describe('InteractionReadout', () => {
  it('reads the accepted value when nothing is held', () => {
    const {readout} = harness();
    expect(readout.valueFor('amplitude')).toBe(10);
    expect(readout.provisionalValue('amplitude')).toBeNull();
  });

  it('wakes a reactive consumer when an exploration opens and moves', () => {
    const {controller, readout} = harness();
    const seen: number[] = [];
    const dispose = createEffect(() => {
      seen.push(readout.valueFor('amplitude'));
    });

    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 42));

    expect(seen[0]).toBe(10);
    expect(seen.at(-1)).toBe(42);
    expect(readout.provisionalValue('amplitude')).toBe(42);
    dispose();
  });

  it('leaves accepted state untouched while a learner explores', () => {
    const {authority, controller, readout} = harness();
    const revision = authority.revision;

    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 99));

    expect(readout.valueFor('amplitude')).toBe(99);
    // The overlay is a read, not a write.
    expect(authority.revision).toBe(revision);
    expect(authority.read().amplitude).toBe(10);
  });

  it('returns to the accepted value when the exploration is discarded', () => {
    const {authority, controller, readout} = harness();
    const computed = createComputed(() => readout.valueFor('amplitude'));

    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 77));
    expect(computed()).toBe(77);

    accepted(controller.discard(opened.id));
    expect(computed()).toBe(10);
    expect(authority.read().amplitude).toBe(10);
  });

  it('follows the newly accepted value after a commit', () => {
    const {authority, controller, readout} = harness();
    const computed = createComputed(() => readout.valueFor('amplitude'));

    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 55));
    accepted(controller.commit(opened.id));

    expect(authority.read().amplitude).toBe(55);
    expect(readout.provisionalValue('amplitude')).toBeNull();
    // Provisional is gone, and the value it becomes is the accepted one.
    expect(computed()).toBe(55);
  });

  it('returns to accepted when a policy change revokes an exploration', () => {
    const {controller, readout} = harness();
    const computed = createComputed(() => readout.valueFor('offset'));

    const opened = accepted(controller.begin('offset'));
    accepted(controller.update(opened.id, 21));
    expect(computed()).toBe(21);

    expect(controller.setPolicy({offset: {inspect: true}})).toBe(true);
    expect(computed()).toBe(4);
  });

  it('returns to accepted when the generation retires', () => {
    const {authority, generation, controller, readout} = harness();
    const computed = createComputed(() => readout.valueFor('amplitude'));

    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 33));
    expect(computed()).toBe(33);

    // Retiring is not consent: the overlay is dropped, not accepted.
    const next = authority.prepare();
    next.markReady();
    expect(authority.activate(next).ok).toBe(true);
    expect(controller.resolveActive('generation-retired')).toBe(1);

    expect(computed()).toBe(10);
    expect(authority.read().amplitude).toBe(10);
    void generation;
  });

  it('stops tracking once disposed, without lying about the value', () => {
    const {controller, readout} = harness();
    const observer = vi.fn(() => readout.valueFor('amplitude'));
    const dispose = createEffect(observer);
    const before = observer.mock.calls.length;

    readout.dispose();
    const opened = accepted(controller.begin('amplitude'));
    accepted(controller.update(opened.id, 12));

    // No longer reactive...
    expect(observer.mock.calls.length).toBe(before);
    // ...but still truthful when asked.
    expect(readout.valueFor('amplitude')).toBe(12);
    readout.dispose();
    dispose();
  });

  it('releases its subscription so a controller is not retained', () => {
    const {controller, readout} = harness();
    expect(controller.onProvisionalChanged.getSubscriberCount()).toBe(1);
    readout.dispose();
    expect(controller.onProvisionalChanged.getSubscriberCount()).toBe(0);
  });
});
