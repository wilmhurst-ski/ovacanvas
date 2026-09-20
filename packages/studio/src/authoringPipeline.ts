import {
  compileBeatModule,
  type CompileDiagnostic,
} from '@ovacanvas/host/authoring';
import {compileEquationSolveSource} from './authoring/strategies/equationIntent/compiler';
import {validateEquationSolveIntent} from './authoring/strategies/equationIntent/intent';
import {solveLinearEquation} from './authoring/strategies/equationIntent/solveLinear';
import {solveQuadraticEquation} from './authoring/strategies/equationIntent/solveQuadratic';
import {solveRationalEquation} from './authoring/strategies/equationIntent/solveRational';
import type {AuthoringStrategy} from './authoring/strategies/types';
import {
  complete,
  selectProvider,
  sumUsage,
  type ProviderSpec,
  type TokenUsage,
} from './providers';

/**
 * Topic in, audit-ready beat module out: the model writes, the compiler
 * judges, and every failure goes back to the model as the real error it was.
 *
 * @remarks
 * Three properties here are not negotiable, each one the direct answer to a
 * failure this project already paid for once:
 *
 * - **Bounded.** Three real content attempts. A prior incident in this
 *   project's history ran 486+ attempts against an exhausted quota in under
 *   five minutes; nothing here retries without a ceiling.
 * - **Infra failures do not consume content attempts.** A dropped connection
 *   or a rate limit says nothing about what the model wrote, so it gets its
 *   own small budget and the content attempt is refunded. A provider that
 *   never responds is indistinguishable from one that is about to, so every
 *   request carries a timeout.
 * - **Unrecoverable means stop now.** A 401/402/403 or a quota/billing
 *   message fails identically on every retry; confirming that repeatedly
 *   costs time and budget and teaches nothing.
 *
 * The feedback loop feeds the model the *actual* compiler diagnostics rather
 * than "that failed, try again", plus a short pattern-specific hint where one
 * exists - the difference between a retry that converges and one that
 * reproduces the same mistake.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_INFRA_ATTEMPTS = 2;

export interface AuthorAttempt {
  readonly attempt: number;
  readonly outcome:
    | 'provider-failed'
    | 'strategy-failed'
    | 'compile-failed'
    | 'accepted';
  readonly detail: string;
  /** Tokens this attempt billed, when the provider reported them. */
  readonly usage?: TokenUsage | null;
}

export interface AuthorSuccess {
  readonly ok: true;
  /** Which strategy produced this beat - recorded so results are comparable. */
  readonly strategy: string;
  /** The model's own reply, kept so a follow-up can revise it in place. */
  readonly source: string;
  /** The structured intent, when the strategy produced one. */
  readonly intent?: unknown;
  /** The compiled CommonJS the browser resolves into a beat. */
  readonly code: string;
  readonly attempts: number;
  readonly repaired: boolean;
  readonly provider: string;
  readonly model: string;
  /** Tokens billed across every attempt, including the ones that failed. */
  readonly usage: TokenUsage | null;
  /**
   * Solved in code, with no provider involved.
   *
   * @remarks
   * Recorded rather than inferred from `attempts === 0`, because the two are
   * easy to conflate and mean very different things: a deterministic solve is
   * a guaranteed answer that cost nothing and cannot fail on a rate limit,
   * while a zero-attempt success would be a bug.
   */
  readonly deterministic?: boolean;
  readonly log: readonly AuthorAttempt[];
}

export interface AuthorFailure {
  readonly ok: false;
  readonly reason:
    | 'attempts-exhausted'
    | 'unrecoverable-provider'
    | 'no-provider-key';
  readonly detail: string;
  readonly strategy: string;
  readonly provider: string;
  readonly model: string;
  /**
   * Tokens billed before giving up.
   *
   * @remarks
   * Recorded on failure as well as success, and that is the point: a topic
   * that fails after three attempts is the *most* expensive kind, and a cost
   * report that only counted successes would show the cheapest possible
   * picture of the most wasteful case.
   */
  readonly usage: TokenUsage | null;
  readonly log: readonly AuthorAttempt[];
}

export type AuthorOutcome = AuthorSuccess | AuthorFailure;

