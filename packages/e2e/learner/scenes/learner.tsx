import {Rect, makeScene2D} from '@ovacanvas/2d';
import {createRef, useScene, waitFor} from '@ovacanvas/core';
import {bindingFor} from '../runtimeState';

/**
 * A neutral learner-interaction fixture.
 *
 * @remarks
 * Four shapes: a bar whose width is a derived trajectory sample, two handles
 * bound to scalars the policy treats differently, and one target the policy
 * only ever lets a learner read. Nothing depicts anything.
 *
 * The scene reads what the interaction layer says to display, which is the
 * held value while a learner explores and the accepted one otherwise. It
 * still owns no truth and can write nothing.
 */
export default makeScene2D(function* (view) {
  const binding = bindingFor(useScene());

  const bar = createRef<Rect>();
  const rateHandle = createRef<Rect>();
  const offsetHandle = createRef<Rect>();
  const readout = createRef<Rect>();
  const drift = createRef<Rect>();

  view.add(
    <>
      {/* The visible derived response: width follows the CAP-05 sample. */}
      <Rect
        ref={bar}
        x={0}
        y={-90}
        width={() => 40 + binding.displaySample() * 300}
        height={40}
        fill={'#3d7ab8'}
        radius={6}
      />
      {/* Position follows whatever value presentation should show. */}
      <Rect
        ref={rateHandle}
        x={() => (binding.displayRate() - 1.5) * 100}
        y={40}
        width={60}
        height={60}
        fill={'#d0d4dc'}
        radius={10}
      />
      <Rect
        ref={offsetHandle}
        x={() => binding.displayOffset() * 100}
        y={140}
        width={50}
        height={50}
        fill={'#9b59b6'}
        radius={8}
      />
      <Rect
        ref={readout}
        x={-140}
        y={-160}
        width={60}
        height={40}
        fill={'#2f6f4f'}
        radius={4}
      />
      {/* Not registered, and animated, so a running presentation is visible. */}
      <Rect
        ref={drift}
        x={150}
        y={-160}
        width={30}
        height={30}
        fill={'#f5c542'}
      />
    </>,
  );

  binding.bindTarget('rate', rateHandle());
  binding.bindTarget('offset', offsetHandle());
  binding.bindTarget('readout', readout());

  yield* drift().rotation(180, 4);
  yield* waitFor(1);
});
