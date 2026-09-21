import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {authorWithRetry} from '../packages/studio/src/authoringPipeline.ts';
import {selectStrategy} from '../packages/studio/src/authoring/strategies/registry.ts';
import {buildCompactApiSection} from '../packages/studio/src/systemPrompt.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const compileRoot = path.join(repoRoot, 'packages', 'host');
const envFile = path.join(repoRoot, 'packages', 'studio', '.env.local');

const env = {...process.env};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2]) env[match[1]] = match[2].trim();
  }
}

const testCases = [
  {
    domain: 'History / Humanities',
    topic: 'a timeline of the main events of the Roman Republic',
    model: 'deepseek-v4.1-flash-free',
  },
  {
    domain: 'Biology / Life Science',
    topic: 'the main parts of a plant cell and what each does',
    model: 'deepseek-v4.1-flash-free',
  },
  {
    domain: 'Computer Science / Algorithms',
    topic: 'why a binary search halves the list each time',
    model: 'deepseek-v4.1-flash-free',
  },
  {
    domain: 'Earth Science / Geography',
    topic: 'what causes the seasons on Earth',
    model: 'gpt-5.6-luna-free',
  },
  {
    domain: 'Mathematics (Step-by-step)',
    topic: 'solve 4x - 7 = 2x + 9 step by step',
    model: 'gpt-5.6-luna-free',
  },
];

async function run() {
  console.log('===============================================================');
  console.log('  APMIX MULTI-DOMAIN VISUAL AUTHORING TEST');
  console.log('===============================================================');

  const results = [];
  const apiSection = buildCompactApiSection();

  for (const testCase of testCases) {
    console.log(`\n>>> [${testCase.domain}] Topic: "${testCase.topic}" | Model: ${testCase.model}`);
    const started = Date.now();
    try {
      const outcome = await authorWithRetry({
        topic: testCase.topic,
        strategy: selectStrategy(testCase.topic).strategy,
        apiSection,
        provider: 'apmix',
        model: testCase.model,
        projectRoot: compileRoot,
        env,
        timeoutMs: 90000,
      });

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const entry = {
        domain: testCase.domain,
        topic: testCase.topic,
        model: testCase.model,
        ok: outcome.ok,
        strategy: outcome.strategy,
        elapsedSec: elapsed,
        attempts: outcome.ok ? outcome.attempts : outcome.reason,
        codeLength: outcome.ok ? outcome.code?.length : 0,
        sourceLength: outcome.ok ? outcome.source?.length : 0,
        usage: outcome.usage,
        error: outcome.ok ? null : outcome.detail,
      };
      results.push(entry);

      console.log(`Finished in ${elapsed}s:`, {
        ok: entry.ok,
        strategy: entry.strategy,
        attempts: entry.attempts,
        codeLength: entry.codeLength,
        usage: entry.usage,
      });

      if (outcome.ok) {
        // Save authored beat to scratch
        const safeName = testCase.topic.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30);
        const outPath = path.join(repoRoot, 'packages', 'studio', 'scratch', `authored_${safeName}.ts`);
        fs.mkdirSync(path.dirname(outPath), {recursive: true});
        fs.writeFileSync(outPath, outcome.source, 'utf8');
        console.log(`Saved authored source to: ${outPath}`);
      } else {
        console.log('Failure detail:', outcome.detail);
      }
    } catch (err) {
      console.error('Crash during authoring:', err);
      results.push({
        domain: testCase.domain,
        topic: testCase.topic,
        model: testCase.model,
        ok: false,
        error: err.message,
      });
    }
  }

  console.log('\n===============================================================');
  console.log('  SUMMARY OF RESULTS');
  console.log('===============================================================');
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.domain.padEnd(25)} | ${r.model.padEnd(25)} | ${r.elapsedSec}s | attempts: ${r.attempts}`);
  }
}

run();
