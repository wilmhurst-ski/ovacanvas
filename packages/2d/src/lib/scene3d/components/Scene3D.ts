import type {SharedWebGLContext} from '@ovacanvas/core';
import {BBox, SignalValue, SimpleSignal} from '@ovacanvas/core';
import {Shape, type ShapeProps} from '../../components/Shape';
import {initial, nodeName, signal} from '../../decorators';
import {useScene2D} from '../../scenes/useScene2D';
import {drawImage} from '../../utils';
import {pickClosest3D} from '../interaction/pick';
import {
  projectAnchor3D,
  projectPointToViewport3D,
} from '../interaction/project';
import {unprojectPoint3D} from '../interaction/unproject';
import {Scene3DError} from '../public/errors';
import type {
  Camera3DSpec,
  PickResult3D,
  ProjectedAnchor3D,
  RendererObservations3D,
  Vec3Like,
} from '../public/types';
import {Scene3DContextOwner} from '../render/Scene3DContextOwner';
import {Scene3DRenderer} from '../render/Scene3DRenderer';
import {SceneWorld3D} from '../scene/SceneWorld3D';

export interface Scene3DProps extends ShapeProps {
  world?: SignalValue<SceneWorld3D>;
  camera?: SignalValue<Camera3DSpec>;
  resolutionScale?: SignalValue<number>;
  sharedContext?: SharedWebGLContext;
}

const DEFAULT_CAMERA: Camera3DSpec = {
  kind: 'perspective',
  eye: [0, 2, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  verticalFovRadians: (45 * Math.PI) / 180,
  near: 0.1,
  far: 100,
};

@nodeName('Scene3D')
export class Scene3D extends Shape {
  private static readonly ownerMap = new WeakMap<
    SharedWebGLContext,
    Scene3DContextOwner
  >();

  @initial(() => new SceneWorld3D())
  @signal()
  public declare readonly world: SimpleSignal<SceneWorld3D, this>;

  @initial(DEFAULT_CAMERA)
  @signal()
  public declare readonly camera: SimpleSignal<Camera3DSpec, this>;

  @initial(1.0)
  @signal()
  public declare readonly resolutionScale: SimpleSignal<number, this>;

  public customSharedContext: SharedWebGLContext | null = null;
  private readonly renderer = new Scene3DRenderer();
  private lastObservations: RendererObservations3D | null = null;

  public constructor(props: Scene3DProps = {}) {
    super(props);
    if (props.sharedContext) {
      this.customSharedContext = props.sharedContext;
    }
  }

  private getSharedContext(): SharedWebGLContext | null {
    if (this.customSharedContext) return this.customSharedContext;
    try {
      const scene = useScene2D();
      return (scene as any)?.sharedWebGLContext ?? null;
    } catch {
      return null;
    }
  }

  public getContextOwner(
    sharedContext: SharedWebGLContext,
  ): Scene3DContextOwner {
    let owner = Scene3D.ownerMap.get(sharedContext);
    if (!owner) {
      owner = new Scene3DContextOwner();
      Scene3D.ownerMap.set(sharedContext, owner);
    }
    return owner;
  }

  protected override draw(context: CanvasRenderingContext2D): void {
    this.drawShape(context);

    const size = this.computedSize();
    const width = size.x;
    const height = size.y;

    if (width <= 0 || height <= 0) {
      this.drawChildren(context);
      return;
    }

    const sharedContext = this.getSharedContext();
    if (!sharedContext) {
      // In environments where WebGL is unavailable or not provided
      this.drawChildren(context);
      return;
    }

    const owner = this.getContextOwner(sharedContext);
    let gl: WebGL2RenderingContext;
    try {
      gl = sharedContext.borrow(owner);
    } catch (e) {
      throw new Scene3DError(
        'WEBGL2_UNAVAILABLE',
        'Failed to borrow shared WebGL2 context',
        {cause: e},
      );
    }

    if (gl.isContextLost()) {
      throw new Scene3DError('CONTEXT_LOST', 'Shared WebGL2 context is lost');
    }

    const world = this.world();
    const camera = this.camera();

    this.lastObservations = this.renderer.render(owner, world, camera, {
      width,
      height,
      resolutionScale: this.resolutionScale(),
    });

    const box = BBox.fromSizeCentered(size);
    context.save();
    if (this.clip()) {
      context.clip(this.getPath());
    }
    drawImage(context, gl.canvas, box);
    context.restore();

    this.drawChildren(context);
  }

  public project(point: Vec3Like) {
    const size = this.computedSize();
    return projectPointToViewport3D(point, this.camera(), {
      width: size.x,
      height: size.y,
    });
  }

  public projectAnchor(point: Vec3Like, normal?: Vec3Like): ProjectedAnchor3D {
    const size = this.computedSize();
    return projectAnchor3D(
      point,
      this.camera(),
      {width: size.x, height: size.y},
      normal,
    );
  }

  public unproject(localCoord: {x: number; y: number}, normalizedDepth = 0.5) {
    const size = this.computedSize();
    return unprojectPoint3D(localCoord, normalizedDepth, this.camera(), {
      width: size.x,
      height: size.y,
    });
  }

  public pick(localCoord: {x: number; y: number}): PickResult3D | null {
    const size = this.computedSize();
    return pickClosest3D(localCoord, this.world(), this.camera(), {
      width: size.x,
      height: size.y,
    });
  }

  public getObservations(): RendererObservations3D | null {
    return this.lastObservations;
  }

  public override dispose(): void {
    super.dispose();
  }
}
