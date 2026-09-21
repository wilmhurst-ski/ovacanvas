import {fileURLToPath} from 'url';
import {
  INTENT_COMPILER_DOMAINS,
  selectStrategy,
} from '../authoring/strategies/registry';
import {authorWithRetry} from '../authoringPipeline';
import {selectProvider} from '../providers';
import {buildVerifiedApiSection} from '../systemPrompt';
import {reviewFrame} from '../visionAdvisory';

/**
 * The authoring half of the MVP, served from the dev server.
 *
 * @remarks
 * It lives on this side of the wire on purpose. The API key must never reach
 * the browser, and neither can the compiler: `compileBeatModule` needs
 * `ts.sys` and the real filesystem, which a browser does not have. So the
 * server owns "ask the model, compile what it wrote, retry with the real
 * error", and hands the browser nothing but a compiled module - which the
 * browser turns into a beat with `resolveBeatSource` against its own live
 * engine instance.
 *
 * `packages/host` is the compile root because it has `@ovacanvas/2d` and
 * `@ovacanvas/core` as real dependencies, so a generated module's imports
 * resolve exactly as they would in any consuming project.
 */
const COMPILE_ROOT = fileURLToPath(new URL('../../../host', import.meta.url));

/** The subset of connect's middleware surface this needs. */
export interface MiddlewareStack {
  use(
    route: string,
    handler: (request: any, response: any, next: () => void) => void,
  ): void;
}

interface GenerateRequest {
  topic?: unknown;
  existingSource?: unknown;
  provider?: unknown;
  model?: unknown;
  /** Advisory findings from the beat already on screen, to re-author against. */
  feedback?: unknown;
}

/**
 * A rendered 1920x1080 PNG is a couple of megabytes base64-encoded, so the
 * review endpoint needs real headroom - but not unlimited: an unbounded body
 * reader is a memory-exhaustion hole, and this server is reachable from the
 * page.
 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeded ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

export function registerAuthoringRoutes(
  middlewares: MiddlewareStack,
  env: Record<string, string>,
): void {
  // Built once, from the engine's real declarations - not per request, and
  // not per attempt.
  const apiSection = buildVerifiedApiSection({resolveFrom: COMPILE_ROOT});

  middlewares.use('/api/health', (_request, response) => {
    const spec = selectProvider(undefined, env);
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        provider: spec.id,
        // The effective model, not the spec's default: reporting the default
        // while the pipeline actually calls something else is how a health
        // check tells you the wrong thing.
        model: env.OVACANVAS_MODEL ?? spec.defaultModel,
        hasKey: Boolean(env[spec.envKey]),
        apiSectionCharacters: apiSection.length,
        intentCompilerDomains: INTENT_COMPILER_DOMAINS.map(domain => domain.id),
      }),
    );
  });

  /**
   * The advisory vision review.
   *
   * @remarks
   * The frame has to travel here because the key cannot travel the other way.
   * Findings come back as advisory and are never allowed to affect whether the
   * beat is shown - the client routes them into a re-authoring pass, which is
   * the only thing an opinion is allowed to influence.
   */
  middlewares.use('/api/review', async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method !== 'POST') {
      response.statusCode = 405;
      return response.end(JSON.stringify({ok: false, detail: 'POST only'}));
    }

    let body: {image?: {mimeType?: unknown; base64?: unknown}};
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch (error) {
      response.statusCode = 400;
      return response.end(
        JSON.stringify({
          ok: false,
          detail:
            error instanceof Error ? error.message : 'body was not valid JSON',
        }),
      );
    }

    const image = body.image;
    if (
      !image ||
      typeof image.base64 !== 'string' ||
      typeof image.mimeType !== 'string'
    ) {
      response.statusCode = 400;
      return response.end(
        JSON.stringify({
          ok: false,
          detail: 'an image with mimeType and base64 is required',
        }),
      );
    }

    try {
      const findings = await reviewFrame(
        {mimeType: image.mimeType, base64: image.base64},
        {env},
      );
      return response.end(JSON.stringify({ok: true, findings}));
    } catch (error) {
      // Reported as a failed review, not as an empty one: a caller that
      // cannot tell those apart will believe a broken review found nothing.
      return response.end(
        JSON.stringify({
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  middlewares.use('/api/generate', async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method !== 'POST') {
      response.statusCode = 405;
      return response.end(JSON.stringify({ok: false, detail: 'POST only'}));
    }

    let body: GenerateRequest;
    try {
      body = (await readJsonBody(request)) as GenerateRequest;
    } catch {
      response.statusCode = 400;
      return response.end(
        JSON.stringify({ok: false, detail: 'body was not valid JSON'}),
      );
    }

    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (!topic) {
      response.statusCode = 400;
      return response.end(
        JSON.stringify({ok: false, detail: 'a topic is required'}),
      );
    }

    try {
      // Strategy choice is per topic, and the reason is returned to the client
      // so a run can be explained rather than just observed.
      const selection = selectStrategy(topic);
      console.log(
        `[authoringApi] /api/generate starting for: "${topic}" (${selection.strategy.id})`,
      );
      const outcome = await authorWithRetry({
        topic,
        existingSource:
          typeof body.existingSource === 'string'
            ? body.existingSource
            : undefined,
        strategy: selection.strategy,
        apiSection,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        initialFeedback:
          typeof body.feedback === 'string' && body.feedback.trim()
            ? body.feedback
            : undefined,
        projectRoot: COMPILE_ROOT,
        env,
      });
      console.log(
        `[authoringApi] /api/generate finished: ok=${outcome.ok} strategy=${outcome.strategy} provider=${outcome.provider} attempts=${outcome.ok ? outcome.attempts : outcome.reason}`,
      );
      if (!outcome.ok) {
        console.log(
          '[authoringApi] Failure log:',
          JSON.stringify(outcome.log, null, 2),
        );
      }
      return response.end(
        JSON.stringify({...outcome, strategyReason: selection.reason}),
      );
    } catch (error) {
      response.statusCode = 500;
      return response.end(
        JSON.stringify({
          ok: false,
          reason: 'server-error',
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

export {COMPILE_ROOT};
