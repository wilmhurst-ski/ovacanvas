// Point and kit names are written as a model writes them.
/* eslint-disable @typescript-eslint/naming-convention */
import {describe, expect, it} from 'vitest';
import type {SceneDocument, SceneNode} from '../document/model.js';
import {prepareDocument} from './expand.js';
import {placementBox} from './fields.js';

/**
 * Layout failures found by the broad live batch (2026-09-24), each reduced
 * to the smallest document that showed it. Every one passed validation and
 * failed only in the render audit.
 */

function nodesOf(input: unknown): Map<string, SceneNode> {
  const result = prepareDocument(input);
  expect(result.issues.filter(i => i.severity === 'error')).toEqual([]);
  return new Map((result.document as SceneDocument).nodes.map(n => [n.id, n]));
}

function rectOf(node: SceneNode) {
  const [x, y] = node.props!.position as number[];
  const [w, h] = node.props!.size as number[];
  return {x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2};
}

describe('live batch layout fixes', () => {
  it('bends an edge around a box in its way (grid rows)', () => {
    const nodes = nodesOf({
      version: 1,
      nodes: [
        {
          id: 'g',
          kit: 'graph',
          layout: 'grid',
          nodes: [
            {id: 'a', label: 'Germany'},
            {id: 'b', label: 'Austria-Hungary'},
            {id: 'c', label: 'Italy'},
            {id: 'd', label: 'Britain'},
            {id: 'e', label: 'France'},
            {id: 'f', label: 'Russia'},
          ],
          edges: ['a--b', 'a--c', 'b--c', 'd--e', 'd--f', 'e--f'],
        },
      ],
      beats: [{hold: 0.5}],
    });
    const edge = nodes.get('g_e1')!;
    const points = edge.props!.points as number[][];
    // The edge passes the middle box smoothly, never through it.
    const middle = rectOf(nodes.get('g_nb')!);
    for (const [x, y] of points) {
      const inside =
        x > middle.x0 && x < middle.x1 && y > middle.y0 && y < middle.y1;
      expect(inside).toBe(false);
    }
    expect(points.length).toBeGreaterThan(3);
  });

  it('keeps an explicit box inside the safe area', () => {
    const box = placementBox({
      id: 'm',
      kit: 'map',
      box: [-470, 110, 860, 660],
    });
    expect(box.x - box.width / 2).toBeGreaterThanOrEqual(-884);
    expect(box.width).toBeGreaterThan(800);
  });

  it('puts a narrow angle label outside the angle, clear of its arms', () => {
    const nodes = nodesOf({
      version: 1,
      nodes: [
        {
          id: 'fig',
          kit: 'geometry.figure',
          region: 'left',
          points: {
            C: [0, 0],
            T: [0, -3],
            B: [0, 3],
            N: [1.2, -2.75],
            P: [-1.2, 2.75],
          },
          segments: 'NP',
          dashed: 'TB',
          angles: {TCN: '23.5^\\circ'},
          labels: false,
        },
      ],
      beats: [{hold: 0.5}],
    });
    const label = nodes.get('fig_anTCN')!.props!.position as number[];
    const n = nodes.get('fig_ptN')!.props!.position as number[];
    const p = nodes.get('fig_ptP')!.props!.position as number[];
    // Distance from the label to line NP.
    const [dx, dy] = [p[0] - n[0], p[1] - n[1]];
    const distance =
      Math.abs(dy * label[0] - dx * label[1] + p[0] * n[1] - p[1] * n[0]) /
      Math.hypot(dx, dy);
    expect(distance).toBeGreaterThan(30);
  });

  it('keeps an angle label off a side label on a short side', () => {
    // The unit circle at 120 degrees: OA is short and "cos theta" is wide.
    const nodes = nodesOf({
      version: 1,
      nodes: [
        {
          id: 'fig',
          kit: 'geometry.figure',
          region: 'left',
          points: {O: [0, 0], A: [-0.5, 0], P: [-0.5, -0.866]},
          segments: 'OA AP PO',
          rightAngles: ['OAP'],
          angles: {AOP: '\\theta'},
          sideLabels: {OP: '1', AP: '\\sin\\theta', OA: '\\cos\\theta'},
        },
      ],
      beats: [{hold: 0.5}],
    });
    const box = (id: string, width: number) => {
      const [x, y] = nodes.get(id)!.props!.position as number[];
      const size = Number(nodes.get(id)!.props!.fontSize);
      return {x, y, w: width * size, h: size * 1.2};
    };
    const angle = box('fig_anAOP', 0.6);
    const side = box('fig_slOA', 2.4);
    const overlap =
      Math.abs(angle.x - side.x) * 2 < angle.w + side.w &&
      Math.abs(angle.y - side.y) * 2 < angle.h + side.h;
    expect(overlap).toBe(false);
  });

  it('sets a word axis label as text, clear of a curve meeting the axis', () => {
    const nodes = nodesOf({
      version: 1,
      nodes: [
        {
          id: 'market',
          kit: 'plot',
          x: [0, 12],
          y: [0, 16],
          functions: {D: '12 - x'},
          axisLabels: {x: 'Quantity', y: 'Price'},
        },
      ],
      beats: [{hold: 0.5}],
    });
    expect(nodes.get('market_lx')!.props!.tex).toBe('\\text{Quantity}');
    expect(nodes.get('market_ly')!.props!.tex).toBe('\\text{Price}');
  });

  it('fits a labelled tree into a short band without boxes overlapping', () => {
    const nodes = nodesOf({
      version: 1,
      nodes: [
        {
          id: 'dice',
          kit: 'graph',
          layout: 'tree',
          region: 'bottom',
          nodes: {
            r: 'Two rolls',
            s1: '6',
            n1: 'not 6',
            a: '6, 6',
            b: '6, not 6',
            c: 'not 6, 6',
            d: 'not 6, not 6',
          },
          edges: [
            'r->s1: 1/6',
            'r->n1: 5/6',
            's1->a: 1/6',
            's1->b: 5/6',
            'n1->c: 1/6',
            'n1->d: 5/6',
          ],
        },
      ],
      beats: [{hold: 0.5}],
    });
    const boxes = [...nodes.values()]
      .filter(n => /^dice_n/.test(n.id) && n.component === 'Rect')
      .map(rectOf);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap =
          a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap).toBe(false);
      }
    }
    // Readable: the tree is drawn closer rather than shrunk to a third.
    const height = boxes[0].y1 - boxes[0].y0;
    expect(height).toBeGreaterThan(40);
  });
});
