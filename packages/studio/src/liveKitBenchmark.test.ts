import {isLessonDocument} from '@ovacanvas/wire';
import {PreviewRenderer} from '@ovacanvas/wire/node';
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {afterAll, describe, expect, it} from 'vitest';
import {
  sceneDocument,
  sceneDocumentPlain,
} from './authoring/strategies/sceneDocument';
import type {AuthoringStrategy} from './authoring/strategies/types';
import {authorWithRetry} from './authoringPipeline';

/**
 * Kits vs plain scene documents, against a live model, through the real
 * retry loop and the real render + audit gate.
 *
 * @remarks
 * Opt-in (`OVC_LIVE_BENCHMARK=1`); spends one provider request per attempt
 * (at most topics x strategies x 3). `OVC_BENCH_PROVIDER` / `OVC_BENCH_MODEL`
 * pick the model, `OVC_BENCH_TOPICS=0,2` a subset, `OVC_BENCH_MAX_TOKENS` the
 * reply cap (default "open": no cap, so thinking is never cut off; a number
 * applies the same cap to both strategies). Results and rendered frames go to
 * `corpus-results/kit-benchmark/<timestamp>/`.
 */
const LIVE = process.env.OVC_LIVE_BENCHMARK === '1';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const COMPILE_ROOT = path.resolve(HERE, '../../host');
const RESULTS_ROOT = path.resolve(HERE, '../corpus-results/kit-benchmark');
const PROVIDER = process.env.OVC_BENCH_PROVIDER ?? 'gemini';
const MODEL = process.env.OVC_BENCH_MODEL ?? 'gemini-3.8-flash';
const ONLY = process.env.OVC_BENCH_TOPICS?.split(',').map(Number);
const CAP = process.env.OVC_BENCH_MAX_TOKENS ?? 'open';
const MAX_TOKENS: number | 'open' = CAP === 'open' ? 'open' : Number(CAP);
/** How long one provider request may take; slow reasoning models need more. */
const REQUEST_TIMEOUT_MS = Number(process.env.OVC_BENCH_TIMEOUT_MS ?? 300000);

export const BENCHMARK_TOPICS = [
  'Prove that the angles of a triangle add up to 180 degrees',
  'Show why the base angles of an isosceles triangle are equal',
  'Explain the Pythagorean theorem with a 3-4-5 right triangle',
  'Derive the quadratic formula by completing the square',
  'Differentiate x^3 from the limit definition of the derivative',
  'How does a heat pump move heat from outside into a house',
  // Maps, 3D and lessons - the newer kits.
  'Show where Nigeria is in Africa and name its neighbours',
  'Show the flight route from London to New York on a globe',
  'Show the surface z = x^2 + y^2 in 3D and mark its minimum',
  'What is a saddle point? Show one in 3D',
  'Explain, step by step, how the Nile flows from Lake Victoria to the Mediterranean',
  // Icons and circuits.
  'How does electricity get from a power station to your home',
  'What happens in the circuit when you flip a light switch',
  'Compare series and parallel circuits with two bulbs',
  'What are the main parts of a computer and what does each do',
  "How does a message travel from your phone to a friend's phone",
  // Choreography: rearranging, changing a quantity, walking through parts.
  'Prove the Pythagorean theorem by rearranging four copies of a right triangle',
  'How Riemann sums approximate the area under a curve',
  'Solve 3x + 5 = 20 step by step, showing each move',
  'What happens to a sine wave when you change its frequency and amplitude',
  'Why the area of a parallelogram is base times height',
  // A broad batch across subjects, asked the way a learner would - to find
  // what models reach for that does not exist yet.
  'Why does a ball thrown upward come back down, and how high does it go',
  'Show the forces acting on a box sliding down a ramp',
  'How does a convex lens form an image',
  'What are wavelength and frequency, and how are they related',
  "Explain Newton's third law with a rocket",
  'What happens to water molecules when ice melts',
  'How does a covalent bond form between two hydrogen atoms',
  'Balance the chemical equation for burning methane',
  'How does blood flow through the heart',
  'How does photosynthesis turn light into sugar',
  'How does a cell divide in mitosis',
  'What is the probability of getting at least one six in two dice rolls',
  'How do the mean, median and mode differ? Use an example',
  'Show the average monthly rainfall in London as a bar chart',
  'What does a normal distribution look like, and what does standard deviation mean',
  'Explain the unit circle and where sine and cosine come from',
  'How do you add fractions with different denominators',
  'What is a logarithm, and why is log(ab) = log a + log b',
  'Show how compound interest grows money over 10 years',
  'Solve 2x + y = 7 and x - y = 2 graphically',
  'What were the main causes of World War I',
  'Show a timeline of the Roman Empire from its founding to its fall',
  'How did the Silk Road connect China to Europe',
  'Why does the Earth have seasons',
  'How do supply and demand set a price',
  'How does binary search find a number in a sorted list',
  'How does bubble sort put a list in order',
  // Held out: siblings of the gaps the broad batch found (forces, optics,
  // atoms and molecules, data structures, charts), never used while
  // building the diagram layer - to see whether it generalises.
  'How does a pulley make it easier to lift a heavy load',
  'Explain how a seesaw balances, using forces and distances',
  'How does a plane mirror form an image',
  'Why does a straw look bent in a glass of water',
  'How are the electrons arranged in a sodium atom',
  'What does a salt (sodium chloride) crystal look like inside',
  'What happens to gas particles when a container is heated',
  'How does a stack work in programming: push and pop',
  'How does a queue work: people joining and leaving a line',
  'How does insertion sort work',
  'Show the exam marks of a class as a histogram and find the most common band',
  'How has the world population grown since 1900',
  'What forces act on a car going round a bend',
  'What shape is a methane molecule and why',
];

