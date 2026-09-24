import {
  compileLesson,
  coreComponentReference,
  documentReference,
  extractEmbeddedDocument,
  formatIssues,
  generateBeatSource,
  hasErrors,
  isLessonDocument,
  kitReference,
  validateDocument,
} from '@ovacanvas/wire';
import type {
  AuthoringStrategy,
  StrategyContext,
  StrategyInterpretation,
} from './types';

/**
 * A worked example, kept small: one idea, main content visible at frame 0,
 * a secondary label faded in, and a glyph morph.
 */
export const EXAMPLE_DOCUMENT = {
  version: 1,
  title: 'Solving 2x + 3 = 11',
  nodes: [
    {
      id: 'title',
      component: 'Txt',
      role: 'title',
      props: {text: 'Solve for x', position: [0, -380]},
    },
    {
      id: 'equation',
      component: 'Latex',
      props: {tex: '2x + 3 = 11', fontSize: 72, position: [0, -40]},
    },
    {
      id: 'note',
      component: 'AnchoredLabel',
      props: {
        anchor: {ref: 'equation'},
        origin: 'Bottom',
        distance: 110,
        text: 'subtract 3 from both sides',
        fontSize: 30,
        fill: {theme: 'secondaryInk'},
        opacity: 0,
      },
    },
  ],
  timeline: [
    {kind: 'wait', seconds: 0.6},
    {kind: 'tween', node: 'note', prop: 'opacity', to: 1, seconds: 0.3},
    {kind: 'tween', node: 'equation', prop: 'tex', to: '2x = 8', seconds: 1},
    {kind: 'set', node: 'note', prop: 'text', value: 'divide both sides by 2'},
    {kind: 'wait', seconds: 0.5},
    {kind: 'tween', node: 'equation', prop: 'tex', to: 'x = 4', seconds: 1},
    {kind: 'wait', seconds: 0.6},
  ],
};

/**
 * A worked kit example: a figure, a derivation beside it, and beats that
 * reveal the steps while highlighting the triangle they use.
 */
export const KIT_EXAMPLE = {
  version: 1,
  title: 'Pythagorean theorem',
  nodes: [
    {
      id: 'heading',
      component: 'Txt',
      role: 'heading',
      props: {text: 'The Pythagorean theorem', position: [0, -430]},
    },
    {
      id: 'fig',
      kit: 'geometry.figure',
      region: 'left',
      points: {A: [0, 3], B: [4, 3], C: [0, 0]},
      segments: 'AB BC CA',
      rightAngles: ['BAC'],
      labels: {A: 'A'},
    },
    {
      id: 'proof',
      kit: 'derivation',
      region: 'right',
      steps: [
        {tex: 'a^2 + b^2 = c^2'},
        {tex: '3^2 + 4^2 = 25', why: '\text{legs } 3 \text{ and } 4'},
        {tex: 'c = 5'},
      ],
    },
  ],
  beats: [
    {hold: 0.5},
    {highlight: 'fig.ABC', show: 'proof.1'},
    {show: 'proof.2', hold: 1},
  ],
};

/** With kits, plain components are the exception: list only the common few. */
const KIT_MODE_COMPONENTS = ['Txt', 'Latex', 'Rect', 'Circle', 'Line'];

export function buildSceneDocumentPrompt(
  context: StrategyContext,
  withKits = true,
): string {
  const previous = context.existingSource
    ? extractEmbeddedDocument(context.existingSource)
    : null;
  return `${
    withKits
      ? 'You design an animated explanation for a learner, as a JSON document: one scene, or a lesson of scenes when the idea needs longer than one beat.'
      : 'You design one animated explanation beat for a learner, as a JSON scene document.'
  }

${documentReference()}
${
  withKits
    ? `${kitReference()}
${coreComponentReference(undefined, KIT_MODE_COMPONENTS)}`
    : coreComponentReference()
}

## Example${withKits ? 's' : ''}
${JSON.stringify(EXAMPLE_DOCUMENT)}${
    withKits
      ? `
${JSON.stringify(KIT_EXAMPLE)}`
      : ''
  }
${
  previous
    ? `
## The beat currently on screen
The learner is asking a follow-up about this beat. Keep what still applies and change what the question needs:
${JSON.stringify(previous)}
`
    : ''
}
## Output
Reply with only the JSON document - no prose, no code, no markdown fence.`;
}

/** The first complete JSON object in a reply, tolerating fences and chatter. */
export function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * The model writes a scene document; `@ovacanvas/wire` validates it against
 * the introspected catalogue and generates the beat module deterministically.
 *
 * @remarks
 * This is the general path's replacement for full code generation. It keeps
 * full code-gen's generality - any topic, any catalogue component - but the
 * model never writes code, registration, `mayTouch` maps, constructor calls or
 * variable-held coordinates, which is where the recorded failures were. What
 * the model can still get wrong (an unknown prop, a bad value, a too-long
 * timeline) is caught before compilation with a located message, and that
 * message is what the retry loop feeds back.
 */
export const sceneDocument: AuthoringStrategy = {
  id: 'scene-document',
  description:
    'the model writes a JSON scene document; wire validates it and generates the module',

  matches: () => true,

  buildSystemPrompt: context => buildSceneDocumentPrompt(context, true),

  interpret(raw: string): StrategyInterpretation {
    const json = extractJsonObject(raw);
    if (!json) {
      return {
        ok: false,
        error:
          'The reply did not contain a JSON object. Reply with only the scene document.',
      };
    }
    let document: unknown;
    try {
      document = JSON.parse(json);
    } catch (error) {
      return {
        ok: false,
        error: `The scene document is not valid JSON (${error instanceof Error ? error.message : String(error)}). Reply with only the corrected document.`,
      };
    }
    if (isLessonDocument(document)) return interpretLesson(document);
    const issues = validateDocument(document);
    if (hasErrors(issues)) {
      return {
        ok: false,
        error:
          'The scene document has these problems - fix each one at the location given and reply with the whole corrected document:\n' +
          formatIssues(issues.filter(issue => issue.severity === 'error')),
      };
    }
    // More beats than one engine beat holds: play it as a lesson.
    if (compileLesson(document).parts.length > 1) {
      return interpretLesson(document);
    }
    const generated = generateBeatSource(document, {embedDocument: true});
    return {ok: true, extraction: {intent: document, source: generated.source}};
  },
};

/**
 * A lesson: compiled into parts, each an ordinary beat module. The first
 * part carries the whole lesson document, so a follow-up revises the lesson.
 */
function interpretLesson(document: unknown): StrategyInterpretation {
  const lesson = compileLesson(document);
  if (!lesson.ok) {
    return {
      ok: false,
      error:
        'The lesson has these problems - fix each one at the location given and reply with the whole corrected document:\n' +
        formatIssues(lesson.issues.filter(issue => issue.severity === 'error')),
    };
  }
  const parts = lesson.parts.map((part, index) => ({
    id: part.id,
    title: part.title,
    source:
      index === 0
        ? `${part.source}export const ovwDocument = ${JSON.stringify(document)};\n`
        : part.source,
  }));
  return {
    ok: true,
    extraction: {intent: document, source: parts[0].source, parts},
  };
}

/**
 * The same strategy without the kit layer in the prompt: plain components and
 * a raw timeline only. Kept to measure what kits change.
 */
export const sceneDocumentPlain: AuthoringStrategy = {
  ...sceneDocument,
  id: 'scene-document-plain',
  description:
    'scene documents from plain components only (no kits in the prompt)',
  buildSystemPrompt: context => buildSceneDocumentPrompt(context, false),
};
