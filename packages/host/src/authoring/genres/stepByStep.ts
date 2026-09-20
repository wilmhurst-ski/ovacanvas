import type {IntentValidationResult, PresentationGenre} from './types';

export interface StepByStepStep {
  /** The step content (LaTeX math/chemistry formula, formatted statement, etc.). */
  readonly content?: string;
  /** Legacy/math alias for content. */
  readonly tex?: string;
  /** Optional explanation note describing the transition or operation. */
  readonly note?: string;
}

export interface StepByStepIntent {
  readonly title: string;
  readonly steps: readonly StepByStepStep[];
}

export const MAX_STEPS = 5;
const BEAT_BUDGET_SECONDS = 5.4;
const NOTE_FADE_SECONDS = 0.15;
const FINAL_HOLD_SECONDS = 0.4;

interface StepTiming {
  readonly waitBeforeMorph: number;
  readonly morphSeconds: number;
}

export function computeStepTimings(transitionCount: number): StepTiming[] {
  if (transitionCount <= 0) return [];
  const fixedOverhead = FINAL_HOLD_SECONDS;
  const available = Math.max(
    transitionCount * 1.0,
    BEAT_BUDGET_SECONDS - fixedOverhead,
  );
  const perTransition = available / transitionCount;
  const noteOverhead = NOTE_FADE_SECONDS * 2;
  const remaining = Math.max(0.5, perTransition - noteOverhead);
  const waitBeforeMorph = Math.max(0.25, Math.min(1.0, remaining * 0.4));
  const morphSeconds = Math.max(0.45, remaining - waitBeforeMorph);
  return Array.from({length: transitionCount}, () => ({
    waitBeforeMorph,
    morphSeconds,
  }));
}

/**
 * The reference implementation of the "step-by-step" presentation genre.
 *
 * @remarks
 * Generalized so it is not subject-specific: the same `{title, steps: [{content, note}]}`
 * shape and `Latex.tex()` subexpression morph mechanism works for chemistry reactions
 * (e.g. `2H_2 + O_2 \to 2H_2O`), multi-step proofs, physics derivations, and algebra.
 */
export class StepByStepGenre implements PresentationGenre<StepByStepIntent> {
  public readonly id = 'step-by-step';

  public matchesStructure(intent: unknown): boolean {
    if (
      typeof intent !== 'object' ||
      intent === null ||
      Array.isArray(intent)
    ) {
      return false;
    }
    const candidate = intent as Record<string, unknown>;
    return Array.isArray(candidate.steps) && candidate.steps.length > 0;
  }

  public validateIntent(
    value: unknown,
  ): IntentValidationResult<StepByStepIntent> {
    if (!this.matchesStructure(value)) {
      return {
        valid: false,
        errors: ['Intent must be an object with a non-empty "steps" array.'],
      };
    }
    const candidate = value as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
      errors.push('"title" must be a non-empty string.');
    }

    const rawSteps = candidate.steps as unknown[];
    if (rawSteps.length > MAX_STEPS) {
      errors.push(
        `Too many steps (${rawSteps.length}). Maximum is ${MAX_STEPS} to stay within the beat duration cap.`,
      );
    }

    const validatedSteps: StepByStepStep[] = [];
    for (const [index, item] of rawSteps.entries()) {
      if (typeof item !== 'object' || item === null) {
        errors.push(`steps[${index}] must be an object.`);
        continue;
      }
      const rawStep = item as Record<string, unknown>;
      const text =
        typeof rawStep.content === 'string' && rawStep.content.trim()
          ? rawStep.content.trim()
          : typeof rawStep.tex === 'string' && rawStep.tex.trim()
            ? rawStep.tex.trim()
            : '';

      if (!text) {
        errors.push(
          `steps[${index}] must have a non-empty "content" or "tex" string.`,
        );
      }

      if (
        rawStep.note !== undefined &&
        (typeof rawStep.note !== 'string' || !rawStep.note.trim())
      ) {
        errors.push(
          `steps[${index}].note must be a non-empty string when provided.`,
        );
      }

      validatedSteps.push({
        content: text,
        tex: text,
        ...(typeof rawStep.note === 'string' && rawStep.note.trim()
          ? {note: rawStep.note.trim()}
          : {}),
      });
    }

