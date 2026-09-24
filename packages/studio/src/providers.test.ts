import {describe, expect, it} from 'vitest';
import {
  KeyRotator,
  PROVIDERS,
  classifyHttpFailure,
  complete,
  resolveProviderKeys,
  selectProvider,
  stripCodeFence,
} from './providers';

describe('classifyHttpFailure', () => {
  it('treats identity and account failures as fatal', () => {
    for (const status of [401, 402, 403]) {
      expect(classifyHttpFailure(status, 'whatever').kind).toBe(
        'unrecoverable',
      );
    }
    expect(classifyHttpFailure(400, 'API key not valid').kind).toBe(
      'unrecoverable',
    );
    expect(classifyHttpFailure(400, 'Your account is disabled').kind).toBe(
      'unrecoverable',
    );
  });

  it('treats a 429 rate limit as retryable even when the body says "quota"', () => {
    // This exact response was observed in a live run, and misclassifying it
    // as fatal abandoned a comparison that would have succeeded seconds
    // later - the provider's own message says "Please retry in 10.4s".
    const body =
      'You exceeded your current quota, please check your plan and billing details. ' +
      'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20. ' +
      'Please retry in 10.472651683s.';

    const failure = classifyHttpFailure(429, body);
    expect(failure.kind).toBe('transient');
    expect(failure.detail).toContain('rate limited');
  });

  it('treats server-side and connection-class failures as retryable', () => {
    for (const status of [408, 409, 425, 500, 502, 503, 504, 599]) {
      expect(classifyHttpFailure(status, '').kind, String(status)).toBe(
        'transient',
      );
    }
  });

  it('treats an unrecognised 4xx as fatal rather than retrying a guaranteed repeat', () => {
    expect(classifyHttpFailure(422, 'unprocessable entity').kind).toBe(
      'unrecoverable',
    );
  });
});

describe('stripCodeFence', () => {
  it('unwraps a fenced block and leaves unfenced text alone', () => {
    expect(stripCodeFence('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(stripCodeFence('```typescript\nconst a = 1;\n```')).toBe(
      'const a = 1;',
    );
    expect(stripCodeFence('const a = 1;')).toBe('const a = 1;');
  });
});

describe('the tokenharbor provider', () => {
  /** Capture the outgoing request while answering with a fixed payload. */
  async function capture(payload: unknown) {
    let seen: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
    } | null = null;
    const result = await complete(PROVIDERS.tokenharbor, 'thk_live_test', {
      model: PROVIDERS.tokenharbor.defaultModel,
      system: 'be brief',
      user: 'hello',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = {
          url,
          headers: init.headers as Record<string, string>,
          body: JSON.parse(String(init.body)),
        };
        return new Response(JSON.stringify(payload), {status: 200});
      }) as unknown as typeof fetch,
    });
    return {result, seen: seen!};
  }

  it('posts to the documented endpoint with a bearer key', async () => {
    const {seen} = await capture({choices: [{message: {content: 'ok'}}]});

    expect(seen.url).toBe('https://tokenharbor.ai/v1/chat/completions');
    // The docs are explicit that the OpenAI-shaped endpoint takes
    // `Authorization: Bearer thk_...`, unlike Gemini's query parameter.
    expect(seen.headers.Authorization).toBe('Bearer thk_live_test');
  });

  it('sends an OpenAI-shaped body carrying the system prompt', async () => {
    const {seen} = await capture({choices: [{message: {content: 'ok'}}]});
    const body = seen.body as {
      model: string;
      messages: Array<{role: string; content: string}>;
    };

    expect(body.model).toBe(PROVIDERS.tokenharbor.defaultModel);
    expect(body.messages[0]).toEqual({role: 'system', content: 'be brief'});
    expect(body.messages[1]).toEqual({role: 'user', content: 'hello'});
  });

  it('reads the reply and the token usage out of the OpenAI envelope', async () => {
    const {result} = await capture({
      choices: [{message: {content: 'a beat'}}],
      usage: {prompt_tokens: 2100, completion_tokens: 640},
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('a beat');
      expect(result.usage).toEqual({promptTokens: 2100, completionTokens: 640});
    }
  });

  it('is reachable by name, so OVACANVAS_PROVIDER can select it', () => {
    expect(selectProvider('tokenharbor', {TOKENHARBOR_API_KEY: 'k'}).id).toBe(
      'tokenharbor',
    );
  });
});

describe('selectProvider', () => {
  it('honours an explicit provider and rejects an unknown one by name', () => {
    expect(selectProvider('groq', {}).id).toBe('groq');
    expect(() => selectProvider('nope', {})).toThrow(/unknown provider "nope"/);
  });

  it('prefers a provider that actually has a key, so a missing key is not an auth error later', () => {
    expect(selectProvider(undefined, {GROQ_API_KEY: 'k'}).id).toBe('groq');
    expect(selectProvider(undefined, {HUGGINGFACE_API_KEY: 'k'}).id).toBe(
      'huggingface',
    );
  });

  it('falls back to the measured-best default when nothing is configured', () => {
    expect(selectProvider(undefined, {}).id).toBe('gemini');
  });
});

