import {Txt, makeScene2D, type AuditItem} from '@ovacanvas/2d';
import {theme} from '@ovacanvas/2d/lib/theme/theme';
import {BBox, waitFor} from '@ovacanvas/core';
import type {BeatAuditSpec, BeatManifest} from './BeatManifest';

const SAFE_AREA = new BBox(60, 60, 1800, 960);
const OPENER_HOLD_SECONDS = 1.2;

/**
 * A host-authored, zero-LLM first beat: the lesson's own question restated,
 * nothing else.
 *
 * @remarks
 * This is the latency fix from the speed pass: the LLM's actual first beat
 * becomes beat 2 and cooks in the background during this beat's hold time,
 * so the learner sees something immediately instead of a blank stage while
 * real content is generated, typechecked, rendered and audited. It is a
 * real beat, gated by the same `evaluateVisualAudit` call every other beat
 * goes through - not a trusted bypass - but content this simple always
 * passes and finishes well under a second.
 *
 * No full-bleed background node: `derivatives.tsx` establishes the
 * convention of leaving the canvas background to the `Stage`/container
 * rather than an in-scene rect, precisely because a full-bleed rect always
 * violates a content-only safe area by design.
 *
 * `ref` props are only wired up by the JSX factory real `.tsx` scenes go
 * through; this file is plain TS, so the constructed node is captured
 * directly instead (the same convention skill-authored, non-JSX scenes use).
 */
export function createOpenerBeat(question: string): BeatManifest {
  let questionNode: Txt;

  const runner = makeScene2D(function* (view) {
    const currentTheme = theme();
    const size = view.size();
    questionNode = new Txt({
      text: question,
      fontSize: 56,
      fontWeight: 600,
      fill: currentTheme.ink,
      textAlign: 'center',
      textWrap: true,
      width: size.width * 0.7,
      position: [0, 0],
    });
    view.add(questionNode);

    yield* waitFor(OPENER_HOLD_SECONDS);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => {
    const items: AuditItem[] = [
      {id: 'question', node: questionNode as never, halo: 12},
    ];
    return {
      items,
      requiredIds: ['question'],
      safeArea: SAFE_AREA,
      // The text is the learner's, not ours. Without this, a learner who types
      // "solve x^2 - 5x + 6 = 0" - the way most people write it - has their own
      // question used to refuse the beat that shows it back to them, and gets
      // an error instead of an explanation.
      allowPlainTextMath: true,
    };
  };

  return {id: 'opener', title: 'Opener', runner, buildAuditSpec};
}
