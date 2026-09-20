import type {AuditFinding} from '@ovacanvas/2d';
import type {BeatManifest} from '@ovacanvas/host';
import {
  LessonHost,
  createFallbackBeat,
  resolveBeatSource,
} from '@ovacanvas/host';
import {RunTelemetry, STAGE} from '../telemetry';

/**
 * The learner's side of the MVP.
 *
 * @remarks
 * This page never talks to a model and never holds a key. It asks the server
 * for an already-compiled beat module, resolves that module against this
 * page's own live engine instance, and hands it to the host - which renders
 * it offstage, audits its real geometry, repairs it if it can, and only then
 * makes it visible. The opener beat goes up first, so there is always
 * something on screen while the real beat is being authored.
 *
 * It also closes the advisory loop. A beat that is geometrically correct but
 * badly composed is never refused - the composition checks cannot block by
 * design - so the only way their findings change anything is by being handed
 * back as a reason to try again. That happens here, once per question, and
 * the second answer is accepted whatever the checks say about it.
 */

const stageElement = document.getElementById('stage') as HTMLElement;
const form = document.getElementById('ask') as HTMLFormElement;
const questionInput = document.getElementById('question') as HTMLInputElement;
const askButton = document.getElementById('ask-button') as HTMLButtonElement;
const statusText = document.getElementById('status') as HTMLElement;
const statusMeta = document.getElementById('meta') as HTMLElement;
const statusDot = document.getElementById('dot') as HTMLElement;

let host: LessonHost | null = null;
let currentSource: string | undefined;
let beatCount = 0;

/**
 * The advisory vision review, on demand.
 *
 * @remarks
 * Off unless the page is opened with `?review=1`, because it spends a second
 * model call per beat and its result can only ever suggest a re-composition -
 * it is the least load-bearing check in the product, and making it the
 * default would cost every learner a call for a judgement they may not want.
 *
 * It posts the rendered frame to this app's own server, which holds the key.
 * Throwing on failure is deliberate: `BeatAdapter` catches and logs it, and a
 * review that silently returned "no findings" would be indistinguishable from
 * a review that never ran.
 */
const visionReviewEnabled = new URLSearchParams(window.location.search).has(
  'review',
);

/**
 * Timing for the interaction in progress, measured from the learner's clock.
 *
 * @remarks
 * The MVP bar names a number - time to first visual, 4s soft and 8s hard - and
 * says to instrument it rather than estimate it. This is that instrument, and
 * it deliberately starts when the learner submits rather than when a request
 * goes out: a stage that is fast on the server but slow to reach the screen is
 * exactly what a learner experiences and exactly what this is for.
 *
 * Exposed on `window` so a test can read the real numbers instead of a
 * developer reading a stopwatch, and printed to the console on every
 * interaction so a regression is visible during ordinary use rather than only
 * in CI.
 */
const telemetry = new RunTelemetry();
const telemetryVisible = new URLSearchParams(window.location.search).has(
  'telemetry',
);

declare global {
  interface Window {
    ovcTelemetry: RunTelemetry;
  }
}
window.ovcTelemetry = telemetry;

function reportTimings(): void {
  const {latest} = telemetry.summary();
  const line = latest
    .map(sample => `${sample.stage} ${sample.ms}ms`)
    .join(' · ');
  // eslint-disable-next-line no-console
  console.info(`[ovc] ${line}`);
  if (telemetryVisible) {
    statusMeta.textContent = line;
  }
}

async function reviewFrame(
  canvas: HTMLCanvasElement,
): Promise<readonly AuditFinding[]> {
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const response = await fetch('/api/review', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({image: {mimeType: 'image/png', base64}}),
  });
  const payload = (await response.json()) as {
    ok: boolean;
    findings?: AuditFinding[];
    detail?: string;
  };
  if (!payload.ok)
    {throw new Error(payload.detail ?? 'the vision review failed');}
  return payload.findings ?? [];
}

function setStatus(
  state: 'idle' | 'working' | 'ok' | 'warn' | 'error',
  message: string,
  meta = '',
): void {
  statusDot.dataset.state = state;
  statusText.textContent = message;
  statusMeta.textContent = meta;
}

