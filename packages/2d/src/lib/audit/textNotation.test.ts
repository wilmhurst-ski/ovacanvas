import {describe, expect, it} from 'vitest';
import {StubAuditNode} from './testing/StubAuditNode';
import {collectPlainTextMathNotation} from './textNotation';

describe('collectPlainTextMathNotation', () => {
  it('flags the exact real mistake: an equation-bearing heading authored as plain text', () => {
    const heading = new StubAuditNode('heading', {
      width: 400,
      height: 40,
      text: "Gabriel's Horn: y = 1/x rotated around the x-axis, 1 <= x <= 4",
    });
    const root = new StubAuditNode('root', {children: [heading]});

    const findings = collectPlainTextMathNotation(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('plain-text-math-notation');
    expect(findings[0].severity).toBe('blocking');
    expect(findings[0].entities).toEqual(['heading']);
  });

  it('flags raw un-rendered LaTeX command syntax', () => {
    const label = new StubAuditNode('label', {
      width: 100,
      height: 20,
      text: '\\frac{1}{2}',
    });
    const root = new StubAuditNode('root', {children: [label]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(1);
  });

  it('flags caret-exponent notation', () => {
    const label = new StubAuditNode('label', {
      width: 100,
      height: 20,
      text: 'x^2 grows fast',
    });
    const root = new StubAuditNode('root', {children: [label]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(1);
  });

  it('flags a short algebraic equation', () => {
    const label = new StubAuditNode('label', {
      width: 100,
      height: 20,
      text: 'y = 1/x',
    });
    const root = new StubAuditNode('root', {children: [label]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(1);
  });

  it('does not flag ordinary prose', () => {
    const title = new StubAuditNode('title', {
      width: 400,
      height: 40,
      text: "Gabriel's Horn",
    });
    const caption = new StubAuditNode('caption', {
      width: 400,
      height: 20,
      text: 'A surface of revolution with finite volume but infinite area.',
    });
    const root = new StubAuditNode('root', {children: [title, caption]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(0);
  });

  it('does not flag a node with no text() at all (e.g. a Latex node, or a shape)', () => {
    const shape = new StubAuditNode('shape', {width: 100, height: 100});
    const root = new StubAuditNode('root', {children: [shape]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(0);
  });

  it('does not flag invisible text', () => {
    const hidden = new StubAuditNode('hidden', {
      width: 100,
      height: 20,
      text: 'y = 1/x',
      opacity: 0,
    });
    const root = new StubAuditNode('root', {children: [hidden]});
    expect(collectPlainTextMathNotation(root)).toHaveLength(0);
  });

  it('catches an offender even when nested several levels deep', () => {
    const deep = new StubAuditNode('deep', {
      width: 50,
      height: 20,
      text: 'x^2 + 1',
    });
    const wrapper = new StubAuditNode('wrapper', {children: [deep]});
    const root = new StubAuditNode('root', {children: [wrapper]});
    const findings = collectPlainTextMathNotation(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].entities).toEqual(['deep']);
  });
});
