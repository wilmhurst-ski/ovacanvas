/**
 * What a document value for one prop may be.
 *
 * @remarks
 * Every kind here is derived from a real declared type in `@ovacanvas/2d`
 * (see `scripts/extract-catalogue.mjs`), and each has exactly one checker in
 * `document/values.ts` and one emitter in `codegen/values.ts`. A declared type
 * that fits none of them is left out of the catalogue entirely (and listed in
 * `unsupportedProps`), so a document can never set it.
 */
export type PortType =
  | {readonly kind: 'number'; readonly nullable?: boolean}
  | {readonly kind: 'string'; readonly nullable?: boolean}
  | {readonly kind: 'boolean'; readonly nullable?: boolean}
  /** A CSS colour string, or `{"theme": "<token>"}`. */
  | {readonly kind: 'color'; readonly nullable?: boolean}
  /** `[x, y]`, `{x, y}`, or one number for both axes. */
  | {readonly kind: 'vector2'; readonly nullable?: boolean}
  /** One number, or 2-4 numbers in CSS padding order. */
  | {readonly kind: 'spacing'; readonly nullable?: boolean}
  /** A number of pixels, or a percentage string such as `"50%"`. */
  | {readonly kind: 'length'; readonly nullable?: boolean}
  | {
      readonly kind: 'enum';
      readonly choices: readonly string[];
      readonly nullable?: boolean;
    }
  /** One of the catalogue's `origins`, e.g. `"Top"`. */
  | {readonly kind: 'origin'; readonly nullable?: boolean}
  /** `{"ref": "<node id>"}`, optionally restricted to one component family. */
  | {
      readonly kind: 'node';
      readonly component?: string;
      readonly nullable?: boolean;
    }
  /** A vector2, or `{"ref": "<node id>", "side"?: "<side>"}`. */
  | {readonly kind: 'endpoint'; readonly nullable?: boolean}
  /** A list of at least two endpoints. */
  | {readonly kind: 'points'; readonly nullable?: boolean}
  | {
      readonly kind: 'numbers';
      readonly length?: number;
      readonly nullable?: boolean;
    }
  /** A LaTeX string, or a list of LaTeX fragments. */
  | {readonly kind: 'tex'; readonly nullable?: boolean}
  /**
   * A structured engine spec (projection, geo source, 3D world). Carried as
   * JSON; its exact shape is checked by the TypeScript backstop.
   */
  | {
      readonly kind: 'json';
      readonly tsType: string;
      readonly nullable?: boolean;
    };

export type PortKind = PortType['kind'];

export interface PropSpec {
  readonly type: PortType;
  readonly required: boolean;
  /** Whether the engine exposes this prop as a signal that accepts a duration. */
  readonly tweenable: boolean;
  /** Surfaced by default when a component is described to a model. */
  readonly essential: boolean;
  /** The engine's `@initial(...)` value, as source text. */
  readonly default?: string;
  readonly doc?: string;
}

export interface ComponentSpec {
  readonly name: string;
  /** Ancestor classes, nearest first (e.g. `['Txt', 'Shape', 'Layout', 'Node']`). */
  readonly extends: readonly string[];
  readonly summary?: string;
  /**
   * `route` for connector-like components (lines, wires) - the audit judges
   * them by their real segments, and a route may attach to the nodes its
   * endpoints reference.
   */
  readonly role: 'item' | 'route';
  readonly props: Readonly<Record<string, PropSpec>>;
}

export interface Catalogue {
  readonly version: 1;
  /** The engine package and version the catalogue was extracted from. */
  readonly engine: string;
  readonly components: Readonly<Record<string, ComponentSpec>>;
  readonly easings: readonly string[];
  readonly origins: readonly string[];
  readonly themeColors: readonly string[];
  readonly textRoles: readonly string[];
  /** Props that exist on a component but have no JSON representation. */
  readonly unsupportedProps: Readonly<Record<string, readonly string[]>>;
}
