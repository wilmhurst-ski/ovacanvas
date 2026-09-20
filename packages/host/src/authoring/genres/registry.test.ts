import {describe, expect, it} from 'vitest';
import {GenreRegistry} from './registry';
import type {IntentValidationResult, PresentationGenre} from './types';

interface FakeStepIntent {
  steps: string[];
}

interface FakeTimelineIntent {
  events: {at: number; label: string}[];
}

class FakeStepGenre implements PresentationGenre<FakeStepIntent> {
  public readonly id = 'step-by-step';
  public matchesStructure(intent: unknown): boolean {
    return (
      typeof intent === 'object' &&
      intent !== null &&
      Array.isArray((intent as any).steps)
    );
  }
  public validateIntent(
    value: unknown,
  ): IntentValidationResult<FakeStepIntent> {
    if (this.matchesStructure(value)) {
      return {valid: true, intent: value as FakeStepIntent};
    }
    return {valid: false, errors: ['Expected steps array']};
  }
  public compileIntentToSource(intent: FakeStepIntent): string {
    return `// ${intent.title}\nexport default function*() {};`;
  }
}

class FakeTimelineGenre implements PresentationGenre<FakeTimelineIntent> {
  public readonly id = 'timeline';
  public matchesStructure(intent: unknown): boolean {
    return (
      typeof intent === 'object' &&
      intent !== null &&
      Array.isArray((intent as any).events)
    );
  }
  public validateIntent(
    value: unknown,
  ): IntentValidationResult<FakeTimelineIntent> {
    if (this.matchesStructure(value)) {
      return {valid: true, intent: value as FakeTimelineIntent};
    }
    return {valid: false, errors: ['Expected events array']};
  }
  public compileIntentToSource(intent: FakeTimelineIntent): string {
    return `// ${intent.title}\nexport default function*() {};`;
  }
}

describe('GenreRegistry', () => {
  it('registers genres and prevents duplicate ids', () => {
    const registry = new GenreRegistry();
    const stepGenre = new FakeStepGenre();
    registry.register(stepGenre);

    expect(registry.get('step-by-step')).toBe(stepGenre);
    expect(registry.all()).toHaveLength(1);

    expect(() => registry.register(new FakeStepGenre())).toThrow(
      /already registered/,
    );
  });

  it('selects genre purely based on structural fit with no subject logic', () => {
    const registry = new GenreRegistry();
    registry.register(new FakeStepGenre());
    registry.register(new FakeTimelineGenre());

    const stepInput = {steps: ['Step 1', 'Step 2']};
    const timelineInput = {events: [{at: 1066, label: 'Battle of Hastings'}]};
    const unknownInput = {
      matrix: [
        [1, 0],
        [0, 1],
      ],
    };

    expect(registry.selectGenre(stepInput)?.id).toBe('step-by-step');
    expect(registry.selectGenre(timelineInput)?.id).toBe('timeline');
    expect(registry.selectGenre(unknownInput)).toBeNull();
    expect(registry.selectGenre(null)).toBeNull();
  });
});
