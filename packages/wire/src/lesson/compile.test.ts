import {describe, expect, it} from 'vitest';
import {timelineDuration} from '../document/analysis.js';
import type {SceneNode} from '../document/model.js';
import {compileLesson} from './compile.js';

const STEPS = {
  id: 'steps',
  kit: 'list',
  items: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'].map(
    text => ({text}),
  ),
};
const HEADING = {id: 'heading', kit: 'title', text: 'Eight steps'};
const REVEAL = STEPS.items.map((_, i) => ({show: `steps.${i}`, hold: 1}));

function node(nodes: readonly SceneNode[], id: string): SceneNode {
  const found = nodes.find(n => n.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe('lessons', () => {
  it('splits a long run of beats into engine beats, each under 6s', () => {
    const lesson = compileLesson({
      version: 1,
      nodes: [HEADING, STEPS],
      beats: REVEAL,
    });
    expect(lesson.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(lesson.ok).toBe(true);
    expect(lesson.durationSeconds).toBeGreaterThan(10);
    expect(lesson.parts.length).toBeGreaterThan(1);
    for (const part of lesson.parts) {
      expect(timelineDuration(part.document.timeline)).toBeLessThanOrEqual(5.8);
      expect(part.source).toContain('makeScene2D');
    }
    // Every beat is played exactly once, in order.
    expect(lesson.parts.flatMap(p => p.beats)).toEqual(REVEAL.map((_, i) => i));
  });

  it('starts each part where the one before it ended', () => {
    const lesson = compileLesson({
      version: 1,
      nodes: [HEADING, STEPS],
      beats: REVEAL,
    });
    const [first, second] = lesson.parts;
    const shownInFirst = first.beats;
    const itemNode = (nodes: readonly SceneNode[], i: number) =>
      nodes.filter(n => n.id.startsWith(`steps_`) && n.component === 'Txt')[i];
    // Items revealed in part 1 start visible in part 2; later ones hidden.
    for (const i of shownInFirst) {
      expect(itemNode(first.document.nodes, i).props?.opacity).toBe(0);
      expect(itemNode(second.document.nodes, i).props?.opacity).toBe(1);
    }
    const later = second.beats[second.beats.length - 1];
    expect(itemNode(second.document.nodes, later).props?.opacity).toBe(0);
  });

  it('changes scene, carrying kept nodes forward in the state they were left in', () => {
    const lesson = compileLesson({
      version: 1,
      title: 'Two scenes',
      scenes: [
        {
          nodes: [
            {id: 'heading', kit: 'title', text: 'A lesson in two scenes'},
            {id: 'map', kit: 'map', focus: 'West Africa', region: 'left'},
          ],
          beats: [{show: 'map.Nigeria', hold: 0.5}],
        },
        {
          keep: ['heading', 'map'],
          nodes: [
            {id: 'why', kit: 'list', region: 'right', items: [{text: 'Coast'}]},
          ],
          beats: [{show: 'why.0'}, {highlight: 'map.Nigeria'}],
        },
      ],
    });
    expect(lesson.issues.filter(i => i.severity === 'error')).toEqual([]);
    const second = lesson.parts[lesson.parts.length - 1];
    expect(second.scene).toBe(1);
    // Nigeria was shown in scene 1, so it is on screen from scene 2's first frame.
    const nigeria = second.document.nodes.find(
      n =>
        JSON.stringify(n.props?.feature ?? '').includes('"Nigeria"') &&
        !n.id.endsWith('Hi'),
    )!;
    expect(nigeria.props?.opacity).toBe(1);
    // And its highlight overlay exists in both scenes, so ids line up.
    const overlay = lesson.parts[0].document.nodes.find(n =>
      n.id.endsWith('Hi'),
    );
    expect(overlay).toBeDefined();
    expect(node(second.document.nodes, overlay!.id).props?.opacity).toBe(0);
    // A node that was not kept is gone.
    expect(second.document.nodes.some(n => n.id.startsWith('why_'))).toBe(true);
  });

  it('locates problems on the scene and beat that caused them', () => {
    const lesson = compileLesson({
      version: 1,
      scenes: [
        {nodes: [STEPS], beats: [{show: 'steps.0'}]},
        {keep: ['stepz'], nodes: [], beats: []},
      ],
    });
    expect(lesson.ok).toBe(false);
    expect(lesson.issues[0].message).toContain('keep "stepz"');
    expect(lesson.issues[0].hint).toContain('"steps"');

    const bad = compileLesson({
      version: 1,
      scenes: [
        {nodes: [STEPS], beats: [{show: 'steps.0'}]},
        {keep: ['steps'], beats: [{show: 'steps.40'}]},
      ],
    });
    expect(bad.issues[0].step).toBe('scenes.1.beats.0');
  });

  it('holds a scene with no beats on screen for a moment', () => {
    const lesson = compileLesson({
      version: 1,
      scenes: [{nodes: [{id: 'heading', kit: 'title', text: 'Hello'}]}],
    });
    expect(lesson.ok).toBe(true);
    expect(lesson.durationSeconds).toBe(2);
  });

  it('applies touches written for the whole lesson in every scene they fit', () => {
    const rect = (id: string, x: number) => ({
      id,
      component: 'Rect',
      props: {size: [200, 120], fill: {theme: 'blue'}, position: [x, 0]},
    });
    const lesson = compileLesson({
      version: 1,
      title: 'Shared touches',
      touches: [{a: 'left', b: 'right', reason: 'they overlap on purpose'}],
      scenes: [
        {nodes: [rect('left', -50), rect('right', 50)], beats: [{hold: 1}]},
        {keep: ['left'], nodes: [rect('other', 400)], beats: [{hold: 1}]},
      ],
    });
    expect(lesson.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(lesson.parts[0].document.touches).toEqual([
      {a: 'left', b: 'right', reason: 'they overlap on purpose'},
    ]);
    // 'right' is not in the second scene, so the touch does not apply there.
    expect(lesson.parts[1].document.touches ?? []).toEqual([]);
    const bad = compileLesson({version: 1, scenes: [], extra: 1});
    expect(bad.issues.some(i => /unknown lesson field/.test(i.message))).toBe(
      true,
    );
  });
});
