import {validateDocument} from '@ovacanvas/wire';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {authorWithRetry} from '../../authoringPipeline';
import {
  EXAMPLE_DOCUMENT,
  KIT_EXAMPLE,
  buildSceneDocumentPrompt,
  extractJsonObject,
  sceneDocument,
  sceneDocumentPlain,
} from './sceneDocument';

const COMPILE_ROOT = fileURLToPath(
  new URL('../../../../host', import.meta.url),
);
const ENV = {GOOGLE_API_KEY: 'test-key'} as NodeJS.ProcessEnv;

const VALID = {
  version: 1,
  title: 'Area of a square',
  nodes: [
    {
      id: 'title',
      component: 'Txt',
      role: 'title',
      props: {text: 'Area of a square', position: [0, -380]},
    },
    {
      id: 'square',
      component: 'Rect',
      props: {size: 300, fill: {theme: 'blue'}},
    },
    {
      id: 'formula',
      component: 'Latex',
      props: {tex: 'A = s^2', fontSize: 64, position: [0, 300]},
    },
  ],
  timeline: [{kind: 'wait', seconds: 1}],
};

/** The same document with the mistake models make most: an invented prop. */
const HALLUCINATED = {
  ...VALID,
  nodes: VALID.nodes.map(node =>
    node.id === 'square' ? {...node, props: {size: 300, color: 'blue'}} : node,
  ),
};

function geminiText(text: string): Response {
  return new Response(
    JSON.stringify({candidates: [{content: {parts: [{text}]}}]}),
    {status: 200, headers: {'Content-Type': 'application/json'}},
  );
}

describe('the scene-document strategy', () => {
  it('teaches only from examples that are themselves valid', () => {
    expect(validateDocument(EXAMPLE_DOCUMENT)).toEqual([]);
    expect(
      validateDocument(KIT_EXAMPLE).filter(i => i.severity === 'error'),
    ).toEqual([]);
  });

  it('puts kits in the default prompt and leaves them out of the plain one', () => {
    const context = {topic: 'x', apiSection: ''};
    expect(sceneDocument.buildSystemPrompt(context)).toContain('## Kits');
    expect(sceneDocumentPlain.buildSystemPrompt(context)).not.toContain(
      '## Kits',
    );
  });

  it('finds the document in a fenced or chatty reply', () => {
    const json = JSON.stringify(VALID);
    expect(extractJsonObject(json)).toBe(json);
    expect(extractJsonObject('```json\n' + json + '\n```')).toBe(json);
    expect(extractJsonObject(`Here you go: ${json} hope that helps {`)).toBe(
      json,
    );
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('turns a valid document into a complete beat module', () => {
    const result = sceneDocument.interpret(JSON.stringify(VALID), {
      topic: 'squares',
      apiSection: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extraction.source).toContain(
        'export function buildAuditSpec()',
      );
      expect(result.extraction.source).toContain('export const ovwDocument = ');
      expect(result.extraction.intent).toEqual(VALID);
    }
  });

  it('explains a bad document with located issues instead of compiling it', () => {
    const result = sceneDocument.interpret(JSON.stringify(HALLUCINATED), {
      topic: 'squares',
      apiSection: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('node "square", prop "color"');
      expect(result.error).toContain('did you mean "fill"');
    }
  });

  it('puts the on-screen document in a follow-up prompt', () => {
    const first = sceneDocument.interpret(JSON.stringify(VALID), {
      topic: 'squares',
      apiSection: '',
    });
    if (!first.ok) throw new Error('expected a valid document');
    const prompt = buildSceneDocumentPrompt({
      topic: 'why squared?',
      apiSection: '',
      existingSource: first.extraction.source,
    });
    expect(prompt).toContain('The beat currently on screen');
    expect(prompt).toContain('"A = s^2"');
    expect(
      buildSceneDocumentPrompt({topic: 'squares', apiSection: ''}),
    ).not.toContain('currently on screen');
  });

  it('recovers through the real retry loop: the located issue is fed back and fixed', async () => {
    const requests: string[] = [];
    const replies = [JSON.stringify(HALLUCINATED), JSON.stringify(VALID)];
    const outcome = await authorWithRetry({
      topic: 'what is the area of a square',
      strategy: sceneDocument,
      apiSection: '',
      projectRoot: COMPILE_ROOT,
      provider: 'gemini',
      env: ENV,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        requests.push(String(init.body));
        return geminiText(replies[requests.length - 1]);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.strategy).toBe('scene-document');
      expect(outcome.attempts).toBe(2);
      expect(outcome.code).toContain('exports.buildAuditSpec');
    }
    // The second request carried the validator's located fix, not a compiler dump.
    expect(requests[1]).toContain('did you mean');
    expect(requests[1]).toContain('square');
  });

  it('turns a lesson into parts the browser plays straight through', async () => {
    const lesson = {
      version: 1,
      title: 'Where the Nile flows',
      scenes: [
        {
          nodes: [
            {id: 'heading', kit: 'title', text: 'The Nile flows north'},
            {
              id: 'map',
              kit: 'map',
              focus: 'East Africa',
              highlight: ['Egypt', 'Sudan'],
            },
          ],
          beats: [{hold: 0.5}, {highlight: 'map.Sudan', hold: 1}],
        },
        {
          keep: ['heading'],
          nodes: [
            {id: 'why', kit: 'list', items: [{text: 'Downhill to the sea'}]},
          ],
          beats: [{show: 'why.0', hold: 1}],
        },
      ],
    };
    const outcome = await authorWithRetry({
      topic: 'where does the nile flow',
      strategy: sceneDocument,
      apiSection: '',
      projectRoot: COMPILE_ROOT,
      provider: 'gemini',
      env: ENV,
      fetchImpl: (async () =>
        geminiText(JSON.stringify(lesson))) as unknown as typeof fetch,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.parts).toHaveLength(2);
      expect(outcome.parts![0].code).toBe(outcome.code);
      for (const part of outcome.parts!) {
        expect(part.code).toContain('exports.buildAuditSpec');
      }
      // A follow-up revises the whole lesson, not just its first part.
      expect(outcome.source).toContain('"scenes"');
    }
  }, 120000);
});
