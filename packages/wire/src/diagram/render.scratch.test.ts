import fs from 'node:fs';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {PreviewRenderer} from '../node/preview.js';

/**
 * Renders every `*.json` document in `OVC_SCRATCH_DIR` through the real
 * host gate and writes each part's frames next to it - for looking at
 * drawings while building. Skipped unless the directory is given.
 */
const DIR = process.env.OVC_SCRATCH_DIR;
const ONLY = process.env.OVC_SCRATCH_ONLY;

describe.skipIf(!DIR)('scratch renders', () => {
  const renderer = new PreviewRenderer();
  afterAll(() => renderer.close());
  const files = DIR
    ? fs
        .readdirSync(DIR)
        .filter(f => f.endsWith('.json'))
        .filter(f => !ONLY || ONLY.split(',').some(o => f.startsWith(o)))
    : [];
  for (const file of files) {
    it(file, async () => {
      const input: unknown = JSON.parse(fs.readFileSync(path.join(DIR!, file), 'utf8'));
      const outcome = await renderer.renderLesson(input, {frames: [0, 0.5, 1]});
      const base = path.join(DIR!, 'out', file.replace(/\.json$/, ''));
      fs.mkdirSync(path.dirname(base), {recursive: true});
      const report: string[] = [
        `${file}: ok=${outcome.ok} stage=${outcome.stage ?? '-'}`,
        ...outcome.issues.map(
          i => `  issue ${i.severity} ${i.code} ${i.node ?? ''} ${i.prop ?? ''} ${i.step ?? ''}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`,
        ),
      ];
      for (const part of outcome.parts) {
        report.push(`  part ${part.id}: ok=${part.ok} stage=${part.stage ?? '-'}`);
        for (const f of part.initialFindings) report.push(`    initial ${f.ruleId}: ${f.message}`);
        for (const f of part.findings) report.push(`    finding ${f.ruleId}: ${f.message}`);
        for (const a of part.adjustments ?? []) report.push(`    moved ${a.node} ${JSON.stringify(a.from)} -> ${JSON.stringify(a.to)}`);
        if (part.detail) report.push(`    detail ${part.detail.slice(0, 300)}`);
        part.frames.forEach((frame, i) => {
          fs.writeFileSync(`${base}-${part.id}-${i}.png`, Buffer.from(frame.png, 'base64'));
        });
      }
      fs.writeFileSync(`${base}.txt`, report.join('\n'));
      console.log(report.join('\n'));
      expect(outcome).toBeTruthy();
    }, 240000);
  }
});
