/**
 * What a policy may grant on one semantic target.
 *
 * @remarks
 * Three permissions, not a mode enum. Earlier research used example words for
 * whole-scene modes; naming them here would freeze a vocabulary that the
 * product has not settled, and a per-target permission set expresses the same
 * distinctions without claiming to be the final shape.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export type InteractionPermission =
  /** Read information about the target without changing anything. */
  | 'inspect'
  /** Hold a temporary value for the target that presentation can show. */
  | 'explore'
  /** Promote a held value into accepted runtime state. */
  | 'commit';

/**
 * What a caller asked to do.
 *
 * @remarks
 * Distinct from {@link InteractionPermission} because the operations are
 * finer than the permissions: `begin` and `update` both need `explore`, and
 * `discard` needs nothing at all - abandoning is always allowed.
 *
 * @internal Not a public API.
 */
export type InteractionOperation =
  | 'inspect'
  | 'begin'
  | 'update'
  | 'commit'
  | 'discard';

/**
 * @internal Not a public API.
 */
export interface TargetPermissions {
  readonly inspect?: boolean;
  readonly explore?: boolean;
  readonly commit?: boolean;
}

/**
 * What the learner may currently do, per semantic target.
 *
 * @remarks
 * A target with no entry is not interactive. Absence is a refusal rather than
 * a default, so a target that was never considered cannot become reachable by
 * omission.
 *
 * @internal Not a public API.
 */
export type InteractionPolicy = Readonly<Record<string, TargetPermissions>>;

/**
 * Why a learner request was refused.
 *
 * @internal Not a public API.
 */
export type InteractionRefusalReason =
  /** No policy entry exists for the target at all. */
  | 'unknown-target'
  /** The policy exists but does not grant what was asked. */
  | 'not-permitted'
  /** Another exploration is already open; V1 holds one at a time. */
  | 'exploration-in-progress'
  /** No exploration with that identity was ever opened here. */
  | 'unknown-exploration'
  /** That exploration already committed, was discarded, or was revoked. */
  | 'exploration-already-resolved'
  /** The policy stopped permitting this while the exploration was open. */
  | 'policy-revoked'
  /** The generation that owns the write path is no longer accepted. */
  | 'generation-retired'
  /** The interaction owner has been terminally disposed. */
  | 'controller-disposed'
  /** The proposed value was not a finite number. */
  | 'invalid-value';

/**
 * @internal Not a public API.
 */
export interface InteractionAccepted<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

/**
 * @internal Not a public API.
 */
export interface InteractionRefused {
  readonly ok: false;
  readonly reason: InteractionRefusalReason;
  /** What was asked for. */
  readonly operation: InteractionOperation;
  /** The target it was asked about, when one was named. */
  readonly target: string | null;
}

/**
 * The result of a learner request.
 *
 * @remarks
 * Refusal is a returned value, not a thrown error and not a quiet no-op. A
 * caller cannot mistake a refusal for a success, and a test can tell the two
 * apart without inspecting side effects.
 *
 * @internal Not a public API.
 */
export type InteractionOutcome<TValue> =
  | InteractionAccepted<TValue>
  | InteractionRefused;

/**
 * @internal Not a public API.
 */
export function permits(
  policy: InteractionPolicy,
  target: string,
  permission: InteractionPermission,
): boolean {
  return policy[target]?.[permission] === true;
}

/**
 * @internal Not a public API.
 */
export function knownTarget(
  policy: InteractionPolicy,
  target: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(policy, target);
}