export interface AuthorOptions {
  readonly topic: string;
  /** The currently-shown beat's source, when this is a follow-up about it. */
  readonly existingSource?: string;
  /**
   * How the model should be asked to specify this beat. Everything else in
   * this module is strategy-agnostic - attempt budgets, timeouts, error
   * classification and feedback all behave identically whichever strategy is
   * chosen, which is what makes the two comparable.
   */
  readonly strategy: AuthoringStrategy;
  /**
   * The engine's verified export list, for strategies that ask the model for
   * code. Derived once per process, not per attempt.
   */
  readonly apiSection: string;
  /** Project whose installed `@ovacanvas/*` declarations the module compiles against. */
  readonly projectRoot: string;
  readonly provider?: string;
  readonly model?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxAttempts?: number;
  readonly maxInfraAttempts?: number;
  readonly timeoutMs?: number;
  /**
   * Feedback to open the first attempt with, as though a previous attempt had
   * already failed.
   *
   * @remarks
   * This is how the *advisory* half of the audit reaches the model. A beat
   * that is geometrically correct but badly composed is never refused - the
   * composition checks cannot block - so the only way their findings change
   * anything is by being handed back as a reason to try again. The caller
   * decides that; this just provides the channel.
   */
  readonly initialFeedback?: string;
  /** Injected so tests can drive the whole loop without a network. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * The turn's user message, worded so it works for any strategy.
 *
 * @remarks
 * Deliberately says "answer" rather than "module": a code strategy's answer is
 * a scene module, an intent compiler's answer is a JSON intent, and the retry
 * feedback has to make sense to whichever one is being asked.
 */
function userMessage(
  topic: string,
  feedback: string | undefined,
  existingSource: string | undefined,
): string {
  const parts: string[] = [];
  if (existingSource) {
    parts.push(
      `Here is your previous answer, which is what is on screen now:\n\n${existingSource}`,
    );
    parts.push(
      `The learner's follow-up: "${topic}"\n\n` +
        'If it is about the same idea, revise that answer and keep what is still relevant. If it is a ' +
        'different topic, answer afresh and make sure nothing from the previous answer is still ' +
        'referenced - a leftover heading or shape beside unrelated new content is a real, visible bug. ' +
        'Reply with the complete answer either way.',
    );
  } else {
    parts.push(`Topic: ${topic}`);
  }
  if (feedback) {
    parts.push(
      `Your previous attempt was rejected with this real error. Fix exactly this and reply again:\n\n${feedback}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Short, pattern-specific corrections for the mistakes that actually recur.
 *
 * @remarks
 * A bare diagnostic tells the model *what* is wrong; it often re-derives the
 * same wrong fix without knowing *why*. These are the specific confusions
 * measured to cost extra attempts.
 */
function hintFor(diagnostics: readonly CompileDiagnostic[]): string {
  const text = diagnostics.map(d => d.message).join('\n');
  const hints: string[] = [];
  if (
    /number\[\].*not assignable|PossibleVector2|not assignable to type.*Vector2/i.test(
      text,
    )
  ) {
    hints.push(
      'A coordinate stored in a variable must be an object `{x, y}`, not an array - a bare `[x, y]` ' +
        'infers as `number[]` and will not compile where a point is expected.',
    );
  }
  if (/Cannot find name/i.test(text)) {
    hints.push(
      'A name you used is not imported. Import it from `@ovacanvas/2d` or `@ovacanvas/core`.',
    );
  }
  if (/only specify known properties|does not exist in type/i.test(text)) {
    hints.push(
      "A prop name you passed does not exist on that component. Check the component's real props " +
        'rather than assuming a name.',
    );
  }
  if (/Expected \d+ arguments?/i.test(text)) {
    hints.push(
      'A constructor or function was called with the wrong number of arguments.',
    );
  }
  if (/is not assignable to type 'BBox'|BBox/i.test(text)) {
    hints.push(
      '`safeArea` must be `new BBox(x, y, width, height)` from `@ovacanvas/core`.',
    );
  }
  return hints.length > 0 ? `\n\nLikely cause: ${hints.join(' ')}` : '';
}

/**
 * Whether compiled CommonJS actually declares the two exports a beat needs.
 *
 * @remarks
 * Compiling is not the same as being a beat module: `export const answer = 42`
 * typechecks perfectly and is useless. The browser would find out when
 * `resolveBeatSource` refused it - but by then the attempt has already been
 * spent and the learner has waited through it. Checking the emitted exports
 * here turns that into one more piece of feedback the model can act on,
 * without needing a DOM to do it.
 */
export function missingBeatExports(code: string): string[] {
  const missing: string[] = [];
  if (!/exports\.default\s*=/.test(code)) {
    missing.push('a default export (the scene generator)');
  }
  if (!/exports\.buildAuditSpec\s*=/.test(code)) {
    missing.push('a named buildAuditSpec export');
  }
  return missing;
}

export function buildFeedback(
  diagnostics: readonly CompileDiagnostic[],
): string {
  const lines = diagnostics.map(diagnostic => {
    const at =
      diagnostic.line === null
        ? ''
        : ` (line ${diagnostic.line}, column ${diagnostic.column})`;
    return `- ${diagnostic.message}${at}`;
  });
  return `The module did not compile:\n${lines.join('\n')}${hintFor(diagnostics)}`;
}

/**
 * Answer the question in code, when code can answer it exactly.
 *
 * @remarks
 * This is the project's own rule - mechanical and deterministic first, a model
 * only for what needs judgement - applied one step earlier than the retry
 * loop. Everything downstream of the intent was already deterministic; the
 * only step that needed a language model was reading the question, and "solve
 * 2x + 3 = 7" does not need one.
 *
 * The consequence is not just speed. It means the product answers the
 * commonest question a learner types **with no API key configured, no network,
 * and no possibility of a rate limit** - the failure modes that stopped every
 * live verification today.
 *
 * Returns `null` for anything it cannot solve exactly, and the caller falls
 * through to the provider. That is the whole safety story: `solveLinear` never
 * guesses, so this can never produce a confident wrong answer.
 */
function solveWithoutModel(
  topic: string,
  projectRoot: string,
): AuthorSuccess | null {
  // Tried in order of how common the question is. Each solver refuses
  // anything that is not its shape - linear rejects a `^`, quadratic rejects a
  // `/`, rational requires one - so they cannot disagree about who owns a
  // topic, and the order is about which one gets asked first rather than about
  // precedence.
  const solved =
    solveLinearEquation(topic) ??
    solveQuadraticEquation(topic) ??
    solveRationalEquation(topic);
  if (!solved) return null;

  const validated = validateEquationSolveIntent({
    title: solved.title,
    steps: solved.steps,
  });
  if (!validated.ok) return null;

  const compiled = compileBeatModule(
    compileEquationSolveSource(validated.intent),
    projectRoot,
    '__solved__.ts',
  );
  // If it somehow does not compile, fall through rather than fail. The
  // deterministic path must never be the reason a question goes unanswered -
  // it is an optimisation, and an optimisation that can break the product is
  // not one.
  if (!compiled.ok) return null;

  return {
    ok: true,
    strategy: 'equation-intent',
    source: compileEquationSolveSource(validated.intent),
    intent: validated.intent,
    code: compiled.code,
    attempts: 0,
    repaired: compiled.repaired,
    provider: 'none',
    model: 'none',
    usage: null,
    deterministic: true,
    log: [
      {
        attempt: 0,
        outcome: 'accepted',
        detail: 'solved in code, without a provider',
      },
    ],
  };
}

export async function authorWithRetry(
  options: AuthorOptions,
): Promise<AuthorOutcome> {
  const env = options.env ?? process.env;

  const solved = solveWithoutModel(options.topic, options.projectRoot);
  if (solved) return solved;
  const spec: ProviderSpec = selectProvider(options.provider, env);
  const apiKey = env[spec.envKey];
  // `OVACANVAS_MODEL` is honoured because model ids retire, and a retired id
  // should be fixable by an operator changing an environment variable rather
  // than by editing code. Two comments in `providers.ts` already told readers
  // to use it; until now nothing read it, so following that advice silently
  // did nothing.
  const model = options.model ?? env.OVACANVAS_MODEL ?? spec.defaultModel;
  const log: AuthorAttempt[] = [];

  if (!apiKey) {
    return {
      ok: false,
      reason: 'no-provider-key',
      detail: `${spec.envKey} is not set - no key was found for provider "${spec.id}"`,
      strategy: options.strategy.id,
      provider: spec.id,
      model,
      usage: null,
      log,
    };
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxInfraAttempts =
    options.maxInfraAttempts ?? DEFAULT_MAX_INFRA_ATTEMPTS;
  const strategyId = options.strategy.id;

  const strategyContext = {
    topic: options.topic,
    existingSource: options.existingSource,
    apiSection: options.apiSection,
  };
  // Built once: a strategy's prompt is a pure function of the run's context,
  // so rebuilding it per attempt would only re-do identical work.
  const systemPrompt = options.strategy.buildSystemPrompt(strategyContext);

  let contentAttempts = 0;
  let infraAttempts = 0;
  let feedback: string | undefined = options.initialFeedback;
  // Accumulated across every attempt that reached the provider, so a retried
  // topic's true cost is visible rather than only its last call's.
  let usage: TokenUsage | null = null;

  for (;;) {
    if (contentAttempts >= maxAttempts) {
      return {
        ok: false,
        reason: 'attempts-exhausted',
        detail: `no stageable beat was produced in ${contentAttempts} attempt(s)`,
        strategy: strategyId,
        provider: spec.id,
        model,
        usage,
        log,
      };
    }
    contentAttempts++;

    const result = await complete(spec, apiKey, {
      model,
      system: systemPrompt,
      user: userMessage(options.topic, feedback, options.existingSource),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (!result.ok) {
      log.push({
        attempt: contentAttempts,
        outcome: 'provider-failed',
        detail: result.detail,
      });
      if (result.kind === 'unrecoverable') {
        return {
          ok: false,
          reason: 'unrecoverable-provider',
          detail: result.detail,
          strategy: strategyId,
          provider: spec.id,
          model,
          usage,
          log,
        };
      }
      // Infra failures are not the content's fault: refund the content
      // attempt and spend from the separate, smaller infra budget instead.
      contentAttempts--;
      infraAttempts++;
      if (infraAttempts > maxInfraAttempts) {
        return {
          ok: false,
          reason: 'attempts-exhausted',
          detail: `the provider failed ${infraAttempts} time(s) without ever returning an answer: ${result.detail}`,
          strategy: strategyId,
          provider: spec.id,
          model,
          usage,
          log,
        };
      }
      continue;
    }

    usage = sumUsage(usage, result.usage);

    // The strategy's own judgement, before the compiler's. An intent
    // compiler rejects a structurally wrong intent here, with a message that
    // names the offending field; a code strategy passes its module straight
    // through. Either way the message is what goes back to the model.
    const interpretation = options.strategy.interpret(
      result.text,
      strategyContext,
    );
    if (!interpretation.ok) {
      feedback = interpretation.error;
      log.push({
        attempt: contentAttempts,
        outcome: 'strategy-failed',
        detail: interpretation.error.slice(0, 400),
        usage: result.usage,
      });
      continue;
    }

    const {source, intent} = interpretation.extraction;
    const compiled = compileBeatModule(
      source,
      options.projectRoot,
      '__authored__.ts',
    );

    if (compiled.ok) {
      const missing = missingBeatExports(compiled.code);
      if (missing.length === 0) {
        log.push({
          attempt: contentAttempts,
          outcome: 'accepted',
          detail: 'compiled',
          usage: result.usage,
        });
        return {
          ok: true,
          strategy: strategyId,
          source,
          intent,
          code: compiled.code,
          attempts: contentAttempts,
          repaired: compiled.repaired,
          provider: spec.id,
          model,
          usage,
          log,
        };
      }
      feedback =
        `The module compiled but is not a beat module - it is missing ${missing.join(' and ')}. ` +
        'Output the full module in the required shape.';
      log.push({
        attempt: contentAttempts,
        outcome: 'compile-failed',
        detail: `missing ${missing.join(', ')}`,
        usage: result.usage,
      });
      continue;
    }

    feedback = buildFeedback(compiled.diagnostics);
    log.push({
      attempt: contentAttempts,
      outcome: 'compile-failed',
      detail: compiled.diagnostics
        .map(d => d.message)
        .join(' | ')
        .slice(0, 400),
      usage: result.usage,
    });
  }
}
