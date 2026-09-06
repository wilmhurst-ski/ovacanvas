import {Rect, Video, makeScene2D} from '@ovacanvas/2d';
import {createRef, useScene} from '@ovacanvas/core';
import probeVideo from '../assets/probe.mp4';
import {bindingFor} from '../runtimeStore';

/**
 * Exposes the node-owned media element so ownership can be asserted from the
 * driver. `video()` is protected on purpose; only this fixture reaches it.
 */
class ProbeVideo extends Video {
  public elementForProbe(): HTMLVideoElement {
    return this.video();
  }
}

/**
 * A presentation scene whose geometry is a pure projection of authoritative
 * store state. The scene owns no truth: reset and seek rebuild these nodes,
 * and they rebind to whatever the store currently holds.
 */
export default makeScene2D(function* (view) {
  const binding = bindingFor(useScene());
  const rect = createRef<Rect>();

  // Non-normative failure injection: lets the failed-preparation regression
  // make a replacement generation fail before it ever reports readiness.
  if (binding.failOnPrepare) {
    throw new Error('probe-preparation-failure');
  }

  view.add(
    <Rect
      ref={rect}
      width={() => binding.width()}
      height={() => binding.doubled() / 4}
      fill={'#e13238'}
      radius={8}
      rotation={0}
    />,
  );

  // Rebind semantic ID `S1` to this generation's node.
  binding.boundNode = rect();

  if (binding.withMedia) {
    const media = createRef<ProbeVideo>();
    view.add(
      <ProbeVideo ref={media} src={probeVideo} width={64} height={64} />,
    );
    // Rebind semantic ID `S2` to this generation's media node.
    binding.boundVideo = media();
  }

  // Enough runway to exercise presentation, seeking and export sampling.
  // The rotation tween is deliberately *not* bound to the store: it makes
  // successive frames genuinely different, so a deterministic export cannot
  // be satisfied by emitting the same image three times.
  yield* rect().rotation(45, 2);
});
