/* eslint-disable @typescript-eslint/naming-convention -- circuit part names (B1, R1) */
import {createRequire} from 'module';
import {describe, expect, it} from 'vitest';
import {walkSteps} from '../document/analysis.js';
import type {SceneDocument} from '../document/model.js';
import {prepareDocument} from '../kits/expand.js';
import {resolveIcon, suggestIcons} from './library.js';
import {transformPath} from './path.js';
import {SYMBOL_FAMILIES} from './symbols.js';

// The engine's own path parser: whatever wire emits must parse with it.
const parseSvgPath = createRequire(import.meta.url)('parse-svg-path') as (
  d: string,
) => unknown[];

function doc(nodes: unknown[], beats?: unknown[]): unknown {
  return {version: 1, nodes, ...(beats ? {beats} : {timeline: []})};
}
function expanded(input: unknown): SceneDocument {
  const prepared = prepareDocument(input);
  expect(prepared.issues.filter(i => i.severity === 'error')).toEqual([]);
  return prepared.document as SceneDocument;
}
const HEADING = {id: 'heading', kit: 'title', text: 'Icons'};

describe('finding icons by the words people use', () => {
  it('resolves exact names, everyday words, tags and symbol requests', () => {
    const cases: [string, string][] = [
      ['house', 'lucide:house'],
      ['home', 'lucide:house'],
      ['thunder', 'lucide:zap'],
      ['lightning bolt', 'lucide:zap'],
      ['db', 'lucide:database'],
      ['light bulb', 'lucide:lightbulb'],
      ['power plant', 'lucide:factory'],
      ['water drop', 'lucide:droplet'],
      ['resistor', 'electrical:resistor'],
      ['battery', 'lucide:battery'],
      ['battery symbol', 'electrical:battery'],
      ['electrical:battery', 'electrical:battery'],
      ['and gate', 'logic:and'],
      ['transistor', 'electrical:npn-transistor'],
    ];
    for (const [name, id] of cases) {
      expect(resolveIcon(name)?.id, name).toBe(id);
    }
    expect(resolveIcon('battery', {preferSymbols: true})?.id).toBe(
      'electrical:battery',
    );
  });

  it('suggests real names when nothing matches', () => {
    expect(resolveIcon('xylophone-zz')).toBeNull();
    expect(suggestIcons('databse')).toContain('database');
  });
});

describe('icon paths the engine can draw', () => {
  it('writes every icon and symbol in explicit commands the engine parses', () => {
    const data = createRequire(import.meta.url)(
      '../../data/icons-lucide.json',
    ) as {icons: Record<string, {d: string}>};
    const paths = [
      ...Object.values(data.icons).map(i => i.d),
      ...Object.values(SYMBOL_FAMILIES).flatMap(t =>
        Object.values(t).flatMap(s => [s.stroke, s.fill ?? ''].filter(Boolean)),
      ),
    ];
    for (const d of paths) {
      for (const scale of [0.37, 1.9, 3]) {
        const out = transformPath(d, scale, 10, -5);
        // Only absolute, explicit commands: nothing relative, no smooth curves.
        expect(out).not.toMatch(/[mlhvcsqtaSTHV]/);
        expect(() => parseSvgPath(out)).not.toThrow();
      }
    }
  });

  it('scales an arc exactly as wide as its span so it still draws', () => {
    // A half circle of radius 16 across 32 units: at an awkward scale the
    // rounded end points land a hair wider than the diameter.
    const out = transformPath('M-15 0A16 16 0 1 0 17 0', 1.3717);
    const [, rx] = out.match(/A([\d.]+)/)!;
    expect(Number(rx) * 2).toBeGreaterThanOrEqual(32 * 1.3717 - 0.01);
  });
});

