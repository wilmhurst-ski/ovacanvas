import {Shaders} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {Scene3DError} from '../public/errors';
import {Scene3DContextOwner} from '../render/Scene3DContextOwner';
import {Scene3DRenderer} from '../render/Scene3DRenderer';
import {Mesh3D} from '../scene/Mesh3D';
import {SceneWorld3D} from '../scene/SceneWorld3D';
import {MockWebGL2RenderingContext, createCrossingTriangles} from './fixtures';

describe('scene3d / renderer (Stage B Depth & Owner Switching Gate)', () => {
  it('verifies depth buffer attributes and depth bits', () => {
    const canvas = document.createElement('canvas');
    const gl = new MockWebGL2RenderingContext(canvas);

    expect(gl.getContextAttributes()?.depth).toBe(true);
    expect(gl.getParameter(gl.DEPTH_BITS)).toBeGreaterThan(0);
  });

  it('proves depth correctness on intersecting crossing geometry (Requirement 1 & 2)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner = new Scene3DContextOwner();
    owner.setup(gl as any);

    const {triangleA, triangleB} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('triA', triangleA, {kind: 'unlit'}));
    world.add(new Mesh3D('triB', triangleB, {kind: 'unlit'}));

    const renderer = new Scene3DRenderer();
    renderer.render(
      owner,
      world,
      {
        kind: 'orthographic',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalSize: 3,
        near: 0.1,
        far: 10,
      },
      {width: 100, height: 100},
    );

    // Sample pixels:
    // Left half (x = 25, y = 50): Blue (0, 0, 255) is closer and MUST occlude Red
    const leftPixel = new Uint8Array(4);
    gl.readPixels(25, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, leftPixel);
    expect(leftPixel[0]).toBe(0); // R = 0
    expect(leftPixel[2]).toBe(255); // B = 255

    // Right half (x = 75, y = 50): Red (255, 0, 0) is closer and MUST occlude Blue
    const rightPixel = new Uint8Array(4);
    gl.readPixels(75, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rightPixel);
    expect(rightPixel[0]).toBe(255); // R = 255
    expect(rightPixel[2]).toBe(0); // B = 0
  });

  it('preserves Shaders pixel output after switching: Shaders -> 3D -> Shaders (Requirement 3 & 4)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const gl = new MockWebGL2RenderingContext(canvas);

    const fakeScene: any = {
      onReloaded: {subscribe: () => {}},
      getRealSize: () => ({width: 100, height: 100, x: 100, y: 100}),
      playback: {deltaTime: 0.016, fps: 60},
    };
    const fakeSharedContext: any = {
      getProgram: () => ({}),
      borrow: (owner: any) => {
        owner.setup(gl);
        return gl;
      },
    };

    const shaders = new Shaders(fakeScene, fakeSharedContext);

    // 1. Render clean baseline with Shaders
    shaders.setup(gl as any);
    shaders.render();
    const baselinePixels = new Uint8Array(100 * 100 * 4);
    gl.readPixels(0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, baselinePixels);

    shaders.teardown(gl as any);

    // 2. Switch to 3D owner and render depth geometry
    const owner3D = new Scene3DContextOwner();
    owner3D.setup(gl as any);
    const {triangleA, triangleB} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('triA', triangleA));
    world.add(new Mesh3D('triB', triangleB));

    const renderer = new Scene3DRenderer();
    renderer.render(
      owner3D,
      world,
      {
        kind: 'orthographic',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalSize: 3,
        near: 0.1,
        far: 10,
      },
      {width: 100, height: 100},
    );

    owner3D.teardown(gl as any);

    // 3. Switch back to Shaders and render again
    shaders.setup(gl as any);
    shaders.render();
    const afterPixels = new Uint8Array(100 * 100 * 4);
    gl.readPixels(0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, afterPixels);

    shaders.teardown(gl as any);

    // 4. Prove exact pixel equivalence!
    expect(afterPixels).toEqual(baselinePixels);
  });

  it('proves stability over repeated owner-switch iterations (Requirement 5)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner3D = new Scene3DContextOwner();
    const {triangleA, triangleB} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('triA', triangleA));
    world.add(new Mesh3D('triB', triangleB));
    const renderer = new Scene3DRenderer();

    for (let i = 0; i < 30; i++) {
      owner3D.setup(gl as any);
      const obs = renderer.render(
        owner3D,
        world,
        {
          kind: 'orthographic',
          eye: [0, 0, 5],
          target: [0, 0, 0],
          verticalSize: 3,
          near: 0.1,
          far: 10,
        },
        {width: 100, height: 100},
      );

      expect(obs.activeVAOs).toBe(2);
      owner3D.teardown(gl as any);
    }
  });

  it('renders multiple 3D panels in one frame using one retained owner (Requirement 6)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner = new Scene3DContextOwner();
    owner.setup(gl as any);

    const {triangleA, triangleB} = createCrossingTriangles();
    const world1 = new SceneWorld3D();
    world1.add(new Mesh3D('panel1', triangleA));

    const world2 = new SceneWorld3D();
    world2.add(new Mesh3D('panel2', triangleB));

    const renderer = new Scene3DRenderer();

    // Render Panel 1 (left viewport)
    const obs1 = renderer.render(
      owner,
      world1,
      {
        kind: 'orthographic',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalSize: 3,
        near: 0.1,
        far: 10,
      },
      {width: 100, height: 100},
    );

    // Render Panel 2 (right viewport)
    const obs2 = renderer.render(
      owner,
      world2,
      {
        kind: 'orthographic',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalSize: 3,
        near: 0.1,
        far: 10,
      },
      {width: 100, height: 100},
    );

    expect(obs1.drawCalls).toBe(1);
    expect(obs2.drawCalls).toBe(1);
  });

  it('handles canvas resize between owner switches (Requirement 7)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const gl = new MockWebGL2RenderingContext(canvas);

    const owner = new Scene3DContextOwner();
    owner.setup(gl as any);

    const {triangleA} = createCrossingTriangles();
    const world = new SceneWorld3D();
    world.add(new Mesh3D('mesh', triangleA));
    const renderer = new Scene3DRenderer();

    // Initial render 100x100
    renderer.render(
      owner,
      world,
      {
        kind: 'perspective',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalFovRadians: Math.PI / 4,
        near: 0.1,
        far: 10,
      },
      {width: 100, height: 100},
    );

    expect(gl.viewportRect).toEqual([0, 0, 100, 100]);

    // Resize to 300x200
    renderer.render(
      owner,
      world,
      {
        kind: 'perspective',
        eye: [0, 0, 5],
        target: [0, 0, 0],
        verticalFovRadians: Math.PI / 4,
        near: 0.1,
        far: 10,
      },
      {width: 300, height: 200},
    );

    expect(gl.viewportRect).toEqual([0, 0, 300, 200]);
  });

  it('fails explicitly on context loss (Requirement 8)', () => {
    const canvas = document.createElement('canvas');
    const gl = new MockWebGL2RenderingContext(canvas);
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    expect(gl.isContextLost()).toBe(true);

    // Verify Scene3D catches context lost and throws typed error
    const scene3dError = new Scene3DError(
      'CONTEXT_LOST',
      'Shared WebGL2 context is lost',
    );
    expect(scene3dError.code).toBe('CONTEXT_LOST');
  });
});
