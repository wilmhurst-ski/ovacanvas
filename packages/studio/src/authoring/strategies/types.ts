/**
 * What an authoring strategy is, and what it is not.
 *
 * @remarks
 * Two strategies for "how does the model specify content" were benchmarked in
 * this project's prior work, and they fail in different places:
 *
 * - **Full code-generation** - the model writes the whole scene module. Fully
 *   general, and the fallback for anything without a better option, but it
 *   asks the model to get geometry, prop names and the audit's authorization
 *   model all right at once.
 * - **Declarative-intent compiler** - the model emits only structured intent
 *   (`{title, steps}`), and a deterministic template compiles that into a
 *   complete, always-correct scene with **zero model involvement in
 *   geometry**. Dramatically more reliable, but only in a domain where the
 *   engine already has a correct-by-construction primitive matching that
 *   domain's real shape.
 *
 * The strategy interface below is what lets both live behind one retry loop,
 * one provider abstraction and one measurement harness. A strategy's whole
 * job is: say which topics it is for, say what the model should be asked, and
 * turn the model's reply into beat module source or explain why it cannot.
 * Everything else - attempt budgets, timeouts, error classification, feeding
 * real compiler diagnostics back - is shared, because none of it is
 * strategy-specific.
 */

export interface StrategyContext {
  readonly topic: string;
  /** The currently-shown beat's source, when this is a follow-up about it. */
  readonly existingSource?: string;
  /**
   * The engine's real exports, derived from its compiled declarations. Only
   * a strategy that asks the model for code needs this; an intent compiler
   * ignores it, which is exactly why it is handed over rather than embedded.
   */
  readonly apiSection: string;
}

export interface StrategyExtraction {
  /** The strategy-specific structured intent, kept for measurement and logs. */
  readonly intent?: unknown;
  /** A complete beat module source, ready for the compiler. */
  readonly source: string;
}

export type StrategyInterpretation =
  | {readonly ok: true; readonly extraction: StrategyExtraction}
  | {readonly ok: false; readonly error: string};

export interface AuthoringStrategy {
  /** Stable id, used in logs and measurement output. */
  readonly id: string;
  /** One line for logs and for the selection explanation. */
  readonly description: string;

  /**
   * Whether this strategy is a candidate for this topic.
   *
   * @remarks
   * Deliberately conservative. A false positive here is worse than a false
   * negative: routing a topic to an intent compiler that does not fit its
   * shape produces confidently wrong content, whereas falling through to
   * full code-generation produces something the audit can still judge.
   */
  matches(topic: string): boolean;

  /** The system prompt this strategy wants the model to answer. */
  buildSystemPrompt(context: StrategyContext): string;

  /** Turn the model's raw reply into beat module source, or explain why not. */
  interpret(raw: string, context: StrategyContext): StrategyInterpretation;
}