/** `OVC_BENCH_STRATEGIES=scene-document` runs only the kit strategy. */
const STRATEGIES: readonly AuthoringStrategy[] = [
  sceneDocumentPlain,
  sceneDocument,
].filter(
  s =>
    !process.env.OVC_BENCH_STRATEGIES ||
    process.env.OVC_BENCH_STRATEGIES.split(',').includes(s.id),
);

interface ReplyStats {
  status: number;
  finish?: string;
  contentChars: number;
  /** Reasoning text returned (OpenAI-style providers). */
  reasoningChars: number;
  /** Reasoning tokens counted (Gemini returns a count, not the text). */
  thinkingTokens?: number;
  completionTokens?: number;
}

function withCap(body: string): string {
  const parsed = JSON.parse(body);
  if (MAX_TOKENS === 'open') {
    delete parsed.max_tokens;
    if (parsed.generationConfig) delete parsed.generationConfig.maxOutputTokens;
  } else {
    if ('max_tokens' in parsed) parsed.max_tokens = MAX_TOKENS;
    if (parsed.generationConfig) {
      parsed.generationConfig.maxOutputTokens = MAX_TOKENS;
    }
  }
  return JSON.stringify(parsed);
}

/** A streamed reply (server-sent events) gathered into one JSON envelope. */
function fromEventStream(text: string): string {
  let content = '';
  let reasoning = '';
  let finish: string | undefined;
  let usage: unknown;
  for (const line of text.split(/\r?\n/)) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data);
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      content += choice?.delta?.content ?? '';
      reasoning +=
        choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? '';
      if (choice?.finish_reason) finish = choice.finish_reason;
    } catch {
      // a keep-alive or partial line
    }
  }
  return JSON.stringify({
    choices: [
      {
        message: {content, reasoning_content: reasoning},
        finish_reason: finish,
      },
    ],
    usage,
  });
}

function replyStats(status: number, text: string): ReplyStats {
  try {
    const json = JSON.parse(
      text.trimStart().startsWith('data:') ? fromEventStream(text) : text,
    );
    const candidate = json.candidates?.[0];
    if (candidate || json.usageMetadata) {
      const parts: {text?: string; thought?: boolean}[] =
        candidate?.content?.parts ?? [];
      return {
        status,
        finish: candidate?.finishReason,
        contentChars: parts
          .filter(p => !p.thought)
          .map(p => p.text ?? '')
          .join('').length,
        reasoningChars: 0,
        thinkingTokens: json.usageMetadata?.thoughtsTokenCount,
        completionTokens: json.usageMetadata?.candidatesTokenCount,
      };
    }
    const choice = json.choices?.[0];
    return {
      status,
      finish: choice?.finish_reason,
      contentChars: String(choice?.message?.content ?? '').length,
      reasoningChars: String(
        choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? '',
      ).length,
      completionTokens: json.usage?.completion_tokens,
    };
  } catch {
    return {status, contentChars: 0, reasoningChars: 0};
  }
}

/**
 * The real fetch, with the reply cap applied (or removed) and each reply's
 * finish reason recorded - "the provider returned no text" alone cannot tell
 * a truncated reply from a refusal.
 */
function instrumentedFetch(stats: ReplyStats[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? withCap(init.body) : init.body;
    // An overloaded free tier (503) or a burst limit (429) says nothing about
    // the format being measured, so it is retried here with backoff rather
    // than spending one of the strategy's attempts.
    let response = await fetch(url, {...init, body});
    for (const wait of [8, 15, 30, 45, 60]) {
      if (response.status !== 503 && response.status !== 429) break;
      // A spent daily quota will not come back in a minute.
      if (/PerDay/.test(await response.clone().text())) break;
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      response = await fetch(url, {...init, body});
    }
    const text = await response.text();
    stats.push(replyStats(response.status, text));
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  }) as unknown as typeof fetch;
}

interface Row {
  topic: string;
  strategy: string;
  ok: boolean;
  attempts: number | null;
  firstAttemptValid: boolean;
  failure?: string;
  attemptLog: string[];
  replies: ReplyStats[];
  documentChars?: number;
  usesKits?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  rendered?: boolean;
  renderStage?: string;
  blockingBeforeRepair?: string[];
  /** For a lesson: how many engine beats, and how long it runs. */
  parts?: number;
  lessonSeconds?: number;
  ms: number;
}

