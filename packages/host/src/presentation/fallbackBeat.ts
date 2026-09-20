import {Txt, makeScene2D, type AuditItem} from '@ovacanvas/2d';
import {BBox, waitFor} from '@ovacanvas/core';
import type {BeatAuditSpec, BeatManifest} from './BeatManifest';

const INK = '#151922';
const MUTED = '#6b6f7a';
const SAFE_AREA = new BBox(60, 60, 1800, 960);
const HOLD_SECONDS = 1.4;

/**
 * The beat shown when authoring has genuinely run out of road.
 *
 * @remarks
 * Host-authored and zero-LLM, like {@link createOpenerBeat} - and gated by the
 * same `evaluateVisualAudit` call every other beat goes through, so it is not
 * a trusted bypass. What it is, is *certain*: it is written here, it always
 * compiles, and it always passes, which is exactly what is needed at the one
 * moment in the pipeline where nothing else can be relied on.
 *
 * It exists because "the previous beat is still on screen" is not an answer to
 * a learner who just asked a question and got no response to it. `TransitionOwner`
 * reports `attempts-exhausted` as a distinct outcome precisely so a caller can
 * respond to it; this is what a caller should put up. Saying so plainly is
 * better than leaving someone to wonder whether the app is broken.
 *
 * Deliberately says nothing about *why* the beat could not be built. A learner
 * cannot act on "the compile failed after three attempts", and a message that
 * tried to explain would be a worse experience than one that simply owns the
 * failure.
 */
export function createFallbackBeat(question: string): BeatManifest {
  let heading: Txt;
  let restated: Txt;

  const runner = makeScene2D(function* (view) {
    heading = new Txt({
      text: "I couldn't build a visual for this one",
      fontSize: 46,
      fontWeight: 700,
      fill: INK,
      textAlign: 'center',
      textWrap: true,
      width: view.size().width * 0.7,
      position: [0, -60],
    });
    restated = new Txt({
      text: question,
      fontSize: 30,
      fill: MUTED,
      textAlign: 'center',
      textWrap: true,
      width: view.size().width * 0.6,
      position: [0, 70],
    });
    view.add([heading, restated]);

    yield* waitFor(HOLD_SECONDS);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => {
    const items: AuditItem[] = [
      {id: 'heading', node: heading as never, halo: 12},
      {id: 'restated', node: restated as never, halo: 10},
    ];
    return {
      items,
      requiredIds: ['heading', 'restated'],
      safeArea: SAFE_AREA,
      // `restated` is the learner's own words, so the same exemption the
      // opener takes applies: a question containing "x^2" must not be able to
      // refuse the beat that exists to answer it.
      allowPlainTextMath: true,
    };
  };

  return {id: 'fallback', title: 'Fallback', runner, buildAuditSpec};
}