    if (errors.length > 0) {
      return {valid: false, errors};
    }

    return {
      valid: true,
      intent: {
        title: (candidate.title as string).trim(),
        steps: validatedSteps,
      },
    };
  }

  public compileIntentToSource(intent: StepByStepIntent): string {
    const timings = computeStepTimings(intent.steps.length - 1);
    const [first, ...rest] = intent.steps;
    const firstExpression = first.content ?? first.tex ?? '';
    const firstNote = first.note ?? '';
    const noteStartsVisible = Boolean(firstNote);

    const stepLines: string[] = [];
    rest.forEach((step, index) => {
      const timing = timings[index];
      const expr = step.content ?? step.tex ?? '';
      stepLines.push(`  yield* waitFor(${timing.waitBeforeMorph.toFixed(2)});`);
      stepLines.push(
        `  if (note.opacity() > 0) yield* note.opacity(0, ${NOTE_FADE_SECONDS});`,
      );
      stepLines.push(
        `  yield* stepDisplay.tex(${JSON.stringify(expr)}, ${timing.morphSeconds.toFixed(2)});`,
      );
      if (step.note) {
        stepLines.push(`  note.text(${JSON.stringify(step.note)});`);
        stepLines.push(`  yield* note.opacity(1, ${NOTE_FADE_SECONDS});`);
      }
    });

    return `import {AnchoredLabel, Latex, Txt, makeScene2D, theme} from '@ovacanvas/2d';
import {BBox, Origin, waitFor} from '@ovacanvas/core';

let title: Txt;
let stepDisplay: Latex;
let note: AnchoredLabel;

export default makeScene2D(function* (view) {
  title = new Txt({
    text: ${JSON.stringify(intent.title)},
    fontSize: 40,
    fontWeight: 700,
    position: [0, -420],
  });
  stepDisplay = new Latex({
    tex: ${JSON.stringify(firstExpression)},
    fontSize: 64,
    fill: theme().ink,
    position: [0, -20],
  });
  note = new AnchoredLabel({
    anchor: stepDisplay,
    origin: Origin.Bottom,
    distance: 100,
    text: ${JSON.stringify(firstNote)},
    fontSize: 28,
    fill: theme().ink,
    opacity: ${noteStartsVisible ? 1 : 0},
  });
  view.add([stepDisplay, note, title]);

${stepLines.join('\n')}
  yield* waitFor(${FINAL_HOLD_SECONDS});
});

export function buildAuditSpec() {
  return {
    items: [
      {id: 'title', node: title, halo: 10},
      {
        id: 'stepDisplay',
        node: stepDisplay,
        halo: 10,
        mayTouch: new Map([['note', 'the note is anchored directly beneath the step display by design']]),
      },
      {
        id: 'note',
        node: note,
        halo: 6,
        mayTouch: new Map([['stepDisplay', 'the note is anchored directly beneath the step display by design']]),
      },
    ],
    requiredIds: ${noteStartsVisible ? "['title', 'stepDisplay', 'note']" : "['title', 'stepDisplay']"},
    safeArea: new BBox(60, 60, 1800, 960),
  };
}
${
  rest.length > 0
    ? `
export const choreographyPlan = {
  entities: [
    {id: 'title', role: 'context', lineage: 'root', recognizableBy: ['title text']},
    {id: 'stepDisplay', role: 'subject', lineage: 'root', recognizableBy: ['step expression']},
    {id: 'note', role: 'evidence', lineage: 'root', recognizableBy: ['step note']},
  ],
  transitions: [
${rest
  .map(
    (step, idx) => `    {
      id: 'step_${idx + 1}',
      sourceIds: ['stepDisplay'],
      targetIds: ['stepDisplay'],
      operation: 'deform',
      preserves: ['position'],
      changes: ['content'],
      purpose: ${JSON.stringify(step.note || `advance expression to step ${idx + 2}`)},
      holdAfter: 'hold_step_${idx + 1}',
    },`,
  )
  .join('\n')}
  ],
};`
    : ''
}
`;
  }
}

export const stepByStepGenre = new StepByStepGenre();
