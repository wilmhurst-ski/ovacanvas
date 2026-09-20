/**
 * Frame sampling for the temporal half of a readiness gate.
 *
 * @remarks
 * This module previously also carried a second, older audit path
 * (`assertMotionFrame` and friends) that required a caller to declare
 * per-frame authorized crossings. It was fully orphaned - no caller anywhere
 * outside its own test - and its per-frame authorization model was
 * superseded by the whole-beat `mayTouch` authorizations the live
 * `auditStaticChecksAcrossFrames` path already honours. Keeping both left an
 * ambiguous "which of these is the real API" trap, so the dead half is gone;
 * `transitionSampleFrames` below is the part the render pipeline actually
 * calls.
 */

export function transitionSampleFrames(
  startFrame: number,
  endFrame: number,
): number[] {
  if (endFrame < startFrame)
    {throw new Error('Transition end frame precedes its start frame');}
  const span = endFrame - startFrame;
  return [
    ...new Set(
      [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(startFrame + span * t)),
    ),
  ];
}