describe('the icon kits', () => {
  it('draws one icon, traceable, with a label', () => {
    const document = expanded(
      doc(
        [HEADING, {id: 'bolt', kit: 'icon', name: 'thunder', label: 'Power'}],
        [{trace: 'bolt.icon'}],
      ),
    );
    const stroke = document.nodes.find(n => n.id === 'boltIcon')!;
    expect(stroke.component).toBe('Path');
    expect(stroke.props!.end).toBe(0);
    expect(document.nodes.find(n => n.id === 'boltBg')?.component).toBe(
      'Circle',
    );
    expect(document.nodes.find(n => n.id === 'boltLabel')?.props?.text).toBe(
      'Power',
    );
  });

  it('lays out a flow of icons with arrows between them', () => {
    const document = expanded(
      doc([
        HEADING,
        {
          id: 'chain',
          kit: 'icons',
          layout: 'flow',
          items: [
            {icon: 'sun', label: 'Sun'},
            {icon: 'leaf', label: 'Plant'},
            {icon: 'rabbit', label: 'Rabbit'},
          ],
        },
      ]),
    );
    const arrows = document.nodes.filter(n => n.id.startsWith('chainArrow'));
    expect(arrows).toHaveLength(2);
    expect(arrows[0].props!.endArrow).toBe(true);
  });

  it('puts icons into graph nodes and list points', () => {
    const document = expanded(
      doc([
        HEADING,
        {
          id: 'g',
          kit: 'graph',
          region: 'top',
          nodes: {
            a: {label: 'Web', icon: 'globe'},
            b: {label: 'Data', icon: 'db'},
          },
          edges: ['a->b'],
        },
        {
          id: 'l',
          kit: 'list',
          region: 'bottom',
          items: [{text: 'Secure', icon: 'lock'}, 'Plain'],
        },
      ]),
    );
    const glyphs = document.nodes.filter(
      n => n.component === 'Path' && n.id.includes('Glyph'),
    );
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0].parent).toBeDefined();
    expect(document.nodes.find(n => n.id === 'l_m0Icon')?.component).toBe(
      'Path',
    );
    expect(document.nodes.find(n => n.id === 'l_m1')?.component).toBe('Circle');
  });

  it('names an unknown icon with suggestions', () => {
    const issues = prepareDocument(
      doc([HEADING, {id: 'x', kit: 'icon', name: 'databse'}]),
    ).issues.filter(i => i.severity === 'error');
    expect(issues[0].message).toContain('no icon for "databse"');
    expect(issues[0].hint).toContain('database');
  });
});

describe('the circuit kit', () => {
  const PARTS = {
    B1: 'battery: 9 V',
    S1: 'closed-switch',
    R1: 'resistor: 100 Ω',
    L1: 'lamp',
    L2: 'lamp',
  };

  it('draws a series-parallel circuit and runs current through it', () => {
    const document = expanded(
      doc(
        [
          HEADING,
          {
            id: 'c',
            kit: 'circuit',
            parts: PARTS,
            circuit: 'B1 - S1 - R1 - (L1 | L2)',
          },
        ],
        [{play: 'c'}],
      ),
    );
    const flows = new Set<string>();
    const glows = new Set<string>();
    walkSteps(document.timeline, step => {
      if (step.kind !== 'tween') return;
      if (step.prop === 'lineDashOffset') flows.add(step.node);
      if (step.prop === 'opacity' && step.node.endsWith('Glow')) {
        glows.add(step.node);
      }
    });
    expect(flows.size).toBeGreaterThan(4);
    expect([...glows].sort()).toEqual(['c_L1Glow', 'c_L2Glow']);
    // Junction dots where the parallel branches split and join.
    expect(
      document.nodes.filter(n => /^c_j\d/.test(n.id)).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('stops the current at an open switch - in its branch, or everywhere', () => {
    const branch = expanded(
      doc(
        [
          HEADING,
          {
            id: 'c',
            kit: 'circuit',
            parts: {...PARTS, S2: 'switch'},
            circuit: 'B1 - S1 - R1 - (L1 | S2 - L2)',
          },
        ],
        [{play: 'c'}],
      ),
    );
    const glowing = branch.nodes
      .filter(n => n.id.endsWith('Glow'))
      .map(n => n.id);
    expect(glowing).toEqual(['c_L1Glow']);

    const broken = expanded(
      doc(
        [
          HEADING,
          {
            id: 'c',
            kit: 'circuit',
            parts: {B1: 'battery', S1: 'switch', L1: 'lamp'},
          },
        ],
        [{play: 'c'}],
      ),
    );
    expect(broken.nodes.some(n => n.id.endsWith('Glow'))).toBe(false);
    expect(broken.nodes.some(n => /^c_f\d/.test(n.id))).toBe(false);
  });

  it('explains bad circuits and unknown parts', () => {
    const issues = prepareDocument(
      doc([
        HEADING,
        {
          id: 'c',
          kit: 'circuit',
          parts: {B1: 'battery', R1: 'wizard', L1: 'lamp'},
          circuit: 'B1 - (R1 | L1',
        },
      ]),
    ).issues.filter(i => i.severity === 'error');
    const messages = issues.map(i => i.message).join(' | ');
    expect(messages).toContain('"wizard" is not a two-terminal circuit symbol');
    expect(messages).toContain('"(" is not closed');
  });
});
