import type {PickableNode} from './types';

/**
 * Which presentation nodes are eligible for pointer interaction, and what
 * semantic target each one currently realizes.
 *
 * @remarks
 * The registry is the boundary between ephemeral presentation and stable
 * semantics. A node is bound to a semantic target id for as long as it
 * realizes it; reset, seek and hot reload rebuild the nodes and rebind the
 * same ids, so a target id survives what a node reference cannot.
 *
 * Eligibility is explicit. Nodes that were never bound are invisible to
 * picking rather than occluding: decoration must not swallow interaction.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export class InteractionTargets {
  private readonly byTarget = new Map<string, PickableNode>();
  private readonly byNode = new WeakMap<PickableNode, string>();

  /** How many targets are currently bound. */
  public get size(): number {
    return this.byTarget.size;
  }

  /** The bound target ids, for host bookkeeping. */
  public get targets(): string[] {
    return [...this.byTarget.keys()];
  }

  /**
   * Bind a semantic target to the node that currently realizes it.
   *
   * @returns An unbind function scoped to *this* binding, so a stale
   *          generation's teardown cannot unbind a newer generation's node.
   */
  public bind(target: string, node: PickableNode): () => void {
    const previous = this.byTarget.get(target);
    if (previous && previous !== node) {
      this.byNode.delete(previous);
    }
    this.byTarget.set(target, node);
    this.byNode.set(node, target);
    return () => this.unbind(target, node);
  }

  /**
   * Unbind a semantic target.
   *
   * @param node - When given, the binding is only removed if this node is
   *               still the one bound.
   */
  public unbind(target: string, node?: PickableNode): void {
    const bound = this.byTarget.get(target);
    if (!bound) return;
    if (node !== undefined && bound !== node) return;
    this.byTarget.delete(target);
    this.byNode.delete(bound);
  }

  /** Forget every binding. Used when a generation's presentation is rebuilt. */
  public clear(): void {
    for (const node of this.byTarget.values()) {
      this.byNode.delete(node);
    }
    this.byTarget.clear();
  }

  /** The semantic target this node realizes, or `null` if it is not eligible. */
  public targetFor(node: PickableNode): string | null {
    return this.byNode.get(node) ?? null;
  }

  /**
   * The node currently realizing a semantic target.
   *
   * @remarks
   * Internal to coordinate resolution. Nodes resolved here are used for
   * matrix math and never handed to interaction handlers.
   */
  public nodeFor(target: string): PickableNode | null {
    return this.byTarget.get(target) ?? null;
  }
}
