import chroma from 'chroma-js';
import type {SceneNode, Touch, Value} from '../document/model.js';
import type {IconDef} from './library.js';
import {transformPath} from './path.js';

/** The default theme's hex values, for tints the theme has no token for. */
export const ICON_HEX: Readonly<Record<string, string>> = {
  blue: '#2F66D0',
  cyan: '#2EAEDC',
  coral: '#F05A3C',
  yellow: '#F3C742',
  green: '#4E9B62',
  magenta: '#B968A7',
  ink: '#151922',
  secondaryInk: '#59616D',
};

export function hexColor(color: string | undefined, fallback: string): string {
  if (color && ICON_HEX[color]) return ICON_HEX[color];
  if (color && chroma.valid(color)) return chroma(color).hex();
  return ICON_HEX[fallback] ?? fallback;
}

/**
 * How an icon is presented:
 * - `line`: the drawing alone, in the colour (default ink);
 * - `badge`: the drawing in its colour on a soft round disc of the same hue;
 * - `tile`: the same on a rounded square.
 */
export type IconStyle = 'line' | 'badge' | 'tile';
export const ICON_STYLES: readonly IconStyle[] = ['line', 'badge', 'tile'];

export interface DrawnIcon {
  readonly nodes: SceneNode[];
  readonly touches: Touch[];
  /** The stroke path: what `trace` draws on. */
  readonly strokeId: string | null;
  /** Everything that makes up the icon (background, fill, stroke). */
  readonly ids: string[];
  /** Half the drawn extent, for placing labels around it. */
  readonly radius: number;
}

/**
 * An icon drawn at `size` pixels across, centred on `at`.
 *
 * @remarks
 * The size is baked into the path data: the stroke stays a crisp fixed
 * width at any size, the node's bounds are exactly the drawing, and `end`
 * traces the icon on.
 */
export function drawIcon(
  id: string,
  icon: IconDef,
  at: readonly [number, number],
  options: {
    size: number;
    color?: string;
    style?: IconStyle;
    /** Stroke width in pixels (default scales with the size). */
    stroke?: number;
    hidden?: boolean;
  },
): DrawnIcon {
  const style = options.style ?? 'line';
  const color = hexColor(options.color, style === 'line' ? 'ink' : 'blue');
  const scale = options.size / icon.span;
  const lineWidth =
    options.stroke ??
    Math.max(2, Math.round((icon.span === 24 ? 2 : 2.2) * scale * 10) / 10);
  const nodes: SceneNode[] = [];
  const touches: Touch[] = [];
  const ids: string[] = [];
  const position: Value = [Math.round(at[0]), Math.round(at[1])];
  const hidden: Record<string, Value> = options.hidden ? {opacity: 0} : {};
  let radius = options.size / 2;

  if (style !== 'line') {
    const backId = `${id}Bg`;
    const extent = Math.round(options.size * 1.7);
    radius = extent / 2;
    const tint = chroma.mix(color, '#FFFFFF', 0.84, 'rgb').hex();
    nodes.push(
      style === 'badge'
        ? {
            id: backId,
            component: 'Circle',
            props: {size: extent, fill: tint, position, ...hidden},
          }
        : {
            id: backId,
            component: 'Rect',
            props: {
              size: [extent, extent],
              radius: Math.round(extent * 0.24),
              fill: tint,
              position,
              ...hidden,
            },
          },
    );
    ids.push(backId);
  }
  if (icon.fill) {
    const fillId = `${id}Fill`;
    nodes.push({
      id: fillId,
      component: 'Path',
      props: {
        data: transformPath(icon.fill, scale),
        fill: color,
        position,
        ...hidden,
      },
    });
    ids.push(fillId);
  }
  let strokeId: string | null = null;
  if (icon.stroke) {
    strokeId = `${id}Icon`;
    nodes.push({
      id: strokeId,
      component: 'Path',
      props: {
        data: transformPath(icon.stroke, scale),
        stroke: color,
        lineWidth,
        lineCap: 'round',
        lineJoin: 'round',
        position,
        ...hidden,
      },
    });
    ids.push(strokeId);
  }
  // The parts of one icon are one drawing, overlapping on purpose.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      touches.push({a: ids[i], b: ids[j], reason: 'parts of one icon'});
    }
  }
  return {nodes, touches, strokeId, ids, radius};
}