interface GenerateOutcome {
  ok: boolean;
  source?: string;
  code?: string;
  attempts?: number;
  repaired?: boolean;
  provider?: string;
  model?: string;
  strategy?: string;
  reason?: string;
  detail?: string;
}

async function generate(
  topic: string,
  feedback?: string,
): Promise<GenerateOutcome> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({topic, existingSource: currentSource, feedback}),
  });
  return (await response.json()) as GenerateOutcome;
}

/**
 * Advisory findings on the beat that is currently on screen.
 *
 * @remarks
 * Read back from the adapter's own report rather than recomputed, so what is
 * acted on is exactly what the gate saw.
 */
function advisoryFindings(): AuditFinding[] {
  if (!host) return [];
  const generation = host.status().activeGeneration;
  if (generation === null) return [];
  const report = host.lastReportFor(generation);
  if (!report) return [];
  return report.findings.filter(finding => finding.severity === 'advisory');
}

function describeAdvisory(findings: readonly AuditFinding[]): string {
  return (
    'The scene rendered correctly and passed every blocking check, but it was composed poorly. ' +
    'Keep the same content and fix the layout:\n' +
    findings.map(finding => `- ${finding.message}`).join('\n')
  );
}

/**
 * One sentence a learner can read, in place of a provider's error envelope.
 *
 * @remarks
 * Deliberately says what happened *and* that a fallback is on screen, because
 * the second half is the part that matters to someone who just asked a
 * question: the product's whole promise is that they are never left looking at
 * nothing, and a bare failure message does not communicate that.
 */
function readableReason(outcome: {reason?: string; detail?: string}): string {
  switch (outcome.reason) {
    case 'no-provider-key':
      return 'No explanation service is configured, so here is a simpler version.';
    case 'unrecoverable-provider':
      return 'The explanation service is unavailable right now, so here is a simpler version.';
    case 'attempts-exhausted':
      return /without ever returning an answer/i.test(outcome.detail ?? '')
        ? 'The explanation service did not respond, so here is a simpler version.'
        : 'The explanation it produced did not pass its checks, so here is a simpler version.';
    default:
      return 'That one could not be explained, so here is a simpler version.';
  }
}

/**
 * Put a host-authored beat up when authoring could not produce one.
 *
 * @remarks
 * "The previous beat is still on screen" is not an answer to a learner who
 * just asked a question and got no response to it. This beat is written in
 * `@ovacanvas/host`, needs no model, always compiles, and goes through the
 * same audit gate as everything else - so at the one moment in the pipeline
 * where nothing generated can be relied on, something certain still reaches
 * the screen.
 */
async function showFallback(topic: string, why: string): Promise<void> {
  if (!host) return;
  try {
    const staged = await host.stage({beat: createFallbackBeat(topic)});
    if (staged.ok) {
      host.activate();
      host.retireOutgoing();
    }
  } catch {
    // Nothing further to try - the status line below still reports the
    // original failure, which is the part a learner can act on.
  }
  setStatus('warn', why, 'a fallback explanation is on screen');
}

/**
 * Author one beat and put it on screen.
 *
 * @remarks
 * `compositionPass` allows exactly one re-author against advisory findings.
 * It is deliberately a single extra pass rather than a loop: composition is a
 * judgement, and a loop against a judgement is how a system ends up
 * oscillating between two acceptable layouts while the learner waits.
 */
