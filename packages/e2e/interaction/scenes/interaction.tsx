import {Node, Rect, makeScene2D} from '@ovacanvas/2d';
import {createRef, useScene} from '@ovacanvas/core';
import {bindingFor} from '../runtimeState';

/**
 * A neutral interaction fixture.
 *
 * @remarks
 * Four shapes chosen for the geometry they exercise, not for anything they
 * depict: two that overlap, two that stack with the upper one fully
 * transparent, one nested under a rotation and a scale, and one whose
 * position is a pure projection of authoritative state.
 *
 * The scene owns no truth. It reads the projection and registers which nodes
 * are eligible for pointer input; it cannot write, and the ids it registers
 * are rebound to fresh nodes every time presentation is rebuilt.
 */
export default makeScene2D(function* (view) {
  const binding = bindingFor(useScene());

  const alpha = createRef<Rect>();
  const beta = createRef<Rect>();
  const under = createRef<Rect>();
  const ghost = createRef<Rect>();
  const gamma = createRef<Rect>();
  const handle = createRef<Rect>();
  const decor = createRef<Rect>();

  view.add(
    <>
      {/* Overlapping pair. Beta is added last, so it is painted on top. */}
      <Rect
        ref={alpha}
        x={-50}
        y={-110}
        width={120}
        height={80}
        fill={'#2f6f4f'}
        radius={6}
      />
      <Rect
        ref={beta}
        x={30}
        y={-110}
        width={120}
        height={80}
        fill={'#e13238'}
        radius={6}
      />
      {/*
        Decoration painted over alpha and never registered. It must not
        occlude interaction, and its rotation is what makes successive
        exported frames genuinely different.
      */}
      <Rect
        ref={decor}
        x={-80}
        y={-110}
        width={40}
        height={40}
        fill={'#f5c542'}
        opacity={0.6}
      />

      {/* A visible target under a fully transparent one. */}
      <Rect
        ref={under}
        x={-130}
        y={20}
        width={80}
        height={80}
        fill={'#3d7ab8'}
        radius={6}
      />
      <Rect
        ref={ghost}
        x={-130}
        y={20}
        width={80}
        height={80}
        fill={'#ffffff'}
        opacity={0}
      />

      {/* Nested under a rotation and a scale. */}
      <Node x={110} y={20} rotation={25} scale={1.3}>
        <Rect
          ref={gamma}
          x={20}
          width={70}
          height={50}
          fill={'#9b59b6'}
          radius={4}
        />
      </Node>

      {/* Position is a pure projection of authoritative state. */}
      <Rect
        ref={handle}
        x={() => binding.handleX()}
        y={() => binding.handleY()}
        width={60}
        height={60}
        fill={'#d0d4dc'}
        radius={10}
      />
    </>,
  );

  // Rebind the semantic targets to this generation's nodes.
  binding.bindTarget('target.alpha', alpha());
  binding.bindTarget('target.beta', beta());
  binding.bindTarget('target.under', under());
  binding.bindTarget('target.ghost', ghost());
  binding.bindTarget('target.gamma', gamma());
  binding.bindTarget('target.handle', handle());

  yield* decor().rotation(90, 4);
});
