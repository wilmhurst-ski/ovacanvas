/**
 * The structured intent an equation-solving beat is compiled from.
 *
 * @remarks
 * This is the entire vocabulary the model is allowed. Everything visual -
 * where the title sits, how the equation morphs from one step to the next,
 * where the note goes, how long each step lasts - is decided by the compiler
 * below, not by the model. That is the whole reason this strategy is more
 * reliable than asking for a scene: there is no geometry left for the model to
 * get wrong.
 */
export interface EquationSolveIntent {
  /** A short, plain-words title. Never an equation - see the prompt's rules. */
  readonly title: string;
  /** The original problem, then one real algebraic step at a time. */
  readonly steps: readonly EquationStep[];
}

export interface EquationStep {
  /** LaTeX for this step's full expression, no delimiters, no `\text{}`. */
  readonly tex: string;
  /** Optional short plain-English note naming the operation performed. */
  readonly note?: string;
}

/**
 * One beat is hard-capped at 6 seconds by the engine (`BeatAdapter`'s
 * `MAX_BEAT_SECONDS`, an enforced blocking gate - not prompt guidance), so a
 * single-beat solve has to fit inside it. A derivation that genuinely needs
 * more steps belongs in multiple chained beats, which is a host-level feature
 * this MVP does not wire up yet; refusing here is honest, whereas silently
 * emitting an over-long beat would be rejected downstream with a far less
 * useful message.
 */
export const MAX_STEPS = 5;

export type IntentValidation =
  | {readonly ok: true; readonly intent: EquationSolveIntent}
  | {readonly ok: false; readonly error: string};

/**
 * Structural validation, kept separate from JSON parsing so a malformed reply
 * and a structurally wrong one produce different, actionable messages.
 *
 * @remarks
 * Every message here is written to be fed straight back to the model as retry
 * feedback. "intent is not an object" is useless to a model that emitted
 * prose; "steps[2] is missing a non-empty tex string" tells it exactly which
 * field to fix.
 */
export function validateEquationSolveIntent(value: unknown): IntentValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: 'intent must be a JSON object with "title" and "steps"',
    };
  }
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
    return {ok: false, error: '"title" must be a non-empty string'};
  }
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    return {ok: false, error: '"steps" must be a non-empty array'};
  }
  if (candidate.steps.length > MAX_STEPS) {
    return {
      ok: false,
      error:
        `too many steps (${candidate.steps.length}). One beat is capped at 6 seconds and at most ` +
        `${MAX_STEPS} steps fit inside it - keep only the most essential ones.`,
    };
  }

  const steps: EquationStep[] = [];
  for (const [index, raw] of candidate.steps.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return {
        ok: false,
        error: `steps[${index}] must be an object with a "tex" string`,
      };
    }
    const step = raw as Record<string, unknown>;
    if (typeof step.tex !== 'string' || !step.tex.trim()) {
      return {
        ok: false,
        error: `steps[${index}].tex must be a non-empty LaTeX string`,
      };
    }
    if (
      step.note !== undefined &&
      (typeof step.note !== 'string' || !step.note.trim())
    ) {
      return {
        ok: false,
        error: `steps[${index}].note must be a non-empty string when present, or omitted entirely`,
      };
    }
    steps.push({
      tex: step.tex,
      ...(typeof step.note === 'string' ? {note: step.note} : {}),
    });
  }

  return {ok: true, intent: {title: candidate.title, steps}};
}
