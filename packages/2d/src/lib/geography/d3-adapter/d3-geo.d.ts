/**
 * Narrow internal type definitions for d3-geo 3.1.1.
 *
 * @remarks
 * These declarations are strictly private to `@ovacanvas/2d/src/lib/geography`.
 * They must NEVER be exported or re-exported from public packages.
 */

declare module 'd3-geo' {
  export interface GeoStream {
    point(x: number, y: number, z?: number): void;
    lineStart(): void;
    lineEnd(): void;
    polygonStart(): void;
    polygonEnd(): void;
    sphere?(): void;
  }

  export interface GeoTransformPrototype {
    stream(stream: GeoStream): GeoStream;
  }

  export interface GeoContext {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      anticlockwise?: boolean,
    ): void;
    closePath(): void;
  }

  export interface GeoRawProjection {
    (lambda: number, phi: number): [number, number];
    invert?(x: number, y: number): [number, number];
  }

  export interface GeoProjection {
    (coordinates: [number, number]): [number, number] | null;
    invert?(point: [number, number]): [number, number] | null;

    stream(stream: GeoStream): GeoStream;

    clipAngle(): number | null;
    clipAngle(angle: number | null): this;

    clipExtent(): [[number, number], [number, number]] | null;
    clipExtent(extent: [[number, number], [number, number]] | null): this;

    scale(): number;
    scale(scale: number): this;

    translate(): [number, number];
    translate(point: [number, number]): this;

    center(): [number, number];
    center(point: [number, number]): this;

    rotate(): [number, number, number];
    rotate(angles: [number, number] | [number, number, number]): this;

    angle(): number;
    angle(angle: number): this;

    reflectX(): boolean;
    reflectX(reflect: boolean): this;

    reflectY(): boolean;
    reflectY(reflect: boolean): this;

    precision(): number;
    precision(precision: number): this;

    fitExtent(extent: [[number, number], [number, number]], object: any): this;
    fitSize(size: [number, number], object: any): this;
    fitWidth(width: number, object: any): this;
    fitHeight(height: number, object: any): this;
  }

  export interface GeoPathGenerator {
    (object: any): string | null;
    area(object: any): number;
    bounds(object: any): [[number, number], [number, number]];
    centroid(object: any): [number, number];
    measure(object: any): number;
    projection(): GeoProjection | null;
    projection(projection: GeoProjection | null): this;
    context(): GeoContext | null;
    context(context: GeoContext | null): this;
    pointRadius(): number | ((...args: any[]) => number);
    pointRadius(radius: number | ((...args: any[]) => number)): this;
  }

  export function geoPath(
    projection?: GeoProjection | null,
    context?: GeoContext | null,
  ): GeoPathGenerator;

  export function geoStream(object: any, stream: GeoStream): void;

  export function geoEquirectangular(): GeoProjection;
  export function geoMercator(): GeoProjection;
  export function geoOrthographic(): GeoProjection;
  export function geoEqualEarth(): GeoProjection;
  export function geoNaturalEarth1(): GeoProjection;

  export interface GeoGraticuleGenerator {
    (): any;
    lines(): any[];
    outline(): any;
    extent(): [[number, number], [number, number]];
    extent(extent: [[number, number], [number, number]]): this;
    extentMajor(): [[number, number], [number, number]];
    extentMajor(extent: [[number, number], [number, number]]): this;
    extentMinor(): [[number, number], [number, number]];
    extentMinor(extent: [[number, number], [number, number]]): this;
    step(): [number, number];
    step(step: [number, number]): this;
    stepMajor(): [number, number];
    stepMajor(step: [number, number]): this;
    stepMinor(): [number, number];
    stepMinor(step: [number, number]): this;
    precision(): number;
    precision(precision: number): this;
  }

  export function geoGraticule(): GeoGraticuleGenerator;
  export function geoGraticule10(): any;

  export function geoDistance(a: [number, number], b: [number, number]): number;
  export function geoInterpolate(
    a: [number, number],
    b: [number, number],
  ): (t: number) => [number, number];
  export function geoLength(object: any): number;
  export function geoArea(object: any): number;
  export function geoBounds(object: any): [[number, number], [number, number]];
  export function geoCentroid(object: any): [number, number];
  export function geoContains(object: any, point: [number, number]): boolean;
}
