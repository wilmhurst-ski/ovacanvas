import type {AuditFinding} from '@ovacanvas/2d';
import {
  completeVision,
  selectProvider,
  type InlineImage,
  type ProviderSpec,
} from './providers';

/**
 * The advisory vision review: hand the rendered frame to a vision-capable
 * model and ask whether it actually reads well.
 *
 * @remarks
 * This is the one check in the whole product that judges *meaning* rather than
 * geometry, and it is deliberately the weakest one in authority. It is
 * advisory and can never block - see `BeatManifest.advisoryCheck` and
 * `BeatAdapter`'s own remarks. The reasoning is not caution for its own sake:
 * a vision model can hallucinate a defect that is not there, and a
 * hallucinated judgement encoded as a gate would eventually refuse a
 * perfectly good scene. Geometry is certain and may refuse; taste is not and
 * may only suggest.
 *
 * It runs **server-side**, and that is an architectural constraint rather than
 * a convenience: the frame has to leave the browser to be reviewed, and the
 * API key must never be in the browser. So the client posts the canvas here
 * and gets findings back - the browser never holds a credential.
 *
 * Every failure throws rather than returning an empty list. `BeatAdapter`
 * catches and logs, and the beat is unaffected either way; the difference is
 * that a broken review is visible in the log instead of looking exactly like
 * a review that found nothing.
 */

export const VISION_REVIEW_SYSTEM_PROMPT = `You are reviewing one rendered frame of a short animated explanation shown to a learner on a 1920x1080 canvas.

Report ONLY problems that would genuinely make it harder to understand. Judge what you can see: is the content readable, is anything visually confusing or ambiguous, does the layout look deliberate or accidental, is the most important thing the most prominent.

Do NOT report:
- anything about animation, motion, or timing - you are looking at a single still frame and cannot see them;
- stylistic preferences, or anything you would describe as "could be nicer";
- problems with the mathematics or the subject matter itself;
- anything you cannot point at in the image.

Output ONLY a JSON array. Each element must be {"ruleId": "kebab-case-id", "message": "one specific sentence naming what is wrong and where"}.

If the frame reads well, output exactly: []`;

export interface VisionReviewOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly provider?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Injected so the parsing and failure paths can be tested without a network. */
  readonly fetchImpl?: typeof fetch;
  readonly providerSpec?: ProviderSpec;
}

/** Parse the model's reply into findings, tolerating a fenced or chatty answer. */
export function parseReviewFindings(raw: string): AuditFinding[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new Error(
      `the vision review did not return a JSON array: ${raw.slice(0, 200)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `the vision review returned malformed JSON (${
        error instanceof Error ? error.message : String(error)
      }): ${raw.slice(start, start + 200)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('the vision review did not return a JSON array');
  }

  return parsed
    .filter(
      (entry): entry is {ruleId: string; message: string} =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as {message?: unknown}).message === 'string' &&
        (entry as {message: string}).message.trim().length > 0,
    )
    .map(entry => ({
      // Namespaced so a review finding is never mistaken for one of the
      // geometry rules in a report, or filtered out by a caller matching on
      // the audit's own rule ids.
      ruleId: `vision:${typeof entry.ruleId === 'string' && entry.ruleId.trim() ? entry.ruleId.trim() : 'review'}`,
      // Forced here as well as in `BeatAdapter`, because this is the layer
      // that knows what it is: an opinion.
      severity: 'advisory' as const,
      entities: [],
      message: entry.message.trim(),
    }));
}

export async function reviewFrame(
  image: InlineImage,
  options: VisionReviewOptions = {},
): Promise<AuditFinding[]> {
  const env = options.env ?? process.env;
  const spec = options.providerSpec ?? selectProvider(options.provider, env);
  const apiKey = env[spec.envKey];

  if (!apiKey) {
    throw new Error(`${spec.envKey} is not set - cannot run a vision review`);
  }
  if (!spec.bodyWithImage) {
    throw new Error(`provider "${spec.id}" has no vision model configured`);
  }

  const result = await completeVision(spec, apiKey, {
    model: options.model ?? spec.defaultModel,
    system: VISION_REVIEW_SYSTEM_PROMPT,
    user: 'Review this frame.',
    image,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  if (!result.ok) {
    throw new Error(
      `the vision review call failed (${result.kind}): ${result.detail}`,
    );
  }
  return parseReviewFindings(result.text);
}
