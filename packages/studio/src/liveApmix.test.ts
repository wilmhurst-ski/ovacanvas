import * as fs from 'fs';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {selectStrategy} from './authoring/strategies/registry';
import {authorWithRetry} from './authoringPipeline';
import {buildCompactApiSection} from './systemPrompt';

const LIVE = process.env.OVACANVAS_LIVE === '1';
const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));

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

describe.skipIf(!LIVE)('APMIX live testing', () => {
  const env = loadLocalEnv();
  const apiSection = buildCompactApiSection();

  it('probes gpt-5.6-luna-free connectivity and reports status', async () => {
    const key = env.APMIX_API_KEY;
    expect(key).toBeTruthy();
    const started = Date.now();
    try {
      const res = await fetch('https://api.apmix.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.6-luna-free',
          messages: [{role: 'user', content: 'Say OK'}],
          max_tokens: 10,
        }),
      });
      const data = await res.json();
      const ms = Date.now() - started;
      console.log(`GPT-5.6-LUNA status (${res.status} in ${ms}ms):`, data);
    } catch (e) {
      console.log('GPT-5.6-LUNA network error:', e);
    }
  }, 30000);

  it('authors binary search scene using deepseek-v4.1-flash-free', async () => {
    const topic = 'why a binary search halves the list each time';
    console.log(`Starting authorWithRetry for: ${topic}`);
    const outcome = await authorWithRetry({
      topic,
      strategy: selectStrategy(topic).strategy,
      apiSection,
      provider: 'apmix',
      model: 'deepseek-v4.1-flash-free',
      projectRoot: COMPILE_ROOT,
      env,
    });
    console.log(`Finished ${topic}:`, {
      ok: outcome.ok,
      strategy: outcome.strategy,
      attempts: outcome.ok ? outcome.attempts : outcome.reason,
      codeLen: outcome.ok ? outcome.code.length : 0,
      detail: outcome.ok ? undefined : outcome.detail,
    });
    expect(outcome.ok).toBe(true);
  }, 120000);
});
