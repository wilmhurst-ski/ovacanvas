import {describe, expect, it} from 'vitest';
import type {Issue} from './issues.js';
import type {SceneDocument, SceneNode, Step} from './model.js';
import {validateDocument} from './prepare.js';

function doc(
  nodes: unknown[],
  timeline: unknown[] = [],
  extra: Record<string, unknown> = {},
): unknown {
  return {version: 1, nodes, timeline, ...extra};
}

const TITLE: SceneNode = {
  id: 'title',
  component: 'Txt',
  role: 'title',
  props: {text: 'Heading', position: [0, -380]},
};

function errors(input: unknown): Issue[] {
  return validateDocument(input).filter(issue => issue.severity === 'error');
}

function codes(input: unknown): string[] {
  return validateDocument(input).map(issue => issue.code);
}

describe('validateDocument', () => {
  it('accepts a well-formed document with no issues', () => {
    const input: SceneDocument = {
      version: 1,
      title: 'ok',
      nodes: [
        TITLE,
        {
          id: 'eq',
          component: 'Latex',
          props: {tex: 'x^2', fontSize: 64, fill: {theme: 'ink'}},
        },
        {
          id: 'note',
          component: 'AnchoredLabel',
          props: {
            anchor: {ref: 'eq'},
            origin: 'Bottom',
            text: 'a square',
            opacity: 0,
          },
        },
      ],
      timeline: [
        {kind: 'wait', seconds: 0.5},
        {
          kind: 'tween',
          node: 'note',
          prop: 'opacity',
          to: 1,
          seconds: 0.4,
          easing: 'easeOutCubic',
        },
      ],
    };
    expect(validateDocument(input)).toEqual([]);
  });

  it('never throws, whatever it is given', () => {
    for (const input of [
      null,
      42,
      'x',
      [],
      {},
      {version: 1},
      {version: 1, nodes: [null, 3], timeline: [null, {kind: 'all'}]},
    ]) {
      expect(() => validateDocument(input)).not.toThrow();
      expect(errors(input).length).toBeGreaterThan(0);
    }
  });

  // --- the failure classes recorded against full code generation ------------

  it('rejects an invented prop, with the real one as the hint', () => {
    const [issue] = errors(
      doc([
        TITLE,
        {
          id: 'tri',
          component: 'Line',
          props: {
            points: [
              [0, 0],
              [1, 1],
            ],
            color: 'red',
          },
        },
      ]),
    );
    expect(issue).toMatchObject({
      code: 'unknown_prop',
      node: 'tri',
      prop: 'color',
    });
    expect(issue.hint).toContain('"fill"');
  });

  it('rejects a CSS keyword the engine cannot parse as a colour ("none")', () => {
    const [issue] = errors(
      doc([{id: 'box', component: 'Rect', props: {size: 100, fill: 'none'}}]),
    );
    expect(issue).toMatchObject({code: 'bad_value', node: 'box', prop: 'fill'});
    expect(issue.hint).toMatch(/omit the prop/);
  });

  it('rejects an unknown component, with the closest real one', () => {
    const [issue] = errors(
      doc([{id: 'box', component: 'Rectangle', props: {}}]),
    );
    expect(issue).toMatchObject({code: 'unknown_component', node: 'box'});
    expect(issue.hint).toContain('"Rect"');
  });

  it('rejects an unknown theme token and an unknown easing, with suggestions', () => {
    const issues = errors(
      doc(
        [
          {
            id: 'box',
            component: 'Rect',
            props: {size: 100, fill: {theme: 'blu'}},
          },
        ],
        [
          {
            kind: 'tween',
            node: 'box',
            prop: 'opacity',
            to: 0.5,
            seconds: 1,
            easing: 'easeInOutCubik',
          },
        ],
      ),
    );
    expect(issues.find(i => i.code === 'bad_value')?.hint).toContain('"blue"');
    expect(issues.find(i => i.code === 'bad_easing')?.hint).toContain(
      '"easeInOutCubic"',
    );
  });

  it('rejects math written as plain text, like the audit does', () => {
    const [issue] = errors(
      doc([{id: 'eq', component: 'Txt', props: {text: 'x^2 + 1'}}]),
    );
    expect(issue).toMatchObject({
      code: 'plain_text_math',
      node: 'eq',
      prop: 'text',
    });
    expect(
      errors(
        doc([
          {
            id: 'words',
            component: 'Txt',
            props: {text: 'The area of a square'},
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('rejects a beat over the 6 second cap and warns past the comfortable length', () => {
    expect(codes(doc([TITLE], [{kind: 'wait', seconds: 6.5}]))).toContain(
      'too_long',
    );
    expect(codes(doc([TITLE], [{kind: 'wait', seconds: 5}]))).toContain('long');
    // sequence timing follows the engine: starts are staggered, so it is not a plain sum
    const staggered: Step = {
      kind: 'sequence',
      delay: 0.5,
      steps: [0, 1, 2].map(() => ({kind: 'wait', seconds: 1}) as Step),
    };
    expect(codes(doc([TITLE], [staggered]))).not.toContain('long');
  });

  it('rejects a blank first frame', () => {
    expect(
      codes(doc([{...TITLE, props: {...TITLE.props, opacity: 0}}])),
    ).toContain('blank_first_frame');
  });

  it('rejects visible text with no content (empty bounds)', () => {
    const [issue] = errors(
      doc([{id: 'note', component: 'Txt', props: {text: ''}}]),
    );
    expect(issue).toMatchObject({code: 'empty_content', node: 'note'});
    expect(
      codes(
        doc([
          TITLE,
          {id: 'note', component: 'Txt', props: {text: '', opacity: 0}},
        ]),
      ),
    ).not.toContain('empty_content');
  });

  it('warns about animating a footprint, and about ending on a blank stage', () => {
    const issues = validateDocument(
      doc(
        [TITLE],
        [
          {
            kind: 'tween',
            node: 'title',
            prop: 'position',
            to: [0, 0],
            seconds: 1,
          },
          {kind: 'tween', node: 'title', prop: 'opacity', to: 0, seconds: 0.5},
        ],
      ),
    );
    expect(issues.find(i => i.code === 'moves_node')).toMatchObject({
      severity: 'warning',
      node: 'title',
      step: '0',
    });
    expect(issues.find(i => i.code === 'ends_blank')?.severity).toBe('warning');
  });

  // --- structure ----------------------------------------------------------

  it('checks ids: format, reserved names and duplicates', () => {
    expect(
      codes(doc([{id: 'Title', component: 'Txt', props: {text: 'a'}}])),
    ).toContain('bad_id');
    expect(
      codes(doc([{id: 'view', component: 'Txt', props: {text: 'a'}}])),
    ).toContain('bad_id');
    expect(codes(doc([TITLE, TITLE]))).toContain('duplicate_id');
  });

  it('points unknown keys at the right field', () => {
    const issues = errors(
      doc([{id: 'a', type: 'Rect', component: 'Rect'}], [], {duration: 3}),
    );
    expect(issues.find(i => i.message.includes('"duration"'))?.code).toBe(
      'bad_document',
    );
    expect(issues.find(i => i.message.includes('"type"'))?.hint).toContain(
      '"component"',
    );
  });

  it('checks required props', () => {
    const [issue] = errors(
      doc([
        TITLE,
        {id: 'note', component: 'AnchoredLabel', props: {text: 'hi'}},
      ]),
    );
    expect(issue).toMatchObject({
      code: 'missing_required',
      node: 'note',
      prop: 'anchor',
    });
  });

  it('checks references: existence, sides, parents and cycles', () => {
    expect(
      errors(
        doc([
          TITLE,
          {
            id: 'note',
            component: 'AnchoredLabel',
            props: {text: 'a', anchor: {ref: 'titel'}},
          },
        ]),
      )[0],
    ).toMatchObject({
      code: 'unknown_ref',
      hint: 'did you mean "title"?',
    });
    // A Node has no layout sides.
    expect(
      codes(
        doc([
          TITLE,
          {id: 'group', component: 'Node'},
          {
            id: 'arrow',
            component: 'Line',
            props: {points: [[0, 0], {ref: 'group', side: 'left'}]},
          },
        ]),
      ),
    ).toContain('bad_ref');
    // Endpoints must share the connector's parent space.
    expect(
      errors(
        doc([
          {id: 'panel', component: 'Rect', props: {size: 400}},
          {id: 'inner', component: 'Rect', parent: 'panel', props: {size: 50}},
          {
            id: 'arrow',
            component: 'Line',
            props: {points: [[-500, 0], {ref: 'inner', side: 'left'}]},
          },
        ]),
      )[0]?.message,
    ).toMatch(/different parents/);
    expect(
      codes(
        doc([
          {
            id: 'a',
            component: 'AnchoredLabel',
            props: {text: 'a', anchor: {ref: 'b'}},
          },
          {
            id: 'b',
            component: 'AnchoredLabel',
            props: {text: 'b', anchor: {ref: 'a'}},
          },
        ]),
      ),
    ).toContain('ref_cycle');
  });

  it('checks parents', () => {
    expect(codes(doc([{...TITLE, parent: 'nope'}]))).toContain(
      'unknown_parent',
    );
    expect(
      codes(
        doc([
          TITLE,
          {id: 'a', component: 'Rect', parent: 'b', props: {size: 10}},
          {id: 'b', component: 'Rect', parent: 'a', props: {size: 10}},
        ]),
      ),
    ).toContain('parent_cycle');
  });

  it('checks timeline steps and locates them by path', () => {
    const issues = errors(
      doc(
        [TITLE],
        [
          {
            kind: 'all',
            steps: [
              {kind: 'tween', node: 'title', prop: 'text', to: 5, seconds: 1},
            ],
          },
          {kind: 'tween', node: 'ghost', prop: 'opacity', to: 1, seconds: 1},
          {kind: 'tween', node: 'title', prop: 'role', to: 1, seconds: 1},
          {kind: 'dance'},
          {kind: 'tween', node: 'title', prop: 'opacity', to: 1, seconds: 0},
        ],
      ),
    );
    expect(issues.find(i => i.code === 'bad_value')?.step).toBe('0.steps.0');
    expect(issues.find(i => i.code === 'unknown_node')?.step).toBe('1');
    expect(issues.find(i => i.code === 'unknown_prop')?.step).toBe('2');
    expect(issues.find(i => i.code === 'bad_step')?.step).toBe('3');
    expect(issues.find(i => i.code === 'bad_duration')?.step).toBe('4');
  });

  it('refuses to tween what cannot interpolate', () => {
    const [issue] = errors(
      doc(
        [
          TITLE,
          {
            id: 'arrow',
            component: 'Line',
            props: {
              points: [
                [0, 0],
                [100, 0],
              ],
            },
          },
        ],
        [
          {
            kind: 'tween',
            node: 'arrow',
            prop: 'endArrow',
            to: true,
            seconds: 1,
          },
        ],
      ),
    );
    expect(issue).toMatchObject({
      code: 'not_tweenable',
      hint: 'use a "set" step to change it instantly',
    });
  });

  it('checks touches', () => {
    const issues = errors(
      doc([TITLE], [], {
        touches: [
          {a: 'title', b: 'ghost', reason: 'x'},
          {a: 'title', b: '*', reason: ''},
        ],
      }),
    );
    expect(issues.filter(i => i.code === 'bad_touch').length).toBe(3);
  });

  it('warns when an explicit position leaves the safe area', () => {
    expect(
      validateDocument(
        doc([{...TITLE, props: {text: 'far', position: [1200, 0]}}]),
      )[0],
    ).toMatchObject({
      code: 'outside_safe_area',
      severity: 'warning',
    });
  });

  it('only allows text roles on text components', () => {
    expect(
      codes(
        doc([
          TITLE,
          {id: 'box', component: 'Rect', role: 'title', props: {size: 10}},
        ]),
      ),
    ).toContain('bad_role');
    expect(codes(doc([{...TITLE, role: 'huge'}]))).toContain('bad_role');
  });
});
