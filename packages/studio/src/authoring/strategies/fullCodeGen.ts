import {stripCodeFence} from '../../providers';
import {buildSystemPrompt} from '../../systemPrompt';
import type {
  AuthoringStrategy,
  StrategyContext,
  StrategyInterpretation,
} from './types';

/**
 * The general-purpose path: the model writes the entire scene module.
 *
 * @remarks
 * This is the default and the fallback. It works for any topic, which is the
 * whole point - it is the only strategy that can serve a domain the engine has
 * no purpose-built primitive for. Its cost is that it asks the model to get
 * several independent things right simultaneously (real export names, prop
 * shapes, geometry, and the audit's `mayTouch` authorization model), which is
 * precisely where the intent-compiler domains win by removing the geometry
 * question entirely.
 *
 * `matches` is unconditionally true: this strategy is the floor, not a
 * preference. Selection prefers a fitting intent compiler and falls back here.
 */
export const fullCodeGen: AuthoringStrategy = {
  id: 'full-code-gen',
  description: 'the model writes the whole scene module',

  matches: () => true,

  buildSystemPrompt: (context: StrategyContext) =>
    buildSystemPrompt(context.apiSection),

  interpret(raw: string): StrategyInterpretation {
    // The module is used exactly as the model wrote it. Nothing is
    // normalised or repaired here - the compiler and the audit are the
    // judges, and inventing a second, weaker judge at this layer would only
    // hide the feedback they exist to produce.
    return {ok: true, extraction: {source: stripCodeFence(raw)}};
  },
};
