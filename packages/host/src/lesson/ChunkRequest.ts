import type {BeatManifest} from '../presentation/BeatManifest';

/**
 * What `TransitionOwner.stage` is asked to prepare.
 *
 * @remarks
 * Deliberately minimal for this milestone: the beat is already resolved.
 * Sourcing a beat from a server-compiled module, retrying with a repair
 * prompt, and enforcing a staging deadline are later milestones (see the
 * project plan) and would be premature to model here before the staging and
 * readiness-gate mechanics this milestone proves are themselves working.
 */
export interface ChunkRequest {
  readonly beat: BeatManifest;
}
