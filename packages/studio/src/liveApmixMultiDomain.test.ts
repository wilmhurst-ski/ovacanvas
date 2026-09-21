import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {selectStrategy} from './authoring/strategies/registry';
import {authorWithRetry} from './authoringPipeline';
import {buildCompactApiSection} from './systemPrompt';

const LIVE = process.env.OVACANVAS_LIVE === '1';
const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));

function loadLocalEnv(): NodeJS.ProcessEnv {
  const file = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (!fs.existsSync(file)) return process.env;
  const env: NodeJS.ProcessEnv = {...process.env};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2]) env[match[1]] = match[2];
  }
  return env;
}

const DOMAINS = [
  {
    domain: 'Earth Science / Geography',
    topic: 'what causes the seasons on Earth',
    model: 'gpt-5.6-luna-free',
  },
  {
    domain: 'History / Humanities',
    topic: 'a timeline of the main events of the Roman Republic',
    model: 'gpt-5.6-luna-free',
  },
  {
    domain: 'Biology / Life Science',
    topic: 'the main parts of a plant cell and what each does',
    model: 'gpt-5.6-luna-free',
  },
  {
    domain: 'Mathematics (Step-by-step)',
    topic: 'solve 4x - 7 = 2x + 9 step by step',
    model: 'gpt-5.6-luna-free',
  },
  {
    domain: 'Computer Science / Algorithms',
    topic: 'why a binary search halves the list each time',
    model: 'deepseek-v4.1-flash-free',
  },
];

describe.skipIf(!LIVE)('APMIX multi-domain authoring', () => {
  const env = loadLocalEnv();
  const apiSection = buildCompactApiSection();

  for (const item of DOMAINS) {
    it(`authors beat for [${item.domain}]: "${item.topic}" with ${item.model}`, async () => {
      console.log(
        `\nStarting authoring for [${item.domain}]: "${item.topic}" using ${item.model}`,
      );
      const started = Date.now();
      const outcome = await authorWithRetry({
        topic: item.topic,
        strategy: selectStrategy(item.topic).strategy,
        apiSection,
        provider: 'apmix',
        model: item.model,
        projectRoot: COMPILE_ROOT,
        env,
        timeoutMs: 90000,
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      console.log(`Completed in ${elapsed}s:`, {
        ok: outcome.ok,
        strategy: outcome.strategy,
        provider: outcome.provider,
        model: outcome.model,
        attempts: outcome.ok ? outcome.attempts : outcome.reason,
        codeLength: outcome.ok ? outcome.code?.length : 0,
        usage: outcome.usage,
      });

      if (!outcome.ok) {
        console.log(`Failure reason: ${outcome.reason}`);
        console.log(`Failure detail: ${outcome.detail}`);
        console.log(`Failure log:`, JSON.stringify(outcome.log, null, 2));
      }
      if (outcome.ok) {
        const safeName = item.topic
          .replace(/[^a-z0-9]/gi, '_')
          .toLowerCase()
          .slice(0, 30);
        const outDir = path.resolve(HERE, '..', 'scratch');
        fs.mkdirSync(outDir, {recursive: true});
        fs.writeFileSync(
          path.join(outDir, `${safeName}.ts`),
          outcome.source,
          'utf8',
        );
      }

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.code.length).toBeGreaterThan(100);
        expect(outcome.attempts).toBeLessThanOrEqual(3);
      }
    }, 180000);
  }
});
