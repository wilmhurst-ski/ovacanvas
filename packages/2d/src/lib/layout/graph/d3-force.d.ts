declare module 'd3-force' {
  export interface ForceNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
  }

  export interface ForceLinkDatum<Node extends ForceNodeDatum> {
    source: string | Node;
    target: string | Node;
  }

  export interface Force<Node extends ForceNodeDatum> {
    (alpha: number): void;
    initialize?(nodes: Node[], random: () => number): void;
  }

  export interface LinkForce<
    Node extends ForceNodeDatum,
    Link extends ForceLinkDatum<Node>,
  > extends Force<Node> {
    id(accessor: (node: Node) => string): this;
    distance(distance: number): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }

  export interface ManyBodyForce<Node extends ForceNodeDatum>
    extends Force<Node> {
    strength(strength: number): this;
  }

  export interface CenterForce<Node extends ForceNodeDatum>
    extends Force<Node> {
    strength(strength: number): this;
  }

  export function forceLink<
    Node extends ForceNodeDatum,
    Link extends ForceLinkDatum<Node>,
  >(links: Link[]): LinkForce<Node, Link>;

  export function forceManyBody<
    Node extends ForceNodeDatum,
  >(): ManyBodyForce<Node>;

  export function forceCenter<Node extends ForceNodeDatum>(
    x?: number,
    y?: number,
  ): CenterForce<Node>;
}
