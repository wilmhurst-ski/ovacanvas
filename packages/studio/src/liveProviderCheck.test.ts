import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {PROVIDERS, complete} from './providers';

/**
 * Ask every configured provider one trivial question, and say precisely what
 * went wrong when one does not answer.
 *
 * @remarks
 * Opt-in (`npm run check:provider`). This exists because "the provider does not
 * work" is three different problems that need three different fixes, and the
 * raw error does not distinguish them:
 *
 * - **Unreachable** - the network cannot get to the host. Nothing about the key
 *   or the model is in question, and no amount of rotating credentials helps.
 *   Observed for real: `tokenharbor.ai` times out on ports 80 and 443 from this
 *   machine while other hosts are fine.
 * - **Rejected** - the host answered and refused the key. Rotate it.
 * - **Model** - the host answered, accepted the key, and did not recognise the
 *   model id. Fix the id, not the key.
 *
 * Diagnosing that by hand took several rounds of `curl` and a run through the
 * whole authoring pipeline; the pipeline reports all three as
 * `attempts-exhausted`, which is true and useless.
 */
const LIVE = process.env.OVACANVAS_LIVE === '1';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const STUDIO_ROOT = path.resolve(HERE, '..');

function loadLocalEnv(): NodeJS.ProcessEnv {
  const file = path.join(STUDIO_ROOT, '.env.local');
  if (!fs.existsSync(file)) return process.env;
  const env: NodeJS.ProcessEnv = {...process.env};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2]) env[match[1]] = match[2].trim();
  }
  return env;
}

type Verdict =
  | 'ok'
  | 'unreachable'
  | 'rate-limited'
  | 'rejected'
  | 'model'
  | 'no-key'
  | 'other';

/** Turn one failure into the thing a person would actually do about it. */
function classify(result: {ok: boolean; kind?: string; detail?: string}): {
  verdict: Verdict;
  advice: string;
} {
  if (result.ok) return {verdict: 'ok', advice: ''};

  const detail = result.detail ?? '';
  // A transport failure never reached the host, so the key is untested. This
  // is the distinction that matters most and the one the pipeline loses.
  if (
    /fetch failed|before a response|timed out|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(
      detail,
    )
  ) {
    return {
      verdict: 'unreachable',
      advice:
        'network cannot reach the host - check VPN/firewall/DNS; the key was never tried',
    };
  }
  // Rate limiting is checked before the model heuristic, and it has to be:
  // a quota message names the model it was exceeded on, so the word "model"
  // appears in a message that says nothing at all about the model id. Ordering
  // these the other way reported an exhausted quota as a bad model id, which
  // would send someone to edit a correct configuration.
  if (/rate limit|quota|too many requests|429/i.test(detail)) {
    return {
      verdict: 'rate-limited',
      advice:
        'reachable and authenticated, but out of quota right now - not a configuration problem',
    };
  }
  if (result.kind === 'unrecoverable') {
    return {
      verdict: 'rejected',
      advice: 'the host refused the key or account - rotate it',
    };
  }
  if (/not found|unknown|invalid.*id|does not exist/i.test(detail)) {
    return {
      verdict: 'model',
      advice: 'check the model id against the provider catalogue',
    };
  }
  return {verdict: 'other', advice: detail.slice(0, 160)};
}

describe.skipIf(!LIVE)('provider connectivity', () => {
  it('reports what each configured provider actually does', async () => {
    const env = loadLocalEnv();
    const only = process.env.OVACANVAS_PROVIDER;
    const entries = Object.entries(PROVIDERS).filter(
      ([id]) => !only || id === only,
    );
    expect(entries.length).toBeGreaterThan(0);

    const lines: string[] = [];
    const broken: string[] = [];

    for (const [id, spec] of entries) {
      const key = env[spec.envKey];
      if (!key) {
        lines.push(`  ---- ${id.padEnd(12)} no key in ${spec.envKey}`);
        continue;
      }

      const started = Date.now();
      const result = await complete(spec, key, {
        model: spec.defaultModel,
        system: 'You are a health check. Answer with one word.',
        user: 'Reply with exactly: OK',
        timeoutMs: 30000,
      });
      const ms = Date.now() - started;
      const {verdict, advice} = classify(result);

      const mark =
        verdict === 'ok'
          ? 'OK  '
          : verdict === 'unreachable'
            ? 'NET '
            : verdict === 'rate-limited'
              ? 'QUOTA'
              : 'FAIL';
      lines.push(
        `  ${mark} ${id.padEnd(12)} ${String(ms).padStart(6)}ms  ${spec.defaultModel}` +
          (advice ? `\n         -> ${advice}` : ''),
      );
      if (verdict !== 'ok') broken.push(`${id} (${verdict})`);
    }

    console.log('PROVIDER CONNECTIVITY');
    for (const line of lines) console.log(line);

    // Deliberately does NOT fail on unreachable providers: this is a
    // diagnostic, and a check that goes red because a host is blocked from one
    // particular network would be ignored within a week. It fails only when a
    // provider that IS reachable is misconfigured.
    const misconfigured = broken.filter(
      entry => !entry.includes('unreachable'),
    );
    expect(misconfigured).toEqual([]);
  }, 600000);
});