describe.skipIf(!LIVE)('kit benchmark (live)', () => {
  const renderer = new PreviewRenderer();
  const rows: Row[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(RESULTS_ROOT, stamp);
  afterAll(async () => {
    await renderer.close();
  });

  const topics = BENCHMARK_TOPICS.map((topic, index) => ({
    topic,
    index,
  })).filter(({index}) => !ONLY || ONLY.includes(index));

  for (const {topic, index} of topics) {
    for (const strategy of STRATEGIES) {
      it(`${strategy.id}: ${topic}`, async () => {
        const started = Date.now();
        const replies: ReplyStats[] = [];
        const outcome = await authorWithRetry({
          topic,
          strategy,
          apiSection: '',
          projectRoot: COMPILE_ROOT,
          provider: PROVIDER,
          model: MODEL,
          maxAttempts: 3,
          timeoutMs: REQUEST_TIMEOUT_MS,
          fetchImpl: instrumentedFetch(replies),
        });
        const row: Row = {
          topic,
          strategy: strategy.id,
          ok: outcome.ok,
          attempts: outcome.ok ? outcome.attempts : null,
          firstAttemptValid: outcome.ok && outcome.attempts === 1,
          attemptLog: outcome.log.map(
            entry =>
              `${entry.attempt}:${entry.outcome}${
                entry.outcome === 'accepted'
                  ? ''
                  : ` ${entry.detail
                      .replace(
                        /^The scene document has these problems[^\n]*\n/,
                        '',
                      )
                      .slice(0, 400)}`
              }`,
          ),
          replies,
          promptTokens: outcome.usage?.promptTokens,
          completionTokens: outcome.usage?.completionTokens,
          ms: 0,
        };
        if (!outcome.ok) {
          row.failure = `${outcome.reason}: ${outcome.detail.slice(0, 300)}`;
        }
        if (outcome.ok && outcome.intent) {
          const document = outcome.intent;
          row.documentChars = JSON.stringify(document).length;
          row.usesKits = JSON.stringify(document).includes('"kit"');
          // A lesson (scenes, or more beats than one engine beat) renders
          // part by part; its frames are each part's last.
          const lesson =
            isLessonDocument(document) || (outcome.parts?.length ?? 0) > 1;
          let preview: {
            ok: boolean;
            stage?: string;
            initialFindings: readonly {
              severity: string;
              ruleId: string;
              message: string;
            }[];
            frames: readonly {at: number; png: string}[];
          };
          if (lesson) {
            const rendered = await renderer.renderLesson(document);
            row.parts = rendered.parts.length;
            row.lessonSeconds = rendered.durationSeconds;
            preview = {
              ok: rendered.ok,
              stage: rendered.stage,
              initialFindings: rendered.parts.flatMap(p => p.initialFindings),
              frames: rendered.parts.map((p, i) => ({
                at: i + 1,
                png: p.frames[p.frames.length - 1]?.png ?? '',
              })),
            };
          } else {
            preview = await renderer.render(document, {frames: [0, 1]});
          }
          row.rendered = preview.ok;
          row.renderStage = preview.stage;
          row.blockingBeforeRepair = preview.initialFindings
            .filter(f => f.severity === 'blocking')
            .map(f => `${f.ruleId}: ${f.message}`);
          fs.mkdirSync(outDir, {recursive: true});
          const base = `${index}-${strategy.id}`;
          fs.writeFileSync(
            path.join(outDir, `${base}.ovw.json`),
            `${JSON.stringify(document, null, 2)}\n`,
          );
          for (const frame of preview.frames) {
            fs.writeFileSync(
              path.join(outDir, `${base}-${frame.at}.png`),
              Buffer.from(frame.png, 'base64'),
            );
          }
        }
        row.ms = Date.now() - started;
        rows.push(row);
        fs.mkdirSync(outDir, {recursive: true});
        fs.writeFileSync(
          path.join(outDir, 'results.json'),
          `${JSON.stringify(
            {provider: PROVIDER, model: MODEL, maxTokens: MAX_TOKENS, rows},
            null,
            2,
          )}\n`,
        );
        const describeReply = (r: ReplyStats) =>
          `${r.status}/${r.finish}/${r.contentChars}c/${
            r.thinkingTokens !== undefined
              ? `${r.thinkingTokens}think`
              : `${r.reasoningChars}r`
          }/${r.completionTokens}t`;
        // eslint-disable-next-line no-console
        console.log(
          [
            `[bench] ${strategy.id} | ${topic} | ok=${row.ok} attempts=${row.attempts} rendered=${row.rendered} chars=${row.documentChars} kits=${row.usesKits}${row.parts ? ` lesson=${row.parts}parts/${row.lessonSeconds}s` : ''} ${Math.round(row.ms / 1000)}s`,
            `  replies: ${replies.map(describeReply).join(' ')}`,
            ...row.attemptLog.map(line => `  ${line}`),
            ...(row.blockingBeforeRepair?.length
              ? [`  before repair: ${row.blockingBeforeRepair.join(' | ')}`]
              : []),
          ].join('\n'),
        );
        expect(row).toBeDefined();
      }, 1800000);
    }
  }
});
