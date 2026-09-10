import {Scene3DError} from '../public/errors';
import type {ColorLike, Light3DSpec, Ray3D} from '../public/types';
import {Group3D} from './Group3D';
import {Object3D, type RaycastHit} from './Object3D';

export class SceneWorld3D {
  private readonly registry = new Map<string, Object3D>();
  private readonly rootGroup = new Group3D('__root__');
  private readonly lightList: Light3DSpec[] = [];

  public background: ColorLike | null = null;
  private disposedState = false;

  public constructor() {}

  public get lights(): readonly Light3DSpec[] {
    return this.lightList;
  }

  public get root(): Group3D {
    return this.rootGroup;
  }

  public addLight(light: Light3DSpec): this {
    this.lightList.push(light);
    return this;
  }

  public removeLight(light: Light3DSpec): this {
    const idx = this.lightList.indexOf(light);
    if (idx !== -1) {
      this.lightList.splice(idx, 1);
    }
    return this;
  }

  public clearLights(): this {
    this.lightList.length = 0;
    return this;
  }

  public add(obj: Object3D): this {
    this.registerObject(obj);
    this.rootGroup.add(obj);
    return this;
  }

  public remove(objOrId: Object3D | string): this {
    const obj =
      typeof objOrId === 'string' ? this.registry.get(objOrId) : objOrId;
    if (!obj) return this;

    this.unregisterObject(obj);
    if (obj.parent) {
      obj.parent.remove(obj);
    } else {
      this.rootGroup.remove(obj);
    }
    return this;
  }

  public getObjectById(id: string): Object3D | null {
    return this.registry.get(id) ?? null;
  }

  private registerObject(obj: Object3D): void {
    if (this.registry.has(obj.id)) {
      const existing = this.registry.get(obj.id);
      if (existing !== obj) {
        throw new Scene3DError(
          'DUPLICATE_OBJECT_ID',
          `Object with id "${obj.id}" already exists in SceneWorld3D`,
        );
      }
    }
    this.registry.set(obj.id, obj);

    if (obj instanceof Group3D) {
      for (const child of obj.children) {
        this.registerObject(child);
      }
    }
  }

  private unregisterObject(obj: Object3D): void {
    this.registry.delete(obj.id);
    if (obj instanceof Group3D) {
      for (const child of obj.children) {
        this.unregisterObject(child);
      }
    }
  }

  /**
   * Deterministic depth-first traversal of all visible world objects.
   */
  public traverse(callback: (obj: Object3D) => void): void {
    const visit = (node: Object3D) => {
      if (!node.visible) return;
      if (node !== this.rootGroup) {
        callback(node);
      }
      if (node instanceof Group3D) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };
    visit(this.rootGroup);
  }

  public raycast(ray: Ray3D): RaycastHit | null {
    if (this.disposedState) return null;
    return this.rootGroup.raycast(ray);
  }

  public dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.rootGroup.dispose();
    this.registry.clear();
    this.lightList.length = 0;
  }

  public isDisposed(): boolean {
    return this.disposedState;
  }
}
