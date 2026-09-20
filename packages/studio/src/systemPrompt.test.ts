import * as os from 'os';
import {fileURLToPath} from 'url';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {buildVerifiedApiSection} from './systemPrompt';

const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildVerifiedApiSection', () => {
  it('derives the export list from the engine, not from memory', () => {
    const section = buildVerifiedApiSection({resolveFrom: COMPILE_ROOT});

    expect(section).toContain('VERIFIED CURRENT EXPORTS');
    // Names that must be real, or the whole point of the section is lost.
    expect(section).toContain('makeScene2D');
    expect(section).toContain('AnchoredLabel');
    // The audit engine's own internals must NOT be offered as scene APIs -
    // listing them would recreate the hallucination problem with real names.
    expect(section).not.toContain('evaluateVisualAudit');
    expect(section).not.toContain('collectCollisions');
  });

  it('fails soft when the declarations cannot be read, and says so', () => {
    // A missing build must not crash the authoring call - but it must not be
    // silent either. Losing this section removes the only thing preventing a
    // confidently invented API name, and a quiet degradation would surface
    // later as hallucinated calls with nothing pointing back here.
    // Must be somewhere Node's upward resolution cannot reach the workspace
    // from: a subdirectory of the repo would still find it by walking up, and
    // the test would pass for the wrong reason.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const section = buildVerifiedApiSection({resolveFrom: os.tmpdir()});

    expect(section).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'verified-API prompt section unavailable',
    );
    expect(warn.mock.calls[0][0]).toContain('no verified export list');
  });
});
