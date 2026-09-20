import * as fs from 'fs';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {selectStrategy} from './authoring/strategies/registry.ts';
import {authorWithRetry} from './authoringPipeline.ts';
import {buildVerifiedApiSection} from './systemPrompt.ts';

/**
 * A real, live authoring run against a real provider.
 *
 * @remarks
 * Opt-in (`OVACANVAS_LIVE=1`) rather than part of the default suite: it needs
 * a network and a key, and a suite that fails without either is a suite people
 * learn to ignore. The topics below are deliberately ordinary, unrelated
 * ones - nothing here is tuned to any example, and the point is precisely that
 * the same pipeline handles whatever it is asked.
 */
const LIVE = process.env.OVACANVAS_LIVE === '1';
const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));

/** Read `.env.local` the same way the dev server does, without a dependency. */
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

const TOPICS = [
  'why a binary search halves the list each time',
  'what causes the seasons on Earth',
];

describe.skipIf(!LIVE)('live authoring', () => {
  const env = loadLocalEnv();
  const apiSection = buildVerifiedApiSection({resolveFrom: COMPILE_ROOT});

  it('prompt is derived from the engine, not hand-written', () => {
    expect(apiSection).toContain('VERIFIED CURRENT EXPORTS');
    expect(apiSection).toContain('makeScene2D');
    expect(apiSection.length).toBeGreaterThan(2000);
  });

  it.each(TOPICS)(
    'authors a compiling beat for: %s',
    async topic => {
      const outcome = await authorWithRetry({
        topic,
        strategy: selectStrategy(topic).strategy,
        apiSection,
        projectRoot: COMPILE_ROOT,
        env,
      });

      console.log(
        `LIVE ${topic} :: ${JSON.stringify({
          ok: outcome.ok,
          strategy: outcome.strategy,
          provider: outcome.provider,
          model: outcome.model,
          attempts: outcome.ok ? outcome.attempts : undefined,
          repaired: outcome.ok ? outcome.repaired : undefined,
          reason: outcome.ok ? undefined : outcome.reason,
          detail: outcome.ok ? undefined : outcome.detail,
          log: outcome.log,
        })}`,
      );

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.code).toContain('buildAuditSpec');
        expect(outcome.attempts).toBeLessThanOrEqual(3);
        expect(outcome.source.length).toBeGreaterThan(200);
      }
    },
    240000,
  );
});
