import {MAX_STEPS, type EquationSolveIntent} from './intent';

/**
 * Compile a validated intent into a complete, always-correct beat module.
 *
 * @remarks
 * No model is involved in this function, and no geometry is searched for.
 * That is what makes this domain the right first intent-compiler target: there
 * is exactly one equation on screen plus one optional note, so there is no
 * N-body layout problem at all - unlike the graph/molecule domain, where the
 * deterministic layer still has an unsolved hub-topology layout problem and
 * full code-generation currently wins.
 *
 * Three engine guarantees this leans on, all real and all checked against the
 * actual components rather than assumed:
 * - `Latex.tex(next, duration)` is a genuine subexpression-matching glyph
 *   morph, not a crossfade. Terms wrapped in `{{...}}` and repeated in both
 *   steps persist visually instead of being redrawn.
 * - `AnchoredLabel` derives its position permanently from another node, so
 *   "the note sits under the equation" is a declared relationship the engine
 *   maintains, not pixel arithmetic that can drift.
 * - Nothing is faded in from opacity 0. The obvious authoring would be an
 *   entrance animation, and it was written that way first - it rendered a
 *   **blank canvas**. A beat is inert once shown (`BeatPresentation` runs
 *   paused and nothing advances the playhead), so the frame a learner sees is
 *   frame 0, where an opacity-0 entrance has not started. Worse, the gate
 *   could not catch it: every audit check filters through `isItemVisible`, so
 *   a scene whose nodes all draw nothing is checked against nothing and
 *   reports `passed: true`. Content is therefore visible at frame 0 by
 *   construction here, and the gate now also refuses registered-but-invisible
 *   required content (`requireVisibleIds`). No node's position or scale is
 *   ever animated either - that sweeps a real footprint across whatever is
 *   already along the path, which the audit correctly reports as a collision
 *   no mechanical repair can undo.
 *
 * The equation's own position never moves, for the same reason. Step count is
 * capped and pacing is divided out of a fixed time budget rather than fixed
 * per step, so a 2-step and a 5-step solve both land under the 6s cap instead
 * of one feeling rushed and the other being rejected.
 *
 * **There is no exit fade, and that is a requirement rather than an
 * omission.** A beat loops, so the last frame of one cycle is immediately
 * followed by the first frame of the next - an exit fade would blank the board
 * at the end of *every* cycle, a visible flicker once per pass. This template
 * used to fade out, and it only became apparent once beats actually played.
 */

/** The engine's hard cap is 6s; this stays under it with margin. */
const BEAT_BUDGET_SECONDS = 5.4;
const NOTE_FADE_SECONDS = 0.15;
const FINAL_HOLD_SECONDS = 0.4;

interface StepTiming {
  readonly waitBeforeMorph: number;
  readonly morphSeconds: number;
}

/**
 * Divide whatever budget remains after the fixed entrance/exit costs evenly
 * across the step transitions.
 *
 * @remarks
 * Fixed per-step durations cannot work here: five generous steps blow the 6s
 * cap and two would leave the beat feeling stalled. Dividing the real
 * remaining budget means the total is bounded by construction regardless of
 * how many steps the intent carries.
 */
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

export function compileEquationSolveSource(
  intent: EquationSolveIntent,
): string {
  const timings = computeStepTimings(intent.steps.length - 1);
  const [first, ...rest] = intent.steps;

  /**
   * The note is the one node whose visibility genuinely depends on content.
   *
   * @remarks
   * The first step of a derivation usually has no note - there is no operation
   * to describe yet - so the label has no text, and an empty label has an
   * empty bound, which the audit correctly refuses as `empty-bounds`. It must
   * therefore start hidden *and* stay out of `requiredIds` in that case, or
   * the visibility gate refuses it for the opposite reason. Both are correct:
   * a note with nothing to say is not required content, and it becomes
   * required the moment it does have something to say.
   */
  const firstNote = first.note ?? '';
  const noteStartsVisible = Boolean(firstNote);

  const stepLines: string[] = [];
  rest.forEach((step, index) => {
    const timing = timings[index];
    stepLines.push(`  yield* waitFor(${timing.waitBeforeMorph.toFixed(2)});`);
    stepLines.push(
      `  if (note.opacity() > 0) yield* note.opacity(0, ${NOTE_FADE_SECONDS});`,
    );
    stepLines.push(
      `  yield* equation.tex(${JSON.stringify(step.tex)}, ${timing.morphSeconds.toFixed(2)});`,
    );
    if (step.note) {
      stepLines.push(`  note.text(${JSON.stringify(step.note)});`);
      stepLines.push(`  yield* note.opacity(1, ${NOTE_FADE_SECONDS});`);
    }
  });

  return `import {AnchoredLabel, Latex, Txt, makeScene2D, theme} from '@ovacanvas/2d';
import {BBox, Origin, waitFor} from '@ovacanvas/core';

let title: Txt;
let equation: Latex;
let note: AnchoredLabel;

export default makeScene2D(function* (view) {
  title = new Txt({
    text: ${JSON.stringify(intent.title)},
    fontSize: 40,
    fontWeight: 700,
    position: [0, -420],
  });
  equation = new Latex({
    tex: ${JSON.stringify(first.tex)},
    fontSize: 64,
    fill: theme().ink,
    position: [0, -20],
  });
  note = new AnchoredLabel({
    anchor: equation,
    origin: Origin.Bottom,
    distance: 100,
    text: ${JSON.stringify(firstNote)},
    fontSize: 28,
    fill: theme().ink,
    opacity: ${noteStartsVisible ? 1 : 0},
  });
  view.add([equation, note, title]);

${stepLines.join('\n')}
  yield* waitFor(${FINAL_HOLD_SECONDS});
});

export function buildAuditSpec() {
  return {
    items: [
      {id: 'title', node: title, halo: 10},
      {
        id: 'equation',
        node: equation,
        halo: 10,
        mayTouch: new Map([['note', 'the note is anchored directly beneath the equation by design']]),
      },
      {
        id: 'note',
        node: note,
        halo: 6,
        mayTouch: new Map([['equation', 'the note is anchored directly beneath the equation by design']]),
      },
    ],
    requiredIds: ${noteStartsVisible ? "['title', 'equation', 'note']" : "['title', 'equation']"},
    safeArea: new BBox(60, 60, 1800, 960),
  };
}
${
  rest.length > 0
    ? `
export const choreographyPlan = {
  entities: [
    {id: 'title', role: 'context', lineage: 'root', recognizableBy: ['title text']},
    {id: 'equation', role: 'subject', lineage: 'root', recognizableBy: ['LaTeX equation']},
    {id: 'note', role: 'evidence', lineage: 'root', recognizableBy: ['step note']},
  ],
  transitions: [
${rest
  .map(
    (step, idx) => `    {
      id: 'step_${idx + 1}',
      sourceIds: ['equation'],
      targetIds: ['equation'],
      operation: 'deform',
      preserves: ['position'],
      changes: ['terms'],
      purpose: ${JSON.stringify(step.note || `morph equation to step ${idx + 2}`)},
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

export {MAX_STEPS};
