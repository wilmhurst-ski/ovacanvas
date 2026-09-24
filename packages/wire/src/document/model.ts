/**
 * The scene document: the only thing a model (or a person) authors.
 *
 * @remarks
 * A document is a flat list of nodes, a timeline of steps, and the contacts
 * that are allowed on purpose. It never contains code, coordinates in
 * variables, audit registration, or constructor calls - those are produced
 * deterministically by `generateBeatSource`, so a model cannot get them wrong.
 *
 * Plain JSON, so it can be written by any model, stored as a `.ovw.json`
 * file, handed to an MCP tool, or diffed in review.
 */
export interface SceneDocument {
  readonly version: 1;
  /** Human-readable title, used for logs and the file name. Not drawn. */
  readonly title?: string;
  readonly nodes: readonly SceneNode[];
  readonly timeline: readonly Step[];
  /** Contacts that are intentional, each with a reason the audit can show. */
  readonly touches?: readonly Touch[];
}

export interface SceneNode {
  /**
   * Stable identity. Becomes the variable name, the audit id and the source
   * map key, so it must be a lower-camel identifier (`title`, `eqStep1`).
   */
  readonly id: string;
  /** A catalogue component name, e.g. `"Latex"`, `"Rect"`, `"AnchoredLabel"`. */
  readonly component: string;
  readonly props?: Readonly<Record<string, Value>>;
  /** Id of the node this one is drawn inside. Omitted: added to the stage. */
  readonly parent?: string;
  /**
   * A typographic role from the engine's type scale (`"title"`, `"body"`, ...).
   * Text components only; explicit `fontSize`/`fontWeight` props still win.
   */
  readonly role?: string;
  /** Audit padding in pixels. Defaults to 8 for items and 4 for routes. */
  readonly halo?: number;
  /**
   * The position is load-bearing (a figure's vertex): the host's mechanical
   * repair must move whatever this collides with, never this node.
   * Point-defined lines are pinned already.
   */
  readonly fixed?: boolean;
}

/**
 * A JSON value. Four object shapes carry meaning:
 * - `{"x": 1, "y": 2}` - a vector
 * - `{"theme": "ink"}` - a theme colour token
 * - `{"ref": "id"}` - another node
 * - `{"ref": "id", "side": "right"}` - a point on another node
 */
export type Value =
  | null
  | boolean
  | number
  | string
  | readonly Value[]
  | {readonly [key: string]: Value};

export type Step =
  | WaitStep
  | TweenStep
  | SetStep
  | AllStep
  | SequenceStep
  | ChainStep;

/** Hold for a number of seconds. */
export interface WaitStep {
  readonly kind: 'wait';
  readonly seconds: number;
}

/** Animate one prop of one node to a new value. */
export interface TweenStep {
  readonly kind: 'tween';
  readonly node: string;
  readonly prop: string;
  readonly to: Value;
  readonly seconds: number;
  /** A catalogue easing name. Omitted: the engine default (`easeInOutCubic`). */
  readonly easing?: string;
}

/** Change a prop instantly. */
export interface SetStep {
  readonly kind: 'set';
  readonly node: string;
  readonly prop: string;
  readonly value: Value;
}

/** Run steps together; finishes when the longest one does. */
export interface AllStep {
  readonly kind: 'all';
  readonly steps: readonly Step[];
}

/** Start steps one after another, `delay` seconds apart, overlapping. */
export interface SequenceStep {
  readonly kind: 'sequence';
  readonly delay: number;
  readonly steps: readonly Step[];
}

/** Run steps one after another (the top-level timeline already does this). */
export interface ChainStep {
  readonly kind: 'chain';
  readonly steps: readonly Step[];
}

export interface Touch {
  readonly a: string;
  /** Another node id, or `"*"` for a genuine background everything sits on. */
  readonly b: string;
  readonly reason: string;
}

/** Points on a node an endpoint may attach to. */
export const ANCHOR_SIDES = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
] as const;
export type AnchorSide = (typeof ANCHOR_SIDES)[number];

export const STEP_KINDS = [
  'wait',
  'tween',
  'set',
  'all',
  'sequence',
  'chain',
] as const;

/** The engine refuses a beat longer than this (`BeatAdapter`'s hard cap). */
export const MAX_BEAT_SECONDS = 6;
/** Past this, a beat is legal but rushed - a warning, not an error. */
export const COMFORTABLE_BEAT_SECONDS = 4.5;
/** Default audit padding. */
export const DEFAULT_ITEM_HALO = 8;
export const DEFAULT_ROUTE_HALO = 4;
/**
 * The stage is 1920x1080 with (0, 0) at its centre; content should stay
 * inside this box. Mirrors the `BBox(60, 60, 1800, 960)` safe area every
 * shipped beat hands the audit.
 */
export const SAFE_HALF_WIDTH = 900;
export const SAFE_HALF_HEIGHT = 480;

export function emptyDocument(title?: string): SceneDocument {
  return {version: 1, ...(title ? {title} : {}), nodes: [], timeline: []};
}
