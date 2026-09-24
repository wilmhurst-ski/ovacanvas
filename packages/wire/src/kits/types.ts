import type {Issue} from '../document/issues.js';
import type {SceneNode, Step, Touch, Value} from '../document/model.js';

/**
 * A kit instance as authored: an id, the kit name, and the kit's own fields.
 *
 * @remarks
 * Kits are the high-level layer over the node document. One kit instance
 * stands for a whole structure (a labelled figure, a derivation) and its
 * expander owns everything a model is bad at - label placement, arc angles,
 * stacking, audit authorizations - so the model only states *what* is there.
 */
export interface KitNode {
  readonly id: string;
  readonly kit: string;
  readonly [field: string]: Value | undefined;
}

/** A stage rectangle in scene coordinates: centre-origin, y down. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What one kit instance expands into. */
export interface KitExpansion {
  readonly nodes: readonly SceneNode[];
  readonly touches: readonly Touch[];
  /**
   * Addressable parts, for beats: `"fig.KLP"` to how to show / highlight /
   * trace it. Keys are the part names after the kit id (`"KLP"`).
   */
  readonly parts: ReadonlyMap<string, KitPart>;
}

/** How a beat can act on one addressable part of a kit. */
export interface KitPart {
  /** Node ids that make the part visible (`show` fades them in). */
  readonly nodes: readonly string[];
  /**
   * A hidden overlay the kit prepared for `highlight` (fades in, and out at
   * the next beat). When absent, highlight recolours `nodes` instead.
   */
  readonly overlay?: string;
  /**
   * Steps that `play` runs (a simulation's motion). Their total duration is
   * part of the beat.
   */
  readonly play?: readonly Step[];
  /** Line nodes that `trace` draws (their `end` goes 0 to 1). */
  readonly traceable?: readonly string[];
  /** For a morphing derivation: the node and the tex to morph to. */
  readonly morph?: {
    readonly node: string;
    readonly tex: string | readonly string[];
    readonly note?: {readonly node: string; readonly text: string};
  };
  /**
   * How `trace` draws a part that is not a line: each node starts from
   * these props and grows into its own (bars rising from an axis).
   */
  readonly grow?: readonly {
    readonly node: string;
    readonly from: Readonly<Record<string, Value>>;
  }[];
  /**
   * How `show` brings a part in, instead of a fade: each node starts from
   * these props (at full opacity, when `from` is on screen) and moves into
   * its own - a new line of working coming out of the line above it.
   */
  readonly emerge?: {
    /** The part that must already be on screen for this to happen. */
    readonly after: string;
    readonly nodes: readonly {
      readonly node: string;
      readonly from: Readonly<Record<string, Value>>;
    }[];
  };
}

export interface KitContext {
  /** The region box the instance was placed in. */
  readonly box: Box;
  /** Part names beats will highlight, so a kit can prepare overlays for them. */
  readonly highlighted: ReadonlySet<string>;
  /**
   * Every part name any beat targets (show, hide, highlight, trace), so a
   * kit can create a part on demand - a map shading a country a beat names.
   */
  readonly referenced?: ReadonlySet<string>;
  /** The part names a beat shows, a subset of `referenced`. */
  readonly shown?: ReadonlySet<string>;
  /**
   * Every version of this instance the beats will `set` it to, the one
   * being drawn included - so a kit that fits its content to its box can
   * fit all of them, and the frame holds still while the content changes.
   */
  readonly variants?: readonly KitNode[];
}

export interface KitFieldSpec {
  readonly type: string;
  readonly required?: boolean;
  readonly doc: string;
}

/** A kit's definition: its schema (for docs and validation) and its expander. */
export interface KitSpec {
  readonly name: string;
  readonly summary: string;
  readonly fields: Readonly<Record<string, KitFieldSpec>>;
  /** What beats can address inside an instance, e.g. `"fig.K", "fig.KL"`. */
  readonly parts: string;
  readonly example: KitNode;
  /** Located problems with the instance's own fields (node = instance id). */
  validate(node: KitNode): Issue[];
  /** Only called on an instance `validate` accepted. */
  expand(node: KitNode, context: KitContext): KitExpansion;
  /**
   * Rewrites a `set` path written in shorthand into the field path it
   * means (a diagram's `"block.t"` is `"parts.block.t"`).
   */
  setPath?(node: KitNode, path: readonly string[]): readonly string[];
  /**
   * Whether a change from `a` to `b` can be shown by blending the numbers
   * in between (default yes). A list of item values is not: it moves items.
   */
  interpolates?(a: KitNode, b: KitNode): boolean;
}

/** Stage regions a kit instance can be placed in. */
export const REGIONS: Readonly<Record<string, Box>> = {
  // Below the title band, with a margin inside the safe area on every side
  // so content never presses against the edge of the board.
  full: {x: 0, y: 75, width: 1640, height: 720},
  left: {x: -420, y: 75, width: 780, height: 720},
  right: {x: 420, y: 75, width: 780, height: 720},
  center: {x: 0, y: 75, width: 1000, height: 720},
  top: {x: 0, y: -160, width: 1640, height: 250},
  bottom: {x: 0, y: 265, width: 1640, height: 340},
};

/** One choreography beat: what changes, then a hold. */
export interface Beat {
  readonly show?: string | readonly string[];
  readonly hide?: string | readonly string[];
  readonly highlight?: string | readonly string[];
  readonly trace?: string | readonly string[];
  readonly morph?: string;
  readonly play?: string | readonly string[];
  /** Change kit fields (`"graph.k": 3`) or node props; the change animates. */
  readonly set?: Readonly<Record<string, Value>>;
  /** Dim everything but these parts; `false` brings everything back. */
  readonly focus?: string | readonly string[] | false | null;
  /** Labels to fly into the equation this beat shows or morphs. */
  readonly from?: string | readonly string[];
  /** How long this beat's changes take, overriding the pace. */
  readonly seconds?: number;
  /** Seconds to hold after the changes. Default 0.6. */
  readonly hold?: number;
  /** How long each change takes: quick 0.25s, normal 0.4s (default), slow 0.7s. */
  readonly pace?: 'quick' | 'normal' | 'slow';
  /** Keep this beat's highlights on through the next beat. */
  readonly keep?: boolean;
}

export type {Step};