/** A fake transport that answers every request with one JSON payload. */
function respondWith(payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
    })) as unknown as typeof fetch;
}

describe('complete', () => {
  const spec = PROVIDERS.gemini;

  it('classifies a thrown fetch as transient rather than as a provider verdict', async () => {
    const result = await complete(spec, 'key', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () => {
        throw new Error('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('transient');
  });

  it('surfaces an empty completion distinctly from a transport failure', async () => {
    const result = await complete(spec, 'key', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () =>
        new Response(JSON.stringify({candidates: []}), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('empty');
  });

  it('reports token usage for an OpenAI-compatible provider', async () => {
    const result = await complete(PROVIDERS.groq, 'k', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: respondWith({
        choices: [{message: {content: 'ok'}}],
        usage: {prompt_tokens: 1200, completion_tokens: 340},
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage).toEqual({promptTokens: 1200, completionTokens: 340});
    }
  });

  it('reports token usage for Gemini, which names the fields differently', async () => {
    const result = await complete(PROVIDERS.gemini, 'k', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: respondWith({
        candidates: [{content: {parts: [{text: 'ok'}]}}],
        usageMetadata: {promptTokenCount: 900, candidatesTokenCount: 120},
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage).toEqual({promptTokens: 900, completionTokens: 120});
    }
  });

  it('reports no usage rather than zero when a provider omits it', async () => {
    const result = await complete(PROVIDERS.groq, 'k', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: respondWith({choices: [{message: {content: 'ok'}}]}),
    });
    expect(result.ok).toBe(true);
    // `null`, not `{0, 0}`: "not reported" and "reported as nothing" are
    // different facts, and a total that treats them the same is a lie.
    if (result.ok) expect(result.usage).toBeNull();
  });

  it("reads Gemini's parts array rather than assuming part 0 is the answer", async () => {
    const result = await complete(spec, 'key', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            candidates: [{content: {parts: [{}, {text: 'the answer'}]}}],
          }),
          {status: 200},
        )) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('the answer');
  });

  it('builds a well-formed request for every registered provider', () => {
    // A provider entry is declarative, so a typo in a URL or a missing header
    // would otherwise only surface as a confusing runtime 4xx. This asserts
    // the shape of each spec instead.
    for (const spec of Object.values(PROVIDERS)) {
      const url = spec.url(spec.defaultModel, 'test-key');
      expect(url, spec.id).toMatch(/^https:\/\//);

      const headers = spec.headers('test-key');
      // Every provider authenticates somehow - either a bearer header or a
      // key embedded in the URL (Gemini's own scheme).
      const usesBearer = headers.Authorization === 'Bearer test-key';
      const usesQueryKey = url.includes('key=test-key');
      expect(usesBearer || usesQueryKey, spec.id).toBe(true);

      const body = spec.body(spec.defaultModel, 'SYSTEM', 'USER') as Record<
        string,
        unknown
      >;
      const serialised = JSON.stringify(body);
      expect(serialised, spec.id).toContain('SYSTEM');
      expect(serialised, spec.id).toContain('USER');
      // The model travels either in the URL (Gemini) or in the body (every
      // OpenAI-compatible provider) - but it has to travel somewhere, or the
      // request silently asks for a provider's default model instead.
      expect(
        url.includes(spec.defaultModel) ||
          serialised.includes(spec.defaultModel),
        spec.id,
      ).toBe(true);
    }
  });

  it('reaches NVIDIA over its OpenAI-compatible endpoint', async () => {
    const spec = PROVIDERS.nvidia;
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const result = await complete(spec, 'nvapi-test', {
      model: spec.defaultModel,
      system: 's',
      user: 'u',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seenUrl = String(url);
        seenHeaders = init.headers as Record<string, string>;
        return new Response(
          JSON.stringify({choices: [{message: {content: 'ok'}}]}),
          {status: 200},
        );
      }) as unknown as typeof fetch,
    });

    expect(seenUrl).toBe(
      'https://integrate.api.nvidia.com/v1/chat/completions',
    );
    expect(seenHeaders.Authorization).toBe('Bearer nvapi-test');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('ok');
  });

  it('sends the key in the URL for Gemini, which does not take a bearer header', async () => {
    let seenUrl = '';
    await complete(spec, 'secret-key', {
      model: 'gemini-3.6-flash',
      system: 's',
      user: 'u',
      fetchImpl: (async (url: string) => {
        seenUrl = String(url);
        return new Response(JSON.stringify({candidates: []}), {status: 200});
      }) as unknown as typeof fetch,
    });
    expect(seenUrl).toContain('key=secret-key');
  });
});

describe('resolveProviderKeys and KeyRotator', () => {
  it('resolves single, comma-separated, plural, and numbered keys without duplicates', () => {
    const spec = PROVIDERS.gemini;

    // Single key
    expect(resolveProviderKeys(spec, {GOOGLE_API_KEY: 'k1'})).toEqual(['k1']);

    // Comma-separated
    expect(resolveProviderKeys(spec, {GOOGLE_API_KEY: 'k1, k2, k3'})).toEqual([
      'k1',
      'k2',
      'k3',
    ]);

    // Plural env var and numbered env vars combined
    const env = {
      GOOGLE_API_KEYS: 'k1, k2',
      GOOGLE_API_KEY: 'k2, k3',
      GOOGLE_API_KEY_1: 'k3',
      GOOGLE_API_KEY_2: 'k4',
    };
    expect(resolveProviderKeys(spec, env)).toEqual(['k1', 'k2', 'k3', 'k4']);
  });

  it('rotates across multiple keys in round-robin and returns false for single key', () => {
    const single = new KeyRotator(['only-one']);
    expect(single.currentKey).toBe('only-one');
    expect(single.rotate()).toBe(false);
    expect(single.currentKey).toBe('only-one');

    const multi = new KeyRotator(['key-a', 'key-b', 'key-c']);
    expect(multi.currentKey).toBe('key-a');
    expect(multi.currentIndex).toBe(0);

    expect(multi.rotate()).toBe(true);
    expect(multi.currentKey).toBe('key-b');
    expect(multi.currentIndex).toBe(1);

    expect(multi.rotate()).toBe(true);
    expect(multi.currentKey).toBe('key-c');
    expect(multi.currentIndex).toBe(2);

    expect(multi.rotate()).toBe(true);
    expect(multi.currentKey).toBe('key-a');
    expect(multi.currentIndex).toBe(0);
  });

  it('rotates API key when encountering HTTP 429 and succeeds on next key', async () => {
    const spec = PROVIDERS.gemini;
    const keys = ['rate-limited-key', 'healthy-key'];
    const rotator = new KeyRotator(keys);

    const attemptedKeys: string[] = [];
    const mockFetch = (async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('rate-limited-key')) {
        attemptedKeys.push('rate-limited-key');
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Rate limit exceeded: Please retry in 5s',
            },
          }),
          {status: 429},
        );
      }
      attemptedKeys.push('healthy-key');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{text: 'success after rotation'}],
              },
            },
          ],
        }),
        {status: 200},
      );
    }) as unknown as typeof fetch;

    // First attempt with key 0 hits 429
    let res = await complete(spec, rotator.currentKey!, {
      model: spec.defaultModel,
      system: 's',
      user: 'u',
      fetchImpl: mockFetch,
    });
    expect(res.ok).toBe(false);
    expect((res as any).kind).toBe('transient');
    expect((res as any).detail).toContain('429');

    // Rotate to next key
    expect(rotator.rotate()).toBe(true);
    expect(rotator.currentKey).toBe('healthy-key');

    // Second attempt with rotated key succeeds!
    res = await complete(spec, rotator.currentKey!, {
      model: spec.defaultModel,
      system: 's',
      user: 'u',
      fetchImpl: mockFetch,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toBe('success after rotation');
    }
    expect(attemptedKeys).toEqual(['rate-limited-key', 'healthy-key']);
  });
});

