import {describe, expect, it} from 'vitest';
import {applyEdit} from './edit.js';
import {emptyDocument, type SceneDocument} from './model.js';

const BASE: SceneDocument = {
  version: 1,
  nodes: [
    {
      id: 'title',
      component: 'Txt',
      props: {text: 'Heading', position: [0, -380]},
    },
    {id: 'box', component: 'Rect', props: {size: 200, fill: {theme: 'blue'}}},
    {
      id: 'label',
      component: 'AnchoredLabel',
      props: {anchor: {ref: 'box'}, text: 'box', opacity: 0},
    },
  ],
  timeline: [
    {kind: 'tween', node: 'label', prop: 'opacity', to: 1, seconds: 0.5},
  ],
  touches: [{a: 'label', b: 'box', reason: 'the label names the box'}],
};

describe('applyEdit', () => {
  it('applies a valid edit', () => {
    const result = applyEdit(BASE, {
      op: 'update_node',
      id: 'box',
      props: {radius: 12},
    });
    expect(result.ok).toBe(true);
    expect(result.document.nodes[1].props?.radius).toBe(12);
  });

  it('refuses an edit that introduces an error, leaving the document unchanged', () => {
    const result = applyEdit(BASE, {
      op: 'update_node',
      id: 'box',
      props: {colour: 'red'},
    });
    expect(result.ok).toBe(false);
    expect(result.document).toBe(BASE);
    expect(result.introduced[0]).toMatchObject({
      code: 'unknown_prop',
      node: 'box',
      prop: 'colour',
    });
    expect(result.introduced[0].hint).toContain('"fill"');
  });

  it('does not hold pre-existing errors against an unrelated edit', () => {
    const broken: SceneDocument = {
      ...BASE,
      nodes: [
        ...BASE.nodes,
        {id: 'bad', component: 'Rect', props: {fill: 'none'}},
      ],
    };
    expect(
      applyEdit(broken, {op: 'set_title', title: 'Still editable'}).ok,
    ).toBe(true);
  });

  it('allows a blank first frame while a scene is being built', () => {
    const result = applyEdit(emptyDocument(), {
      op: 'add_node',
      node: {
        id: 'later',
        component: 'Txt',
        props: {text: 'appears later', opacity: 0},
      },
    });
    expect(result.ok).toBe(true);
  });

  it('reports structural problems with the op itself', () => {
    expect(applyEdit(BASE, {op: 'remove_node', id: 'ghost'}).error).toMatch(
      /no node/,
    );
    expect(
      applyEdit(BASE, {op: 'add_node', node: {id: 'box', component: 'Rect'}})
        .error,
    ).toMatch(/already exists/);
    expect(applyEdit(BASE, {op: 'remove_step', index: 9}).error).toMatch(
      /no top-level step/,
    );
  });

  it('refuses to remove a node something still references', () => {
    const result = applyEdit(BASE, {op: 'remove_node', id: 'box'});
    expect(result.ok).toBe(false);
    expect(
      result.introduced.some(
        i => i.code === 'unknown_ref' && i.node === 'label',
      ),
    ).toBe(true);
  });

  it('removes a node together with its own steps and touches', () => {
    const result = applyEdit(BASE, {op: 'remove_node', id: 'label'});
    expect(result.ok).toBe(true);
    expect(result.document.timeline).toEqual([]);
    expect(result.document.touches).toEqual([]);
  });

  it('renames a node everywhere it is referenced', () => {
    const result = applyEdit(BASE, {
      op: 'rename_node',
      id: 'box',
      to: 'square',
    });
    expect(result.ok).toBe(true);
    const label = result.document.nodes.find(n => n.id === 'label')!;
    expect(label.props?.anchor).toEqual({ref: 'square'});
    expect(result.document.touches?.[0]).toMatchObject({b: 'square'});
  });

  it('adds and replaces steps, refusing ones that break the timeline', () => {
    expect(
      applyEdit(BASE, {
        op: 'add_step',
        step: {kind: 'wait', seconds: 0.5},
        index: 0,
      }).document.timeline[0],
    ).toEqual({
      kind: 'wait',
      seconds: 0.5,
    });
    const tooLong = applyEdit(BASE, {
      op: 'add_step',
      step: {kind: 'wait', seconds: 9},
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.introduced[0].code).toBe('too_long');
  });
});
