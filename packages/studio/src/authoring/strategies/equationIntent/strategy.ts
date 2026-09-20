import {stripCodeFence} from '../../../providers';
import type {AuthoringStrategy, StrategyInterpretation} from '../types';
import {compileEquationSolveSource} from './compiler';
import {validateEquationSolveIntent} from './intent';
import {EQUATION_INTENT_SYSTEM_PROMPT} from './prompt';

/**
 * Topics this strategy is a candidate for.
 *
 * @remarks
 * Deliberately narrow, and narrower than it could be. A false positive is
 * materially worse than a false negative here: routing, say, a geometry
 * question into an equation solver produces confidently wrong content, while
 * falling through to full code-generation produces something the audit can
 * still judge on its real merits. So the test is "is this unmistakably a
 * solve-for-the-variable request", not "does this mention maths".
 */
const SOLVING_PATTERNS = [
  // "solve" only counts alongside an unmistakable algebraic signal. A bare
  // /\bsolve\b/ would claim "how do I solve a Rubik's cube" and hand it to an
  // equation compiler, which is exactly the false positive this narrowness
  // exists to prevent.
  /\bsolv(e|ing|ed)\b[^.]*?(=|for\s+[a-z]\b|equation|inequality|quadratic|linear|cubic|simultaneous|roots?\b|variable)/i,
  /\b(linear|quadratic|simultaneous|cubic)\s+equation/i,
  /\bisolate\s+the\s+variable\b/i,
  /\bfactor(is|ise|ing)?\b[^.]*\b(quadratic|expression|equation)/i,
  /\bfind\s+the\s+(value|roots?)\s+of\b/i,
  /\bsimplify\b[^.]*\bexpression\b/i,
  /\bstep[- ]by[- ]step\b[^.]*\b(solve|equation)/i,
];

export const equationIntent: AuthoringStrategy = {
  id: 'equation-intent',
  description:
    'the model emits only the algebra; a template compiles the scene',

  matches(topic: string): boolean {
    return SOLVING_PATTERNS.some(pattern => pattern.test(topic));
  },

  buildSystemPrompt: () => EQUATION_INTENT_SYSTEM_PROMPT,

  /**
   * Parse, validate, then compile.
   *
   * @remarks
   * Each failure returns a message written to be handed straight back to the
   * model as retry feedback. A JSON parse failure and a structurally valid
   * object with a missing field are genuinely different problems - the first
   * usually means the model wrapped its answer in prose, the second that it
   * misunderstood a rule - and saying which one it was is what makes the
   * retry converge instead of reproducing the same mistake.
   */
  interpret(raw: string): StrategyInterpretation {
    const text = stripCodeFence(raw).trim();
    const start = text.indexOf('{');
    if (start === -1) {
      return {
        ok: false,
        error:
          'the reply contained no JSON object at all. Output ONLY the JSON object, with no prose ' +
          'or markdown fences before or after it.',
      };
    }

    // A missing closing brace is a *malformed* object, not an absent one -
    // parsing the truncated slice lets JSON.parse say which, and a model told
    // "your JSON was cut off" fixes something different from one told "you
    // replied in prose".
    const end = text.lastIndexOf('}');
    const candidate =
      end > start ? text.slice(start, end + 1) : text.slice(start);

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      return {
        ok: false,
        error: `the reply was not valid JSON (${error instanceof Error ? error.message : String(error)}). Output only the JSON object.`,
      };
    }

    const validation = validateEquationSolveIntent(parsed);
    if (!validation.ok) return {ok: false, error: validation.error};

    return {
      ok: true,
      extraction: {
        intent: validation.intent,
        source: compileEquationSolveSource(validation.intent),
      },
    };
  },
};
