import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {fullCodeGen} from './authoring/strategies/fullCodeGen';
import {authorWithRetry} from './authoringPipeline';

/**
 * The retry loop's real behaviour, driven through an injected transport so
 * every failure path is reachable without a network.
 *
 * @remarks
 * The transport is faked; nothing else is. The compiler is the real one,
 * running against the real installed declarations - so a "recovers on retry"
 * case here means a module that genuinely did not compile and then genuinely
 * did.
 */
const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));

const VALID_MODULE = `
import {Txt, makeScene2D} from '@ovacanvas/2d';
import {BBox, waitFor} from '@ovacanvas/core';
let title: Txt;
export default makeScene2D(function* (view) {
  title = new Txt({text: 'hello', fontSize: 48});
  view.add(title);
  yield* waitFor(1);
});
export function buildAuditSpec() {
  return {items: [{id: 'title', node: title, halo: 10}], requiredIds: ['title'], safeArea: new BBox(60, 60, 1800, 960)};
}
`;

/** Compiles as TypeScript, but is not a beat module at all. */
const NOT_A_BEAT = `export const answer = 42;`;

const ENV = {GOOGLE_API_KEY: 'test-key'} as NodeJS.ProcessEnv;

function geminiText(text: string): Response {
  return new Response(
    JSON.stringify({candidates: [{content: {parts: [{text}]}}]}),
    {status: 200, headers: {'Content-Type': 'application/json'}},
  );
}

function geminiError(status: number, message: string): Response {
  return new Response(JSON.stringify({error: {message}}), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

const baseOptions = {
  topic: 'anything',
  strategy: fullCodeGen,
  apiSection: '',
  projectRoot: COMPILE_ROOT,
  provider: 'gemini',
  env: ENV,
};

describe('authorWithRetry', () => {
  it('accepts a module that compiles on the first attempt', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      fetchImpl: (async () => {
        calls++;
        return geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.attempts).toBe(1);
      expect(outcome.repaired).toBe(false);
      expect(outcome.code).toContain('buildAuditSpec');
    }
    expect(calls).toBe(1);
  });

  it('feeds the real compiler error back and recovers on the retry', async () => {
    const seen: string[] = [];
    const outcome = await authorWithRetry({
      ...baseOptions,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          contents: Array<{parts: Array<{text: string}>}>;
        };
        seen.push(body.contents[0].parts[0].text);
        // First answer is genuinely broken (wrong prop name); second is fine.
        return seen.length === 1
          ? geminiText(VALID_MODULE.replace('fontSize: 48', 'textSize: 48'))
          : geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.attempts).toBe(2);
    // The second prompt must carry the ACTUAL diagnostic, not a generic nudge.
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/did not compile/);
    expect(seen[1]).toMatch(
      /textSize|only specify known properties|does not exist/i,
    );
  });

  it('answers a solvable equation in code, without calling any provider', async () => {
    // The point is not just speed. This is the path that works with no API
    // key, no network, and no possibility of a rate limit.
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      topic: 'solve 2x + 3 = 7 step by step',
      env: {},
      fetchImpl: (async () => {
        calls++;
        throw new Error('the provider must not be reached');
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.deterministic).toBe(true);
      expect(outcome.attempts).toBe(0);
      expect(outcome.provider).toBe('none');
      expect(outcome.usage).toBeNull();
      expect(outcome.code).toContain('makeScene2D');
    }
    expect(calls).toBe(0);
  });

  it('answers a quadratic in code too, with no provider', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      topic: 'solve the quadratic equation x^2 - 5x + 6 = 0',
      env: {},
      fetchImpl: (async () => {
        calls++;
        throw new Error('the provider must not be reached');
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.deterministic).toBe(true);
    expect(calls).toBe(0);
  });

  it('answers a rational equation in code as well', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      topic: 'solve for x: 3/(x - 1) = 2',
      env: {},
      fetchImpl: (async () => {
        calls++;
        throw new Error('the provider must not be reached');
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.deterministic).toBe(true);
    expect(calls).toBe(0);
  });

  it('still reaches the provider for anything it cannot solve exactly', async () => {
    // The safety property: the deterministic path is an optimisation, and it
    // must never be the reason a question goes unanswered.
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      topic: 'a timeline of the main events of the Roman Republic',
      fetchImpl: (async () => {
        calls++;
        return geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(calls).toBeGreaterThan(0);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.deterministic).toBeUndefined();
  });

  it('falls through to the provider when a solvable equation has no key either', async () => {
    // A question that parses is not automatically a question that can be
    // answered here - if the compiled template were rejected the pipeline
    // still has to try the provider rather than report a failure.
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      // Two fractions summed on one side: a real question, and one no solver
      // here handles, so it must reach the provider rather than be refused.
      topic: 'solve 1/x + 1/(x + 1) = 1',
      fetchImpl: (async () => {
        calls++;
        return geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(calls).toBeGreaterThan(0);
    expect(outcome.ok).toBe(true);
  });

  it('honours OVACANVAS_MODEL, which the provider comments tell operators to use', async () => {
    // `providers.ts` says a retired model id should be fixed with an
    // environment variable rather than by editing code. Nothing read it, so
    // following that advice silently did nothing - this pins it.
    const outcome = await authorWithRetry({
      ...baseOptions,
      env: {...ENV, OVACANVAS_MODEL: 'gemini-9.9-preview'},
      fetchImpl: (async () =>
        geminiText(VALID_MODULE)) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.model).toBe('gemini-9.9-preview');
  });

  it('prefers an explicitly requested model over the environment override', async () => {
    const outcome = await authorWithRetry({
      ...baseOptions,
      env: {...ENV, OVACANVAS_MODEL: 'gemini-9.9-preview'},
      model: 'explicit-model',
      fetchImpl: (async () =>
        geminiText(VALID_MODULE)) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.model).toBe('explicit-model');
  });

  it('stops immediately on an unrecoverable provider error instead of retrying', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      fetchImpl: (async () => {
        calls++;
        return geminiError(
          403,
          'API key not valid. Please pass a valid API key.',
        );
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('unrecoverable-provider');
      expect(outcome.detail).toMatch(/403/);
    }
    // The whole point: one call, not three.
    expect(calls).toBe(1);
  });

  it('does not charge a content attempt for a transient provider failure', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      fetchImpl: (async () => {
        calls++;
        // Two transport blips, then a good answer.
        if (calls <= 2) throw new Error('fetch failed');
        return geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.attempts).toBe(1);
    expect(calls).toBe(3);
  });

  it('gives up after the content attempt budget, never looping forever', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      fetchImpl: (async () => {
        calls++;
        return geminiText(NOT_A_BEAT);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('attempts-exhausted');
    expect(calls).toBe(3);
  });

  it('reports a missing key rather than attempting a request with no credentials', async () => {
    let calls = 0;
    const outcome = await authorWithRetry({
      ...baseOptions,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async () => {
        calls++;
        return geminiText(VALID_MODULE);
      }) as unknown as typeof fetch,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('no-provider-key');
    expect(calls).toBe(0);
  });
});
