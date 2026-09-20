import {afterEach, describe, expect, it} from 'vitest';
import {resetTheme, setTheme} from '../theme/theme';
import {collectColorOveruse, collectThemeConsistency} from './colorDiscipline';
import {StubAuditNode} from './testing/StubAuditNode';

describe('collectColorOveruse', () => {
  afterEach(() => resetTheme());

  it('does not flag text/Latex left at the theme ink color', () => {
    const title = new StubAuditNode('title', {
      text: 'How derivatives work',
      fill: '#151922',
    });
    const eq = new StubAuditNode('eq', {tex: 'f(x)=x^2', fill: '#151922'});
    const root = new StubAuditNode('root', {children: [title, eq]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('does not flag secondary ink either', () => {
    const subtitle = new StubAuditNode('subtitle', {
      text: 'A brief note',
      fill: '#59616D',
    });
    const root = new StubAuditNode('root', {children: [subtitle]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('allows exactly one deliberate accent color across all text/Latex', () => {
    const a = new StubAuditNode('a', {text: 'tracked term', fill: '#F05A3C'});
    const b = new StubAuditNode('b', {tex: 'x', fill: '#F05A3C'});
    const root = new StubAuditNode('root', {children: [a, b]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('allows two accents reused by semantic role, the real Pythagorean-demo case: known legs blue, unknown hypotenuse coral', () => {
    const legA = new StubAuditNode('legA', {tex: 'a = 3', fill: '#2F66D0'});
    const legB = new StubAuditNode('legB', {tex: 'b = 4', fill: '#2F66D0'});
    const hyp = new StubAuditNode('hyp', {tex: 'c = ?', fill: '#F05A3C'});
    const root = new StubAuditNode('root', {children: [legA, legB, hyp]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('flags the exact real failure: every text given its own color instead of black', () => {
    const a = new StubAuditNode('labelA', {text: 'a = 3', fill: '#2F66D0'});
    const b = new StubAuditNode('labelB', {text: 'b = 4', fill: '#F05A3C'});
    const c = new StubAuditNode('labelC', {text: 'c = ?', fill: '#4E9B62'});
    const root = new StubAuditNode('root', {children: [a, b, c]});

    const findings = collectColorOveruse(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('color-discipline');
    expect(findings[0].severity).toBe('blocking');
    expect(findings[0].entities.sort()).toEqual(['labelA', 'labelB', 'labelC']);
  });

  it('a third distinct accent beyond the default budget of two tips it', () => {
    const a = new StubAuditNode('a', {text: 'x', fill: '#F05A3C'});
    const b = new StubAuditNode('b', {text: 'y', fill: '#2F66D0'});
    const c = new StubAuditNode('c', {text: 'z', fill: '#4E9B62'});
    const root = new StubAuditNode('root', {children: [a, b, c]});
    expect(collectColorOveruse(root)).toHaveLength(1);
  });

  it('ignores shapes (nodes with no text/tex) entirely, however many colors they use', () => {
    const shapes = ['#F05A3C', '#2F66D0', '#4E9B62', '#F3C742'].map(
      (fill, index) => new StubAuditNode(`shape${index}`, {fill}),
    );
    const root = new StubAuditNode('root', {children: shapes});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('ignores invisible text', () => {
    const hidden = new StubAuditNode('hidden', {
      text: 'x',
      fill: '#F05A3C',
      opacity: 0,
    });
    const a = new StubAuditNode('a', {text: 'y', fill: '#2F66D0', opacity: 0});
    const root = new StubAuditNode('root', {children: [hidden, a]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('ignores a node with no fill() at all', () => {
    const a = new StubAuditNode('a', {text: 'x'});
    const root = new StubAuditNode('root', {children: [a]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('respects an active theme override, not just the shipped default', () => {
    setTheme({ink: '#000000'});
    const a = new StubAuditNode('a', {text: 'x', fill: '#000000'});
    const root = new StubAuditNode('root', {children: [a]});
    expect(collectColorOveruse(root)).toHaveLength(0);
  });

  it('honors a custom maxAccentColors budget', () => {
    const a = new StubAuditNode('a', {text: 'x', fill: '#F05A3C'});
    const b = new StubAuditNode('b', {text: 'y', fill: '#2F66D0'});
    const root = new StubAuditNode('root', {children: [a, b]});
    expect(collectColorOveruse(root, {maxAccentColors: 2})).toHaveLength(0);
  });

  it('catches an offender even when nested several levels deep', () => {
    const deep = new StubAuditNode('deep', {text: 'x', fill: '#F05A3C'});
    const other = new StubAuditNode('other', {text: 'y', fill: '#2F66D0'});
    const third = new StubAuditNode('third', {text: 'z', fill: '#4E9B62'});
    const wrapper = new StubAuditNode('wrapper', {children: [deep]});
    const root = new StubAuditNode('root', {children: [wrapper, other, third]});
    const findings = collectColorOveruse(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].entities.sort()).toEqual(['deep', 'other', 'third']);
  });
});

describe('collectThemeConsistency', () => {
  afterEach(() => resetTheme());

  it('passes cleanly when nodes use theme tokens and typeScale font sizes', () => {
    const title = new StubAuditNode('title', {
      text: 'Derivatives',
      fill: '#151922', // theme().ink
      fontSize: 60, // typeScale.title
    });
    const sub = new StubAuditNode('sub', {
      text: 'A rate of change',
      fill: '#59616D', // theme().secondaryInk
      fontSize: 32, // typeScale.subtitle
    });
    const formula = new StubAuditNode('formula', {
      tex: "f'(x) = 2x",
      fill: '#2F66D0', // theme().blue
      fontSize: 27, // typeScale.body
    });
    const shape = new StubAuditNode('shape', {
      fill: '#4E9B62', // theme().green
    });
    const root = new StubAuditNode('root', {
      children: [title, sub, formula, shape],
    });

    const findings = collectThemeConsistency(root);
    expect(findings).toHaveLength(0);
  });

  it('flags arbitrary off-palette hex colors with an advisory finding', () => {
    const rogue = new StubAuditNode('rogue', {
      text: 'Special text',
      fill: '#FF0000', // Pure red, not in theme()
      fontSize: 27,
    });
    const root = new StubAuditNode('root', {children: [rogue]});

    const findings = collectThemeConsistency(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('theme-color-consistency');
    expect(findings[0].severity).toBe('advisory');
    expect(findings[0].entities).toEqual(['rogue']);
    expect(findings[0].message).toContain('off-palette color "#ff0000"');
  });

  it('respects active theme overrides set via setTheme()', () => {
    setTheme({blue: '#0055FF'});
    const custom = new StubAuditNode('custom', {
      text: 'Custom blue',
      fill: '#0055FF',
      fontSize: 26,
    });
    const root = new StubAuditNode('root', {children: [custom]});

    expect(collectThemeConsistency(root)).toHaveLength(0);
  });

  it('flags font sizes that do not match any typeScale role', () => {
    const oddText = new StubAuditNode('oddText', {
      text: 'Weird size',
      fill: '#151922',
      fontSize: 47, // Arbitrary size, not 20, 25, 26, 27, 32, 60
    });
    const root = new StubAuditNode('root', {children: [oddText]});

    const findings = collectThemeConsistency(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('theme-typography-scale');
    expect(findings[0].severity).toBe('advisory');
    expect(findings[0].entities).toEqual(['oddText']);
    expect(findings[0].message).toContain('fontSize 47px');
  });

  it('flags both color and typography violations on the same node independently', () => {
    const broken = new StubAuditNode('broken', {
      text: 'Double offender',
      fill: '#991100', // off-palette
      fontSize: 14, // off-scale
    });
    const root = new StubAuditNode('root', {children: [broken]});

    const findings = collectThemeConsistency(root);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.ruleId).sort()).toEqual([
      'theme-color-consistency',
      'theme-typography-scale',
    ]);
    expect(findings.every(f => f.severity === 'advisory')).toBe(true);
  });

  it('ignores invisible nodes', () => {
    const hidden = new StubAuditNode('hidden', {
      text: 'Hidden text',
      fill: '#FF0000',
      fontSize: 13,
      opacity: 0,
    });
    const root = new StubAuditNode('root', {children: [hidden]});

    expect(collectThemeConsistency(root)).toHaveLength(0);
  });
});
