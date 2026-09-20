/**
 * Presentation-genre contracts and intent types.
 *
 * @remarks
 * Decoupled from subject domains per Mandate 1 (§1.1): genres model pure
 * presentation structures (e.g. step-by-step sequential transitions, linear
 * timelines, comparative tables) rather than subjects (math, history, chemistry).
 *
 * A genre must never branch on, inspect, or reference subject domains.
 */

export interface IntentValidationSuccess<TIntent> {
  readonly valid: true;
  readonly intent: TIntent;
}

export interface IntentValidationFailure {
  readonly valid: false;
  readonly errors: readonly string[];
}

export type IntentValidationResult<TIntent> =
  | IntentValidationSuccess<TIntent>
  | IntentValidationFailure;

/**
 * A presentation genre template: turns structured intent matching its shape
 * into a compiled beat module with zero model involvement in layout or geometry.
 */
export interface PresentationGenre<TIntent = unknown> {
  /** Stable identifier for the genre (e.g. 'step-by-step', 'timeline'). */
  readonly id: string;

  /**
   * Pure structural-fit predicate.
   *
   * @remarks
   * Checks whether the intent shape matches this genre's expected structure
   * (e.g. has an ordered list of steps, has positions along an axis), with
   * ZERO reference to subject matter.
   */
  matchesStructure(intent: unknown): boolean;

  /** Validates that intent properties conform to genre requirements. */
  validateIntent(value: unknown): IntentValidationResult<TIntent>;

  /** Compiles validated intent to Motion Canvas beat module source code. */
  compileIntentToSource(intent: TIntent): string;
}
