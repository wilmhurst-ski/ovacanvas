import * as fs from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';

/**
 * Automated enforcement of Mandate 1 (§1): Topic-Agnostic Core Pipeline.
 *
 * @remarks
 * The compile to audit to repair to stage pipeline must never contain a
 * branch that checks "is this topic math / history / geography".
 * Anything topic-specific lives in a registered domain module.
 *
 * This test statically scans all source files in core packages:
 * - packages/core/src
 * - packages/2d/src/lib/audit
 * - packages/2d/src/lib/layout
 * - packages/host/src/presentation
 * - packages/host/src/orchestration
 * - packages/host/src/lesson
 * - packages/host/src/authoring/genres
 *
 * It asserts zero live subject-specific branches (e.g. topic === 'math',
 * subject === 'history', etc.).
 */
describe('Topic-Agnostic Core Pipeline (Mandate 1)', () => {
  const packagesRoot = path.resolve(__dirname, '..', '..');

  const coreDirectories = [
    path.join(packagesRoot, 'core', 'src'),
    path.join(packagesRoot, '2d', 'src', 'lib', 'audit'),
    path.join(packagesRoot, '2d', 'src', 'lib', 'layout'),
    path.join(packagesRoot, 'host', 'src', 'presentation'),
    path.join(packagesRoot, 'host', 'src', 'orchestration'),
    path.join(packagesRoot, 'host', 'src', 'lesson'),
    path.join(packagesRoot, 'host', 'src', 'authoring', 'genres'),
  ];

  const forbiddenSubjects = [
    'math',
    'maths',
    'algebra',
    'quadratic',
    'calculus',
    'physics',
    'chemistry',
    'history',
    'biology',
    'geography',
  ];

  function collectTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(fullPath));
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('contains zero subject-specific conditional branches in the core pipeline', () => {
    const allFiles = coreDirectories.flatMap(collectTsFiles);
    expect(allFiles.length).toBeGreaterThan(20);

    const violations: Array<{file: string; line: number; content: string}> = [];

    // Regex checking for conditional branching on subject names:
    // e.g. (topic|subject|domain)\s*(===|==|!==|!=)\s*['"`](math|algebra...)
    // or case ['"`](math|algebra...)
    const branchRegex = new RegExp(
      `(?:(?:topic|subject|domain)\\s*(?:===|==|!==|!=)\\s*['"\`](?:${forbiddenSubjects.join(
        '|',
      )})['"\`])|(?:case\\s*['"\`](?:${forbiddenSubjects.join('|')})['"\`]:)`,
      'i',
    );

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Strip comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        if (branchRegex.test(line)) {
          violations.push({
            file: path.relative(packagesRoot, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('presentation genres are structurally driven with no subject-name dependencies', () => {
    const genresDir = path.join(
      packagesRoot,
      'host',
      'src',
      'authoring',
      'genres',
    );
    const genreFiles = collectTsFiles(genresDir);
    expect(genreFiles.length).toBeGreaterThan(0);

    const violations: Array<{file: string; line: number; content: string}> = [];

    // Inside genres, genre code must never check for domain/subject literals
    const subjectLiteralRegex = new RegExp(
      `['"\`](?:${forbiddenSubjects.join('|')})['"\`]`,
      'i',
    );

    for (const file of genreFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        if (subjectLiteralRegex.test(line)) {
          violations.push({
            file: path.relative(packagesRoot, file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