describe('streamed replies', () => {
  it('asks an OpenAI-compatible provider to stream and gathers the reply', async () => {
    let sent: Record<string, unknown> = {};
    const events = [
      {choices: [{delta: {reasoning_content: 'thinking '}}]},
      {choices: [{delta: {reasoning_content: 'hard'}}]},
      {choices: [{delta: {content: '{"version"'}}]},
      {choices: [{delta: {content: ': 1}'}, finish_reason: 'stop'}]},
      {choices: [], usage: {prompt_tokens: 900, completion_tokens: 40}},
    ];
    const body =
      events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') +
      'data: [DONE]\n\n';
    const result = await complete(PROVIDERS.apmix, 'k', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(body, {
          status: 200,
          headers: {'content-type': 'text/event-stream'},
        });
      }) as unknown as typeof fetch,
    });
    expect(sent.stream).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{"version": 1}');
      expect(result.usage).toEqual({promptTokens: 900, completionTokens: 40});
    }
  });

  it('reports an error sent inside the stream', async () => {
    const result = await complete(PROVIDERS.apmix, 'k', {
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () =>
        new Response(
          `data: ${JSON.stringify({error: {message: 'upstream overloaded'}})}\n\n`,
          {status: 200, headers: {'content-type': 'text/event-stream'}},
        )) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
  });
});
