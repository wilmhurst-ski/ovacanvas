import {equationIntent} from './equationIntent/strategy';
import {fullCodeGen} from './fullCodeGen';
import {sceneDocument, sceneDocumentPlain} from './sceneDocument';
import type {AuthoringStrategy} from './types';

/**
 * An intent-compiler domain, and the engine primitive that qualifies it.
 *
 * @remarks
 * `primitive` is required, and that is the point of this interface. The
 * selection rule this project arrived at from measurement is:
 *
 * \> An intent compiler wins only where the engine already has a
 * \> correct-by-construction primitive matching the domain's real shape.
 * \> Where the deterministic layer still has an unsolved layout problem, full
 * \> code-generation wins instead.
 *
 * Requiring a domain to name its primitive makes that rule enforceable in
 * review rather than aspirational: a domain that cannot fill this field is a
 * domain that would have to solve a layout problem in its template, which is
 * exactly the case that loses.
 */
export interface IntentCompilerDomain {
  readonly id: string;
  readonly strategy: AuthoringStrategy;
  /** The real engine primitive this domain is correct-by-construction on. */
  readonly primitive: string;
}

/**
 * Domains measured to be worth an intent compiler.
 *
 * @remarks
 * Adding a domain is: implement the strategy, prove the engine primitive fits
 * with real topics, then register it here with that primitive named. The two
 * evaluations below are recorded because a "no" is as much a result as a
 * "yes" - the next person should not have to re-derive either.
 *
 * **Graph / network / molecule diagrams - evaluated, NO.** The obvious next
 * candidate, and the measurement says no. A graph needs a layout, and the
 * engine's generic force-directed layout does not guarantee angular separation
 * around a high-degree node, so the template would have to solve that itself -
 * precisely the "deterministic layer has an unsolved layout problem" case
 * where full code-generation measured better. The identified real fix is a
 * radial/balloon layout for high-degree nodes; until that exists, adding this
 * domain would make results worse.
 *
 * **Geography / maps - evaluated, NO.** `placeMapLabels`
 * (`packages/2d/src/lib/geography/labels/mapLabelPlacement.ts`) was read
 * rather than assumed, and it is genuinely useful - but it is a different
 * class of guarantee from the equation domain's, for two concrete reasons:
 *
 * 1. It is a **search that can fail**. It returns `unplaced` labels with a
 *    `'collision'` reason once all 24 candidate offsets (8 directions × 3
 *    leader lengths) are exhausted. `Latex.tex()` plus `AnchoredLabel` cannot
 *    fail that way - they construct a correct result with no search at all. A
 *    template built on a search has to invent a policy for the failure case
 *    (drop which labels?), which is a content decision, not a geometric one.
 * 2. Its inputs live in a **different space from the audit's verdict**. It
 *    reasons about declared `[width, height]` sizes inside a caller-supplied
 *    viewport; the audit judges real rendered world boxes. Making those agree
 *    means bridging font metrics to bounding boxes - and that bridge is
 *    exactly the geometry the intent-compiler pattern exists to remove. A
 *    template that has to do it has given up the pattern's advantage.
 *
 * So geography stays on full code-generation, where the audit can still judge
 * whatever the model produces. This is a statement about the primitive, not
 * about geography being unimportant - if a map primitive that *constructs*
 * rather than *searches* appears, the evaluation should be redone.
 *
 * **Measured, not just reasoned.** Running real non-STEM topics through the
 * general path (`liveDomainBreadth.test.ts`): 4/4 succeeded, **every one on
 * the first attempt** - two geography, one history, one physics. That is the
 * other half of the decision: not only is there no primitive that qualifies a
 * geography intent compiler, there is no evidence the domain needs one. Had
 * the general path struggled, the conclusion would have been that the
 * *general path* needs work, not that a template should be written to avoid
 * it.
 */
export const INTENT_COMPILER_DOMAINS: readonly IntentCompilerDomain[] = [
  {
    id: 'equation-solving',
    strategy: equationIntent,
    primitive:
      "`Latex.tex()`'s subexpression-matching glyph morph, plus `AnchoredLabel`'s engine-derived position - one equation and one note, so there is no layout problem for the template to solve",
  },
];

/**
 * The general strategies: any topic, any catalogue component.
 *
 * @remarks
 * `scene-document` is the default. It is as general as full code generation
 * (both reach every component the engine exports) but the model writes a
 * validated JSON document instead of code, so the failure classes recorded
 * against full code-gen - invented props and exports, positional constructor
 * arguments, `number[]` coordinates, missing or one-sided `mayTouch`,
 * unregistered nodes - cannot occur. `full-code-gen` stays selectable with
 * `OVACANVAS_STRATEGY=full-code-gen` so the two can be measured side by side.
 */
export const GENERAL_STRATEGIES: Readonly<Record<string, AuthoringStrategy>> = {
  [sceneDocument.id]: sceneDocument,
  [sceneDocumentPlain.id]: sceneDocumentPlain,
  [fullCodeGen.id]: fullCodeGen,
};

/**
 * What every topic without a fitting domain uses by default.
 *
 * @remarks
 * Not a degraded path - it is the general one, and the only kind of strategy
 * that can serve a domain the engine has no purpose-built primitive for. It is
 * the floor this product stands on, not a consolation prize.
 */
export const FALLBACK_STRATEGY: AuthoringStrategy = sceneDocument;

export interface StrategySelection {
  readonly strategy: AuthoringStrategy;
  /** Why this strategy was chosen, for logs and for measurement output. */
  readonly reason: string;
}

/**
 * @param general - id of the general strategy to fall back to (e.g. from
 * `OVACANVAS_STRATEGY`); unknown or omitted means `FALLBACK_STRATEGY`.
 */
export function selectStrategy(
  topic: string,
  general?: string,
): StrategySelection {
  for (const domain of INTENT_COMPILER_DOMAINS) {
    if (domain.strategy.matches(topic)) {
      return {
        strategy: domain.strategy,
        reason: `matches the "${domain.id}" intent-compiler domain (${domain.primitive})`,
      };
    }
  }
  const fallback =
    (general && GENERAL_STRATEGIES[general]) || FALLBACK_STRATEGY;
  return {
    strategy: fallback,
    reason: `no intent-compiler domain fits this topic, so the general path is used (${fallback.id}: ${fallback.description})`,
  };
}
