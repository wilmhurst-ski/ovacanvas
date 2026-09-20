/**
 * Provider-agnostic LLM access.
 *
 * @remarks
 * Every provider is a declarative `ProviderSpec` - URL, headers, request body,
 * response extraction - and one shared `complete()` does the fetching,
 * timeout, and error classification for all of them. Adding a fifth provider
 * is one entry in `PROVIDERS`, not a new code path, which is the property the
 * project's own prior work identified as the thing that made multi-provider
 * support cheap.
 *
 * Nothing here is built around any single vendor. Gemini is the default
 * because it was measured to be the most reliable for this task, but it is a
 * registry entry like every other provider, selected by name, and the whole
 * pipeline downstream of it only ever sees a string of TypeScript.
 */

export interface ProviderSpec {
  readonly id: string;
  /** Environment variable holding this provider's key. */
  readonly envKey: string;
  /** Used when the caller does not name a model. */
  readonly defaultModel: string;
  /**
   * The request URL. Takes the key because not every provider puts it in a
   * header - Gemini's own endpoint wants it as a query parameter.
   */
  readonly url: (model: string, apiKey: string) => string;
  readonly headers: (apiKey: string) => Record<string, string>;
  readonly body: (model: string, system: string, user: string) => unknown;
  /**
   * The same request, carrying an image. Absent on providers with no vision
   * model, so a caller can tell "this provider cannot see" from "the call
   * failed" - and say so, rather than silently returning no findings.
   */
  readonly bodyWithImage?: (
    model: string,
    system: string,
    user: string,
    image: InlineImage,
  ) => unknown;
  /** Pull the assistant's text out of this provider's response envelope. */
  readonly extract: (payload: unknown) => string;
  /**
   * Tokens actually billed for this request, when the provider reports them.
   *
   * @remarks
   * Deliberately raw counts rather than a cost. Turning tokens into money
   * needs per-model pricing, which changes without notice and which this
   * project has no trustworthy source for - inventing a rate card would make
   * every cost figure it produced quietly wrong. A real token count lets
   * whoever owns the account apply their own rates and be right.
   */
  readonly extractUsage?: (payload: unknown) => TokenUsage | null;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Add two usage reports, treating "not reported" as absent rather than zero.
 *
 * @remarks
 * A provider that reports usage on one attempt and not the next must not turn
 * the run's total into `NaN`, and `undefined` is normalised to `null` so a
 * caller has one absent value to check rather than two.
 */
function addUsage(
  a: TokenUsage | null | undefined,
  b: TokenUsage | null | undefined,
): TokenUsage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

export {addUsage as sumUsage};

/** Read a usage block, tolerating a provider that omits or malforms it. */
function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** An image small enough to travel inside a request body. */
export interface InlineImage {
  readonly mimeType: string;
  /** Base64, without a data-URL prefix. */
  readonly base64: string;
}

export type ProviderFailureKind =
  /** Retrying cannot help: the key/account itself is the problem. */
  | 'unrecoverable'
  /** Worth one more try: a network blip, a rate limit, a 5xx. */
  | 'transient'
  /** The request succeeded but carried no usable text. */
  | 'empty';

export interface ProviderSuccess {
  readonly ok: true;
  readonly text: string;
  /** `null` when the provider did not report usage for this call. */
  readonly usage: TokenUsage | null;
}

export interface ProviderFailure {
  readonly ok: false;
  readonly kind: ProviderFailureKind;
  readonly detail: string;
}

export type ProviderResult = ProviderSuccess | ProviderFailure;

/** OpenAI-compatible chat-completions shape, shared by most providers here. */
function openAiCompatible(url: string) {
  return {
    url: () => url,
    headers: (apiKey: string) => ({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (model: string, system: string, user: string) => ({
      model,
      messages: [
        {role: 'system', content: system},
        {role: 'user', content: user},
      ],
      max_tokens: 16000,
      temperature: 0.4,
    }),
    // The OpenAI vision shape: the user turn becomes a content array holding
    // both the text and a data-URL image.
    bodyWithImage: (
      model: string,
      system: string,
      user: string,
      image: InlineImage,
    ) => ({
      model,
      messages: [
        {role: 'system', content: system},
        {
          role: 'user',
          content: [
            {type: 'text', text: user},
            {
              type: 'image_url',
              image_url: {url: `data:${image.mimeType};base64,${image.base64}`},
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
    extract: (payload: unknown): string => {
      const choices = (
        payload as {choices?: Array<{message?: {content?: string}}>}
      ).choices;
      return choices?.[0]?.message?.content ?? '';
    },
    extractUsage: (payload: unknown): TokenUsage | null => {
      const usage = (
        payload as {
          usage?: {prompt_tokens?: unknown; completion_tokens?: unknown};
        }
      ).usage;
      if (!usage) return null;
      return {
        promptTokens: numeric(usage.prompt_tokens),
        completionTokens: numeric(usage.completion_tokens),
      };
    },
  };
}

export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = {
  gemini: {
    id: 'gemini',
    envKey: 'GOOGLE_API_KEY',
    // Model IDs retire; this is a default, not a commitment - override it per
    // call or with OVACANVAS_MODEL rather than editing code.
    defaultModel: 'gemini-3.6-flash',
    url: (model, apiKey) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: () => ({'Content-Type': 'application/json'}),
    // Gemini takes the key as a query parameter, not a bearer header.
    body: (model, system, user) => ({
      systemInstruction: {parts: [{text: system}]},
      contents: [{role: 'user', parts: [{text: user}]}],
      generationConfig: {maxOutputTokens: 16000, temperature: 0.4},
    }),
    // Gemini carries the image as an inline part alongside the text.
    bodyWithImage: (model, system, user, image) => ({
      systemInstruction: {parts: [{text: system}]},
      contents: [
        {
          role: 'user',
          parts: [
            {text: user},
            {inline_data: {mime_type: image.mimeType, data: image.base64}},
          ],
        },
      ],
      generationConfig: {maxOutputTokens: 4000, temperature: 0.2},
    }),
    extract: (payload: unknown): string => {
      const candidates = (
        payload as {
          candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>;
        }
      ).candidates;
      // A part can be a reasoning summary with no `text` at all, so join only
      // the parts that carry text rather than assuming part 0 is the answer.
      return (candidates?.[0]?.content?.parts ?? [])
        .map(part => part.text ?? '')
        .join('');
    },
    // Gemini reports usage under its own names, not the OpenAI ones.
    extractUsage: (payload: unknown): TokenUsage | null => {
      const usage = (
        payload as {
          usageMetadata?: {
            promptTokenCount?: unknown;
            candidatesTokenCount?: unknown;
          };
        }
      ).usageMetadata;
      if (!usage) return null;
      return {
        promptTokens: numeric(usage.promptTokenCount),
        completionTokens: numeric(usage.candidatesTokenCount),
      };
    },
  },
  openrouter: {
    id: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat',
    ...openAiCompatible('https://openrouter.ai/api/v1/chat/completions'),
  },
  groq: {
    id: 'groq',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    ...openAiCompatible('https://api.groq.com/openai/v1/chat/completions'),
  },
  huggingface: {
    id: 'huggingface',
    envKey: 'HUGGINGFACE_API_KEY',
    defaultModel: 'Qwen/Qwen3.8-27B',
    ...openAiCompatible('https://router.huggingface.co/v1/chat/completions'),
  },
  tokenharbor: {
    id: 'tokenharbor',
    envKey: 'TOKENHARBOR_API_KEY',
    /**
     * **Unverified.** Token Harbor's catalogue carries a `tokenharbor/` prefix
     * (their own docs use `tokenharbor/qwen3-max`), and this is the model named
     * when the key was supplied - but the exact id could not be confirmed,
     * because the host is unreachable from the machine this was written on
     * (ports 80 and 443 time out; `GET /v1/models` is the authority). Check it
     * against `/v1/models` and override with `OVACANVAS_MODEL` rather than
     * editing this, if it is wrong.
     */
    defaultModel: 'tokenharbor/deepseek-v4.1-flash',
    ...openAiCompatible('https://tokenharbor.ai/v1/chat/completions'),
  },
  nvidia: {
    id: 'nvidia',
    envKey: 'NVIDIA_API_KEY',
    // NVIDIA's own flagship, on the reasoning that an NVIDIA-issued key is
    // most likely to be entitled to NVIDIA's own models. The catalogue also
    // carries third-party models (DeepSeek, Kimi, GLM, gpt-oss) reachable
    // through the same endpoint.
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    ...openAiCompatible('https://integrate.api.nvidia.com/v1/chat/completions'),
  },
};

/** The provider a run should use, and where that choice came from. */
export function selectProvider(
  requested?: string,
  env: NodeJS.ProcessEnv = process.env,
): ProviderSpec {
  const configured = requested ?? env.OVACANVAS_PROVIDER;
  if (configured) {
    const spec = PROVIDERS[configured];
    if (!spec) {
      throw new Error(
        `unknown provider "${configured}" - known providers: ${Object.keys(PROVIDERS).join(', ')}`,
      );
    }
    return spec;
  }
  // Prefer whichever provider actually has a key, in a fixed order, so a
  // missing key never turns into a confusing auth failure later.
  const withKey = Object.values(PROVIDERS).find(spec => env[spec.envKey]);
  return withKey ?? PROVIDERS.gemini;
}

/**
 * A bare `fetch` rejection (DNS, dropped connection) is never an HTTP error
 * response, so it is classified separately - it means the request never
 * reached the provider, and spending a content attempt on it would waste one.
 */
const TRANSIENT_HTTP = new Set([408, 409, 425, 500, 502, 503, 504]);

const UNRECOVERABLE_PATTERN =
  /billing|insufficient|invalid api key|api key not valid|permission denied|unauthor|forbidden|account suspended|account disabled/i;

export function classifyHttpFailure(
  status: number,
  detail: string,
): ProviderFailure {
  // Identity and account failures fail identically on every retry, so
  // confirming that repeatedly only costs time and budget.
  if (status === 401 || status === 402 || status === 403) {
    return {
      ok: false,
      kind: 'unrecoverable',
      detail: `HTTP ${status}: ${detail}`,
    };
  }

  // A 429 is a RATE limit, and rate limits reset - the provider's own body
  // says when ("Please retry in 10.4s"). Classifying it by its wording was a
  // real, observed bug: a free-tier per-minute limit contains the word
  // "quota", so a run that would have succeeded seconds later was abandoned
  // as unrecoverable. Still bounded - it draws on the smaller infra budget
  // rather than the content budget, so it can never loop.
  if (status === 429) {
    return {
      ok: false,
      kind: 'transient',
      detail: `HTTP 429 (rate limited): ${detail}`,
    };
  }

  if (UNRECOVERABLE_PATTERN.test(detail)) {
    return {
      ok: false,
      kind: 'unrecoverable',
      detail: `HTTP ${status}: ${detail}`,
    };
  }
  if (TRANSIENT_HTTP.has(status) || status >= 500) {
    return {ok: false, kind: 'transient', detail: `HTTP ${status}: ${detail}`};
  }
  // Any other 4xx is a malformed request this pipeline built - retrying the
  // identical request would produce the identical response, so it is
  // unrecoverable rather than transient.
  return {
    ok: false,
    kind: 'unrecoverable',
    detail: `HTTP ${status}: ${detail}`,
  };
}

export interface CompleteOptions {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly timeoutMs?: number;
  /** Injected so tests can drive the failure paths without a network. */
  readonly fetchImpl?: typeof fetch;
}

/** Generous enough for a slow generation, bounded so a silent provider cannot hang the UI. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90000;

/**
 * The transport every provider call shares: one POST, a timeout, and a
 * classification of whatever comes back.
 *
 * @remarks
 * Shared deliberately rather than duplicated per entry point. Every rule here
 * - the timeout, the unrecoverable/transient split, treating a transport
 * failure as transient rather than as a provider verdict - is a rule that was
 * learned once and must not drift between the text path and the vision path.
 */
async function sendRequest(
  spec: ProviderSpec,
  apiKey: string,
  model: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: typeof fetch | undefined,
): Promise<{ok: true; payload: unknown} | ProviderFailure> {
  const doFetch = fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(spec.url(model, apiKey), {
      method: 'POST',
      headers: spec.headers(apiKey),
      body: JSON.stringify(body),
      // A provider that never responds is indistinguishable from one that is
      // about to, unless a timeout is set - a real incident in this project's
      // history hung for four minutes with no response at all.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'transient',
      detail: `request failed before a response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return classifyHttpFailure(response.status, detail.slice(0, 600));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      kind: 'transient',
      detail: `response was not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // Some providers report a failure inside a 200 with an `error` envelope.
  const envelopeError = (payload as {error?: {message?: string} | string})
    .error;
  if (envelopeError) {
    const detail =
      typeof envelopeError === 'string'
        ? envelopeError
        : (envelopeError.message ?? '');
    return classifyHttpFailure(response.status, detail);
  }

  return {ok: true, payload};
}

function toResult(payload: unknown, spec: ProviderSpec): ProviderResult {
  const text = spec.extract(payload);
  if (!text.trim()) {
    return {ok: false, kind: 'empty', detail: 'the provider returned no text'};
  }
  let usage: TokenUsage | null = null;
  try {
    usage = spec.extractUsage?.(payload) ?? null;
  } catch {
    // Usage is a reporting nicety; a provider that reports it oddly must not
    // turn a perfectly good generation into a failure.
    usage = null;
  }
  return {ok: true, text, usage};
}

export async function complete(
  spec: ProviderSpec,
  apiKey: string,
  options: CompleteOptions,
): Promise<ProviderResult> {
  const sent = await sendRequest(
    spec,
    apiKey,
    options.model,
    spec.body(options.model, options.system, options.user),
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    options.fetchImpl,
  );
  if (!sent.ok) return sent;
  return toResult(sent.payload, spec);
}

export interface CompleteVisionOptions extends CompleteOptions {
  readonly image: InlineImage;
}

/**
 * The same call, carrying a rendered frame.
 *
 * @remarks
 * A provider without `bodyWithImage` reports `unrecoverable` rather than
 * `transient`: no number of retries will give a text-only model eyes, and
 * saying so plainly is what lets a caller tell "this provider cannot review
 * images" apart from "the review failed".
 */
export async function completeVision(
  spec: ProviderSpec,
  apiKey: string,
  options: CompleteVisionOptions,
): Promise<ProviderResult> {
  if (!spec.bodyWithImage) {
    return {
      ok: false,
      kind: 'unrecoverable',
      detail: `provider "${spec.id}" has no vision model configured`,
    };
  }
  const sent = await sendRequest(
    spec,
    apiKey,
    options.model,
    spec.bodyWithImage(
      options.model,
      options.system,
      options.user,
      options.image,
    ),
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    options.fetchImpl,
  );
  if (!sent.ok) return sent;
  return toResult(sent.payload, spec);
}

/** Strip a markdown fence a model wrapped its module in. */
export function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:tsx?|typescript)?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
}
