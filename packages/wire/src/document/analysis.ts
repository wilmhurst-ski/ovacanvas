import {getCatalogue, getComponent, getProp} from '../catalogue/index.js';
import type {Catalogue} from '../catalogue/types.js';
import type {SceneDocument, SceneNode, Step, Value} from './model.js';
import {isObject} from './values.js';

/**
 * Seconds a timeline takes to play, using the engine's own flow semantics:
 * a chain sums, `all` takes the longest, and `sequence` starts each step
 * `delay` seconds after the previous one started.
 */
export function stepDuration(step: Step): number {
  switch (step.kind) {
    case 'wait':
      return Math.max(0, Number(step.seconds) || 0);
    case 'tween':
      return Math.max(0, Number(step.seconds) || 0);
    case 'set':
      return 0;
    case 'all':
      return Math.max(0, ...(step.steps ?? []).map(stepDuration));
    case 'chain':
      return timelineDuration(step.steps ?? []);
    case 'sequence': {
      const delay = Math.max(0, Number(step.delay) || 0);
      return Math.max(
        0,
        ...(step.steps ?? []).map(
          (inner, index) => index * delay + stepDuration(inner),
        ),
      );
    }
  }
}

export function timelineDuration(steps: readonly Step[]): number {
  return steps.reduce((sum, step) => sum + stepDuration(step), 0);
}

/** Visit every step with its path (`"2"`, `"2.steps.0"`, ...). */
export function walkSteps(
  steps: readonly Step[],
  visit: (step: Step, path: string) => void,
  prefix = '',
): void {
  steps.forEach((step, index) => {
    const path = prefix ? `${prefix}.steps.${index}` : String(index);
    visit(step, path);
    if (
      isObject(step) &&
      (step.kind === 'all' ||
        step.kind === 'sequence' ||
        step.kind === 'chain') &&
      Array.isArray(step.steps)
    ) {
      walkSteps(step.steps, visit, path);
    }
  });
}

/**
 * Node ids a value references. `constructionOnly` limits this to direct
 * `{"ref"}` values (which must exist before the node is constructed); a
 * `{"ref", "side"}` endpoint is read lazily and never imposes an order.
 */
export function referencedIds(
  value: Value | undefined,
  constructionOnly = false,
): string[] {
  const found: string[] = [];
  const visit = (v: Value | undefined) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (isObject(v)) {
      if (typeof v.ref === 'string') {
        if (!constructionOnly || v.side === undefined) found.push(v.ref);
        return;
      }
      Object.values(v).forEach(visit);
    }
  };
  visit(value);
  return found;
}

/**
 * Construction order: document order, except that a node constructed with a
 * direct reference to another (an `AnchoredLabel`'s `anchor`) comes after it.
 * Endpoint references are emitted as lazy functions, so they impose no order.
 * Returns `null` if the references form a cycle.
 */
export function constructionOrder(
  document: SceneDocument,
  catalogue: Catalogue = getCatalogue(),
): SceneNode[] | null {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const deps = new Map<string, string[]>();
  for (const node of document.nodes) {
    const component = getComponent(node.component, catalogue);
    const ids = Object.entries(node.props ?? {})
      .filter(
        ([prop]) => component && getProp(component, prop)?.type.kind === 'node',
      )
      .flatMap(([, value]) => referencedIds(value, true))
      .filter(id => byId.has(id) && id !== node.id);
    deps.set(node.id, ids);
  }
  const ordered: SceneNode[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): boolean => {
    const current = state.get(id);
    if (current === 'done') return true;
    if (current === 'visiting') return false;
    state.set(id, 'visiting');
    for (const dep of deps.get(id) ?? []) if (!visit(dep)) return false;
    state.set(id, 'done');
    ordered.push(byId.get(id)!);
    return true;
  };
  for (const node of document.nodes) if (!visit(node.id)) return null;
  return ordered;
}

/** Opacity each node starts with, multiplied down through its parents. */
export function initialOpacities(document: SceneDocument): Map<string, number> {
  return effectiveOpacities(
    document,
    new Map(
      document.nodes.map(node => [node.id, ownOpacity(node.props?.opacity)]),
    ),
  );
}

/**
 * Opacity each node ends with, applying every opacity `set`/`tween` in
 * timeline order. Parallel steps are applied in document order, which is
 * exact for the question asked of it: "does the beat end on a blank stage?"
 */
export function finalOpacities(document: SceneDocument): Map<string, number> {
  const own = new Map(
    document.nodes.map(node => [node.id, ownOpacity(node.props?.opacity)]),
  );
  walkSteps(document.timeline, step => {
    if (
      step.kind === 'tween' &&
      step.prop === 'opacity' &&
      own.has(step.node)
    ) {
      own.set(step.node, ownOpacity(step.to));
    } else if (
      step.kind === 'set' &&
      step.prop === 'opacity' &&
      own.has(step.node)
    ) {
      own.set(step.node, ownOpacity(step.value));
    }
  });
  return effectiveOpacities(document, own);
}

function ownOpacity(value: Value | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

function effectiveOpacities(
  document: SceneDocument,
  own: Map<string, number>,
): Map<string, number> {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const result = new Map<string, number>();
  const resolve = (id: string, depth: number): number => {
    if (result.has(id)) return result.get(id)!;
    const node = byId.get(id);
    if (!node || depth > document.nodes.length) return 1;
    const parentOpacity =
      node.parent !== undefined && byId.has(node.parent)
        ? resolve(node.parent, depth + 1)
        : 1;
    const value = (own.get(id) ?? 1) * parentOpacity;
    result.set(id, value);
    return value;
  };
  for (const node of document.nodes) resolve(node.id, 0);
  return result;
}