async function authorInto(
  topic: string,
  feedback: string | undefined,
  compositionPass: boolean,
  submittedAt: number | null = null,
): Promise<void> {
  if (!host) return;

  setStatus(
    'working',
    feedback ? 'Tightening the layout…' : 'Writing an explanation…',
  );
  telemetry.start(STAGE.authoring);
  const outcome = await generate(topic, feedback);
  telemetry.finish(STAGE.authoring);

  if (!outcome.ok || !outcome.code) {
    // The raw detail goes to the console, not to the learner. It is a JSON
    // envelope full of rate-limit URLs and internal status codes, and putting
    // it in the status bar wrapped it across three lines and pushed the
    // fallback note out of the footer entirely - which is how it looked the
    // first time this path was read by a human rather than asserted on.
    // eslint-disable-next-line no-console
    console.warn(
      `[ovc] authoring failed (${outcome.reason}): ${outcome.detail ?? 'no detail'}`,
    );
    await showFallback(topic, readableReason(outcome));
    return;
  }

  setStatus('working', 'Checking the result before showing it…');
  const id = `beat-${++beatCount}`;
  telemetry.start(STAGE.resolve);
  const resolved = await resolveBeatSource(id, topic, outcome.code);
  telemetry.finish(STAGE.resolve);

  const manifest: BeatManifest = visionReviewEnabled
    ? {...resolved, advisoryCheck: reviewFrame}
    : resolved;

  telemetry.start(STAGE.stageAndAudit);
  const staged = await host.stage({beat: manifest});
  telemetry.finish(STAGE.stageAndAudit);

  if (!staged.ok) {
    // Authored and compiled, but its own rendered geometry did not pass the
    // audit and could not be repaired - so it is refused rather than shown.
    // This is the product's whole promise, made visible.
    await showFallback(
      topic,
      staged.reason === 'not-ready'
        ? 'The generated scene did not pass its own geometry audit, so it was not shown.'
        : `The generated beat was refused (${staged.reason}).`,
    );
    return;
  }

  host.activate();
  host.retireOutgoing();
  currentSource = outcome.source;

  // From the learner's submission, not from the request - the number the MVP
  // bar actually names.
  if (submittedAt !== null) {
    telemetry.record(STAGE.beatVisible, performance.now() - submittedAt);
  }

  if (compositionPass) {
    const advisory = advisoryFindings();
    if (advisory.length > 0) {
      await authorInto(topic, describeAdvisory(advisory), false, submittedAt);
      return;
    }
  }

  // A deterministic solve has no provider and no attempts, and printing
  // "none · 0 attempts" describes the absence of something rather than what
  // happened. It is also the case worth advertising: this beat cost nothing
  // and could not have failed on a rate limit.
  const notes = outcome.deterministic
    ? ['solved in code', outcome.strategy]
    : [
        outcome.provider,
        outcome.strategy,
        `${outcome.attempts} attempt${outcome.attempts === 1 ? '' : 's'}`,
      ];
  if (outcome.repaired) notes.push('mechanically repaired');
  if (!compositionPass) notes.push('re-composed');
  setStatus('ok', 'On screen.', notes.filter(Boolean).join(' · '));
  reportTimings();
}

async function ask(topic: string): Promise<void> {
  askButton.disabled = true;
  try {
    // The learner's clock starts here, not when a request goes out.
    telemetry.reset();
    const submittedAt = performance.now();

    // A fresh lesson per question: the opener restates the question and is
    // audited and on screen in well under a second, which is the whole
    // latency trick - the learner is never looking at a blank stage.
    host?.dispose();
    currentSource = undefined;
    host = new LessonHost('lesson', topic, stageElement);

    const started = await host.start();
    if (!started.ok) {
      setStatus(
        'error',
        `the opener beat could not be staged (${started.reason})`,
      );
      return;
    }
    telemetry.record(STAGE.openerVisible, performance.now() - submittedAt);
    reportTimings();

    await authorInto(topic, undefined, true, submittedAt);
  } catch (error) {
    setStatus(
      'error',
      error instanceof Error ? error.message : String(error),
      'the opener is still on screen',
    );
  } finally {
    askButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const topic = questionInput.value.trim();
  if (topic) void ask(topic);
});

// Fail loudly at load rather than silently doing nothing if the server has no
// usable provider configured - a missing key is worth knowing about before a
// learner types a question.
void fetch('/api/health')
  .then(response => response.json())
  .then((health: {provider: string; model: string; hasKey: boolean}) => {
    if (!health.hasKey) {
      setStatus(
        'warn',
        `No API key found for provider "${health.provider}" - set its key in packages/studio/.env.local.`,
      );
    } else {
      setStatus('idle', `Ready. Using ${health.provider} (${health.model}).`);
    }
  })
  .catch(() => setStatus('error', 'The authoring server is not reachable.'));
