import {describe, expect, it} from 'vitest';
import {equationIntent} from './equationIntent/strategy';
import {fullCodeGen} from './fullCodeGen';
import {
  FALLBACK_STRATEGY,
  INTENT_COMPILER_DOMAINS,
  selectStrategy,
} from './registry';
import {sceneDocument} from './sceneDocument';

describe('selectStrategy', () => {
  it('routes an equation-solving topic to the intent compiler, and says why', () => {
    const selection = selectStrategy('solve 2x + 3 = 7 step by step');
    expect(selection.strategy.id).toBe(equationIntent.id);
    expect(selection.reason).toContain('equation-solving');
    // The reason names the primitive the domain is built on, so a reader can
    // judge the choice rather than take it on faith.
    expect(selection.reason).toContain('Latex.tex()');
  });

  it('falls back to the general path for everything else, and says so plainly', () => {
    for (const topic of [
      'what is a derivative',
      'what causes the seasons',
      'how does a binary search work',
    ]) {
      const selection = selectStrategy(topic);
      expect(selection.strategy.id, topic).toBe(FALLBACK_STRATEGY.id);
      expect(selection.reason).toContain('no intent-compiler domain fits');
    }
  });
});

describe('the domain registry', () => {
  it('requires every registered domain to name the primitive it is built on', () => {
    // This is the selection rule made enforceable: a domain that cannot name
    // a correct-by-construction primitive is a domain whose template would
    // have to solve a layout problem, which is the case that loses to full
    // code-generation.
    for (const domain of INTENT_COMPILER_DOMAINS) {
      expect(domain.primitive.length, domain.id).toBeGreaterThan(20);
      expect(domain.id).toMatch(/^[a-z][a-z-]+$/);
    }
  });

  it('does not register the graph domain, which measurement disqualified', () => {
    const ids = INTENT_COMPILER_DOMAINS.map(domain => domain.id);
    expect(ids).not.toContain('graph');
    expect(ids).not.toContain('graph-diagram');
  });

  it('keeps the general path available as the floor for any topic', () => {
    expect(FALLBACK_STRATEGY.matches('literally anything')).toBe(true);
    expect(FALLBACK_STRATEGY.id).toBe(sceneDocument.id);
  });

  it('lets the general strategy be switched to full code generation', () => {
    expect(
      selectStrategy('what is a derivative', 'full-code-gen').strategy.id,
    ).toBe(fullCodeGen.id);
    // An unknown id falls back to the default rather than failing a request.
    expect(selectStrategy('what is a derivative', 'nope').strategy.id).toBe(
      sceneDocument.id,
    );
    // An intent-compiler domain still wins over any general choice.
    expect(
      selectStrategy('solve 2x + 3 = 7 step by step', 'full-code-gen').strategy
        .id,
    ).toBe('equation-intent');
  });
});
