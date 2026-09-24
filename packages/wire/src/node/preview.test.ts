import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {afterAll, describe, expect, it} from 'vitest';
import type {SceneDocument} from '../document/model.js';
import {texWidthEm, textBox} from '../kits/fields.js';
import {PreviewRenderer} from './preview.js';

/**
 * The real closed loop: documents rendered in headless Chromium through the
 * host's own gate. Slow (it starts Vite and a browser), so it can be skipped
 * with OVC_SKIP_BROWSER=1 on a machine without Playwright's Chromium.
 */
const SKIP = process.env.OVC_SKIP_BROWSER === '1';
const EXAMPLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples',
);
function load(name: string): SceneDocument {
  return JSON.parse(
    fs.readFileSync(path.join(EXAMPLES_DIR, name), 'utf8'),
  ) as SceneDocument;
}

describe.skipIf(SKIP)('PreviewRenderer (real browser)', () => {
  const renderer = new PreviewRenderer();
  afterAll(() => renderer.close());

  it('stages the examples through the full host gate', async () => {
    for (const name of [
      'linear-equation.ovw.json',
      'flow-diagram.ovw.json',
      'geometry-proof.ovw.json',
      'water-cycle.ovw.json',
      'tangent-slope.ovw.json',
      'projectile.ovw.json',
      'west-africa-trade.ovw.json',
      'globe-routes.ovw.json',
      'gradient-descent-3d.ovw.json',
      'saddle-orbit-3d.ovw.json',
      'energy-icons.ovw.json',
      'web-request.ovw.json',
      'parallel-circuit.ovw.json',
    ]) {
      const outcome = await renderer.render(load(name), {frames: [0, 1]});
      expect(outcome.stage, name).toBeUndefined();
      expect(outcome.ok, name).toBe(true);
      expect(outcome.frames).toHaveLength(2);
      expect(
        Buffer.from(outcome.frames[0].png, 'base64').subarray(1, 4).toString(),
      ).toBe('PNG');
      // Every plain node is measured (kit documents also report their expanded parts).
      const layoutIds = Object.keys(outcome.layout ?? {});
      for (const node of load(name).nodes) {
        if (!('kit' in node)) expect(layoutIds).toContain(node.id);
      }
    }
  }, 240000);

  it('measures text and maths exactly as the engine draws them', async () => {
    // wire places labels by these measurements; the audit judges the boxes
    // the engine draws. They must agree, on any machine (the engine now
    // draws text in its own embedded font, not whatever is installed).
    const texts: [string, number, number][] = [
      ['Browser', 28, 500],
      ['Requests are encrypted on the way', 32, 450],
      ['How a web request travels', 60, 700],
      ['αβγ Δx', 30, 600],
    ];
    const texs: [string, number][] = [
      ['x^2 + y^2 = r^2', 40],
      [String.raw`\frac{a+b}{2} \ge \sqrt{ab}`, 36],
    ];
    const outcome = await renderer.render(
      {
        version: 1,
        nodes: [
          ...texts.map(([text, fontSize, fontWeight], i) => ({
            id: `t${i}`,
            component: 'Txt',
            props: {text, fontSize, fontWeight, position: [0, -400 + i * 120]},
          })),
          ...texs.map(([tex, fontSize], i) => ({
            id: `l${i}`,
            component: 'Latex',
            props: {tex, fontSize, position: [0, 200 + i * 140]},
          })),
        ],
        timeline: [],
      },
      {frames: [0]},
    );
    texts.forEach(([text, size, weight], i) => {
      const box = outcome.layout![`t${i}`].box;
      const expected = textBox(text, size, weight);
      expect(Math.abs(box[2] - expected.width), text).toBeLessThan(3);
      expect(Math.abs(box[3] - expected.height), text).toBeLessThan(3);
    });
    texs.forEach(([tex, size], i) => {
      const box = outcome.layout![`l${i}`].box;
      expect(Math.abs(box[2] - texWidthEm(tex) * size), tex).toBeLessThan(6);
    });
  }, 120000);

  it('audits the choreography examples frame by frame', async () => {
    for (const name of [
      'pythagoras-rearrange.ovw.json',
      'riemann-sum.ovw.json',
      'am-gm-flow.ovw.json',
    ]) {
      const outcome = await renderer.renderLesson(load(name), {
        frames: [0, 0.3, 0.6, 1],
      });
      expect(outcome.detail, name).toBeUndefined();
      expect(outcome.ok, name).toBe(true);
      for (const boundary of outcome.continuity.filter(c => !c.sceneChange)) {
        expect(boundary.difference, name).toBeLessThan(1.5);
      }
    }
  }, 300000);

  it('audits every part of a lesson and plays it straight through', async () => {
    const lesson = JSON.parse(
      fs.readFileSync(
        path.join(EXAMPLES_DIR, 'west-africa-lesson.ovw.json'),
        'utf8',
      ),
    );
    const outcome = await renderer.renderLesson(lesson);
    expect(outcome.detail).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(outcome.durationSeconds).toBeGreaterThan(6);
    expect(outcome.parts.length).toBeGreaterThanOrEqual(3);
    // Within a scene, the next part starts on the frame the last one ended on.
    for (const boundary of outcome.continuity.filter(c => !c.sceneChange)) {
      expect(boundary.difference).toBeLessThan(1.5);
    }
    const playback = await renderer.playLesson(lesson);
    expect(playback.reason).toBeUndefined();
    expect(playback.finished).toBe(true);
    expect(playback.played.map(p => p.index)).toEqual(
      outcome.parts.map((_, i) => i),
    );
  }, 240000);

  it('reports where the host had to move overlapping nodes', async () => {
    const outcome = await renderer.render({
      version: 1,
      nodes: [
        {
          id: 'left',
          component: 'Rect',
          props: {size: [400, 300], fill: {theme: 'blue'}, position: [-100, 0]},
        },
        {
          id: 'right',
          component: 'Rect',
          props: {size: [400, 300], fill: {theme: 'coral'}, position: [100, 0]},
        },
      ],
      timeline: [{kind: 'wait', seconds: 1}],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.adjustments?.map(a => a.node).sort()).toEqual([
      'left',
      'right',
    ]);
    const left = outcome.adjustments!.find(a => a.node === 'left')!;
    expect(left.to[0]).toBeLessThan(-100);
  }, 240000);

  it('stops before the browser when validation fails', async () => {
    const outcome = await renderer.render({
      version: 1,
      nodes: [{id: 'a', component: 'Txt', props: {text: 'y = 2x'}}],
      timeline: [],
    });
    expect(outcome).toMatchObject({ok: false, stage: 'validate'});
  });
});
