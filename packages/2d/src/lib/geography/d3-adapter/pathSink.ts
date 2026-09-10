import type {GeoContext} from 'd3-geo';
import type {PrivateProjector} from './projectionFactory';

/**
 * A Canvas-compatible context sink that builds a Path2D object from d3.geoPath calls.
 */
export class Path2DContextSink implements GeoContext {
  public path: Path2D = new Path2D();

  public beginPath(): void {
    // When beginPath is called by geoPath, start a fresh Path2D
    this.path = new Path2D();
  }

  public moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  public lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }

  public arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    anticlockwise: boolean = false,
  ): void {
    this.path.arc(x, y, radius, startAngle, endAngle, anticlockwise);
  }

  public closePath(): void {
    this.path.closePath();
  }
}

/**
 * Render a GeoJSON object directly into a Path2D via a private projector.
 */
export function renderToPath2D(
  projector: PrivateProjector,
  object: any,
): Path2D {
  const sink = new Path2DContextSink();
  const pathGen = projector.createPath(sink);
  pathGen(object);
  return sink.path;
}

/**
 * Render a GeoJSON object into an SVG path string via a private projector.
 */
export function renderToSvgPathString(
  projector: PrivateProjector,
  object: any,
): string {
  const pathGen = projector.createPath(null);
  return pathGen(object) ?? '';
}
