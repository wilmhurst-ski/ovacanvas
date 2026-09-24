import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import type {SceneDocument} from '../document/model.js';
import {compileLesson, isLessonDocument} from '../lesson/compile.js';
import {compileDocument} from '../node/compile.js';
import {extractEmbeddedDocument, generateBeatSource} from './generate.js';

const EXAMPLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples',
);
const EXAMPLES = fs
  .readdirSync(EXAMPLES_DIR)
  .filter(name => name.endsWith('.ovw.json'))
  .map(name => ({
    name,
    document: JSON.parse(
      fs.readFileSync(path.join(EXAMPLES_DIR, name), 'utf8'),
    ) as SceneDocument,
  }));

const FLOW = EXAMPLES.find(e => e.name === 'flow-diagram.ovw.json')!.document;

describe('generateBeatSource', () => {
  it('generates nothing from a document with errors', () => {
    const result = generateBeatSource({
      version: 1,
      nodes: [{id: 'x', component: 'Nope'}],
      timeline: [],
    });
    expect(result.source).toBe('');
    expect(result.issues[0].code).toBe('unknown_component');
  });

  it('is deterministic', () => {
    expect(generateBeatSource(FLOW).source).toBe(
      generateBeatSource(JSON.parse(JSON.stringify(FLOW))).source,
    );
  });

  it.each(EXAMPLES.map(e => [e.name, e.document] as const))(
    '%s compiles against the real engine',
    (_name, document) => {
      // A lesson - or beats running past one engine beat - compiles part
      // by part; each part is an ordinary beat.
      const documents =
        isLessonDocument(document) || 'beats' in (document as object)
          ? compileLesson(document).parts.map(p => p.document)
          : [document];
      expect(documents.length).toBeGreaterThan(0);
      for (const each of documents) {
        const compiled = compileDocument(each);
        expect(compiled.issues.filter(i => i.severity === 'error')).toEqual([]);
        expect(compiled.ok).toBe(true);
        expect(compiled.code).toContain('exports.default');
        expect(compiled.code).toContain('exports.buildAuditSpec');
      }
    },
  );

  it('registers every node, symmetric touches, and connector attachments', () => {
    const source = generateBeatSource({
      ...FLOW,
      touches: [
        {a: 'heading', b: 'leaf', reason: 'the heading sits on the leaf'},
      ],
    }).source;
    for (const node of FLOW.nodes) {
      expect(source).toContain(`{id: "${node.id}", node: ${node.id},`);
    }
    expect(source).toMatch(
      /id: "heading".*\["leaf", "the heading sits on the leaf"\]/,
    );
    expect(source).toMatch(
      /id: "leaf".*\["heading", "the heading sits on the leaf"\]/,
    );
    expect(source).toMatch(
      /id: "inArrow".*\["sun", "connector inArrow attaches to sun"\].*\["leaf", /,
    );
    expect(source).toMatch(
      /id: "sun".*\["inArrow", "connector inArrow attaches to sun"\]/,
    );
  });

  it('requires only what is visible at frame 0', () => {
    const source = generateBeatSource(
      EXAMPLES.find(e => e.name === 'linear-equation.ovw.json')!.document,
    ).source;
    expect(source).toContain('requiredIds: ["title", "equation"],');
  });

  it('constructs a referenced node before the node that references it', () => {
    const source = generateBeatSource({
      version: 1,
      nodes: [
        {
          id: 'note',
          component: 'AnchoredLabel',
          props: {anchor: {ref: 'eq'}, text: 'below'},
        },
        {id: 'eq', component: 'Latex', props: {tex: 'x'}},
      ],
      timeline: [],
    }).source;
    expect(source.indexOf('eq = new Latex')).toBeLessThan(
      source.indexOf('note = new AnchoredLabel'),
    );
    // ...while draw order still follows the document.
    expect(source).toContain('view.add([note, eq]);');
  });

  it('emits each value form the way the engine expects', () => {
    const source = generateBeatSource({
      version: 1,
      nodes: [
        {
          id: 'box',
          component: 'Rect',
          props: {
            size: {x: 200, y: 100},
            fill: {theme: 'blue'},
            stroke: '#151922',
          },
        },
        {
          id: 'label',
          component: 'AnchoredLabel',
          props: {anchor: {ref: 'box'}, origin: 'Top', text: 'box'},
        },
        {
          id: 'arrow',
          component: 'Line',
          props: {
            points: [[-600, 0], {ref: 'box', side: 'left'}, {ref: 'box'}],
            endArrow: true,
          },
        },
      ],
      timeline: [
        {
          kind: 'all',
          steps: [
            {
              kind: 'tween',
              node: 'box',
              prop: 'fill',
              to: {theme: 'coral'},
              seconds: 0.5,
              easing: 'linear',
            },
            {kind: 'set', node: 'label', prop: 'text', value: 'changed'},
          ],
        },
      ],
    }).source;
    expect(source).toContain('size: [200, 100],');
    expect(source).toContain('fill: theme().blue,');
    expect(source).toContain('origin: Origin.Top,');
    expect(source).toContain('anchor: box,');
    expect(source).toContain(
      'points: [[-600, 0], () => box.left(), () => box.middle()],',
    );
    expect(source).toContain('box.fill(theme().coral, 0.5, linear),');
    expect(source).toContain('(function* () { label.text("changed"); })(),');
    expect(source).toMatch(
      /import \{[^}]*\ball\b[^}]*\blinear\b[^}]*\bOrigin\b[^}]*\} from '@ovacanvas\/core'/,
    );
  });

  it('round-trips an embedded document', () => {
    const source = generateBeatSource(FLOW, {embedDocument: true}).source;
    expect(extractEmbeddedDocument(source)).toEqual(FLOW);
    expect(extractEmbeddedDocument(generateBeatSource(FLOW).source)).toBeNull();
  });

  it('maps a TypeScript backstop failure back to the node that caused it', () => {
    const compiled = compileDocument({
      version: 1,
      nodes: [
        {id: 'title', component: 'Txt', props: {text: 'Map'}},
        {
          id: 'map',
          component: 'GeoMap',
          props: {projection: {kind: 'notAProjection'}},
        },
      ],
      timeline: [],
    });
    expect(compiled.ok).toBe(false);
    const issue = compiled.issues.find(i => i.code === 'typescript');
    expect(issue).toMatchObject({node: 'map', severity: 'error'});
    expect(issue?.message).toContain('notAProjection');
  });

  it('records a source line for every node and step', () => {
    const {source, sourceMap} = generateBeatSource(FLOW);
    const lines = source.split('\n');
    for (const node of FLOW.nodes) {
      expect(lines[sourceMap.nodes[node.id].start - 1]).toContain(
        `${node.id} = new `,
      );
    }
    expect(lines[sourceMap.steps['3'] - 1]).toContain('yield* all(');
    expect(lines[sourceMap.steps['3.steps.1'] - 1]).toContain(
      'leaf.lineWidth(6, 0.6)',
    );
  });
});
