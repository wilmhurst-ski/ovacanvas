import {vi} from 'vitest';
import {Matrix2D} from './src/types/Matrix2D';

/**
 * jsdom ships no DOMMatrix. This is a real (not fake) 2D-affine
 * implementation backed by the engine's own already-correct `Matrix2D`
 * math, covering exactly the subset every transform chain in this codebase
 * actually calls: `translateSelf`/`rotateSelf`/`scaleSelf`/`skewXSelf`/
 * `skewYSelf`, `multiply`, `inverse`, and the `m11`/`m12`/`m21`/`m22`/`m41`/
 * `m42` readouts `Matrix2D`'s own constructor reads back out of a DOMMatrix.
 *
 * Previously this was an empty class. That meant no test could exercise a
 * real transform chain at all - calling any of the methods above would
 * throw "not a function" - so anything needing a world-space coordinate had
 * to be proven in a real browser instead, even for plain 2D affine math with
 * no rendering or layout involved. Real affine math is fully specified and
 * this repo already has a verified-correct implementation of it, so there
 * is no reason to keep that limit for this subset of cases.
 */
class TestDOMMatrix {
  private matrix: Matrix2D;

  public constructor(init?: number[]) {
    this.matrix =
      init && init.length === 6
        ? new Matrix2D(init[0], init[1], init[2], init[3], init[4], init[5])
        : new Matrix2D();
  }

  public get m11(): number {
    return this.matrix.values[0];
  }
  public get m12(): number {
    return this.matrix.values[1];
  }
  public get m21(): number {
    return this.matrix.values[2];
  }
  public get m22(): number {
    return this.matrix.values[3];
  }
  public get m41(): number {
    return this.matrix.values[4];
  }
  public get m42(): number {
    return this.matrix.values[5];
  }
  public get a(): number {
    return this.m11;
  }
  public get b(): number {
    return this.m12;
  }
  public get c(): number {
    return this.m21;
  }
  public get d(): number {
    return this.m22;
  }
  public get e(): number {
    return this.m41;
  }
  public get f(): number {
    return this.m42;
  }

  public translateSelf(tx = 0, ty = 0): this {
    this.matrix = this.matrix.translate([tx, ty]);
    return this;
  }

  /** This codebase only ever rotates about z; rotX/rotY are accepted but unused. */
  public rotateSelf(rotX = 0, rotY = 0, rotZ = 0): this {
    void rotX;
    void rotY;
    this.matrix = this.matrix.rotate(rotZ);
    return this;
  }

  public scaleSelf(sx = 1, sy = sx): this {
    this.matrix = this.matrix.scale([sx, sy]);
    return this;
  }

  public skewXSelf(degrees = 0): this {
    const t = Math.tan((degrees * Math.PI) / 180);
    this.matrix = this.matrix.mul(new Matrix2D(1, 0, t, 1, 0, 0));
    return this;
  }

  public skewYSelf(degrees = 0): this {
    const t = Math.tan((degrees * Math.PI) / 180);
    this.matrix = this.matrix.mul(new Matrix2D(1, t, 0, 1, 0, 0));
    return this;
  }

  public multiply(other: TestDOMMatrix): TestDOMMatrix {
    const result = new TestDOMMatrix();
    result.matrix = this.matrix.mul(other.matrix);
    return result;
  }

  public inverse(): TestDOMMatrix {
    const result = new TestDOMMatrix();
    result.matrix =
      this.matrix.inverse ?? new Matrix2D(NaN, NaN, NaN, NaN, NaN, NaN);
    return result;
  }
}

vi.stubGlobal('DOMMatrix', TestDOMMatrix);
